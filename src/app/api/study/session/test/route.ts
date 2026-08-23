/**
 * Block-test answers: record every prediction, and only then release the
 * frozen responses.
 *
 * The block runs in two passes (docs/BLOCK_TEST v3.md §3.1). Pass one predicts
 * every question — how it should ideally answer, which part of the
 * configuration will handle it, how well they can anticipate it, and whether
 * they expect the answer to be educationally desirable — and shows no answers
 * at all. Pass two walks the same questions again, revealing each response and
 * taking two judgements, then opening the probe where either judgement is
 * negative. Nothing here decides which pass the client is in; the release rule
 * lives in measure-store and is re-derived from the rows on every request. All
 * of it sits behind the participant's own session and refuses unless the
 * current phase is that block's test.
 *
 * THE ONE THING THIS ROUTE HOLDS BACK is the Matched chip: which intent really
 * fired is returned with the judgement write, and only when the probe panel is
 * owed (§3.2). A client that has not answered both questions has never been
 * sent it.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentStudyParticipant } from '@/lib/study/session';
import {
  cloneForBlock,
  deployedConfigFor,
  getTestItems,
  predictionsComplete,
  probeOpens,
  recordJudgement,
  recordPrediction,
  recordProbe,
} from '@/lib/study/measure-store';
import { isStudyPhase, phaseAccess } from '@/lib/study/phases';
import { logStudyEvent } from '@/lib/study/events';

export const dynamic = 'force-dynamic';

const pointingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('intent'), intentId: z.number().int().positive() }),
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('not_sure') }),
  // A list, and a bounded one: a participant highlighting the whole document a
  // sentence at a time is answering a different question, and the cap keeps a
  // runaway client from writing a row nothing can read.
  z.object({
    kind: z.literal('span'),
    spans: z
      .array(
        z.object({
          start: z.number().int().min(0),
          end: z.number().int().positive(),
          text: z.string().min(1).max(4000),
        })
      )
      .min(1)
      .max(24),
  }),
  z.object({ kind: z.literal('nothing') }),
]);

/**
 * Per-step durations for the item, in ms from when it appeared on screen.
 *
 * Client-measured, and deliberately so: the steps of one prediction are
 * answered between two server round trips (there is exactly one write, at
 * Next), so the server cannot see them. Every field is optional — a step not
 * reached simply has no number — and all are clamped, because this is
 * client-supplied data whose only job is analysis.
 */
const MAX_MS = 6 * 60 * 60 * 1000;
const ms = () => z.number().int().min(0).max(MAX_MS).optional();
const count = () => z.number().int().min(0).max(100000).optional();
const timingSchema = z
  .object({
    idealStart: ms(),
    idealEnd: ms(),
    pointFirst: ms(),
    point: ms(),
    pointChanges: count(),
    confidence: ms(),
    expectDesirable: ms(),
    submit: ms(),
    reveal: ms(),
    desirable: ms(),
    follows: ms(),
    desirableChanges: count(),
    followsChanges: count(),
    probeOpened: ms(),
    probe: ms(),
    repair: ms(),
    probeChars: count(),
    repairChars: count(),
  })
  .optional();

/** The 6-point agreement scale, and nothing else (§3.3). */
const agree6 = () => z.number().int().min(1).max(6);

// One prediction, all four parts. Q1 is required — §4 Pass 1 will not let Next
// through without it — while "I don't know" is a real answer to Q2 and arrives
// as its own pointing kind.
const predictSchema = z.object({
  action: z.literal('predict'),
  bankItemId: z.number().int().positive(),
  ideal: z.string().trim().min(1).max(2000),
  pointing: pointingSchema,
  confidence: agree6(),
  expectDesirable: agree6(),
  timing: timingSchema,
});
// Q5 and Q6, as a patch: they are two clicks and either can be revised, so a
// write that carries one must leave the other alone.
const judgeSchema = z
  .object({
    action: z.literal('judge'),
    bankItemId: z.number().int().positive(),
    desirable: agree6().optional(),
    follows: agree6().optional(),
    timing: timingSchema,
  })
  .refine((b) => b.desirable !== undefined || b.follows !== undefined, {
    message: 'nothing to judge',
  });
// Optional by design: a blank probe or repair is a real answer (§4 P, F).
const probeSchema = z.object({
  action: z.literal('probe'),
  bankItemId: z.number().int().positive(),
  probe: z.string().max(4000).optional(),
  repair: z.string().max(4000).optional(),
  timing: timingSchema,
});
// Opening the frozen answer. Writes nothing to the answer row — it only marks
// the moment the prediction stopped being blind, which the trail needs and no
// other row records.
const revealSchema = z.object({
  action: z.literal('reveal'),
  bankItemId: z.number().int().positive(),
  atMs: z.number().int().min(0).max(MAX_MS).optional(),
});
const bodySchema = z.union([predictSchema, judgeSchema, probeSchema, revealSchema]);

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
      ideal: parsed.ideal,
      pointing,
      confidence: parsed.confidence,
      expectDesirable: parsed.expectDesirable,
      timing: parsed.timing ?? null,
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

  // The reveal is instrumentation only, and the client does not wait on it.
  if (parsed.action === 'reveal') {
    await logStudyEvent(clone.assignmentId, 'test_reveal', {
      bankItemId: parsed.bankItemId,
      atMs: parsed.atMs ?? null,
    });
    return NextResponse.json({ success: true });
  }

  if (parsed.action === 'judge') {
    const judged = await recordJudgement({
      cloneAssignmentId: clone.assignmentId,
      bankItemId: parsed.bankItemId,
      desirable: parsed.desirable,
      follows: parsed.follows,
      timing: parsed.timing ?? null,
    });
    if (!judged.ok) return NextResponse.json({ error: 'not_revealed' }, { status: 409 });

    // The Matched chip travels with the write that earns it. Both judgements
    // in and one of them negative is the whole condition (§4 ③); anything less
    // and this response carries no routing at all, which is why it is computed
    // from the stored row rather than from what the client claimed.
    const open = probeOpens(judged.desirable, judged.follows);
    // The name AND the id: the client marks the row that answered inside the
    // configuration panel, which needs to know which row.
    const matched = open
      ? (await getTestItems(participant, clone)).find(
          (i) => i.bankItemId === parsed.bankItemId
        )?.matched ?? null
      : null;
    return NextResponse.json({
      success: true,
      desirable: judged.desirable,
      follows: judged.follows,
      probeOpen: open,
      matched,
    });
  }

  const probed = await recordProbe({
    cloneAssignmentId: clone.assignmentId,
    bankItemId: parsed.bankItemId,
    probe: parsed.probe,
    repair: parsed.repair,
    timing: parsed.timing ?? null,
  });
  if (!probed.ok) return NextResponse.json({ error: 'not_rated' }, { status: 409 });
  return NextResponse.json({ success: true });
}
