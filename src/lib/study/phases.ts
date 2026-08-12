/**
 * Session state for a study participant: which counterbalancing cell they are
 * in, and where they are in the two-block protocol.
 *
 * The participant drives the phase themselves (advance.ts), one step forward at
 * a time; the session is watched over a shared screen rather than gated, and
 * the console keeps the moves — back, jump, force — that only exist to recover
 * a run. So this module owns the ordering rules and the app only renders what
 * the current phase allows.
 */
// STUDY_DATASETS, not the curation masters: a block is over what the
// participant actually holds a clone of.
import { STUDY_DATASETS, conditionForDataset, type StudioView } from './config';

/* ------------------------------------------------------------------ */
/* Phases                                                              */
/* ------------------------------------------------------------------ */

export const STUDY_PHASES = [
  'not_started',
  'block1_work',
  'block1_test',
  'block1_survey',
  'break',
  'block2_work',
  'block2_test',
  'block2_survey',
  'ab',
  'done',
] as const;

export type StudyPhase = (typeof STUDY_PHASES)[number];

export function isStudyPhase(v: unknown): v is StudyPhase {
  return typeof v === 'string' && (STUDY_PHASES as readonly string[]).includes(v);
}

export const PHASE_LABELS: Record<StudyPhase, string> = {
  not_started: 'Not started',
  block1_work: 'Block 1 · configure',
  block1_test: 'Block 1 · test',
  block1_survey: 'Block 1 · survey',
  break: 'Break',
  block2_work: 'Block 2 · configure',
  block2_test: 'Block 2 · test',
  block2_survey: 'Block 2 · survey',
  ab: 'Blind A/B',
  done: 'Done',
};

export function nextPhase(phase: StudyPhase): StudyPhase | null {
  const i = STUDY_PHASES.indexOf(phase);
  return i >= 0 && i < STUDY_PHASES.length - 1 ? STUDY_PHASES[i + 1] : null;
}

export function prevPhase(phase: StudyPhase): StudyPhase | null {
  const i = STUDY_PHASES.indexOf(phase);
  return i > 0 ? STUDY_PHASES[i - 1] : null;
}

/** Which block (1 or 2) a phase belongs to; null for break / A-B / endpoints. */
export function blockOf(phase: StudyPhase): 1 | 2 | null {
  if (phase.startsWith('block1')) return 1;
  if (phase.startsWith('block2')) return 2;
  return null;
}

/* ------------------------------------------------------------------ */
/* Counterbalancing cells                                              */
/* ------------------------------------------------------------------ */

/**
 * The 4-cell design: condition ORDER × dataset pairing. The pairing half
 * already exists as conditionForDataset (number parity); this adds the order
 * half on the SAME number, so a facilitator still only issues numbers.
 *
 *   N%4 → 1: swag first (pairing odd  → swag=baseline)  = Baseline(SWAG) first
 *         2: swag first (pairing even → swag=score)     = SCORE(SWAG) first
 *         3: nirvana first (pairing odd → nirvana=score)= SCORE(NIRVANA) first
 *         0: nirvana first (pairing even→ nirvana=baseline) = Baseline(NIRVANA) first
 *
 * The parity halves line up: 1 and 3 are odd, 2 and 0 are even, so this never
 * contradicts the pairing rule already recorded on the clones.
 */
export function participantNumberValue(participantNumber: string): number {
  const digits = participantNumber.replace(/\D/g, '');
  return digits
    ? parseInt(digits, 10)
    : [...participantNumber].reduce((s, c) => s + c.charCodeAt(0), 0);
}

export function cellForParticipant(participantNumber: string): 1 | 2 | 3 | 4 {
  const mod = participantNumberValue(participantNumber) % 4;
  // Cells are numbered in the runbook's order; the value is just a label.
  return (mod === 0 ? 4 : mod) as 1 | 2 | 3 | 4;
}

/** Which dataset the participant works on FIRST, from the same number. */
export function firstDatasetFor(participantNumber: string): string {
  const cell = cellForParticipant(participantNumber);
  const swagFirst = cell === 1 || cell === 2;
  const swag = STUDY_DATASETS.find((d) => d.key === 'swag')?.key ?? 'swag';
  const nirvana = STUDY_DATASETS.find((d) => d.key === 'nirvana')?.key ?? 'nirvana';
  return swagFirst ? swag : nirvana;
}

/** Dataset order for the two blocks, and the condition each one carries. */
export function blockPlan(participantNumber: string): {
  block: 1 | 2;
  datasetKey: string;
  condition: StudioView;
}[] {
  const first = firstDatasetFor(participantNumber);
  const second = STUDY_DATASETS.map((d) => d.key).find((k) => k !== first) ?? first;
  return [
    { block: 1, datasetKey: first, condition: conditionForDataset(participantNumber, first) },
    { block: 2, datasetKey: second, condition: conditionForDataset(participantNumber, second) },
  ];
}

/** Human-readable cell description for the console and the runbook. */
export function cellSummary(participantNumber: string): string {
  const plan = blockPlan(participantNumber);
  return plan.map((p) => `${p.condition}(${p.datasetKey})`).join(' → ');
}

/* ------------------------------------------------------------------ */
/* What a phase permits                                                */
/* ------------------------------------------------------------------ */

export interface PhaseAccess {
  /** The dataset whose board the participant may open now (null = none). */
  workDatasetKey: string | null;
  /** The block whose frozen answers the test screen should show. */
  testBlock: 1 | 2 | null;
  showSurvey: boolean;
  showAb: boolean;
  isBreak: boolean;
  isDone: boolean;
}

export function phaseAccess(participantNumber: string, phase: StudyPhase): PhaseAccess {
  const plan = blockPlan(participantNumber);
  const datasetOf = (block: 1 | 2) => plan.find((p) => p.block === block)?.datasetKey ?? null;

  switch (phase) {
    case 'block1_work':
      return { workDatasetKey: datasetOf(1), testBlock: null, showSurvey: false, showAb: false, isBreak: false, isDone: false };
    case 'block2_work':
      return { workDatasetKey: datasetOf(2), testBlock: null, showSurvey: false, showAb: false, isBreak: false, isDone: false };
    case 'block1_test':
      return { workDatasetKey: null, testBlock: 1, showSurvey: false, showAb: false, isBreak: false, isDone: false };
    case 'block2_test':
      return { workDatasetKey: null, testBlock: 2, showSurvey: false, showAb: false, isBreak: false, isDone: false };
    case 'block1_survey':
    case 'block2_survey':
      return { workDatasetKey: null, testBlock: null, showSurvey: true, showAb: false, isBreak: false, isDone: false };
    case 'break':
      return { workDatasetKey: null, testBlock: null, showSurvey: false, showAb: false, isBreak: true, isDone: false };
    case 'ab':
      return { workDatasetKey: null, testBlock: null, showSurvey: false, showAb: true, isBreak: false, isDone: false };
    case 'done':
      return { workDatasetKey: null, testBlock: null, showSurvey: false, showAb: false, isBreak: false, isDone: true };
    default:
      return { workDatasetKey: null, testBlock: null, showSurvey: false, showAb: false, isBreak: false, isDone: false };
  }
}
