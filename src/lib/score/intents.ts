/**
 * SCORE v6 intent layer — client-safe core model.
 *
 * An Intent is an instructor-created "WHEN" (a category of student requests)
 * that owns one "Rule" (the THEN — the COMPLETE system prompt the chatbot
 * answers with when a question is assigned to that intent; see injection.ts,
 * one layer never two).
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
/* Reserved intents                                                    */
/* ------------------------------------------------------------------ */

/**
 * Title of the baseline condition's hidden prompt-holder intent (one per
 * baseline clone; see baseline-store). It stores the monolithic system prompt
 * as its RULE and is NEVER rated or classified, so it must be kept out of the
 * "prompt-ready" set that backs staleness, exclusive assignment, and the
 * overlap computation: resolveAssignment treats a missing rating as `pending`,
 * so an unrated holder left in the active set would make EVERY message resolve
 * `pending` (silently killing the Needs-Decision/overlap surfaces). Defined
 * here in the client-safe core so the score loaders and the study layer share
 * one source of truth; baseline-store re-exports it for its existing importers.
 */
export const PROMPT_HOLDER_TITLE = '__system_prompt__';

/**
 * Label for the rule axis's v1 — the rule an intent STARTS from, recorded the
 * moment the intent is created so the board reads "Then v1 <name>" instead of
 * dumping the raw text. A brand-new intent is seeded with the assignment's
 * default, which is empty on NIRVANA — hence two names. "Rule", never
 * "prompt": instructors are the audience and the board already says
 * When/Then → rule everywhere else. Fixed strings, not LLM-generated: every
 * intent on a board starts from the SAME text, so one stable label keeps the
 * study boards consistent.
 */
export function seedRuleVersionName(
  rule: string | null | undefined,
  opts?: { plural?: boolean }
): string {
  const noun = opts?.plural ? 'rules' : 'rule';
  return rule?.trim() ? `Starting ${noun}` : `Empty ${noun}`;
}

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

/* ------------------------------------------------------------------ */
/* v7 type layer                                                       */
/* ------------------------------------------------------------------ */

/**
 * The four fixed query types every student message is classified into
 * (docs/SCORE_v7_intent_tree_design.md §3.1). Single-label, no "Other":
 * off-topic messages still pick the closest type and get that type's rule.
 *
 * Canonical keys are lowercase and independent of the legacy Jelson
 * ScoreTypeKey in config.ts (whose 'All' is this scheme's 'drafting') — the
 * two only meet at the jelson-suggest edges and in the eval scripts.
 */
export const SCORE_QUERY_TYPES = ['planning', 'translating', 'reviewing', 'drafting'] as const;

export type ScoreQueryType = (typeof SCORE_QUERY_TYPES)[number];

export function isScoreQueryType(value: unknown): value is ScoreQueryType {
  return typeof value === 'string' && (SCORE_QUERY_TYPES as readonly string[]).includes(value);
}

/** Instructor-facing labels. 'Drafting', never the legacy 'All'. */
export const QUERY_TYPE_LABELS: Record<ScoreQueryType, string> = {
  planning: 'Planning',
  translating: 'Translating',
  reviewing: 'Reviewing',
  drafting: 'Drafting',
};

/**
 * Version of the type-classification instructions (system prompt + schema).
 * v2: the reviewing/drafting boundary was self-contradictory — drafting claimed
 *     "regenerating text the chatbot produced" while reviewing claimed "text
 *     that already exists", and a tie-break line handed every such request to
 *     reviewing. Measured cost: drafting recall 49% (docs/SCORE_v7_type_eval.md).
 *     The boundary is now WHOSE text, and a planning/drafting rule was added for
 *     essay requests phrased as questions.
 * A message's type is judged ONCE PER MESSAGE EVER — content is immutable, so
 * unlike intent ratings there is no definition to invalidate against. Bumping
 * this constant is therefore the ONLY way a stored judgment is recomputed:
 * change any wording in type-prompts.ts and you MUST bump it here, or every
 * cached row stays "fresh" against a prompt it never saw.
 */
export const TYPE_CLASSIFIER_VERSION = 2;

/**
 * What a score_intents row IS. Replaces the PROMPT_HOLDER_TITLE string
 * sentinel: only 'intent' rows are judged and routable.
 *   - 'intent'        instructor-authored set (a node of the tree)
 *   - 'type_root'     one of the 4 fixed types; never judged, its rule is the
 *                     final else of that type's chain
 *   - 'prompt_holder' the baseline condition's monolithic-rule container
 */
export const INTENT_KINDS = ['intent', 'type_root', 'prompt_holder'] as const;

export type IntentKind = (typeof INTENT_KINDS)[number];

/** Chars of pinned question text quoted in the prompt (headTail-style cap
 * is unnecessary; pins are short student requests). */
export const PIN_TEXT_LIMIT = 300;

export interface PromptPin {
  verdict: 'in' | 'out';
  /** Snapshot of the pinned question's text (taken at pin time). */
  text: string;
  /** Optional instructor reason this example is OUT — injected into the prompt
   * after the quoted text so the classifier learns WHY it doesn't belong. Only
   * meaningful for 'out' pins; null/absent for 'in' pins and legacy rows. */
  reason?: string | null;
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
    // A reason is ADDITIVE: a pin without one hashes as the original 2-tuple, so
    // existing ratings never go stale just because this field was introduced;
    // only a pin that actually carries a reason changes the hash (→ re-rate).
    promptPins.map((p) => {
      const reason = p.reason?.trim();
      return reason ? [p.verdict, pinPromptText(p.text), reason] : [p.verdict, pinPromptText(p.text)];
    }),
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
 * The v6 exclusive-assignment rule. SUPERSEDED by resolveRoute (v7 first-match
 * chain) everywhere except one place: the student runtime still has to answer
 * correctly for deploy snapshots frozen BEFORE the cutover, which carry no
 * tree fields and may carry exception links. Retired with the runtime rewrite;
 * do not wire anything new to it.
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

/* ------------------------------------------------------------------ */
/* v7 routing: tree → first-match chain (deterministic — no LLM)        */
/* ------------------------------------------------------------------ */

/** The tree fields the chain compiler needs from a score_intents row. */
export interface ChainNode {
  id: number;
  kind: IntentKind;
  type: string | null;
  parentIntentId: number | null;
  position: number | null;
}

export interface TypeChain {
  type: ScoreQueryType;
  /** The type-root row — the chain's final else. Null until ensureTypeRoots
   * has run for the assignment (then every query of this type is 'pending'
   * only in the sense that it has nowhere to fall: callers fail open). */
  rootId: number | null;
  /** Judged intent ids in evaluation order: every set's subsets come BEFORE
   * the set itself, sibling subtrees whole and in sibling order. First match
   * wins. The root is deliberately NOT in here — it is never judged. */
  order: number[];
  /** Enclosing sets of each node, outermost last. A subset only owns what its
   * enclosing sets own too (see resolveRoute) — this is what makes nesting
   * mean CONTAINMENT rather than just evaluation order. */
  ancestorsOf: Map<number, number[]>;
}

/** Effective sibling order key: an explicit position wins, otherwise creation
 * order (serial id). Ties break by id so the order is always total. */
function compareSiblings(a: ChainNode, b: ChainNode): number {
  const ka = a.position ?? a.id;
  const kb = b.position ?? b.id;
  if (ka !== kb) return ka - kb;
  return a.id - b.id;
}

/**
 * Compile the intent tree into one first-match chain per type
 * (docs/SCORE_v7_intent_tree_design.md §3.3):
 *
 *     chain(S) = concat(chain(c) for c in S.children) + [S]
 *
 * i.e. POST-ORDER DFS — a carved-out subset is always evaluated before the set
 * it was carved from, and a sibling's whole subtree precedes the next sibling
 * (`T{A{B}, D{E}}` → `[B, A, E, D]`, then the root as the else). Applying
 * creation order to a flat list instead would bury every subset behind its
 * parent forever; that is the one mistake this function exists to prevent.
 *
 * Pass ACTIVE rows only (archived rows are not routable). Rows that cannot
 * route are skipped: 'prompt_holder', and 'intent' rows with no type yet
 * (pre-backfill) — the latter are still judged whole-log, they just have no
 * chain to sit in until they are typed.
 *
 * Pure and total: unknown/cross-type/cyclic parents degrade to top-level
 * placement rather than dropping a node out of the chain.
 */
export function compileChains(nodes: readonly ChainNode[]): Map<ScoreQueryType, TypeChain> {
  const rootIdByType = new Map<ScoreQueryType, number>();
  const membersByType = new Map<ScoreQueryType, ChainNode[]>();

  for (const node of nodes) {
    if (!isScoreQueryType(node.type)) continue; // untyped: not routable (yet)
    if (node.kind === 'type_root') {
      // Lowest id wins if a pre-index database somehow has duplicates.
      const current = rootIdByType.get(node.type);
      if (current === undefined || node.id < current) rootIdByType.set(node.type, node.id);
      continue;
    }
    if (node.kind !== 'intent') continue; // prompt_holder never routes
    const list = membersByType.get(node.type);
    if (list) list.push(node);
    else membersByType.set(node.type, [node]);
  }

  const chains = new Map<ScoreQueryType, TypeChain>();
  for (const type of SCORE_QUERY_TYPES) {
    const rootId = rootIdByType.get(type) ?? null;
    const members = membersByType.get(type) ?? [];
    const memberIds = new Set(members.map((m) => m.id));

    const childrenOf = new Map<number, ChainNode[]>();
    const topLevel: ChainNode[] = [];
    for (const node of members) {
      const parent = node.parentIntentId;
      // Top-level when unparented, parented directly AT the type root, or
      // pointing outside this type's members (orphaned or cross-type — keep it
      // routable instead of losing it).
      if (parent === null || parent === rootId || !memberIds.has(parent)) {
        topLevel.push(node);
        continue;
      }
      const list = childrenOf.get(parent);
      if (list) list.push(node);
      else childrenOf.set(parent, [node]);
    }
    topLevel.sort(compareSiblings);
    for (const list of childrenOf.values()) list.sort(compareSiblings);

    const order: number[] = [];
    const ancestorsOf = new Map<number, number[]>();
    const emitted = new Set<number>();
    const walk = (siblings: ChainNode[], ancestors: number[]): void => {
      for (const node of siblings) {
        if (emitted.has(node.id)) continue; // cycle guard
        emitted.add(node.id);
        ancestorsOf.set(node.id, ancestors);
        walk(childrenOf.get(node.id) ?? [], [node.id, ...ancestors]);
        order.push(node.id); // children before their parent
      }
    };
    walk(topLevel, []);
    // Nodes stranded by a parent cycle: append in sibling order so they stay
    // reachable (a malformed tree must not silently disable an intent). They
    // are treated as top-level — a cycle has no well-defined enclosing set.
    for (const node of [...members].sort(compareSiblings)) {
      if (emitted.has(node.id)) continue;
      emitted.add(node.id);
      ancestorsOf.set(node.id, []);
      order.push(node.id);
    }

    chains.set(type, { type, rootId, order, ancestorsOf });
  }
  return chains;
}

export type RouteResolution =
  /** An intent matched — its rule is the whole system prompt. */
  | { kind: 'matched'; intentId: number }
  /** No intent matched → the type root's rule is the final else. intentId is
   * the root row (null only when roots have not been ensured yet). */
  | { kind: 'type_default'; intentId: number | null }
  /** A node BEFORE any match has no rating yet — don't guess. */
  | { kind: 'pending' };

/**
 * Walk one type's chain and return the single node that owns the query.
 *
 * CONTAINMENT: a subset only ever owns questions its enclosing sets own too.
 * Judgments stay independent — every set is rated against its whole type, and
 * nothing is re-rated — but at routing time a subset is skipped unless every
 * set it sits inside also matched. That is what makes the nesting in the UI a
 * real claim: "inside Write Introduction" means the questions are a subset of
 * Write Introduction's, so a parent's count never grows when a subset is added.
 *
 * The cost is deliberate and visible: a question the PARENT misses can no
 * longer be rescued by a subset that would have matched it. Those are surfaced
 * as "N matches outside this set" so the fix (widen the parent, or move the set
 * out) is the obvious next action rather than an invisible loss.
 *
 * `ratings` must already have instructor pins folded in on the board side
 * (applyPinOverrides): a pin fixes a set's JUDGMENT, never its position (§3.6).
 * The student runtime passes raw ratings, and that is not an omission — pins
 * are keyed to LOGGED messages, and a message being answered live has never
 * been labelled. Pins reach students as examples inside the prompt.
 *
 * Note what 'pending' does and does not cover: an unrated set AFTER the winner
 * cannot change the outcome, so the walk stops at the match. Only a gap that
 * could change who wins — the winner's own rating, or an enclosing set's
 * verdict, which decides whether a subset is even eligible — is ambiguous.
 */
export function resolveRoute(
  chain: TypeChain,
  ratings: ReadonlyMap<number, RatingLevel>
): RouteResolution {
  for (const intentId of chain.order) {
    // Eligibility first: an enclosing set that did not match takes this whole
    // subtree out of the running, and its own rating is then irrelevant.
    let eligible = true;
    for (const ancestorId of chain.ancestorsOf.get(intentId) ?? []) {
      const ancestorRating = ratings.get(ancestorId);
      if (ancestorRating === undefined) return { kind: 'pending' };
      if (!isIncludedRating(ancestorRating)) {
        eligible = false;
        break;
      }
    }
    if (!eligible) continue;

    const rating = ratings.get(intentId);
    if (rating === undefined) return { kind: 'pending' };
    if (isIncludedRating(rating)) return { kind: 'matched', intentId };
  }
  return { kind: 'type_default', intentId: chain.rootId };
}

