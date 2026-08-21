/**
 * Rate one batch of the outstanding (definition, question) work, and say how
 * much is left.
 *
 * The client loops on this, which is how the tree's counts fill in while the
 * participant carries on reading. It stops when nothing is left — or when a
 * batch rates nothing at all, which means the calls are failing rather than
 * that the work is done, and looping on that would spin forever.
 *
 * There is nothing to trigger: the board calls this itself whenever the
 * snapshot it is showing has definitions the cache has not seen. A "Run"
 * button would be asking the participant to operate the machine.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isOpenAIConfigured } from '@/lib/score/classifier';
import { definitionsOf } from '@/lib/study/simple/chain';
import { definitionTasks, judgeBatch } from '@/lib/study/simple/judge';
import { simpleContext } from '@/lib/study/simple/route-context';
import { getSimpleTip } from '@/lib/study/simple/store';
import { armOf } from '@/lib/study/config';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const bodySchema = z.object({
  /** Rate these questions first — what is on screen, then the pins. */
  priorityMessageIds: z.array(z.number().int()).max(200).optional(),
  limit: z.number().int().positive().max(400).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await simpleContext(id, new URL(request.url).searchParams.get('view'));
  if ('error' in gate) return gate.error;
  const { condition, seedPrompt } = gate.context;

  if (armOf(condition) === 'baseline') {
    // One document answers everything; there is nothing to decide about.
    return NextResponse.json({ ratedByHash: {}, total: 0, remaining: 0, ratedThisBatch: 0 });
  }
  if (!isOpenAIConfigured()) {
    return NextResponse.json({ error: 'openai_not_configured' }, { status: 503 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json().catch(() => ({})));
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const { snapshot } = await getSimpleTip({ assignmentId: id, condition, seedPrompt });
  const tasks = definitionTasks(definitionsOf(snapshot));
  const progress = await judgeBatch({
    assignmentId: id,
    tasks,
    priorityMessageIds: body.priorityMessageIds,
    limit: body.limit,
  });

  // Not logged here: judgeBatch logs its own pass, so that the background one
  // a save starts is recorded the same way this one is.
  return NextResponse.json(progress);
}
