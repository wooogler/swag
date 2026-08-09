/**
 * Baseline condition data access: clone condition lookup, monolithic prompt
 * versions (Save/Deploy), and the deployed-prompt resolution the student chat
 * uses. Mirrors the SCORE deploy-store's fail-open philosophy: any gap → the
 * assignment's live base prompt. DDL lives in store.ts. See spec §5.
 */
import { createHash, randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { db } from '@/db/db';
import {
  assignments,
  baselinePreviews,
  baselinePromptVersions,
  baselineSearches,
  chatConversations,
  chatMessages,
  reviewSetItems,
  scoreIntents,
  scoreProbeRatings,
  studentSessions,
  studyClones,
  type BaselineSearch,
} from '@/db/schema';
import { assignmentBasePrompt } from '@/lib/assignment-ai';
import { intentDefHash, PROMPT_HOLDER_TITLE } from '@/lib/score/intents';
import { runChatTurn } from './chat-run';
import type { StudioView } from './config';

// Behavioral event logging lives in events.ts (shared with SCORE routes);
// re-exported here so existing baseline routes keep importing it from baseline-store.
export { logStudyEvent } from './events';

/* ------------------------------------------------------------------ */
/* Per-query preview under a draft prompt (cached, single-turn)         */
/* ------------------------------------------------------------------ */

const PREVIEW_MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o';

/** "Test this query": what the chatbot would answer to one logged query under
 * the given (draft) prompt. Cached by (message, hash(model+prompt)). */
export async function getOrCreateBaselinePreview(
  assignmentId: string,
  messageId: number,
  promptText: string
): Promise<string> {
  const promptHash = createHash('sha256').update(`${PREVIEW_MODEL}\n${promptText}`).digest('hex').slice(0, 40);
  const cached = await db
    .select({ response: baselinePreviews.response })
    .from(baselinePreviews)
    .where(and(eq(baselinePreviews.messageId, messageId), eq(baselinePreviews.promptHash, promptHash)))
    .limit(1);
  if (cached[0]) return cached[0].response;

  const msg = await db
    .select({ content: chatMessages.content })
    .from(chatMessages)
    .where(eq(chatMessages.id, messageId))
    .limit(1);
  const queryText = msg[0]?.content;
  if (!queryText) throw new Error('message_not_found');

  const response = await runChatTurn(promptText, [{ role: 'user', content: queryText }]);
  await db
    .insert(baselinePreviews)
    .values({ assignmentId, messageId, promptHash, response, model: PREVIEW_MODEL, createdAt: new Date() })
    .onConflictDoUpdate({ target: [baselinePreviews.messageId, baselinePreviews.promptHash], set: { response } });
  return response;
}

/* ------------------------------------------------------------------ */
/* Saved custom searches                                               */
/* ------------------------------------------------------------------ */

/** Saved filters plus, per filter, the clearly-in messageIds already in the
 * probe cache under its defHash. The board list renders counts and filters the
 * question list from these WITHOUT re-running anything — the cache was written
 * when the filter was run in its workbench. Oldest first, so the left-column
 * tree appends new filters at the bottom, next to the create row. */
export async function listBaselineSearches(
  assignmentId: string
): Promise<(BaselineSearch & { clearlyInIds: number[] })[]> {
  const searches = await db
    .select()
    .from(baselineSearches)
    .where(eq(baselineSearches.assignmentId, assignmentId))
    .orderBy(asc(baselineSearches.createdAt));
  if (searches.length === 0) return [];
  const hashes = [...new Set(searches.map((s) => s.defHash))];
  const cached = await db
    .select({ defHash: scoreProbeRatings.defHash, messageId: scoreProbeRatings.messageId })
    .from(scoreProbeRatings)
    .where(
      and(
        eq(scoreProbeRatings.assignmentId, assignmentId),
        inArray(scoreProbeRatings.defHash, hashes),
        eq(scoreProbeRatings.rating, 'clearly_in')
      )
    );
  const byHash = new Map<string, number[]>();
  for (const r of cached) {
    const list = byHash.get(r.defHash);
    if (list) list.push(r.messageId);
    else byHash.set(r.defHash, [r.messageId]);
  }
  return searches.map((s) => ({ ...s, clearlyInIds: byHash.get(s.defHash) ?? [] }));
}

/**
 * Save a filter. With an `id` this REPLACES that row rather than adding a
 * second one — reopening a saved filter and pressing Save is an edit, and
 * before this it silently left the old wording behind as a duplicate entry.
 * `type` is the query type it lives under (see the schema note).
 */
export async function saveBaselineSearch(
  assignmentId: string,
  search: { id?: string; description: string; name?: string | null; type?: string | null }
): Promise<{ id: string; defHash: string }> {
  const defHash = intentDefHash(search.description);
  if (search.id) {
    const updated = await db
      .update(baselineSearches)
      // Both optional fields behave the same way on an edit: a field the caller
      // did not mention keeps its stored value; only a value that was actually
      // sent overwrites (an empty name being the way to clear one).
      .set({
        description: search.description,
        defHash,
        ...(search.name !== undefined ? { name: search.name?.trim() || null } : {}),
        ...(search.type !== undefined ? { type: search.type } : {}),
      })
      .where(and(eq(baselineSearches.id, search.id), eq(baselineSearches.assignmentId, assignmentId)))
      .returning({ id: baselineSearches.id });
    if (updated[0]) return { id: updated[0].id, defHash };
    // Deleted from another tab while it was open — fall through and re-create.
  }
  const id = randomUUID();
  await db.insert(baselineSearches).values({
    id,
    assignmentId,
    name: search.name?.trim() || null,
    type: search.type ?? null,
    description: search.description,
    defHash,
    createdAt: new Date(),
  });
  return { id, defHash };
}

export async function deleteBaselineSearch(assignmentId: string, id: string): Promise<void> {
  await db.delete(baselineSearches).where(and(eq(baselineSearches.id, id), eq(baselineSearches.assignmentId, assignmentId)));
}

export async function touchBaselineSearch(assignmentId: string, defHash: string): Promise<void> {
  await db
    .update(baselineSearches)
    .set({ lastRunAt: new Date() })
    .where(and(eq(baselineSearches.assignmentId, assignmentId), eq(baselineSearches.defHash, defHash)));
}

/* ------------------------------------------------------------------ */
/* Review set (shared shape; baseline uses scope='prompt')             */
/* ------------------------------------------------------------------ */

export interface ReviewSetRow {
  messageId: number;
  source: string;
  queryText: string;
}

export async function listReviewSet(assignmentId: string, scope: string): Promise<ReviewSetRow[]> {
  return db
    .select({ messageId: reviewSetItems.messageId, source: reviewSetItems.source, queryText: chatMessages.content })
    .from(reviewSetItems)
    .innerJoin(chatMessages, eq(reviewSetItems.messageId, chatMessages.id))
    .where(and(eq(reviewSetItems.assignmentId, assignmentId), eq(reviewSetItems.scope, scope)))
    .orderBy(asc(reviewSetItems.id));
}

export async function addToReviewSet(
  assignmentId: string,
  scope: string,
  messageIds: number[],
  source: string
): Promise<void> {
  if (messageIds.length === 0) return;
  const now = new Date();
  await db
    .insert(reviewSetItems)
    .values(messageIds.map((messageId) => ({ assignmentId, scope, messageId, source, createdAt: now })))
    .onConflictDoNothing();
}

export async function removeFromReviewSet(assignmentId: string, scope: string, messageId: number): Promise<void> {
  await db
    .delete(reviewSetItems)
    .where(
      and(
        eq(reviewSetItems.assignmentId, assignmentId),
        eq(reviewSetItems.scope, scope),
        eq(reviewSetItems.messageId, messageId)
      )
    );
}

export interface BaselineLogRow {
  messageId: number;
  queryText: string;
  participantToken: string;
  conversationId: string;
}

/** Read-only student-query log for the baseline log browser (no ratings). */
export async function getBaselineLog(assignmentId: string): Promise<BaselineLogRow[]> {
  const rows = await db
    .select({
      messageId: chatMessages.id,
      queryText: chatMessages.content,
      participantToken: studentSessions.participantToken,
      conversationId: chatMessages.conversationId,
    })
    .from(chatMessages)
    .innerJoin(chatConversations, eq(chatMessages.conversationId, chatConversations.id))
    .innerJoin(studentSessions, eq(chatConversations.sessionId, studentSessions.id))
    .where(and(eq(studentSessions.assignmentId, assignmentId), eq(chatMessages.role, 'user')))
    .orderBy(asc(studentSessions.participantToken), asc(chatMessages.sequenceNumber));
  return rows;
}


/** The study condition of an assignment, or null if it isn't a study clone. */
export async function getCloneCondition(assignmentId: string): Promise<StudioView | null> {
  const row = await db
    .select({ condition: studyClones.condition })
    .from(studyClones)
    .where(eq(studyClones.assignmentId, assignmentId))
    .limit(1);
  return (row[0]?.condition as StudioView | undefined) ?? null;
}

export interface BaselineState {
  /** Editor seed: the prompt-holder intent's LIVE rule (the working prompt). */
  currentPrompt: string;
  hasSavedVersion: boolean;
  deployedVersionNo: number | null;
  /** The prompt students CURRENTLY receive (the deployed version's text) — the
   * Preview workbench compares the working prompt against this. Null = not deployed. */
  deployedPrompt: string | null;
  versions: { versionNo: number; deployed: boolean; createdAt: Date }[];
  /** The hidden per-clone intent whose RULE is this prompt — the Revise flow
   * mounts the SCORE RuleWorkbench on it, so version history reuses
   * score_rule_versions (v1 seed, minors, checkout, revert) verbatim. */
  promptHolderId: number;
}

/** The prompt to seed a fresh holder from: the latest saved deploy snapshot,
 * else the assignment's live base prompt. */
async function deployedOrBasePrompt(assignmentId: string): Promise<string> {
  const [latest, assignment] = await Promise.all([
    db
      .select({ prompt: baselinePromptVersions.prompt })
      .from(baselinePromptVersions)
      .where(eq(baselinePromptVersions.assignmentId, assignmentId))
      .orderBy(desc(baselinePromptVersions.versionNo))
      .limit(1),
    db.query.assignments.findFirst({ where: eq(assignments.id, assignmentId) }),
  ]);
  return latest[0]?.prompt ?? assignmentBasePrompt(assignment ?? {});
}

/** Reserved title of the hidden prompt-holder intent (one per baseline clone).
 * Canonical definition now lives in lib/score/intents (the score loaders must
 * exclude it from the classification/assignment set); re-exported here so
 * existing baseline importers keep resolving it from baseline-store. */
export { PROMPT_HOLDER_TITLE };

/**
 * The baseline monolithic prompt, stored as a hidden intent's RULE so the Revise
 * flow reuses the SCORE RuleWorkbench verbatim (rich version history). The holder
 * is archived + has an empty definition → it never shows on the board and is
 * never rated against the log. Created lazily, seeded from the current prompt.
 */
export async function getOrCreatePromptHolder(
  assignmentId: string
): Promise<{ id: number; rule: string | null }> {
  // Match on kind OR the legacy reserved title: clones provisioned before the
  // v7 kind backfill still carry kind='intent' until ensureIntentTables runs
  // against their database, and a holder resolved twice would be created twice.
  const existing = await db
    .select({ id: scoreIntents.id, rule: scoreIntents.rule, archived: scoreIntents.archived })
    .from(scoreIntents)
    .where(
      and(
        eq(scoreIntents.assignmentId, assignmentId),
        or(eq(scoreIntents.kind, 'prompt_holder'), eq(scoreIntents.title, PROMPT_HOLDER_TITLE))
      )
    )
    .limit(1);
  if (existing[0]) {
    // Heal holders created by an earlier archived=true build — the shared
    // rule-versions endpoints reject archived intents (seed/save would 404).
    if (existing[0].archived) {
      await db
        .update(scoreIntents)
        .set({ archived: false, updatedAt: new Date() })
        .where(eq(scoreIntents.id, existing[0].id));
    }
    return { id: existing[0].id, rule: existing[0].rule };
  }
  const seed = await deployedOrBasePrompt(assignmentId);
  const now = new Date();
  const inserted = await db
    .insert(scoreIntents)
    .values({
      assignmentId,
      title: PROMPT_HOLDER_TITLE,
      // Not a classification intent: kind keeps it out of the judged set (and
      // out of the v7 chain) without depending on the title sentinel.
      kind: 'prompt_holder',
      definition: '',
      rule: seed,
      // NOT archived: the rule-versions endpoints (shared with SCORE) reject
      // archived intents. It stays invisible instead by being filtered out of
      // every board list by its reserved title (page.tsx) — never rated, never
      // shown. isTemplate stays false so it is not a starter set either.
      archived: false,
      isTemplate: false,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: scoreIntents.id, rule: scoreIntents.rule });
  return inserted[0];
}

export async function getBaselineState(assignmentId: string): Promise<BaselineState> {
  const [holder, rows] = await Promise.all([
    getOrCreatePromptHolder(assignmentId),
    db
      .select()
      .from(baselinePromptVersions)
      .where(eq(baselinePromptVersions.assignmentId, assignmentId))
      .orderBy(desc(baselinePromptVersions.versionNo)),
  ]);
  const latest = rows[0];
  const deployed = rows.filter((r) => r.deployedAt).sort((a, b) => +b.deployedAt! - +a.deployedAt!)[0];
  return {
    // The live working prompt is the holder's rule (kept current by board Save /
    // RuleWorkbench). Fall back to the last deploy snapshot if it is somehow null.
    currentPrompt: holder.rule ?? latest?.prompt ?? (await deployedOrBasePrompt(assignmentId)),
    hasSavedVersion: !!latest,
    deployedVersionNo: deployed?.versionNo ?? null,
    deployedPrompt: deployed?.prompt ?? null,
    versions: rows.map((r) => ({ versionNo: r.versionNo, deployed: !!r.deployedAt, createdAt: r.createdAt })),
    promptHolderId: holder.id,
  };
}

export async function getBaselineVersion(assignmentId: string, versionNo: number): Promise<string | null> {
  const row = await db
    .select({ prompt: baselinePromptVersions.prompt })
    .from(baselinePromptVersions)
    .where(and(eq(baselinePromptVersions.assignmentId, assignmentId), eq(baselinePromptVersions.versionNo, versionNo)))
    .limit(1);
  return row[0]?.prompt ?? null;
}

/** Save the prompt as a new version. Deduped: identical to the latest version → no-op. */
export async function saveBaselineVersion(assignmentId: string, prompt: string): Promise<number> {
  const insertOnce = () =>
    db.transaction(async (tx) => {
      const rows = await tx
        .select({ max: sql<number | null>`max(${baselinePromptVersions.versionNo})`, latest: sql<string | null>`(array_agg(${baselinePromptVersions.prompt} ORDER BY ${baselinePromptVersions.versionNo} DESC))[1]` })
        .from(baselinePromptVersions)
        .where(eq(baselinePromptVersions.assignmentId, assignmentId));
      const max = rows[0]?.max ?? 0;
      if (rows[0]?.latest === prompt) return max; // dedupe: no change since last save
      const versionNo = max + 1;
      await tx.insert(baselinePromptVersions).values({ assignmentId, versionNo, prompt, createdAt: new Date() });
      return versionNo;
    });
  try {
    return await insertOnce();
  } catch (error) {
    if (typeof error === 'object' && error && (error as { code?: string }).code === '23505') return insertOnce();
    throw error;
  }
}

/** Deploy: ensure a version holds `prompt` (save if changed), then mark it deployed. */
export async function deployBaselineVersion(assignmentId: string, prompt: string): Promise<number> {
  const versionNo = await saveBaselineVersion(assignmentId, prompt);
  await db
    .update(baselinePromptVersions)
    .set({ deployedAt: new Date() })
    .where(and(eq(baselinePromptVersions.assignmentId, assignmentId), eq(baselinePromptVersions.versionNo, versionNo)));
  return versionNo;
}

/** Publish the prompt-holder's CURRENT rule to students. The holder is the single
 * source of truth (edited only in Revise), so Deploy takes no client text. */
export async function deployBaselinePrompt(assignmentId: string): Promise<number> {
  const holder = await getOrCreatePromptHolder(assignmentId);
  const prompt = holder.rule ?? (await deployedOrBasePrompt(assignmentId));
  return deployBaselineVersion(assignmentId, prompt);
}

/**
 * The system prompt the student chat serves for a baseline clone: the
 * most-recently-deployed version's prompt, else fail-open to the base prompt.
 */
export async function resolveBaselineChatPrompt(assignmentId: string, basePrompt: string): Promise<string> {
  try {
    const row = await db
      .select({ prompt: baselinePromptVersions.prompt })
      .from(baselinePromptVersions)
      .where(and(eq(baselinePromptVersions.assignmentId, assignmentId), isNotNull(baselinePromptVersions.deployedAt)))
      .orderBy(desc(baselinePromptVersions.deployedAt))
      .limit(1);
    return row[0]?.prompt ?? basePrompt;
  } catch {
    return basePrompt;
  }
}
