/**
 * What the chatbot would say to a question under a given rule.
 *
 * The model, the context shape and the empty-rule behaviour are the full
 * version's, deliberately and without exception: the same chat model students
 * talk to, the same rule-independent digest of the prior thread, and no system
 * message at all when the rule is empty. A simulation that stands in for
 * deployed behaviour has to be generated the way deployment generates
 * (§6.3) — speed comes from the cache, the prefetch and the concurrency
 * limiter, never from a cheaper model.
 *
 * The cache is keyed by the rule TEXT that produced the answer, so:
 *  - editing one intent's rule invalidates only the questions that intent
 *    answers, and
 *  - moving between versions is instant wherever the applied text is the same,
 *    which after a typical save is nearly everywhere.
 *
 * In the baseline arm the one document is the applied text for every question,
 * so editing it invalidates all of them at once. That asymmetry is the
 * manipulation — a local edit versus a global one — and is left visible rather
 * than smoothed over.
 */
import OpenAI from 'openai';
import { and, inArray } from 'drizzle-orm';
import { db } from '@/db/db';
import { simplePreviews } from '@/db/schema';
import { getConversationDigests } from '@/lib/score/conversation-digest';
import { buildInjectedSystemPrompt, getChatModel, rulePreviewHash } from '@/lib/score/injection';
import { createLimiter, SCORE_CONCURRENCY } from '@/lib/score/limiter';
import {
  getConversationHistories,
  getQueryRecords,
  type ChatTurn,
  type QueryRecord,
} from '@/lib/score/queries';

let cachedClient: OpenAI | null = null;
function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured on the server.');
  if (!cachedClient) {
    // Same budget as the full version's preview client: two attempts have to
    // fit inside the route's 60s ceiling.
    cachedClient = new OpenAI({ apiKey, maxRetries: 1, timeout: 25_000 });
  }
  return cachedClient;
}

export function simpleRuleHash(rule: string): string {
  return rulePreviewHash(getChatModel(), rule);
}

/**
 * The model input for one question under one rule.
 *
 * Identical in shape to the full version's preview: system message = the rule
 * verbatim (absent when the rule is empty), then the prior thread as a compact
 * brief plus the question. Replaying the old turns verbatim made the model
 * imitate the answers it had already given instead of following the new rule,
 * which is the whole thing a preview is for.
 */
function buildInput(
  rule: string,
  record: QueryRecord,
  history: ChatTurn[] | undefined,
  digest: string | null | undefined
) {
  const system = buildInjectedSystemPrompt(rule);
  const input: { role: 'system' | 'user' | 'assistant'; content: string }[] = [];
  if (system.trim()) input.push({ role: 'system', content: system });
  if (digest) {
    input.push({
      role: 'user',
      content: `CONTEXT (summary of the conversation so far):\n${digest}\n\nSTUDENT'S NEW MESSAGE:\n${record.queryText}`,
    });
  } else {
    if (history && history.length > 0) {
      for (const turn of history) input.push({ role: turn.role, content: turn.content });
    } else {
      if (record.prevQueryText) input.push({ role: 'user', content: record.prevQueryText });
      if (record.prevResponseText) input.push({ role: 'assistant', content: record.prevResponseText });
    }
    input.push({ role: 'user', content: record.queryText });
  }
  return input;
}

async function contextFor(assignmentId: string, records: QueryRecord[]) {
  const ids = records.map((r) => r.messageId);
  const histories = await getConversationHistories(assignmentId, ids);
  const digests = await getConversationDigests(
    assignmentId,
    records.map((record) => ({
      messageId: record.messageId,
      queryText: record.queryText,
      history: histories.get(record.messageId) ?? [],
    }))
  );
  return { histories, digests };
}

/** Cached answers for a set of (question, rule) pairs. */
export async function readCachedResponses(
  pairs: { messageId: number; ruleHash: string }[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (pairs.length === 0) return out;
  const rows = await db
    .select({
      messageId: simplePreviews.messageId,
      ruleHash: simplePreviews.ruleHash,
      response: simplePreviews.response,
    })
    .from(simplePreviews)
    .where(
      and(
        inArray(
          simplePreviews.messageId,
          pairs.map((p) => p.messageId)
        ),
        inArray(
          simplePreviews.ruleHash,
          [...new Set(pairs.map((p) => p.ruleHash))]
        )
      )
    );
  for (const row of rows) out.set(`${row.messageId}:${row.ruleHash}`, row.response);
  return out;
}

async function writeResponse(args: {
  assignmentId: string;
  messageId: number;
  ruleHash: string;
  response: string;
  model: string;
}): Promise<void> {
  const values = {
    response: args.response,
    model: args.model,
    createdAt: new Date(),
  };
  await db
    .insert(simplePreviews)
    .values({
      assignmentId: args.assignmentId,
      messageId: args.messageId,
      ruleHash: args.ruleHash,
      ...values,
    })
    .onConflictDoUpdate({
      target: [simplePreviews.messageId, simplePreviews.ruleHash],
      set: values,
    });
}

export interface StreamedResponse {
  stream: ReadableStream<Uint8Array>;
  ruleHash: string;
}

/**
 * Generate one answer, streaming it as it arrives and caching the whole of it
 * when it finishes.
 *
 * Streaming here is not decoration: the viewer's job is to answer "what does
 * my configuration do to this question", and waiting eight seconds in silence
 * for that is what makes people stop asking. A failure mid-stream ends the
 * stream and writes nothing, so the row simply regenerates when the question
 * is opened again — one row's problem, not the screen's.
 *
 * A reader who moves on mid-stream is NOT a failure. The client aborts, the
 * controller closes under us, and the generation carries on being paid for
 * either way — so it is collected to the end and cached, and coming back to
 * that question is a hit rather than a second bill. Pushing at a closed
 * controller was also throwing on every such click: `Invalid state:
 * Controller is already closed`.
 */
export async function streamResponse(args: {
  assignmentId: string;
  messageId: number;
  rule: string;
}): Promise<StreamedResponse | null> {
  const records = await getQueryRecords(args.assignmentId);
  const record = records.find((r) => r.messageId === args.messageId);
  if (!record) return null;

  const model = getChatModel();
  const ruleHash = simpleRuleHash(args.rule);
  const { histories, digests } = await contextFor(args.assignmentId, [record]);
  const openaiStream = await getClient().responses.create({
    model,
    input: buildInput(args.rule, record, histories.get(record.messageId), digests.get(record.messageId)),
    stream: true,
  });

  const encoder = new TextEncoder();
  let full = '';
  let listening = true;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of openaiStream) {
          if (event.type === 'response.output_text.delta') {
            const delta = event.delta || '';
            if (delta) {
              full += delta;
              // Collected whether or not anyone is still reading it.
              if (listening) controller.enqueue(encoder.encode(delta));
            }
          }
        }
        if (full.trim()) {
          await writeResponse({
            assignmentId: args.assignmentId,
            messageId: args.messageId,
            ruleHash,
            response: full.trim(),
            model,
          });
        }
        if (listening) controller.close();
      } catch (error) {
        console.error(`simple response stream failed for message ${args.messageId}:`, error);
        if (listening) controller.error(error);
      }
    },
    cancel() {
      // They clicked elsewhere. Stop pushing; keep collecting.
      listening = false;
    },
  });
  return { stream, ruleHash };
}

/**
 * Fill the cache for a set of (question, rule) pairs without streaming.
 *
 * Called after a save, on whatever the participant is most likely to open
 * next: the questions belonging to the intent they are editing, then the
 * pinned ones, then the ones they looked at recently. Everything already
 * cached is skipped, so calling it repeatedly costs nothing.
 */
export async function prefetchResponses(args: {
  assignmentId: string;
  pairs: { messageId: number; rule: string }[];
}): Promise<{ generated: number; failed: number }> {
  const withHash = args.pairs.map((p) => ({ ...p, ruleHash: simpleRuleHash(p.rule) }));
  const cached = await readCachedResponses(withHash);
  const todo = withHash.filter((p) => !cached.has(`${p.messageId}:${p.ruleHash}`));
  if (todo.length === 0) return { generated: 0, failed: 0 };

  const records = await getQueryRecords(args.assignmentId);
  const byId = new Map(records.map((r) => [r.messageId, r]));
  const wanted = todo.filter((p) => byId.has(p.messageId));
  const { histories, digests } = await contextFor(
    args.assignmentId,
    wanted.map((p) => byId.get(p.messageId) as QueryRecord)
  );

  const model = getChatModel();
  const run = createLimiter(SCORE_CONCURRENCY);
  let generated = 0;
  let failed = 0;
  await Promise.all(
    wanted.map((pair) =>
      run(async () => {
        const record = byId.get(pair.messageId) as QueryRecord;
        try {
          const response = await getClient().responses.create({
            model,
            input: buildInput(
              pair.rule,
              record,
              histories.get(record.messageId),
              digests.get(record.messageId)
            ),
          });
          const text = (response.output_text ?? '').trim();
          if (!text) throw new Error('empty response');
          await writeResponse({
            assignmentId: args.assignmentId,
            messageId: pair.messageId,
            ruleHash: pair.ruleHash,
            response: text,
            model,
          });
          generated += 1;
        } catch (error) {
          failed += 1;
          console.error(`simple prefetch failed for message ${pair.messageId}:`, error);
        }
      })
    )
  );
  return { generated, failed };
}
