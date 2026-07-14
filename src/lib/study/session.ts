/**
 * Server-only: resolve the study participant behind the current session cookie
 * (or null). Used by instructor pages to decide whether to show the study
 * reset UI, and by /api/study/reset to authorize the reset. Kept apart from
 * store.ts so the CLI scripts never pull in next/headers.
 * (next/headers already makes this module server-only in practice.)
 */
import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import { db } from '@/db/db';
import { studyParticipants, type StudyParticipant } from '@/db/schema';

export async function getCurrentStudyParticipant(): Promise<StudyParticipant | null> {
  const userId = (await cookies()).get('user_session')?.value;
  if (!userId) return null;
  const participant = await db.query.studyParticipants.findFirst({
    where: eq(studyParticipants.instructorId, userId),
  });
  return participant ?? null;
}
