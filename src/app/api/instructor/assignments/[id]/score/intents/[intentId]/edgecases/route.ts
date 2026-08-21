/**
 * SCORE v6 — edge-case sweep candidates for the Revise modal (§1.10).
 *
 * GET ?anchor=<messageId> → up to 3 questions from THIS intent's group,
 * ordered by where a rule change is most likely to break something:
 *  ① farthest — max cosine distance from the anchor (over-generalization
 *    check; embeddings batch-computed once, then free),
 *  ② boundary — barely-in questions (effective rating probably_in),
 *  ③ recent — the newest question not already picked.
 * The third v6 signal (③변화 크기) needs the after-previews, so the CLIENT
 * ranks by response delta once it has generated both sides.
 *
 * Zero LLM calls (one embeddings batch on first use per assignment).
 */
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db/db';
import { scoreIntentRatings, scoreIntents, scoreQueryTypes } from '@/db/schema';
import { authorizeAssignment, authErrorResponse } from '@/lib/score/authz';
import { refuseSimpleClone } from '@/lib/study/simple/route-context';
import { cosineSimilarity, getQueryEmbeddings } from '@/lib/score/embeddings';
import { ensureIntentTables, loadIntentState, pickDisplayRatings } from '@/lib/score/intent-store';
import {
  compileChains,
  isRatingLevel,
  isScoreQueryType,
  resolveRoute,
  TYPE_CLASSIFIER_VERSION,
  type RatingLevel,
} from '@/lib/score/intents';
import { ensureScoreTable, getQueryRecords } from '@/lib/score/queries';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export type EdgeCaseReason = 'farthest' | 'boundary' | 'recent';

export async function GET(req: Request, { params }: { params: Promise<{ id: string; intentId: string }> }) {
  const { id, intentId: intentIdRaw } = await params;
  const auth = await authorizeAssignment(id);
  if ('error' in auth) {
    const { body, status } = authErrorResponse(auth.error);
    return NextResponse.json(body, { status });
  }
  // Not on a simple clone: that version has none of this, and letting it
  // through would write a second, disagreeing answer to "what is this
  // participant's configuration" (lib/study/simple/route-context).
  const wrongVersion = await refuseSimpleClone(id);
  if (wrongVersion) return wrongVersion;
  const intentId = Number.parseInt(intentIdRaw, 10);
  const anchorId = Number.parseInt(new URL(req.url).searchParams.get('anchor') ?? '', 10);
  if (!Number.isFinite(intentId)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  await Promise.all([ensureScoreTable(), ensureIntentTables()]);
  const intents = await db
    .select()
    .from(scoreIntents)
    .where(and(eq(scoreIntents.assignmentId, id), eq(scoreIntents.id, intentId)));
  if (!intents[0] || intents[0].archived) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const [state, records, ratingRows] = await Promise.all([
    loadIntentState(id),
    getQueryRecords(id),
    db.select().from(scoreIntentRatings).where(eq(scoreIntentRatings.assignmentId, id)),
  ]);
  // v7 routing: the chain of this intent's type decides ownership. Starter-set
  // templates are rated but own nothing, so they are not chain nodes.
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
  const intent = intents[0];
  const myChain = isScoreQueryType(intent.type) ? chains.get(intent.type) ?? null : null;
  // An untyped intent sits in no chain and owns nothing — the sweep has no
  // group to draw from, so return early rather than scanning the whole log.
  if (!myChain) return NextResponse.json({ cases: [] });
  // Candidates are drawn from this intent's own type only (§3.4): a query of
  // another type can never reach this chain.
  const typeRows = await db
    .select({ messageId: scoreQueryTypes.messageId, type: scoreQueryTypes.type, version: scoreQueryTypes.version })
    .from(scoreQueryTypes)
    .where(eq(scoreQueryTypes.assignmentId, id));
  const typeByMessage = new Map(
    typeRows.filter((t) => t.version >= TYPE_CLASSIFIER_VERSION).map((t) => [t.messageId, t.type])
  );

  // Questions currently ASSIGNED to this intent (effective, pins applied) —
  // the rule's exact application scope (§4.2 find→fix duality). Ratings are
  // hash-keyed history: dedupe to one display row per (message, intent).
  const currentHash = new Map(state.promptReady.map((p) => [p.intent.id, p.defHash]));
  const displayRatings = pickDisplayRatings(ratingRows, currentHash);
  const ratingsByMessage = new Map<number, Map<number, RatingLevel>>();
  for (const [messageId, perIntent] of displayRatings) {
    const m = new Map<number, RatingLevel>();
    for (const [iid, pick] of perIntent) {
      if (isRatingLevel(pick.row.rating)) m.set(iid, pick.row.rating);
    }
    ratingsByMessage.set(messageId, m);
  }
  const pinsByMessage = new Map<number, Map<number, 'in' | 'out'>>();
  for (const p of state.pins) {
    let m = pinsByMessage.get(p.messageId);
    if (!m) {
      m = new Map();
      pinsByMessage.set(p.messageId, m);
    }
    m.set(p.intentId, p.verdict as 'in' | 'out');
  }

  const group = records.filter((rec) => {
    // Out-of-type (or not-yet-typed) messages never walk this chain.
    if (typeByMessage.get(rec.messageId) !== intent.type) return false;
    // Judgment alone — the deployed chatbot routes from definitions, so a
    // correction must not make this group show questions the runtime would
    // send elsewhere.
    const res = resolveRoute(myChain, ratingsByMessage.get(rec.messageId) ?? new Map());
    return res.kind === 'matched' && res.intentId === intentId;
  });

  const candidates = group.filter((r) => r.messageId !== anchorId);
  if (candidates.length === 0) {
    return NextResponse.json({ cases: [] });
  }

  // ?farthest=N → just the N semantically-farthest in-group questions (the
  // Revise modal's edge-case tabs). Falls back to most-recent N if embeddings
  // are unavailable — the button never blocks on the embedding service.
  const farthestN = Number.parseInt(new URL(req.url).searchParams.get('farthest') ?? '', 10);
  if (Number.isFinite(farthestN) && farthestN > 0) {
    let chosen = [...candidates]
      .sort((x, y) => y.queryTimestamp.getTime() - x.queryTimestamp.getTime())
      .slice(0, farthestN);
    try {
      const anchorRec = records.find((r) => r.messageId === anchorId);
      if (anchorRec) {
        const embeddings = await getQueryEmbeddings(id, [anchorRec, ...candidates]);
        const anchorVec = embeddings.get(anchorRec.messageId);
        if (anchorVec) {
          chosen = candidates
            .filter((c) => embeddings.has(c.messageId))
            .sort(
              (x, y) =>
                cosineSimilarity(anchorVec, embeddings.get(x.messageId)!) -
                cosineSimilarity(anchorVec, embeddings.get(y.messageId)!)
            )
            .slice(0, farthestN);
        }
      }
    } catch (error) {
      console.error('SCORE farthest edge-cases embeddings failed (falling back to recency):', error);
    }
    return NextResponse.json({
      cases: chosen.map((c) => ({ messageId: c.messageId, queryText: c.queryText, reason: 'farthest' as const })),
    });
  }

  const picked: { messageId: number; queryText: string; reason: EdgeCaseReason }[] = [];
  const taken = new Set<number>();
  const take = (rec: (typeof candidates)[number] | undefined, reason: EdgeCaseReason) => {
    if (!rec || taken.has(rec.messageId)) return;
    taken.add(rec.messageId);
    picked.push({ messageId: rec.messageId, queryText: rec.queryText, reason });
  };

  // ① farthest by embedding from the anchor (skip silently if embeddings
  // fail — the sweep degrades to the other signals, never blocks).
  try {
    const anchorRec = records.find((r) => r.messageId === anchorId);
    if (anchorRec) {
      const embeddings = await getQueryEmbeddings(id, [anchorRec, ...candidates]);
      const anchorVec = embeddings.get(anchorRec.messageId);
      if (anchorVec) {
        const farthest = candidates
          .filter((c) => embeddings.has(c.messageId))
          .sort(
            (x, y) =>
              cosineSimilarity(anchorVec, embeddings.get(x.messageId)!) -
              cosineSimilarity(anchorVec, embeddings.get(y.messageId)!)
          )[0];
        take(farthest, 'farthest');
      }
    }
  } catch (error) {
    console.error('SCORE edge-case embeddings failed (degrading to non-semantic picks):', error);
  }

  // ② boundary — barely in: effective rating probably_in (a pin is a settled
  // decision, so pinned questions don't count as boundary).
  const boundary = candidates.find(
    (c) =>
      !taken.has(c.messageId) &&
      pinsByMessage.get(c.messageId)?.get(intentId) === undefined &&
      ratingsByMessage.get(c.messageId)?.get(intentId) === 'probably_in'
  );
  take(boundary, 'boundary');

  // ③ recent — newest question not already picked.
  const recent = [...candidates]
    .filter((c) => !taken.has(c.messageId))
    .sort((x, y) => y.queryTimestamp.getTime() - x.queryTimestamp.getTime())[0];
  take(recent, 'recent');

  return NextResponse.json({ cases: picked });
}
