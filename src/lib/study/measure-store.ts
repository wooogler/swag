/**
 * Reads and writes for the block-test screen (docs/BLOCK_TEST v3.md).
 *
 * The one rule that shapes this module: a frozen response is released to the
 * participant only AFTER their prediction is recorded — and v3 §4 makes the
 * prediction four things: how it SHOULD ideally answer (Q1), a POINT at the
 * part of the configuration that will handle it (Q2), how confidently they can
 * anticipate the answer (Q3), and whether they expect it to be educationally
 * desirable (Q4). All four are on record before the answer is released,
 * because none of them is a prediction once the answer is on screen. The gate
 * lives on the server and the client is never sent an answer it should not
 * have yet.
 *
 * The prediction is first-answer-wins for the same reason: a second attempt is
 * made with knowledge the first did not have. Pass 2's judgements are NOT —
 * revising a rating is a second thought about the same visible response, and
 * how often it happens is itself logged (§6-7).
 *
 * WHAT ELSE IS HELD BACK, AND UNTIL WHEN (§3.2). The intent that actually
 * fired — the "Matched" chip — is released only once BOTH judgements are in
 * and one of them is negative. Shown any earlier it answers Q6 for them
 * ("it went where I said, so it must follow my setup") and drags Q5 with it.
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
import { armOf, familyOf, isStudioView, type StudioView } from './config';
import { assignmentBasePrompt } from '@/lib/assignment-ai';
import { getSimpleDeployed } from './simple/store';
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

/** One stretch of the baseline prompt, as pointed at. */
export interface PointedSpan {
  start: number;
  end: number;
  text: string;
}

/**
 * Where the participant expects the answer to come from, before seeing it.
 *
 * `span` carries a LIST. A monolithic prompt rarely addresses a question in
 * one place — a tone line at the top, a "never write it for them" halfway
 * down — and forcing one selection would make the answer a choice about which
 * of their own sentences counts most, which is not the question being asked.
 */
export type Pointing =
  | { kind: 'intent'; intentId: number }
  | { kind: 'none' }
  | { kind: 'not_sure' }
  | { kind: 'span'; spans: PointedSpan[] }
  | { kind: 'nothing' };

export interface TestItem extends MeasureQuestion {
  /** Q1 — how it should IDEALLY answer, in their own words. */
  ideal: string | null;
  /** Q2 — null until pointed; replayed so a reload resumes mid-item. */
  pointing: Pointing | null;
  /** Q3, Q4 — 6-point agreement. */
  confidence: number | null;
  expectDesirable: number | null;
  /** Q5, Q6 — 6-point agreement, after the response is on screen. */
  desirable: number | null;
  follows: number | null;
  /** P and F — the free text the negative half opens; may be left blank. */
  probe: string | null;
  repair: string | null;
  /**
   * What actually answered (§4 ③) — the intent, or the fact that none did.
   *
   * Carries the ID as well as the name, because the panel is where this is
   * shown: the row that answered gets a badge in the participant's own setup,
   * beside the row they picked, and a name alone cannot find a row. `intentId`
   * is null when nothing claimed the question — that is Uncategorized, which
   * has a row too.
   *
   * SCORE only, and released ONLY with the probe panel: both judgements in and
   * at least one of them negative. Null everywhere else, so a client that
   * renders early has nothing to render.
   */
  matched: { label: string; intentId: number | null } | null;
  /** Present ONLY once EVERY item in the block has been predicted. */
  response: string | null;
}

/** The fold every conditional in the instrument runs on: 1-3 negative, 4-6
 * positive (§3.3). One rule, no midpoint to arbitrate. */
export function negative(value: number | null | undefined): boolean {
  return typeof value === 'number' && value <= 3;
}

/** Does the probe panel open on this item? — §4 ③, and the only gate that
 * releases the Matched chip. */
export function probeOpens(desirable: number | null, follows: number | null): boolean {
  if (desirable === null || follows === null) return false;
  return negative(desirable) || negative(follows);
}

/**
 * Rebuild the stored columns into the shape the client sent.
 *
 * Exported because the export scores pointing too, and a second reader written
 * against the same five columns is a second place for "none" to drift away
 * from meaning "the default rule".
 */
export function readPointing(row: {
  pointedKind: string | null;
  pointedIntentId: number | null;
  pointedSpans?: unknown;
  pointedSpanStart: number | null;
  pointedSpanEnd: number | null;
  pointedText: string | null;
}): Pointing | null {
  switch (row.pointedKind) {
    case 'intent':
      return row.pointedIntentId === null ? null : { kind: 'intent', intentId: row.pointedIntentId };
    case 'span': {
      const spans = readSpans(row.pointedSpans);
      if (spans.length > 0) return { kind: 'span', spans };
      // The pilot's one-span rows, read as a list of one.
      if (row.pointedSpanStart === null || row.pointedSpanEnd === null) return null;
      return {
        kind: 'span',
        spans: [
          { start: row.pointedSpanStart, end: row.pointedSpanEnd, text: row.pointedText ?? '' },
        ],
      };
    }
    case 'none':
    case 'not_sure':
    case 'nothing':
      return { kind: row.pointedKind };
    default:
      return null;
  }
}

/** jsonb is `unknown` until proven otherwise — a malformed row reads empty
 * rather than crashing the screen it is on. */
function readSpans(raw: unknown): PointedSpan[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (s): s is PointedSpan =>
      !!s &&
      typeof s === 'object' &&
      typeof (s as PointedSpan).start === 'number' &&
      typeof (s as PointedSpan).end === 'number' &&
      typeof (s as PointedSpan).text === 'string'
  );
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
  // The DEPLOYED one — the configuration they stood behind, and the same one
  // the frozen answers came from, so the panel a participant reads while
  // predicting is the one that answered.
  const tip = await getSimpleDeployed({
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
        parentId: null,
        // Array position IS the order in a snapshot, so it becomes the
        // position the shared ordering helper expects.
        position: i,
      })),
      {
        id: -1,
        title: 'Uncategorized',
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
 * The block-test items for one clone, with each item's answer state. No
 * response is attached until the whole block has been predicted — see the
 * module comment and the gate below.
 */
export async function getTestItems(
  participant: StudyParticipant,
  clone: {
    assignmentId: string;
    datasetKey: string;
    /**
     * The arm, or the full view — either reads. Needed for ONE thing: the
     * Matched chip is a SCORE device and must not appear in baseline, which
     * has no first-match to report and whose participants should never be
     * handed the vocabulary of one (§7: C2/C3 are structurally impossible
     * there, and that asymmetry is a finding, not something to paper over).
     * Absent or unreadable withholds the chip rather than guessing.
     */
    condition?: string;
  }
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
  // followed — so the last items measured a participant who had been shown
  // worked examples and the first ones one who had not. The predictions have
  // to be made under the same information, which means all of them before any
  // reveal (§3.1: it is confidence, Q3, that per-item release corrupts worst).
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

  const arm = isStudioView(clone.condition) ? armOf(clone.condition) : null;

  const predictionsDone = bank.every((item) => {
    const answer = answerByItem.get(item.id);
    return answer?.expectDesirable != null && answer?.pointedAt != null;
  });

  return ordered.map((item) => {
    const answer = answerByItem.get(item.id);
    const pointing = answer ? readPointing(answer) : null;
    const desirable = answer?.desirable ?? null;
    const follows = answer?.followsSetup ?? null;
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
      ideal: answer?.ideal ?? null,
      pointing,
      confidence: answer?.confidence ?? null,
      expectDesirable: answer?.expectDesirable ?? null,
      desirable,
      follows,
      probe: answer?.probe ?? null,
      repair: answer?.repair ?? null,
      // Held back until the probe panel is the thing on screen (§3.2), and
      // computed here rather than sent as raw routing so the client has no
      // copy of the answer it is not showing.
      matched:
        arm === 'score' && probeOpens(desirable, follows)
          ? matchedLabel(appliedByItem.get(item.id) ?? null)
          : null,
      response: predictionsDone ? responseByItem.get(item.id) ?? null : null,
    };
  });
}

/** The routing audit as the generator wrote it. */
export type AppliedRouting = {
  outcome?: string;
  intentId?: number;
  intentTitle?: string;
} | null;

/**
 * The "Matched: …" chip (§4 ③) — what actually handled the question.
 *
 * A phrase and not an id, because it is read inside the probe panel by the
 * person who wrote the intent. "None" is said out loud rather than left blank:
 * a question falling to the default rule is the coverage gap C1 is about, and
 * an empty chip would read as missing data.
 */
export function matchedLabel(applied: AppliedRouting): { label: string; intentId: number | null } {
  if (applied?.outcome === 'intent') {
    return {
      label: applied.intentTitle ?? `intent #${applied.intentId ?? '?'}`,
      intentId: applied.intentId ?? null,
    };
  }
  // Named as the participant's own list names it, not as the chain names it.
  return { label: 'Uncategorized', intentId: null };
}

/**
 * Was the pointing (Q2) right? — the routing accuracy of §5, and the only
 * comprehension measure that is statistically independent of the judgements.
 *
 * SCORE only: null for baseline, which has no first-match to be right about,
 * and null for "I don't know", which is a real answer and is scored as its own
 * rate rather than as a wrong one.
 *
 * ONE definition, used by the console and the export both — a number a
 * facilitator reads in the room and a column an analyst reads afterwards have
 * to be about the same items.
 */
export function pointingCorrect(pointing: Pointing | null, applied: AppliedRouting): boolean | null {
  if (pointing?.kind === 'intent') {
    return applied?.outcome === 'intent' && applied?.intentId === pointing.intentId;
  }
  if (pointing?.kind === 'none') {
    return applied == null || applied.outcome === 'type_default';
  }
  return null;
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
        isNotNull(studyTestAnswers.expectDesirable),
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
  /** Pass 1 · Q1's first and last keystroke. */
  idealStart?: number;
  idealEnd?: number;
  /** Pass 1 · Q2: the first pointing, the one that survived to Next, and how
   * many times it changed in between (§6-7). */
  pointFirst?: number;
  point?: number;
  pointChanges?: number;
  /** Pass 1 · Q3, Q4, Next. */
  confidence?: number;
  expectDesirable?: number;
  submit?: number;
  /** Pass 2 · the reveal, then each judgement and how often it was revised —
   * the drift §10-5 says to watch for. */
  reveal?: number;
  desirable?: number;
  follows?: number;
  desirableChanges?: number;
  followsChanges?: number;
  /** Pass 2 · whether the probe panel opened at all, and what was written in
   * it (§6-7: open/closed and the character counts). */
  probeOpened?: number;
  probe?: number;
  repair?: number;
  probeChars?: number;
  repairChars?: number;
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
 * Record a whole prediction — Q1 through Q4 — in one write.
 *
 * One call because the participant enters all four and presses Next (§4 Pass
 * 1): there is no moment between them where a partial prediction means
 * anything, and four round trips would give a half-recorded item four ways to
 * end up wrong.
 *
 * First submission wins for the item as a whole. Nothing is released here —
 * the answers unlock only when the last item in the block lands (see the gate
 * in getTestItems) — so a participant is free to change their mind up until
 * Next, and has learned nothing that could inform a second attempt afterwards.
 */
export async function recordPrediction(args: {
  participant: StudyParticipant;
  cloneAssignmentId: string;
  bankItemId: number;
  ideal: string;
  pointing: Pointing;
  confidence: number;
  expectDesirable: number;
  /** Per-step durations from when the question appeared (ms) — see schema. */
  timing?: StepTiming | null;
}): Promise<{ ok: true } | { error: 'no_response' }> {
  const { participant, cloneAssignmentId, bankItemId, ideal, pointing } = args;

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
      ideal,
      pointedKind: pointing.kind,
      pointedIntentId: pointing.kind === 'intent' ? pointing.intentId : null,
      pointedSpans: pointing.kind === 'span' ? pointing.spans : null,
      // The quotations, joined, so the export carries what they pointed at
      // without anyone having to parse json to read it.
      pointedText:
        pointing.kind === 'span' ? pointing.spans.map((s) => s.text).join(' … ') : null,
      confidence: args.confidence,
      expectDesirable: args.expectDesirable,
      // Both are the same instant — Pass 1 is one write. `guessed_at` keeps
      // its v2 name and its v2 meaning: when the prediction was recorded, and
      // the evidence that it beat the reveal.
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
 * Record a judgement — Q5, Q6, or both.
 *
 * A PATCH, because the two are answered as two clicks and either can be
 * revised: sending one must not blank the other, and the second click must not
 * re-decide the first. Only reachable once the answers have been released,
 * which means the WHOLE block has been predicted — a judgement is a judgement
 * of something seen, and nothing in this block is seen before then. The caller
 * checks the block-wide half (it holds the clone); the per-item `pointedAt`
 * rides in the WHERE rather than in a prior read, so neither can slip past on
 * a client's say-so.
 *
 * Returns the item's judgements as they now stand, so the caller can decide
 * whether the probe panel — and with it the Matched chip — is owed.
 */
export async function recordJudgement(args: {
  cloneAssignmentId: string;
  bankItemId: number;
  desirable?: number;
  follows?: number;
  timing?: StepTiming | null;
}): Promise<{ ok: boolean; desirable: number | null; follows: number | null }> {
  const updated = await db
    .update(studyTestAnswers)
    .set({
      ...(args.desirable === undefined ? {} : { desirable: args.desirable }),
      ...(args.follows === undefined ? {} : { followsSetup: args.follows }),
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
    .returning({
      desirable: studyTestAnswers.desirable,
      follows: studyTestAnswers.followsSetup,
    });
  const row = updated[0];
  return {
    ok: updated.length > 0,
    desirable: row?.desirable ?? null,
    follows: row?.follows ?? null,
  };
}

/**
 * Record the probe (P) and the repair (F).
 *
 * Both optional by design, so a blank one is a real answer and saved as null
 * rather than refused — §10-5 wants the box cheap to leave empty, not a toll
 * that teaches people to rate above the fold. Only accepted after a judgement,
 * because that is when the panel opens.
 */
export async function recordProbe(args: {
  cloneAssignmentId: string;
  bankItemId: number;
  probe?: string;
  repair?: string;
  timing?: StepTiming | null;
}): Promise<{ ok: boolean }> {
  const updated = await db
    .update(studyTestAnswers)
    .set({
      ...(args.probe === undefined ? {} : { probe: args.probe.trim() || null }),
      ...(args.repair === undefined ? {} : { repair: args.repair.trim() || null }),
      ...timingPatch(args.timing),
    })
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
