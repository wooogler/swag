/**
 * SCORE — CORRECTIONS for one intent.
 *
 * A correction is the instructor overruling the judge on one question. It is
 * TRANSIENT: it waits as 'pending' until "Update definition" folds it into the
 * definition text, and is then marked 'consumed' and kept only as a display
 * marker ("you marked this in at v2").
 *
 * POST   {messageId, verdict, reason?} → record/replace a correction. Re-labelling
 *        a question whose earlier correction was consumed (or held) returns the
 *        row to 'pending' — you are teaching it again.
 * PATCH  {retireMessageIds} → retire HELD corrections the definition has caught
 *        up with (see the handler).
 * DELETE ?messageId=N → withdraw a correction (and its marker).
 * DELETE ?all=1       → withdraw every correction of this intent.
 *
 * A correction does NOT enter any prompt and is NOT part of intentDefHash, so
 * recording one never makes ratings stale — the DEFINITION it produces does.
 * Labelling records no version either: the fold that consumes it does.
 */
import { NextResponse } from 'next/server';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/db';
import { scoreIntentPins, scoreIntentRatings, scoreIntents } from '@/db/schema';
import { authorizeAssignment, authErrorResponse } from '@/lib/score/authz';
import {
  ensureIntentTables,
  getAssignmentMessageText,
  loadIntentState,
  pickDisplayRatings,
} from '@/lib/score/intent-store';
import {
  compileChains,
  isIncludedRating,
  isRatingLevel,
  isScoreQueryType,
} from '@/lib/score/intents';

export const dynamic = 'force-dynamic';

const postSchema = z.object({
  messageId: z.number().int().positive(),
  verdict: z.enum(['in', 'out']),
  source: z.enum(['manual', 'ownership']).optional(),
  /** Why the instructor overruled the judge. The UI asks only when the verdict
   * DISAGREES with the current rating; that reason is the fold's main fuel, so
   * it is kept for BOTH verdicts now (an in-correction's "why yes" generalizes
   * exactly as an out-correction's "why not" does). */
  reason: z.string().trim().max(400).optional(),
  /** v7 "send this question here": an earlier intent in the same chain answers
   * this question first, and only NARROWING that intent can change it. So this
   * records a second correction — out, on the intercepting intent — which the
   * fold turns into an exclusion in ITS definition. Both land in one write. */
  routeHere: z.boolean().optional(),
});

type RouteParams = { params: Promise<{ id: string; intentId: string }> };

async function resolveIntent(assignmentId: string, intentIdRaw: string) {
  const intentId = Number.parseInt(intentIdRaw, 10);
  if (!Number.isFinite(intentId)) return null;
  await ensureIntentTables();
  const rows = await db
    .select()
    .from(scoreIntents)
    .where(and(eq(scoreIntents.id, intentId), eq(scoreIntents.assignmentId, assignmentId)));
  return rows[0] ?? null;
}

export async function POST(req: Request, { params }: RouteParams) {
  const { id, intentId: intentIdRaw } = await params;
  const auth = await authorizeAssignment(id);
  if ('error' in auth) {
    const { body, status } = authErrorResponse(auth.error);
    return NextResponse.json(body, { status });
  }
  const intent = await resolveIntent(id, intentIdRaw);
  if (!intent) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  let body: z.infer<typeof postSchema>;
  try {
    body = postSchema.parse(await req.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'invalid_input', details: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  // Snapshot the pinned question's text at pin time (and reject messages that
  // are not user messages of this assignment).
  const queryText = await getAssignmentMessageText(id, body.messageId);
  if (!queryText) {
    return NextResponse.json({ error: 'message_not_found' }, { status: 404 });
  }

  const now = new Date();
  const set = {
    verdict: body.verdict,
    queryText,
    reason: body.reason?.trim() || null,
    source: body.source ?? 'manual',
    createdAt: now,
    // Recording a correction always makes it PENDING — including over a
    // consumed marker, which is the "teach it again" case: the definition that
    // absorbed the last correction evidently did not hold.
    status: 'pending' as const,
    consumedAtVersion: null,
    consumedAt: null,
  };
  // Which earlier sets have to yield for this question to reach this intent.
  // Computed before the write so the whole action lands (or doesn't) at once.
  let redirected: number[] = [];
  if (body.routeHere && body.verdict === 'in') {
    const state = await loadIntentState(id);
    const chains = compileChains(
      state.promptReady
        .filter((p) => !p.intent.isTemplate)
        .map((p) => ({
          id: p.intent.id,
          kind: 'intent' as const,
          type: p.intent.type,
          parentIntentId: p.intent.parentIntentId,
          position: p.intent.position,
        }))
    );
    const chain = isScoreQueryType(intent.type) ? chains.get(intent.type) : undefined;
    const myIndex = chain ? chain.order.indexOf(intent.id) : -1;
    if (chain && myIndex > 0) {
      const earlier = chain.order.slice(0, myIndex);
      const ratingRows = await db
        .select({
          messageId: scoreIntentRatings.messageId,
          intentId: scoreIntentRatings.intentId,
          rating: scoreIntentRatings.rating,
          defHash: scoreIntentRatings.defHash,
          ratedAt: scoreIntentRatings.ratedAt,
        })
        .from(scoreIntentRatings)
        .where(
          and(
            eq(scoreIntentRatings.assignmentId, id),
            eq(scoreIntentRatings.messageId, body.messageId)
          )
        );
      // MUST use the same reading the board shows — pickDisplayRatings, which
      // falls back to the newest row when no rating carries the current hash.
      // Filtering to fresh-hash rows only looked equivalent and was not: after
      // a rating-version bump EVERY row is stale, so this found no interceptor
      // at all and "send here" silently did nothing, while the row on screen
      // still read "taken by X". The rule is: if the UI says X takes it, this
      // acts on X.
      const wanted = new Map(state.promptReady.map((p) => [p.intent.id, p.defHash]));
      const display = pickDisplayRatings(ratingRows, wanted).get(body.messageId);
      // Judgment only: an intent intercepts this question iff its RATING
      // claims it. A pending correction on that intent has changed nothing for
      // students yet, so treating it as a claim (or a release) would make this
      // disagree with what the deployed chatbot actually does.
      redirected = earlier.filter((oid) => {
        const rating = display?.get(oid)?.row.rating;
        return isRatingLevel(rating) && isIncludedRating(rating);
      });
    }
  }

  // Recording a correction writes no version — the fold that consumes it does.
  await db.transaction(async (tx) => {
    await tx
      .insert(scoreIntentPins)
      .values({ assignmentId: id, intentId: intent.id, messageId: body.messageId, ...set })
      .onConflictDoUpdate({
        target: [scoreIntentPins.intentId, scoreIntentPins.messageId],
        set,
      });
    for (const otherId of redirected) {
      const outSet = {
        verdict: 'out' as const,
        queryText,
        // Phrased as a boundary the fold can act on: it has to narrow THIS
        // intent's definition, not merely note where the question went.
        reason: `Belongs to “${intent.title}” — this intent should not claim it.`,
        source: 'route_here',
        createdAt: now,
        status: 'pending' as const,
        consumedAtVersion: null,
        consumedAt: null,
      };
      await tx
        .insert(scoreIntentPins)
        .values({ assignmentId: id, intentId: otherId, messageId: body.messageId, ...outSet })
        .onConflictDoUpdate({
          target: [scoreIntentPins.intentId, scoreIntentPins.messageId],
          set: outSet,
        });
    }
  });

  const titleById = new Map(
    (await db
      .select({ id: scoreIntents.id, title: scoreIntents.title })
      .from(scoreIntents)
      .where(and(eq(scoreIntents.assignmentId, id), inArray(scoreIntents.id, redirected.length ? redirected : [-1])))
    ).map((r) => [r.id, r.title])
  );
  return NextResponse.json({
    verdict: body.verdict,
    messageId: body.messageId,
    // Named, not just counted: the instructor needs to see that the OTHER
    // intent is what changed — that is where the question actually moves from.
    redirected: redirected.map((rid) => ({ intentId: rid, title: titleById.get(rid) ?? `Intent ${rid}` })),
  });
}

const patchSchema = z.object({
  /** Held corrections the definition now reproduces on its own — retire them.
   * The caller must have checked that against a FRESH rating (the workbench
   * does it after an Apply); this route only records the outcome. */
  retireMessageIds: z.array(z.number().int().positive()).min(1).max(500),
});

/**
 * PATCH → retire held corrections that the definition has caught up with.
 *
 * A held correction is scaffolding: it overrides the judgment because the
 * definition measurably could not reproduce the instructor's decision. Once a
 * later definition does, the override is no longer holding anything up, and
 * keeping it would quietly make the board show a routing the deployed chatbot
 * reaches by itself — the same drift consuming exists to prevent. Retiring
 * writes no version: nothing about the configuration changed, the definition
 * simply grew into a decision that was already being honoured.
 */
export async function PATCH(req: Request, { params }: RouteParams) {
  const { id, intentId: intentIdRaw } = await params;
  const auth = await authorizeAssignment(id);
  if ('error' in auth) {
    const { body, status } = authErrorResponse(auth.error);
    return NextResponse.json(body, { status });
  }
  const intent = await resolveIntent(id, intentIdRaw);
  if (!intent) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await req.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'invalid_input', details: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const retired = await db
    .update(scoreIntentPins)
    .set({ status: 'consumed', consumedAt: new Date(), consumedAtVersion: null })
    .where(
      and(
        eq(scoreIntentPins.assignmentId, id),
        eq(scoreIntentPins.intentId, intent.id),
        // HELD only. A pending correction has never been tried, so agreeing with
        // it proves nothing — it is waiting for a fold, not for a rating.
        eq(scoreIntentPins.status, 'held'),
        inArray(scoreIntentPins.messageId, body.retireMessageIds)
      )
    )
    .returning({ id: scoreIntentPins.id });

  return NextResponse.json({ retired: retired.length });
}

export async function DELETE(req: Request, { params }: RouteParams) {
  const { id, intentId: intentIdRaw } = await params;
  const auth = await authorizeAssignment(id);
  if ('error' in auth) {
    const { body, status } = authErrorResponse(auth.error);
    return NextResponse.json(body, { status });
  }
  const intent = await resolveIntent(id, intentIdRaw);
  if (!intent) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // ?all=1 → retire EVERY label of this intent at once. Used after the
  // definition has been rewritten from them (refine): the boundary knowledge now
  // lives in the definition text, and dropping the examples re-rates the log
  // against that definition alone — which is what proves it stands on its own.
  // Un-labeling (like labeling) does NOT record a version.
  const params_ = new URL(req.url).searchParams;
  if (params_.get('all') === '1') {
    const rows = await db
      .delete(scoreIntentPins)
      .where(eq(scoreIntentPins.intentId, intent.id))
      .returning({ id: scoreIntentPins.id });
    return NextResponse.json({ removed: rows.length });
  }

  const messageId = Number.parseInt(params_.get('messageId') ?? '', 10);
  if (!Number.isFinite(messageId)) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  // "Send here" is ONE action that writes two halves: the in-correction here and
  // an out/route_here on each intent that currently answers the question. So
  // withdrawing it withdraws both — otherwise the other half survives as a
  // standing instruction to narrow an intent for a redirect that no longer
  // exists, and it would be folded in silently the next time that intent is
  // updated. Only PENDING halves are touched: a consumed one is already part of
  // a definition and is now history, not an instruction.
  const result = await db.transaction(async (tx) => {
    const mineRows = await tx
      .delete(scoreIntentPins)
      .where(and(eq(scoreIntentPins.intentId, intent.id), eq(scoreIntentPins.messageId, messageId)))
      .returning({ verdict: scoreIntentPins.verdict });
    const withdrewIn = mineRows.some((r) => r.verdict === 'in');
    const paired = withdrewIn
      ? await tx
          .delete(scoreIntentPins)
          .where(
            and(
              eq(scoreIntentPins.assignmentId, id),
              eq(scoreIntentPins.messageId, messageId),
              eq(scoreIntentPins.source, 'route_here'),
              eq(scoreIntentPins.status, 'pending'),
              ne(scoreIntentPins.intentId, intent.id)
            )
          )
          .returning({ intentId: scoreIntentPins.intentId })
      : [];
    return { removed: mineRows.length > 0, alsoWithdrawn: paired.map((p) => p.intentId) };
  });

  return NextResponse.json({ ...result, messageId });
}
