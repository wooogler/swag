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
import { STUDY_DATASETS, type StudioView } from './config';

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

/** Which block (1 or 2) a phase belongs to; null for the break and endpoints. */
export function blockOf(phase: StudyPhase): 1 | 2 | null {
  if (phase.startsWith('block1')) return 1;
  if (phase.startsWith('block2')) return 2;
  return null;
}

/* ------------------------------------------------------------------ */
/* Counterbalancing cells                                              */
/* ------------------------------------------------------------------ */

/**
 * The 4-cell design: condition ORDER × dataset pairing.
 *
 * A cell fully determines the session — pick what block 1 is and block 2 is
 * forced, because each participant sees both datasets and both conditions:
 *
 *   1: Baseline(SWAG)    → SCORE(NIRVANA)
 *   2: SCORE(SWAG)       → Baseline(NIRVANA)
 *   3: SCORE(NIRVANA)    → Baseline(SWAG)
 *   4: Baseline(NIRVANA) → SCORE(SWAG)
 *
 * The cell is ASSIGNED by the researcher when they create the participant and
 * stored on the row. It used to be computed from the participant number
 * (n % 4, with the condition following the number's parity), which meant the
 * number silently decided the design and a renumbered participant changed
 * cells. cellFromNumber below still reproduces that rule exactly, as the
 * fallback for rows created before the cell was stored.
 */
export type StudyCell = 1 | 2 | 3 | 4;

export function isStudyCell(v: unknown): v is StudyCell {
  return v === 1 || v === 2 || v === 3 || v === 4;
}

export const STUDY_CELLS: StudyCell[] = [1, 2, 3, 4];

export interface BlockPlanEntry {
  block: 1 | 2;
  datasetKey: string;
  condition: StudioView;
}

/** Block 1 of each cell; block 2 is the other dataset in the other condition. */
const CELL_FIRST: Record<StudyCell, { datasetKey: string; condition: StudioView }> = {
  1: { datasetKey: 'swag', condition: 'baseline' },
  2: { datasetKey: 'swag', condition: 'score' },
  3: { datasetKey: 'nirvana', condition: 'score' },
  4: { datasetKey: 'nirvana', condition: 'baseline' },
};

export function planForCell(cell: StudyCell): BlockPlanEntry[] {
  const first = CELL_FIRST[cell];
  const keys = STUDY_DATASETS.map((d) => d.key);
  const firstKey = keys.includes(first.datasetKey) ? first.datasetKey : keys[0] ?? first.datasetKey;
  const secondKey = keys.find((k) => k !== firstKey) ?? firstKey;
  return [
    { block: 1, datasetKey: firstKey, condition: first.condition },
    { block: 2, datasetKey: secondKey, condition: first.condition === 'score' ? 'baseline' : 'score' },
  ];
}

/** What a cell reads as, for the console and the runbook. */
export function cellLabel(cell: StudyCell): string {
  return planForCell(cell)
    .map((p) => `${p.condition}(${p.datasetKey})`)
    .join(' → ');
}

export function participantNumberValue(participantNumber: string): number {
  const digits = participantNumber.replace(/\D/g, '');
  return digits
    ? parseInt(digits, 10)
    : [...participantNumber].reduce((s, c) => s + c.charCodeAt(0), 0);
}

/** The pre-assignment rule, kept only to place rows that predate the column. */
export function cellFromNumber(participantNumber: string): StudyCell {
  const mod = participantNumberValue(participantNumber) % 4;
  return (mod === 0 ? 4 : mod) as StudyCell;
}

/**
 * Anything that knows which cell a participant is in.
 *
 * Every caller passes the participant ROW, so the assigned cell is what runs.
 * The number-derived fallback is for rows stamped before assignment existed —
 * it returns the same cell those rows already carry, so nothing moves.
 */
export interface CellSource {
  participantNumber: string;
  cell?: number | null;
}

export function cellOf(p: CellSource): StudyCell {
  return isStudyCell(p.cell) ? p.cell : cellFromNumber(p.participantNumber);
}

/** Which dataset this participant works on FIRST. */
export function firstDatasetFor(p: CellSource): string {
  return planForCell(cellOf(p))[0].datasetKey;
}

/** Dataset order for the two blocks, and the condition each one carries. */
export function blockPlan(p: CellSource): BlockPlanEntry[] {
  return planForCell(cellOf(p));
}

/** Human-readable cell description for the console and the runbook. */
export function cellSummary(p: CellSource): string {
  return cellLabel(cellOf(p));
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
  isBreak: boolean;
  isDone: boolean;
}

export function phaseAccess(p: CellSource, phase: StudyPhase): PhaseAccess {
  const plan = blockPlan(p);
  const datasetOf = (block: 1 | 2) => plan.find((p) => p.block === block)?.datasetKey ?? null;

  switch (phase) {
    case 'block1_work':
      return { workDatasetKey: datasetOf(1), testBlock: null, showSurvey: false, isBreak: false, isDone: false };
    case 'block2_work':
      return { workDatasetKey: datasetOf(2), testBlock: null, showSurvey: false, isBreak: false, isDone: false };
    case 'block1_test':
      return { workDatasetKey: null, testBlock: 1, showSurvey: false, isBreak: false, isDone: false };
    case 'block2_test':
      return { workDatasetKey: null, testBlock: 2, showSurvey: false, isBreak: false, isDone: false };
    case 'block1_survey':
    case 'block2_survey':
      return { workDatasetKey: null, testBlock: null, showSurvey: true, isBreak: false, isDone: false };
    case 'break':
      return { workDatasetKey: null, testBlock: null, showSurvey: false, isBreak: true, isDone: false };
    case 'done':
      return { workDatasetKey: null, testBlock: null, showSurvey: false, isBreak: false, isDone: true };
    default:
      return { workDatasetKey: null, testBlock: null, showSurvey: false, isBreak: false, isDone: false };
  }
}
