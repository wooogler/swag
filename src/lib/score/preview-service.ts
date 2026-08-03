/**
 * SCORE v6 — shared rule-preview generation (server-only).
 *
 * One place turns (base prompt, rule, question) into "what the chatbot would
 * answer": the ownership comparison (P2), the Revise before/after (P3), and
 * any later preview surface all go through here so preview = runtime holds
 * everywhere by construction.
 *
 * Two modes:
 *  - SAVED-rule previews are cached in score_rule_previews per
 *    (message, intent), keyed by rulePreviewHash — base/rule/model edits
 *    regenerate, repeat opens are free.
 *  - DRAFT-rule previews (a candidate rule not yet applied) are generated
 *    uncached; drafts churn per keystroke session and must never pollute the
 *    per-intent cache.
 */
import OpenAI from 'openai';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db/db';
import { scoreRulePreviews, type ScoreIntent } from '@/db/schema';
import { buildInjectedSystemPrompt, rulePreviewHash } from './injection';
import { createLimiter, SCORE_CONCURRENCY } from './limiter';
import { getConversationHistories, type ChatTurn, type QueryRecord } from './queries';

let cachedClient: OpenAI | null = null;
function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured on the server.');
  if (!cachedClient) {
    // Tighter budget than the classifier client: several full-length chat
    // generations run inside one route invocation under maxDuration=60, so a
    // hung call must fail fast (its row simply regenerates next time) rather
    // than ride the SDK's 10-minute default timeout past the route deadline.
    // Worst case (timeout × attempts) must stay under 60s: 25s × 2 = 50s.
    cachedClient = new OpenAI({ apiKey, maxRetries: 1, timeout: 25_000 });
  }
  return cachedClient;
}

/** One non-streaming chatbot turn under the injected prompt — the same input
 * shape /api/chat sends (system + full prior thread + user). `history` is the
 * reconstructed conversation before the anchor (getConversationHistories); when
 * absent we fall back to the stored prior pair, which for a single-turn
 * exchange IS the full context. No reasoning/temperature overrides: /api/chat
 * sets none either (§1.9). */
async function generatePreview(
  systemPrompt: string,
  rec: QueryRecord,
  model: string,
  history: ChatTurn[] | undefined
): Promise<string> {
  // An empty base prompt with no rule → no system message at all (NIRVANA
  // parity), exactly as /api/chat does, so preview = runtime holds even at the
  // "no guidance" baseline.
  const input: { role: 'system' | 'user' | 'assistant'; content: string }[] = [];
  if (systemPrompt.trim()) input.push({ role: 'system', content: systemPrompt });
  if (history && history.length > 0) {
    for (const turn of history) input.push({ role: turn.role, content: turn.content });
  } else {
    if (rec.prevQueryText) input.push({ role: 'user', content: rec.prevQueryText });
    if (rec.prevResponseText) input.push({ role: 'assistant', content: rec.prevResponseText });
  }
  input.push({ role: 'user', content: rec.queryText });

  const response = await getClient().responses.create({ model, input });
  return (response.output_text ?? '').trim();
}

export interface PreviewBatchResult {
  /** messageId → response text; failed generations are absent. */
  responses: Map<number, string>;
  failed: number;
}

/**
 * Previews under an intent's SAVED rule, read-through-cached in
 * score_rule_previews. `records` must belong to the assignment (callers
 * resolve them via getQueryRecords).
 */
export async function getCachedRulePreviews(args: {
  assignmentId: string;
  intent: ScoreIntent;
  records: QueryRecord[];
  basePrompt: string;
  model: string;
}): Promise<PreviewBatchResult> {
  const { assignmentId, intent, records, model } = args;
  const hash = rulePreviewHash(model, intent.rule);
  const system = buildInjectedSystemPrompt(intent.rule);
  const responses = new Map<number, string>();
  let failed = 0;
  if (records.length === 0) return { responses, failed };

  const cached = await db
    .select()
    .from(scoreRulePreviews)
    .where(
      and(
        eq(scoreRulePreviews.intentId, intent.id),
        inArray(scoreRulePreviews.messageId, records.map((r) => r.messageId))
      )
    );
  for (const row of cached) {
    if (row.promptHash === hash) responses.set(row.messageId, row.response);
  }

  const limit = createLimiter(SCORE_CONCURRENCY);
  const now = new Date();
  const toGenerate = records.filter((rec) => !responses.has(rec.messageId));
  // Full prior thread per anchor → runtime parity (the cache key already covers
  // model/base/rule; history is deterministic per message, so it needs no key).
  const histories = await getConversationHistories(assignmentId, toGenerate.map((r) => r.messageId));
  await Promise.all(
    toGenerate.map((rec) =>
      limit(async () => {
        try {
          const response = await generatePreview(system, rec, model, histories.get(rec.messageId));
          if (!response) throw new Error('empty preview response');
          const values = { promptHash: hash, response, model, createdAt: now };
          await db
            .insert(scoreRulePreviews)
            .values({ assignmentId, messageId: rec.messageId, intentId: intent.id, ...values })
            .onConflictDoUpdate({
              target: [scoreRulePreviews.messageId, scoreRulePreviews.intentId],
              set: values,
            });
          responses.set(rec.messageId, response);
        } catch (error) {
          failed += 1;
          console.error(
            `SCORE rule preview failed for message ${rec.messageId} intent ${intent.id}:`,
            error
          );
        }
      })
    )
  );
  return { responses, failed };
}

/** Previews under a DRAFT rule (not yet applied) — generated fresh, never cached. */
export async function getDraftPreviews(args: {
  assignmentId: string;
  records: QueryRecord[];
  rule: string | null;
  basePrompt: string;
  model: string;
}): Promise<PreviewBatchResult> {
  const { assignmentId, records, rule, model } = args;
  const system = buildInjectedSystemPrompt(rule);
  const responses = new Map<number, string>();
  let failed = 0;

  const limit = createLimiter(SCORE_CONCURRENCY);
  const histories = await getConversationHistories(assignmentId, records.map((r) => r.messageId));
  await Promise.all(
    records.map((rec) =>
      limit(async () => {
        try {
          const response = await generatePreview(system, rec, model, histories.get(rec.messageId));
          if (!response) throw new Error('empty preview response');
          responses.set(rec.messageId, response);
        } catch (error) {
          failed += 1;
          console.error(`SCORE draft preview failed for message ${rec.messageId}:`, error);
        }
      })
    )
  );
  return { responses, failed };
}
