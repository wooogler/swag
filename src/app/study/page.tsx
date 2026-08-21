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
 * The study's recovery door.
 *
 * A participant normally arrives on their own link (/study/s/<token>), which
 * the researcher issues when they create them. This page is what a lost link
 * falls back to: ID plus the shared passcode, for an account that ALREADY
 * exists. It no longer provisions anyone — self-signup would put a participant
 * in a cell nobody assigned. If the session already belongs to a participant,
 * skip the form.
 */
export default async function StudyAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ link?: string }>;
}) {
  await ensureStudyTables();
  const { link } = await searchParams;

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

  // The sign-in screen is a participant's, so it carries the study's larger
  // type scale (globals.css) the same way the session routes do.
  return (
    <div data-study-scale className="contents">
      <StudyAccessForm notice={link === 'done' ? 'done' : link === 'invalid' ? 'invalid' : null} />
    </div>
  );
}
