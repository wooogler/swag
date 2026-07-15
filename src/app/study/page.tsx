import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import { db } from '@/db/db';
import { studyParticipants } from '@/db/schema';
import { ensureStudyTables } from '@/lib/study/store';
import StudyAccessForm from '@/components/study/StudyAccessForm';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'SCORE Study Access',
};

/**
 * Dedicated SCORE user-study entry point. A participant is handed a URL, a
 * participant number, and the shared passcode; entering them provisions (on
 * first sign-in) and opens their own dataset boards. If an existing session
 * already belongs to a study participant, skip the form and go to the dashboard.
 */
export default async function StudyAccessPage() {
  await ensureStudyTables();

  const cookieStore = await cookies();
  const userId = cookieStore.get('user_session')?.value;
  if (userId) {
    const participant = await db.query.studyParticipants.findFirst({
      where: eq(studyParticipants.instructorId, userId),
    });
    if (participant) {
      redirect('/instructor/dashboard');
    }
  }

  return <StudyAccessForm />;
}
