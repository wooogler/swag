import { notFound, redirect } from 'next/navigation';
import { getInstructor, isAdministrator } from '@/lib/auth';
import { ensureStudyTables } from '@/lib/study/store';
import { listParticipantStatuses } from '@/lib/study/console-store';
import { STUDY_PHASES } from '@/lib/study/phases';
import { adminCodeOf } from '@/lib/study/admin';
import { activeStudyPair, listStudyDatasets } from '@/lib/study/datasets';
import { resolveMasterAssignmentId } from '@/lib/study/provision';
import { demoQuestionIds } from '@/lib/study/curation';
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

  /**
   * Which datasets can be demoed, counted from the isolated conversations
   * themselves.
   *
   * The demo controls used to live only on the curation board, next to the
   * pickers that reserve the material — which is where they are configured but
   * not where they are used. Running one is a session-day act: it is the last
   * thing before a shoot and the first thing when a screen needs checking, and
   * the console is the page that is already open then.
   *
   * A dataset with nothing reserved gets a disabled button rather than no
   * button. Hiding it made a missing reservation look like a missing feature —
   * "the demo only works on NIRVANA" — when it is one picker away.
   */
  /**
   * Datasets, each with whether a study master has actually been BUILT from it.
   *
   * Without one, a clone is made from the whole 507/348-message log — the
   * documented fallback, right for a preview and wrong for a session. It used
   * to be unsayable because the two datasets were always built; a registry
   * makes "pointed the study at something I have not built yet" a click away,
   * so the console says it where the pointing happens.
   */
  const datasets = await Promise.all(
    (await listStudyDatasets()).map(async (d) => ({
      ...d,
      built: (await resolveMasterAssignmentId(d)) !== d.sourceAssignmentId,
    }))
  );
  const demoDatasets = await Promise.all(
    datasets.map(async (d) => ({
      key: d.key,
      label: d.label,
      questions: (await demoQuestionIds(d.key)).length,
    }))
  );
  const studyPair = (await activeStudyPair()).map((d) => d.key);

  return (
    <SessionConsole
      initial={participants}
      phases={[...STUDY_PHASES]}
      actor={adminCodeOf(instructor)}
      datasets={datasets}
      studyPair={studyPair}
      demoDatasets={demoDatasets}
    />
  );
}
