/**
 * The order one intent's questions are listed in.
 *
 * A separate read from the board's state because it is answered from a
 * different place and on a different clock: the state route is polled while
 * judging runs, and loading a few hundred embedding vectors on every one of
 * those polls would make the cheap thing expensive. This is asked once, when
 * an intent is opened.
 *
 * It only ever REARRANGES the ids it is given. Nothing is filtered here —
 * which questions are in the list is the verdicts' business, decided in the
 * state route, and a second opinion about it in a second place would
 * eventually disagree with the first.
 */
import { NextResponse } from 'next/server';
import { rankQuestions, readAnchor } from '@/lib/study/simple/anchors';
import { definitionsOf, findIntent, resolveSimpleAll } from '@/lib/study/simple/chain';
import { definitionTasks, readMatches } from '@/lib/study/simple/judge';
import { simpleContext } from '@/lib/study/simple/route-context';
import { scopedRecords } from '@/lib/study/simple/scope';
import { getSimpleTip, getSimpleVersion } from '@/lib/study/simple/store';
import { armOf } from '@/lib/study/config';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const gate = await simpleContext(id, url.searchParams.get('view'));
  if ('error' in gate) return gate.error;
  const { condition, seedPrompt } = gate.context;
  if (armOf(condition) !== 'score') return NextResponse.json({ order: [], examples: [] });

  const sid = Number(url.searchParams.get('sid'));
  if (!Number.isFinite(sid) || sid <= 0) {
    return NextResponse.json({ error: 'bad_sid' }, { status: 400 });
  }
  const versionParam = url.searchParams.get('versionNo');
  const snapshot =
    versionParam != null
      ? await getSimpleVersion({
          assignmentId: id,
          condition,
          seedPrompt,
          versionNo: Number(versionParam),
        })
      : (await getSimpleTip({ assignmentId: id, condition, seedPrompt })).snapshot;
  if (!snapshot) return NextResponse.json({ error: 'no_such_version' }, { status: 404 });

  const intent = findIntent(snapshot, sid);
  if (!intent) return NextResponse.json({ order: [], examples: [] });

  // The same list the middle column shows for this intent: what its own words
  // describe, including what an intent above it takes first.
  const records = await scopedRecords(id);
  const messageIds = records.map((r) => r.messageId);
  const tasks = definitionTasks(definitionsOf(snapshot));
  const matches = await readMatches({ assignmentId: id, tasks });
  const { owners } = resolveSimpleAll(snapshot, matches, messageIds);
  const mine = messageIds.filter((m) => {
    const owner = owners.get(m);
    return owner?.sid === sid || owner?.matchedElsewhere.includes(sid);
  });

  // Owned first, then the ones an intent above took — each ranked. A row at
  // the top saying it went somewhere else is the same kind of surprise this
  // ordering exists to prevent.
  const owned = mine.filter((m) => owners.get(m)?.sid === sid);
  const elsewhere = mine.filter((m) => owners.get(m)?.sid !== sid);
  const [rankedOwned, rankedElsewhere] = await Promise.all([
    rankQuestions({ assignmentId: id, sid, definition: intent.definition, messageIds: owned }),
    rankQuestions({ assignmentId: id, sid, definition: intent.definition, messageIds: elsewhere }),
  ]);

  const anchor = await readAnchor(id, intent.definition);
  return NextResponse.json({
    order: [...rankedOwned, ...rankedElsewhere],
    // Folded away in the card until asked for. Empty whenever the intent was
    // carved out of a real question — there was nothing to invent.
    examples: anchor?.examples ?? [],
  });
}
