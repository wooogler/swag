/**
 * The starter library for this clone, with real counts.
 *
 * A read, and only a read: the categories are the taxonomy's, the verdicts
 * behind the counts were prepared when the clone was provisioned, and nothing
 * here calls a model or writes anything (lib/study/simple/starters.ts).
 *
 * BOTH ARMS ask for it, for different things. The intent arm starts a WHEN
 * from a set. The one-document arm has no "when" to start, and reads its log
 * through them instead — which is why it also asks which questions each set
 * describes.
 *
 * That is deliberate and it is not the machinery leaking across. A set holds
 * two things: knowledge about this log — what students ask and how much of it
 * — and a way to turn that into an intent. The second is the mechanism under
 * study and stays on one side. The first is domain knowledge the researchers
 * put there, and giving it to one arm only would make the comparison "with
 * the mechanism AND with a map" against "without either", with no way to say
 * afterwards which half did the work.
 */
import { NextResponse } from 'next/server';
import { simpleContext } from '@/lib/study/simple/route-context';
import { loadStarters } from '@/lib/study/simple/starters';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await simpleContext(id, new URL(request.url).searchParams.get('view'));
  if ('error' in gate) return gate.error;
  // `forMessageId` marks the sets that already describe one question — sent
  // when an intent is being started from a row in the list. Still a read.
  const params2 = new URL(request.url).searchParams;
  const forMessageId = Number(params2.get('forMessageId'));
  // `within` is the questions the intent being written could actually take:
  // the pile it will be read before, and everything under it. The counts are
  // read as "how many would come here", so they are counted over exactly that.
  const within = (params2.get('within') ?? '')
    .split(',')
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0);
  return NextResponse.json({
    groups: await loadStarters(
      id,
      Number.isFinite(forMessageId) && forMessageId > 0 ? forMessageId : null,
      within.length > 0 ? new Set(within) : null,
      params2.get('withQuestions') === '1'
    ),
  });
}
