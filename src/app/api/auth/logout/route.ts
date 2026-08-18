import { cookies } from 'next/headers';
import { getCurrentStudyParticipant } from '@/lib/study/session';
import { redirectTo } from '@/lib/redirect';

export async function POST() {
  // Where logging out LANDS depends on where the session came from. A study
  // participant has no /login account to go back to — they signed in at /study
  // with a participant number and the shared passcode, so /login is a dead end
  // asking for credentials they were never given. Resolve this BEFORE the
  // cookie is deleted; afterwards there is nothing left to ask.
  let exit = '/login';
  try {
    if (await getCurrentStudyParticipant()) exit = '/study';
  } catch {
    // Study tables absent (never provisioned) → nobody is a participant and
    // /login is already right. Logging out must not fail either way.
  }

  const cookieStore = await cookies();
  cookieStore.delete('user_session');

  // 303, not the usual 307: this is a POST, and 307 preserves the method — the
  // browser would re-POST to a page route that only serves GET. 303 is the
  // status that means "now go GET this instead".
  return redirectTo(exit, 303);
}
