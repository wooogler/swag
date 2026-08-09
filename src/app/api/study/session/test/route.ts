/**
 * Block-test answers: record the prediction, and only then release the frozen
 * response. Both live behind the participant's own session, and both refuse
 * unless the current phase is that block's test.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentStudyParticipant } from '@/lib/study/session';
import { cloneForBlock, recordGuess, recordRating } from '@/lib/study/measure-store';
import { isStudyPhase, phaseAccess } from '@/lib/study/phases';

export const dynamic = 'force-dynamic';

const guessSchema = z.object({
  action: z.literal('guess'),
  bankItemId: z.number().int().positive(),
  guess: z.boolean(),
});
const ratingSchema = z.object({
  action: z.literal('rating'),
  bankItemId: z.number().int().positive(),
  rating: z.number().int().min(1).max(5),
});
const bodySchema = z.union([guessSchema, ratingSchema]);

export async function POST(req: Request) {
  const participant = await getCurrentStudyParticipant();
  if (!participant) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const phase = isStudyPhase(participant.phase) ? participant.phase : 'not_started';
  const block = phaseAccess(participant.participantNumber, phase).testBlock;
  if (!block) return NextResponse.json({ error: 'wrong_phase' }, { status: 409 });

  const clone = await cloneForBlock(participant, block);
  if (!clone) return NextResponse.json({ error: 'no_clone' }, { status: 404 });

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  if (parsed.action === 'guess') {
    const result = await recordGuess({
      participant,
      cloneAssignmentId: clone.assignmentId,
      bankItemId: parsed.bankItemId,
      guess: parsed.guess,
    });
    if ('error' in result) {
      return NextResponse.json({ error: 'no_response' }, { status: 409 });
    }
    return NextResponse.json({ success: true, response: result.response });
  }

  await recordRating({
    cloneAssignmentId: clone.assignmentId,
    bankItemId: parsed.bankItemId,
    rating: parsed.rating,
  });
  return NextResponse.json({ success: true });
}
