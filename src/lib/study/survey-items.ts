/**
 * The per-block questionnaire.
 *
 * ⚠ PLACEHOLDER WORDING. The design (§5, §9) leaves two things to the advisor
 * meeting: the exact item wording for control/trust, and whether load is
 * measured with three NASA-TLX items or the UBS mental/emotional subscales.
 * The items below are stand-ins with the right SHAPE — same constructs, same
 * count, same scale — so the flow can be built and piloted; replace the text
 * (and, for load, possibly the item set) once that is settled. Changing them is
 * a content edit here: `item_key` is what the data is keyed by, so keep keys
 * stable if wording changes, and mint new keys if the construct changes.
 */

export interface SurveyItem {
  key: string;
  construct: 'control' | 'trust' | 'load';
  text: string;
  /** Anchor labels for the low and high ends. */
  low: string;
  high: string;
  /** True if a high score means MORE of a bad thing (load) — analysis only. */
  reverse?: boolean;
}

export const SURVEY_SCALE_MIN = 1;
export const SURVEY_SCALE_MAX = 7;

export const DEFAULT_SURVEY_ITEMS: SurveyItem[] = [
  // Sense of control (design: 3-4 items)
  {
    key: 'control_predict',
    construct: 'control',
    text: 'I could predict how the chatbot would answer a new student question.',
    low: 'Strongly disagree',
    high: 'Strongly agree',
  },
  {
    key: 'control_change',
    construct: 'control',
    text: 'When I wanted the chatbot to behave differently, I knew what to change.',
    low: 'Strongly disagree',
    high: 'Strongly agree',
  },
  {
    key: 'control_scope',
    construct: 'control',
    text: 'I could tell which questions each change would affect.',
    low: 'Strongly disagree',
    high: 'Strongly agree',
  },
  {
    key: 'control_overall',
    construct: 'control',
    text: 'Overall, I felt in control of how the chatbot behaved.',
    low: 'Strongly disagree',
    high: 'Strongly agree',
  },

  // Trust (design: 2-3 items)
  {
    key: 'trust_deploy',
    construct: 'trust',
    text: 'I would be comfortable letting my students use this chatbot as it is now.',
    low: 'Strongly disagree',
    high: 'Strongly agree',
  },
  {
    key: 'trust_consistency',
    construct: 'trust',
    text: 'I expect the chatbot to follow my intent consistently, not just sometimes.',
    low: 'Strongly disagree',
    high: 'Strongly agree',
  },

  // Load (design: 3 items — NASA-TLX mental demand / effort / frustration)
  {
    key: 'load_mental',
    construct: 'load',
    text: 'How mentally demanding was setting up the chatbot?',
    low: 'Very low',
    high: 'Very high',
    reverse: true,
  },
  {
    key: 'load_effort',
    construct: 'load',
    text: 'How hard did you have to work to get the chatbot where you wanted it?',
    low: 'Very low',
    high: 'Very high',
    reverse: true,
  },
  {
    key: 'load_frustration',
    construct: 'load',
    text: 'How irritated or frustrated did you feel while working?',
    low: 'Not at all',
    high: 'Very much',
    reverse: true,
  },
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
    if (item.construct !== 'control' && item.construct !== 'trust' && item.construct !== 'load') {
      return false;
    }
    if (typeof item.text !== 'string' || item.text.trim() === '') return false;
    if (typeof item.low !== 'string' || typeof item.high !== 'string') return false;
  }
  return true;
}
