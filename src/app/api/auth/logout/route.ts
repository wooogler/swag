import { NextResponse } from 'next/server';
import { cookies, headers } from 'next/headers';
import { getCurrentStudyParticipant } from '@/lib/study/session';

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

  // Get the proper base URL from headers or environment
  const requestHeaders = await headers();
  const forwardedProto = requestHeaders.get('x-forwarded-proto') ?? 'https';
  const forwardedHost = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host');

  let baseUrl: string;
  if (forwardedHost) {
    baseUrl = `${forwardedProto}://${forwardedHost}`;
  } else {
    baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3030';
  }

  // 303, not the helper's default 307: this is a POST, and 307 preserves the
  // method — the browser would re-POST to a page route that only serves GET.
  // 303 is the status that means "now go GET this instead".
  return NextResponse.redirect(new URL(exit, baseUrl), 303);
}
