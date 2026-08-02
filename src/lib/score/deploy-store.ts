/**
 * SCORE v6 — chatbot DEPLOY versions.
 *
 * The SCORE board is a staging area: instructors create/edit intents and rules
 * freely without touching students. Pressing DEPLOY freezes the current
 * intent→rule set as a numbered snapshot (score_chat_deploys), and the student
 * chat runtime (/api/chat) always serves the LATEST deploy:
 *
 *   student message → rate against the DEPLOYED intents (one classifier call,
 *   same prompt machinery as the board) → resolveAssignment over the deployed
 *   links → owning intent's rule injected via buildInjectedSystemPrompt.
 *
 * Fail-open by design (principle 14): no deploy yet, no ruled intents, a
 * classifier error/timeout, or no owning intent → the plain base prompt.
 * The base prompt itself stays LIVE (§1.9: managed in assignment settings,
 * outside the SCORE loop) — the snapshot records it for reference only.
 */
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db/db';
import { assignments, scoreChatDeploys } from '@/db/schema';
import { assignmentBasePrompt } from '@/lib/assignment-ai';
import { ensureIntentTables, loadIntentState } from './intent-store';
import { buildInjectedSystemPrompt } from './injection';
import { rateMessageIntents } from './intent-classifier';
import { getDefaultScoreModel } from './models';
import { MAX_INTENTS_PER_CALL } from './intent-prompts';
import {
  INTENT_RATING_VERSION,
  pinPromptText,
  resolveAssignment,
  type PromptPin,
  type RatingLevel,
} from './intents';

export interface ChatDeployIntent {
  id: number;
  title: string;
  definition: string;
  rule: string | null;
  /** The intent's pins, in prompt order, frozen at deploy time (selectPromptPins). */
  promptPins: PromptPin[];
}

export interface ChatDeploySnapshot {
  intents: ChatDeployIntent[]; // ACTIVE intents only (non-archived, non-template)
  links: { fromIntentId: number; toIntentId: number }[];
  ratingPromptVersion: number;
  /** Reference only — runtime always uses the LIVE assignment base prompt. */
  basePrompt: string;
  /** Intent config version (score_config_versions) at deploy time. */
  configVersionNo: number;
}

/* ------------------------------------------------------------------ */
/* Snapshot build + dirty detection                                    */
/* ------------------------------------------------------------------ */

/** Freeze the CURRENT live intent→rule set into a deployable snapshot. */
export async function buildChatDeploySnapshot(assignmentId: string): Promise<ChatDeploySnapshot> {
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
  const active = state.promptReady.filter((p) => !p.intent.isTemplate);
  return {
    intents: active.map((p) => ({
      id: p.intent.id,
      title: p.intent.title,
      definition: p.intent.definition,
      rule: p.intent.rule,
      // Store pins in their PROMPT form (normalized + capped, pinPromptText is
      // idempotent) — snapshots stay small even when a pin quotes a long
      // pasted essay, and the runtime prompt is byte-identical either way.
      promptPins: p.promptPins.map((pin) => ({
        verdict: pin.verdict,
        text: pinPromptText(pin.text),
      })),
    })),
    // v7: exception links are gone (the chain's order decides precedence), so
    // new snapshots carry none. The field stays in the shape because the
    // runtime still resolves PRE-v7 snapshots, which have their links inline.
    links: [],
    ratingPromptVersion: INTENT_RATING_VERSION,
    basePrompt: assignmentBasePrompt(assignmentRows[0] ?? {}),
    configVersionNo: state.versionNo,
  };
}

/** Canonical form for change detection — only what affects the STUDENT chat:
 * definitions + pins (classifier routing), rules (injection), links
 * (ownership). Titles/base prompt excluded (title is display-only; base prompt
 * is live). */
export function canonicalChatConfig(snapshot: ChatDeploySnapshot): string {
  return JSON.stringify({
    intents: [...snapshot.intents]
      .sort((a, b) => a.id - b.id)
      .map((i) => ({
        id: i.id,
        definition: i.definition,
        rule: i.rule?.trim() || null,
        // pinPromptText both sides: freshly built snapshots store capped text,
        // but pre-cap rows must canonicalize identically.
        pins: i.promptPins.map((p) => [p.verdict, pinPromptText(p.text)]),
      })),
    // Re-map to tuples — Postgres jsonb reorders object keys, so stringifying
    // stored link OBJECTS as-is would never match a freshly built snapshot
    // (permanent false "dirty"). Tuples have no keys to reorder.
    links: [...snapshot.links]
      .map((l) => [l.fromIntentId, l.toIntentId] as [number, number])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]),
    v: snapshot.ratingPromptVersion,
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
    snapshot: row.snapshot as ChatDeploySnapshot,
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
  /** null → base prompt (no deploy / no match / no rule / fail-open). */
  applied: { intentId: number; intentTitle: string; rule: string } | null;
  deployVersion: number | null;
}

/**
 * Compose the system prompt the student chat should answer with, under the
 * assignment's LATEST deploy. One classifier call (skipped entirely when the
 * deploy has no ruled intents); every failure path falls back to the base
 * prompt so the chat never blocks on SCORE machinery.
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

    // Injection only ever comes from a rule — with no ruled intents there is
    // nothing to route to, so skip the classifier call entirely.
    const hasRules = snapshot.intents.some((i) => i.rule?.trim());
    if (!hasRules || snapshot.intents.length === 0) {
      return { systemPrompt: basePrompt, applied: null, deployVersion: versionNo };
    }

    // Keep the rated set and the resolver's active set IDENTICAL: the
    // classifier caps at MAX_INTENTS_PER_CALL, and resolveAssignment returns
    // 'pending' (→ base prompt forever) if any active id lacks a rating.
    const rated = snapshot.intents.slice(0, MAX_INTENTS_PER_CALL);

    const result = await rateMessageIntents({
      queryText: args.queryText,
      prevQueryText: args.prevQueryText,
      prevResponseText: args.prevResponseText,
      includeDissection: false,
      // NOTE: the batch/instructor path now feeds the deterministic Material/
      // Request dissection into the rating (so pasted material isn't read as an
      // implicit request). The live runtime does NOT yet — computeDissections
      // re-scans the whole assignment log, too heavy for a per-message chat call,
      // and this fn only receives the query text. The reworded no-request rule in
      // the system prompt still applies here, so behaviour moves the same
      // direction; a lightweight per-message dissection to fully restore the
      // preview=runtime invariant on material-heavy messages is a follow-up.
      dissection: null,
      intents: rated.map((i) => ({
        id: i.id,
        definition: i.definition,
        pins: i.promptPins,
      })),
      model: getDefaultScoreModel(),
      // The student is waiting on this call — ONE attempt, hard 15s cap, then
      // fail open to the base prompt (retries would stack the wait).
      callOptions: { timeoutMs: 15_000, maxRetries: 0 },
    });

    const ratings = new Map<number, RatingLevel>();
    for (const [intentId, r] of result.ratings) ratings.set(intentId, r.rating);
    const resolution = resolveAssignment(
      ratings,
      rated.map((i) => i.id),
      snapshot.links
    );
    if (resolution.kind !== 'assigned') {
      return { systemPrompt: basePrompt, applied: null, deployVersion: versionNo };
    }
    const owner = snapshot.intents.find((i) => i.id === resolution.intentId);
    const rule = owner?.rule?.trim();
    if (!owner || !rule) {
      return { systemPrompt: basePrompt, applied: null, deployVersion: versionNo };
    }
    return {
      systemPrompt: buildInjectedSystemPrompt(basePrompt, rule),
      applied: { intentId: owner.id, intentTitle: owner.title, rule },
      deployVersion: versionNo,
    };
  } catch (error) {
    // Fail-open: the student gets the plain base prompt; log server-side only.
    console.error('SCORE deployed-prompt resolution failed (falling back to base):', error);
    return { systemPrompt: basePrompt, applied: null, deployVersion: null };
  }
}

/**
 * Resolve the injected prompt for one message against a GIVEN snapshot — used by
 * the instructor TEST-CHAT to answer under the CURRENT DRAFT (buildChatDeploySnapshot)
 * rather than the latest deploy. Mirrors resolveDeployedChatPrompt's resolution;
 * caller handles fail-open. (Kept separate so the student runtime above is untouched.)
 */
export async function resolveChatPromptFromSnapshot(args: {
  snapshot: ChatDeploySnapshot;
  basePrompt: string;
  queryText: string;
  prevQueryText: string | null;
  prevResponseText: string | null;
  callOptions?: { timeoutMs: number; maxRetries: number };
}): Promise<{ systemPrompt: string; applied: DeployedPromptResult['applied'] }> {
  const { snapshot, basePrompt } = args;
  const hasRules = snapshot.intents.some((i) => i.rule?.trim());
  if (!hasRules || snapshot.intents.length === 0) return { systemPrompt: basePrompt, applied: null };

  const rated = snapshot.intents.slice(0, MAX_INTENTS_PER_CALL);
  const result = await rateMessageIntents({
    queryText: args.queryText,
    prevQueryText: args.prevQueryText,
    prevResponseText: args.prevResponseText,
    includeDissection: false,
    dissection: null,
    intents: rated.map((i) => ({ id: i.id, definition: i.definition, pins: i.promptPins })),
    model: getDefaultScoreModel(),
    callOptions: args.callOptions ?? { timeoutMs: 15_000, maxRetries: 0 },
  });

  const ratings = new Map<number, RatingLevel>();
  for (const [intentId, r] of result.ratings) ratings.set(intentId, r.rating);
  const resolution = resolveAssignment(ratings, rated.map((i) => i.id), snapshot.links);
  if (resolution.kind !== 'assigned') return { systemPrompt: basePrompt, applied: null };
  const owner = snapshot.intents.find((i) => i.id === resolution.intentId);
  const rule = owner?.rule?.trim();
  if (!owner || !rule) return { systemPrompt: basePrompt, applied: null };
  return {
    systemPrompt: buildInjectedSystemPrompt(basePrompt, rule),
    applied: { intentId: owner.id, intentTitle: owner.title, rule },
  };
}
