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
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { db } from '@/db/db';
import {
  assignments,
  baselinePromptVersions,
  scoreDissections,
  studyClones,
  studyGeneratedResponses,
  studyQuestionBank,
  studyTestAnswers,
  type StudyParticipant,
} from '@/db/schema';
import { getLatestChatDeploy } from '@/lib/score/deploy-store';
import type { SnapshotConfig } from '@/components/study/SnapshotConfigView';
import { armOf, familyOf, type StudioView } from './config';
import { assignmentBasePrompt } from '@/lib/assignment-ai';
import { getSimpleSaved } from './simple/store';
import { blockPlan } from './phases';

/**
 * How a pasted run of Material reads: the kind, and how much of its source the
 * student pasted. Mirrors the board's own tags so a participant meets a
 * question here looking the way it looked while they were configuring.
 */
export interface QuestionMaterials {
  materialKinds: string[];
  requests: string[];
  materials?: { text: string; kind: string; chars: number; sourceChars?: number }[];
}

export interface MeasureQuestion {
  bankItemId: number;
  position: number;
  /** `materials` is present only on student turns the bank froze WITH an id. */
  context: { role: 'user' | 'assistant'; content: string; materials?: QuestionMaterials | null }[];
  question: string;
  /** The question's own Material tags, from the master's dissection. */
  questionMaterials: QuestionMaterials | null;
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

interface FrozenTurn {
  role: 'user' | 'assistant';
  content: string;
  /** Present only on banks built after Material tags were carried through. */
  messageId?: number;
}

function readContext(raw: unknown): FrozenTurn[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (t): t is FrozenTurn =>
      !!t &&
      typeof t === 'object' &&
      ((t as { role?: unknown }).role === 'user' || (t as { role?: unknown }).role === 'assistant') &&
      typeof (t as { content?: unknown }).content === 'string'
  );
}

/**
 * The Material tags for a set of master messages.
 *
 * Read straight from score_dissections, which is keyed by message id alone —
 * the bank keeps the master's id per question, so the tags a participant saw
 * while configuring are the tags they see here. Missing rows are normal (a
 * question with no pasted Material has nothing to dissect) and read as null.
 */
async function materialsByMessage(ids: number[]): Promise<Map<number, QuestionMaterials>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      messageId: scoreDissections.messageId,
      materialKinds: scoreDissections.materialKinds,
      requests: scoreDissections.requests,
      materials: scoreDissections.materials,
    })
    .from(scoreDissections)
    .where(inArray(scoreDissections.messageId, ids));
  return new Map(
    rows.map((r) => [
      r.messageId,
      {
        materialKinds: (r.materialKinds as string[]) ?? [],
        requests: (r.requests as string[]) ?? [],
        materials: (r.materials as QuestionMaterials['materials']) ?? undefined,
      },
    ])
  );
}

/** The clone a given block belongs to. */
export async function cloneForBlock(
  participant: StudyParticipant,
  block: 1 | 2
): Promise<{
  assignmentId: string;
  datasetKey: string;
  /** The arm, which is what every measurement branches on. */
  condition: 'score' | 'baseline';
  /** The whole condition, for the one thing that needs the family too:
   * where to read the configuration from. */
  view: StudioView;
} | null> {
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
    condition: armOf(clone.condition as StudioView),
    view: clone.condition as StudioView,
  };
}

/** The deployed configuration, shaped for SnapshotConfigView. */
export async function deployedConfigFor(clone: {
  assignmentId: string;
  condition: 'score' | 'baseline';
  /** The full StudioView, when the caller has it — the simple version reads a
   * saved snapshot rather than a deploy. Optional so older callers still
   * compile into the full version's behaviour. */
  view?: StudioView;
}): Promise<SnapshotConfig | null> {
  if (clone.view && familyOf(clone.view) === 'simple') return simpleConfigFor(clone.assignmentId, clone.view);
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
 * The simple version's configuration, in the same shape the panel already
 * reads. Its newest saved version IS what a question is answered against, so
 * there is no deploy to look up — and its tree has one root rather than one
 * per query type, which is what `flat` tells the panel.
 */
async function simpleConfigFor(
  assignmentId: string,
  view: StudioView
): Promise<SnapshotConfig | null> {
  const [assignment] = await db.select().from(assignments).where(eq(assignments.id, assignmentId));
  // The saved one — the same configuration the frozen answers came from, so
  // the panel a participant reads while predicting is the one that answered.
  const tip = await getSimpleSaved({
    assignmentId,
    condition: view,
    seedPrompt: assignment ? assignmentBasePrompt(assignment) : '',
  });
  if (!tip.version) return null;
  const versionLabel = `v${tip.version.versionNo}`;
  if (tip.snapshot.arm === 'baseline') {
    return { condition: 'baseline', versionLabel, rules: tip.snapshot.prompt, flat: true };
  }
  return {
    condition: 'score',
    versionLabel,
    flat: true,
    intents: [
      ...tip.snapshot.intents.map((intent, i) => ({
        id: intent.sid,
        title: intent.title,
        definition: intent.definition,
        rule: intent.rule,
        kind: 'intent',
        type: null,
        parentId: intent.parentSid,
        // Array position IS the order in a snapshot, so it becomes the
        // position the shared ordering helper expects.
        position: i,
      })),
      {
        id: -1,
        title: 'Everything else',
        definition: '',
        rule: tip.snapshot.rootRule,
        kind: 'type_root',
        type: null,
        parentId: null,
        position: null,
      },
    ],
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
  // Material tags for the questions, and for the earlier student turns where
  // the bank kept an id. Older banks froze context without ids, so those turns
  // simply render plain — the question, which is what routes, always has one.
  const contextIds = bank.flatMap((item) =>
    readContext(item.context)
      .map((t) => t.messageId)
      .filter((id): id is number => typeof id === 'number')
  );
  const materials = await materialsByMessage([
    ...new Set([
      ...bank.map((b) => b.sourceMessageId).filter((id): id is number => typeof id === 'number'),
      ...contextIds,
    ]),
  ]);

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
      context: readContext(item.context).map((t) => ({
        role: t.role,
        content: t.content,
        materials: t.messageId ? materials.get(t.messageId) ?? null : null,
      })),
      question: item.question,
      questionMaterials: item.sourceMessageId
        ? materials.get(item.sourceMessageId) ?? null
        : null,
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
 * Per-step durations for one block-test item, in ms from when it appeared.
 *
 * Written by the client, which is the only place that can see them: the whole
 * prediction is one write, so nothing server-side sits between the pointing
 * step and the yes/no. `study_test_answers.timing` documents the fields.
 */
export interface StepTiming {
  pointFirst?: number;
  point?: number;
  pointChanges?: number;
  expectStart?: number;
  expectEnd?: number;
  guess?: number;
  submit?: number;
  reveal?: number;
  rate?: number;
  probe?: number;
}

/**
 * MERGE the new durations into whatever the row already holds, rather than
 * replacing them: the two passes write the same row minutes apart, and Pass 2
 * knows nothing about the pointing time Pass 1 measured. Empty patch → no
 * column in the update at all, so a client that sends nothing cannot blank it.
 */
function timingPatch(timing?: StepTiming | null) {
  if (!timing || Object.keys(timing).length === 0) return {};
  return {
    timing: sql`coalesce(${studyTestAnswers.timing}, '{}'::jsonb) || ${JSON.stringify(timing)}::jsonb`,
  };
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
  /** Per-step durations from when the question appeared (ms) — see schema. */
  timing?: StepTiming | null;
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
      timing: args.timing ?? null,
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
  timing?: StepTiming | null;
}): Promise<{ ok: boolean }> {
  const updated = await db
    .update(studyTestAnswers)
    .set({
      rating: args.rating,
      // Above the fold there is no "what's off" to keep; clearing it stops a
      // stale answer surviving a corrected rating.
      whatsOff: args.rating <= 3 ? args.whatsOff?.trim() || null : null,
      ratedAt: new Date(),
      ...timingPatch(args.timing),
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
  timing?: StepTiming | null;
}): Promise<{ ok: boolean }> {
  const updated = await db
    .update(studyTestAnswers)
    .set({ probe: args.probe.trim() || null, ...timingPatch(args.timing) })
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
