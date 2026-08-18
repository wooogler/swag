/**
 * The participant's start link: /study/s/<token>.
 *
 * One click, no ID to type and no passcode to read out. That is the point —
 * the researcher creates the participant, picks their cell, and hands over a
 * URL, so nothing about which condition someone lands in depends on what they
 * type at the door.
 *
 * The token IS the credential, which is why it is 32 random bytes rather than
 * the participant number, and why a bad one is sent to the ordinary door
 * without saying whether some other token would have worked. Signing in on a
 * GET is safe in the way a magic link is: nothing is destroyed, and the worst a
 * prefetch does is set a cookie for whoever already holds the link.
 *
 * THE LINK IS ALSO THE WAY BACK IN. A participant who closes the tab, runs out
 * of battery, or is moved to another machine opens the same URL and lands
 * exactly where they were, because the position in the protocol is a column on
 * their row and not anything the browser was holding.
 *
 * It stops working when they finish. Expiry is not a separate flag — it is
 * `phase === 'done'`, so there is one answer to "are they still in the study"
 * and no way for a second one to disagree with it. That also makes reopening a
 * finished session exactly what it sounds like: the researcher sets the phase
 * back to the step they should resume at, and the same link works again.
 *
 * A Route Handler rather than a page because only a handler (or a Server
 * Action) may set a cookie.
 */
import { eq } from 'drizzle-orm';
import { db } from '@/db/db';
import { instructors, studyParticipants } from '@/db/schema';
import { STUDY_SESSION_MAX_AGE_SECONDS } from '@/lib/study/config';
import { ensureStudyTables } from '@/lib/study/store';
import { ensureParticipantSetup } from '@/lib/study/provision';
import { redirectTo } from '@/lib/redirect';

export const dynamic = 'force-dynamic';
// The safety-net provision below clones two datasets if they are somehow absent.
export const maxDuration = 300;

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  await ensureStudyTables();

  const [participant] = await db
    .select()
    .from(studyParticipants)
    .where(eq(studyParticipants.accessToken, token));

  if (!participant) {
    return redirectTo('/study?link=invalid');
  }
  if (participant.phase === 'done') {
    return redirectTo('/study?link=done');
  }

  // Normally a no-op: the workspaces were built when the researcher created
  // this participant. It stands here so a link issued after a failed clone
  // still opens onto a working session rather than an empty board.
  await ensureParticipantSetup(participant.participantNumber);

  const now = new Date();
  await Promise.all([
    db
      .update(studyParticipants)
      .set({ lastLoginAt: now })
      .where(eq(studyParticipants.id, participant.id)),
    db
      .update(instructors)
      .set({ lastLoginAt: now })
      .where(eq(instructors.id, participant.instructorId)),
  ]);

  const res = redirectTo('/study/session');
  res.cookies.set('user_session', participant.instructorId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: STUDY_SESSION_MAX_AGE_SECONDS,
    path: '/',
  });
  return res;
}
