/**
 * The end-of-session comparison (design §6.5) — both versions, side by side,
 * once.
 *
 * WHY IT IS NOT PER BLOCK. The first block's absolute rating has nothing to
 * anchor against; a rating taken straight after a block test is pulled by how
 * the eight answers just scored rather than by the tool; and asked at the end,
 * both versions are recalled from the same distance. It also leaves the blocks
 * carrying behavioural measures only.
 *
 * WHY IT IS IN THIS APP AND NOT QUALTRICS. The design named Qualtrics because
 * it has side-by-side and bipolar question types off the shelf. Building it
 * here buys back the three things that arrangement costs: the participant
 * number is already known rather than typed in (and the consent form promised
 * a number rather than a name), the column order follows the participant's own
 * assigned cell instead of a facilitator picking the right one of two survey
 * versions to send, and the answers land in the same export as everything
 * else. The recall aid gets better too — the two boards are one link away in
 * this same app rather than "a tab you still have open somewhere".
 *
 * THE RULES THAT ARE NOT PREFERENCES.
 *   • Column order is the order the participant USED them, first on the left.
 *     Pinning a condition to a side would pool the left-hand primacy bias onto
 *     one arm (§13 invariant 8).
 *   • Row order is fixed, never shuffled: the constructs are already
 *     interleaved so a halo cannot run down a column, and L2 — the one
 *     reversed item, there to catch straight-lining — sits in the middle on
 *     purpose.
 *   • No statement may mention a feature only one version has. It would be
 *     unanswerable on the other side, and it would tell the participant which
 *     version they are being sold.
 *   • The names are never explained (§13 invariant 7).
 */
import type { StudioView } from './config';

export type FinalPageKey = 'experience' | 'context' | 'compare' | 'open';

/** A statement rated separately for each version (B-1, B-2). */
export interface VersionRatedItem {
  /** The design's own code, and the export tag. */
  key: string;
  text: string;
  /** Marks the one reverse-worded item, for the straight-lining check. */
  reversed?: boolean;
}

/** A single 7-point judgement BETWEEN the versions (B-3). */
export interface CompareItem {
  key: string;
  /** Completes "Which one made it easier to…". */
  text: string;
}

export const FINAL_SCALE_MIN = 1;
export const FINAL_SCALE_MAX = 7;
export const AGREE_LOW = 'Strongly disagree';
export const AGREE_HIGH = 'Strongly agree';

/** B-1 — authoring experience. Eight, cut from thirteen: the surviving test is
 * "does it catch something no other measure in this study catches". */
export const EXPERIENCE_ITEMS: VersionRatedItem[] = [
  { key: 'E2', text: 'It was easy to say when a behavior should apply and when it should not.' },
  { key: 'C1', text: 'I felt in control of how the chatbot will behave.' },
  {
    key: 'L1',
    text: 'When I changed something, I knew which student questions it would affect.',
  },
  { key: 'O1', text: 'I had a clear overview of everything the chatbot was set up to do.' },
  {
    key: 'L2',
    text: 'I worried that fixing one thing would change how the chatbot handled other questions.',
    reversed: true,
  },
  { key: 'P1', text: 'I could predict how the chatbot would respond to a new student question.' },
  { key: 'L3', text: 'When I noticed a problem, I knew where in my setup to go to fix it.' },
  {
    key: 'T2',
    text: 'I would be comfortable letting my own students use the chatbot I set up with this version.',
  },
];

/** B-2 — the manipulation check and one validity question. U2 and U3 are meant
 * to come out EQUAL: the two versions share a shell and an AI surface, and a
 * gap there says the ablation cut more than it was supposed to. */
export const CONTEXT_ITEMS: VersionRatedItem[] = [
  { key: 'U2', text: 'This version was easy to use.' },
  { key: 'U3', text: 'The suggestions the tool offered were helpful.' },
  {
    key: 'R1',
    text: 'The conversations I reviewed in this round were similar to the questions my own students ask.',
  },
];

/** B-3 — one per mechanism: expression, predictability, local repair,
 * overview, interference. Absolute ratings sit on a personal baseline that a
 * relative judgement cancels, so the two are asked separately on purpose. */
export const COMPARE_ITEMS: CompareItem[] = [
  { key: 'I1', text: 'express what you wanted the chatbot to do?' },
  { key: 'I2', text: 'predict how the chatbot would respond to a new question?' },
  { key: 'I3', text: "find and fix a specific behavior you didn't like?" },
  { key: 'I4', text: 'keep an overview of everything you had set up?' },
  { key: 'I5', text: 'make a change without worrying about side effects on other questions?' },
];

/** B-4 — one box per version, symmetric so a lopsided answer is visible. */
export const OPEN_ITEM_KEY = 'FT';

export interface FinalColumn {
  condition: StudioView;
  /** Participant-facing name (Slate / Clay). */
  name: string;
  /** Which block they used it in — the export's join. */
  block: 1 | 2;
  /** The workspace this column is about. Nothing on the screen links to it —
   * the board is shut by then, and deliberately (see FinalSurvey) — but the
   * column has to be able to say WHICH clone it is rating for anything reading
   * these answers afterwards. */
  cloneAssignmentId: string | null;
}

/** Every answer this survey requires before it can be finished. */
export function requiredKeys(columns: FinalColumn[]): { key: string; condition: string | null }[] {
  const rated = [...EXPERIENCE_ITEMS, ...CONTEXT_ITEMS].flatMap((i) =>
    columns.map((c) => ({ key: i.key, condition: c.condition as string | null }))
  );
  return [...rated, ...COMPARE_ITEMS.map((i) => ({ key: i.key, condition: null }))];
}

export const FINAL_PAGES: { key: FinalPageKey; title: string; instruction: string }[] = [
  {
    key: 'experience',
    title: 'Rating the two versions',
    instruction: 'For each statement, please rate the two versions separately.',
  },
  {
    key: 'context',
    title: 'A few last ratings',
    instruction: 'A few last ratings, in the same way.',
  },
  {
    key: 'compare',
    title: 'Comparing them directly',
    instruction: 'Now comparing the two directly. Which one made it easier to…',
  },
  {
    key: 'open',
    title: 'In your own words',
    instruction: 'Two short questions, and then we are done. Neither is required.',
  },
];
