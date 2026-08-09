import { notFound, redirect } from 'next/navigation';
import { getInstructor, isAdministrator } from '@/lib/auth';
import { ensureStudyTables } from '@/lib/study/store';
import { listParticipantStatuses } from '@/lib/study/console-store';
import { STUDY_PHASES } from '@/lib/study/phases';
import { adminCodeOf } from '@/lib/study/admin';
import SessionConsole from './SessionConsole';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Session Console' };

/** Facilitator console: run the sessions, and manage the workspaces behind them. */
export default async function ConsolePage() {
  const instructor = await getInstructor();
  if (!instructor) redirect('/study/admin');
  if (!isAdministrator(instructor)) notFound();

  await ensureStudyTables();
  const participants = await listParticipantStatuses();

  return (
    <SessionConsole
      initial={participants}
      phases={[...STUDY_PHASES]}
      actor={adminCodeOf(instructor)}
    />
  );
}
