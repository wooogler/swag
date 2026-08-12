/**
 * The participant's own "next step" — the counterpart to the console's phase
 * route, minus everything a participant should not have: no force, no going
 * back, no jumping to a named phase. It steps exactly one phase forward and
 * only when the work that phase leads into can actually be shown.
 *
 * Long-running by necessity: two of the hand-offs generate a batch of frozen
 * answers before they return (advance.ts).
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { advanceParticipant } from '@/lib/study/advance';
import { getCurrentStudyParticipant } from '@/lib/study/session';

export const dynamic = 'force-dynamic';
export const maxDuration = 800;

const bodySchema = z.object({
  /** The phase the page was rendered for; refuses if they have moved since. */
  from: z.string().optional(),
});

export async function POST(req: Request) {
  const participant = await getCurrentStudyParticipant();
  if (!participant) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await req.json().catch(() => ({})));
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const result = await advanceParticipant(participant, parsed.from);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason, message: result.message, phase: result.phase },
      { status: 409 }
    );
  }
  return NextResponse.json({ success: true, phase: result.phase });
}
