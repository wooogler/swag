/**
 * Baseline condition data access: clone condition lookup, monolithic prompt
 * versions (Save/Deploy), and the deployed-prompt resolution the student chat
 * uses. Mirrors the SCORE deploy-store's fail-open philosophy: any gap → the
 * assignment's live base prompt. DDL lives in store.ts. See spec §5.
 */
import { and, asc, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { db } from '@/db/db';
import {
  assignments,
  baselinePromptVersions,
  chatConversations,
  chatMessages,
  studentSessions,
  studyClones,
  studyEvents,
} from '@/db/schema';
import { assignmentBasePrompt } from '@/lib/assignment-ai';
import type { StudioView } from './config';

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

/** Append a behavioral study event (process-metric source). Never throws into callers. */
export async function logStudyEvent(
  assignmentId: string,
  eventType: string,
  payload?: Record<string, unknown>
): Promise<void> {
  try {
    await db.insert(studyEvents).values({ assignmentId, eventType, payload: payload ?? null, createdAt: new Date() });
  } catch {
    /* instrumentation must never break the action */
  }
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
  /** Editor seed: latest saved version's prompt, else the live base prompt. */
  currentPrompt: string;
  hasSavedVersion: boolean;
  deployedVersionNo: number | null;
  versions: { versionNo: number; deployed: boolean; createdAt: Date }[];
}

export async function getBaselineState(assignmentId: string): Promise<BaselineState> {
  const [rows, assignment] = await Promise.all([
    db
      .select()
      .from(baselinePromptVersions)
      .where(eq(baselinePromptVersions.assignmentId, assignmentId))
      .orderBy(desc(baselinePromptVersions.versionNo)),
    db.query.assignments.findFirst({ where: eq(assignments.id, assignmentId) }),
  ]);
  const latest = rows[0];
  const deployed = rows.filter((r) => r.deployedAt).sort((a, b) => +b.deployedAt! - +a.deployedAt!)[0];
  return {
    currentPrompt: latest?.prompt ?? assignmentBasePrompt(assignment ?? {}),
    hasSavedVersion: !!latest,
    deployedVersionNo: deployed?.versionNo ?? null,
    versions: rows.map((r) => ({ versionNo: r.versionNo, deployed: !!r.deployedAt, createdAt: r.createdAt })),
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
