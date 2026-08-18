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
  compileChains,
  intentDefHash,
  isIncludedRating,
  isRatingLevel,
  isScoreQueryType,
  ratingRank,
  TYPE_CLASSIFIER_VERSION,
  type MaterialSpan,
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
        materials: scoreDissections.materials,
      })
      .from(scoreDissections)
      .where(eq(scoreDissections.assignmentId, id)),
  ]);

  // Effective spec for THIS intent: live, or the checked-out version's.
  let specTitle = intent.title;
  let specDefinition = intent.definition;
  // Live rows carry the correction fields; a version snapshot's do not (it
  // predates them, and a checkout is read-only anyway — nothing there is
  // consumable, so a missing id simply means "not actionable").
  let pinRows: {
    id?: number;
    messageId: number;
    verdict: string;
    queryText: string;
    reason?: string | null;
    status?: string;
    consumedAtVersion?: number | null;
    taughtCount?: number;
  }[] = state.pins.filter((p) => p.intentId === intentId);
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
  const specHash = intentDefHash(specDefinition);
  // Message dissection (Material vs Request) so the viewer can, on expand, show
  // the request(s) verbatim and collapse pasted material into a placeholder.
  const dissectionByMessage = new Map(
    dissectionRows.map((d) => [
      d.messageId,
      {
        materialKinds: (Array.isArray(d.materialKinds) ? d.materialKinds : []) as string[],
        requests: (Array.isArray(d.requests) ? d.requests : []) as string[],
        materials: (Array.isArray(d.materials) ? d.materials : []) as MaterialSpan[],
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

  // Every decision this instructor has made about this intent, in one map.
  //
  // There is no split any more. A decision used to leave the ledger the moment
  // a fold carried it ('consumed'), which made it a receipt rather than a
  // claim: the definition was free to drift back off it, and the drift showed
  // up only as one line inside a row that nobody was counting. Now a decision
  // is either PENDING (made, not folded yet — changes nothing on its own) or
  // TAUGHT (a fold has taken it in at least once), and both stay checkable
  // forever. Whether the definition actually reproduces it is `holds`, computed
  // below from the rating rather than stored, because a stored answer goes
  // stale the moment the next re-rating disagrees with it.
  const decisionByMessage = new Map<
    number,
    {
      id: number | null;
      verdict: 'in' | 'out';
      reason: string | null;
      status: 'pending' | 'taught';
      taughtAtVersion: number | null;
      taughtCount: number;
    }
  >();
  for (const p of pinRows) {
    decisionByMessage.set(p.messageId, {
      id: p.id ?? null,
      verdict: p.verdict as 'in' | 'out',
      reason: p.reason ?? null,
      status: p.status === 'pending' ? 'pending' : 'taught',
      taughtAtVersion: p.consumedAtVersion ?? null,
      taughtCount: p.taughtCount ?? 0,
    });
  }

  /**
   * What this intent's workbench SHOWS. Judgment is unchanged — every set is
   * rated against its whole type — but the list is the questions this set could
   * actually end up owning:
   *   · a top-level set  → its type's questions
   *   · a subset         → the questions its enclosing sets matched, because
   *                        routing now guarantees containment (resolveRoute)
   * Without this a subset lists questions it can never win, and (when it was
   * cloned from a starter template, whose ratings are whole-log by design for
   * the baseline's searches) it arrives pre-filled with hundreds of them.
   * An untyped intent (pre-backfill) still sees everything — it is judged
   * whole-log and sits in no chain.
   */
  const ancestorIds = myChain?.ancestorsOf.get(intentId) ?? [];
  const effectiveRating = (messageId: number, id: number): RatingLevel | null => {
    const pin = state.pins.find((p) => p.messageId === messageId && p.intentId === id);
    if (pin) return pin.verdict === 'in' ? 'clearly_in' : 'clearly_out';
    const r = byMessage.get(messageId)?.get(id);
    return r && isRatingLevel(r.row.rating) ? r.row.rating : null;
  };
  const inAncestors = (messageId: number) =>
    ancestorIds.every((aid) => isIncludedRating(effectiveRating(messageId, aid)));

  const typeScoped = isScoreQueryType(intent.type)
    ? records.filter((rec) => typeByMessage.get(rec.messageId) === intent.type)
    : records;
  const scopedRecords = ancestorIds.length > 0 ? typeScoped.filter((rec) => inAncestors(rec.messageId)) : typeScoped;

  /** Questions this set matches that its enclosing sets do NOT — containment
   * means it can never win them. Not listed (they are outside the scope the
   * instructor is working in), but counted, because the fix is to widen the
   * parent or move this set out, and silence would hide that. */
  const outsideParent =
    ancestorIds.length > 0
      ? typeScoped.filter(
          (rec) =>
            !inAncestors(rec.messageId) &&
            isIncludedRating(effectiveRating(rec.messageId, intentId))
        ).length
      : 0;

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
    // Interception is decided by the JUDGMENT alone now. A correction used to
    // override an earlier intent's verdict here, which quietly made the board
    // show a routing that the deployed chatbot — judging from definitions —
    // would not reproduce. The fix for an unwanted interception is to narrow
    // the earlier intent's definition (see the send-here flow), not to hide it.
    const earlierMap = new Map<number, RatingLevel>();
    for (const oid of earlierIds) {
      const r = ratings?.get(oid);
      if (r && isRatingLevel(r.row.rating)) earlierMap.set(oid, r.row.rating);
    }
    const shadowedBy = earlierIds.find((oid) => isIncludedRating(earlierMap.get(oid))) ?? null;

    // Only a question this intent would actually claim can BE shadowed.
    if (mineRating && isIncludedRating(mineRating) && shadowedBy !== null) {
      shadowCounts.set(shadowedBy, (shadowCounts.get(shadowedBy) ?? 0) + 1);
    }

    const found = decisionByMessage.get(rec.messageId) ?? null;
    const decision = found
      ? {
          ...found,
          /**
           * Does the definition reproduce this ruling on its own?
           *
           * true — the text says it. false — the text has drifted off it, and
           * (until it catches up) this decision is what routes the question.
           * null — nothing fresh to check against: unrated, or rated under a
           * definition that has since changed, so the last answer is about
           * text that no longer exists.
           */
          holds:
            mineRating === null || (!!mineRow && !mineFresh)
              ? null
              : (found.verdict === 'in') === isIncludedRating(mineRating),
        }
      : null;
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
      /** A correction still in force on this question — the instructor overruled
       * the judge and the definition does not carry it yet. Null otherwise. */
      // LEGACY VIEW of the same decision, derived rather than stored — the
      // workbench still reads these three, and switches to `decision` next.
      // 'held' has always meant "taught and not reproduced", which is now a
      // computation instead of a state, so the mapping is exact and the
      // override behaviour is unchanged.
      pinned: decision && (decision.status === 'pending' || decision.holds === false)
        ? decision.verdict
        : null,
      pinStatus: decision
        ? decision.status === 'pending'
          ? ('pending' as const)
          : decision.holds === false
            ? ('held' as const)
            : null
        : null,
      correctionId: decision?.id ?? null,
      marker:
        decision && decision.status === 'taught' && decision.holds !== false
          ? { verdict: decision.verdict, versionNo: decision.taughtAtVersion }
          : null,
      /** Why they ruled that way (asked only when it disagreed with the judge). */
      reason: decision?.reason ?? null,
      /**
       * The instructor's standing ruling on this question, or null.
       *
       * `holds` is the whole point: true when the definition reproduces the
       * decision on its own, false when it has drifted off it, null when there
       * is nothing fresh to check against (unrated, or rated under a definition
       * that has since changed). A false is what the workbench counts, what
       * routes the question the instructor's way meanwhile, and what makes
       * "this question may belong somewhere else" a visible thought.
       */
      decision,
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
    /** null for a top-level set; for a subset, how many of its matches sit
     * outside its enclosing sets and are therefore unreachable. */
    outsideParent: ancestorIds.length > 0 ? outsideParent : null,
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
