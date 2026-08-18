/**
 * The task screen's [Start] — the moment the 25 minutes begin (design §6.2).
 *
 * Separate from the phase advance on purpose. The advance happens when the
 * participant presses through the tutorial card, and the task screen sits
 * after it; charging the reading of the task to the budget the reading exists
 * to inform is exactly backwards. So the phase moves there and the clock
 * starts here.
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

  // `started` false = they had already begun and came back to this screen.
  // Not an error: the caller opens the board either way.
  const started = await markWorkStarted(participant.id);
  return NextResponse.json({ success: true, started });
}
