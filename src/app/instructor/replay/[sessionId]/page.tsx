import { db } from '@/db/db';
import { studentSessions, assignments, instructors, editorEvents, chatConversations, chatMessages } from '@/db/schema';
import { eq, and, asc } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import ReplayClient from './ReplayClient';

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

export default async function ReplayPage({ params }: PageProps) {
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

  // Get all editor events
  const events = await db
    .select()
    .from(editorEvents)
    .where(eq(editorEvents.sessionId, sessionId))
    .orderBy(asc(editorEvents.sequenceNumber));

  // Get all chat conversations and messages
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
      return { conversationId: conv.id, messages: msgs };
    })
  );

  // Flatten messages with conversation info
  const flatMessages = allMessages.flatMap(({ conversationId, messages }) =>
    messages.map((msg) => ({
      ...msg,
      conversationId,
      conversationTitle: conversations.find(c => c.id === conversationId)?.title || 'Chat',
    }))
  );

  // Calculate timeline boundaries (start at first recorded event if available)
  const firstEditorEventTime = events.length > 0
    ? events[0].timestamp.getTime()
    : null;
  const firstChatEventTime = flatMessages.length > 0
    ? flatMessages[0].timestamp.getTime()
    : null;
  const firstEventTime = [firstEditorEventTime, firstChatEventTime]
    .filter((time): time is number => time !== null)
    .sort((a, b) => a - b)[0];

  const startTime = firstEventTime ?? session.startedAt.getTime();
  const endTime = events.length > 0
    ? Math.max(...events.map(e => e.timestamp.getTime()))
    : startTime + 60000; // Default 1 minute if no events

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 flex-shrink-0">
        <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                href={`/instructor/assignments/${assignment.id}`}
                className="text-gray-600 hover:text-gray-900"
              >
                ← Back
              </Link>
              <div>
                <h1 className="text-lg font-bold text-gray-900">
                  Replay: {session.studentName}
                </h1>
                <p className="text-sm text-gray-600">
                  {assignment.title} • {session.studentEmail}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-sm text-gray-500">
                Started: {session.startedAt.toLocaleString()}
              </div>
              <Link
                href={`/instructor/summary/${session.id}`}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm font-medium"
              >
                Summary
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Replay Player */}
      <ReplayClient
        events={events.map(e => ({
          ...e,
          timestamp: e.timestamp.getTime(),
          eventData: e.eventData as Record<string, unknown>,
        }))}
        chatMessages={flatMessages.map(m => ({
          ...m,
          timestamp: m.timestamp.getTime(),
          metadata: m.metadata as Record<string, unknown> | null,
        }))}
        conversations={conversations.map(c => ({
          ...c,
          createdAt: c.createdAt.getTime(),
        }))}
        startTime={startTime}
        endTime={endTime}
      />
    </div>
  );
}
