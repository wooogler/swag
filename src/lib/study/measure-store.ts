/**
 * Reads and writes for the block-test screen.
 *
 * The one rule that shapes this module: a frozen response is released to the
 * participant only AFTER their prediction is recorded — and design v2 §5 made
 * the prediction two things, a yes/no and a POINT at the part of the
 * configuration they expect to act. Both must be on record before the answer
 * is released, because pointing after seeing the answer is not a prediction.
 * The gate lives on the server and the client is never sent an answer it
 * should not have yet.
 *
 * Both halves are first-answer-wins for the same reason: a second attempt is
 * made with knowledge the first did not have.
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

/** Where the participant expects the answer to come from, before seeing it. */
export type Pointing =
  | { kind: 'intent'; intentId: number }
  | { kind: 'none' }
  | { kind: 'not_sure' }
  | { kind: 'span'; start: number; end: number; text: string }
  | { kind: 'nothing' };

export interface TestItem extends MeasureQuestion {
  guess: boolean | null;
  /** Null until pointed; replayed so a reload resumes mid-item. */
  pointing: Pointing | null;
  rating: number | null;
  /** Present ONLY once EVERY item in the block has been predicted. */
  response: string | null;
}

/** Rebuild the stored columns into the shape the client sent. */
function readPointing(row: {
  pointedKind: string | null;
  pointedIntentId: number | null;
  pointedSpanStart: number | null;
  pointedSpanEnd: number | null;
  pointedText: string | null;
}): Pointing | null {
  switch (row.pointedKind) {
    case 'intent':
      return row.pointedIntentId === null ? null : { kind: 'intent', intentId: row.pointedIntentId };
    case 'span':
      return row.pointedSpanStart === null || row.pointedSpanEnd === null
        ? null
        : {
            kind: 'span',
            start: row.pointedSpanStart,
            end: row.pointedSpanEnd,
            text: row.pointedText ?? '',
          };
    case 'none':
    case 'not_sure':
    case 'nothing':
      return { kind: row.pointedKind };
    default:
      return null;
  }
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

  // THE GATE, and it is block-wide: not one answer is released until every
  // question in the block has been predicted.
  //
  // Per-item release let an early answer teach the participant what this
  // configuration does, and they carried that lesson into the predictions that
  // followed — so items 6-8 measured a participant who had been shown six
  // worked examples, and items 1-3 one who had not. The predictions have to be
  // made under the same information, which means all of them before any reveal.
  // Checked on `pointedAt` rather than on the reconstructed pointing so an
  // unreadable row fails closed.
  const predictionsDone = bank.every((item) => {
    const answer = answerByItem.get(item.id);
    return answer?.guess != null && answer?.pointedAt != null;
  });

  return ordered.map((item) => {
    const answer = answerByItem.get(item.id);
    const guessed = answer?.guess ?? null;
    const pointing = answer ? readPointing(answer) : null;
    return {
      bankItemId: item.id,
      position: item.position,
      context: readContext(item.context),
      question: item.question,
      guess: guessed,
      pointing,
      rating: answer?.rating ?? null,
      response: predictionsDone ? responseByItem.get(item.id) ?? null : null,
    };
  });
}

/**
 * Has every question in this block been predicted?
 *
 * The reveal pass and the rating both hang off this, and both are checked
 * server-side — the client's idea of which pass it is in never decides what it
 * is allowed to see.
 */
export async function predictionsComplete(clone: {
  assignmentId: string;
  datasetKey: string;
}): Promise<boolean> {
  const bank = await db
    .select({ id: studyQuestionBank.id })
    .from(studyQuestionBank)
    .where(
      and(eq(studyQuestionBank.datasetKey, clone.datasetKey), eq(studyQuestionBank.kind, 'test'))
    );
  if (bank.length === 0) return false;
  const answers = await db
    .select({ bankItemId: studyTestAnswers.bankItemId })
    .from(studyTestAnswers)
    .where(
      and(
        eq(studyTestAnswers.cloneAssignmentId, clone.assignmentId),
        inArray(
          studyTestAnswers.bankItemId,
          bank.map((b) => b.id)
        ),
        isNotNull(studyTestAnswers.guess),
        isNotNull(studyTestAnswers.pointedAt)
      )
    );
  return answers.length === bank.length;
}

/**
 * Record the yes/no half of the prediction. Releases nothing — the pointing
 * step comes next and the reveal belongs to it.
 */
export async function recordGuess(args: {
  participant: StudyParticipant;
  cloneAssignmentId: string;
  bankItemId: number;
  guess: boolean;
}): Promise<{ ok: true } | { error: 'no_response' }> {
  const { participant, cloneAssignmentId, bankItemId, guess } = args;

  // Refuse rather than record a prediction we cannot show an answer to: the
  // pair is the measurement.
  if (!(await hasResponse(cloneAssignmentId, bankItemId))) return { error: 'no_response' };

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

  return { ok: true };
}

async function hasResponse(cloneAssignmentId: string, bankItemId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: studyGeneratedResponses.id })
    .from(studyGeneratedResponses)
    .where(
      and(
        eq(studyGeneratedResponses.cloneAssignmentId, cloneAssignmentId),
        eq(studyGeneratedResponses.bankItemId, bankItemId)
      )
    );
  return !!row;
}

/**
 * Record where they expect the answer to come from. Releases nothing.
 *
 * This closes the prediction for one question, not the block: the answers
 * arrive together once the last question has been predicted (see the gate in
 * getTestItems). Refuses without a guess on record, which is what makes the
 * questionnaire's order (describe → guess → point) enforceable rather than
 * merely rendered, and keeps the first pointing the way it keeps the first
 * guess. Still checks that a frozen answer EXISTS — a prediction we could
 * never show an answer to is not the measurement, and that is worth failing on
 * now rather than at the reveal.
 */
export async function recordPointing(args: {
  cloneAssignmentId: string;
  bankItemId: number;
  pointing: Pointing;
}): Promise<{ ok: true } | { error: 'no_response' | 'guess_first' }> {
  const { cloneAssignmentId, bankItemId, pointing } = args;

  const [existing] = await db
    .select()
    .from(studyTestAnswers)
    .where(
      and(
        eq(studyTestAnswers.cloneAssignmentId, cloneAssignmentId),
        eq(studyTestAnswers.bankItemId, bankItemId)
      )
    );
  if (!existing || existing.guess === null) return { error: 'guess_first' };

  if (!(await hasResponse(cloneAssignmentId, bankItemId))) return { error: 'no_response' };

  // Already pointed → keep the first answer and report success, so a reload
  // lands where it left off instead of erroring.
  if (existing.pointedAt == null) {
    await db
      .update(studyTestAnswers)
      .set({
        pointedKind: pointing.kind,
        pointedIntentId: pointing.kind === 'intent' ? pointing.intentId : null,
        pointedSpanStart: pointing.kind === 'span' ? pointing.start : null,
        pointedSpanEnd: pointing.kind === 'span' ? pointing.end : null,
        pointedText: pointing.kind === 'span' ? pointing.text : null,
        pointedAt: new Date(),
      })
      .where(eq(studyTestAnswers.id, existing.id));
  }

  return { ok: true };
}

/**
 * Record the 1-5 fit rating. Only reachable once the answer has been released,
 * which now means the WHOLE block has been predicted — a rating is a judgement
 * of something seen, and nothing in this block is seen before then. The caller
 * checks the block-wide half (it holds the clone); the per-item `pointedAt`
 * rides in the WHERE rather than in a prior read, so neither can slip past on
 * a client's say-so.
 */
export async function recordRating(args: {
  cloneAssignmentId: string;
  bankItemId: number;
  rating: number;
}): Promise<{ ok: boolean }> {
  const updated = await db
    .update(studyTestAnswers)
    .set({ rating: args.rating, ratedAt: new Date() })
    .where(
      and(
        eq(studyTestAnswers.cloneAssignmentId, args.cloneAssignmentId),
        eq(studyTestAnswers.bankItemId, args.bankItemId),
        isNotNull(studyTestAnswers.pointedAt)
      )
    )
    .returning({ id: studyTestAnswers.id });
  return { ok: updated.length > 0 };
}
