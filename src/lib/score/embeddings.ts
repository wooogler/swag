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
import {
  DISSECTION_VERSION,
  type DissectionResult,
  type MaterialKind,
  type MaterialSpan,
} from './intents';
import { abridgeQuery } from './prompts';
import type { QueryRecord } from './queries';

// Env-overridable (SCORE_EMBEDDING_MODEL). Because the model name is part of
// EMBED_TAG below, changing it AUTO-INVALIDATES the cache — stored vectors from
// the old model are ignored and recomputed lazily on the next edge-case sweep.
export const EMBEDDING_MODEL = process.env.SCORE_EMBEDDING_MODEL || 'text-embedding-3-small';
// Cache marker stored in row.model — bump the suffix when the embed-INPUT scheme
// changes so stale rows recompute. judgeq: the message EXACTLY as the classifier
// reads it (see buildEmbedText). The dissection version is in the tag because
// the input is built from the dissection, so re-dissecting rebuilds the vectors
// instead of leaving them describing a split that no longer exists.
const EMBED_TAG = `${EMBEDDING_MODEL}#judgeq-d${DISSECTION_VERSION}`;

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
 * The text we embed: THE SAME TEXT THE CLASSIFIER READS — the message with each
 * pasted run replaced in place by its [KIND · extent ▸ excerpt] marker
 * (abridgeQuery), and the raw message when no material was detected, which is
 * also what the rating prompt sends in that case.
 *
 * It used to be its own scheme (requests verbatim, every material run collapsed
 * to one bare [Own draft] placeholder). Two things were wrong with that. It
 * threw away the excerpt, so two messages pasting completely different drafts
 * embedded identically; and because it was driven by `requests`, a message
 * whose only "request" was a seam orphan embedded as the orphan alone — 6% of
 * stored vectors were things like "[Own draft] future.", which is not a point
 * in the space so much as a hole in it. Sharing the judge's rendering also
 * means one thing to reason about: what the sweep measures distance between is
 * what the verdict was formed from.
 */
export function buildEmbedText(
  queryText: string,
  dissection: DissectionResult | null | undefined
): string {
  return abridgeQuery(queryText, dissection) ?? queryText;
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

  // Dissections for the missing messages → build the embed text. `materials` is
  // loaded too, not just the kinds: the marker carries each run's own kind and
  // extent, so without the runs abridgeQuery falls back to a coarser rendering
  // than the judge sees and the two texts drift apart.
  const dissRows = await db
    .select({
      messageId: scoreDissections.messageId,
      materialKinds: scoreDissections.materialKinds,
      requests: scoreDissections.requests,
      materials: scoreDissections.materials,
    })
    .from(scoreDissections)
    .where(inArray(scoreDissections.messageId, missing.map((r) => r.messageId)));
  const dissByMsg = new Map(
    dissRows.map((d) => [
      d.messageId,
      {
        materialKinds: (Array.isArray(d.materialKinds) ? d.materialKinds : []) as MaterialKind[],
        requests: (Array.isArray(d.requests) ? d.requests : []) as string[],
        materials: (Array.isArray(d.materials) ? d.materials : []) as MaterialSpan[],
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

/**
 * Embed arbitrary short texts with the SAME model the query cache uses.
 *
 * Only meaningful because of that: a vector is only comparable to the query
 * vectors if it came from the same model, and the query side is already
 * committed to EMBEDDING_MODEL and cached under a tag that carries its name.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const response = await getClient().embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts.map((t) => embedText(t)),
  });
  return response.data.map((d) => d.embedding);
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
