/**
 * SCORE v6 — Rule injection (§1.9): the system prompt the chatbot answers with
 * when a question is assigned to an intent.
 *
 *   injected = the assigned intent's Rule, or — nothing matched / no rule yet —
 *              the assignment's default prompt
 *
 * ONE layer, never two. A rule IS the complete system prompt for its intent:
 * new intents are seeded with the assignment's default prompt (empty for
 * NIRVANA, which ran with no system prompt), so editing a rule is editing that
 * intent's whole prompt. The instructor never sees — and never has to reason
 * about — a hidden base layer stacked underneath, and the default prompt shows
 * up only as the starting text of a rule and as the unmatched-question
 * fallback.
 *
 * THE invariant this module exists for: preview = runtime (§4.6). The Decide
 * Ownership comparison (P2), the Revise before/after preview (P3), and the
 * live /api/chat injection (P5) must all build the injected prompt through
 * THIS function with the same model, so what the instructor approves is what
 * students get. Client-safe (no server imports) so the viewer can render the
 * exact prompt.
 */
import { stableHash } from './config';

/** Bump when anything that changes generated preview output changes — the
 * injection wording below, or the preview input shape (preview-service). Cached
 * rule previews (score_rule_previews) below this version are stale.
 * v2: previews now feed the FULL prior conversation, not just the prior pair. */
export const PREVIEW_VERSION = 2;

/**
 * The rule, or the assignment's default prompt when there is no rule. Nothing
 * is concatenated: whatever the instructor sees in the rule box is verbatim
 * what the chatbot is given. "No rule yet" (a rule cleared to empty, or an
 * intent that started from an empty default) falls back to the default prompt —
 * the normal path, not an exception (§ 설계 원칙 14). With an EMPTY default
 * prompt and no rule (NIRVANA), no system message is sent at all.
 */
export function buildInjectedSystemPrompt(basePrompt: string, rule: string | null): string {
  const r = rule?.trim();
  return r ? r : basePrompt;
}

/**
 * Cache key for one generated preview response: everything that changes the
 * output except the message itself (the cache row is already keyed by
 * message). Default-prompt edits, rule edits, and model switches all invalidate.
 */
export function rulePreviewHash(model: string, basePrompt: string, rule: string | null): string {
  return stableHash(
    JSON.stringify([`p${PREVIEW_VERSION}`, model, buildInjectedSystemPrompt(basePrompt, rule)])
  );
}

/** The chatbot model, resolved exactly like /api/chat does — previews must
 * run on the model students actually talk to. */
export function getChatModel(): string {
  return process.env.OPENAI_MODEL ?? 'gpt-4o';
}
