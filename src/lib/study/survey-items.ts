/**
 * The in-block questionnaire: five NASA-TLX subscales, taken straight after
 * deploy and before the block test (design §6.4).
 *
 * WHY SUBSCALES AND NOT AGREE/DISAGREE. This used to be five agreement
 * statements — two on control, two on load, one on trust. The load pair read
 * "Setting up the chatbot was mentally demanding. (1–7 agree)", which is a
 * TRANSLATION of TLX, not a subscale of it. Claiming TLX in a paper is far
 * easier to defend with the original stems and the original anchors, and
 * partial use is ordinary in HCI (EvalLM runs the same five, excluding
 * Physical Demand). Control and trust did not move here — they went to the
 * end-of-session comparison, where a rating has the other version to sit
 * beside (§5.5).
 *
 * WHY THE TASK IS NAMED IN EVERY STEM. TLX is administered about a NAMED task;
 * the original's bare "the task" has no referent in this design, so each
 * participant would silently choose their own. Naming it in the stem is the
 * normal use of the instrument, not a variation of it.
 *
 * NO REVERSE SCORING. Performance keeps the original's flipped anchors
 * (Perfect → Failure), which is what makes all five read "higher is worse".
 * That only works if the ends are LABELLED on screen — this is the one item
 * whose direction cannot be guessed from the number.
 *
 * `key` is what the answers are stored under, so reword freely but keep the
 * key — and mint a new one if the construct changes rather than redefining an
 * old one. These are new keys precisely because they measure something the old
 * five did not.
 */

export interface SurveyItem {
  key: string;
  /** Which TLX subscale this is (Physical Demand is deliberately absent). */
  construct: 'mental' | 'temporal' | 'performance' | 'effort' | 'frustration';
  /** The subscale's own name, shown above the question as TLX prints it. */
  label?: string;
  text: string;
  /** Anchor labels for the low and high ends. */
  low: string;
  high: string;
  /**
   * A line under the question. Required on Performance and for a reason: this
   * study sets no success criterion, so "how successful were you" invites the
   * answer "I failed, I only got through five conversations" — which measures
   * a misunderstanding rather than a workload. The original TLX allows goals
   * "set by the experimenter (or yourself)"; this says so out loud.
   */
  note?: string;
  /** True if a high score means MORE of a bad thing — analysis only. Unset on
   * all five here: the flipped Performance anchor already makes that uniform. */
  reverse?: boolean;
}

export const SURVEY_SCALE_MIN = 1;
/** Default top of the scale; the live value is a setting (survey-store). */
export const DEFAULT_SURVEY_SCALE_MAX = 7;
/** The scales the design would plausibly use — 5-point or 7-point Likert. */
export const SURVEY_SCALE_CHOICES = [5, 7] as const;

const LOW_HIGH = { low: 'Very low', high: 'Very high' } as const;

export const DEFAULT_SURVEY_ITEMS: SurveyItem[] = [
  {
    key: 'tlx_mental',
    construct: 'mental',
    label: 'Mental Demand',
    text: 'How mentally demanding was setting up the chatbot?',
    ...LOW_HIGH,
  },
  {
    key: 'tlx_temporal',
    construct: 'temporal',
    label: 'Temporal Demand',
    text: 'How hurried or rushed was the pace while you were setting it up?',
    ...LOW_HIGH,
  },
  {
    key: 'tlx_performance',
    construct: 'performance',
    label: 'Performance',
    text: 'How successful were you in accomplishing what you set out to do?',
    // The one flipped pair. Not a mistake to be tidied up: it is what leaves
    // every subscale pointing the same way, so nothing needs reverse scoring.
    low: 'Perfect',
    high: 'Failure',
    note: 'There was no set amount to cover — judge this against your own goal for this round.',
  },
  {
    key: 'tlx_effort',
    construct: 'effort',
    label: 'Effort',
    text: 'How hard did you have to work to accomplish your level of performance?',
    ...LOW_HIGH,
  },
  {
    key: 'tlx_frustration',
    construct: 'frustration',
    label: 'Frustration',
    text: 'How insecure, discouraged, irritated, stressed, and annoyed were you while setting it up?',
    ...LOW_HIGH,
  },
];

export const SURVEY_CONSTRUCTS: SurveyItem['construct'][] = [
  'mental',
  'temporal',
  'performance',
  'effort',
  'frustration',
];

/** Item keys are the data's identity: reword freely, but a changed CONSTRUCT
 * deserves a new key rather than a redefinition of an old one. */
export const SURVEY_ITEM_KEY_RE = /^[a-z][a-z0-9_]{1,39}$/;

export function isValidSurveyItems(value: unknown): value is SurveyItem[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  const keys = new Set<string>();
  for (const raw of value) {
    const item = raw as Partial<SurveyItem>;
    if (typeof item?.key !== 'string' || !SURVEY_ITEM_KEY_RE.test(item.key)) return false;
    if (keys.has(item.key)) return false;
    keys.add(item.key);
    if (!SURVEY_CONSTRUCTS.includes(item.construct as SurveyItem['construct'])) return false;
    if (typeof item.text !== 'string' || item.text.trim() === '') return false;
    if (typeof item.low !== 'string' || typeof item.high !== 'string') return false;
  }
  return true;
}
