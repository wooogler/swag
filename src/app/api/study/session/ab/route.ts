/**
 * Record one blind A/B choice.
 *
 * The client sends which side it showed each configuration on; the server does
 * NOT trust that — it recomputes the pairing so a tampered or stale client
 * cannot mis-attribute a preference, which would silently invert the study's
 * primary measure.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentStudyParticipant } from '@/lib/study/session';
import { getAbItems, recordAbChoice } from '@/lib/study/measure-store';
import { isStudyPhase, phaseAccess } from '@/lib/study/phases';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  bankItemId: z.number().int().positive(),
  choice: z.enum(['left', 'right', 'both', 'neither']),
});

export async function POST(req: Request) {
  const participant = await getCurrentStudyParticipant();
  if (!participant) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const phase = isStudyPhase(participant.phase) ? participant.phase : 'not_started';
  if (!phaseAccess(participant.participantNumber, phase).showAb) {
    return NextResponse.json({ error: 'wrong_phase' }, { status: 409 });
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const items = await getAbItems(participant);
  const item = items.find((i) => i.bankItemId === parsed.bankItemId);
  if (!item) return NextResponse.json({ error: 'unknown_item' }, { status: 404 });

  await recordAbChoice({
    participant,
    bankItemId: item.bankItemId,
    leftCloneAssignmentId: item.leftCloneAssignmentId,
    rightCloneAssignmentId: item.rightCloneAssignmentId,
    choice: parsed.choice,
  });
  return NextResponse.json({ success: true });
}
