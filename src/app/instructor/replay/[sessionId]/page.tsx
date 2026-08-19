import { db } from '@/db/db';
import { studentSessions, assignments, editorEvents, chatConversations, chatMessages } from '@/db/schema';
import { eq, and, asc, inArray } from 'drizzle-orm';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ChevronLeft, FileText } from 'lucide-react';
import ReplayClient from './ReplayClient';
import { getInstructor, isAdministrator } from '@/lib/auth';
import { getCurrentStudyParticipant } from '@/lib/study/session';

interface PageProps {
  params: Promise<{ sessionId: string }>;
}

export default async function ReplayPage({ params }: PageProps) {
  const { sessionId } = await params;
  const instructor = await getInstructor();

  if (!instructor) {
    redirect('/login');
  }

  // The keystroke-level replay of a student writing. Same reason as the
  // summary: not their material, not in the protocol.
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

  // Flatten messages with conversation info
  const convTitleMap = new Map(conversations.map(c => [c.id, c.title]));
  const flatMessages = allMsgs.map(msg => ({
    ...msg,
    conversationId: msg.conversationId,
    conversationTitle: convTitleMap.get(msg.conversationId) || 'Chat',
  }));

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
    <div className="h-screen flex flex-col bg-[hsl(var(--background))]">
      {/* Header */}
      <header className="bg-[hsl(var(--background))] border-b border-[hsl(var(--border))] flex-shrink-0">
        <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href={`/instructor/assignments/${assignment.id}`}>
                <Button variant="ghost" size="icon">
                  <ChevronLeft className="w-5 h-5" />
                </Button>
              </Link>
              <div>
                <h1 className="text-lg font-heading font-bold text-[hsl(var(--foreground))]">
                  Replay: {session.participantToken}
                </h1>
                <p className="text-sm text-[hsl(var(--muted-foreground))]">
                  {assignment.title}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-sm text-[hsl(var(--muted-foreground))]">
                Started: {session.startedAt.toLocaleString()}
              </div>
              <Link href={`/instructor/summary/${session.id}`}>
                <Button variant="outline">
                  <FileText className="w-4 h-4 mr-2" />
                  Summary
                </Button>
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
        allowWebSearch={assignment.allowWebSearch ?? false}
      />
    </div>
  );
}
