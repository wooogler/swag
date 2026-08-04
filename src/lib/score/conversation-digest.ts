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
import { callModel } from './classifier';
import { createLimiter, SCORE_CONCURRENCY } from './limiter';
import { getDefaultScoreModel } from './models';
import type { ChatTurn } from './queries';

/** Bump when the digest prompt or rendering changes — cached rows below this
 * version regenerate. Callers should also bump PREVIEW_VERSION (injection.ts)
 * when the change affects preview output. */
export const CONVERSATION_DIGEST_VERSION = 1;

const DIGEST_SYSTEM = [
  "Summarize a student-chatbot conversation as CONTEXT for answering the student's NEXT message.",
  'Include: the assignment/topic, what the student has been working on, and what the next message refers to.',
  "When the next message refers to a specific piece of text, include that text VERBATIM, labeled as the student's current working draft.",
  "Never reproduce the chatbot's own wording, framing, offers, or reply style — describe what happened neutrally (e.g. 'a draft conclusion was produced') without quoting how the chatbot talked.",
  'Be compact: at most 250 words plus the quoted draft text.',
].join('\n');

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
            const digest = (
              await callModel(
                DIGEST_SYSTEM,
                `CONVERSATION:\n${renderTranscript(t.history)}\n\nSTUDENT'S NEXT MESSAGE (for reference — do not answer it):\n${t.queryText}`,
                model,
                'low',
                undefined,
                { timeoutMs: 60_000, maxRetries: 1 }
              )
            ).trim();
            if (!digest) throw new Error('empty digest');
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
