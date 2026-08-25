/** Session status for every participant — the console's one read. */
import { NextResponse } from 'next/server';
import { listParticipantStatuses } from '@/lib/study/console-store';
import { STUDY_PHASES } from '@/lib/study/phases';
import { activeStudyPair, listStudyDatasets } from '@/lib/study/datasets';
import { requireAdmin } from '@/lib/study/admin-guard';
import { ensureStudyTables } from '@/lib/study/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  const gate = await requireAdmin();
  if (gate.response) return gate.response;

  await ensureStudyTables();
  try {
    return NextResponse.json({
      participants: await listParticipantStatuses(),
      phases: STUDY_PHASES,
      // Every dataset, plus which two the study is currently made of: the
      // console both LISTS them (a participant's clone may be any of them) and
      // POINTS the study at a pair.
      datasets: await listStudyDatasets(),
      studyPair: (await activeStudyPair()).map((d) => d.key),
      actor: gate.actor.code,
    });
  } catch (err) {
    console.error('participants status error:', err);
    return NextResponse.json({ error: 'status_failed' }, { status: 500 });
  }
}
