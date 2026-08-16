/**
 * SCORE v6 — hard revert for one intent (git-reset style).
 *
 * POST {versionNo} → restore this intent's WHEN spec (title/definition) and its
 * pin set from that config version's snapshot, then DELETE every later version
 * that is solely about this intent — the timeline rewinds instead of growing a
 * new entry. Ratings are hash-keyed history, so the restored spec's rows
 * re-attach instantly (zero LLM).
 *
 * The RULE (the intent's Then) is DELIBERATELY not touched: rules live on their
 * own version axis (score_rule_versions, revert there), and a rule Save never
 * records a config version — so a config snapshot's `rule` is a stale side-
 * capture (the rule as of the last WHEN edit, which predates any later Save).
 * Restoring it here silently wiped rules saved after the reverted version.
 *
 * Later versions SHARED with other intents (e.g. an ownership decision) are
 * kept — deleting them would erase the other intent's history. Their pin
 * effects on this intent are still undone by the snapshot restore above.
 */
import { NextResponse } from 'next/server';
import { and, eq, gt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/db';
import { scoreConfigVersions, scoreIntents } from '@/db/schema';
import { authorizeAssignment, authErrorResponse } from '@/lib/score/authz';
import { logStudyEvent } from '@/lib/study/events';
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

  const result = await db.transaction(async (tx) => {
    // Restore the WHEN spec only. isTemplate/archived stay as they are —
    // reverting the WHEN must not silently un-register or un-archive the intent.
    // `rule` is intentionally excluded: it is the intent's Then, versioned on the
    // separate score_rule_versions axis, so restoring the snapshot's stale `rule`
    // here would clobber a rule Saved after this version (the board's "No rule
    // yet" regression). Revert the rule from the RuleWorkbench history instead.
    // Tree placement is part of the WHEN: where a set sits decides which
    // questions reach it (routing is order-sensitive), so a revert that left
    // position/parent alone would restore a definition into a different chain
    // than it was written for. Snapshots predating v7 carry neither field —
    // fall back to the row's current placement rather than orphaning it.
    await tx
      .update(scoreIntents)
      .set({
        title: snapIntent.title,
        definition: snapIntent.definition,
        parentIntentId: snapIntent.parentIntentId ?? intentRows[0].parentIntentId,
        position: snapIntent.position ?? intentRows[0].position,
        updatedAt: new Date(),
      })
      .where(and(eq(scoreIntents.id, intentId), eq(scoreIntents.assignmentId, id)));

    // Restore the pin set. Snapshot pins are stored newest-first; stagger
    // Corrections are deliberately NOT rewound. A version captured a
    // DEFINITION, which is the whole of the spec now — restoring it reproduces
    // the behaviour exactly. The corrections table is a different record: what
    // the instructor taught and when. Rewinding it would delete consumed
    // markers, which is the one history this model promises to keep.

    // Rewind the timeline: drop every LATER version that is solely about this
    // intent. Shared entries survive (they carry another intent's history).
    // Returning the rows, not just their ids: this delete is the only place
    // those versions existed, and rewinding is itself a finding for RQ1. The
    // study event below keeps what was undone (STUDY_TRAIL_SPEC §2.3).
    const deleted = await tx
      .delete(scoreConfigVersions)
      .where(
        and(
          eq(scoreConfigVersions.assignmentId, id),
          gt(scoreConfigVersions.versionNo, body.versionNo),
          sql`${scoreConfigVersions.summary}->'intentIds' = ${JSON.stringify([intentId])}::jsonb`
        )
      )
      .returning();
    return { deleted };
  });

  // Only this intent's own entry from each dropped snapshot: the delete filter
  // is `intentIds == [intentId]`, so that entry is what the version was about,
  // and carrying whole trees here would bloat the log for nothing.
  await logStudyEvent(id, 'revert', {
    intentId,
    toVersionNo: body.versionNo,
    deletedVersions: result.deleted.map((v) => {
      const snap = v.snapshot as { intents?: { id: number }[] } | null;
      return {
        versionNo: v.versionNo,
        createdAt: v.createdAt?.toISOString() ?? null,
        summary: v.summary,
        snapshotIntent: snap?.intents?.find((i) => i.id === intentId) ?? null,
      };
    }),
  });
  return NextResponse.json({
    reverted: true,
    versionNo: body.versionNo,
    deleted: result.deleted.length,
  });
}
