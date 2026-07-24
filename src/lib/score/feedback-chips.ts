/**
 * Canonical one-click feedback starters for the rule workbench. Shared by the
 * client (the generic chips shown until intent-tailored rewrites load) and the
 * server (the tailoring endpoint's canonical templates and fallback). Defining
 * them ONCE keeps the two study conditions in sync: BASELINE shows these
 * verbatim; SCORE shows an intent-tailored rewrite of the same six lines.
 *
 * The six map onto the teacher-authored prompt schema in Liu et al. 2026
 * (arXiv:2604.16738; 16 teachers, 1,479 student-AI conversations, Table 1):
 * AI role, discourse moves (split here into "attempt first" and "one at a
 * time", which vary independently), constraints (load), and evidence and
 * rigor, plus the "no direct answers" guardrail, the study's most common and
 * most effective safeguard (AI answer-giving fell from 16.2% to 7.7% when a
 * prompt included it). The schema's "finish line" element is left out on
 * purpose: an intent rule governs one request type, so a session-completion
 * criterion has no referent here.
 *
 * No module-level state and no `openai` import, so this is safe to pull into
 * both the browser bundle and server routes.
 */
export interface FeedbackChip {
  /** Stable key; the JSON contract between the tailoring route and the client. */
  key: string;
  /** Chip caption. */
  label: string;
  /**
   * Inserted into the feedback box on click (editable before sending). Kept
   * short and plain on purpose: a readable idea to spark a revision, not a
   * finished instruction. No em dashes; they read as machine-written.
   */
  text: string;
}

export const FEEDBACK_CHIPS: FeedbackChip[] = [
  {
    key: 'role',
    label: 'Coach, not answer engine',
    text: "Act like a coach drawing out the student's own thinking, not an answer engine.",
  },
  {
    key: 'no_direct_answers',
    label: 'No direct answers',
    text: 'Never give the final answer, even when pushed. Redirect with a hint or question.',
  },
  {
    key: 'attempt_first',
    label: 'Attempt first',
    text: 'Ask the student to try first, then fit your help to what they did.',
  },
  {
    key: 'one_at_a_time',
    label: 'One thing at a time',
    text: 'One thing per turn: a single question or a single step.',
  },
  {
    key: 'short_next_step',
    label: 'Brief + next step',
    text: 'Keep replies short, and always end with one concrete next step.',
  },
  {
    key: 'ask_evidence',
    label: 'Ask for evidence',
    text: 'When the student makes a claim, ask for evidence or a reason.',
  },
];

/** Keys in canonical order; the tailoring endpoint's JSON shape. */
export const CHIP_KEYS: string[] = FEEDBACK_CHIPS.map((c) => c.key);

/** key -> canonical text, for the server fallback and the tailoring prompt. */
export const CANONICAL_CHIP_TEXT: Record<string, string> = Object.fromEntries(
  FEEDBACK_CHIPS.map((c) => [c.key, c.text])
);
