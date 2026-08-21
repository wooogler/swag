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
 * A CONFIGURATION IS A FLAT, ORDERED LIST. Intents used to nest, and nesting
 * bought exactly two things: a child was tried before its parent, and a child
 * could only take a question its ancestors also matched. The first is what
 * position in a list already gives you. The second is an AND between two texts
 * that were judged independently and never appeared together on screen — so a
 * definition's own words did not say what it caught, and the one failure it
 * produced (a child claiming nothing because its parent excluded the question)
 * is one the board is forbidden to warn about (§1-4). Flat costs the author a
 * conjunction they now have to write out; that is the trade, and writing the
 * scope down is what makes a definition mean the same thing on the board and
 * in the deployed chatbot.
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
 * and reordering, so a judgment, a response and a logged event can all name
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
}

export interface SimpleSnapshot {
  arm: StudioArm;
  /** baseline: the single Rules document. */
  prompt: string;
  /** score: the rule for questions no intent claims — the uncategorized ones. */
  rootRule: string;
  /**
   * score: the intents, in the order they are tried. Position in this array IS
   * evaluation order — there is no separate rank field that could disagree
   * with it, and no structure layered over it.
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

export function findIntent(snapshot: SimpleSnapshot, sid: number): SimpleIntent | null {
  return snapshot.intents.find((i) => i.sid === sid) ?? null;
}

/**
 * The order questions are tested in.
 *
 * It is the array, and this function exists so that every caller says so by
 * name instead of some of them reaching for `snapshot.intents` and drifting
 * apart the day the order stops being the array.
 */
export function compileSimpleChain(snapshot: SimpleSnapshot): SimpleIntent[] {
  return snapshot.intents;
}

export type SimpleOwnerOutcome = 'intent' | 'root' | 'pending';

export interface SimpleOwnership {
  outcome: SimpleOwnerOutcome;
  /** The intent that answers this question, or null when the root does. */
  sid: number | null;
  /** The rule that will actually be sent. */
  rule: string;
  /**
   * Every other intent whose definition also describes this question. One of
   * them would have answered it if the winner were not above them. Rendered as
   * a plain fact ("applied: X") next to the question, never as a warning.
   */
  matchedElsewhere: number[];
}

/**
 * Which rule answers one question, given a verdict per intent.
 *
 * First match down the list. The scan does not stop there, because the losers
 * are what §5.4 puts in an intent's own question list: opening an intent shows
 * everything its definition describes, including what an intent above it takes
 * first, so the list answers "what do these words catch" and not "what do
 * these words catch after an adjustment you cannot see".
 *
 * `pending` means an intent that could still win has not been judged yet: the
 * answer would be a guess, so the caller waits rather than showing a rule that
 * may be about to change. An unjudged intent BELOW the winner cannot change
 * the answer, only lengthen the losers, so it does not hold anything up.
 */
export function resolveSimpleOwnership(
  snapshot: SimpleSnapshot,
  chain: SimpleIntent[],
  /** sid → does this intent's definition match the question. Absent = unjudged. */
  matches: Map<number, boolean>
): SimpleOwnership {
  let owner: SimpleIntent | null = null;
  const matchedElsewhere: number[] = [];
  for (const intent of chain) {
    const verdict = matches.get(intent.sid);
    if (verdict === undefined) {
      if (!owner) {
        return { outcome: 'pending', sid: null, rule: snapshot.rootRule, matchedElsewhere: [] };
      }
      continue;
    }
    if (!verdict) continue;
    if (owner) matchedElsewhere.push(intent.sid);
    else owner = intent;
  }
  if (!owner) return { outcome: 'root', sid: null, rule: snapshot.rootRule, matchedElsewhere };
  return { outcome: 'intent', sid: owner.sid, rule: owner.rule, matchedElsewhere };
}

/**
 * Ownership for a whole question set at once, plus the counts the tree shows.
 *
 * The counts are OWNERSHIP, not matches: an intent shadowed by one above it
 * contributes to that one's number, because that is where the question goes.
 * Reporting matches instead would put the same question in two places and make
 * the numbers add up to more than the log.
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

/* ------------------------------------------------------------------ */
/* Editing the list                                                    */
/* ------------------------------------------------------------------ */

/**
 * Put a new intent directly above the one named, or last when that is null.
 *
 * "Above whoever has this question now" is the whole positioning rule, and it
 * is what makes the promise on the creation form true without any judging:
 * whatever the new definition turns out to catch, it is tried before the
 * intent it was carved out of, so if it catches the question at all it gets
 * it. Carving out of the uncategorized pile lands last, which is the same
 * sentence — the everything-else rule is what it is tried before.
 */
export function insertBefore(
  intents: SimpleIntent[],
  intent: SimpleIntent,
  beforeSid: number | null
): SimpleIntent[] {
  const at = beforeSid == null ? -1 : intents.findIndex((i) => i.sid === beforeSid);
  if (at < 0) return [...intents, intent];
  return [...intents.slice(0, at), intent, ...intents.slice(at)];
}

/** Move an intent one place earlier (-1) or later (+1) in the order. */
export function moveIntent(
  intents: SimpleIntent[],
  sid: number,
  direction: -1 | 1
): SimpleIntent[] {
  const at = intents.findIndex((i) => i.sid === sid);
  const to = at + direction;
  if (at < 0 || to < 0 || to >= intents.length) return intents;
  const out = [...intents];
  [out[at], out[to]] = [out[to], out[at]];
  return out;
}

/** Delete an intent. */
export function removeIntent(intents: SimpleIntent[], sid: number): SimpleIntent[] {
  return intents.filter((i) => i.sid !== sid);
}

/**
 * Read intents out of a stored snapshot, flattening any nesting it still has.
 *
 * Order matters and is easy to get backwards. A nested snapshot stored its
 * intents in DOCUMENT order — parent before child — while it EVALUATED them
 * post-order, child before parent. So dropping the parent pointers and keeping
 * the array would silently invert the priority of every nested pair. This
 * re-emits in the old evaluation order, which is the one that decided what the
 * chatbot did.
 *
 * Total: an intent whose parent is missing, or which sits in a cycle, comes
 * out at the top level rather than being dropped.
 */
export function flattenStoredIntents(
  raw: { sid: number; title: string; definition: string; rule: string; parentSid?: number | null }[]
): SimpleIntent[] {
  const bare = ({ sid, title, definition, rule }: (typeof raw)[number]): SimpleIntent => ({
    sid,
    title,
    definition,
    rule,
  });
  if (!raw.some((i) => i.parentSid != null)) return raw.map(bare);

  const known = new Set(raw.map((i) => i.sid));
  const parentOf = new Map<number, number | null>();
  for (const intent of raw) {
    let parent = intent.parentSid != null && known.has(intent.parentSid) ? intent.parentSid : null;
    // Walk up; a cycle means this one has no usable parent.
    const seen = new Set<number>([intent.sid]);
    let cursor = parent;
    while (cursor != null) {
      if (seen.has(cursor)) {
        parent = null;
        break;
      }
      seen.add(cursor);
      cursor = raw.find((i) => i.sid === cursor)?.parentSid ?? null;
      if (cursor != null && !known.has(cursor)) cursor = null;
    }
    parentOf.set(intent.sid, parent);
  }

  const byParent = new Map<number | null, (typeof raw)[number][]>();
  for (const intent of raw) {
    const parent = parentOf.get(intent.sid) ?? null;
    byParent.set(parent, [...(byParent.get(parent) ?? []), intent]);
  }
  const out: SimpleIntent[] = [];
  const emitted = new Set<number>();
  const walk = (parent: number | null) => {
    for (const intent of byParent.get(parent) ?? []) {
      if (emitted.has(intent.sid)) continue;
      emitted.add(intent.sid);
      walk(intent.sid);
      out.push(bare(intent));
    }
  };
  walk(null);
  for (const intent of raw) if (!emitted.has(intent.sid)) out.push(bare(intent));
  return out;
}

/** Every definition in a snapshot, in evaluation order — what the judge needs. */
export function definitionsOf(snapshot: SimpleSnapshot): { sid: number; definition: string }[] {
  return compileSimpleChain(snapshot)
    .filter((i) => i.definition.trim().length > 0)
    .map((i) => ({ sid: i.sid, definition: i.definition }));
}
