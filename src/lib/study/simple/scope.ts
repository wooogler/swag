/**
 * Which questions the board is ABOUT.
 *
 * A study master is not 60 questions; it is 60 questions plus the earlier turns
 * of their conversations, kept so each one can be read with what came before it
 * (build.ts cuts each thread at its last curated question). The curated ones are
 * marked in `study_review_questions`, and everything that LISTS, COUNTS, RATES
 * or ANSWERS has to work off those marks — otherwise the board offers a
 * participant 213 questions to organize when the study gave them 60, and every
 * count on the screen is over the wrong denominator.
 *
 * The conversation viewer is the exception, and reads the whole thread: that is
 * the entire reason the earlier turns were kept.
 *
 * No marks means an ordinary assignment — a researcher's own board, or a
 * scratch one — and then the log is the log.
 */
import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/db/db';
import { studyReviewQuestions } from '@/db/schema';
import { getQueryRecords, type QueryRecord } from '@/lib/score/queries';

/** The curated ids, or null when this assignment has no curated set. */
export async function reviewScope(assignmentId: string): Promise<Set<number> | null> {
  const marks = await db
    .select({ messageId: studyReviewQuestions.messageId })
    .from(studyReviewQuestions)
    .where(eq(studyReviewQuestions.assignmentId, assignmentId));
  return marks.length > 0 ? new Set(marks.map((m) => m.messageId)) : null;
}

/** The questions to list, count and rate — curated only, where there is a set. */
export async function scopedRecords(assignmentId: string): Promise<QueryRecord[]> {
  const [records, scope] = await Promise.all([
    getQueryRecords(assignmentId),
    reviewScope(assignmentId),
  ]);
  return scope ? records.filter((r) => scope.has(r.messageId)) : records;
}
