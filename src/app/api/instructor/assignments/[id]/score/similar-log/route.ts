/**
 * Nearest log queries to an anchor by embedding cosine (ranking only, no grades)
 * — the baseline review set's "similar questions" suggestions. Embeddings are
 * cloned, so this is cache-only (no LLM). Spec §5.5.
 */
import { NextResponse } from 'next/server';
import { authorizeAssignment, authErrorResponse } from '@/lib/score/authz';
import { ensureScoreTable, getQueryRecords } from '@/lib/score/queries';
import { ensureIntentTables } from '@/lib/score/intent-store';
import { cosineSimilarity, getQueryEmbeddings } from '@/lib/score/embeddings';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorizeAssignment(id);
  if ('error' in auth) {
    const { body, status } = authErrorResponse(auth.error);
    return NextResponse.json(body, { status });
  }
  await Promise.all([ensureScoreTable(), ensureIntentTables()]);

  const url = new URL(request.url);
  const messageId = Number(url.searchParams.get('messageId'));
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 15, 1), 50);
  if (!Number.isFinite(messageId)) return NextResponse.json({ error: 'missing_messageId' }, { status: 400 });

  const records = await getQueryRecords(id);
  const embs = await getQueryEmbeddings(id, records);
  const anchorEmb = embs.get(messageId);
  if (!anchorEmb) return NextResponse.json({ similar: [] });

  const scored = records
    .filter((r) => r.messageId !== messageId && embs.has(r.messageId))
    .map((r) => ({ messageId: r.messageId, queryText: r.queryText, similarity: cosineSimilarity(anchorEmb, embs.get(r.messageId)!) }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
  return NextResponse.json({ similar: scored });
}
