/**
 * SCORE v6 — pin-based similarity ordering for the intent workbench (decision
 * propagation). GET → { scores: { [messageId]: number } } where
 *   score = max cosine to this intent's IN pins − max cosine to its OUT pins,
 * so undecided boundary questions sort toward the in/out side they most
 * resemble (a nearest-example vote from the instructor's own pins).
 *
 * The score is meaningful only as a RANKING — its zero is not the in/out
 * boundary, since each side is a max() that grows with the number of pins on it.
 * The client sorts each lean tab by this score directly (IntentWorkbench: the
 * 'in-like' sort puts the highest scores first, 'out-like' the lowest), so only
 * the order matters, never the absolute value.
 *
 * GET ?anchor=<messageId> switches modes: { scores } then holds the cosine of
 * every OTHER question to that anchor, so the "Add example" picker can order the
 * log by distance (farthest first) from the question being viewed and pre-select
 * the most-different few. Pins are irrelevant there, so it short-circuits before
 * the pin scoring — the baseline's prompt-holder intent uses it the same way.
 *
 * Embeddings are computed on the request text with material placeholders
 * (embeddings.ts) and cached; degrades to an empty map (client keeps its
 * default order) when embeddings or pins are unavailable.
 */
import { NextResponse } from 'next/server';
import { authorizeAssignment, authErrorResponse } from '@/lib/score/authz';
import { cosineSimilarity, getQueryEmbeddings } from '@/lib/score/embeddings';
import { ensureIntentTables, loadIntentState } from '@/lib/score/intent-store';
import { ensureScoreTable, getQueryRecords } from '@/lib/score/queries';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type RouteParams = { params: Promise<{ id: string; intentId: string }> };

export async function GET(req: Request, { params }: RouteParams) {
  const { id, intentId: intentIdRaw } = await params;
  const auth = await authorizeAssignment(id);
  if ('error' in auth) {
    const { body, status } = authErrorResponse(auth.error);
    return NextResponse.json(body, { status });
  }
  const intentId = Number.parseInt(intentIdRaw, 10);

  await Promise.all([ensureScoreTable(), ensureIntentTables()]);
  const records = await getQueryRecords(id);

  // ?anchor=<messageId> → cosine of every OTHER question to the anchor, so the
  // "Add example" picker orders the log by distance (farthest first) from the
  // question being viewed. Intent-independent (pins don't matter), so it
  // short-circuits the pin scoring; empty map (client keeps recency) when the
  // anchor has no embedding or the service is down.
  const anchorId = Number.parseInt(new URL(req.url).searchParams.get('anchor') ?? '', 10);
  if (Number.isFinite(anchorId)) {
    const anchorScores: Record<number, number> = {};
    try {
      const embeddings = await getQueryEmbeddings(id, records);
      const anchorVec = embeddings.get(anchorId);
      if (anchorVec) {
        for (const rec of records) {
          if (rec.messageId === anchorId) continue;
          const v = embeddings.get(rec.messageId);
          if (v) anchorScores[rec.messageId] = cosineSimilarity(anchorVec, v);
        }
      }
    } catch (error) {
      console.error('SCORE anchor-distance embeddings failed (keeping default order):', error);
    }
    return NextResponse.json({ scores: anchorScores });
  }

  const scores: Record<number, number> = {};
  let inCount = 0;
  let outCount = 0;
  try {
    const [embeddings, state] = await Promise.all([getQueryEmbeddings(id, records), loadIntentState(id)]);
    const pins = Number.isFinite(intentId) ? state.pins.filter((p) => p.intentId === intentId) : [];
    const vecs = (verdict: 'in' | 'out') =>
      pins
        .filter((p) => p.verdict === verdict)
        .map((p) => embeddings.get(p.messageId))
        .filter((v): v is number[] => Array.isArray(v));
    const inVecs = vecs('in');
    const outVecs = vecs('out');
    inCount = inVecs.length;
    outCount = outVecs.length;
    if (inVecs.length || outVecs.length) {
      for (const rec of records) {
        const v = embeddings.get(rec.messageId);
        if (!v) continue;
        const inS = inVecs.length ? Math.max(...inVecs.map((iv) => cosineSimilarity(v, iv))) : 0;
        const outS = outVecs.length ? Math.max(...outVecs.map((ov) => cosineSimilarity(v, ov))) : 0;
        scores[rec.messageId] = inS - outS;
      }
    }
  } catch (error) {
    console.error('SCORE pin-sort embeddings failed (keeping default order):', error);
  }
  return NextResponse.json({ inCount, outCount, scores });
}
