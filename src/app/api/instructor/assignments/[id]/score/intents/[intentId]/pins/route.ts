/**
 * SCORE — DECISIONS for one intent.
 *
 * A decision is the instructor ruling on one question: it belongs here, or it
 * does not. It is PERMANENT. It waits as 'pending' until "Update definition"
 * writes a definition from it, and is then 'taught' — which does not mean
 * retired. The ruling stands, every later fold takes it along, and whether the
 * definition reproduces it is checked on every re-rating (see the ratings
 * route's `holds`). That is the point: a definition rewritten for one question
 * re-judges every question, and a decision that has left the record cannot
 * notice when it comes back the other way.
 *
 * POST   {messageId, verdict, reason?} → record/replace a decision. Ruling again
 *        on a question that already has one returns the row to 'pending' — you
 *        are teaching it again — and `taught_count` keeps the tally, which is
 *        how "this may belong to a different intent" becomes visible.
 * DELETE ?messageId=N → withdraw a decision.
 * DELETE ?all=1       → withdraw every decision of this intent.
 *
 * A decision does NOT enter any prompt and is NOT part of intentDefHash, so
 * recording one never makes ratings stale — the DEFINITION it produces does.
 * Recording one writes no version either: the fold that reads it does.
 */
import { NextResponse } from 'next/server';
import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/db';
import { scoreIntentPins, scoreIntentRatings, scoreIntents } from '@/db/schema';
import { authorizeAssignment, authErrorResponse } from '@/lib/score/authz';
import { logStudyEvent } from '@/lib/study/events';
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
  /**
   * Where the reason text came from: a suggestion taken as offered, one the
   * instructor edited, or their own words — and, for the first two, which of
   * the three it was.
   *
   * The client is the only place that knows. Recovering it afterwards by
   * matching the stored reason against the suggestion log is guesswork the
   * moment a word is changed, and the distinction matters: a boundary the
   * instructor articulated and one they accepted off a list are different
   * evidence for what they intended (RQ1), even though both fold identically.
   */
  reasonSource: z
    .object({
      kind: z.enum(['suggested', 'edited', 'custom']),
      index: z.number().int().min(0).max(9).optional(),
    })
    .optional(),
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
    // Ruling on a question always makes the decision PENDING again — including
    // over one a fold has already taken in, which is the "teach it again" case:
    // the definition that absorbed the last ruling evidently did not hold it.
    // `taught_count` is deliberately NOT reset (see the update below): how many
    // times a definition has lost the same decision is the signal that the
    // question may belong to a different intent rather than a wider version of
    // this one.
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
  // It DOES write a study event: the version history is where the study reads
  // configuration changes from, and a correction never reaches it, so without
  // this the act of teaching has no timestamp anywhere (STUDY_TRAIL_SPEC §2.1).
  const [priorPin] = await db
    .select({
      verdict: scoreIntentPins.verdict,
      status: scoreIntentPins.status,
      taughtCount: scoreIntentPins.taughtCount,
    })
    .from(scoreIntentPins)
    .where(and(eq(scoreIntentPins.intentId, intent.id), eq(scoreIntentPins.messageId, body.messageId)));
  // Teaching the same question again — the decision had been folded in, and the
  // definition has drifted back off it.
  const reteach = priorPin?.status === 'taught';
  // The judgement being overruled — newest row wins, which is the reading the
  // board shows when no row carries the current definition's hash.
  const [latestRating] = await db
    .select({ rating: scoreIntentRatings.rating, defHash: scoreIntentRatings.defHash })
    .from(scoreIntentRatings)
    .where(
      and(
        eq(scoreIntentRatings.assignmentId, id),
        eq(scoreIntentRatings.intentId, intent.id),
        eq(scoreIntentRatings.messageId, body.messageId)
      )
    )
    .orderBy(desc(scoreIntentRatings.ratedAt))
    .limit(1);
  const ratingAtPin = latestRating?.rating ?? null;

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

  await logStudyEvent(id, 'pin_set', {
    intentId: intent.id,
    messageId: body.messageId,
    verdict: body.verdict,
    source: set.source,
    hasReason: !!set.reason,
    replaced: !!priorPin,
    // A decision the definition had already been taught and lost. The count of
    // these, per intent, is the whack-a-mole the pilot could not see.
    reteach,
    taughtCount: priorPin?.taughtCount ?? 0,
    redirected: redirected.length,
    // The reason VERBATIM. score_intent_pins holds only the current one — a
    // question corrected twice overwrites the first reason and it is gone —
    // and the reason is what the fold actually consumes, so the event is the
    // only complete record of what was taught and when.
    reason: set.reason,
    reasonSource: body.reasonSource ?? null,
    priorVerdict: priorPin?.verdict ?? null,
    // What the classifier said at the moment it was overruled. This separates
    // the two acts the same button performs: CORRECTING a confident judge
    // (clearly_out → in) and SETTLING a boundary the judge was unsure of
    // (probably_in → in). Only the first is a disagreement.
    ratingOverruled: ratingAtPin,
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
    await logStudyEvent(id, 'pin_remove_all', { intentId: intent.id, count: rows.length });
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
  // Kept from inside the transaction: a withdrawal leaves no row anywhere, so
  // the verdict it removed survives only in the event (STUDY_TRAIL_SPEC §2.1).
  let verdictWas: string | null = null;
  const result = await db.transaction(async (tx) => {
    const mineRows = await tx
      .delete(scoreIntentPins)
      .where(and(eq(scoreIntentPins.intentId, intent.id), eq(scoreIntentPins.messageId, messageId)))
      .returning({ verdict: scoreIntentPins.verdict });
    const withdrewIn = mineRows.some((r) => r.verdict === 'in');
    verdictWas = mineRows[0]?.verdict ?? null;
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

  await logStudyEvent(id, 'pin_remove', {
    intentId: intent.id,
    messageId,
    verdictWas,
    alsoWithdrawn: result.alsoWithdrawn,
  });
  return NextResponse.json({ ...result, messageId });
}
