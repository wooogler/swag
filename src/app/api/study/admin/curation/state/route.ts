/** Everything the curation screen renders for one dataset, in one round trip. */
import { NextResponse } from 'next/server';
import { getCurationState, validateCuration } from '@/lib/study/curation';
import { CURATION_DATASETS, SET_TARGETS_PER_TYPE } from '@/lib/study/config';
import { requireAdmin } from '@/lib/study/admin-guard';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const gate = await requireAdmin();
  if (gate.response) return gate.response;

  const url = new URL(req.url);
  const datasetKey = url.searchParams.get('ds') ?? CURATION_DATASETS[0]?.key;
  if (!datasetKey) return NextResponse.json({ error: 'no_datasets' }, { status: 500 });

  try {
    const state = await getCurationState(datasetKey);
    return NextResponse.json({
      state,
      violations: validateCuration(state),
      datasets: CURATION_DATASETS.map((d) => ({ key: d.key, label: d.label })),
      targets: SET_TARGETS_PER_TYPE,
      actor: gate.actor.code,
    });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('unknown curation dataset')) {
      return NextResponse.json({ error: 'unknown_dataset' }, { status: 404 });
    }
    console.error('curation state error:', err);
    return NextResponse.json({ error: 'state_failed' }, { status: 500 });
  }
}
