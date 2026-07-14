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

// Study session cookie lifetime. Short (1 day) vs the 30-day instructor
// default — a lab session is bounded, and participants get a real
// instructor-role account, so we don't want long-lived sessions lingering.
// (Re-login is free; it never re-clones or loses work.)
export const STUDY_SESSION_MAX_AGE_SECONDS = 24 * 60 * 60;

// Internal email domain for the auto-created participant accounts.
export const STUDY_EMAIL_DOMAIN = 'study.score.local';
