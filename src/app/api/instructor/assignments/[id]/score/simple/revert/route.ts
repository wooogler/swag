/**
 * Throw away what has been applied since the last save.
 *
 * Apply's partner. Trying four things and keeping none of them has to be as
 * cheap as trying them was, or the cost of an experiment is the cost of
 * undoing it and people stop experimenting.
 *
 * Not the same act as a restore, which goes back to a version the participant
 * chose off their history. This goes back to the most recent one, and needs no
 * choosing — that is the point of it.
 *
 * The discarded attempts are hidden, not deleted: what someone tried and
 * abandoned is exactly what RQ1 is about, and it exists nowhere else once the
 * timeline moves on.
 */
import { NextResponse } from 'next/server';
import { logStudyEvent } from '@/lib/study/events';
import { simpleContext } from '@/lib/study/simple/route-context';
import { getSimpleTip, revertSimpleWorking } from '@/lib/study/simple/store';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await simpleContext(id, new URL(request.url).searchParams.get('view'));
  if ('error' in gate) return gate.error;
  const { condition, seedPrompt } = gate.context;

  const before = await getSimpleTip({ assignmentId: id, condition, seedPrompt });
  const result = await revertSimpleWorking(id);
  // Nothing saved yet means there is nowhere to go back TO, and wiping their
  // work would be a strange thing to do about that.
  if (!result) return NextResponse.json({ error: 'nothing_saved' }, { status: 409 });

  await logStudyEvent(id, 'simple_revert', {
    condition,
    from: before.version?.versionNo ?? null,
    to: result.to,
    dropped: result.dropped,
  });

  return NextResponse.json(result);
}
