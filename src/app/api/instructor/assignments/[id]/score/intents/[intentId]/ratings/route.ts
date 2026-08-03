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
  scoreQueryTypes,
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
  compileChains,
  intentDefHash,
  isIncludedRating,
  isRatingLevel,
  isScoreQueryType,
  ratingRank,
  TYPE_CLASSIFIER_VERSION,
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
  let pinRows: { messageId: number; verdict: string; queryText: string; reason?: string | null }[] =
    state.pins.filter((p) => p.intentId === intentId);
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
    selectPromptPins(pinRows.map((p) => ({ verdict: p.verdict as 'in' | 'out', text: p.queryText, reason: p.reason })))
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

  // v7 SHADOWING: with first-match routing, two intents never "overlap" — an
  // earlier node in the same chain simply takes the question first, silently.
  // That is what this computes: for each question THIS intent matches, which
  // earlier chain node captures it instead. Starter-set templates are rated in
  // advance but own nothing, so they are not part of any chain.
  const typeRows = await db
    .select({
      messageId: scoreQueryTypes.messageId,
      type: scoreQueryTypes.type,
      version: scoreQueryTypes.version,
    })
    .from(scoreQueryTypes)
    .where(eq(scoreQueryTypes.assignmentId, id));
  const typeByMessage = new Map(
    typeRows.filter((t) => t.version >= TYPE_CLASSIFIER_VERSION).map((t) => [t.messageId, t.type])
  );

  const chainNodes = state.promptReady
    .filter((p) => !p.intent.isTemplate)
    .map((p) => ({
      id: p.intent.id,
      kind: 'intent' as const,
      type: p.intent.type,
      parentIntentId: p.intent.parentIntentId,
      position: p.intent.position,
    }));
  const chains = compileChains(chainNodes);
  // Nodes strictly BEFORE this intent in its own type's chain. An intent with
  // no type (pre-backfill) sits in no chain and can shadow nothing.
  const myChain = isScoreQueryType(intent.type) ? chains.get(intent.type) : undefined;
  const myIndex = myChain ? myChain.order.indexOf(intentId) : -1;
  const earlierIds = myChain && myIndex > 0 ? myChain.order.slice(0, myIndex) : [];
  // Wanted hash per intent: this intent's effective spec (live or checkout);
  // others their live hash. pickDisplayRatings then dedupes the hash-keyed rows.
  const wantedHash = new Map(state.promptReady.map((p) => [p.intent.id, p.defHash]));
  wantedHash.set(intentId, specHash);
  const byMessage = pickDisplayRatings(ratingRows, wantedHash);

  const pinByMessage = new Map(pinRows.map((p) => [p.messageId, p.verdict as 'in' | 'out']));
  const reasonByMessage = new Map(pinRows.map((p) => [p.messageId, p.reason ?? null]));
  // pinRows is already in the canonical prompt order (live: newest pin first,
  // per listPins; checkout: the snapshot's stored array order). Ship that index
  // so the client can reproduce selectPromptPins EXACTLY — its own row order is
  // by rating strength, which would pick a different, weaker-rated set of pins
  // than the classifier actually saw (preview = runtime, §1.9).
  const pinRankByMessage = new Map(pinRows.map((p, i) => [p.messageId, i]));

  // A typed intent can only ever own queries of ITS type — the chain it sits in
  // is per-type — so the workbench must not list the rest. Two ways they get
  // here otherwise: the route reads the whole log, and cloning a starter
  // template copies that template's WHOLE-LOG ratings (templates are rated
  // across everything on purpose, for the baseline's searches). An untyped
  // intent (pre-backfill) still sees everything: it is judged whole-log.
  const scopedRecords = isScoreQueryType(intent.type)
    ? records.filter((rec) => typeByMessage.get(rec.messageId) === intent.type)
    : records;

  const shadowCounts = new Map<number, number>();
  const rows = scopedRecords.map((rec) => {
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

    // Who takes this question BEFORE this intent gets a turn: the first earlier
    // chain node that matches. Stale ratings still count (same display
    // philosophy as classify force: show the previous state until overwritten);
    // instructor pins override the judgment (§1.6) but never the order.
    const earlierMap = new Map<number, RatingLevel>();
    for (const oid of earlierIds) {
      const r = ratings?.get(oid);
      if (r && isRatingLevel(r.row.rating)) earlierMap.set(oid, r.row.rating);
    }
    const earlierPins = new Map<number, 'in' | 'out'>();
    for (const p of state.pins) {
      if (p.messageId === rec.messageId && earlierIds.includes(p.intentId)) {
        earlierPins.set(p.intentId, p.verdict as 'in' | 'out');
      }
    }
    const effEarlier = applyPinOverrides(earlierMap, earlierPins);
    const shadowedBy = earlierIds.find((oid) => isIncludedRating(effEarlier.get(oid))) ?? null;

    // Only a question this intent would actually claim can BE shadowed.
    if (mineRating && isIncludedRating(mineRating) && shadowedBy !== null) {
      shadowCounts.set(shadowedBy, (shadowCounts.get(shadowedBy) ?? 0) + 1);
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
      /** Instructor's out-reason for this pin (out pins only; null otherwise). */
      reason: reasonByMessage.get(rec.messageId) ?? null,
      /** Position among this intent's pins in prompt order; null when unpinned. */
      pinRank: pinRankByMessage.get(rec.messageId) ?? null,
      /** The earlier chain node that takes this question first, if any — the
       * successor of v6's "prior owner". Null = nothing shadows it here. */
      shadowedBy,
      shadowedByTitle: shadowedBy !== null ? titleById.get(shadowedBy) ?? null : null,
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
    /** How many of the intent's type's queries exist at all — the denominator
     * the workbench's progress and counts are against. */
    scopeCount: scopedRecords.length,
    ratedCount: rows.filter((r) => r.rating !== null).length,
    staleCount: rows.filter((r) => r.stale).length,
    includedCount: rows.filter((r) => isIncludedRating(r.rating)).length,
    /** Earlier chain nodes intercepting questions this intent matches, biggest
     * first. Empty when nothing shadows it (the healthy case). */
    shadowedBy: [...shadowCounts.entries()]
      .map(([otherId, count]) => ({
        intentId: otherId,
        title: titleById.get(otherId) ?? `Intent ${otherId}`,
        count,
      }))
      .sort((a, b) => b.count - a.count),
    versionNo: state.versionNo,
  });
}
