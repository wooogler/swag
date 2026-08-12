import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getInstructor, isAdministrator } from '@/lib/auth';
import { ensureStudyTables } from '@/lib/study/store';
import { ADMIN_RETURN_COOKIE } from '@/lib/study/demo';
import AdminAccessForm from '@/components/study/AdminAccessForm';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Study Settings Access',
};

/**
 * Researcher entry point for the curation tool. An existing administrator
 * session skips the form (the /study page does the same for participants).
 *
 * Also the way OUT of a demo. Running one swaps this browser's session to the
 * demo participant, and the demo itself carries no exit control — a banner
 * would be in the recording — so coming back here is the gesture that ends it.
 * The swap back happens in the route handler: a page may read cookies, not
 * write them.
 */
export default async function AdminAccessPage() {
  await ensureStudyTables();

  const instructor = await getInstructor();
  if (instructor && isAdministrator(instructor)) {
    redirect('/study/admin/curation');
  }

  const cookieStore = await cookies();
  if (cookieStore.get(ADMIN_RETURN_COOKIE)) {
    redirect('/api/study/admin/demo/exit');
  }

  return <AdminAccessForm />;
}
