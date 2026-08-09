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

/** Per-QUERY-TYPE target size of each curated set (design §4). */
export const SET_TARGETS_PER_TYPE = { review: 15, test: 2, ab: 2 } as const;
export type CurationSetKind = keyof typeof SET_TARGETS_PER_TYPE;
export const CURATION_SET_KINDS = Object.keys(SET_TARGETS_PER_TYPE) as CurationSetKind[];

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

// ── Baseline study condition ──────────────────────────────────────────────
export type StudioView = 'score' | 'baseline';

/**
 * Deterministic condition assignment (which dataset gets which condition for a
 * participant). Parity on the participant number's numeric part:
 *   even → swag=score,   nirvana=baseline
 *   odd  → swag=baseline, nirvana=score
 * Session ORDER (which condition first) is controlled by the facilitator via
 * number issuance; this only fixes the pairing. See spec §1.2.
 */
export function conditionForDataset(participantNumber: string, datasetKey: string): StudioView {
  const digits = participantNumber.replace(/\D/g, '');
  const n = digits
    ? parseInt(digits, 10)
    : [...participantNumber].reduce((s, c) => s + c.charCodeAt(0), 0);
  const even = n % 2 === 0;
  if (datasetKey === 'swag') return even ? 'score' : 'baseline';
  if (datasetKey === 'nirvana') return even ? 'baseline' : 'score';
  return 'score'; // fallback for any future dataset
}

// Baseline monolithic prompt editor character ceiling (matches GPT Builder /
// Claude ~8k). Both conditions write against the same ceiling.
export const STUDY_PROMPT_CHAR_LIMIT = Number(process.env.STUDY_PROMPT_CHAR_LIMIT ?? 8000);
