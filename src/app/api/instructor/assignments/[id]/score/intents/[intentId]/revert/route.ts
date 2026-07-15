/**
 * SCORE v6 — hard revert for one intent (git-reset style).
 *
 * POST {versionNo} → restore this intent's spec (title/definition/rule) and
 * its pin set from that config version's snapshot, then DELETE every later
 * version that is solely about this intent — the timeline rewinds instead of
 * growing a new entry. Ratings are hash-keyed history, so the restored spec's
 * rows re-attach instantly (zero LLM).
 *
 * Later versions SHARED with other intents (e.g. an ownership decision) are
 * kept — deleting them would erase the other intent's history. Their pin
 * effects on this intent are still undone by the snapshot restore above.
 */
import { NextResponse } from 'next/server';
import { and, eq, gt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/db';
import { scoreConfigVersions, scoreIntentPins, scoreIntents } from '@/db/schema';
import { authorizeAssignment, authErrorResponse } from '@/lib/score/authz';
import { ensureIntentTables, type IntentConfigSnapshot } from '@/lib/score/intent-store';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ versionNo: z.number().int().positive() });

type RouteParams = { params: Promise<{ id: string; intentId: string }> };

export async function POST(req: Request, { params }: RouteParams) {
  const { id, intentId: intentIdRaw } = await params;
  const auth = await authorizeAssignment(id);
  if ('error' in auth) {
    const { body, status } = authErrorResponse(auth.error);
    return NextResponse.json(body, { status });
  }
  const intentId = Number.parseInt(intentIdRaw, 10);
  if (!Number.isFinite(intentId)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'invalid_input', details: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  await ensureIntentTables();
  const intentRows = await db
    .select()
    .from(scoreIntents)
    .where(and(eq(scoreIntents.id, intentId), eq(scoreIntents.assignmentId, id)));
  if (!intentRows[0]) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const versionRows = await db
    .select({ snapshot: scoreConfigVersions.snapshot })
    .from(scoreConfigVersions)
    .where(
      and(eq(scoreConfigVersions.assignmentId, id), eq(scoreConfigVersions.versionNo, body.versionNo))
    );
  const snapshot = versionRows[0]?.snapshot as IntentConfigSnapshot | undefined;
  const snapIntent = snapshot?.intents?.find((i) => i.id === intentId);
  if (!snapshot || !snapIntent) {
    return NextResponse.json({ error: 'version_not_found' }, { status: 404 });
  }
  const snapPins = (snapshot.pins ?? []).filter((p) => p.intentId === intentId);

  const result = await db.transaction(async (tx) => {
    // Restore the spec. isTemplate/archived stay as they are — reverting the
    // WHEN must not silently un-register or un-archive the intent.
    await tx
      .update(scoreIntents)
      .set({
        title: snapIntent.title,
        definition: snapIntent.definition,
        rule: snapIntent.rule,
        updatedAt: new Date(),
      })
      .where(and(eq(scoreIntents.id, intentId), eq(scoreIntents.assignmentId, id)));

    // Restore the pin set. Snapshot pins are stored newest-first; stagger
    // createdAt descending so the recency order — and thus the prompt-pin
    // selection and defHash — reproduces the original spec byte-for-byte
    // (same recipe as the PATCH route's pinsFromVersion).
    await tx.delete(scoreIntentPins).where(eq(scoreIntentPins.intentId, intentId));
    if (snapPins.length > 0) {
      const base = Date.now();
      await tx.insert(scoreIntentPins).values(
        snapPins.map((p, i) => ({
          assignmentId: id,
          intentId,
          messageId: p.messageId,
          verdict: p.verdict,
          queryText: p.queryText,
          source: p.source ?? 'manual',
          createdAt: new Date(base - i * 1000),
        }))
      );
    }

    // Rewind the timeline: drop every LATER version that is solely about this
    // intent. Shared entries survive (they carry another intent's history).
    const deleted = await tx
      .delete(scoreConfigVersions)
      .where(
        and(
          eq(scoreConfigVersions.assignmentId, id),
          gt(scoreConfigVersions.versionNo, body.versionNo),
          sql`${scoreConfigVersions.summary}->'intentIds' = ${JSON.stringify([intentId])}::jsonb`
        )
      )
      .returning({ id: scoreConfigVersions.id });
    return { deleted: deleted.length };
  });

  return NextResponse.json({ reverted: true, versionNo: body.versionNo, deleted: result.deleted });
}
