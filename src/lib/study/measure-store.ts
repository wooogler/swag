/**
 * Reads and writes for the two measurement screens (block test, blind A/B).
 *
 * The one rule that shapes this module: a frozen response is released to the
 * participant only AFTER their prediction is recorded. The block test measures
 * whether someone can read their own configuration and foresee what it does —
 * a response visible a moment early destroys that, so the gate lives on the
 * server and the client is never sent an answer it should not have yet.
 */
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { db } from '@/db/db';
import {
  baselinePromptVersions,
  studyAbAnswers,
  studyClones,
  studyGeneratedResponses,
  studyQuestionBank,
  studyTestAnswers,
  type StudyParticipant,
} from '@/db/schema';
import { getLatestChatDeploy } from '@/lib/score/deploy-store';
import type { SnapshotConfig } from '@/components/study/SnapshotConfigView';
import { blockPlan } from './phases';

export interface MeasureQuestion {
  bankItemId: number;
  position: number;
  context: { role: 'user' | 'assistant'; content: string }[];
  question: string;
}

export interface TestItem extends MeasureQuestion {
  guess: boolean | null;
  rating: number | null;
  /** Present ONLY once the guess is recorded. */
  response: string | null;
}

function readContext(raw: unknown): MeasureQuestion['context'] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (t): t is { role: 'user' | 'assistant'; content: string } =>
      !!t &&
      typeof t === 'object' &&
      ((t as { role?: unknown }).role === 'user' || (t as { role?: unknown }).role === 'assistant') &&
      typeof (t as { content?: unknown }).content === 'string'
  );
}

/** The clone a given block belongs to. */
export async function cloneForBlock(
  participant: StudyParticipant,
  block: 1 | 2
): Promise<{ assignmentId: string; datasetKey: string; condition: 'score' | 'baseline' } | null> {
  const datasetKey = blockPlan(participant.participantNumber).find((p) => p.block === block)
    ?.datasetKey;
  if (!datasetKey) return null;
  const [clone] = await db
    .select()
    .from(studyClones)
    .where(
      and(eq(studyClones.participantId, participant.id), eq(studyClones.datasetKey, datasetKey))
    );
  if (!clone) return null;
  return {
    assignmentId: clone.assignmentId,
    datasetKey: clone.datasetKey,
    condition: clone.condition === 'baseline' ? 'baseline' : 'score',
  };
}

/** The deployed configuration, shaped for SnapshotConfigView. */
export async function deployedConfigFor(clone: {
  assignmentId: string;
  condition: 'score' | 'baseline';
}): Promise<SnapshotConfig | null> {
  if (clone.condition === 'baseline') {
    const [live] = await db
      .select({
        versionNo: baselinePromptVersions.versionNo,
        prompt: baselinePromptVersions.prompt,
      })
      .from(baselinePromptVersions)
      .where(
        and(
          eq(baselinePromptVersions.assignmentId, clone.assignmentId),
          isNotNull(baselinePromptVersions.deployedAt)
        )
      )
      .orderBy(desc(baselinePromptVersions.deployedAt))
      .limit(1);
    if (!live) return null;
    return {
      condition: 'baseline',
      versionLabel: `v${live.versionNo}`,
      rules: live.prompt,
    };
  }

  const latest = await getLatestChatDeploy(clone.assignmentId);
  if (!latest) return null;
  return {
    condition: 'score',
    versionLabel: `v${latest.versionNo}`,
    intents: latest.snapshot.intents.map((i) => ({
      id: i.id,
      title: i.title,
      definition: i.definition,
      rule: i.rule,
      kind: i.kind ?? 'intent',
      type: i.type ?? null,
      parentId: i.parentId ?? null,
      position: i.position ?? null,
    })),
  };
}

/**
 * The block-test items for one clone, with each item's answer state. A
 * response is attached only where a guess already exists — see the module
 * comment.
 */
export async function getTestItems(
  participant: StudyParticipant,
  clone: { assignmentId: string; datasetKey: string }
): Promise<TestItem[]> {
  const bank = await db
    .select()
    .from(studyQuestionBank)
    .where(
      and(eq(studyQuestionBank.datasetKey, clone.datasetKey), eq(studyQuestionBank.kind, 'test'))
    );
  if (bank.length === 0) return [];
  const ids = bank.map((b) => b.id);

  const [answers, responses] = await Promise.all([
    db
      .select()
      .from(studyTestAnswers)
      .where(
        and(
          eq(studyTestAnswers.cloneAssignmentId, clone.assignmentId),
          inArray(studyTestAnswers.bankItemId, ids)
        )
      ),
    db
      .select({
        bankItemId: studyGeneratedResponses.bankItemId,
        response: studyGeneratedResponses.response,
      })
      .from(studyGeneratedResponses)
      .where(
        and(
          eq(studyGeneratedResponses.cloneAssignmentId, clone.assignmentId),
          inArray(studyGeneratedResponses.bankItemId, ids)
        )
      ),
  ]);
  const answerByItem = new Map(answers.map((a) => [a.bankItemId, a]));
  const responseByItem = new Map(responses.map((r) => [r.bankItemId, r.response]));

  return bank
    .sort((a, b) => a.position - b.position)
    .map((item) => {
      const answer = answerByItem.get(item.id);
      const guessed = answer?.guess ?? null;
      return {
        bankItemId: item.id,
        position: item.position,
        context: readContext(item.context),
        question: item.question,
        guess: guessed,
        rating: answer?.rating ?? null,
        // The gate: no guess on record, no response in the payload.
        response: guessed === null ? null : responseByItem.get(item.id) ?? null,
      };
    });
}

/** Record the prediction and release that item's frozen response. */
export async function recordGuess(args: {
  participant: StudyParticipant;
  cloneAssignmentId: string;
  bankItemId: number;
  guess: boolean;
}): Promise<{ response: string } | { error: 'no_response' }> {
  const { participant, cloneAssignmentId, bankItemId, guess } = args;

  const [generated] = await db
    .select({ response: studyGeneratedResponses.response })
    .from(studyGeneratedResponses)
    .where(
      and(
        eq(studyGeneratedResponses.cloneAssignmentId, cloneAssignmentId),
        eq(studyGeneratedResponses.bankItemId, bankItemId)
      )
    );
  // Refuse rather than record a prediction we cannot show an answer to: the
  // pair is the measurement.
  if (!generated) return { error: 'no_response' };

  await db
    .insert(studyTestAnswers)
    .values({
      participantId: participant.id,
      cloneAssignmentId,
      bankItemId,
      guess,
      guessedAt: new Date(),
    })
    // A re-submitted guess keeps the FIRST one: the second would be made with
    // the answer already seen.
    .onConflictDoNothing({
      target: [studyTestAnswers.cloneAssignmentId, studyTestAnswers.bankItemId],
    });

  return { response: generated.response };
}

export async function recordRating(args: {
  cloneAssignmentId: string;
  bankItemId: number;
  rating: number;
}): Promise<void> {
  await db
    .update(studyTestAnswers)
    .set({ rating: args.rating, ratedAt: new Date() })
    .where(
      and(
        eq(studyTestAnswers.cloneAssignmentId, args.cloneAssignmentId),
        eq(studyTestAnswers.bankItemId, args.bankItemId)
      )
    );
}

/* ------------------------------------------------------------------ */
/* Blind A/B                                                           */
/* ------------------------------------------------------------------ */

export type AbChoice = 'left' | 'right' | 'both' | 'neither';

export interface AbItem extends MeasureQuestion {
  datasetKey: string;
  leftCloneAssignmentId: string;
  rightCloneAssignmentId: string;
  leftResponse: string;
  rightResponse: string;
  choice: AbChoice | null;
}

/**
 * Deterministic side assignment: stable across reloads (so a participant who
 * refreshes does not see the answers swap) and independent per item (so a
 * participant cannot learn "the left one is always the same chatbot").
 */
export function sideSeed(participantId: string, bankItemId: number): boolean {
  let hash = 2166136261;
  const key = `${participantId}:${bankItemId}`;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash % 2 === 0;
}

/**
 * The A/B items across BOTH datasets, in bank order, with each configuration's
 * frozen answer already assigned to a side. Items whose answers are not all
 * generated are omitted rather than shown half-filled.
 */
export async function getAbItems(participant: StudyParticipant): Promise<AbItem[]> {
  const plan = blockPlan(participant.participantNumber);
  const clones = await db
    .select()
    .from(studyClones)
    .where(eq(studyClones.participantId, participant.id));
  if (clones.length < 2) return [];

  const block1 = clones.find(
    (c) => c.datasetKey === plan.find((p) => p.block === 1)?.datasetKey
  );
  const block2 = clones.find(
    (c) => c.datasetKey === plan.find((p) => p.block === 2)?.datasetKey
  );
  if (!block1 || !block2) return [];

  const bank = await db.select().from(studyQuestionBank).where(eq(studyQuestionBank.kind, 'ab'));
  if (bank.length === 0) return [];
  const ids = bank.map((b) => b.id);

  const [responses, answers] = await Promise.all([
    db
      .select({
        cloneAssignmentId: studyGeneratedResponses.cloneAssignmentId,
        bankItemId: studyGeneratedResponses.bankItemId,
        response: studyGeneratedResponses.response,
      })
      .from(studyGeneratedResponses)
      .where(
        and(
          inArray(studyGeneratedResponses.cloneAssignmentId, [
            block1.assignmentId,
            block2.assignmentId,
          ]),
          inArray(studyGeneratedResponses.bankItemId, ids)
        )
      ),
    db
      .select()
      .from(studyAbAnswers)
      .where(
        and(
          eq(studyAbAnswers.participantId, participant.id),
          inArray(studyAbAnswers.bankItemId, ids)
        )
      ),
  ]);
  const responseByKey = new Map(
    responses.map((r) => [`${r.cloneAssignmentId}:${r.bankItemId}`, r.response])
  );
  const answerByItem = new Map(answers.map((a) => [a.bankItemId, a]));

  const items: AbItem[] = [];
  for (const item of bank.sort((a, b) => a.position - b.position)) {
    const first = responseByKey.get(`${block1.assignmentId}:${item.id}`);
    const second = responseByKey.get(`${block2.assignmentId}:${item.id}`);
    if (!first || !second) continue;

    const stored = answerByItem.get(item.id);
    // A previously answered item keeps the sides it was answered on.
    const block1Left = stored
      ? stored.leftCloneAssignmentId === block1.assignmentId
      : sideSeed(participant.id, item.id);

    items.push({
      bankItemId: item.id,
      position: item.position,
      datasetKey: item.datasetKey,
      context: readContext(item.context),
      question: item.question,
      leftCloneAssignmentId: block1Left ? block1.assignmentId : block2.assignmentId,
      rightCloneAssignmentId: block1Left ? block2.assignmentId : block1.assignmentId,
      leftResponse: block1Left ? first : second,
      rightResponse: block1Left ? second : first,
      choice: (stored?.choice as AbChoice | undefined) ?? null,
    });
  }
  return items;
}

export async function recordAbChoice(args: {
  participant: StudyParticipant;
  bankItemId: number;
  leftCloneAssignmentId: string;
  rightCloneAssignmentId: string;
  choice: AbChoice;
}): Promise<void> {
  const values = {
    participantId: args.participant.id,
    bankItemId: args.bankItemId,
    leftCloneAssignmentId: args.leftCloneAssignmentId,
    rightCloneAssignmentId: args.rightCloneAssignmentId,
    choice: args.choice,
    answeredAt: new Date(),
  };
  await db
    .insert(studyAbAnswers)
    .values(values)
    .onConflictDoUpdate({
      target: [studyAbAnswers.participantId, studyAbAnswers.bankItemId],
      set: { choice: args.choice, answeredAt: values.answeredAt },
    });
}
