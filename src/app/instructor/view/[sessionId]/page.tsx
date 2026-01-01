import { db } from '@/db/db';
import { studentSessions, assignments, instructors, editorEvents, chatConversations, chatMessages } from '@/db/schema';
import { eq, and, asc } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import ViewWrapper from './ViewWrapper';

async function getInstructor() {
  const cookieStore = await cookies();
  const instructorId = cookieStore.get('instructor_session')?.value;

  if (!instructorId) {
    return null;
  }

  return db.query.instructors.findFirst({
    where: eq(instructors.id, instructorId),
  });
}

interface PageProps {
  params: Promise<{ sessionId: string }>;
}

export default async function ViewPage({ params }: PageProps) {
  const { sessionId } = await params;
  const instructor = await getInstructor();

  if (!instructor) {
    redirect('/instructor/login');
  }

  // Get student session
  const session = await db.query.studentSessions.findFirst({
    where: eq(studentSessions.id, sessionId),
  });

  if (!session) {
    notFound();
  }

  // Verify instructor owns this assignment
  const assignment = await db.query.assignments.findFirst({
    where: and(
      eq(assignments.id, session.assignmentId),
      eq(assignments.instructorId, instructor.id)
    ),
  });

  if (!assignment) {
    notFound();
  }

  // Get latest snapshot for final document
  const events = await db
    .select()
    .from(editorEvents)
    .where(eq(editorEvents.sessionId, sessionId))
    .orderBy(asc(editorEvents.sequenceNumber));

  const snapshots = events.filter(e => e.eventType === 'snapshot');
  const latestSnapshot = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;

  // Get all chat conversations
  const conversations = await db
    .select()
    .from(chatConversations)
    .where(eq(chatConversations.sessionId, sessionId))
    .orderBy(asc(chatConversations.createdAt));

  // Get all messages for all conversations
  const allMessages = await Promise.all(
    conversations.map(async (conv) => {
      const msgs = await db
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.conversationId, conv.id))
        .orderBy(asc(chatMessages.timestamp));
      return msgs;
    })
  );

  const flatMessages = allMessages.flat();

  // Calculate statistics
  const totalEditorEvents = events.length;
  const externalPasteAttempts = events.filter(e => e.eventType === 'paste_external').length;
  const internalPastes = events.filter(e => e.eventType === 'paste_internal').length;

  const totalChatMessages = flatMessages.length;
  const userMessages = flatMessages.filter(m => m.role === 'user').length;
  const assistantMessages = flatMessages.filter(m => m.role === 'assistant').length;

  const timeSpent = session.lastSavedAt
    ? session.lastSavedAt.getTime() - session.startedAt.getTime()
    : 0;

  // Calculate word count from final document
  const wordCount = latestSnapshot?.eventData
    ? JSON.stringify(latestSnapshot.eventData)
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
      latestSnapshot={latestSnapshot}
    />
  );
}
