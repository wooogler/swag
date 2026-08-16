/**
 * Block-test answers: record every prediction, and only then release the
 * frozen responses.
 *
 * The block runs in two passes. Pass one predicts all eight — a written
 * description, the yes/no, and the point at the part of the configuration
 * expected to act (문항지 §3, 08-15: every answer is a UI input, none spoken)
 * — and shows no answers at all. Pass two walks the same eight again,
 * revealing, rating, and asking why where the prediction missed. Nothing here
 * decides which pass the client is in; the release rule lives in measure-store
 * and is re-derived from the rows on every request. All of it sits behind the
 * participant's own session and refuses unless the current phase is that
 * block's test.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentStudyParticipant } from '@/lib/study/session';
import {
  cloneForBlock,
  deployedConfigFor,
  getTestItems,
  predictionsComplete,
  recordPrediction,
  recordProbe,
  recordRating,
} from '@/lib/study/measure-store';
import { isStudyPhase, phaseAccess } from '@/lib/study/phases';

export const dynamic = 'force-dynamic';

const pointingSchema = z.discriminatedUnion('kind', [
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
]);

// One prediction, all three parts. The description is required — §3 Pass 1
// will not let Next through without it — while "not sure" is a real answer for
// the other two and arrives as its own pointing kind.
const predictSchema = z.object({
  action: z.literal('predict'),
  bankItemId: z.number().int().positive(),
  expectation: z.string().trim().min(1).max(2000),
  guess: z.boolean(),
  pointing: pointingSchema,
});
const ratingSchema = z.object({
  action: z.literal('rating'),
  bankItemId: z.number().int().positive(),
  rating: z.number().int().min(1).max(5),
  whatsOff: z.string().max(2000).optional(),
});
// Optional by design: a blank probe is a real answer (§3 ④).
const probeSchema = z.object({
  action: z.literal('probe'),
  bankItemId: z.number().int().positive(),
  probe: z.string().max(4000),
});
const bodySchema = z.union([predictSchema, ratingSchema, probeSchema]);

export async function POST(req: Request) {
  const participant = await getCurrentStudyParticipant();
  if (!participant) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const phase = isStudyPhase(participant.phase) ? participant.phase : 'not_started';
  const block = phaseAccess(participant, phase).testBlock;
  if (!block) return NextResponse.json({ error: 'wrong_phase' }, { status: 409 });

  const clone = await cloneForBlock(participant, block);
  if (!clone) return NextResponse.json({ error: 'no_clone' }, { status: 404 });

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  if (parsed.action === 'predict') {
    // An intent id has to be one of the intents this participant deployed —
    // otherwise the pointing/routing comparison would score against a number
    // that means nothing on their board.
    const pointing = parsed.pointing;
    if (pointing.kind === 'intent') {
      const config = await deployedConfigFor(clone);
      const known = (config?.intents ?? []).some((i) => i.id === pointing.intentId);
      if (!known) return NextResponse.json({ error: 'unknown_intent' }, { status: 400 });
    }
    const result = await recordPrediction({
      participant,
      cloneAssignmentId: clone.assignmentId,
      bankItemId: parsed.bankItemId,
      expectation: parsed.expectation,
      guess: parsed.guess,
      pointing,
    });
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: 409 });

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

  // Both of the remaining actions belong to pass two, which does not exist
  // until every prediction is in.
  if (!(await predictionsComplete(clone))) {
    return NextResponse.json({ error: 'not_revealed' }, { status: 409 });
  }

  if (parsed.action === 'rating') {
    const rated = await recordRating({
      cloneAssignmentId: clone.assignmentId,
      bankItemId: parsed.bankItemId,
      rating: parsed.rating,
      whatsOff: parsed.whatsOff,
    });
    if (!rated.ok) return NextResponse.json({ error: 'not_revealed' }, { status: 409 });
    // The probe opens on whether the prediction missed, and half of that is
    // the routing record — which the participant never sees, and which only
    // becomes safe to act on once the rating is in. So the verdict is computed
    // here and returned as a bare boolean, not as the intent that fired.
    const items = await getTestItems(participant, clone);
    const item = items.find((i) => i.bankItemId === parsed.bankItemId);
    return NextResponse.json({ success: true, missed: item?.missed ?? false });
  }

  const probed = await recordProbe({
    cloneAssignmentId: clone.assignmentId,
    bankItemId: parsed.bankItemId,
    probe: parsed.probe,
  });
  if (!probed.ok) return NextResponse.json({ error: 'not_rated' }, { status: 409 });
  return NextResponse.json({ success: true });
}
