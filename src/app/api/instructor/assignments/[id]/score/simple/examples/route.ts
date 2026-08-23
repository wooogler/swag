/**
 * The examples that stand for an intent.
 *
 * Adding one does NOT put its question in the intent — the definition does
 * that, and the row keeps the ownership chip that says where it actually went.
 * What an example changes is the ORDER of the list, which is why this is its
 * own surface: nothing here touches the snapshot, the verdicts or a reply.
 *
 * POST   { sid, messageId }   add a question from the log
 * POST   { sid, regenerate }  write a fresh set, keeping the questions
 * POST   { sid, id, text }    rewrite one written example
 * DELETE ?sid=&id=            remove one
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { armOf } from '@/lib/study/config';
import { logStudyEvent } from '@/lib/study/events';
import {
  addQuestionExample,
  editIntentExample,
  listIntentExamples,
  regenerateIntentExamples,
  removeIntentExample,
} from '@/lib/study/simple/anchors';
import { findIntent } from '@/lib/study/simple/chain';
import { simpleContext } from '@/lib/study/simple/route-context';
import { getSimpleTip } from '@/lib/study/simple/store';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  sid: z.number().int().positive(),
  messageId: z.number().int().positive().optional(),
  regenerate: z.boolean().optional(),
  /** Rewrite this written example. */
  id: z.number().int().positive().optional(),
  text: z.string().max(500).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await simpleContext(id, new URL(request.url).searchParams.get('view'));
  if ('error' in gate) return gate.error;
  const { condition, seedPrompt } = gate.context;
  if (armOf(condition) !== 'score') {
    return NextResponse.json({ error: 'not_this_arm' }, { status: 400 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  if (body.regenerate) {
    const { snapshot } = await getSimpleTip({ assignmentId: id, condition, seedPrompt });
    const intent = findIntent(snapshot, body.sid);
    if (!intent) return NextResponse.json({ error: 'no_such_intent' }, { status: 404 });
    const written = await regenerateIntentExamples({
      assignmentId: id,
      sid: body.sid,
      definition: intent.definition,
      assignmentPrompt: seedPrompt,
    });
    await logStudyEvent(id, 'simple_examples_regenerate', { condition, sid: body.sid, written });
  } else if (body.id != null && body.text != null) {
    const done = await editIntentExample({
      assignmentId: id,
      sid: body.sid,
      id: body.id,
      text: body.text,
    });
    if (!done) return NextResponse.json({ error: 'no_such_example' }, { status: 404 });
    await logStudyEvent(id, 'simple_example_edit', { condition, sid: body.sid, id: body.id });
  } else if (body.messageId) {
    await addQuestionExample({ assignmentId: id, sid: body.sid, messageId: body.messageId });
    await logStudyEvent(id, 'simple_example_add', {
      condition,
      sid: body.sid,
      messageId: body.messageId,
    });
  }
  return NextResponse.json({ examples: await listIntentExamples(id, body.sid) });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const gate = await simpleContext(id, url.searchParams.get('view'));
  if ('error' in gate) return gate.error;

  const sid = Number(url.searchParams.get('sid'));
  const exampleId = Number(url.searchParams.get('id'));
  if (!Number.isFinite(sid) || !Number.isFinite(exampleId)) {
    return NextResponse.json({ error: 'invalid_query' }, { status: 400 });
  }
  await removeIntentExample({ assignmentId: id, sid, id: exampleId });
  await logStudyEvent(id, 'simple_example_remove', { condition: gate.context.condition, sid });
  return NextResponse.json({ examples: await listIntentExamples(id, sid) });
}
