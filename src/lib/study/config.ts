/**
 * SCORE user-study configuration.
 *
 * Self-service flow: a participant opens /study, types a participant number +
 * the shared passcode below. On first sign-in, one clone of EACH dataset in
 * STUDY_DATASETS is created for them (reusing each master's pre-computed
 * "Run all" starter set), and they land on their instructor dashboard showing
 * all of their dataset boards. No pre-provisioning command.
 */

// ⬇⬇⬇  THE SHARED STUDY PASSCODE  ⬇⬇⬇
// Every participant enters this same passcode. Change it here (or set
// STUDY_PASSCODE in the environment) before running a study.
export const STUDY_PASSCODE = process.env.STUDY_PASSCODE ?? 'score-study-2026';

export interface StudyDataset {
  key: string; // stable slug used in share tokens / clone keys
  label: string; // operator-facing dataset name (e.g. in reset button labels)
  assignmentId: string; // the master to clone (only its template starter set is copied)
  // Participant-facing assignment title for the clone. Kept apart from the
  // master's (researcher-facing) title so participants see a plain, plausible
  // assignment name rather than an internal "… Dataset" label.
  cloneTitle: string;
}

// The datasets a participant gets a clone of. Add/remove entries to change what
// each participant works on. Each master only needs its "Run all" starter set
// (template intents + ratings); any active intents / rules / deploy history on
// the master are IGNORED — every participant starts from the clean starter set.
export const STUDY_DATASETS: StudyDataset[] = [
  {
    key: 'swag',
    label: 'SWAG Dataset',
    assignmentId: '03201d5d-08c7-4db1-8e5c-f5edc6563d9a',
    cloneTitle: 'Personal Use of AI in Everyday Life',
  },
  {
    key: 'nirvana',
    label: 'NIRVANA Dataset',
    assignmentId: 'ea905a40-ad5d-4fe5-bbf8-91d6b1998331',
    cloneTitle: 'Intelligent Machines',
  },
];

/**
 * The share token a built study master is addressed by.
 *
 * Lives here, in the leaf module, because both ends need it: build.ts writes
 * the master under this token and provision.ts looks it up to decide what a
 * clone is made from. Addressing by token rather than id is what lets a
 * rebuild replace the master without any id being edited anywhere.
 */
export function studyMasterToken(datasetKey: string): string {
  return `${datasetKey}-study`;
}

// Accepted participant-number shape AFTER normalization (trim/upper/no spaces).
// Keeps typos from spawning junk clones; still permissive (e.g. P01, 7, A12).
export const PARTICIPANT_NUMBER_RE = /^[A-Z0-9][A-Z0-9_-]{0,31}$/;

// ── Set curation (researcher-side admin tool) ─────────────────────────────
// Pre-registered researcher codes; only these may sign in at /study/admin.
// Empty (unset env) = the tool is closed.
export const STUDY_ADMIN_CODES: string[] = (process.env.STUDY_ADMIN_CODES ?? '')
  .split(',')
  .map((c) => c.trim().toUpperCase())
  .filter(Boolean);

export const STUDY_ADMIN_PASSCODE = process.env.STUDY_ADMIN_PASSCODE ?? '';

// Internal email domain for the auto-created researcher accounts.
export const ADMIN_EMAIL_DOMAIN = 'admin.score.local';

/**
 * The masters curation reads from — deliberately SEPARATE from STUDY_DATASETS.
 * Curation always works on the FULL logs (507/348); STUDY_DATASETS points at
 * whatever participants clone, which becomes the reduced study masters once
 * they are built. Pointing curation at STUDY_DATASETS would silently re-scope
 * it to the 60-question subset after that switch.
 */
export interface CurationDataset {
  key: string;
  label: string;
  masterAssignmentId: string;
}

export const CURATION_DATASETS: CurationDataset[] = [
  { key: 'swag', label: 'SWAG', masterAssignmentId: '03201d5d-08c7-4db1-8e5c-f5edc6563d9a' },
  { key: 'nirvana', label: 'NIRVANA', masterAssignmentId: 'ea905a40-ad5d-4fe5-bbf8-91d6b1998331' },
];

export function curationDataset(key: string): CurationDataset | undefined {
  return CURATION_DATASETS.find((d) => d.key === key);
}

/**
 * Per-QUERY-TYPE size of each curated set (design §4) — the SEED value only.
 * The live figures are settings a researcher edits (study_set_targets): the
 * design marks review-set size and A/B item count as things the pilot settles,
 * and a pilot that needs a redeploy to try 12 instead of 16 will not try it.
 */
export const DEFAULT_SET_TARGETS = { review: 15, test: 2 } as const;
export type CurationSetKind = keyof typeof DEFAULT_SET_TARGETS;
export type SetTargets = Record<CurationSetKind, number>;
export const CURATION_SET_KINDS = Object.keys(DEFAULT_SET_TARGETS) as CurationSetKind[];

/** Sanity bounds for the editable targets. */
export const SET_TARGET_LIMITS: Record<CurationSetKind, { min: number; max: number }> = {
  review: { min: 1, max: 40 },
  test: { min: 1, max: 10 },
};

export function isCurationSetKind(v: unknown): v is CurationSetKind {
  return typeof v === 'string' && (CURATION_SET_KINDS as string[]).includes(v);
}

// Study session cookie lifetime. Short (1 day) vs the 30-day instructor
// default — a lab session is bounded, and participants get a real
// instructor-role account, so we don't want long-lived sessions lingering.
// (Re-login is free; it never re-clones or loses work.)
export const STUDY_SESSION_MAX_AGE_SECONDS = 24 * 60 * 60;

// Internal email domain for the auto-created participant accounts.
export const STUDY_EMAIL_DOMAIN = 'study.score.local';

// ── Study conditions ──────────────────────────────────────────────────────
/**
 * A condition is two independent axes, and almost every branch in the codebase
 * wants exactly one of them.
 *
 * ARM is the representation the study manipulates: `score` owns rules with
 * nested intents, `baseline` has one Rules document. It decides what the left
 * column is, how a question is pointed at in the block test, what "the final
 * config" means to the export.
 *
 * FAMILY is which build of the tools the arm is dressed in. `full` is the
 * product board — AI candidates, propose, corrections and fold, diagnostics.
 * `simple` is the same manipulation with all of that removed, so the only
 * thing left varying between its two arms is the representation itself
 * (docs/SCORE_SIMPLE_DESIGN.md §0). It decides which board renders and which
 * routes answer; it decides nothing about the arm.
 *
 * They are crossed, so the stored value is one of four. Read it through
 * `armOf` / `familyOf` rather than comparing to a literal: a bare
 * `=== 'baseline' ? … : 'score'` silently files simple_baseline under score,
 * which is the failure mode this pair of helpers exists to make impossible.
 */
export type StudioArm = 'score' | 'baseline';
export type StudioFamily = 'full' | 'simple';
export type StudioView = 'score' | 'baseline' | 'simple_score' | 'simple_baseline';

export const STUDIO_VIEWS: StudioView[] = ['score', 'baseline', 'simple_score', 'simple_baseline'];

export function isStudioView(v: unknown): v is StudioView {
  return typeof v === 'string' && (STUDIO_VIEWS as string[]).includes(v);
}

/** The representation: what the participant organizes their intent WITH. */
export function armOf(view: StudioView): StudioArm {
  return view === 'baseline' || view === 'simple_baseline' ? 'baseline' : 'score';
}

/** The build: which set of tools that representation is handed in. */
export function familyOf(view: StudioView): StudioFamily {
  return view === 'simple_score' || view === 'simple_baseline' ? 'simple' : 'full';
}

export function viewFor(family: StudioFamily, arm: StudioArm): StudioView {
  if (family === 'full') return arm;
  return arm === 'score' ? 'simple_score' : 'simple_baseline';
}

/** The other arm of the same family — what a participant gets in block 2. */
export function otherArm(view: StudioView): StudioView {
  return viewFor(familyOf(view), armOf(view) === 'score' ? 'baseline' : 'score');
}

export function isSimple(view: StudioView): boolean {
  return familyOf(view) === 'simple';
}

// Condition assignment lives in phases.ts (planForCell). It used to be derived
// here from the participant number's parity; keeping that copy around after the
// cell became an assigned, stored value would leave two answers to the same
// question, and the stale one would win wherever it was still called.

// Baseline monolithic prompt editor character ceiling (matches GPT Builder /
// Claude ~8k). Both conditions write against the same ceiling.
export const STUDY_PROMPT_CHAR_LIMIT = Number(process.env.STUDY_PROMPT_CHAR_LIMIT ?? 8000);

/**
 * The configure block's time budget, in minutes (design v2 §5: "0:08 블록 1 —
 * 설정 작업 (25분 상한)", with a verbal warning five minutes out).
 *
 * NOT enforced anywhere — the facilitator runs the clock, and a hard cutoff at
 * 25:00 would truncate someone mid-edit and damage the final artifact RQ1
 * analyses. These numbers only drive what is DISPLAYED: the participant's own
 * elapsed readout and the console chip the facilitator watches. They live here
 * because the console's threshold had drifted to 30 — the old cap, from before
 * v2 cut it — so the facilitator's cue was arriving five minutes late.
 */
export const STUDY_WORK_MINUTES = 25;
/** When the facilitator gives the verbal warning (design v2 §5). */
export const STUDY_WORK_WARNING_MINUTES = 20;


/**
 * What the two versions are CALLED in front of a participant (design §3.1).
 *
 * Slate = intent–rule, Clay = the single Rules document, and the mapping is
 * fixed rather than counterbalanced. Opaque code names, not descriptions: an
 * order label ("the first version") points at a different thing for every
 * participant, so it cannot go in a demo video or a survey template, and it
 * invites reading the second one as the improved one. The metaphor is for the
 * research team — nobody explains it to a participant, because explaining it
 * primes the hypothesis (§13 invariant 7).
 *
 * Configurable because the same screens get re-rendered for paper figures and
 * talk recordings, where the names have to read SCORE / Baseline (§10.2).
 * NEXT_PUBLIC_ on purpose: the console and the curation board are client
 * components that import this module, and a server-only variable would leave
 * them rendering the default while the server rendered the override.
 *
 * The simple family reuses its arm's name by default. A participant is in one
 * family for the whole session and never sees the other, so the names only
 * ever have to tell the two ARMS apart — which is what they were chosen to do.
 * Each still has an override of its own, for a figure that has to put all four
 * on one page.
 */
export const CONDITION_NAMES: Record<StudioView, string> = {
  score: process.env.NEXT_PUBLIC_STUDY_NAME_SCORE ?? 'Slate',
  baseline: process.env.NEXT_PUBLIC_STUDY_NAME_BASELINE ?? 'Clay',
  simple_score:
    process.env.NEXT_PUBLIC_STUDY_NAME_SIMPLE_SCORE ||
    process.env.NEXT_PUBLIC_STUDY_NAME_SCORE ||
    'Slate',
  simple_baseline:
    process.env.NEXT_PUBLIC_STUDY_NAME_SIMPLE_BASELINE ||
    process.env.NEXT_PUBLIC_STUDY_NAME_BASELINE ||
    'Clay',
};

export function conditionName(view: StudioView): string {
  return CONDITION_NAMES[view];
}

/**
 * The walkthrough films (design §5.1), by YouTube id.
 *
 * Three segments, not two: ⓐ the screens both versions share, then ⓑ or ⓒ for
 * the version this block runs. Block 1 plays the shared one and its version's;
 * block 2 plays only the other version's, because the shared screens are the
 * ones they have just spent half an hour in.
 *
 * A film rather than a live demo, which reverses an 08-10 decision. The live
 * walkthrough was meant to be clearer, and the 08-18 pilot found the thing a
 * script cannot fix: two runs of it are not the same run. Everyone now gets
 * the identical instruction, which is the only version of "the tutorial was
 * held constant" that survives a reviewer.
 *
 * The two version segments must come within fifteen seconds of each other —
 * teaching one arm for longer is a difference between the conditions, and the
 * design admits exactly one of those. Nothing here can enforce that; it is a
 * note for whoever cuts them.
 *
 * The shared segment is shot TWICE — once on each version's board — under one
 * narration track. Its subject is the middle and right columns, which are the
 * same pixels in both arms, but the left column is in every frame, and a
 * participant whose first block is Clay would otherwise spend their first
 * minute looking at the intent tree. So block 1 plays the take shot on the
 * board it is about to open. One id (…_COMMON) still works and is used for
 * both when the per-version ids are unset.
 *
 * The simple family has films of its own — its boards differ, so the full
 * version's footage would teach controls that are not there. It deliberately
 * does not fall back to the full film: an empty slot naming its variable is a
 * missing film, and the wrong film is a silent one.
 *
 * Empty until the films are uploaded, and the slot says so rather than
 * rendering a broken player.
 */
export const STUDY_DEMO_VIDEOS: Record<StudioView, string> & {
  common: Record<StudioView, string>;
} = {
  common: {
    score:
      process.env.NEXT_PUBLIC_STUDY_DEMO_COMMON_SCORE ||
      process.env.NEXT_PUBLIC_STUDY_DEMO_COMMON ||
      '',
    baseline:
      process.env.NEXT_PUBLIC_STUDY_DEMO_COMMON_BASELINE ||
      process.env.NEXT_PUBLIC_STUDY_DEMO_COMMON ||
      '',
    simple_score:
      process.env.NEXT_PUBLIC_STUDY_DEMO_COMMON_SIMPLE_SCORE ||
      process.env.NEXT_PUBLIC_STUDY_DEMO_COMMON_SIMPLE ||
      '',
    simple_baseline:
      process.env.NEXT_PUBLIC_STUDY_DEMO_COMMON_SIMPLE_BASELINE ||
      process.env.NEXT_PUBLIC_STUDY_DEMO_COMMON_SIMPLE ||
      '',
  },
  score: process.env.NEXT_PUBLIC_STUDY_DEMO_SCORE ?? '',
  baseline: process.env.NEXT_PUBLIC_STUDY_DEMO_BASELINE ?? '',
  simple_score: process.env.NEXT_PUBLIC_STUDY_DEMO_SIMPLE_SCORE ?? '',
  simple_baseline: process.env.NEXT_PUBLIC_STUDY_DEMO_SIMPLE_BASELINE ?? '',
};

export interface DemoSegment {
  key: 'common' | StudioView;
  youtubeId: string;
  /** The variable that would fill this slot — named by the empty-state so a
   * missing film says which id to set, not which family of ids. */
  envVar: string;
  /** What the segment is called on screen. */
  label: string;
  caption: string;
}

export function demoSegmentsFor(block: 1 | 2, condition: StudioView): DemoSegment[] {
  const version: DemoSegment = {
    key: condition,
    youtubeId: STUDY_DEMO_VIDEOS[condition],
    envVar: `NEXT_PUBLIC_STUDY_DEMO_${condition.toUpperCase()}`,
    label: conditionName(condition),
    caption: 'The version you will use in this round.',
  };
  if (block === 2) return [version];
  return [
    {
      key: 'common',
      // The take shot on this block's own board — see STUDY_DEMO_VIDEOS.
      youtubeId: STUDY_DEMO_VIDEOS.common[condition],
      envVar: `NEXT_PUBLIC_STUDY_DEMO_COMMON_${condition.toUpperCase()}`,
      label: 'Getting around',
      caption: 'The questions, the search, and the conversation view.',
    },
    version,
  ];
}
