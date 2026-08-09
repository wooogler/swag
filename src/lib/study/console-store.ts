/**
 * What the facilitator console shows and does.
 *
 * One read that answers "is this participant ready for the next phase?" —
 * deploy state per clone, whether the frozen answers exist AND still match the
 * deployed configuration, and the phase itself. The gate the console enforces
 * is the study's, not the UI's: a test phase entered without current answers
 * would measure a configuration the participant no longer has.
 */
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { db } from '@/db/db';
import {
  baselinePromptVersions,
  scoreChatDeploys,
  studyClones,
  studyParticipants,
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

export async function getParticipantStatus(
  participant: StudyParticipant
): Promise<ParticipantStatus> {
  const clones = await db
    .select()
    .from(studyClones)
    .where(eq(studyClones.participantId, participant.id));
  const plan = blockPlan(participant.participantNumber);
  const phase: StudyPhase = isStudyPhase(participant.phase) ? participant.phase : 'not_started';

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
      return {
        datasetKey: clone.datasetKey,
        assignmentId: clone.assignmentId,
        condition: conditionOf(clone),
        block,
        deployed: deploy.deployed,
        deployLabel: deploy.label,
        test,
        ab,
      };
    })
  );

  return {
    id: participant.id,
    participantNumber: participant.participantNumber,
    cell: participant.cell ?? cellForParticipant(participant.participantNumber),
    blockOrder: participant.blockOrder ?? plan.map((p) => p.datasetKey).join(','),
    phase,
    lastLoginAt: participant.lastLoginAt ? participant.lastLoginAt.toISOString() : null,
    clones: cloneStatuses.sort((a, b) => (a.block ?? 9) - (b.block ?? 9)),
    blockers: advanceBlockers(phase, cloneStatuses),
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
