/**
 * Reading and writing the end-of-session comparison (design §6.5).
 *
 * Kept apart from final-survey.ts so the item bank stays client-safe — the
 * survey screen imports the statements, and nothing about them should drag a
 * database driver into the browser bundle.
 */
import { and, eq } from 'drizzle-orm';
import { db } from '@/db/db';
import { studyClones, studyFinalSurveyAnswers, type StudyParticipant } from '@/db/schema';
import { conditionName, type StudioView } from './config';
import { blockPlan } from './phases';
import { ensureStudyTables } from './store';
import { FINAL_SCALE_MAX, FINAL_SCALE_MIN, requiredKeys, type FinalColumn } from './final-survey';

/**
 * The two columns, in the order this participant met them.
 *
 * First used on the left, which is invariant 8: fixing a condition to a side
 * would gather the left-hand primacy bias onto that arm. Counterbalancing
 * already scatters the order, so following it scatters the bias with it.
 */
export async function finalColumns(participant: StudyParticipant): Promise<FinalColumn[]> {
  await ensureStudyTables();
  const clones = await db
    .select({ datasetKey: studyClones.datasetKey, assignmentId: studyClones.assignmentId })
    .from(studyClones)
    .where(eq(studyClones.participantId, participant.id));
  return blockPlan(participant).map((entry) => ({
    condition: entry.condition,
    name: conditionName(entry.condition),
    block: entry.block,
    cloneAssignmentId:
      clones.find((c) => c.datasetKey === entry.datasetKey)?.assignmentId ?? null,
  }));
}

export interface FinalAnswer {
  itemKey: string;
  condition: string | null;
  value: number | null;
  text: string | null;
}

export async function getFinalAnswers(participantId: string): Promise<FinalAnswer[]> {
  await ensureStudyTables();
  return db
    .select({
      itemKey: studyFinalSurveyAnswers.itemKey,
      condition: studyFinalSurveyAnswers.condition,
      value: studyFinalSurveyAnswers.value,
      text: studyFinalSurveyAnswers.text,
    })
    .from(studyFinalSurveyAnswers)
    .where(eq(studyFinalSurveyAnswers.participantId, participantId));
}

export interface FinalAnswerInput {
  itemKey: string;
  condition?: StudioView | null;
  value?: number | null;
  text?: string | null;
}

/**
 * Upsert a page's worth of answers.
 *
 * Upsert rather than insert because going back is allowed — the design wants a
 * participant able to revise, and a second pass over a page must overwrite
 * rather than pile up. Matched on (participant, item, condition) with NULL
 * folded to '' so the comparison items, which have no condition, still collide
 * with themselves.
 */
export async function saveFinalAnswers(
  participantId: string,
  answers: FinalAnswerInput[]
): Promise<number> {
  await ensureStudyTables();
  const now = new Date();
  let written = 0;
  for (const a of answers) {
    const value =
      typeof a.value === 'number' && a.value >= FINAL_SCALE_MIN && a.value <= FINAL_SCALE_MAX
        ? a.value
        : null;
    const text = typeof a.text === 'string' && a.text.trim() ? a.text.trim() : null;
    if (value === null && text === null) continue;

    // Read the item's rows and match the condition here rather than in SQL:
    // half these answers have no condition at all, and `= NULL` matches
    // nothing, so a query written the obvious way would insert a duplicate
    // every time a participant went back and changed one.
    const rows = await db
      .select({ id: studyFinalSurveyAnswers.id, condition: studyFinalSurveyAnswers.condition })
      .from(studyFinalSurveyAnswers)
      .where(
        and(
          eq(studyFinalSurveyAnswers.participantId, participantId),
          eq(studyFinalSurveyAnswers.itemKey, a.itemKey)
        )
      );
    const condition = a.condition ?? null;
    const row = rows.find((r) => r.condition === condition);

    if (row) {
      await db
        .update(studyFinalSurveyAnswers)
        .set({ value, text, answeredAt: now })
        .where(eq(studyFinalSurveyAnswers.id, row.id));
    } else {
      await db.insert(studyFinalSurveyAnswers).values({
        participantId,
        itemKey: a.itemKey,
        condition,
        value,
        text,
        answeredAt: now,
      });
    }
    written += 1;
  }
  return written;
}

/** What is still missing before the survey can be called finished. */
export async function missingFinalAnswers(participant: StudyParticipant): Promise<number> {
  const [columns, answers] = await Promise.all([
    finalColumns(participant),
    getFinalAnswers(participant.id),
  ]);
  const have = new Set(
    answers.filter((a) => a.value !== null).map((a) => `${a.itemKey}:${a.condition ?? ''}`)
  );
  return requiredKeys(columns).filter((r) => !have.has(`${r.key}:${r.condition ?? ''}`)).length;
}
