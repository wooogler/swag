/**
 * One read that fills the whole simple board: the configuration being viewed,
 * the timeline beside it, who owns which question, and the pins.
 *
 * Everything derived is derived here rather than on the client, because the
 * server has to compute the same ownership to answer a question and two
 * implementations of first-match would eventually disagree about what the
 * chatbot does.
 *
 * `versionNo` looks at an older version: the editors lock and every question
 * is resolved against that snapshot instead. `diffFrom` additionally returns
 * what moved in or out of each intent since a given version, which is what
 * paints the green and red rows after a definition is saved.
 */
import { NextResponse } from 'next/server';
import { afterSaveInFlight } from '@/lib/study/simple/after-save';
import { simpleContext } from '@/lib/study/simple/route-context';
import { getSimpleState, getSimpleVersion } from '@/lib/study/simple/store';
import { definitionsOf, resolveSimpleAll, type SimpleSnapshot } from '@/lib/study/simple/chain';
import { definitionTasks, readMatches } from '@/lib/study/simple/judge';
import { armOf } from '@/lib/study/config';
import { scopedRecords } from '@/lib/study/simple/scope';

export const dynamic = 'force-dynamic';

/** Ownership for every question in the log under one snapshot. */
async function ownershipFor(assignmentId: string, snapshot: SimpleSnapshot, messageIds: number[]) {
  if (snapshot.arm === 'baseline') {
    return { owners: new Map(), counts: new Map(), judged: 0, pending: 0 };
  }
  const tasks = definitionTasks(definitionsOf(snapshot));
  const matches = await readMatches({ assignmentId, tasks });
  const { owners, counts } = resolveSimpleAll(snapshot, matches, messageIds);
  let pending = 0;
  for (const id of messageIds) if (owners.get(id)?.outcome === 'pending') pending += 1;
  return { owners, counts, judged: messageIds.length - pending, pending };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await simpleContext(id, new URL(request.url).searchParams.get('view'));
  if ('error' in gate) return gate.error;
  const { condition, seedPrompt } = gate.context;

  const url = new URL(request.url);
  const versionParam = url.searchParams.get('versionNo');
  const diffParam = url.searchParams.get('diffFrom');

  const state = await getSimpleState({
    assignmentId: id,
    condition,
    seedPrompt,
    versionNo: versionParam ? Number(versionParam) : null,
  });

  const records = await scopedRecords(id);
  const messageIds = records.map((r) => r.messageId);
  const current = await ownershipFor(id, state.snapshot, messageIds);

  // What moved since a chosen version — shown as a plain +/− on the rows, with
  // no reading of whether the move was an improvement.
  let diff: { sid: number | null; entered: number[]; left: number[] }[] | null = null;
  if (diffParam) {
    const before = await getSimpleVersion({
      assignmentId: id,
      condition,
      seedPrompt,
      versionNo: Number(diffParam),
    });
    if (before) {
      const previous = await ownershipFor(id, before, messageIds);
      const sids = new Set<number | null>([
        null,
        ...state.snapshot.intents.map((i) => i.sid),
        ...before.intents.map((i) => i.sid),
      ]);
      diff = [...sids].map((sid) => ({
        sid,
        entered: messageIds.filter(
          (m) =>
            current.owners.get(m)?.sid === sid &&
            current.owners.get(m)?.outcome !== 'pending' &&
            previous.owners.get(m)?.sid !== sid
        ),
        left: messageIds.filter(
          (m) =>
            previous.owners.get(m)?.sid === sid &&
            previous.owners.get(m)?.outcome !== 'pending' &&
            current.owners.get(m)?.sid !== sid
        ),
      }));
    }
  }

  return NextResponse.json({
    arm: armOf(condition),
    snapshot: state.snapshot,
    versions: state.versions,
    viewing: state.viewing,
    atTip: state.atTip,
    // What the study measures, and whether the board has moved past it.
    savedVersionNo: state.savedVersionNo,
    dirty: state.dirty,
    pinned: state.pinned,
    // messageId → { sid, outcome }. The board renders "applied: X" from this
    // and nothing else, so what it shows is what would actually be sent.
    owners: Object.fromEntries(
      [...current.owners.entries()].map(([messageId, o]) => [
        messageId,
        { sid: o.sid, outcome: o.outcome, matchedElsewhere: o.matchedElsewhere },
      ])
    ),
    counts: Object.fromEntries(
      [...current.counts.entries()].map(([sid, n]) => [sid === null ? 'root' : sid, n])
    ),
    judged: current.judged,
    pending: current.pending,
    // Whether the save's own follow-up work is still going. The board waits on
    // this rather than starting a second pass over the same questions: both
    // would read the cache, both would find the same pairs missing, and both
    // would call the model for every one of them.
    working: afterSaveInFlight(id) !== null,
    diff,
  });
}
