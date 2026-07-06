/**
 * SCORE v6 — query embeddings for the edge-case sweep (§1.10 ①의미 거리).
 *
 * One embedding per student message, computed lazily in a single batch call
 * the first time a sweep needs them and cached in score_query_embeddings.
 * After that, every Revise-modal sweep ranks candidates by cosine distance
 * from the anchor at zero API cost. Server-only module.
 */
import OpenAI from 'openai';
import { eq, inArray } from 'drizzle-orm';
import { db } from '@/db/db';
import { scoreQueryEmbeddings } from '@/db/schema';
import type { QueryRecord } from './queries';

export const EMBEDDING_MODEL = 'text-embedding-3-small';

/** Chars of query text embedded — long pasted essays add cost, not meaning,
 * beyond this (the request lives at the edges; keep head+tail like prompts.ts). */
const EMBED_TEXT_LIMIT = 2000;

function embedText(queryText: string): string {
  const t = queryText.trim();
  if (t.length <= EMBED_TEXT_LIMIT) return t;
  const head = Math.floor(EMBED_TEXT_LIMIT * 0.7);
  const tail = EMBED_TEXT_LIMIT - head;
  return `${t.slice(0, head)}\n…\n${t.slice(t.length - tail)}`;
}

let cachedClient: OpenAI | null = null;
function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured on the server.');
  if (!cachedClient) {
    // Embedding batches are quick; a hung request must not eat the calling
    // route's maxDuration (the sweep degrades gracefully without embeddings).
    cachedClient = new OpenAI({ apiKey, maxRetries: 2, timeout: 30_000 });
  }
  return cachedClient;
}

/** OpenAI caps one embeddings request at 2048 inputs (and ~300k total
 * tokens); chunk well below that so long logs and long texts both fit. */
const EMBED_BATCH_SIZE = 512;

/**
 * Return embeddings for the given messages, computing and caching any that
 * are missing (or that were produced by a different model) in ONE batch API
 * call. Returns messageId → vector; messages whose embedding failed are
 * simply absent (callers degrade to non-semantic ordering).
 */
export async function getQueryEmbeddings(
  assignmentId: string,
  records: QueryRecord[]
): Promise<Map<number, number[]>> {
  const wanted = new Map(records.map((r) => [r.messageId, r]));
  const result = new Map<number, number[]>();
  if (wanted.size === 0) return result;

  const cached = await db
    .select()
    .from(scoreQueryEmbeddings)
    .where(inArray(scoreQueryEmbeddings.messageId, [...wanted.keys()]));
  for (const row of cached) {
    if (row.model === EMBEDDING_MODEL && Array.isArray(row.embedding)) {
      result.set(row.messageId, row.embedding as number[]);
    }
  }

  const missing = [...wanted.values()].filter((r) => !result.has(r.messageId));
  if (missing.length === 0) return result;

  const now = new Date();
  const writes: Promise<unknown>[] = [];
  for (let start = 0; start < missing.length; start += EMBED_BATCH_SIZE) {
    const chunk = missing.slice(start, start + EMBED_BATCH_SIZE);
    const response = await getClient().embeddings.create({
      model: EMBEDDING_MODEL,
      input: chunk.map((r) => embedText(r.queryText)),
    });
    for (const item of response.data) {
      const rec = chunk[item.index]; // index is chunk-relative
      if (!rec) continue;
      result.set(rec.messageId, item.embedding);
      const values = { embedding: item.embedding, model: EMBEDDING_MODEL, createdAt: now };
      writes.push(
        db
          .insert(scoreQueryEmbeddings)
          .values({ assignmentId, messageId: rec.messageId, ...values })
          .onConflictDoUpdate({ target: scoreQueryEmbeddings.messageId, set: values })
      );
    }
  }
  await Promise.all(writes);
  return result;
}

/** Cosine similarity (embeddings are near-unit-norm; good enough for ranking). */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/** Drop stale embedding rows for messages no longer needed — not called
 * anywhere yet (logs are append-only); here for completeness. */
export async function deleteEmbeddings(assignmentId: string): Promise<void> {
  await db.delete(scoreQueryEmbeddings).where(eq(scoreQueryEmbeddings.assignmentId, assignmentId));
}
