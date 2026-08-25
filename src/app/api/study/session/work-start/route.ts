/**
 * The briefing dialog's [Start] — the moment the 25 minutes begin.
 *
 * Separate from the phase advance on purpose. The advance happens when the
 * participant presses through the walkthrough card; what sits after it is a
 * redirect, a board render and the briefing they read the task in, and
 * charging all of that to the budget the reading exists to inform is exactly
 * backwards. So the phase moves there and the clock starts here.
 *
 * It used to be the task screen's [Start]. That screen is gone — it carried
 * the same sentences the briefing carries, one screen earlier — and the stamp
 * moved into the dialog with them.
 *
 * Refuses outside a work phase rather than logging anyway — a stray POST from
 * a stale tab would otherwise restart the clock in the middle of a block test.
 */
import { NextResponse } from 'next/server';
import { getCurrentStudyParticipant, markWorkStarted } from '@/lib/study/session';
// Phase read inline rather than through advance.ts's `currentPhase`: that
// module pulls the generation batch machinery in behind it, and this route
// only needs to know whether a board is open.
import { isStudyPhase, phaseAccess } from '@/lib/study/phases';

export const dynamic = 'force-dynamic';

export async function POST() {
  const participant = await getCurrentStudyParticipant();
  if (!participant) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const phase = isStudyPhase(participant.phase) ? participant.phase : 'not_started';
  if (!phaseAccess(participant, phase).workDatasetKey) {
    return NextResponse.json({ error: 'not_work_phase', phase }, { status: 409 });
  }

  // A null-op when they had already begun and merely reopened the briefing;
  // either way the caller gets the zero this block is measured from, which is
  // what its readout needs.
  const startedAt = await markWorkStarted(participant.id);
  return NextResponse.json({ success: true, startedAt: startedAt?.toISOString() ?? null });
}
