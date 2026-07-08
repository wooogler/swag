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
import { scoreDissections, scoreQueryEmbeddings } from '@/db/schema';
import { MATERIAL_LABELS, type MaterialKind } from './intents';
import type { QueryRecord } from './queries';

// Env-overridable (SCORE_EMBEDDING_MODEL). Because the model name is part of
// EMBED_TAG below, changing it AUTO-INVALIDATES the cache — stored vectors from
// the old model are ignored and recomputed lazily on the next edge-case sweep.
export const EMBEDDING_MODEL = process.env.SCORE_EMBEDDING_MODEL || 'text-embedding-3-small';
// Cache marker stored in row.model — bump the suffix when the embed-INPUT scheme
// changes so stale rows recompute. matph-v2: the request text with pasted
// material replaced by its kind placeholder (the ask + the presence/kind of
// material, not the noisy pasted content).
const EMBED_TAG = `${EMBEDDING_MODEL}#matph-v2`;

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

/**
 * The text we embed: the message with pasted MATERIAL replaced by a short
 * placeholder (its kind) and the REQUEST(s) kept verbatim — so similarity
 * reflects the ASK plus the structural presence/kind of material, not the
 * material's noisy content. Falls back to the full message when there is no
 * usable dissection.
 */
export function buildEmbedText(
  queryText: string,
  dissection: { materialKinds: MaterialKind[]; requests: string[] } | null | undefined
): string {
  const requests = dissection?.requests ?? [];
  if (requests.length === 0) return queryText;
  const spans: { start: number; end: number }[] = [];
  let from = 0;
  for (const req of requests) {
    const q = req.trim();
    if (!q) continue;
    const idx = queryText.indexOf(q, from);
    if (idx === -1) continue;
    spans.push({ start: idx, end: idx + q.length });
    from = idx + q.length;
  }
  if (spans.length === 0) return queryText;
  const label =
    dissection && dissection.materialKinds.length
      ? dissection.materialKinds.map((k) => MATERIAL_LABELS[k]).join(' ')
      : 'material';
  const ph = `[${label}]`;
  const out: string[] = [];
  let cursor = 0;
  for (const s of spans) {
    if (s.start > cursor && queryText.slice(cursor, s.start).trim()) out.push(ph);
    out.push(queryText.slice(s.start, s.end));
    cursor = s.end;
  }
  if (cursor < queryText.length && queryText.slice(cursor).trim()) out.push(ph);
  return out.join(' ').replace(/\s+/g, ' ').trim();
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
    if (row.model === EMBED_TAG && Array.isArray(row.embedding)) {
      result.set(row.messageId, row.embedding as number[]);
    }
  }

  const missing = [...wanted.values()].filter((r) => !result.has(r.messageId));
  if (missing.length === 0) return result;

  // Dissections for the missing messages → build the placeholder embed text.
  const dissRows = await db
    .select({
      messageId: scoreDissections.messageId,
      materialKinds: scoreDissections.materialKinds,
      requests: scoreDissections.requests,
    })
    .from(scoreDissections)
    .where(inArray(scoreDissections.messageId, missing.map((r) => r.messageId)));
  const dissByMsg = new Map(
    dissRows.map((d) => [
      d.messageId,
      {
        materialKinds: (Array.isArray(d.materialKinds) ? d.materialKinds : []) as MaterialKind[],
        requests: (Array.isArray(d.requests) ? d.requests : []) as string[],
      },
    ])
  );

  const now = new Date();
  const writes: Promise<unknown>[] = [];
  for (let start = 0; start < missing.length; start += EMBED_BATCH_SIZE) {
    const chunk = missing.slice(start, start + EMBED_BATCH_SIZE);
    const response = await getClient().embeddings.create({
      model: EMBEDDING_MODEL,
      input: chunk.map((r) => embedText(buildEmbedText(r.queryText, dissByMsg.get(r.messageId)))),
    });
    for (const item of response.data) {
      const rec = chunk[item.index]; // index is chunk-relative
      if (!rec) continue;
      result.set(rec.messageId, item.embedding);
      const values = { embedding: item.embedding, model: EMBED_TAG, createdAt: now };
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
