/**
 * Selectable classifier models for SCORE.
 *
 * Kept in its own module (no `openai` import) so it is safe to import from both
 * the server (classifier / route / page) and the client viewer without pulling
 * the OpenAI SDK into the browser bundle.
 */
export const SCORE_MODELS = ['gpt-5.4-mini', 'gpt-5.4-nano'] as const;
export type ScoreModel = (typeof SCORE_MODELS)[number];

/**
 * Built-in default for intent rating (the instructor-facing picker was removed).
 * The live model is env-driven — see getDefaultScoreModel. This const is the
 * fallback + the client-side default the board sends.
 */
export const SCORE_RATING_MODEL: ScoreModel = 'gpt-5.4-mini';

/** Friendly labels for the model picker. */
export const SCORE_MODEL_LABELS: Record<string, string> = {
  'gpt-5.4-mini': '5.4-mini · accurate',
  'gpt-5.4-nano': '5.4-nano · fast',
};

export function isValidScoreModel(model: string | null | undefined): model is ScoreModel {
  return !!model && (SCORE_MODELS as readonly string[]).includes(model);
}

/**
 * The intent-RATING model (the classifier). Env-driven via SCORE_RATING_MODEL —
 * decoupled from OPENAI_MODEL (which is the student CHATBOT model). The operator
 * picks any model here; callModel self-heals reasoning/schema param mismatches,
 * so a non-5.4 model still runs. Falls back to the built-in default.
 * Server-side only (reads env).
 */
export function getDefaultScoreModel(): string {
  return process.env.SCORE_RATING_MODEL?.trim() || SCORE_RATING_MODEL;
}

/** Resolve a (possibly untrusted) requested model to an allowed one. Retained
 * for the client-passed model; server config (getDefaultScoreModel) wins. */
export function resolveScoreModel(requested?: string | null): string {
  return isValidScoreModel(requested) ? requested : getDefaultScoreModel();
}
