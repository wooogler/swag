/**
 * Server-only: resolve the study participant behind the current session cookie
 * (or null). Used by instructor pages to decide whether to show the study
 * reset UI, and by /api/study/reset to authorize the reset. Kept apart from
 * store.ts so the CLI scripts never pull in next/headers.
 * (next/headers already makes this module server-only in practice.)
 */
import { cookies } from 'next/headers';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db/db';
import { studyEvents, studyParticipants, type StudyParticipant } from '@/db/schema';
import { logParticipantEvent } from './events';

export async function getCurrentStudyParticipant(): Promise<StudyParticipant | null> {
  const userId = (await cookies()).get('user_session')?.value;
  if (!userId) return null;
  const participant = await db.query.studyParticipants.findFirst({
    where: eq(studyParticipants.instructorId, userId),
  });
  return participant ?? null;
}

/**
 * The events that can start the clock a participant and facilitator both read.
 *
 * `phase_advance` is the general answer — a phase begins when they press
 * through into it. The work block is the exception: design §6.2 puts a task
 * screen in front of the board and starts the 25 minutes at its [Start], so
 * the seconds spent reading what the task IS are not spent out of the budget
 * the reading is supposed to inform.
 *
 * Taking the LATEST of the two needs no phase test to get this right, because
 * `work_started` can only ever be logged after the advance into a work phase:
 * during work it wins, and the next `phase_advance` supersedes it on the way
 * out. One query, no branch that could disagree with the console's.
 */
const CLOCK_EVENTS = ['phase_advance', 'work_started'] as const;

/**
 * When the participant's CURRENT phase began — or, in the work block, when
 * they pressed [Start] on the task screen.
 *
 * Read from events rather than a column, because that is already the record
 * the console's own elapsed chip is computed from (console-store's
 * lastPhaseChange, which reads the same two types). Two clocks derived from
 * two sources would eventually disagree, and the participant's readout and the
 * facilitator's have to be the same clock or the verbal warning lands at the
 * wrong number.
 *
 * Null before the first advance (a participant who never started) — the caller
 * then shows nothing, which is right: there is no elapsed time yet.
 */
export async function currentPhaseStartedAt(participantId: string): Promise<Date | null> {
  const [row] = await db
    .select({ createdAt: studyEvents.createdAt })
    .from(studyEvents)
    .where(
      and(
        eq(studyEvents.participantId, participantId),
        inArray(studyEvents.eventType, [...CLOCK_EVENTS])
      )
    )
    .orderBy(desc(studyEvents.createdAt))
    .limit(1);
  return row?.createdAt ?? null;
}

/**
 * Stamp the start of a work block, once.
 *
 * Guarded rather than blindly inserted: /study/session is a page a participant
 * can land back on (a reload, a stray back button), and a second [Start] that
 * logged again would move the clock forward — handing back minutes that were
 * actually spent and pushing the facilitator's warning past the end of the
 * block. So it only counts if nothing has started this phase yet, which is
 * exactly "the latest clock event is still the phase_advance".
 *
 * Returns the zero this block is measured from — the row it just wrote, or
 * the clock event that already stood — so the caller can hand it straight to
 * the readout instead of reloading the board to find out. Null only when
 * nothing has started at all, which cannot happen from a work phase.
 */
export async function markWorkStarted(participantId: string): Promise<Date | null> {
  const [latest] = await db
    .select({ eventType: studyEvents.eventType, createdAt: studyEvents.createdAt })
    .from(studyEvents)
    .where(
      and(
        eq(studyEvents.participantId, participantId),
        inArray(studyEvents.eventType, [...CLOCK_EVENTS])
      )
    )
    .orderBy(desc(studyEvents.createdAt))
    .limit(1);
  if (latest?.eventType !== 'phase_advance') return latest?.createdAt ?? null;
  await logParticipantEvent(participantId, 'work_started');
  return currentPhaseStartedAt(participantId);
}
