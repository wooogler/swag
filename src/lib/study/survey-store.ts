/**
 * The questionnaire as a setting.
 *
 * The design leaves the exact wording — and whether load is measured with TLX
 * items or the UBS subscales — to the advisor meeting. Shipping that as a
 * constant means the decision arrives as a code change; here it is an edit a
 * researcher makes, with the one rule the data depends on: `key` is identity.
 * Reword an item freely and the answers still line up; change what an item
 * MEASURES and it deserves a new key, which is why deleting one is called out
 * rather than done quietly.
 */
import { eq, sql } from 'drizzle-orm';
import { db } from '@/db/db';
import { studySurveyAnswers, studySurveyConfig } from '@/db/schema';
import {
  DEFAULT_SURVEY_ITEMS,
  isValidSurveyItems,
  type SurveyItem,
} from './survey-items';
import { ensureStudyTables } from './store';

export async function getSurveyItems(): Promise<SurveyItem[]> {
  await ensureStudyTables();
  const [row] = await db.select().from(studySurveyConfig).where(eq(studySurveyConfig.id, 1));
  if (!row || !isValidSurveyItems(row.items)) return DEFAULT_SURVEY_ITEMS;
  return row.items;
}

/** Item keys that already have answers recorded against them. */
export async function answeredItemKeys(): Promise<string[]> {
  await ensureStudyTables();
  const rows = await db
    .selectDistinct({ itemKey: studySurveyAnswers.itemKey })
    .from(studySurveyAnswers);
  return rows.map((r) => r.itemKey);
}

export interface SurveySaveResult {
  items: SurveyItem[];
  /** Keys that had answers and are no longer in the instrument. */
  orphanedKeys: string[];
}

/**
 * Replace the questionnaire. Answers are never touched: a key that disappears
 * leaves its rows behind rather than deleting a participant's response, and the
 * caller is told so it can be said out loud.
 */
export async function saveSurveyItems(
  items: unknown,
  updatedBy: string
): Promise<SurveySaveResult> {
  await ensureStudyTables();
  if (!isValidSurveyItems(items)) throw new Error('invalid_items');

  const answered = new Set(await answeredItemKeys());
  const keptKeys = new Set(items.map((i) => i.key));
  const orphanedKeys = [...answered].filter((k) => !keptKeys.has(k));

  const values = { items, updatedAt: new Date(), updatedBy };
  await db
    .insert(studySurveyConfig)
    .values({ id: 1, ...values })
    .onConflictDoUpdate({ target: studySurveyConfig.id, set: values });

  return { items, orphanedKeys };
}

/** Restore the shipped wording (the design's constructs and counts). */
export async function resetSurveyItems(updatedBy: string): Promise<SurveyItem[]> {
  const { items } = await saveSurveyItems(DEFAULT_SURVEY_ITEMS, updatedBy);
  return items;
}

/** How many participants have answered anything — the "careful now" signal. */
export async function surveyRespondentCount(): Promise<number> {
  await ensureStudyTables();
  const [row] = await db
    .select({ n: sql<number>`count(distinct ${studySurveyAnswers.participantId})::int` })
    .from(studySurveyAnswers);
  return row?.n ?? 0;
}
