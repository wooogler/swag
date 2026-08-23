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
 * is resolved against that snapshot instead.
 *
 * It used to answer `diffFrom` as well — what moved in or out of each intent
 * since a given version, painted as green and red rows. That signal was read
 * by POSITION, and it stopped being legible once the list started being
 * ordered by an intent's examples and flipped end for end: a row that moved in
 * could be anywhere. If the question comes back, the form that survives
 * reordering is a count, not a colour on a row.
 */
import { NextResponse } from 'next/server';
import { afterSaveInFlight } from '@/lib/study/simple/after-save';
import { readIntentWordings } from '@/lib/study/simple/intent-versions';
import { simpleContext } from '@/lib/study/simple/route-context';
import { getSimpleState } from '@/lib/study/simple/store';
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

  const state = await getSimpleState({
    assignmentId: id,
    condition,
    seedPrompt,
    // "0" is a version — the one as delivered — so an empty string is the
    // only thing that means "no version asked for".
    versionNo: versionParam != null && versionParam !== '' ? Number(versionParam) : null,
  });

  // Side by side: neither of these needs the other, and this route is polled.
  const [records, wordings] = await Promise.all([
    scopedRecords(id),
    readIntentWordings(id, state.snapshot),
  ]);
  const messageIds = records.map((r) => r.messageId);
  const current = await ownershipFor(id, state.snapshot, messageIds);

  return NextResponse.json({
    arm: armOf(condition),
    snapshot: state.snapshot,
    versions: state.versions,
    moments: state.moments,
    viewing: state.viewing,
    atTip: state.atTip,
    // What the study measures, and whether the board has moved past it.
    savedVersionNo: state.savedVersionNo,
    deployedVersionNo: state.deployedVersionNo,
    dirty: state.dirty,
    unsavedSids: state.unsavedSids,
    // sid → that intent's own history, newest first. '0' is the
    // everything-else rule, and in the baseline arm it is the whole of it.
    intentVersions: wordings.intentVersions,
    // sid → what its wording catches right now, for the row that is applied
    // and not saved yet and so has no stored version to carry the number.
    matchesNow: wordings.matchesNow,
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
  });
}
