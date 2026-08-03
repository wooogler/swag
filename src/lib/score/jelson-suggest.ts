/**
 * SCORE — Jelson taxonomy suggestions for the New Intent modal.
 *
 * The 26 Jelson "ChatGPT Query Codes" subtypes are the starter sets the modal
 * offers. They are fuzzy-matched against a piece of free text — v6 matched the
 * definition the instructor was typing; v7 matches the question they are
 * looking at — and ranked, so a rough phrase surfaces the closest few.
 *
 * Pure + client-safe (only imports config types/helpers) so the whole thing
 * runs in the browser with no round-trip — matching is instant.
 */
import { flattenSubtypes, type ScoreConfig } from './config';
import type { ScoreQueryType } from './intents';

/** The legacy taxonomy's type keys ↔ the v7 query types. Its 'All' is v7's
 * 'drafting'; everything else matches on lower-casing. */
export const LEGACY_TYPE_TO_QUERY_TYPE: Record<string, ScoreQueryType> = {
  Planning: 'planning',
  Translating: 'translating',
  Reviewing: 'reviewing',
  All: 'drafting',
};

export interface JelsonSuggestion {
  code: string; // e.g. 'AL01'
  typeKey: string; // e.g. 'All'
  typeLabel: string;
  /** The parent Type's one-line description (e.g. what "Planning" covers). */
  typeDescription: string;
  label: string; // e.g. 'Write Full Essay (from prompt)'
  description: string; // subtype description (example queries folded in)
  /** Weighted token bag, precomputed once: token → best field weight. */
  tokens: Map<string, number>;
}

// Minimal stoplist — kept small so domain words ("write", "essay", "grammar")
// stay meaningful. Only truly generic glue words are dropped.
const STOP = new Set([
  'the', 'a', 'an', 'to', 'of', 'for', 'and', 'or', 'on', 'in', 'is', 'it',
  'my', 'me', 'i', 'you', 'your', 'this', 'that', 'with', 'as', 'at', 'be',
  'so', 'we', 'can', 'could', 'would', 'please', 'some', 'something', 'help',
  'about', 'into', 'from', 'do', 'does',
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOP.has(t));
}

/** Within Levenshtein distance 1 (typo tolerance) — cheap early-exit version. */
function within1(a: string, b: string): boolean {
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (la > lb) i++;
    else if (lb > la) j++;
    else {
      i++;
      j++;
    }
  }
  if (i < la || j < lb) edits++;
  return edits <= 1;
}

/** How well query token `q` matches suggestion token `t` — 0 (miss) … 1 (exact). */
function tokenMatch(q: string, t: string): number {
  if (q === t) return 1;
  if (q.length >= 3 && t.length >= 3 && (t.startsWith(q) || q.startsWith(t))) return 0.7;
  if (q.length >= 4 && t.length >= 4 && within1(q, t)) return 0.5;
  return 0;
}

function addTokens(bag: Map<string, number>, text: string, weight: number) {
  for (const tok of tokenize(text)) {
    const prev = bag.get(tok) ?? 0;
    if (weight > prev) bag.set(tok, weight);
  }
}

/** Flatten the effective config into searchable suggestions (memoize on config). */
export function buildJelsonSuggestions(config: ScoreConfig): JelsonSuggestion[] {
  return flattenSubtypes(config).map(({ type, subtype }) => {
    const tokens = new Map<string, number>();
    addTokens(tokens, subtype.label, 3); // label hits matter most
    // Description now carries the example queries too (folded in), so token
    // weight on it covers both the definition and the few-shot phrasing.
    addTokens(tokens, subtype.description, 2.5);
    addTokens(tokens, type.label, 1.5);
    return {
      code: subtype.code,
      typeKey: type.key,
      typeLabel: type.label,
      typeDescription: type.description,
      label: subtype.label,
      description: subtype.description,
      tokens,
    };
  });
}

export interface JelsonMatch {
  suggestion: JelsonSuggestion;
  score: number;
}

/**
 * Rank suggestions against a free-text query. Token-overlap with light fuzz
 * (prefix + edit-distance-1), so a rough phrase like "write the whole essay"
 * surfaces the essay-generation subtypes. Returns the top `limit` over a small
 * relevance floor.
 */
export function suggestJelson(
  query: string,
  suggestions: JelsonSuggestion[],
  limit = 5
): JelsonMatch[] {
  const qTokens = Array.from(new Set(tokenize(query)));
  if (qTokens.length === 0) return [];

  const scored: JelsonMatch[] = suggestions.map((suggestion) => {
    let score = 0;
    for (const qt of qTokens) {
      let best = 0;
      for (const [st, w] of suggestion.tokens) {
        const m = tokenMatch(qt, st) * w;
        if (m > best) best = m;
      }
      score += best;
    }
    return { suggestion, score };
  });

  // Floor scales a little with query length so a single incidental word doesn't
  // surface the whole taxonomy, but a focused 1–2 word query still matches.
  const floor = Math.max(1.5, Math.min(qTokens.length, 3) * 0.9);
  return scored
    .filter((m) => m.score >= floor)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Seed values for the intent form when a suggestion is picked. The description
 * already folds in the example queries, so it becomes the definition verbatim
 * (just lower-cased into the "asks the chatbot to …" frame). */
export function jelsonToIntent(s: JelsonSuggestion): { title: string; definition: string } {
  const action = s.description
    .trim()
    .replace(/\.$/, '')
    .replace(/^./, (c) => c.toLowerCase());
  return { title: s.label, definition: `asks the chatbot to ${action}` };
}

/**
 * Hand-written intent DEFINITIONS for whole Types. The taxonomy's own type
 * descriptions are coding-scheme meta-text (they cross-reference other types,
 * e.g. "larger requests go to All"), so they read poorly as standalone
 * classifier definitions — these are self-contained versions that fold in the
 * subtype range, in the same "asks the chatbot to …" frame the sets use.
 */
const TYPE_INTENT_DEFINITIONS: Record<string, string> = {
  Planning:
    'asks the chatbot to help decide WHAT to write, without generating essay text — answering a question on the topic, providing examples or factual information, suggesting an essay structure or topics to write about, expanding or comparing ideas, or interpreting the writing prompt',
  Translating:
    "asks the chatbot to turn the student's own idea into usable text at paragraph scale or smaller — writing a sentence or paragraph from a given idea, completing an unfinished sentence or paragraph, or suggesting wording and word choice",
  Reviewing:
    "asks the chatbot to evaluate or revise the student's own existing text without changing its overall theme or viewpoint — proofreading, answering spelling or grammar questions, giving feedback or a grade, shortening text, rewriting it to a specification, improving it, or checking it against the prompt",
  All:
    'asks the chatbot to generate essay text wholesale — writing the entire essay or a whole section of it (introduction, body paragraphs, conclusion) from a prompt or idea, or regenerating, rewriting, or resizing text the chatbot itself produced',
};

/** Seed for ONE intent covering a whole Type (e.g. all of Planning). Uses the
 * dedicated self-contained definition above; unknown types fall back to a
 * definition derived from the taxonomy description. */
export function jelsonTypeToIntent(
  typeKey: string,
  typeLabel: string,
  typeDescription: string
): { title: string; definition: string } {
  const dedicated = TYPE_INTENT_DEFINITIONS[typeKey];
  if (dedicated) return { title: typeLabel, definition: dedicated };
  const desc = typeDescription
    .trim()
    .replace(/\.$/, '')
    .replace(/^./, (c) => c.toLowerCase());
  return {
    title: typeLabel,
    definition: `asks the chatbot for ${typeLabel.toLowerCase()}-stage help — ${desc}`,
  };
}

