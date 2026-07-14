/**
 * Reset the CURRENT study participant's workspace from the header UI.
 *
 * Authorized only for a session that belongs to a study participant. With a
 * `datasetKey` it resets just that dataset's board (returns the new board URL);
 * without one it resets ALL of the participant's datasets (returns the
 * dashboard). Resetting discards the participant's SCORE work and re-clones the
 * current master(s) — the new clones have fresh assignment ids, so the client
 * must navigate to the returned `redirect`.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { STUDY_DATASETS } from '@/lib/study/config';
import { getCurrentStudyParticipant } from '@/lib/study/session';
import { resetParticipant, resetParticipantDataset } from '@/lib/study/provision';

const schema = z.object({ datasetKey: z.string().optional() });

export async function POST(request: Request) {
  try {
    const participant = await getCurrentStudyParticipant();
    if (!participant) {
      return NextResponse.json({ error: 'Not a study participant' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const { datasetKey } = schema.parse(body ?? {});

    if (datasetKey) {
      if (!STUDY_DATASETS.some((d) => d.key === datasetKey)) {
        return NextResponse.json({ error: 'Unknown dataset' }, { status: 400 });
      }
      const clone = await resetParticipantDataset(participant, datasetKey);
      return NextResponse.json({
        success: true,
        redirect: `/instructor/assignments/${clone.assignmentId}`,
      });
    }

    await resetParticipant(participant);
    return NextResponse.json({ success: true, redirect: '/instructor/dashboard' });
  } catch (error) {
    console.error('Study reset error:', error);
    return NextResponse.json({ error: 'Reset failed' }, { status: 500 });
  }
}
