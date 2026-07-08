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
import {
  scoreConfigVersions,
  scoreDissections,
  scoreIntentRatings,
  scoreIntents,
} from '@/db/schema';
import { authorizeAssignment, authErrorResponse } from '@/lib/score/authz';
import {
  ensureIntentTables,
  loadIntentState,
  pickDisplayRatings,
  type IntentConfigSnapshot,
} from '@/lib/score/intent-store';
import {
  applyPinOverrides,
  intentDefHash,
  isIncludedRating,
  isRatingLevel,
  ratingRank,
  resolveAssignment,
  selectPromptPins,
  type RatingLevel,
} from '@/lib/score/intents';
import { ensureScoreTable, getQueryRecords } from '@/lib/score/queries';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ id: string; intentId: string }> };

export async function GET(req: Request, { params }: RouteParams) {
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
  // Version checkout: ?versionNo=N renders THIS INTENT as of that config
  // version — its definition/title/pins from the snapshot, and the rating rows
  // stored for that spec's hash (instant; no LLM).
  const versionNoRaw = new URL(req.url).searchParams.get('versionNo');
  const checkoutNo = versionNoRaw ? Number.parseInt(versionNoRaw, 10) : null;

  await Promise.all([ensureScoreTable(), ensureIntentTables()]);
  const intentRows = await db
    .select()
    .from(scoreIntents)
    .where(and(eq(scoreIntents.id, intentId), eq(scoreIntents.assignmentId, id)));
  const intent = intentRows[0];
  if (!intent) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // state.pins carries EVERY pin of the assignment (needed for the prior-
  // resolution pin overrides); this intent's own pins come from the same set.
  const [state, records, ratingRows, dissectionRows] = await Promise.all([
    loadIntentState(id),
    getQueryRecords(id),
    db.select().from(scoreIntentRatings).where(eq(scoreIntentRatings.assignmentId, id)),
    db
      .select({
        messageId: scoreDissections.messageId,
        materialKinds: scoreDissections.materialKinds,
        requests: scoreDissections.requests,
      })
      .from(scoreDissections)
      .where(eq(scoreDissections.assignmentId, id)),
  ]);

  // Effective spec for THIS intent: live, or the checked-out version's.
  let specTitle = intent.title;
  let specDefinition = intent.definition;
  let pinRows: { messageId: number; verdict: string; queryText: string }[] = state.pins.filter(
    (p) => p.intentId === intentId
  );
  if (checkoutNo !== null) {
    if (!Number.isFinite(checkoutNo)) {
      return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
    }
    const versionRows = await db
      .select({ snapshot: scoreConfigVersions.snapshot })
      .from(scoreConfigVersions)
      .where(
        and(eq(scoreConfigVersions.assignmentId, id), eq(scoreConfigVersions.versionNo, checkoutNo))
      );
    const snapshot = versionRows[0]?.snapshot as IntentConfigSnapshot | undefined;
    const snapIntent = snapshot?.intents?.find((i) => i.id === intentId);
    if (!snapshot || !snapIntent) {
      return NextResponse.json({ error: 'version_not_found' }, { status: 404 });
    }
    specTitle = snapIntent.title;
    specDefinition = snapIntent.definition;
    pinRows = (snapshot.pins ?? []).filter((p) => p.intentId === intentId);
  }
  const titleById = new Map(state.intents.map((i) => [i.id, i.title]));
  const specHash = intentDefHash(
    specDefinition,
    selectPromptPins(pinRows.map((p) => ({ verdict: p.verdict as 'in' | 'out', text: p.queryText })))
  );
  // Message dissection (Material vs Request) so the viewer can, on expand, show
  // the request(s) verbatim and collapse pasted material into a placeholder.
  const dissectionByMessage = new Map(
    dissectionRows.map((d) => [
      d.messageId,
      {
        materialKinds: (Array.isArray(d.materialKinds) ? d.materialKinds : []) as string[],
        requests: (Array.isArray(d.requests) ? d.requests : []) as string[],
      },
    ])
  );

  // Overlap/ownership only concerns ACTIVE intents — starter-set templates are
  // rated in advance but don't own the log, so exclude them here.
  const otherReady = state.promptReady.filter(
    (p) => p.intent.id !== intentId && !p.intent.isTemplate
  );
  const otherIds = otherReady.map((p) => p.intent.id);
  // Wanted hash per intent: this intent's effective spec (live or checkout);
  // others their live hash. pickDisplayRatings then dedupes the hash-keyed rows.
  const wantedHash = new Map(state.promptReady.map((p) => [p.intent.id, p.defHash]));
  wantedHash.set(intentId, specHash);
  const byMessage = pickDisplayRatings(ratingRows, wantedHash);

  const pinByMessage = new Map(pinRows.map((p) => [p.messageId, p.verdict as 'in' | 'out']));

  const overlapCounts = new Map<number, number>();
  const rows = records.map((rec) => {
    const ratings = byMessage.get(rec.messageId);
    const minePick = ratings?.get(intentId);
    // Under checkout only EXACT spec rows count — a version view must never mix
    // in ratings produced by a different definition/pin set.
    const mineRow =
      minePick && (checkoutNo === null || minePick.fresh) && isRatingLevel(minePick.row.rating)
        ? minePick.row
        : null;
    const mineFresh = !!minePick?.fresh && mineRow !== null;
    const mineRating = mineRow && isRatingLevel(mineRow.rating) ? mineRow.rating : null;

    // Prior resolution: assignment over the OTHER intents only. Stale ratings
    // still count here (same display philosophy as classify force: show the
    // previous state until overwritten); instructor pins override (§1.6).
    const priorMap = new Map<number, RatingLevel>();
    for (const oid of otherIds) {
      const r = ratings?.get(oid);
      if (r && isRatingLevel(r.row.rating)) priorMap.set(oid, r.row.rating);
    }
    const priorPins = new Map<number, 'in' | 'out'>();
    for (const p of state.pins) {
      if (p.messageId === rec.messageId && otherIds.includes(p.intentId)) {
        priorPins.set(p.intentId, p.verdict as 'in' | 'out');
      }
    }
    const prior = resolveAssignment(applyPinOverrides(priorMap, priorPins), otherIds, state.links);

    if (mineRating && isIncludedRating(mineRating) && prior.kind === 'assigned') {
      overlapCounts.set(prior.intentId, (overlapCounts.get(prior.intentId) ?? 0) + 1);
    }

    return {
      messageId: rec.messageId,
      queryText: rec.queryText,
      // The previous student question — shown as context in the expand view.
      // (The rating also uses the prior chatbot reply server-side, but it's
      // verbose, so the viewer omits it.)
      prevQueryText: rec.prevQueryText ?? null,
      turnIndex: rec.turnIndex,
      queryTimestamp: rec.queryTimestamp.toISOString(),
      rating: mineRating,
      rationale: mineRow?.rationale ?? null,
      stale: !!mineRow && !mineFresh,
      pinned: pinByMessage.get(rec.messageId) ?? null,
      prior:
        prior.kind === 'assigned'
          ? { kind: 'assigned' as const, intentId: prior.intentId }
          : { kind: prior.kind },
      // Title of the intent that currently owns this question (assigned only).
      priorTitle: prior.kind === 'assigned' ? titleById.get(prior.intentId) ?? null : null,
      dissection: dissectionByMessage.get(rec.messageId) ?? null,
    };
  });

  // Strongest-in first, then recency — the cutline reading order (§1.6).
  rows.sort((a, b) => {
    const rank = ratingRank(a.rating) - ratingRank(b.rating);
    if (rank !== 0) return rank;
    return b.queryTimestamp.localeCompare(a.queryTimestamp);
  });

  return NextResponse.json({
    intent: {
      id: intent.id,
      title: specTitle,
      definition: specDefinition,
      rule: intent.rule,
      archived: intent.archived,
    },
    checkoutVersionNo: checkoutNo,
    rows,
    ratedCount: rows.filter((r) => r.rating !== null).length,
    staleCount: rows.filter((r) => r.stale).length,
    includedCount: rows.filter((r) => isIncludedRating(r.rating)).length,
    overlaps: [...overlapCounts.entries()]
      .map(([otherId, count]) => ({
        intentId: otherId,
        title: titleById.get(otherId) ?? `Intent ${otherId}`,
        count,
      }))
      .sort((a, b) => b.count - a.count),
    versionNo: state.versionNo,
  });
}
