/**
 * Leave a demo and become the researcher again.
 *
 * A route handler rather than the /study/admin page itself, because a Server
 * Component may read cookies but not write them — and this exists precisely to
 * write one. The page redirects here when it finds the return cookie, so the
 * gesture a researcher performs is still just "go back to /study/admin".
 */
import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import { db } from '@/db/db';
import { instructors } from '@/db/schema';
import { isAdministrator } from '@/lib/auth';
import { STUDY_SESSION_MAX_AGE_SECONDS } from '@/lib/study/config';
import { ADMIN_RETURN_COOKIE } from '@/lib/study/demo';
import { redirectTo } from '@/lib/redirect';

export const dynamic = 'force-dynamic';

export async function GET() {
  const cookieStore = await cookies();
  const returning = cookieStore.get(ADMIN_RETURN_COOKIE)?.value;

  if (!returning) return redirectTo('/study/admin');
  cookieStore.delete(ADMIN_RETURN_COOKIE);

  const account = await db.query.instructors.findFirst({ where: eq(instructors.id, returning) });
  // Re-checked, not trusted: the cookie is only ever a shortcut back to a role
  // this browser already held.
  if (!account || !isAdministrator(account)) return redirectTo('/study/admin');

  cookieStore.set('user_session', account.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: STUDY_SESSION_MAX_AGE_SECONDS,
    path: '/',
  });
  return redirectTo('/study/admin/curation');
}
