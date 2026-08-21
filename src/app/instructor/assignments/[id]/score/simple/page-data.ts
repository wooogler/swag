/**
 * The simple board's first render, built on the server.
 *
 * Everything here is also available through the state route the board polls;
 * loading it once up front is what makes the board arrive with its questions,
 * its counts and its history already in place instead of blank for a beat.
 *
 * Deliberately narrow: the log's questions plus the same ownership the
 * routing uses. None of the full version's layers — ratings per intent,
 * corrections, deploy snapshots, query types — are read, because the simple
 * board has nowhere to show any of them and loading them would leave a
 * participant waiting on work for a screen they are not going to see.
 */
import 'server-only';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db/db';
import { scoreDissections, studentSessions } from '@/db/schema';
import { getQueryRecords } from '@/lib/score/queries';
import { DISSECTION_VERSION, type MaterialKind, type MaterialSpan } from '@/lib/score/intents';
import type { ScoreQueryRow } from '../IntentBoard';
import { armOf, type StudioView } from '@/lib/study/config';
import { definitionsOf, resolveSimpleAll } from '@/lib/study/simple/chain';
import { definitionTasks, readMatches } from '@/lib/study/simple/judge';
import { getSimpleState } from '@/lib/study/simple/store';

export async function loadSimpleBoard(args: {
  assignmentId: string;
  condition: StudioView;
  seedPrompt: string;
}) {
  const { assignmentId, condition, seedPrompt } = args;
  const [records, sessions, state] = await Promise.all([
    getQueryRecords(assignmentId),
    db
      .select({ id: studentSessions.id, participantToken: studentSessions.participantToken })
      .from(studentSessions)
      .where(eq(studentSessions.assignmentId, assignmentId)),
    getSimpleState({ assignmentId, condition, seedPrompt }),
  ]);

  const messageIds = records.map((r) => r.messageId);
  const dissectionRows = messageIds.length
    ? await db
        .select()
        .from(scoreDissections)
        .where(
          and(
            eq(scoreDissections.assignmentId, assignmentId),
            inArray(scoreDissections.messageId, messageIds)
          )
        )
    : [];

  const tokenBySession = new Map(sessions.map((s) => [s.id, s.participantToken]));
  const dissectionByMessage = new Map(
    dissectionRows.map((d) => [
      d.messageId,
      {
        materialKinds: (Array.isArray(d.materialKinds) ? d.materialKinds : []) as MaterialKind[],
        requests: (Array.isArray(d.requests) ? d.requests : []) as string[],
        materials: (Array.isArray(d.materials) ? d.materials : []) as MaterialSpan[],
        stale: d.version < DISSECTION_VERSION,
      },
    ])
  );

  // Turn ordinal within the conversation — records arrive conversation-ordered.
  const turnByMessage = new Map<number, number>();
  let previousConversation: string | null = null;
  let turn = 0;
  for (const record of records) {
    if (record.conversationId !== previousConversation) {
      previousConversation = record.conversationId;
      turn = 0;
    }
    turn += 1;
    turnByMessage.set(record.messageId, turn);
  }

  const rows: ScoreQueryRow[] = records
    .map((rec) => ({
      messageId: rec.messageId,
      sessionId: rec.sessionId,
      conversationId: rec.conversationId,
      participantToken: tokenBySession.get(rec.sessionId) ?? '',
      queryText: rec.queryText,
      responseText: rec.responseText,
      chatDeployVersion: rec.responseChatVersion,
      appliedIntentId: rec.responseIntentId,
      appliedOutcome: rec.responseOutcome,
      prevQueryText: rec.prevQueryText,
      prevResponseText: rec.prevResponseText,
      turnIndex: rec.turnIndex,
      turnNumber: turnByMessage.get(rec.messageId) ?? 0,
      queryTimestamp: rec.queryTimestamp.toISOString(),
      // The simple board has no per-intent verdict chips, no corrections and
      // no type sections, so these stay empty rather than being filled with
      // state nothing renders.
      intentRatings: {},
      pinnedIntents: {},
      heldPins: {},
      dissection: dissectionByMessage.get(rec.messageId) ?? null,
      queryType: null,
    }))
    // One fixed order for everyone, oldest first: the middle column has no
    // sort control, so this IS the order, and every participant starts from
    // the same screen.
    .sort((a, b) => a.queryTimestamp.localeCompare(b.queryTimestamp) || a.messageId - b.messageId);

  const tasks = definitionTasks(definitionsOf(state.snapshot));
  const matches =
    armOf(condition) === 'score' ? await readMatches({ assignmentId, tasks }) : new Map();
  const { owners, counts } =
    armOf(condition) === 'score'
      ? resolveSimpleAll(state.snapshot, matches, messageIds)
      : { owners: new Map(), counts: new Map() };
  let pending = 0;
  for (const messageId of messageIds) {
    if (owners.get(messageId)?.outcome === 'pending') pending += 1;
  }

  return {
    rows,
    initialState: {
      arm: armOf(condition),
      snapshot: state.snapshot,
      versions: state.versions,
      viewing: state.viewing,
      atTip: state.atTip,
      pinned: state.pinned,
      owners: Object.fromEntries(
        [...owners.entries()].map(([messageId, o]) => [
          String(messageId),
          { sid: o.sid, outcome: o.outcome, matchedElsewhere: o.matchedElsewhere },
        ])
      ),
      counts: Object.fromEntries(
        [...counts.entries()].map(([sid, n]) => [sid === null ? 'root' : String(sid), n])
      ),
      judged: messageIds.length - pending,
      pending,
      diff: null,
    },
  };
}
