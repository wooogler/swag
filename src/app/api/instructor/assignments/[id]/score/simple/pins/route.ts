/**
 * Pin a question to the top of the list, or unpin it.
 *
 * A bookmark and nothing else. Selecting an intent hides the questions it does
 * not own, so a pin is how a question stays on screen while the intent that
 * would exclude it is being edited — which is a thing people need constantly
 * and which no other control here provides.
 *
 * It is deliberately inert: not in a hash, not in a prompt, not in a routing
 * decision, not visible to the chatbot. (The full version's pins are the
 * opposite of this — rulings the classifier is taught from — and share nothing
 * with it but the word.)
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { logStudyEvent } from '@/lib/study/events';
import { simpleContext } from '@/lib/study/simple/route-context';
import { addSimplePin, removeSimplePin } from '@/lib/study/simple/store';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ messageId: z.number().int() });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await simpleContext(id);
  if ('error' in gate) return gate.error;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  await addSimplePin(id, body.messageId);
  await logStudyEvent(id, 'simple_pin_add', {
    condition: gate.context.condition,
    messageId: body.messageId,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await simpleContext(id);
  if ('error' in gate) return gate.error;

  const messageId = Number(new URL(request.url).searchParams.get('messageId'));
  if (!Number.isFinite(messageId)) {
    return NextResponse.json({ error: 'invalid_message' }, { status: 400 });
  }
  await removeSimplePin(id, messageId);
  await logStudyEvent(id, 'simple_pin_remove', {
    condition: gate.context.condition,
    messageId,
  });
  return NextResponse.json({ ok: true });
}
