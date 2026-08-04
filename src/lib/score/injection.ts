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
 * v2: previews now feed the FULL prior conversation, not just the prior pair.
 * v3: v7 dropped the base-prompt fallback below — an empty rule now means NO
 *     system message, so every preview generated under the old fallback (which
 *     silently showed base-prompt behaviour) is wrong and must regenerate.
 * v4: the prior thread is fed as a DIGEST brief instead of replayed turns —
 *     replay made the model imitate its old-rule outputs over the new rule,
 *     and deploy-after-term means future conversations start fresh anyway
 *     (preview ≈ FUTURE runtime; see preview-service + plan §9). */
export const PREVIEW_VERSION = 4;

/**
 * The injected system prompt IS the rule, verbatim — nothing is concatenated,
 * and nothing sits underneath it.
 *
 * v7 removed the base-prompt fallback this function used to have. Every query
 * now reaches a rule by construction: its type's chain either matches a set or
 * ends at the type's own rule (docs/SCORE_v7_intent_tree_design.md §3.5). So a
 * rule that is EMPTY is a real answer — "send no system message" — not a
 * missing value to substitute the assignment default for. The base prompt
 * survives only as the seed a rule starts from and as the emergency fail-open
 * when the classifier itself errors, both of which live in the caller.
 */
export function buildInjectedSystemPrompt(rule: string | null): string {
  return rule?.trim() ?? '';
}

/**
 * Cache key for one generated preview response: everything that changes the
 * output except the message itself (the cache row is already keyed by
 * message). Rule edits and model switches invalidate.
 */
export function rulePreviewHash(model: string, rule: string | null): string {
  return stableHash(JSON.stringify([`p${PREVIEW_VERSION}`, model, buildInjectedSystemPrompt(rule)]));
}

/** The chatbot model, resolved exactly like /api/chat does — previews must
 * run on the model students actually talk to. */
export function getChatModel(): string {
  return process.env.OPENAI_MODEL ?? 'gpt-4o';
}
