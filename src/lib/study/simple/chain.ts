/**
 * The simple version's configuration, and what it does to a question.
 *
 * A configuration here is ONE object — a snapshot — rather than a set of live
 * rows. Saving writes a new snapshot; the newest one IS the configuration
 * (docs/SCORE_SIMPLE_DESIGN.md §3.3). That is the whole of the version model:
 * no draft/deployed split, no per-rule timeline beside the config timeline, no
 * pointer to keep in sync. Restoring an old snapshot makes it the newest one.
 *
 * Why not the live `score_intents` rows the full version uses: those carry the
 * four query types as their top level, and the type layer is exactly what the
 * simple version removes (§5.1). A row model whose unique index, chain
 * compiler and lazy root creation all assume a type would have to be argued
 * out of that assumption in five places; a snapshot has no opinion.
 *
 * Client-safe: no database, no server-only imports. The board compiles the
 * chain locally to render ownership, and the server compiles the same chain
 * from the same function to route a question for real.
 */
import type { StudioArm } from '../config';

/**
 * One intent in a snapshot.
 *
 * `sid` is stable for the life of the assignment: it survives saves, restores
 * and re-parenting, so a judgment, a response and a logged event can all name
 * the same intent across versions. It is not a database id — nothing else in
 * the schema points at it — and it is never reused after a delete.
 */
export interface SimpleIntent {
  sid: number;
  title: string;
  definition: string;
  /** The complete system prompt for questions this intent owns. Empty means
   * no system message at all, which is a real answer, not a missing one. */
  rule: string;
  parentSid: number | null;
}

export interface SimpleSnapshot {
  arm: StudioArm;
  /** baseline: the single Rules document. */
  prompt: string;
  /** score: the rule for questions no intent claims — the tree's else branch. */
  rootRule: string;
  /**
   * score: the tree, flattened in DOCUMENT order (a pre-order walk of what the
   * left column shows). Sibling order in this array is evaluation order, so
   * moving a row up in the UI is moving it earlier in the array — there is no
   * separate position field to keep consistent with it.
   */
  intents: SimpleIntent[];
}

export function emptySnapshot(arm: StudioArm, seed: string): SimpleSnapshot {
  // Both arms start from the same text — the prompt this chatbot actually ran
  // with. The arms have to start equal or the first save is already comparing
  // two different things; which text it is matters less than that it is one
  // text. From here it is a copy: editing it never reaches back to the
  // assignment, and nothing inherits from it live.
  return { arm, prompt: seed, rootRule: seed, intents: [] };
}

/** Children of one node, in evaluation order. */
export function childrenOf(snapshot: SimpleSnapshot, parentSid: number | null): SimpleIntent[] {
  return snapshot.intents.filter((i) => i.parentSid === parentSid);
}

export function findIntent(snapshot: SimpleSnapshot, sid: number): SimpleIntent | null {
  return snapshot.intents.find((i) => i.sid === sid) ?? null;
}

/** A node's ancestors, nearest first. Cycles terminate rather than hang. */
export function ancestorsOf(snapshot: SimpleSnapshot, sid: number): SimpleIntent[] {
  const out: SimpleIntent[] = [];
  const seen = new Set<number>([sid]);
  let node = findIntent(snapshot, sid);
  while (node?.parentSid != null && !seen.has(node.parentSid)) {
    seen.add(node.parentSid);
    const parent = findIntent(snapshot, node.parentSid);
    if (!parent) break;
    out.push(parent);
    node = parent;
  }
  return out;
}

/** Every descendant of a node, in document order. */
export function descendantsOf(snapshot: SimpleSnapshot, sid: number): SimpleIntent[] {
  const out: SimpleIntent[] = [];
  const walk = (parentSid: number) => {
    for (const child of childrenOf(snapshot, parentSid)) {
      out.push(child);
      walk(child.sid);
    }
  };
  walk(sid);
  return out;
}

/**
 * The order questions are tested in: children before their parent, siblings in
 * their own order, the root last.
 *
 * Post-order, so an intent carved out INSIDE another one gets the question
 * first — otherwise nesting would be decoration, since the parent matches
 * everything the child does. The root is the else branch and therefore always
 * last and always matches.
 *
 * Total: a node whose parent is missing or which sits in a cycle is evaluated
 * at the top level rather than dropped, so a malformed tree loses its nesting
 * and not its intents.
 */
export function compileSimpleChain(snapshot: SimpleSnapshot): SimpleIntent[] {
  const byParent = new Map<number | null, SimpleIntent[]>();
  const known = new Set(snapshot.intents.map((i) => i.sid));
  for (const intent of snapshot.intents) {
    // Reparent the unreachable to the top rather than losing them.
    const parent =
      intent.parentSid != null &&
      known.has(intent.parentSid) &&
      !ancestorsOf(snapshot, intent.sid).some((a) => a.sid === intent.sid)
        ? intent.parentSid
        : null;
    const list = byParent.get(parent) ?? [];
    list.push(intent);
    byParent.set(parent, list);
  }

  const out: SimpleIntent[] = [];
  const emitted = new Set<number>();
  const walk = (parentSid: number | null) => {
    for (const intent of byParent.get(parentSid) ?? []) {
      if (emitted.has(intent.sid)) continue;
      emitted.add(intent.sid);
      walk(intent.sid);
      out.push(intent);
    }
  };
  walk(null);
  return out;
}

export type SimpleOwnerOutcome = 'intent' | 'root' | 'pending';

export interface SimpleOwnership {
  outcome: SimpleOwnerOutcome;
  /** The intent that answers this question, or null when the root does. */
  sid: number | null;
  /** The rule that will actually be sent. */
  rule: string;
  /**
   * Intents whose definition matches this question but which do not get it —
   * an earlier sibling took it first, or a parent's definition does not match
   * so the child cannot be reached. Rendered as a plain fact ("applied: X")
   * next to the question, never as a warning.
   */
  matchedElsewhere: number[];
}

/**
 * Which rule answers one question, given a verdict per intent.
 *
 * First match down the chain, with one restriction: a nested intent can only
 * take a question its ancestors also match. Judgments are independent — each
 * definition is rated on its own — so without that restriction a child could
 * claim something its parent excludes, and the nesting the left column draws
 * would be a picture of nothing.
 *
 * `pending` means an intent EARLIER in the chain has not been judged yet:
 * the answer would be a guess, so the caller waits rather than showing a rule
 * that may be about to change.
 */
export function resolveSimpleOwnership(
  snapshot: SimpleSnapshot,
  chain: SimpleIntent[],
  /** sid → does this intent's definition match the question. Absent = unjudged. */
  matches: Map<number, boolean>
): SimpleOwnership {
  const matchedElsewhere: number[] = [];
  for (const intent of chain) {
    const verdict = matches.get(intent.sid);
    if (verdict === undefined) {
      return { outcome: 'pending', sid: null, rule: snapshot.rootRule, matchedElsewhere };
    }
    if (!verdict) continue;
    const reachable = ancestorsOf(snapshot, intent.sid).every((a) => matches.get(a.sid) === true);
    if (!reachable) {
      matchedElsewhere.push(intent.sid);
      continue;
    }
    return { outcome: 'intent', sid: intent.sid, rule: intent.rule, matchedElsewhere };
  }
  return { outcome: 'root', sid: null, rule: snapshot.rootRule, matchedElsewhere };
}

/**
 * Ownership for a whole question set at once, plus the counts the tree shows.
 *
 * The counts are OWNERSHIP, not matches: an intent shadowed by an earlier
 * sibling contributes to that sibling's number, because that is where the
 * question goes. Reporting matches instead would put the same question in two
 * places and make the numbers add up to more than the log.
 */
export function resolveSimpleAll(
  snapshot: SimpleSnapshot,
  /** messageId → (sid → matched). */
  matchesByMessage: Map<number, Map<number, boolean>>,
  messageIds: number[]
): { owners: Map<number, SimpleOwnership>; counts: Map<number | null, number> } {
  const chain = compileSimpleChain(snapshot);
  const owners = new Map<number, SimpleOwnership>();
  const counts = new Map<number | null, number>();
  for (const messageId of messageIds) {
    const ownership = resolveSimpleOwnership(
      snapshot,
      chain,
      matchesByMessage.get(messageId) ?? new Map()
    );
    owners.set(messageId, ownership);
    if (ownership.outcome === 'pending') continue;
    const key = ownership.sid;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return { owners, counts };
}

/** The rule a snapshot would answer with, for an already-resolved owner. */
export function ruleForOwner(snapshot: SimpleSnapshot, sid: number | null): string {
  if (snapshot.arm === 'baseline') return snapshot.prompt;
  if (sid == null) return snapshot.rootRule;
  return findIntent(snapshot, sid)?.rule ?? snapshot.rootRule;
}

/** Every definition in a snapshot, in evaluation order — what the judge needs. */
export function definitionsOf(snapshot: SimpleSnapshot): { sid: number; definition: string }[] {
  return compileSimpleChain(snapshot)
    .filter((i) => i.definition.trim().length > 0)
    .map((i) => ({ sid: i.sid, definition: i.definition }));
}
