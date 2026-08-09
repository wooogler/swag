import { redirect } from 'next/navigation';
import { getInstructor, isAdministrator } from '@/lib/auth';
import { ensureStudyTables } from '@/lib/study/store';
import AdminAccessForm from '@/components/study/AdminAccessForm';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Set Curation Access',
};

/**
 * Researcher entry point for the curation tool. An existing administrator
 * session skips the form (the /study page does the same for participants).
 */
export default async function AdminAccessPage() {
  await ensureStudyTables();

  const instructor = await getInstructor();
  if (instructor && isAdministrator(instructor)) {
    redirect('/study/admin/curation');
  }

  return <AdminAccessForm />;
}
