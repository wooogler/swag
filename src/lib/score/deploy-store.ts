/**
 * SCORE v6 — chatbot DEPLOY versions.
 *
 * The SCORE board is a staging area: instructors create/edit intents and rules
 * freely without touching students. Pressing DEPLOY freezes the current
 * intent→rule set as a numbered snapshot (score_chat_deploys), and the student
 * chat runtime (/api/chat) always serves the LATEST deploy:
 *
 *   student message → (query type ∥ ratings of every deployed set, in PARALLEL)
 *   → walk that type's first-match chain → the winning set's rule, or, when
 *   nothing matches, the TYPE's own rule. Every message reaches a rule.
 *
 * The base prompt is now an ERROR path only: no deploy, a pre-v7 snapshot, a
 * classifier error/timeout, an unusable type, or a partial rating response.
 * "Nothing matched" is NOT an error — the type answers it, even with an empty
 * rule (which means no system message at all, not a base-prompt substitute).
 * The base prompt itself stays LIVE (managed in assignment settings, outside
 * the SCORE loop) — the snapshot records it for reference only.
 *
 * The live type judgment is deliberately NOT cached into score_query_types: it
 * is made without the deterministic dissection (too heavy per chat message),
 * so writing it would poison the instructor-side cache with a weaker verdict
 * that a version bump alone could never correct. What actually routed the reply
 * is recorded on the reply itself instead (appliedType in its metadata).
 *
 * The mirror of that rule: a caller REPLAYING a message that score_query_types
 * already holds a verdict for must hand it in (`knownType`) rather than let the
 * weaker live judgment stand in. The stored verdict is the one the rest of the
 * system already committed to — the board displays it, sets are assembled by
 * it, an instructor picks a type to write a rule under while looking at it.
 * Classifying again can land somewhere else, and then the rule sits in a chain
 * the query never walks: no error, no empty answer, just a rule that quietly
 * never runs. TWO verdicts for one message is the defect. Which of them is more
 * accurate is a separate question, and not this module's to settle.
 */
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db/db';
import { assignments, scoreChatDeploys } from '@/db/schema';
import { assignmentBasePrompt } from '@/lib/assignment-ai';
import { ensureIntentTables, ensureTypeRoots, loadIntentState } from './intent-store';
import { buildInjectedSystemPrompt } from './injection';
import { rateMessageIntents } from './intent-classifier';
import { classifyMessageType } from './type-classifier';
import { getDefaultScoreModel } from './models';
import { MAX_INTENTS_PER_CALL } from './intent-prompts';
import {
  compileChains,
  INTENT_RATING_VERSION,
  isScoreQueryType,
  pinPromptText,
  resolveRoute,
  TYPE_CLASSIFIER_VERSION,
  type IntentKind,
  type PromptPin,
  type RatingLevel,
  type ScoreQueryType,
} from './intents';

export interface ChatDeployIntent {
  id: number;
  title: string;
  definition: string;
  rule: string | null;
  /** LEGACY. Instructor examples used to be frozen into the deployed prompt.
   * They are no longer built or sent — a label is a transient correction that
   * changes the DEFINITION — but pre-cutover snapshots still carry them, and
   * canonicalChatConfig must keep hashing them so those deploys correctly read
   * as "changed since deploy" and get re-deployed. Never present on new rows. */
  promptPins?: PromptPin[];
  /** v7 tree. 'type_root' rows are the type's final else — never judged, their
   * rule answers whatever the chain leaves unclaimed. Absent on v1 snapshots. */
  kind?: IntentKind;
  type?: string | null;
  parentId?: number | null;
  position?: number | null;
}

/** Snapshot format. 1 = pre-v7 (flat intents + exception links, resolved by
 * the old exclusive-assignment rule). 2 = v7 (tree + type roots, resolved by
 * first-match chain). Absent means 1: the field did not exist then. */
export const CHAT_DEPLOY_SCHEMA_VERSION = 2;

export interface ChatDeploySnapshot {
  /** ACTIVE intents (non-archived, non-template). In v2 the 4 type roots ride
   * along, so the chain has its else-rules frozen with everything else. */
  intents: ChatDeployIntent[];
  /** v6 exception links — read for v1 snapshots, never written any more. */
  links: { fromIntentId: number; toIntentId: number }[];
  ratingPromptVersion: number;
  /** Reference only — runtime always uses the LIVE assignment base prompt. */
  basePrompt: string;
  /** Intent config version (score_config_versions) at deploy time. */
  configVersionNo: number;
  schemaVersion?: number;
  typeClassifierVersion?: number;
}

/**
 * Read a stored snapshot into a shape every consumer can rely on.
 *
 * TOTAL by construction: it must never throw on any historical jsonb, because
 * a throw here would take out the deploy status endpoint and lock instructors
 * out of the very Deploy that fixes the problem. Anything unreadable degrades
 * to an empty v1 snapshot, which the runtime treats as "serve the base prompt".
 */
export function parseChatDeploySnapshot(raw: unknown): ChatDeploySnapshot {
  const o = (raw ?? {}) as Partial<ChatDeploySnapshot>;
  const intents = Array.isArray(o.intents) ? o.intents : [];
  return {
    intents: intents.map((i) => ({
      ...i,
      promptPins: Array.isArray(i?.promptPins) ? i.promptPins : [],
      // v1 rows carry no kind; they are all judged intents.
      kind: i?.kind ?? 'intent',
    })),
    links: Array.isArray(o.links) ? o.links : [],
    ratingPromptVersion: typeof o.ratingPromptVersion === 'number' ? o.ratingPromptVersion : 0,
    basePrompt: typeof o.basePrompt === 'string' ? o.basePrompt : '',
    configVersionNo: typeof o.configVersionNo === 'number' ? o.configVersionNo : 0,
    schemaVersion: typeof o.schemaVersion === 'number' ? o.schemaVersion : 1,
    typeClassifierVersion:
      typeof o.typeClassifierVersion === 'number' ? o.typeClassifierVersion : undefined,
  };
}

/** A snapshot frozen before the v7 cutover: no tree, possibly exception links.
 * The runtime cannot route these (they have no types), so they serve the base
 * prompt until the instructor deploys once. */
export function isLegacySnapshot(snapshot: ChatDeploySnapshot): boolean {
  return (snapshot.schemaVersion ?? 1) < CHAT_DEPLOY_SCHEMA_VERSION;
}

/* ------------------------------------------------------------------ */
/* Snapshot build + dirty detection                                    */
/* ------------------------------------------------------------------ */

/** Freeze the CURRENT live intent→rule set into a deployable snapshot. */
export async function buildChatDeploySnapshot(assignmentId: string): Promise<ChatDeploySnapshot> {
  // The type roots must exist before the state is read: their rules are the
  // chain's else, so a snapshot without them could route a query nowhere.
  await ensureTypeRoots(assignmentId);
  const [state, assignmentRows] = await Promise.all([
    loadIntentState(assignmentId),
    db
      .select({
        customSystemPrompt: assignments.customSystemPrompt,
        instructions: assignments.instructions,
        includeInstructionInPrompt: assignments.includeInstructionInPrompt,
      })
      .from(assignments)
      .where(eq(assignments.id, assignmentId)),
  ]);
  // Untyped sets are excluded: compileChains puts them in no chain, so freezing
  // one would deploy a rule that can never answer anything while still counting
  // against the runtime's per-call budget. (Only pre-backfill rows can be
  // untyped — every create carries its type.)
  const active = state.promptReady.filter((p) => !p.intent.isTemplate && isScoreQueryType(p.intent.type));
  // promptReady is the JUDGED set, so it excludes the type roots by design —
  // append them explicitly or the frozen chain would have no else-rules.
  const roots = state.intents.filter(
    (i) => i.kind === 'type_root' && !i.archived && isScoreQueryType(i.type)
  );
  return {
    intents: [
      ...active.map((p) => ({
        id: p.intent.id,
        title: p.intent.title,
        definition: p.intent.definition,
        rule: p.intent.rule,
        kind: 'intent' as IntentKind,
        type: p.intent.type,
        parentId: p.intent.parentIntentId,
        position: p.intent.position,
      })),
      ...roots.map((r) => ({
        id: r.id,
        title: r.title,
        definition: '',
        rule: r.rule,
        kind: 'type_root' as IntentKind,
        type: r.type,
        parentId: null,
        position: null,
      })),
    ],
    // v7: exception links are gone (the chain's order decides precedence), so
    // new snapshots carry none. The field stays in the shape because the
    // runtime still resolves PRE-v7 snapshots, which have their links inline.
    links: [],
    ratingPromptVersion: INTENT_RATING_VERSION,
    typeClassifierVersion: TYPE_CLASSIFIER_VERSION,
    schemaVersion: CHAT_DEPLOY_SCHEMA_VERSION,
    basePrompt: assignmentBasePrompt(assignmentRows[0] ?? {}),
    configVersionNo: state.versionNo,
  };
}

/** The judged sets and the type roots of a snapshot, split. */
export function splitSnapshot(snapshot: ChatDeploySnapshot): {
  judged: ChatDeployIntent[];
  roots: ChatDeployIntent[];
} {
  return {
    judged: snapshot.intents.filter((i) => (i.kind ?? 'intent') === 'intent'),
    roots: snapshot.intents.filter((i) => i.kind === 'type_root'),
  };
}

/** Canonical form for change detection — only what affects the STUDENT chat:
 * definitions + pins (which sets match), rules (injection), and the tree
 * (which set answers first). Titles/base prompt excluded (title is
 * display-only; base prompt is live).
 *
 * Still sorted by id, never by array order: the tree is captured EXPLICITLY as
 * parent/position fields. Comparing array order instead would make every jsonb
 * round-trip a false "dirty" — the same trap the old link tuples documented. */
export function canonicalChatConfig(snapshot: ChatDeploySnapshot): string {
  return JSON.stringify({
    intents: [...snapshot.intents]
      .sort((a, b) => a.id - b.id)
      .map((i) => ({
        id: i.id,
        definition: i.definition,
        rule: i.rule?.trim() || null,
        // Legacy pins stay in the hash so a pre-cutover deploy — whose prompt
        // carried instructor examples this build no longer sends — reads as
        // changed and gets re-deployed. New snapshots contribute [].
        pins: (i.promptPins ?? []).map((p) => [p.verdict, pinPromptText(p.text)]),
        kind: i.kind ?? 'intent',
        type: i.type ?? null,
        parent: i.parentId ?? null,
        pos: i.position ?? null,
      })),
    v: snapshot.ratingPromptVersion,
    tv: snapshot.typeClassifierVersion ?? null,
    sv: snapshot.schemaVersion ?? 1,
  });
}

/* ------------------------------------------------------------------ */
/* Records                                                             */
/* ------------------------------------------------------------------ */

export async function getLatestChatDeploy(
  assignmentId: string
): Promise<{ versionNo: number; snapshot: ChatDeploySnapshot; createdAt: Date } | null> {
  await ensureIntentTables();
  const rows = await db
    .select()
    .from(scoreChatDeploys)
    .where(eq(scoreChatDeploys.assignmentId, assignmentId))
    .orderBy(desc(scoreChatDeploys.versionNo))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    versionNo: row.versionNo,
    snapshot: parseChatDeploySnapshot(row.snapshot),
    createdAt: row.createdAt,
  };
}

export async function listChatDeploys(assignmentId: string, limit = 20) {
  await ensureIntentTables();
  return db
    .select()
    .from(scoreChatDeploys)
    .where(eq(scoreChatDeploys.assignmentId, assignmentId))
    .orderBy(desc(scoreChatDeploys.versionNo))
    .limit(limit);
}

/** Record a new deploy version. `snapshot` is either freshly built (Deploy) or
 * copied from an older version (Redeploy/rollback — still a NEW version, same
 * append-only philosophy as the intent history). */
export async function recordChatDeploy(
  assignmentId: string,
  createdBy: string | null,
  snapshot: ChatDeploySnapshot,
  note: string | null
): Promise<number> {
  await ensureIntentTables();
  const insertOnce = () =>
    db.transaction(async (tx) => {
      const rows = await tx
        .select({ max: sql<number | null>`max(${scoreChatDeploys.versionNo})` })
        .from(scoreChatDeploys)
        .where(eq(scoreChatDeploys.assignmentId, assignmentId));
      const versionNo = (rows[0]?.max ?? 0) + 1;
      await tx.insert(scoreChatDeploys).values({
        assignmentId,
        versionNo,
        snapshot,
        note,
        createdBy,
        createdAt: new Date(),
      });
      return versionNo;
    });
  try {
    return await insertOnce();
  } catch (error) {
    // max+1 under READ COMMITTED can collide when two deploys race — the
    // unique (assignment_id, version_no) index rejects the loser; one
    // recompute-and-retry resolves it instead of surfacing a 500.
    if (typeof error === 'object' && error && (error as { code?: string }).code === '23505') {
      return insertOnce();
    }
    throw error;
  }
}

/* ------------------------------------------------------------------ */
/* Runtime — the deployed prompt for one student message               */
/* ------------------------------------------------------------------ */

export interface DeployedPromptResult {
  systemPrompt: string;
  /** What answered this message. null → the assignment base prompt (no deploy,
   * a pre-v7 snapshot, or a fail-open). `outcome` separates a real routing
   * decision from a fallback: 'intent' = a set matched, 'type_default' = the
   * chain ran out and the type's own rule answered. */
  applied: {
    intentId: number;
    intentTitle: string;
    rule: string;
    outcome: 'intent' | 'type_default';
    type: ScoreQueryType | null;
    /** Where `type` came from. 'live' = classified here, the student runtime's
     * only option for a message no one has typed yet. 'frozen' = handed in by
     * the caller (see knownType) because the message was ALREADY typed and that
     * verdict is what a human was shown. */
    typeSource?: 'live' | 'frozen';
  } | null;
  deployVersion: number | null;
}

/**
 * Resolve one student message against a FROZEN snapshot — the shared core of
 * both entry points (the student runtime below, and the instructor test-chat
 * that answers under a draft).
 *
 * Two LLM calls in PARALLEL: the query's type, and the ratings of every judged
 * set. They are separate because merging them would change the rating prompt,
 * and any change there forces an INTENT_RATING_VERSION bump that re-rates every
 * message and orphans the baseline study's cached judgments. Running them
 * together keeps the student's wait at max(a, b) rather than a + b.
 *
 * Fail-open is deliberate and narrow (§3.5): the base prompt is for ERRORS —
 * a legacy snapshot, a classifier failure, an unusable type. A query that
 * simply matches nothing is NOT an error; its type's own rule answers it, even
 * when that rule is empty (which means "no system message", exactly as an
 * unruled assignment behaves today).
 */
/**
 * Why a resolution ended the way it did. The distinction matters to callers
 * that must NOT accept a fallback answer: 'empty_config' (a real deploy whose
 * rules are all empty) and 'fail_open' (machinery failed) both end up sending
 * no rule of the instructor's, but only the second is a defect. They are
 * otherwise indistinguishable — an empty basePrompt makes their prompts equal,
 * and a type root seeded from the base prompt makes text comparison unsound.
 */
export type ResolutionOutcome = 'routed' | 'empty_config' | 'fail_open';

export type FailOpenReason =
  | 'legacy_snapshot'
  | 'unusable_type'
  | 'no_chain'
  | 'pending_rating';

type SnapshotResolution =
  | { outcome: 'routed'; systemPrompt: string; applied: DeployedPromptResult['applied'] }
  | { outcome: 'empty_config'; systemPrompt: string; applied: null }
  | { outcome: 'fail_open'; reason: FailOpenReason };

async function resolveAgainstSnapshot(args: {
  snapshot: ChatDeploySnapshot;
  basePrompt: string;
  queryText: string;
  prevQueryText: string | null;
  prevResponseText: string | null;
  callOptions?: { timeoutMs: number; maxRetries: number };
  /** A type already decided for THIS message, used instead of classifying it
   * again. Only for callers replaying a message that carries a stored verdict
   * (score_query_types) — see the header note on two verdicts for one message.
   * null/undefined ⇒ classify live, which is what the student runtime, facing a
   * message nobody has typed yet, always does. */
  knownType?: ScoreQueryType | null;
}): Promise<SnapshotResolution> {
  const { snapshot } = args;
  // A pre-v7 snapshot has no types and no tree — nothing to route with. The
  // instructor re-deploys once and it becomes routable (D5).
  if (isLegacySnapshot(snapshot)) return { outcome: 'fail_open', reason: 'legacy_snapshot' };

  const { judged, roots } = splitSnapshot(snapshot);
  const anyRule =
    judged.some((i) => i.rule?.trim()) || roots.some((r) => r.rule?.trim());
  if (!anyRule) {
    // Nothing anywhere would change the answer. Skip both calls and return the
    // routed-else outcome with an empty prompt — NOT the base prompt, which is
    // reserved for errors (an empty rule means no system message at all).
    return { outcome: 'empty_config', systemPrompt: '', applied: null };
  }

  const callOptions = args.callOptions ?? { timeoutMs: 15_000, maxRetries: 0 };
  const rated = judged.slice(0, MAX_INTENTS_PER_CALL);
  // A handed-in type replaces the call entirely — it is not a hint to check.
  // Re-classifying and preferring one of the two answers would reintroduce the
  // very disagreement knownType exists to remove, at full cost.
  const frozenType = args.knownType ?? null;
  const [typeResult, ratingResult] = await Promise.all([
    frozenType
      ? Promise.resolve({ type: frozenType, rationale: '', raw: '' })
      : classifyMessageType({
          queryText: args.queryText,
          prevQueryText: args.prevQueryText,
          prevResponseText: args.prevResponseText,
          // The live path has no dissection: computeDissections re-scans the
          // whole assignment log from editor events, far too heavy per chat
          // message. The same gap the rating call already lives with.
          dissection: null,
          model: getDefaultScoreModel(),
          callOptions,
        }),
    rated.length > 0
      ? rateMessageIntents({
          queryText: args.queryText,
          prevQueryText: args.prevQueryText,
          prevResponseText: args.prevResponseText,
          includeDissection: false,
          dissection: null,
          // Definition only — a deployed snapshot's legacy examples are NOT
          // resurrected into the runtime prompt, so preview equals runtime.
          intents: rated.map((i) => ({ id: i.id, definition: i.definition })),
          model: getDefaultScoreModel(),
          callOptions,
        })
      : Promise.resolve(null),
  ]);

  // No usable type → no chain to walk. Fail open rather than guess: a wrong
  // type is unrecoverable (the query would only ever see that type's sets).
  if (!typeResult.type) return { outcome: 'fail_open', reason: 'unusable_type' };
  const queryType = typeResult.type;

  const chains = compileChains(
    snapshot.intents.map((i) => ({
      id: i.id,
      kind: (i.kind ?? 'intent') as IntentKind,
      type: i.type ?? null,
      parentIntentId: i.parentId ?? null,
      position: i.position ?? null,
    }))
  );
  const chain = chains.get(queryType);
  if (!chain) return { outcome: 'fail_open', reason: 'no_chain' };

  const ratings = new Map<number, RatingLevel>();
  if (ratingResult) for (const [id, r] of ratingResult.ratings) ratings.set(id, r.rating);

  const resolution = resolveRoute(chain, ratings);
  // A gap BEFORE the winner means the rating call came back partial and the
  // real owner is unknowable — don't promote a later set, fail open (D4).
  if (resolution.kind === 'pending') return { outcome: 'fail_open', reason: 'pending_rating' };

  const ownerId =
    resolution.kind === 'matched' ? resolution.intentId : resolution.intentId ?? null;
  const owner = ownerId === null ? null : snapshot.intents.find((i) => i.id === ownerId) ?? null;
  const rule = owner?.rule?.trim() ?? '';
  const outcome = resolution.kind === 'matched' ? ('intent' as const) : ('type_default' as const);
  return {
    outcome: 'routed',
    systemPrompt: buildInjectedSystemPrompt(rule || null),
    applied: owner
      ? {
          intentId: owner.id,
          intentTitle: owner.title,
          rule,
          outcome,
          type: queryType,
          typeSource: frozenType ? ('frozen' as const) : ('live' as const),
        }
      : null,
  };
}

/**
 * Compose the system prompt the student chat should answer with, under the
 * assignment's LATEST deploy. Every failure path falls back to the base prompt
 * so the chat never blocks on SCORE machinery.
 */
export async function resolveDeployedChatPrompt(args: {
  assignmentId: string;
  basePrompt: string;
  queryText: string;
  prevQueryText: string | null;
  prevResponseText: string | null;
}): Promise<DeployedPromptResult> {
  const { assignmentId, basePrompt } = args;
  try {
    const latest = await getLatestChatDeploy(assignmentId);
    if (!latest) return { systemPrompt: basePrompt, applied: null, deployVersion: null };
    const { snapshot, versionNo } = latest;
    const resolved = await resolveAgainstSnapshot({ ...args, snapshot, basePrompt });
    if (resolved.outcome === 'fail_open') {
      // Legacy snapshot, unusable type, or a partial rating response.
      return { systemPrompt: basePrompt, applied: null, deployVersion: versionNo };
    }
    return { systemPrompt: resolved.systemPrompt, applied: resolved.applied, deployVersion: versionNo };
  } catch (error) {
    // Fail-open: the student gets the plain base prompt; log server-side only.
    console.error('SCORE deployed-prompt resolution failed (falling back to base):', error);
    return { systemPrompt: basePrompt, applied: null, deployVersion: null };
  }
}

/**
 * Resolve the injected prompt for one message against a GIVEN snapshot — the
 * instructor TEST-CHAT answering under the CURRENT DRAFT rather than the latest
 * deploy, and the study's batch generation answering under a FROZEN deploy.
 * Same core as the student runtime, so preview = runtime holds.
 *
 * Unlike the student path this reports HOW it resolved. A study batch must not
 * store an answer the participant's configuration never produced, so it needs
 * to tell "the config genuinely says nothing" from "the classifier timed out";
 * the prompt text alone cannot (see ResolutionOutcome).
 *
 * It also accepts `knownType`, which the student runtime has no use for: these
 * callers replay a message that was already typed once and has been carrying
 * that type ever since — through the board, the curated sets, and the question
 * bank. Classifying it a second time can land elsewhere, and then the rule
 * someone wrote for the type they were looking at never runs, with nothing in
 * the output saying why. See the header note.
 */
export async function resolveChatPromptFromSnapshot(args: {
  snapshot: ChatDeploySnapshot;
  basePrompt: string;
  queryText: string;
  prevQueryText: string | null;
  prevResponseText: string | null;
  callOptions?: { timeoutMs: number; maxRetries: number };
  knownType?: ScoreQueryType | null;
}): Promise<{
  systemPrompt: string;
  applied: DeployedPromptResult['applied'];
  outcome: ResolutionOutcome;
  reason?: FailOpenReason;
}> {
  const resolved = await resolveAgainstSnapshot(args);
  if (resolved.outcome === 'fail_open') {
    return {
      systemPrompt: args.basePrompt,
      applied: null,
      outcome: 'fail_open',
      reason: resolved.reason,
    };
  }
  return {
    systemPrompt: resolved.systemPrompt,
    applied: resolved.applied,
    outcome: resolved.outcome,
  };
}
