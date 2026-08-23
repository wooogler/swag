/**
 * What the facilitator console shows and does.
 *
 * One read that answers "is this participant ready for the next phase?" —
 * deploy state per clone, whether the frozen answers exist AND still match the
 * deployed configuration, and the phase itself. The gate the console enforces
 * is the study's, not the UI's: a test phase entered without current answers
 * would measure a configuration the participant no longer has.
 */
import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { db } from '@/db/db';
import {
  baselinePromptVersions,
  scoreChatDeploys,
  simpleConfigVersions,
  studyClones,
  studyEvents,
  studyGeneratedResponses,
  studyParticipants,
  studyQuestionBank,
  studySurveyAnswers,
  studyTestAnswers,
  type StudyParticipant,
} from '@/db/schema';
import { isGenerationCurrent, type BankKind } from './generate';
import {
  armOf,
  familyOf as viewFamily,
  type StudioArm,
  type StudioFamily,
  type StudioView,
} from './config';
import {
  blockPlan,
  cellOf,
  familyOf,
  isStudyPhase,
  phaseAccess,
  type StudyPhase,
} from './phases';
import { logParticipantEvent } from './events';
import { getSurveyConfig, getSurveyItems } from './survey-store';

/**
 * What a participant has actually BUILT in one workspace, read out of the
 * state the session leaves behind rather than from any new instrumentation.
 * Deliberately per-condition: an intent count means nothing for a baseline
 * clone, and a rules-document length means nothing for a SCORE one.
 */
export interface CloneWork {
  /** SCORE: sets the participant authored (their own, not the type roots). */
  intents: number;
  nestedIntents: number;
  corrections: number;
  /** Baseline: saved filters, and the size of the one rules document. */
  filters: number;
  rulesChars: number;
  /** Both: how many times a rule was revised, and deploys made. */
  ruleEdits: number;
  deploys: number;
  lastDeployAt: string | null;
}

export interface CloneStatus {
  datasetKey: string;
  assignmentId: string;
  condition: 'score' | 'baseline';
  block: 1 | 2 | null;
  deployed: boolean;
  deployLabel: string | null;
  /** Frozen-answer readiness, per bank kind. */
  test: { missing: number; stale: number; current: boolean };
  work: CloneWork;
  /** Block test answered / total, for this clone's own dataset. */
  testAnswered: number;
  testTotal: number;
  surveyAnswered: number;
  surveyTotal: number;
}

export interface ParticipantStatus {
  id: string;
  participantNumber: string;
  cell: number | null;
  /** Which build of the tools both blocks run in ('full' | 'simple'). */
  family: StudioFamily;
  blockOrder: string | null;
  /** The participant's start link token; null only for rows never provisioned. */
  accessToken: string | null;
  phase: StudyPhase;
  lastLoginAt: string | null;
  clones: CloneStatus[];
  /** Blocking reasons for advancing out of the CURRENT phase, if any. */
  blockers: string[];
  /** When the facilitator moved them into the current phase, and how long ago —
   * the 30-minute work cap is watched with this. */
  phaseSince: string | null;
  phaseMinutes: number | null;
  /** The most recent trace of them doing anything at all. */
  lastActivityAt: string | null;
}

/**
 * The ARM a clone runs, which is what every metric on this screen keys off:
 * whether there are intents to point at, whether coverage means anything,
 * whether "the config" is a tree or a document. Which build of the tools the
 * arm came in does not change any of those, so it is deliberately dropped
 * here — read it with familyOf where it matters.
 */
function conditionOf(clone: { condition: string }): StudioArm {
  return armOf(clone.condition as StudioView);
}

/** Exported because the participant's own advance checks it too (advance.ts). */
export async function deployStateFor(clone: {
  assignmentId: string;
  /** The whole view, not the arm: which store holds the deployed
   * configuration is a fact about the family, and an arm passed here reads as
   * "not simple" and finds nothing. Typed so that mistake cannot compile. */
  condition: StudioView;
}): Promise<{ deployed: boolean; label: string | null; unsaved?: boolean }> {
  // The simple version deploys by saving: deploy IS the final save, and the
  // block test reads what was deployed. Two things have to hold before a block
  // can end — something has been deployed, and it is still what the board is
  // answering with. The second matters because finishing after more work would
  // measure a configuration they had already moved on from, and nothing about
  // the answers would look wrong.
  if (viewFamily(clone.condition as StudioView) === 'simple') {
    const rows = await db
      .select({
        versionNo: simpleConfigVersions.versionNo,
        kind: simpleConfigVersions.kind,
        deployedAt: simpleConfigVersions.deployedAt,
      })
      .from(simpleConfigVersions)
      .where(
        and(
          eq(simpleConfigVersions.assignmentId, clone.assignmentId),
          isNull(simpleConfigVersions.hiddenAt)
        )
      )
      .orderBy(desc(simpleConfigVersions.versionNo));
    const tip = rows[0];
    if (!tip) return { deployed: false, label: null };
    const live = rows.find((r) => r.deployedAt != null) ?? null;
    if (!live) return { deployed: false, label: 'never deployed', unsaved: true };
    if (live.versionNo !== tip.versionNo) {
      return { deployed: false, label: 'changed since deploy', unsaved: true };
    }
    return { deployed: true, label: `v${live.versionNo}` };
  }
  if (conditionOf(clone) === 'baseline') {
    const [live] = await db
      .select({ versionNo: baselinePromptVersions.versionNo })
      .from(baselinePromptVersions)
      .where(
        and(
          eq(baselinePromptVersions.assignmentId, clone.assignmentId),
          isNotNull(baselinePromptVersions.deployedAt)
        )
      )
      .orderBy(desc(baselinePromptVersions.deployedAt))
      .limit(1);
    return { deployed: !!live, label: live ? `rules v${live.versionNo}` : null };
  }
  const [latest] = await db
    .select({ versionNo: scoreChatDeploys.versionNo })
    .from(scoreChatDeploys)
    .where(eq(scoreChatDeploys.assignmentId, clone.assignmentId))
    .orderBy(desc(scoreChatDeploys.versionNo))
    .limit(1);
  return { deployed: !!latest, label: latest ? `chat v${latest.versionNo}` : null };
}

/**
 * One round trip per clone for everything a facilitator watches. Counting in
 * SQL rather than pulling rows: a mid-session poll should not drag a whole
 * intent tree and every rule version across the wire.
 */
async function workFor(assignmentId: string, family: StudioFamily): Promise<CloneWork> {
  const [row] = await db.execute<{
    intents: number;
    nested: number;
    corrections: number;
    filters: number;
    rules_chars: number;
    rule_edits: number;
    deploys: number;
    last_deploy: Date | null;
    simple_saves: number;
    simple_applies: number;
    simple_last_save: Date | null;
    simple_intents: number | null;
    simple_prompt_chars: number | null;
  }>(sql`
    SELECT
      (SELECT count(*)::int FROM score_intents
        WHERE assignment_id = ${assignmentId} AND kind = 'intent'
          AND NOT is_template AND NOT archived) AS intents,
      (SELECT count(*)::int FROM score_intents
        WHERE assignment_id = ${assignmentId} AND kind = 'intent'
          AND NOT is_template AND NOT archived AND parent_intent_id IS NOT NULL) AS nested,
      (SELECT count(*)::int FROM score_intent_pins WHERE assignment_id = ${assignmentId}) AS corrections,
      (SELECT count(*)::int FROM baseline_searches WHERE assignment_id = ${assignmentId}) AS filters,
      -- The rules document as WRITTEN: the holder carries the working text,
      -- but a participant who deployed and then had their clone re-read would
      -- show zero if only the holder were counted.
      GREATEST(
        (SELECT coalesce(max(length(rule)), 0)::int FROM score_intents
          WHERE assignment_id = ${assignmentId} AND kind = 'prompt_holder'),
        (SELECT coalesce(max(length(prompt)), 0)::int FROM baseline_prompt_versions
          WHERE assignment_id = ${assignmentId})
      ) AS rules_chars,
      (SELECT count(*)::int FROM score_rule_versions WHERE assignment_id = ${assignmentId}) AS rule_edits,
      (SELECT count(*)::int FROM score_chat_deploys WHERE assignment_id = ${assignmentId})
        + (SELECT count(*)::int FROM baseline_prompt_versions
            WHERE assignment_id = ${assignmentId} AND deployed_at IS NOT NULL) AS deploys,
      GREATEST(
        (SELECT max(created_at) FROM score_chat_deploys WHERE assignment_id = ${assignmentId}),
        (SELECT max(deployed_at) FROM baseline_prompt_versions WHERE assignment_id = ${assignmentId})
      ) AS last_deploy,
      -- The simple version keeps its configuration in one snapshot per save,
      -- so its counts come from the newest one rather than from rows. Zero on
      -- a full clone, and the caller picks which pair to read.
      -- Saves and applies counted apart: the facilitator wants to know both
      -- how much iterating is going on and whether any of it is committed.
      (SELECT count(*)::int FROM simple_config_versions
        WHERE assignment_id = ${assignmentId} AND hidden_at IS NULL AND kind = 'save') AS simple_saves,
      (SELECT count(*)::int FROM simple_config_versions
        WHERE assignment_id = ${assignmentId} AND hidden_at IS NULL AND kind = 'apply') AS simple_applies,
      (SELECT max(created_at) FROM simple_config_versions
        WHERE assignment_id = ${assignmentId} AND hidden_at IS NULL AND kind = 'save') AS simple_last_save,
      (SELECT jsonb_array_length(coalesce(snapshot->'intents', '[]'::jsonb))
        FROM simple_config_versions
        WHERE assignment_id = ${assignmentId} AND hidden_at IS NULL
        ORDER BY version_no DESC LIMIT 1) AS simple_intents,
      (SELECT length(coalesce(snapshot->>'prompt', ''))
        FROM simple_config_versions
        WHERE assignment_id = ${assignmentId} AND hidden_at IS NULL
        ORDER BY version_no DESC LIMIT 1) AS simple_prompt_chars
  `);
  if (family === 'simple') {
    // A save is this version's whole publishing act, so it is both the edit
    // count and the deploy count — there is no second step to count
    // separately, and reporting zero deploys would read as "never published".
    const saves = row?.simple_saves ?? 0;
    return {
      intents: row?.simple_intents ?? 0,
      nestedIntents: 0,
      corrections: 0,
      filters: 0,
      rulesChars: row?.simple_prompt_chars ?? 0,
      // Applies are the iterating, saves are the committing.
      ruleEdits: (row?.simple_applies ?? 0) + saves,
      deploys: saves,
      lastDeployAt: row?.simple_last_save ? new Date(row.simple_last_save).toISOString() : null,
    };
  }
  return {
    intents: row?.intents ?? 0,
    nestedIntents: row?.nested ?? 0,
    corrections: row?.corrections ?? 0,
    filters: row?.filters ?? 0,
    rulesChars: row?.rules_chars ?? 0,
    ruleEdits: row?.rule_edits ?? 0,
    deploys: row?.deploys ?? 0,
    lastDeployAt: row?.last_deploy ? new Date(row.last_deploy).toISOString() : null,
  };
}

/** Block-test progress for one clone: judged items over the bank's size. */
async function answeredFor(
  cloneAssignmentId: string,
  datasetKey: string
): Promise<{ answered: number; total: number }> {
  const bank = await db
    .select({ id: studyQuestionBank.id })
    .from(studyQuestionBank)
    .where(and(eq(studyQuestionBank.datasetKey, datasetKey), eq(studyQuestionBank.kind, 'test')));
  if (bank.length === 0) return { answered: 0, total: 0 };
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(studyTestAnswers)
    .where(
      and(
        eq(studyTestAnswers.cloneAssignmentId, cloneAssignmentId),
        // Q5 is the item's own headline judgement, and the first of the two
        // Pass 2 answers — an item with it is an item the participant has
        // been through.
        isNotNull(studyTestAnswers.desirable),
        inArray(
          studyTestAnswers.bankItemId,
          bank.map((b) => b.id)
        )
      )
    );
  return { answered: row?.n ?? 0, total: bank.length };
}

/** When the facilitator last moved them — the clock the 30-minute cap runs on. */
async function lastPhaseChange(participantId: string): Promise<Date | null> {
  const [row] = await db
    .select({ createdAt: studyEvents.createdAt })
    .from(studyEvents)
    .where(
      and(
        eq(studyEvents.participantId, participantId),
        // `work_started` too, and for the reason the chip exists: the
        // facilitator's five-minutes-left call has to come five minutes before
        // the participant's own readout runs out, and that readout starts at
        // the task screen's [Start], not at the advance into the phase
        // (session.ts, same two types).
        inArray(studyEvents.eventType, ['phase_advance', 'work_started'])
      )
    )
    .orderBy(desc(studyEvents.createdAt))
    .limit(1);
  return row?.createdAt ?? null;
}

/**
 * The freshest trace of the participant doing something. Server-side events
 * are thin by design (the study reads behaviour from DB state, not a click
 * stream), so this takes the latest of what IS recorded: their board events,
 * their deploys, and their measurement answers.
 */
async function lastActivityFor(
  participant: StudyParticipant,
  clones: CloneStatus[]
): Promise<Date | null> {
  const assignmentIds = clones.map((c) => c.assignmentId);
  const candidates: (Date | null)[] = [
    participant.lastLoginAt,
    ...clones.map((c) => (c.work.lastDeployAt ? new Date(c.work.lastDeployAt) : null)),
  ];

  if (assignmentIds.length > 0) {
    const [row] = await db
      .select({ createdAt: studyEvents.createdAt })
      .from(studyEvents)
      .where(inArray(studyEvents.assignmentId, assignmentIds))
      .orderBy(desc(studyEvents.createdAt))
      .limit(1);
    candidates.push(row?.createdAt ?? null);

    const [rated] = await db
      .select({ ratedAt: studyTestAnswers.ratedAt })
      .from(studyTestAnswers)
      .where(inArray(studyTestAnswers.cloneAssignmentId, assignmentIds))
      .orderBy(desc(studyTestAnswers.ratedAt))
      .limit(1);
    candidates.push(rated?.ratedAt ?? null);
  }

  const times = candidates.filter((d): d is Date => !!d).map((d) => d.getTime());
  return times.length > 0 ? new Date(Math.max(...times)) : null;
}

export async function getParticipantStatus(
  participant: StudyParticipant
): Promise<ParticipantStatus> {
  const clones = await db
    .select()
    .from(studyClones)
    .where(eq(studyClones.participantId, participant.id));
  const plan = blockPlan(participant);
  const phase: StudyPhase = isStudyPhase(participant.phase) ? participant.phase : 'not_started';
  const surveyItemCount = (await getSurveyItems()).length;

  const cloneStatuses: CloneStatus[] = await Promise.all(
    clones.map(async (clone) => {
      const deploy = await deployStateFor({
        assignmentId: clone.assignmentId,
        condition: clone.condition as StudioView,
      });
      const block = plan.find((p) => p.datasetKey === clone.datasetKey)?.block ?? null;
      // A block test asks the clone's OWN dataset, and only that.
      const test = await isGenerationCurrent({
        cloneAssignmentId: clone.assignmentId,
        datasetKey: clone.datasetKey,
        kind: 'test',
      }).catch(() => ({ current: false, missing: 0, stale: 0 }));
      const [work, testProgress, surveyCount] = await Promise.all([
        workFor(clone.assignmentId, viewFamily(clone.condition as StudioView)),
        answeredFor(clone.assignmentId, clone.datasetKey),
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(studySurveyAnswers)
          .where(
            and(
              eq(studySurveyAnswers.participantId, participant.id),
              eq(studySurveyAnswers.block, block ?? 0)
            )
          ),
      ]);

      return {
        datasetKey: clone.datasetKey,
        assignmentId: clone.assignmentId,
        condition: conditionOf(clone),
        block,
        deployed: deploy.deployed,
        deployLabel: deploy.label,
        test,
        work,
        testAnswered: testProgress.answered,
        testTotal: testProgress.total,
        surveyAnswered: surveyCount[0]?.n ?? 0,
        surveyTotal: surveyItemCount,
      };
    })
  );

  const [phaseSince, lastActivityAt] = await Promise.all([
    lastPhaseChange(participant.id),
    lastActivityFor(participant, cloneStatuses),
  ]);

  return {
    id: participant.id,
    participantNumber: participant.participantNumber,
    cell: cellOf(participant),
    family: familyOf(participant),
    blockOrder: participant.blockOrder ?? plan.map((p) => p.datasetKey).join(','),
    accessToken: participant.accessToken ?? null,
    phase,
    lastLoginAt: participant.lastLoginAt ? participant.lastLoginAt.toISOString() : null,
    clones: cloneStatuses.sort((a, b) => (a.block ?? 9) - (b.block ?? 9)),
    blockers: advanceBlockers(phase, cloneStatuses),
    phaseSince: phaseSince ? phaseSince.toISOString() : null,
    phaseMinutes: phaseSince ? Math.floor((Date.now() - phaseSince.getTime()) / 60_000) : null,
    lastActivityAt: lastActivityAt ? lastActivityAt.toISOString() : null,
  };
}

export async function listParticipantStatuses(): Promise<ParticipantStatus[]> {
  // Demo accounts run the identical session on the isolated demo subtypes, so
  // they look exactly like participants here — which is why they are filtered
  // out rather than left for a facilitator to recognise mid-session.
  const participants = await db
    .select()
    .from(studyParticipants)
    .where(eq(studyParticipants.isDemo, false));
  const statuses = await Promise.all(participants.map((p) => getParticipantStatus(p)));
  return statuses.sort((a, b) =>
    a.participantNumber.localeCompare(b.participantNumber, undefined, { numeric: true })
  );
}

/**
 * Why the NEXT phase cannot be entered yet. Only the measurement phases have
 * preconditions: a test screen shows FROZEN answers, so they must exist
 * and still match what is deployed right now — a participant who tweaked and
 * redeployed after generation would otherwise be tested against a chatbot they
 * no longer have.
 */
export function advanceBlockers(phase: StudyPhase, clones: CloneStatus[]): string[] {
  const blockers: string[] = [];
  const forBlock = (block: 1 | 2) => clones.find((c) => c.block === block);

  // Split to match advance.ts, which is what this is reporting. Leaving the
  // work needs a deploy and nothing else; the answer batch is awaited one
  // hand-off later, out of the questionnaire. Left as one check, the console
  // would announce "test answers 8 missing" during the work — when it blocks
  // nothing and the batch has not been asked to run yet — and then say
  // nothing at all in the phase where those answers really are required.
  const checkDeployed = (block: 1 | 2) => {
    const clone = forBlock(block);
    if (clone && !clone.deployed) blockers.push(`block ${block}: not deployed yet`);
  };

  const checkTest = (block: 1 | 2) => {
    const clone = forBlock(block);
    if (!clone) return;
    if (!clone.deployed) blockers.push(`block ${block}: not deployed yet`);
    else if (!clone.test.current) {
      blockers.push(
        `block ${block}: test answers ${clone.test.missing} missing, ${clone.test.stale} stale`
      );
    }
  };

  if (phase === 'block1_work') checkDeployed(1);
  if (phase === 'block2_work') checkDeployed(2);
  if (phase === 'block1_survey') checkTest(1);
  if (phase === 'block2_survey') checkTest(2);
  return blockers;
}

/** Move a participant to an explicit phase, recording the transition. */
export async function setParticipantPhase(
  participant: StudyParticipant,
  phase: StudyPhase,
  by: string
): Promise<void> {
  await db
    .update(studyParticipants)
    .set({ phase })
    .where(eq(studyParticipants.id, participant.id));
  await logParticipantEvent(participant.id, 'phase_advance', {
    from: participant.phase,
    to: phase,
    by,
  });
}

/** The dataset a participant may open right now (null = none). */
export function allowedWorkDataset(participant: {
  participantNumber: string;
  phase: string | null;
}): string | null {
  const phase: StudyPhase = isStudyPhase(participant.phase) ? participant.phase : 'not_started';
  return phaseAccess(participant, phase).workDatasetKey;
}

/** Clone assignment ids a participant may open right now. */
export async function allowedAssignmentIds(participant: StudyParticipant): Promise<string[]> {
  const datasetKey = allowedWorkDataset(participant);
  if (!datasetKey) return [];
  const rows = await db
    .select({ assignmentId: studyClones.assignmentId })
    .from(studyClones)
    .where(
      and(eq(studyClones.participantId, participant.id), eq(studyClones.datasetKey, datasetKey))
    );
  return rows.map((r) => r.assignmentId);
}

/** Bank kinds the console can trigger generation for, in session order. */
export const GENERATION_KINDS: BankKind[] = ['test'];

/**
 * Per-question outcomes for one block — what the facilitator reads afterwards.
 *
 * The participant's own screen now decides what to probe (BLOCK_TEST v3 §4 ③:
 * Q5 ≤ 3 or Q6 ≤ 3 opens it), so this is no longer a probe list to act on in
 * the room. It is the block read back: the two judgements, the prediction error
 * between Q4 and Q5, and the one comparison that appears on no participant
 * screen at all — the intent they pointed at against the intent that fired.
 *
 * The verdicts are the export's, deliberately — a number read in the room and a
 * column read afterwards have to be about the same items. `pointingCorrect` is
 * literally the same function. The fold is the instrument's: 1-3 negative.
 */
export interface PredictionRow {
  /** 1-based in the participant's own presentation order, not the bank's. */
  number: number;
  question: string;
  /** Q3, Q4 — 6-point, from Pass 1. */
  confidence: number | null;
  expectDesirable: number | null;
  /** Q5, Q6 — 6-point, from Pass 2. */
  desirable: number | null;
  follows: number | null;
  /** |Q4 − Q5|, 0-5. Null while either is missing. */
  predError: number | null;
  /**
   * Did the desirability prediction land on the wrong side of the fold?
   *
   * The direction matters more than the flag: fold(Q4) positive with fold(Q5)
   * negative is a BLIND SPOT (they did not see it coming), and the reverse is
   * a pessimism miss. Null while either half is missing.
   */
  foldMissed: boolean | null;
  /** fold(Q6) positive with fold(Q5) negative — the code C5 case: the rule was
   * followed and the rule was not what they wanted. */
  selfModelError: boolean | null;
  pointedLabel: string | null;
  appliedLabel: string | null;
  /** SCORE only; null for baseline, and for "I don't know", which has no
   * verdict — it is a real answer, scored as its own rate. */
  pointingMissed: boolean | null;
  /** 'intent' = one of their sets claimed it; 'type_default' = none did. */
  outcome: 'intent' | 'type_default' | null;
  /**
   * Length of the rule that answered, so zero is visible.
   *
   * A question that reaches an empty rule is answered with NO instruction of
   * theirs at all — the bare model. It is not a configuration that performed
   * badly, it is a configuration that was not there, and the two are read
   * completely differently.
   */
  ruleChars: number | null;
}

/**
 * One block's results, as a facilitator or an analyst wants them at a glance.
 *
 * Everything here is already in the export; the point is that reading it
 * currently means opening a CSV per participant and joining two more. The
 * numbers chosen are the ones the first pilot turned on: the fit ratings split
 * by whether a rule was even reached, whether the prediction and the pointing
 * held, and the workload answers beside them.
 */
export interface BlockResults {
  block: 1 | 2 | null;
  datasetKey: string;
  condition: 'score' | 'baseline';
  rows: PredictionRow[];
  /** Judged items (both Q5 and Q6 in) and the mean of Q5 over them. */
  rated: number;
  total: number;
  mean: number | null;
  /** Mean of Q6 — whether the responses followed what they wrote. */
  meanFollows: number | null;
  /** Mean |Q4 − Q5| over the items where both are in: the prediction error
   * RQ2 rests on, before it is folded into a hit rate. */
  meanError: number | null;
  /**
   * The same ratings split by whether a non-empty rule answered.
   *
   * SCORE only, and the split the pilot made necessary: one participant's
   * block looked like a middling 3.5 average, and it was four 5s where a rule
   * existed and three 1-2s where none did. A mean over both is a number about
   * nothing.
   */
  covered: { n: number; mean: number | null } | null;
  uncovered: { n: number; mean: number | null } | null;
  /** Q4 against Q5, both folded at 3/4 — how often the desirability call was
   * on the right side. */
  predictionHits: number;
  predictionScored: number;
  /** SCORE only — pointing against the intent that actually fired. */
  pointingHits: number | null;
  pointingScored: number | null;
  /** How often they answered Q2 with "I don't know" — coverage awareness, and
   * the denominator that makes a low pointing score readable. */
  dontKnow: number;
  /**
   * The two quadrants of §1.3, as counts.
   *
   * `blindSpots` is the prediction quadrant's dangerous cell: they expected it
   * to be desirable and it was not. `selfModelErrors` is the execution
   * quadrant's: the response followed their setup and they still did not want
   * it — a wrong model of their own rule, which no other measure catches.
   */
  blindSpots: number;
  selfModelErrors: number;
  /** Confidence, mean of Q3 — read against the two hit rates above. */
  meanConfidence: number | null;
  /** The block's questionnaire answers, in the instrument's own order. */
  survey: { key: string; label: string; value: number | null }[];
  surveyScaleMax: number;
}

export async function getBlockPredictions(
  participant: StudyParticipant,
  cloneAssignmentId: string
): Promise<PredictionRow[]> {
  const [clone] = await db
    .select()
    .from(studyClones)
    .where(eq(studyClones.assignmentId, cloneAssignmentId));
  if (!clone) return [];

  const { deployedConfigFor, getTestItems, pointingCorrect } = await import('./measure-store');
  const [items, config, generated] = await Promise.all([
    getTestItems(participant, clone),
    deployedConfigFor({
      assignmentId: clone.assignmentId,
      condition: conditionOf(clone),
      view: clone.condition as StudioView,
    }),
    db
      .select({
        bankItemId: studyGeneratedResponses.bankItemId,
        applied: studyGeneratedResponses.applied,
      })
      .from(studyGeneratedResponses)
      .where(eq(studyGeneratedResponses.cloneAssignmentId, cloneAssignmentId)),
  ]);

  const titleById = new Map((config?.intents ?? []).map((i) => [i.id, i.title]));
  const appliedByItem = new Map(
    generated.map((g) => [
      g.bankItemId,
      (g.applied ?? null) as { outcome?: string; intentId?: number; intentTitle?: string } | null,
    ])
  );

  return items.map((item, i) => {
    const applied = appliedByItem.get(item.bankItemId) ?? null;
    const point = item.pointing;
    const correct = pointingCorrect(point, applied);

    let pointedLabel: string | null = null;
    if (point?.kind === 'intent') {
      pointedLabel = titleById.get(point.intentId) ?? `#${point.intentId} (deleted)`;
    } else if (point?.kind === 'none') {
      pointedLabel = 'Default rule';
    } else if (point?.kind === 'span') {
      pointedLabel = `“${point.text.length > 80 ? `${point.text.slice(0, 80)}…` : point.text}”`;
    } else if (point?.kind === 'nothing') {
      pointedLabel = 'Nothing in particular';
    } else if (point?.kind === 'not_sure') {
      pointedLabel = "Didn't know";
    }

    let appliedLabel: string | null = null;
    if (conditionOf(clone) === 'score' && applied) {
      appliedLabel =
        applied.outcome === 'intent'
          ? applied.intentTitle ?? `#${applied.intentId}`
          : applied.outcome === 'type_default'
            ? 'type default'
            : applied.outcome ?? null;
    }

    const appliedFull = applied as { rule?: string } | null;
    // The instrument's fold, restated (see getBlockResults for why it is not
    // imported): 1-3 negative, 4-6 positive.
    const isNegative = (v: number | null) => v !== null && v <= 3;
    const both = item.expectDesirable !== null && item.desirable !== null;
    return {
      number: i + 1,
      question: item.question.length > 90 ? `${item.question.slice(0, 90)}…` : item.question,
      confidence: item.confidence,
      expectDesirable: item.expectDesirable,
      desirable: item.desirable,
      follows: item.follows,
      predError: both ? Math.abs((item.expectDesirable ?? 0) - (item.desirable ?? 0)) : null,
      foldMissed: both ? isNegative(item.expectDesirable) !== isNegative(item.desirable) : null,
      selfModelError:
        item.follows === null || item.desirable === null
          ? null
          : !isNegative(item.follows) && isNegative(item.desirable),
      pointedLabel,
      appliedLabel,
      pointingMissed:
        conditionOf(clone) === 'score' && correct !== null ? !correct : null,
      outcome:
        applied?.outcome === 'intent' || applied?.outcome === 'type_default'
          ? applied.outcome
          : null,
      ruleChars:
        conditionOf(clone) === 'score' ? (appliedFull?.rule ?? '').trim().length : null,
    };
  });
}

/**
 * One block's results — the per-item rows plus the summary and the survey.
 *
 * Built on getBlockPredictions rather than beside it, so the console's numbers
 * and the export's verdicts can never drift apart: there is one definition of
 * "the prediction missed" and both read it.
 */
export async function getBlockResults(
  participant: StudyParticipant,
  cloneAssignmentId: string
): Promise<BlockResults | null> {
  const [clone] = await db
    .select()
    .from(studyClones)
    .where(eq(studyClones.assignmentId, cloneAssignmentId));
  if (!clone) return null;
  const condition = conditionOf(clone);
  const block = blockPlan(participant).find((p) => p.datasetKey === clone.datasetKey)?.block ?? null;

  const [rows, config] = await Promise.all([
    getBlockPredictions(participant, cloneAssignmentId),
    getSurveyConfig(),
  ]);

  const rated = rows.filter((r) => r.desirable !== null);
  const meanOf = (list: PredictionRow[], pick: (r: PredictionRow) => number | null) => {
    const values = list.map(pick).filter((v): v is number => v !== null);
    return values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length;
  };
  const mean = (list: PredictionRow[]) => meanOf(list, (r) => r.desirable);

  // "Covered" is about the RULE, not the routing: an intent matching a question
  // and then contributing an empty rule leaves the chatbot uninstructed just as
  // a type default does.
  const covered = rated.filter((r) => (r.ruleChars ?? 0) > 0);
  const uncovered = rated.filter((r) => (r.ruleChars ?? 0) === 0);

  const scoredPredictions = rows.filter((r) => r.foldMissed !== null);
  const scoredPointing = rows.filter((r) => r.pointingMissed !== null);
  // Same fold as the instrument, restated here rather than imported: this file
  // reads measure-store through a dynamic import (below) and a one-line
  // predicate is not worth making that one asynchronous.
  const isNegative = (v: number | null) => v !== null && v <= 3;

  const surveyRows = await db
    .select({ itemKey: studySurveyAnswers.itemKey, value: studySurveyAnswers.value })
    .from(studySurveyAnswers)
    .where(
      and(
        eq(studySurveyAnswers.participantId, participant.id),
        eq(studySurveyAnswers.block, block ?? 0)
      )
    );
  const valueByKey = new Map(surveyRows.map((r) => [r.itemKey, r.value]));

  return {
    block,
    datasetKey: clone.datasetKey,
    condition,
    rows,
    rated: rated.length,
    total: rows.length,
    mean: mean(rated),
    meanFollows: meanOf(rows, (r) => r.follows),
    meanError: meanOf(rows, (r) => r.predError),
    covered: condition === 'score' ? { n: covered.length, mean: mean(covered) } : null,
    uncovered: condition === 'score' ? { n: uncovered.length, mean: mean(uncovered) } : null,
    predictionHits: scoredPredictions.filter((r) => !r.foldMissed).length,
    predictionScored: scoredPredictions.length,
    pointingHits: condition === 'score' ? scoredPointing.filter((r) => !r.pointingMissed).length : null,
    pointingScored: condition === 'score' ? scoredPointing.length : null,
    dontKnow: rows.filter((r) => r.pointedLabel === "Didn't know").length,
    blindSpots: rows.filter((r) => r.foldMissed && !isNegative(r.expectDesirable)).length,
    selfModelErrors: rows.filter((r) => r.selfModelError).length,
    meanConfidence: meanOf(rows, (r) => r.confidence),
    // The instrument's own order first — then anything answered under a key
    // the instrument no longer has. A questionnaire reworded between the pilot
    // and the study would otherwise make the pilot's answers disappear from
    // this screen while sitting untouched in the table.
    survey: [
      ...config.items.map((i) => ({
        key: i.key,
        label: i.label ?? i.key,
        value: valueByKey.get(i.key) ?? null,
      })),
      ...surveyRows
        .filter((r) => !config.items.some((i) => i.key === r.itemKey))
        .map((r) => ({ key: r.itemKey, label: `${r.itemKey} (retired)`, value: r.value })),
    ],
    surveyScaleMax: config.scaleMax,
  };
}
