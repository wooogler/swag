/**
 * The per-block questionnaire — the five items of `USER_STUDY 문항지 v1.md` §4,
 * verbatim.
 *
 * Wording is the questionnaire's, not a paraphrase: these are read aloud to
 * nobody and answered by everybody, so the participant-facing string is the
 * instrument. Two items ask about the FUTURE ("will behave", "future student
 * questions") on purpose — the construct is control over and trust in what was
 * deployed, not satisfaction with the screen just left.
 *
 * `key` is what the answers are stored under, so reword freely but keep the key
 * — and mint a new one if the construct changes rather than redefining an old
 * one. `load` is the questionnaire's 부담 (TLX mental demand / frustration).
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
/** Default top of the scale; the live value is a setting (survey-store). */
export const DEFAULT_SURVEY_SCALE_MAX = 7;
/** The scales the design would plausibly use — 5-point or 7-point Likert. */
export const SURVEY_SCALE_CHOICES = [5, 7] as const;

export const DEFAULT_SURVEY_ITEMS: SurveyItem[] = [
  // C1 · C2 — sense of control
  {
    key: 'control_future',
    construct: 'control',
    text: 'I felt in control of how the chatbot will behave.',
    low: 'Strongly disagree',
    high: 'Strongly agree',
  },
  {
    key: 'control_achieve',
    construct: 'control',
    text: 'I could get the chatbot to behave the way I wanted.',
    low: 'Strongly disagree',
    high: 'Strongly agree',
  },

  // B1 · B2 — burden, NASA-TLX mental demand and frustration, put on the same
  // agree/disagree scale as the rest so a block is one instrument, not three.
  {
    key: 'load_mental',
    construct: 'load',
    text: 'Setting up the chatbot was mentally demanding.',
    low: 'Strongly disagree',
    high: 'Strongly agree',
    reverse: true,
  },
  {
    key: 'load_frustration',
    construct: 'load',
    text: 'I felt frustrated while setting it up.',
    low: 'Strongly disagree',
    high: 'Strongly agree',
    reverse: true,
  },

  // T1 — trust, about the questions it has not been asked yet
  {
    key: 'trust_future',
    construct: 'trust',
    text: 'I trust this chatbot to handle future student questions in line with my intent.',
    low: 'Strongly disagree',
    high: 'Strongly agree',
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
