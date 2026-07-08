/**
 * SCORE v6 — pin-based similarity ordering for the Intent modal (decision
 * propagation). GET → { scores: { [messageId]: number } } where
 *   score = max cosine to this intent's IN pins − max cosine to its OUT pins,
 * so undecided boundary questions sort toward the in/out side they most
 * resemble (a nearest-example vote from the instructor's own pins). The client
 * sorts by descending score (in-like on top, out-like at the bottom).
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

export async function GET(_req: Request, { params }: RouteParams) {
  const { id, intentId: intentIdRaw } = await params;
  const auth = await authorizeAssignment(id);
  if ('error' in auth) {
    const { body, status } = authErrorResponse(auth.error);
    return NextResponse.json(body, { status });
  }
  const intentId = Number.parseInt(intentIdRaw, 10);

  await Promise.all([ensureScoreTable(), ensureIntentTables()]);
  const records = await getQueryRecords(id);

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
