/**
 * Move a participant through the protocol.
 *
 * The facilitator drives this (the session is moderated), and the measurement
 * phases are gated: entering a test or A/B phase without current frozen answers
 * would show the participant a chatbot they no longer have. `force` exists for
 * the room — a session that must move on despite a warning — and is recorded.
 */
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/db';
import { studyParticipants } from '@/db/schema';
import {
  getParticipantStatus,
  setParticipantPhase,
} from '@/lib/study/console-store';
import { isStudyPhase, nextPhase, prevPhase, type StudyPhase } from '@/lib/study/phases';
import { requireAdmin } from '@/lib/study/admin-guard';
import { logParticipantEvent } from '@/lib/study/events';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  participantId: z.string().min(1),
  /** 'next' | 'back' | an explicit phase. */
  move: z.string().min(1),
  force: z.boolean().optional(),
});

export async function POST(req: Request) {
  const gate = await requireAdmin();
  if (gate.response) return gate.response;

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const [participant] = await db
    .select()
    .from(studyParticipants)
    .where(eq(studyParticipants.id, parsed.participantId));
  if (!participant) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const status = await getParticipantStatus(participant);
  let target: StudyPhase | null;
  if (parsed.move === 'next') target = nextPhase(status.phase);
  else if (parsed.move === 'back') target = prevPhase(status.phase);
  else if (isStudyPhase(parsed.move)) target = parsed.move;
  else return NextResponse.json({ error: 'invalid_move' }, { status: 400 });

  if (!target) return NextResponse.json({ error: 'no_such_phase' }, { status: 409 });

  // Only forward moves are gated: stepping BACK is how a facilitator recovers
  // from a mis-click, and blocking that would strand the session.
  const movingForward = parsed.move !== 'back';
  if (movingForward && status.blockers.length > 0 && !parsed.force) {
    return NextResponse.json(
      { error: 'blocked', blockers: status.blockers },
      { status: 409 }
    );
  }

  await setParticipantPhase(participant, target, gate.actor.code);
  if (movingForward && status.blockers.length > 0 && parsed.force) {
    await logParticipantEvent(participant.id, 'phase_forced', {
      to: target,
      blockers: status.blockers,
      by: gate.actor.code,
    });
  }
  return NextResponse.json({ success: true, phase: target });
}
