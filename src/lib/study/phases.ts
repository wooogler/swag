/**
 * Session state for a study participant: which counterbalancing cell they are
 * in, and where they are in the two-block protocol.
 *
 * The participant drives the phase themselves (advance.ts), one step forward at
 * a time, and since the study went to parallel breakout rooms that is the only
 * thing driving it: nobody is watching a shared screen, so every step has to be
 * completable from the screen alone. The console keeps the moves — back, jump,
 * force — but they are now recovery a researcher has to be TOLD to make rather
 * than something they see. So this module owns the ordering rules and the app
 * only renders what the current phase allows.
 */
// The SEED datasets, not the curation sources: a block is over what the
// participant actually holds a clone of, and the seeds are what every row that
// predates the dataset registry was made of.
import {
  SEED_DATASETS,
  viewFor,
  type StudioArm,
  type StudioFamily,
  type StudioView,
} from './config';

/* ------------------------------------------------------------------ */
/* Phases                                                              */
/* ------------------------------------------------------------------ */

/**
 * The order a block runs in: configure, then the workload questionnaire, then
 * the block test.
 *
 * The questionnaire used to come last. It moved in front of the test on 08-18
 * (design §5.3) for three reasons: NASA-TLX is by definition a measure taken
 * straight after the task, and after the test it was being taken after eight
 * revealed answers instead; the batch of frozen answers is generating in the
 * background right then, so the minute it takes is a minute nobody waits; and
 * it reaches the participant before any feedback has, so Pass 1's
 * no-information condition survives intact.
 *
 * The phase STRING still says `survey`. Renaming it would orphan every row
 * already stamped with it — participant.phase, and every phase_advance event
 * the pilot left behind — for a word. The labels below carry the meaning.
 */
export const STUDY_PHASES = [
  'not_started',
  'block1_work',
  'block1_survey',
  'block1_test',
  // Named `break` because that is what it was, and the string is stamped on
  // every row and every phase_advance payload the pilot left behind. It is not
  // a break any more: it is the second walkthrough, and under breakout rooms a
  // screen that invites someone to step away is a screen nobody comes back
  // from on time. PHASE_LABELS below carries what it now is.
  'break',
  'block2_work',
  'block2_survey',
  'block2_test',
  // The comparison, which needs both versions behind it — so it is a phase of
  // its own at the end rather than anything a block owns (design §5.5).
  'final_survey',
  'done',
] as const;

export type StudyPhase = (typeof STUDY_PHASES)[number];

export function isStudyPhase(v: unknown): v is StudyPhase {
  return typeof v === 'string' && (STUDY_PHASES as readonly string[]).includes(v);
}

export const PHASE_LABELS: Record<StudyPhase, string> = {
  not_started: 'Not started',
  block1_work: 'Block 1 · configure',
  block1_survey: 'Block 1 · workload',
  block1_test: 'Block 1 · test',
  break: 'Block 2 · walkthrough',
  block2_work: 'Block 2 · configure',
  block2_survey: 'Block 2 · workload',
  block2_test: 'Block 2 · test',
  final_survey: 'Final survey',
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

/**
 * Block 1 of each cell; block 2 is the other dataset in the other ARM.
 *
 * The cell carries the arm and a SLOT, not a dataset name. Which dataset is
 * block 1's material is a property of the study as it is currently configured
 * (datasets.ts) and the cell only says which of the two a participant meets
 * first — so pointing the study at a different pair re-counterbalances the same
 * four cells instead of orphaning them.
 *
 * Which build of the tools those arms come in — the full board or the simple
 * one — is a property of the participant (`condition_family`), because it does
 * not vary within a session: a participant does both blocks in one family, and
 * crossing it into the cells would make eight of them for a design that still
 * counterbalances four things.
 */
const CELL_FIRST: Record<StudyCell, { slot: 1 | 2; arm: StudioArm }> = {
  1: { slot: 1, arm: 'baseline' },
  2: { slot: 1, arm: 'score' },
  3: { slot: 2, arm: 'score' },
  4: { slot: 2, arm: 'baseline' },
};

/** The pair every row that predates the registry was made of. */
const SEED_PAIR = [...SEED_DATASETS].sort((a, b) => a.slot - b.slot).map((d) => d.key);

/**
 * The plan a cell implies over a given pair of datasets.
 *
 * `pair` is [block-slot-1, block-slot-2] — the study's current material, read
 * from the registry by whoever is CREATING a participant. Everything after that
 * reads the plan off the participant's own row (blockPlanFromOrder), because a
 * study that repoints mid-session must not retitle the blocks of someone
 * already in one.
 */
export function planForCell(
  cell: StudyCell,
  family: StudioFamily = 'full',
  pair: string[] = SEED_PAIR
): BlockPlanEntry[] {
  const first = CELL_FIRST[cell];
  const keys = pair.length >= 2 ? pair : SEED_PAIR;
  const firstKey = keys[first.slot - 1] ?? keys[0];
  const secondKey = keys.find((k) => k !== firstKey) ?? firstKey;
  return planFor(cell, family, firstKey, secondKey);
}

/** The two blocks, given which dataset each one is. */
function planFor(
  cell: StudyCell,
  family: StudioFamily,
  firstKey: string,
  secondKey: string
): BlockPlanEntry[] {
  const first = CELL_FIRST[cell];
  const secondArm: StudioArm = first.arm === 'score' ? 'baseline' : 'score';
  return [
    { block: 1, datasetKey: firstKey, condition: viewFor(family, first.arm) },
    { block: 2, datasetKey: secondKey, condition: viewFor(family, secondArm) },
  ];
}

/** What a cell reads as, for the console and the runbook. */
export function cellLabel(
  cell: StudyCell,
  family: StudioFamily = 'full',
  pair: string[] = SEED_PAIR
): string {
  return planForCell(cell, family, pair)
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
  /** 'simple' puts both blocks on the stripped-down board; anything else (and
   * every row that predates the column) runs the full one. */
  conditionFamily?: string | null;
  /**
   * The two dataset keys, in block order, stamped when the participant was
   * created (provision.ts). THE authority on what their blocks are made of: the
   * study's current pair can be repointed at any time, and a participant's
   * blocks cannot move under them when it is. Null on rows made before the
   * column existed, which ran the seed pair.
   */
  blockOrder?: string | null;
}

export function cellOf(p: CellSource): StudyCell {
  return isStudyCell(p.cell) ? p.cell : cellFromNumber(p.participantNumber);
}

/** Which build of the tools this participant runs — the same for both blocks. */
export function familyOf(p: CellSource): StudioFamily {
  return p.conditionFamily === 'simple' ? 'simple' : 'full';
}

/** Which dataset this participant works on FIRST. */
export function firstDatasetFor(p: CellSource): string {
  return blockPlan(p)[0].datasetKey;
}

/**
 * Dataset order for the two blocks, and the condition each one carries.
 *
 * Read from the participant's stamp when there is one — the pair they were
 * created against — and only otherwise from the seeds. Deliberately sync and
 * deliberately not a registry read: this is called on every phase check, and it
 * must return the same answer during a session no matter what the console has
 * since been pointed at.
 */
export function blockPlan(p: CellSource): BlockPlanEntry[] {
  const cell = cellOf(p);
  const family = familyOf(p);
  const stamped = (p.blockOrder ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  if (stamped.length === 2) return planFor(cell, family, stamped[0], stamped[1]);
  return planForCell(cell, family);
}

/** Human-readable cell description for the console and the runbook. */
export function cellSummary(p: CellSource): string {
  return blockPlan(p)
    .map((b) => `${b.condition}(${b.datasetKey})`)
    .join(' → ');
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
  /** The end-of-session comparison, which belongs to no block. */
  showFinal: boolean;
  isBreak: boolean;
  isDone: boolean;
}

export function phaseAccess(p: CellSource, phase: StudyPhase): PhaseAccess {
  const plan = blockPlan(p);
  const datasetOf = (block: 1 | 2) => plan.find((p) => p.block === block)?.datasetKey ?? null;

  switch (phase) {
    case 'block1_work':
      return { workDatasetKey: datasetOf(1), testBlock: null, showSurvey: false, showFinal: false, isBreak: false, isDone: false };
    case 'block2_work':
      return { workDatasetKey: datasetOf(2), testBlock: null, showSurvey: false, showFinal: false, isBreak: false, isDone: false };
    case 'block1_test':
      return { workDatasetKey: null, testBlock: 1, showSurvey: false, showFinal: false, isBreak: false, isDone: false };
    case 'block2_test':
      return { workDatasetKey: null, testBlock: 2, showSurvey: false, showFinal: false, isBreak: false, isDone: false };
    case 'block1_survey':
    case 'block2_survey':
      return { workDatasetKey: null, testBlock: null, showSurvey: true, showFinal: false, isBreak: false, isDone: false };
    case 'final_survey':
      return { workDatasetKey: null, testBlock: null, showSurvey: false, showFinal: true, isBreak: false, isDone: false };
    case 'break':
      return { workDatasetKey: null, testBlock: null, showSurvey: false, showFinal: false, isBreak: true, isDone: false };
    case 'done':
      return { workDatasetKey: null, testBlock: null, showSurvey: false, showFinal: false, isBreak: false, isDone: true };
    default:
      return { workDatasetKey: null, testBlock: null, showSurvey: false, showFinal: false, isBreak: false, isDone: false };
  }
}
