/**
 * SCORE v6 — Boundary Examples (pins) for one intent.
 *
 * POST   {messageId, verdict} → pin an in/out verdict (upsert; re-pinning
 *        flips the verdict and refreshes recency, which moves the pin to the
 *        head of the prompt's latest-first listing).
 * DELETE ?messageId=N → unpin.
 * DELETE ?all=1       → retire every label of this intent (post-refine).
 *
 * EVERY pin goes into the rating prompt (no cap — selectPromptPins), so any pin
 * change moves the intent's defHash and its ratings read as stale — the UI
 * offers a re-rate.
 * Labeling does NOT record a version: the label set is snapshotted on the next
 * Apply/Save, so the history is one entry per Apply, not one per label.
 */
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/db';
import { scoreIntentPins, scoreIntentRatings, scoreIntents } from '@/db/schema';
import { authorizeAssignment, authErrorResponse } from '@/lib/score/authz';
import {
  ensureIntentTables,
  getAssignmentMessageText,
  loadIntentState,
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
  /** Optional out-pin rationale — stored and injected into the rating prompt.
   * Ignored for 'in' pins. */
  reason: z.string().trim().max(400).optional(),
  /** v7 "send this question here": an IN pin fixes this intent's judgment but
   * not the routing — an EARLIER set in the same chain still answers first. With
   * this flag the server also pins the question OUT of every earlier set that
   * currently matches it, in one transaction, so the question really lands here. */
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
    // A reason only makes sense for an OUT example; clear it on an 'in' pin so a
    // question flipped in→out→in never carries a stale rationale.
    reason: body.verdict === 'out' ? body.reason?.trim() || null : null,
    source: body.source ?? 'manual',
    createdAt: now, // refresh recency so re-pinned examples lead the prompt
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
        .select({ intentId: scoreIntentRatings.intentId, rating: scoreIntentRatings.rating, defHash: scoreIntentRatings.defHash })
        .from(scoreIntentRatings)
        .where(
          and(
            eq(scoreIntentRatings.assignmentId, id),
            eq(scoreIntentRatings.messageId, body.messageId)
          )
        );
      const wanted = new Map(state.promptReady.map((p) => [p.intent.id, p.defHash]));
      const ratingByIntent = new Map<number, string>();
      for (const r of ratingRows) {
        if (wanted.get(r.intentId) === r.defHash) ratingByIntent.set(r.intentId, r.rating);
      }
      const pinByIntent = new Map(
        state.pins.filter((pin) => pin.messageId === body.messageId).map((pin) => [pin.intentId, pin.verdict])
      );
      redirected = earlier.filter((oid) => {
        const pin = pinByIntent.get(oid);
        if (pin) return pin === 'in';
        const rating = ratingByIntent.get(oid);
        return isRatingLevel(rating) && isIncludedRating(rating);
      });
    }
  }

  // Labeling does NOT record a version — the label set is captured on the next
  // Apply/Save (its snapshot's pins), so the history stays one entry per Apply.
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
        reason: `Answered by “${intent.title}” instead.`,
        source: 'route_here',
        createdAt: now,
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

  return NextResponse.json({ verdict: body.verdict, messageId: body.messageId, redirected });
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

  const rows = await db
    .delete(scoreIntentPins)
    .where(and(eq(scoreIntentPins.intentId, intent.id), eq(scoreIntentPins.messageId, messageId)))
    .returning({ queryText: scoreIntentPins.queryText });

  return NextResponse.json({ removed: rows.length > 0, messageId });
}
