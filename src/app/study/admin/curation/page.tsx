import { notFound, redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/db/db';
import { assignments, scoreDissections, studentSessions } from '@/db/schema';
import { getInstructor, isAdministrator } from '@/lib/auth';
import { getQueryRecords } from '@/lib/score/queries';
import { DISSECTION_VERSION, type MaterialKind, type MaterialSpan } from '@/lib/score/intents';
import { CURATION_DATASETS, curationDataset } from '@/lib/study/config';
import { getCurationState, getSetTargets, validateCuration } from '@/lib/study/curation';
import { adminCodeOf } from '@/lib/study/admin';
import type { ScoreQueryRow } from '@/app/instructor/assignments/[id]/score/IntentBoard';
import CurationBoard from './CurationBoard';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Study Settings' };

/**
 * Set curation — one screen over a MASTER log.
 *
 * Rows are assembled the way the studio board assembles them (same records +
 * dissections + tokens), because the viewer pieces it reuses (ConversationThread,
 * QueryTextButton) read ScoreQueryRow. Curation has no intents of its own, so
 * the intent-shaped fields are filled with empties rather than faked.
 */
export default async function CurationPage({
  searchParams,
}: {
  searchParams: Promise<{ ds?: string }>;
}) {
  const instructor = await getInstructor();
  if (!instructor) redirect('/study/admin');
  if (!isAdministrator(instructor)) notFound();

  const params = await searchParams;
  const datasetKey = params.ds ?? CURATION_DATASETS[0]?.key;
  const dataset = datasetKey ? curationDataset(datasetKey) : undefined;
  if (!dataset) notFound();

  const assignmentId = dataset.masterAssignmentId;
  const [assignment, state, targets, records, sessions, dissectionRows] = await Promise.all([
    db.query.assignments.findFirst({ where: eq(assignments.id, assignmentId) }),
    getCurationState(dataset.key),
    getSetTargets(),
    getQueryRecords(assignmentId),
    db
      .select({ id: studentSessions.id, participantToken: studentSessions.participantToken })
      .from(studentSessions)
      .where(eq(studentSessions.assignmentId, assignmentId)),
    db
      .select({
        messageId: scoreDissections.messageId,
        materialKinds: scoreDissections.materialKinds,
        requests: scoreDissections.requests,
        materials: scoreDissections.materials,
        version: scoreDissections.version,
      })
      .from(scoreDissections)
      .where(eq(scoreDissections.assignmentId, assignmentId)),
  ]);
  if (!assignment) notFound();

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
  const typeByMessage = new Map(state.questions.map((q) => [q.messageId, q.queryType]));

  // Turn ordinal within the conversation — records arrive conversation-ordered.
  const turnByMessage = new Map<number, number>();
  let prevConversation: string | null = null;
  let turnCounter = 0;
  for (const rec of records) {
    if (rec.conversationId !== prevConversation) {
      prevConversation = rec.conversationId;
      turnCounter = 0;
    }
    turnCounter += 1;
    turnByMessage.set(rec.messageId, turnCounter);
  }

  const rows: ScoreQueryRow[] = records.map((rec) => ({
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
    // Curation has no intents of its own — these stay empty rather than being
    // filled with the master's template verdicts, which are surfaced as the
    // subtype tree instead of as per-row intent chips.
    intentRatings: {},
    pinnedIntents: {},
    heldPins: {},
    dissection: dissectionByMessage.get(rec.messageId) ?? null,
    queryType: typeByMessage.get(rec.messageId) ?? null,
  }));

  return (
    <div className="h-screen flex flex-col">
      {/* Keyed by dataset: switching datasets is a client navigation, and
          without this React reuses the mounted board — its state was SEEDED
          from the old dataset and useState ignores the new initial value, so
          the tree keeps the old counts while the rows underneath are the new
          dataset's, and every list comes out empty. A different dataset is a
          different board. */}
      <CurationBoard
        key={dataset.key}
        rows={rows}
        initialState={state}
        initialViolations={validateCuration(state, targets)}
        datasets={CURATION_DATASETS.map((d) => ({ key: d.key, label: d.label }))}
        targets={targets}
        actor={adminCodeOf(instructor)}
        isNirvana={assignment.shareToken === 'nirvana-dataset'}
      />
    </div>
  );
}
