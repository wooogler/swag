/**
 * SCORE — conversation digests for preview generation (server-only).
 *
 * The preview used to replay the anchor's whole prior thread verbatim. On a
 * mid-thread anchor that replay carries the chatbot's own old-rule outputs
 * (measured: 12k chars of ghostwritten prose on the diagnosis anchor), and the
 * model imitates that precedent over the new rule — the transcript beats the
 * system prompt (docs/RULE_WORKBENCH_V2_PLAN.md §9). It also mis-targets what
 * the preview should predict: deploy happens after the term, so a FUTURE
 * conversation starts fresh under the new rule and never carries old-rule
 * turns. The digest replaces the replay with a compact context brief:
 *
 *   · what the conversation is about and what the student is working on,
 *   · the text the anchor refers to, quoted VERBATIM but re-attributed as the
 *     student's current working draft (the referent survives; the "my own
 *     prior output" framing — the thing the model imitates — does not),
 *   · none of the chatbot's own wording, offers, or reply style.
 *
 * Measured effect (§9): whole-essay ghostwriting disappears even under a bare
 * two-sentence rule, and shape-contract rules reach full compliance.
 *
 * Digests are RULE-INDEPENDENT: one row per anchor message, cached in
 * score_conversation_digests and reused across every rule/variant preview of
 * that anchor. Bump CONVERSATION_DIGEST_VERSION when the prompt below changes
 * — stale rows regenerate on next use. Generation failure degrades to the old
 * full-thread replay (callers treat a missing digest as "replay").
 */
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db/db';
import { scoreConversationDigests } from '@/db/schema';
import { callModel, extractJsonObject } from './classifier';
import { createLimiter, SCORE_CONCURRENCY } from './limiter';
import { getDefaultScoreModel } from './models';
import type { ChatTurn } from './queries';

/** Bump when the digest prompt or rendering changes — cached rows below this
 * version regenerate. Callers should also bump PREVIEW_VERSION (injection.ts)
 * when the change affects preview output. */
export const CONVERSATION_DIGEST_VERSION = 2;

const DIGEST_SYSTEM = [
  "Summarize a student-chatbot conversation as CONTEXT for answering the student's NEXT message.",
  'context: the assignment/topic, what the student has been working on, and what the next message refers to. At most 250 words.',
  "working_draft: the text the next message asks the chatbot to work on — the student's own draft, or the piece of it under discussion — copied VERBATIM. Null whenever the next message points at no existing text: a fresh request, a question, a greeting, an instruction with nothing to revise yet. Never put the next message itself here, and never put text the chatbot wrote.",
  "Never reproduce the chatbot's own wording, framing, offers, or reply style — describe what happened neutrally (e.g. 'a draft conclusion was produced') without quoting how the chatbot talked.",
  // Stated in the prompt as well as the schema: callModel drops the schema and
  // retries free-form on a model that rejects strict Structured Outputs, and on
  // that path this line is the only thing naming the shape.
  'Answer with a JSON object holding exactly these two fields: context, working_draft.',
].join('\n');

/**
 * Two fields, not one prose block — because the draft slot got filled whether
 * or not there was a draft.
 *
 * The instruction above was conditional from the start ("when the next message
 * refers to a specific piece of text"), and the model treated the section as
 * mandatory: measured over the 354 digests this corpus had produced, 37 of them
 * quoted the ANCHOR QUESTION back as the student's working draft — "Write the
 * second paragraph", "Are you working?" — and 8 more quoted a fragment too
 * short to work on. Roughly one preview in eight was told the student's draft
 * was their own request.
 *
 * Same lesson propose-prompt.ts already paid for (§2026-08-20): a condition
 * written into the prose is applied always or never, so the condition moves
 * into code. Here the model gets a slot it may leave empty, and
 * `usableDraft` throws away the answers that are the question restated.
 */
const DIGEST_SCHEMA = {
  name: 'conversation_digest',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['context', 'working_draft'],
    properties: {
      context: { type: 'string', description: 'at most 250 words' },
      working_draft: {
        type: ['string', 'null'],
        description: 'verbatim text the next message works on, or null when there is none',
      },
    },
  },
} as const;

const normalize = (text: string): string =>
  text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * The draft, or nothing — dropping the two shapes that are never worth sending.
 *
 * A draft that CONTAINS the next message is the failure above: the model had
 * nothing to quote and quoted the request. A draft the next message contains is
 * a paste the student made in that same message, which buildInput already sends
 * verbatim right underneath — quoting it here only spends the context twice.
 */
function usableDraft(draft: string | null | undefined, queryText: string): string {
  const text = (draft ?? '').trim();
  if (!text) return '';
  const a = normalize(text);
  const b = normalize(queryText);
  if (!a || !b) return text;
  if (a.includes(b) || b.includes(a)) return '';
  return text;
}

/** The stored digest text. Same shape the one-block prompt used to emit, so
 * nothing downstream has to learn about the split. */
function renderDigest(context: string, draft: string): string {
  const body = context.trim();
  if (!draft) return body;
  return `${body}\n\nStudent's current working draft:\n"${draft}"`;
}

/** The digest cap keeps one pathological thread from blowing up the digest
 * call itself; ~40k chars ≈ the longest NIRVANA threads. Head+tail, since the
 * referent of the next message usually sits at the END of the thread. */
const MAX_TRANSCRIPT_CHARS = 40_000;

function renderTranscript(history: ChatTurn[]): string {
  const full = history
    .map((t) => `${t.role === 'user' ? 'Student' : 'Assistant'}: ${t.content}`)
    .join('\n\n');
  if (full.length <= MAX_TRANSCRIPT_CHARS) return full;
  const head = Math.floor(MAX_TRANSCRIPT_CHARS * 0.3);
  const tail = MAX_TRANSCRIPT_CHARS - head;
  return `${full.slice(0, head)}\n[... ${full.length - head - tail} characters omitted ...]\n${full.slice(full.length - tail)}`;
}

export interface DigestTarget {
  messageId: number;
  queryText: string;
  history: ChatTurn[];
}

/**
 * Digests for the given anchors, read-through-cached per message. Anchors
 * with no prior turns map to null (nothing to digest — the preview sends just
 * the question). Failed generations also map to null; the caller falls back
 * to the verbatim replay for those.
 */
export async function getConversationDigests(
  assignmentId: string,
  targets: DigestTarget[]
): Promise<Map<number, string | null>> {
  const result = new Map<number, string | null>();
  const need = targets.filter((t) => t.history.length > 0);
  for (const t of targets) if (t.history.length === 0) result.set(t.messageId, null);
  if (need.length === 0) return result;

  const cached = await db
    .select()
    .from(scoreConversationDigests)
    .where(
      and(
        eq(scoreConversationDigests.assignmentId, assignmentId),
        inArray(scoreConversationDigests.messageId, need.map((t) => t.messageId))
      )
    );
  const fresh = new Map(
    cached.filter((r) => r.version === CONVERSATION_DIGEST_VERSION).map((r) => [r.messageId, r.digest])
  );
  for (const [id, digest] of fresh) result.set(id, digest);

  const model = getDefaultScoreModel();
  const limit = createLimiter(SCORE_CONCURRENCY);
  const now = new Date();
  await Promise.all(
    need
      .filter((t) => !fresh.has(t.messageId))
      .map((t) =>
        limit(async () => {
          try {
            const raw = await callModel(
              DIGEST_SYSTEM,
              `CONVERSATION:\n${renderTranscript(t.history)}\n\nSTUDENT'S NEXT MESSAGE (for reference — do not answer it):\n${t.queryText}`,
              model,
              'low',
              DIGEST_SCHEMA,
              { timeoutMs: 60_000, maxRetries: 1 }
            );
            // callModel self-heals to free-form JSON on a model that rejects
            // strict schemas, so parse rather than assume.
            const parsed = extractJsonObject(raw) as
              | { context?: unknown; working_draft?: unknown }
              | null;
            const context = typeof parsed?.context === 'string' ? parsed.context : '';
            const draft = usableDraft(
              typeof parsed?.working_draft === 'string' ? parsed.working_draft : null,
              t.queryText
            );
            const digest = renderDigest(context, draft);
            if (!digest.trim()) throw new Error('empty digest');
            await db
              .insert(scoreConversationDigests)
              .values({
                assignmentId,
                messageId: t.messageId,
                digest,
                model,
                version: CONVERSATION_DIGEST_VERSION,
                createdAt: now,
              })
              .onConflictDoUpdate({
                target: [scoreConversationDigests.messageId],
                set: { digest, model, version: CONVERSATION_DIGEST_VERSION, createdAt: now },
              });
            result.set(t.messageId, digest);
          } catch (error) {
            console.error(`SCORE conversation digest failed for message ${t.messageId}:`, error);
            result.set(t.messageId, null);
          }
        })
      )
  );
  return result;
}
