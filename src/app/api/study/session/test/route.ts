/**
 * Block-test answers: record every prediction, and only then release the
 * frozen responses.
 *
 * The block runs in two passes. Pass one predicts all eight questions — the
 * yes/no, then the point at the part of the configuration expected to act
 * (design v2 §5) — and shows no answers at all. Pass two walks the same eight
 * again, revealing and rating. Nothing here decides which pass the client is
 * in; the release rule lives in measure-store and is re-derived from the rows
 * on every request. All of it sits behind the participant's own session and
 * refuses unless the current phase is that block's test.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentStudyParticipant } from '@/lib/study/session';
import {
  cloneForBlock,
  deployedConfigFor,
  getTestItems,
  predictionsComplete,
  recordGuess,
  recordPointing,
  recordRating,
} from '@/lib/study/measure-store';
import { isStudyPhase, phaseAccess } from '@/lib/study/phases';

export const dynamic = 'force-dynamic';

const guessSchema = z.object({
  action: z.literal('guess'),
  bankItemId: z.number().int().positive(),
  guess: z.boolean(),
});
// The two conditions point at different things, so the shapes differ — but a
// participant only ever sees their own condition's control, and the route
// checks an 'intent' pointing against the deployed snapshot below.
const pointingSchema = z.object({
  action: z.literal('pointing'),
  bankItemId: z.number().int().positive(),
  pointing: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('intent'), intentId: z.number().int().positive() }),
    z.object({ kind: z.literal('none') }),
    z.object({ kind: z.literal('not_sure') }),
    z.object({
      kind: z.literal('span'),
      start: z.number().int().min(0),
      end: z.number().int().positive(),
      text: z.string().min(1).max(4000),
    }),
    z.object({ kind: z.literal('nothing') }),
  ]),
});
const ratingSchema = z.object({
  action: z.literal('rating'),
  bankItemId: z.number().int().positive(),
  rating: z.number().int().min(1).max(5),
});
const bodySchema = z.union([guessSchema, pointingSchema, ratingSchema]);

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
    return NextResponse.json({ success: true });
  }

  if (parsed.action === 'pointing') {
    // An intent id has to be one of the intents this participant deployed —
    // otherwise the pointing/routing comparison would score against a number
    // that means nothing on their board.
    const pointing = parsed.pointing;
    if (pointing.kind === 'intent') {
      const config = await deployedConfigFor(clone);
      const known = (config?.intents ?? []).some((i) => i.id === pointing.intentId);
      if (!known) return NextResponse.json({ error: 'unknown_intent' }, { status: 400 });
    }
    const result = await recordPointing({
      cloneAssignmentId: clone.assignmentId,
      bankItemId: parsed.bankItemId,
      pointing,
    });
    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: 409 });
    }
    // If that was the last prediction the block owed, the answers unlock — so
    // send the refreshed list rather than making the client reload to find out.
    // It comes from getTestItems, the same gate the page renders through, so
    // there is one place that decides what is visible.
    if (await predictionsComplete(clone)) {
      return NextResponse.json({
        success: true,
        revealed: true,
        items: await getTestItems(participant, clone),
      });
    }
    return NextResponse.json({ success: true, revealed: false });
  }

  // Refused rather than ignored when the answers have not been released: a
  // rating given before the reveal is not the measurement.
  if (!(await predictionsComplete(clone))) {
    return NextResponse.json({ error: 'not_revealed' }, { status: 409 });
  }
  const rated = await recordRating({
    cloneAssignmentId: clone.assignmentId,
    bankItemId: parsed.bankItemId,
    rating: parsed.rating,
  });
  if (!rated.ok) return NextResponse.json({ error: 'not_revealed' }, { status: 409 });
  return NextResponse.json({ success: true });
}
