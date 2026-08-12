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
 * A per-participant presentation order.
 *
 * Every participant seeing the same order would put whatever the first item
 * happens to ask under "fresh attention" and the last under fatigue, for
 * everyone alike — an order effect that never averages out. Seeded rather than
 * random so a reload or a mid-item refresh does not reshuffle the questions
 * under someone.
 *
 * The bank's own `position` is NOT the presentation order; it is the canonical
 * balanced-block order, which is what any decision to show fewer items has to
 * cut from. Select first, then shuffle what is shown.
 */
function seededShuffle<T>(items: T[], seedKey: string): T[] {
  let seed = 2166136261;
  for (let i = 0; i < seedKey.length; i++) {
    seed ^= seedKey.charCodeAt(i);
    seed = Math.imul(seed, 16777619) >>> 0;
  }
  const next = () => {
    // xorshift32 — plenty for shuffling a dozen items reproducibly.
    seed ^= seed << 13;
    seed >>>= 0;
    seed ^= seed >> 17;
    seed ^= seed << 5;
    seed >>>= 0;
    return seed / 0x100000000;
  };
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
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

  const ordered = seededShuffle(
    bank.slice().sort((a, b) => a.position - b.position),
    `test:${participant.id}:${clone.datasetKey}`
  );

  return ordered
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
