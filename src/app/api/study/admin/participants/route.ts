/** Session status for every participant — the console's one read. */
import { NextResponse } from 'next/server';
import { listParticipantStatuses } from '@/lib/study/console-store';
import { STUDY_PHASES } from '@/lib/study/phases';
import { STUDY_DATASETS } from '@/lib/study/config';
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
      datasets: STUDY_DATASETS.map((d) => ({ key: d.key, label: d.label })),
      actor: gate.actor.code,
    });
  } catch (err) {
    console.error('participants status error:', err);
    return NextResponse.json({ error: 'status_failed' }, { status: 500 });
  }
}
