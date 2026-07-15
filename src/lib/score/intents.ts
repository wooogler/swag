/**
 * SCORE v6 intent layer — client-safe core model.
 *
 * An Intent is an instructor-created "WHEN" (a category of student requests)
 * that owns one "Rule" (the THEN — a response guideline injected on top of the
 * assignment's Base Prompt when a question is assigned to that intent).
 * Intents are scoped PER ASSIGNMENT — unlike the global Jelson taxonomy in
 * config.ts, which the v6 design demotes to a background tagging/browse layer.
 *
 * The classifier rates every question against every intent on a 5-level scale
 * (with a short rationale emitted BEFORE the rating). Assignment of a question
 * to an intent is NOT done by the model: it is the deterministic resolver in
 * this file (exactly one "include" wins; zero → Base-only fallback; two or
 * more → exception links, and whatever they cannot settle is a boundary event
 * that surfaces in the Needs Decision queue).
 *
 * Client-safe: no server/db/openai imports — the viewer uses the resolver and
 * hashes directly.
 */
import { stableHash } from './config';

/* ------------------------------------------------------------------ */
/* Ratings                                                             */
/* ------------------------------------------------------------------ */

export const RATING_LEVELS = [
  'clearly_in',
  'probably_in',
  'unsure',
  'probably_out',
  'clearly_out',
] as const;

export type RatingLevel = (typeof RATING_LEVELS)[number];

/** The levels the classifier may EMIT (prompt text + structured-output enum).
 * 'unsure' was dropped from the emitted scale: across 1000+ stored ratings the
 * model chose it 0 times, and the UI already buckets uncertainty into Needs
 * Decision via probably_*. RATING_LEVELS above keeps 'unsure' so legacy stored
 * rows still type/parse. Dropping it is distributionally a no-op (0 uses), so
 * INTENT_RATING_VERSION is deliberately NOT bumped — cached ratings and the
 * hash-keyed version history stay valid. */
export const PROMPT_RATING_LEVELS = [
  'clearly_in',
  'probably_in',
  'probably_out',
  'clearly_out',
] as const;

export function isRatingLevel(value: unknown): value is RatingLevel {
  return typeof value === 'string' && (RATING_LEVELS as readonly string[]).includes(value);
}

/** Ratings that count as "include" for exclusive assignment. Only clearly_in is
 * auto-assigned — matching the instructor's mental model ("the intent captures
 * what is clearly in"). Anything leaning in but uncertain (probably_in) is
 * included ONLY when the instructor explicitly pins it in. */
export const INCLUDED_RATINGS: readonly RatingLevel[] = ['clearly_in'];

export function isIncludedRating(rating: RatingLevel | null | undefined): boolean {
  return !!rating && (INCLUDED_RATINGS as readonly string[]).includes(rating);
}

/** Sort strength: clearly_in first … clearly_out last (question-group order). */
export function ratingRank(rating: RatingLevel | null | undefined): number {
  const idx = rating ? (RATING_LEVELS as readonly string[]).indexOf(rating) : -1;
  return idx === -1 ? RATING_LEVELS.length : idx;
}

export const RATING_LABELS: Record<RatingLevel, string> = {
  clearly_in: 'Clearly in',
  probably_in: 'Probably in',
  unsure: 'Unsure',
  probably_out: 'Probably out',
  clearly_out: 'Clearly out',
};

/* ------------------------------------------------------------------ */
/* Dissection (Material vs Request)                                    */
/* ------------------------------------------------------------------ */

export const MATERIAL_KINDS = [
  'student_draft', // the student's own essay/paragraph pasted in
  'assignment_prompt', // the assignment prompt / task description
  'prior_bot_reply', // a previous chatbot answer pasted back
  'other', // some other pasted source (article, notes, …)
] as const;

export type MaterialKind = (typeof MATERIAL_KINDS)[number];

export const MATERIAL_LABELS: Record<MaterialKind, string> = {
  student_draft: 'Own draft',
  assignment_prompt: 'Assignment prompt',
  prior_bot_reply: 'Bot reply',
  other: 'Other source',
};

export interface DissectionResult {
  materialKinds: MaterialKind[];
  /** Verbatim substrings of the message, one per request. Usually length 1. */
  requests: string[];
}

/* ------------------------------------------------------------------ */
/* Versions & prompt-cache invalidation                                */
/* ------------------------------------------------------------------ */

/** Version of the shared intent-rating instructions (system prompt + scale).
 * Folded into every intentDefHash — bumping it re-rates everything.
 * v2: rating prompt now receives the deterministic Material/Request dissection
 *     (buildQueryContent) and the reworded "no explicit request" rule, so the
 *     judge stops treating pasted material (esp. the assignment prompt) as an
 *     implicit request. */
export const INTENT_RATING_VERSION = 2;

/** Version of the dissection method/output. Rows below this are stale and
 * re-dissected on the next rate batch.
 * v2: explicit empty-requests rule for request-less messages (LLM method).
 * v3: DETERMINISTIC dissection from the editor-event log (see dissect.ts) —
 *     supersedes the LLM guess, so every v2 row is recomputed. */
export const DISSECTION_VERSION = 3;

/** Chars of pinned question text quoted in the prompt (headTail-style cap
 * is unnecessary; pins are short student requests). */
export const PIN_TEXT_LIMIT = 300;

export interface PromptPin {
  verdict: 'in' | 'out';
  /** Snapshot of the pinned question's text (taken at pin time). */
  text: string;
}

/**
 * The EXACT string form a pin takes inside the rating prompt (whitespace
 * collapsed, capped at PIN_TEXT_LIMIT). intentDefHash hashes this same form,
 * so the hash tracks precisely what the model saw — no false staleness from
 * whitespace-only differences, no missed staleness ever.
 */
export function pinPromptText(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > PIN_TEXT_LIMIT ? `${t.slice(0, PIN_TEXT_LIMIT)}…` : t;
}

/**
 * The pins actually sent to the classifier for one intent: EVERY one of them,
 * grouped in-then-out, each group in the caller's order (newest pin first).
 *
 * There is deliberately no cap. An instructor labels a boundary case in order
 * to teach the classifier; dropping the 5th label would make the Included/
 * Excluded lists — and the prompt preview built from them — quietly untrue.
 * A pin is one student request capped at PIN_TEXT_LIMIT, and the system prompt
 * it lives in is prompt-cached across a rating batch, so carrying every label
 * costs little. Retire the labels the definition has absorbed (refine) rather
 * than relying on a hidden cap to forget them.
 *
 * Grouping (not interleaving) keeps this a no-op for intents that never had
 * more pins than the old cap: their promptPins array — and therefore their
 * intentDefHash — is byte-identical, so removing the cap re-rates only the
 * intents that were actually being truncated.
 */
export function selectPromptPins(pins: PromptPin[]): PromptPin[] {
  return [...pins.filter((p) => p.verdict === 'in'), ...pins.filter((p) => p.verdict === 'out')];
}

/**
 * Content hash of everything that affects one intent's rating in isolation:
 * the shared rating-prompt version + the intent definition + the pins actually
 * sent. Mirrors subtypeDefHash in config.ts — deliberately independent of
 * SIBLING intents, so editing one intent (or pinning one example) re-rates
 * only that intent. Stored on each (message, intent) rating row; mismatch vs
 * the current config means "re-rate".
 */
export function intentDefHash(definition: string, promptPins: PromptPin[]): string {
  const canonical = JSON.stringify([
    `r${INTENT_RATING_VERSION}`,
    definition,
    promptPins.map((p) => [p.verdict, pinPromptText(p.text)]),
  ]);
  return stableHash(canonical);
}

/* ------------------------------------------------------------------ */
/* Exclusive assignment (deterministic — no LLM)                       */
/* ------------------------------------------------------------------ */

export interface IntentLinkEdge {
  /** "A except B": when both are included, B (toIntentId) owns the question. */
  fromIntentId: number;
  toIntentId: number;
}

export type AssignmentResolution =
  /** Exactly one intent included (possibly after link filtering). */
  | { kind: 'assigned'; intentId: number; viaLink: boolean }
  /** No intent included → chatbot answers with the Base Prompt only. */
  | { kind: 'fallback' }
  /** 2+ includes that links cannot settle → Needs Decision queue. */
  | { kind: 'boundary'; intentIds: number[] }
  /** Some active intent has no fresh rating yet — don't guess. */
  | { kind: 'pending' };

/**
 * The v6 배타 배정 rule. `ratings` maps intentId → its rating for this
 * question (missing/stale entries simply absent). Pure and deterministic so
 * the exact same function can back the viewer, the batch pipeline, and the
 * future runtime injection step.
 */
export function resolveAssignment(
  ratings: ReadonlyMap<number, RatingLevel>,
  activeIntentIds: readonly number[],
  links: readonly IntentLinkEdge[]
): AssignmentResolution {
  if (activeIntentIds.length === 0) return { kind: 'fallback' };
  if (activeIntentIds.some((id) => !ratings.has(id))) return { kind: 'pending' };

  let included = activeIntentIds.filter((id) => isIncludedRating(ratings.get(id)));
  if (included.length === 0) return { kind: 'fallback' };
  if (included.length === 1) return { kind: 'assigned', intentId: included[0], viaLink: false };

  // Apply exception links declaratively: drop A whenever "A except B" exists
  // and B is also included. Evaluate each pass against the pass's input set so
  // link order can't matter; iterate because a drop can enable another link.
  // (The API layer rejects mutually-linked pairs, but guard anyway.)
  for (let pass = 0; pass < links.length + 1; pass++) {
    const before = included;
    const next = before.filter(
      (id) =>
        !links.some((l) => l.fromIntentId === id && before.includes(l.toIntentId) && l.toIntentId !== id)
    );
    if (next.length === 0) {
      // Links eliminated everything (cycle) — treat as an unresolved boundary
      // over the pre-link set rather than silently falling back.
      return { kind: 'boundary', intentIds: [...before].sort((a, b) => a - b) };
    }
    if (next.length === before.length) break;
    included = next;
    if (included.length === 1) return { kind: 'assigned', intentId: included[0], viaLink: true };
  }

  return { kind: 'boundary', intentIds: [...included].sort((a, b) => a - b) };
}

/** Stable key for a boundary's intent set — groups the Needs Decision queue. */
export function boundaryKey(intentIds: readonly number[]): string {
  return [...intentIds].sort((a, b) => a - b).join('+');
}

/**
 * Instructor pins are DECISIONS for the pinned question, not just prompt
 * examples: an 'in'/'out' verdict on (question, intent) overrides whatever
 * the classifier rated — the pin generalizes to OTHER questions via the
 * prompt, but this one is settled immediately (§1.6 확정 판정). Apply before
 * resolveAssignment. Returns a new map; the input is not mutated.
 */
export function applyPinOverrides(
  ratings: ReadonlyMap<number, RatingLevel>,
  pinVerdicts: ReadonlyMap<number, 'in' | 'out'>
): Map<number, RatingLevel> {
  const out = new Map(ratings);
  for (const [intentId, verdict] of pinVerdicts) {
    out.set(intentId, verdict === 'in' ? 'clearly_in' : 'clearly_out');
  }
  return out;
}
