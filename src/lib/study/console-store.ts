/**
 * What the facilitator console shows and does.
 *
 * One read that answers "is this participant ready for the next phase?" —
 * deploy state per clone, whether the frozen answers exist AND still match the
 * deployed configuration, and the phase itself. The gate the console enforces
 * is the study's, not the UI's: a test phase entered without current answers
 * would measure a configuration the participant no longer has.
 */
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { db } from '@/db/db';
import {
  baselinePromptVersions,
  scoreChatDeploys,
  studyAbAnswers,
  studyClones,
  studyEvents,
  studyParticipants,
  studyQuestionBank,
  studySurveyAnswers,
  studyTestAnswers,
  type StudyParticipant,
} from '@/db/schema';
import { STUDY_DATASETS } from './config';
import { isGenerationCurrent, type BankKind } from './generate';
import {
  blockPlan,
  cellForParticipant,
  isStudyPhase,
  phaseAccess,
  type StudyPhase,
} from './phases';
import { logParticipantEvent } from './events';
import { getSurveyItems } from './survey-store';

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
  ab: { missing: number; stale: number; current: boolean };
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
  blockOrder: string | null;
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
  ab: { answered: number; total: number };
}

function conditionOf(clone: { condition: string }): 'score' | 'baseline' {
  return clone.condition === 'baseline' ? 'baseline' : 'score';
}

async function deployStateFor(clone: {
  assignmentId: string;
  condition: string;
}): Promise<{ deployed: boolean; label: string | null }> {
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
async function workFor(assignmentId: string): Promise<CloneWork> {
  const [row] = await db.execute<{
    intents: number;
    nested: number;
    corrections: number;
    filters: number;
    rules_chars: number;
    rule_edits: number;
    deploys: number;
    last_deploy: Date | null;
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
      ) AS last_deploy
  `);
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

/** Block-test progress for one clone: rated items over the bank's size. */
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
        isNotNull(studyTestAnswers.rating),
        inArray(
          studyTestAnswers.bankItemId,
          bank.map((b) => b.id)
        )
      )
    );
  return { answered: row?.n ?? 0, total: bank.length };
}

/** A/B progress: choices made over the bank's size (both datasets). */
async function abProgressFor(participantId: string): Promise<{ answered: number; total: number }> {
  const [[bank], [answered]] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(studyQuestionBank)
      .where(eq(studyQuestionBank.kind, 'ab')),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(studyAbAnswers)
      .where(eq(studyAbAnswers.participantId, participantId)),
  ]);
  return { answered: answered?.n ?? 0, total: bank?.n ?? 0 };
}

/** When the facilitator last moved them — the clock the 30-minute cap runs on. */
async function lastPhaseChange(participantId: string): Promise<Date | null> {
  const [row] = await db
    .select({ createdAt: studyEvents.createdAt })
    .from(studyEvents)
    .where(
      and(
        eq(studyEvents.participantId, participantId),
        eq(studyEvents.eventType, 'phase_advance')
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

  const [answered] = await db
    .select({ answeredAt: studyAbAnswers.answeredAt })
    .from(studyAbAnswers)
    .where(eq(studyAbAnswers.participantId, participant.id))
    .orderBy(desc(studyAbAnswers.answeredAt))
    .limit(1);
  candidates.push(answered?.answeredAt ?? null);

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
  const plan = blockPlan(participant.participantNumber);
  const phase: StudyPhase = isStudyPhase(participant.phase) ? participant.phase : 'not_started';
  const surveyItemCount = (await getSurveyItems()).length;

  const cloneStatuses: CloneStatus[] = await Promise.all(
    clones.map(async (clone) => {
      const deploy = await deployStateFor(clone);
      const block = plan.find((p) => p.datasetKey === clone.datasetKey)?.block ?? null;
      // Block test asks the clone's OWN dataset; A/B asks both, so readiness is
      // the worst of the two.
      const test = await isGenerationCurrent({
        cloneAssignmentId: clone.assignmentId,
        datasetKey: clone.datasetKey,
        kind: 'test',
      }).catch(() => ({ current: false, missing: 0, stale: 0 }));
      const abParts = await Promise.all(
        STUDY_DATASETS.map((d) =>
          isGenerationCurrent({
            cloneAssignmentId: clone.assignmentId,
            datasetKey: d.key,
            kind: 'ab',
          }).catch(() => ({ current: false, missing: 0, stale: 0 }))
        )
      );
      const ab = {
        missing: abParts.reduce((n, p) => n + p.missing, 0),
        stale: abParts.reduce((n, p) => n + p.stale, 0),
        current: abParts.every((p) => p.current),
      };
      const [work, testProgress, surveyCount] = await Promise.all([
        workFor(clone.assignmentId),
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
        ab,
        work,
        testAnswered: testProgress.answered,
        testTotal: testProgress.total,
        surveyAnswered: surveyCount[0]?.n ?? 0,
        surveyTotal: surveyItemCount,
      };
    })
  );

  const [phaseSince, lastActivityAt, abProgress] = await Promise.all([
    lastPhaseChange(participant.id),
    lastActivityFor(participant, cloneStatuses),
    abProgressFor(participant.id),
  ]);

  return {
    id: participant.id,
    participantNumber: participant.participantNumber,
    cell: participant.cell ?? cellForParticipant(participant.participantNumber),
    blockOrder: participant.blockOrder ?? plan.map((p) => p.datasetKey).join(','),
    phase,
    lastLoginAt: participant.lastLoginAt ? participant.lastLoginAt.toISOString() : null,
    clones: cloneStatuses.sort((a, b) => (a.block ?? 9) - (b.block ?? 9)),
    blockers: advanceBlockers(phase, cloneStatuses),
    phaseSince: phaseSince ? phaseSince.toISOString() : null,
    phaseMinutes: phaseSince ? Math.floor((Date.now() - phaseSince.getTime()) / 60_000) : null,
    lastActivityAt: lastActivityAt ? lastActivityAt.toISOString() : null,
    ab: abProgress,
  };
}

export async function listParticipantStatuses(): Promise<ParticipantStatus[]> {
  const participants = await db.select().from(studyParticipants);
  const statuses = await Promise.all(participants.map((p) => getParticipantStatus(p)));
  return statuses.sort((a, b) =>
    a.participantNumber.localeCompare(b.participantNumber, undefined, { numeric: true })
  );
}

/**
 * Why the NEXT phase cannot be entered yet. Only the measurement phases have
 * preconditions: a test or A/B screen shows FROZEN answers, so they must exist
 * and still match what is deployed right now — a participant who tweaked and
 * redeployed after generation would otherwise be tested against a chatbot they
 * no longer have.
 */
export function advanceBlockers(phase: StudyPhase, clones: CloneStatus[]): string[] {
  const blockers: string[] = [];
  const forBlock = (block: 1 | 2) => clones.find((c) => c.block === block);

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

  if (phase === 'block1_work') checkTest(1);
  if (phase === 'block2_work') checkTest(2);
  if (phase === 'block2_survey') {
    for (const clone of clones) {
      if (!clone.deployed) blockers.push(`${clone.datasetKey}: not deployed`);
      else if (!clone.ab.current) {
        blockers.push(
          `${clone.datasetKey}: A/B answers ${clone.ab.missing} missing, ${clone.ab.stale} stale`
        );
      }
    }
  }
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
  return phaseAccess(participant.participantNumber, phase).workDatasetKey;
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
export const GENERATION_KINDS: BankKind[] = ['test', 'ab'];
