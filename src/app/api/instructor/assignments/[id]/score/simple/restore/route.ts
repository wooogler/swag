/**
 * Restore: make an older version the current one again.
 *
 * The versions after it stop being part of the timeline. That is what keeps
 * "the newest version is the configuration" true without a separate deploy
 * step — there is never a saved state that is newer than the one in effect.
 *
 * They are hidden, not deleted. A participant who tries something, does not
 * like it and goes back has just produced exactly the trace RQ1 is about, and
 * the full version's rule revert throws that away.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { logStudyEvent } from '@/lib/study/events';
import { simpleContext } from '@/lib/study/simple/route-context';
import { getSimpleTip, restoreSimpleVersion } from '@/lib/study/simple/store';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ versionNo: z.number().int().positive() });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await simpleContext(id, new URL(request.url).searchParams.get('view'));
  if ('error' in gate) return gate.error;
  const { condition, seedPrompt } = gate.context;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const before = await getSimpleTip({ assignmentId: id, condition, seedPrompt });
  const result = await restoreSimpleVersion({ assignmentId: id, versionNo: body.versionNo });
  if (!result) return NextResponse.json({ error: 'no_such_version' }, { status: 404 });

  await logStudyEvent(id, 'simple_version_restore', {
    condition,
    from: before.version?.versionNo ?? null,
    to: body.versionNo,
    hidden: result.hidden,
  });

  return NextResponse.json({ versionNo: body.versionNo, hidden: result.hidden });
}
