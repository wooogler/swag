/**
 * Server-only: resolve the study participant behind the current session cookie
 * (or null). Used by instructor pages to decide whether to show the study
 * reset UI, and by /api/study/reset to authorize the reset. Kept apart from
 * store.ts so the CLI scripts never pull in next/headers.
 * (next/headers already makes this module server-only in practice.)
 */
import { cookies } from 'next/headers';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db/db';
import { studyEvents, studyParticipants, type StudyParticipant } from '@/db/schema';

export async function getCurrentStudyParticipant(): Promise<StudyParticipant | null> {
  const userId = (await cookies()).get('user_session')?.value;
  if (!userId) return null;
  const participant = await db.query.studyParticipants.findFirst({
    where: eq(studyParticipants.instructorId, userId),
  });
  return participant ?? null;
}

/**
 * When the participant's CURRENT phase began — the moment they pressed through
 * the tutorial card into the work block.
 *
 * Read from the last `phase_advance` event rather than a column, because that
 * is already the record the console's own elapsed chip is computed from
 * (console-store.lastPhaseChange). Two clocks derived from two sources would
 * eventually disagree, and the participant's readout and the facilitator's have
 * to be the same clock or the verbal warning lands at the wrong number.
 *
 * Null before the first advance (a participant who never started) — the caller
 * then shows nothing, which is right: there is no elapsed time yet.
 */
export async function currentPhaseStartedAt(participantId: string): Promise<Date | null> {
  const [row] = await db
    .select({ createdAt: studyEvents.createdAt })
    .from(studyEvents)
    .where(and(eq(studyEvents.participantId, participantId), eq(studyEvents.eventType, 'phase_advance')))
    .orderBy(desc(studyEvents.createdAt))
    .limit(1);
  return row?.createdAt ?? null;
}
