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
  /** Pass 1's written description of what they expect (문항지 §3 ①). */
  expectation: string | null;
  guess: boolean | null;
  /** Null until pointed; replayed so a reload resumes mid-item. */
  pointing: Pointing | null;
  rating: number | null;
  /** Opens at a rating of 3 or less (§3 ③). */
  whatsOff: string | null;
  /** Opens only where the prediction missed (§3 ④); may be left blank. */
  probe: string | null;
  /**
   * Whether this item's prediction missed — the condition §3 ④ opens the probe
   * on. Computed server-side and only once the rating is in, because half of
   * it IS the rating and the other half is the routing record, which the
   * participant never sees.
   */
  missed: boolean | null;
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
  const datasetKey = blockPlan(participant).find((p) => p.block === block)
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
        applied: studyGeneratedResponses.applied,
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
  const appliedByItem = new Map(responses.map((r) => [r.bankItemId, r.applied]));

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
      expectation: answer?.expectation ?? null,
      guess: guessed,
      pointing,
      rating: answer?.rating ?? null,
      whatsOff: answer?.whatsOff ?? null,
      probe: answer?.probe ?? null,
      // Null until rated: the fold needs the rating, and releasing the routing
      // comparison earlier would hand back part of the answer.
      missed:
        answer?.rating == null
          ? null
          : predictionMissed({
              guess: guessed,
              rating: answer.rating,
              pointing,
              applied: appliedByItem.get(item.id) ?? null,
            }),
      response: predictionsDone ? responseByItem.get(item.id) ?? null : null,
    };
  });
}

/**
 * Did the prediction miss? — the condition §3 ④ opens the probe on.
 *
 * Two independent halves, either of which counts: the yes/no against the
 * participant's own rating folded at 3 ("접기 규칙: 5점 3 이하 = '아니오'"), and
 * — SCORE only — the intent they pointed at against the one that actually
 * fired. Baseline has no objective second half, so a highlighted span never
 * counts as a miss on its own; "not sure" is a real answer and is not scored
 * either way.
 *
 * Same rules as the export's pointing_correct, deliberately: a probe asked in
 * the room and a finding computed afterwards have to be about the same items.
 */
export function predictionMissed(args: {
  guess: boolean | null;
  rating: number | null;
  pointing: Pointing | null;
  applied: unknown;
}): boolean {
  const { guess, rating, pointing } = args;
  if (guess !== null && rating !== null && guess !== rating >= 4) return true;

  const applied = (args.applied ?? null) as { outcome?: string; intentId?: number } | null;
  if (pointing?.kind === 'intent') {
    return !(applied?.outcome === 'intent' && applied?.intentId === pointing.intentId);
  }
  if (pointing?.kind === 'none') {
    return !(applied == null || applied.outcome === 'type_default');
  }
  return false;
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

/** Is there a frozen answer for this item at all? */
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
 * Record a whole prediction — description, yes/no, and pointing — in one write.
 *
 * One call because the participant now enters all three and presses Next
 * (문항지 §3 Pass 1, 08-15): there is no moment between them where a partial
 * prediction means anything, and three round trips would give a half-recorded
 * item three ways to end up wrong.
 *
 * First submission wins for the item as a whole. Nothing is released here —
 * the answers unlock only when the last of the eight lands (see the gate in
 * getTestItems) — so a participant is free to change their mind up until Next,
 * and has learned nothing that could inform a second attempt afterwards.
 */
export async function recordPrediction(args: {
  participant: StudyParticipant;
  cloneAssignmentId: string;
  bankItemId: number;
  expectation: string;
  guess: boolean;
  pointing: Pointing;
}): Promise<{ ok: true } | { error: 'no_response' }> {
  const { participant, cloneAssignmentId, bankItemId, expectation, guess, pointing } = args;

  // Refuse rather than record a prediction we cannot show an answer to: the
  // pair is the measurement.
  if (!(await hasResponse(cloneAssignmentId, bankItemId))) return { error: 'no_response' };

  const now = new Date();
  await db
    .insert(studyTestAnswers)
    .values({
      participantId: participant.id,
      cloneAssignmentId,
      bankItemId,
      expectation,
      guess,
      pointedKind: pointing.kind,
      pointedIntentId: pointing.kind === 'intent' ? pointing.intentId : null,
      pointedSpanStart: pointing.kind === 'span' ? pointing.start : null,
      pointedSpanEnd: pointing.kind === 'span' ? pointing.end : null,
      pointedText: pointing.kind === 'span' ? pointing.text : null,
      guessedAt: now,
      pointedAt: now,
    })
    // A re-submitted prediction keeps the FIRST one.
    .onConflictDoNothing({
      target: [studyTestAnswers.cloneAssignmentId, studyTestAnswers.bankItemId],
    });
  return { ok: true };
}

/**
 * Record the 1-5 fit rating, and "what's off" when the rating opens it.
 *
 * Only reachable once the answers have been released, which now means the
 * WHOLE block has been predicted — a rating is a judgement of something seen,
 * and nothing in this block is seen before then. The caller checks the
 * block-wide half (it holds the clone); the per-item `pointedAt` rides in the
 * WHERE rather than in a prior read, so neither can slip past on a client's
 * say-so.
 */
export async function recordRating(args: {
  cloneAssignmentId: string;
  bankItemId: number;
  rating: number;
  whatsOff?: string | null;
}): Promise<{ ok: boolean }> {
  const updated = await db
    .update(studyTestAnswers)
    .set({
      rating: args.rating,
      // Above the fold there is no "what's off" to keep; clearing it stops a
      // stale answer surviving a corrected rating.
      whatsOff: args.rating <= 3 ? args.whatsOff?.trim() || null : null,
      ratedAt: new Date(),
    })
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

/**
 * Record the probe (§3 ④) — optional by design, so a blank one is a real
 * answer and saved as null rather than refused. Only accepted after a rating,
 * because that is when the box opens.
 */
export async function recordProbe(args: {
  cloneAssignmentId: string;
  bankItemId: number;
  probe: string;
}): Promise<{ ok: boolean }> {
  const updated = await db
    .update(studyTestAnswers)
    .set({ probe: args.probe.trim() || null })
    .where(
      and(
        eq(studyTestAnswers.cloneAssignmentId, args.cloneAssignmentId),
        eq(studyTestAnswers.bankItemId, args.bankItemId),
        isNotNull(studyTestAnswers.ratedAt)
      )
    )
    .returning({ id: studyTestAnswers.id });
  return { ok: updated.length > 0 };
}
