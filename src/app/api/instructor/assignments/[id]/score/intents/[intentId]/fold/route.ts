/**
 * SCORE — APPLY a reviewed fold: write the new definition(s) and consume the
 * corrections they absorbed, in one transaction.
 *
 * POST {applies: [{intentId, definition, title?}], correctionIds: number[]}
 *
 * This is the moment a correction stops being live: its row flips to
 * 'consumed' and survives only as a display marker ("you marked this in at
 * v2"). Consuming and rewriting MUST be atomic — a definition saved without
 * consuming would re-fold the same corrections forever, and corrections
 * consumed without the definition would erase the instructor's teaching
 * outright.
 *
 * The definition sent here is whatever the instructor left in the modal, not
 * necessarily what the model proposed: the review gate exists so they can edit
 * it, so this route trusts the text it is given.
 *
 * Ratings are NOT touched. A new definition means a new intentDefHash, so every
 * rating of these intents reads stale on the next load and the workbench's
 * Apply re-rates them — the same path any definition edit takes.
 */
import { NextResponse } from 'next/server';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/db';
import { scoreIntentPins, scoreIntents } from '@/db/schema';
import { authorizeAssignment, authErrorResponse } from '@/lib/score/authz';
import {
  ensureIntentTables,
  recordConfigVersion,
  type VersionSummary,
} from '@/lib/score/intent-store';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  applies: z
    .array(
      z.object({
        intentId: z.number().int().positive(),
        definition: z.string().trim().min(1).max(4000),
        title: z.string().trim().min(1).max(200).optional(),
      })
    )
    .min(1)
    .max(10),
  /** The corrections these definitions absorbed. Ids are re-checked server-side
   * against the intents being written, so a stale client cannot consume
   * somebody else's pending work. */
  correctionIds: z.array(z.number().int().positive()).min(1).max(500),
});

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

  // Every intent being written must belong to this assignment, and the edited
  // one must be among them — the route is scoped to that workbench.
  const targetIds = [...new Set(body.applies.map((a) => a.intentId))];
  if (!targetIds.includes(intentId)) {
    return NextResponse.json({ error: 'invalid_input', message: 'intent not in applies' }, { status: 400 });
  }
  const owned = await db
    .select({ id: scoreIntents.id, title: scoreIntents.title })
    .from(scoreIntents)
    .where(and(eq(scoreIntents.assignmentId, id), inArray(scoreIntents.id, targetIds)));
  if (owned.length !== targetIds.length) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const now = new Date();
  const result = await db.transaction(async (tx) => {
    for (const a of body.applies) {
      await tx
        .update(scoreIntents)
        .set({
          definition: a.definition,
          ...(a.title ? { title: a.title } : {}),
          updatedAt: now,
        })
        .where(and(eq(scoreIntents.id, a.intentId), eq(scoreIntents.assignmentId, id)));
    }

    // Consume ONLY pending corrections that belong to the intents just
    // rewritten. Anything else in the id list is ignored rather than trusted.
    const consumed = await tx
      .update(scoreIntentPins)
      .set({ status: 'consumed', consumedAt: now, consumedAtVersion: null })
      .where(
        and(
          eq(scoreIntentPins.assignmentId, id),
          eq(scoreIntentPins.status, 'pending'),
          inArray(scoreIntentPins.intentId, targetIds),
          inArray(scoreIntentPins.id, body.correctionIds)
        )
      )
      .returning({ id: scoreIntentPins.id });

    const titleOf = new Map(owned.map((o) => [o.id, o.title]));
    const summary: VersionSummary = {
      action: 'update_intent',
      intentIds: targetIds,
      detail:
        `definition from ${consumed.length} correction${consumed.length === 1 ? '' : 's'}` +
        (targetIds.length > 1
          ? ` · also narrowed ${targetIds
              .filter((t) => t !== intentId)
              .map((t) => `“${titleOf.get(t) ?? t}”`)
              .join(', ')}`
          : ''),
      minor: true,
    };
    const versionNo = await recordConfigVersion(tx, id, auth.instructor.id, summary);

    // The marker cites the version the fold produced — known only now.
    if (consumed.length > 0 && versionNo !== null) {
      await tx
        .update(scoreIntentPins)
        .set({ consumedAtVersion: versionNo })
        .where(
          and(
            eq(scoreIntentPins.assignmentId, id),
            inArray(
              scoreIntentPins.id,
              consumed.map((c) => c.id)
            )
          )
        );
    }
    return { consumed: consumed.length, versionNo };
  });

  // Anything still pending on these intents was NOT part of this fold (the
  // instructor may have labelled more while the modal was open). Report it so
  // the client can keep showing the waiting card instead of silently clearing.
  const stillPending = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(scoreIntentPins)
    .where(
      and(
        eq(scoreIntentPins.assignmentId, id),
        eq(scoreIntentPins.status, 'pending'),
        inArray(scoreIntentPins.intentId, targetIds)
      )
    );

  return NextResponse.json({
    consumed: result.consumed,
    versionNo: result.versionNo,
    stillPending: stillPending[0]?.n ?? 0,
  });
}
