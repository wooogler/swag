/**
 * SCORE v6 — Rule injection (§1.9): the composed system prompt the chatbot
 * answers with when a question is assigned to an intent.
 *
 *   injected = Base Prompt + the assigned intent's Rule
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
 * Base Prompt + Rule. With no rule (fallback / "No rule yet") the base prompt
 * is returned untouched — fallback is the normal path, not an exception
 * (§ 설계 원칙 14). With an EMPTY base prompt (e.g. NIRVANA, which ran with no
 * system prompt) the rule IS the entire system prompt — the "on top of
 * everything above" framing would be nonsense with nothing above it.
 */
export function buildInjectedSystemPrompt(basePrompt: string, rule: string | null): string {
  const r = rule?.trim();
  if (!r) return basePrompt;
  if (!basePrompt.trim()) return r;
  return `${basePrompt}\n\nAdditional guideline for this reply (the instructor set this for the kind of request the student just made — follow it on top of everything above):\n${r}`;
}

/**
 * Cache key for one generated preview response: everything that changes the
 * output except the message itself (the cache row is already keyed by
 * message). Base-prompt edits, rule edits, and model switches all invalidate.
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
