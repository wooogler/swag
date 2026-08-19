import { db } from '@/db/db';
import { studentSessions, assignments, editorEvents, chatConversations, chatMessages } from '@/db/schema';
import { eq, and, asc, inArray } from 'drizzle-orm';
import { redirect, notFound } from 'next/navigation';
import ViewWrapper from './ViewWrapper';
import { getInstructor, isAdministrator } from '@/lib/auth';
import { getCurrentStudyParticipant } from '@/lib/study/session';

type PasteSourceArea = 'chat' | 'editor' | 'instruction' | 'external' | 'unknown';
type PasteTargetArea = 'editor' | 'chat';

interface PageProps {
  params: Promise<{ sessionId: string }>;
}

export default async function ViewPage({ params }: PageProps) {
  const { sessionId } = await params;
  const instructor = await getInstructor();

  if (!instructor) {
    redirect('/login');
  }

  // Another student's writing session, end to end. Not their material and not
  // in the protocol.
  // A study participant holds an instructor session — that is how the study
  // signs them in — so every /instructor route is reachable by typing it, and
  // the ones that are not their workspace have to say no themselves. Removing
  // the header links only stopped the wandering; this stops the arriving.
  const studyParticipant = await getCurrentStudyParticipant();
  if (studyParticipant) {
    redirect('/study/session');
  }

  // Get student session
  const session = await db.query.studentSessions.findFirst({
    where: eq(studentSessions.id, sessionId),
  });

  if (!session) {
    notFound();
  }

  // Verify instructor can access this assignment
  const assignment = await db.query.assignments.findFirst({
    where: isAdministrator(instructor)
      ? eq(assignments.id, session.assignmentId)
      : and(
          eq(assignments.id, session.assignmentId),
          eq(assignments.instructorId, instructor.id)
        ),
  });

  if (!assignment) {
    notFound();
  }

  // Parallelize independent queries: events + conversations
  const [events, conversations] = await Promise.all([
    db
      .select()
      .from(editorEvents)
      .where(eq(editorEvents.sessionId, sessionId))
      .orderBy(asc(editorEvents.timestamp), asc(editorEvents.sequenceNumber), asc(editorEvents.id)),
    db
      .select()
      .from(chatConversations)
      .where(eq(chatConversations.sessionId, sessionId))
      .orderBy(asc(chatConversations.createdAt)),
  ]);

  // Single query for all messages using IN clause instead of N+1
  const conversationIds = conversations.map(c => c.id);
  const allMsgs = conversationIds.length > 0
    ? await db
        .select()
        .from(chatMessages)
        .where(inArray(chatMessages.conversationId, conversationIds))
        .orderBy(asc(chatMessages.timestamp))
    : [];

  const flatMessages = allMsgs;

  const snapshots = events.filter(e => e.eventType === 'snapshot');
  const submissions = events.filter(e => e.eventType === 'submission');
  const latestSnapshot = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
  const latestSubmission = submissions.length > 0 ? submissions[submissions.length - 1] : null;

  // Calculate statistics
  const totalEditorEvents = events.filter(
    (e) =>
      e.eventType !== 'typing_op' &&
      e.eventType !== 'editor_selection' &&
      e.eventType !== 'chat_input' &&
      e.eventType !== 'chat_web_search_toggle'
  ).length;
  const externalPasteAttempts = events.filter(e => e.eventType === 'paste_external').length;
  const internalPastes = events.filter(e => e.eventType === 'paste_internal').length;

  const normalizePasteSource = (
    sourceArea: unknown,
    fallbackForLegacyEvent: PasteSourceArea
  ): PasteSourceArea => {
    if (
      sourceArea === 'chat' ||
      sourceArea === 'editor' ||
      sourceArea === 'instruction' ||
      sourceArea === 'external' ||
      sourceArea === 'unknown'
    ) {
      return sourceArea;
    }
    return fallbackForLegacyEvent;
  };

  const normalizePasteTarget = (targetArea: unknown): PasteTargetArea => {
    return targetArea === 'chat' ? 'chat' : 'editor';
  };

  const pasteRouteCounts = new Map<string, { sourceArea: PasteSourceArea; targetArea: PasteTargetArea; count: number }>();
  events
    .filter((event) => event.eventType === 'paste_internal' || event.eventType === 'paste_external')
    .forEach((event) => {
      const eventData = (event.eventData || {}) as { sourceArea?: unknown; targetArea?: unknown };
      const sourceArea = normalizePasteSource(
        eventData.sourceArea,
        event.eventType === 'paste_external' ? 'external' : 'unknown'
      );
      const targetArea = normalizePasteTarget(eventData.targetArea);
      const key = `${sourceArea}->${targetArea}`;
      const existing = pasteRouteCounts.get(key);

      if (existing) {
        existing.count += 1;
      } else {
        pasteRouteCounts.set(key, { sourceArea, targetArea, count: 1 });
      }
    });

  const pasteRoutes = Array.from(pasteRouteCounts.values()).sort((a, b) => b.count - a.count);

  const totalChatMessages = flatMessages.length;
  const userMessages = flatMessages.filter(m => m.role === 'user').length;
  const assistantMessages = flatMessages.filter(m => m.role === 'assistant').length;

  // Calculate active typing time based on snapshot gaps
  const TYPING_GAP_THRESHOLD = 2 * 60 * 1000; // 2 minutes
  const snapshotTimes = snapshots
    .map(e => e.timestamp.getTime())
    .sort((a, b) => a - b);

  let timeSpent = 0;
  for (let i = 1; i < snapshotTimes.length; i++) {
    const gap = snapshotTimes[i] - snapshotTimes[i - 1];
    timeSpent += Math.min(gap, TYPING_GAP_THRESHOLD);
  }

  // Calculate word count from final document
  const finalDocument = (latestSubmission?.eventData || latestSnapshot?.eventData) as Record<string, unknown>[] | undefined;
  const wordCount = finalDocument
    ? JSON.stringify(finalDocument)
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .split(/\s+/)
      .filter(word => word.length > 0).length
    : 0;

  const stats = {
    totalEditorEvents,
    externalPasteAttempts,
    internalPastes,
    totalConversations: conversations.length,
    totalChatMessages,
    userMessages,
    assistantMessages,
    timeSpent,
    wordCount,
  };

  return (
    <ViewWrapper
      session={session}
      assignment={assignment}
      stats={stats}
      pasteRoutes={pasteRoutes}
      userInputs={flatMessages
        .filter((m) => m.role === 'user')
        .map((m) => ({ content: m.content, timestamp: m.timestamp }))}
      events={events.map((event) => ({
        ...event,
        eventData: event.eventData as unknown,
      }))}
      latestSnapshot={latestSnapshot ? { ...latestSnapshot, eventData: latestSnapshot.eventData as Record<string, unknown>[] } : null}
      submissions={submissions.map(s => ({ ...s, eventData: s.eventData as Record<string, unknown>[] }))}
      latestSubmission={latestSubmission ? { ...latestSubmission, eventData: latestSubmission.eventData as Record<string, unknown>[] } : null}
    />
  );
}
