/**
 * SCORE v6 — one intent's ratings across the whole log (the New Intent
 * modal's "Matching Questions" panel, §2.3).
 *
 * For every question: this intent's rating (+rationale, staleness, pin
 * verdict) and the PRIOR resolution — the exclusive assignment computed over
 * every OTHER active intent. The prior owner is what the overlap banner
 * aggregates: questions this intent includes that some other intent already
 * owns are exactly the ownership decisions the instructor will face (§2.4).
 */
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db/db';
import { scoreIntentRatings, scoreIntents } from '@/db/schema';
import { authorizeAssignment, authErrorResponse } from '@/lib/score/authz';
import { ensureIntentTables, loadIntentState } from '@/lib/score/intent-store';
import {
  applyPinOverrides,
  isIncludedRating,
  isRatingLevel,
  ratingRank,
  resolveAssignment,
  type RatingLevel,
} from '@/lib/score/intents';
import { ensureScoreTable, getQueryRecords } from '@/lib/score/queries';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ id: string; intentId: string }> };

export async function GET(_req: Request, { params }: RouteParams) {
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

  await Promise.all([ensureScoreTable(), ensureIntentTables()]);
  const intentRows = await db
    .select()
    .from(scoreIntents)
    .where(and(eq(scoreIntents.id, intentId), eq(scoreIntents.assignmentId, id)));
  const intent = intentRows[0];
  if (!intent) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // state.pins carries EVERY pin of the assignment (needed for the prior-
  // resolution pin overrides); this intent's own pins come from the same set.
  const [state, records, ratingRows] = await Promise.all([
    loadIntentState(id),
    getQueryRecords(id),
    db.select().from(scoreIntentRatings).where(eq(scoreIntentRatings.assignmentId, id)),
  ]);
  const pinRows = state.pins.filter((p) => p.intentId === intentId);

  const thisReady = state.promptReady.find((p) => p.intent.id === intentId) ?? null;
  const otherReady = state.promptReady.filter((p) => p.intent.id !== intentId);
  const otherIds = otherReady.map((p) => p.intent.id);
  const currentHash = new Map(state.promptReady.map((p) => [p.intent.id, p.defHash]));

  // (message → intent → {rating, fresh}) for prior-resolution + this intent.
  const byMessage = new Map<number, Map<number, { rating: RatingLevel; fresh: boolean }>>();
  for (const r of ratingRows) {
    if (!isRatingLevel(r.rating)) continue;
    let m = byMessage.get(r.messageId);
    if (!m) {
      m = new Map();
      byMessage.set(r.messageId, m);
    }
    m.set(r.intentId, { rating: r.rating, fresh: r.defHash === currentHash.get(r.intentId) });
  }
  const ratingRowByMessage = new Map(
    ratingRows.filter((r) => r.intentId === intentId).map((r) => [r.messageId, r])
  );
  const pinByMessage = new Map(pinRows.map((p) => [p.messageId, p.verdict as 'in' | 'out']));

  const overlapCounts = new Map<number, number>();
  const rows = records.map((rec) => {
    const ratings = byMessage.get(rec.messageId);
    const mine = ratings?.get(intentId);
    const mineRow = ratingRowByMessage.get(rec.messageId);

    // Prior resolution: assignment over the OTHER intents only. Stale ratings
    // still count here (same display philosophy as classify force: show the
    // previous state until overwritten); instructor pins override (§1.6).
    const priorMap = new Map<number, RatingLevel>();
    for (const oid of otherIds) {
      const r = ratings?.get(oid);
      if (r) priorMap.set(oid, r.rating);
    }
    const priorPins = new Map<number, 'in' | 'out'>();
    for (const p of state.pins) {
      if (p.messageId === rec.messageId && otherIds.includes(p.intentId)) {
        priorPins.set(p.intentId, p.verdict as 'in' | 'out');
      }
    }
    const prior = resolveAssignment(applyPinOverrides(priorMap, priorPins), otherIds, state.links);

    if (mine && isIncludedRating(mine.rating) && prior.kind === 'assigned') {
      overlapCounts.set(prior.intentId, (overlapCounts.get(prior.intentId) ?? 0) + 1);
    }

    return {
      messageId: rec.messageId,
      queryText: rec.queryText,
      turnIndex: rec.turnIndex,
      queryTimestamp: rec.queryTimestamp.toISOString(),
      rating: mine?.rating ?? null,
      rationale: mineRow?.rationale ?? null,
      stale: !!mineRow && mineRow.defHash !== (thisReady?.defHash ?? ''),
      pinned: pinByMessage.get(rec.messageId) ?? null,
      prior:
        prior.kind === 'assigned'
          ? { kind: 'assigned' as const, intentId: prior.intentId }
          : { kind: prior.kind },
    };
  });

  // Strongest-in first, then recency — the cutline reading order (§1.6).
  rows.sort((a, b) => {
    const rank = ratingRank(a.rating) - ratingRank(b.rating);
    if (rank !== 0) return rank;
    return b.queryTimestamp.localeCompare(a.queryTimestamp);
  });

  const titleOf = new Map(state.intents.map((i) => [i.id, i.title]));
  return NextResponse.json({
    intent: {
      id: intent.id,
      title: intent.title,
      definition: intent.definition,
      rule: intent.rule,
      archived: intent.archived,
    },
    rows,
    ratedCount: rows.filter((r) => r.rating !== null).length,
    staleCount: rows.filter((r) => r.stale).length,
    includedCount: rows.filter((r) => isIncludedRating(r.rating)).length,
    overlaps: [...overlapCounts.entries()]
      .map(([otherId, count]) => ({
        intentId: otherId,
        title: titleOf.get(otherId) ?? `Intent ${otherId}`,
        count,
      }))
      .sort((a, b) => b.count - a.count),
    versionNo: state.versionNo,
  });
}
