/**
 * The starter library for this clone, with real counts.
 *
 * A read, and only a read: the categories are the taxonomy's, the verdicts
 * behind the counts were prepared when the clone was provisioned, and nothing
 * here calls a model or writes anything (lib/study/simple/starters.ts).
 *
 * Only the intent arm asks for it — the one-document arm has no "when" to
 * start from — but it is not refused there, because refusing would make the
 * researcher's own side-by-side preview lopsided for no reason.
 */
import { NextResponse } from 'next/server';
import { simpleContext } from '@/lib/study/simple/route-context';
import { loadStarters } from '@/lib/study/simple/starters';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await simpleContext(id, new URL(request.url).searchParams.get('view'));
  if ('error' in gate) return gate.error;
  return NextResponse.json({ groups: await loadStarters(id) });
}
