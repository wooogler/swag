import { db } from '@/db/db';
import { assignments, studentSessions, editorEvents, chatConversations, chatMessages } from '@/db/schema';
import { eq, count, and, inArray } from 'drizzle-orm';
import { headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ChevronLeft, Edit2, BarChart3, FileText } from 'lucide-react';
import AssignmentTabs from './AssignmentTabs';
import { getInstructor, isAdministrator } from '@/lib/auth';
import { getCurrentStudyParticipant } from '@/lib/study/session';
import { getParticipantClones } from '@/lib/study/store';
import { STUDY_DATASETS } from '@/lib/study/config';
import InstructorHeaderActions from '@/components/instructor/InstructorHeaderActions';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AssignmentDetailPage({ params }: PageProps) {
  const { id } = await params;
  const instructor = await getInstructor();

  if (!instructor) {
    redirect('/login');
  }

  // Study participants shouldn't see the (inherited master) deadline. The
  // per-dataset Reset control is gone from their header: resetting mid-session
  // discards the block being measured, so it belongs to the facilitator console.
  const studyParticipant = await getCurrentStudyParticipant();
  if (studyParticipant) {
    const clones = await getParticipantClones(studyParticipant.id);
    if (!clones.some((c) => c.assignmentId === id)) {
      redirect('/study/session');
    }
  }

  const assignmentWhere = isAdministrator(instructor)
    ? eq(assignments.id, id)
    : and(
        eq(assignments.id, id),
        eq(assignments.instructorId, instructor.id)
      );

  // Parallelize independent queries
  const [requestHeaders, assignment, students] = await Promise.all([
    headers(),
    db.query.assignments.findFirst({
      where: assignmentWhere,
    }),
    db
      .select({
        id: studentSessions.id,
        participantToken: studentSessions.participantToken,
        startedAt: studentSessions.startedAt,
        lastSavedAt: studentSessions.lastSavedAt,
      })
      .from(studentSessions)
      .where(eq(studentSessions.assignmentId, id))
      .orderBy(studentSessions.participantToken),
  ]);

  if (!assignment) {
    notFound();
  }

  const forwardedProto = requestHeaders.get('x-forwarded-proto') ?? 'http';
  const forwardedHost = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host');
  const baseUrl = forwardedHost
    ? `${forwardedProto}://${forwardedHost}`
    : (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3030');

  // Single aggregate query for all students' event counts instead of N+1
  const studentIds = students.map(s => s.id);
  const [allEventCounts, gptInquiryCounts] = studentIds.length > 0
    ? await Promise.all([
        db
          .select({
            sessionId: editorEvents.sessionId,
            eventType: editorEvents.eventType,
            count: count(),
          })
          .from(editorEvents)
          .where(inArray(editorEvents.sessionId, studentIds))
          .groupBy(editorEvents.sessionId, editorEvents.eventType),
        db
          .select({
            sessionId: chatConversations.sessionId,
            count: count(),
          })
          .from(chatMessages)
          .innerJoin(chatConversations, eq(chatMessages.conversationId, chatConversations.id))
          .where(
            and(
              inArray(chatConversations.sessionId, studentIds),
              eq(chatMessages.role, 'user')
            )
          )
          .groupBy(chatConversations.sessionId),
      ])
    : [[], []];

  // Build a map: sessionId -> stats
  const statsMap = new Map<string, { submissions: number; pasteInternal: number; pasteExternal: number; snapshots: number; gptInquiries: number }>();
  for (const { sessionId, eventType, count: c } of allEventCounts) {
    if (!statsMap.has(sessionId)) {
      statsMap.set(sessionId, { submissions: 0, pasteInternal: 0, pasteExternal: 0, snapshots: 0, gptInquiries: 0 });
    }
    const stats = statsMap.get(sessionId)!;
    if (eventType === 'submission') stats.submissions = c;
    else if (eventType === 'paste_internal') stats.pasteInternal = c;
    else if (eventType === 'paste_external') stats.pasteExternal = c;
    else if (eventType === 'snapshot') stats.snapshots = c;
  }
  for (const { sessionId, count: c } of gptInquiryCounts) {
    if (!statsMap.has(sessionId)) {
      statsMap.set(sessionId, { submissions: 0, pasteInternal: 0, pasteExternal: 0, snapshots: 0, gptInquiries: 0 });
    }
    statsMap.get(sessionId)!.gptInquiries = c;
  }

  const studentsWithStats = students.map(student => ({
    ...student,
    stats: statsMap.get(student.id) || { submissions: 0, pasteInternal: 0, pasteExternal: 0, snapshots: 0, gptInquiries: 0 },
  }));

  const shareUrl = `${baseUrl}/s/${assignment.shareToken}`;
  const isOverdue = new Date(assignment.deadline) < new Date();
  const canEdit = assignment.instructorId === instructor.id;
  const normalizedAssignment = {
    ...assignment,
    includeInstructionInPrompt: assignment.includeInstructionInPrompt ?? false,
  };

  return (
    <div className="min-h-screen bg-[hsl(var(--background))]">
      {/* Header */}
      <header className="bg-[hsl(var(--card))] border-b border-[hsl(var(--border))] sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-4">
            <Link href="/instructor/dashboard">
              <Button variant="ghost" size="icon" className="hover:bg-[hsl(var(--muted))]">
                <ChevronLeft className="w-5 h-5 text-[hsl(var(--muted-foreground))]" />
              </Button>
            </Link>
            <div className="flex-1">
              <h1 className="text-xl font-bold font-heading text-[hsl(var(--foreground))]">{assignment.title}</h1>
              {!studyParticipant && (
                <p className={`text-sm ${isOverdue ? 'text-[hsl(var(--destructive))]' : 'text-[hsl(var(--muted-foreground))]'}`}>
                  Deadline: {new Date(assignment.deadline).toLocaleString()}
                  {isOverdue && ' (Overdue)'}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {/* PHASE 2: a participant gets ONE neutrally-named door — naming
                  the two conditions, or offering both, tells them which tool is
                  the researchers' and invites comparison the design measures
                  another way. Administrators keep both preview buttons. */}
              {studyParticipant ? (
                <Link href={`/instructor/assignments/${id}/score`}>
                  <Button variant="outline">
                    <BarChart3 className="w-4 h-4 mr-2" />
                    Chatbot Studio
                  </Button>
                </Link>
              ) : (
                <>
                  <Link href={`/instructor/assignments/${id}/score?view=score`}>
                    <Button variant="outline">
                      <BarChart3 className="w-4 h-4 mr-2" />
                      SCORE
                    </Button>
                  </Link>
                  <Link href={`/instructor/assignments/${id}/score?view=baseline`}>
                    <Button variant="outline">
                      <FileText className="w-4 h-4 mr-2" />
                      Baseline
                    </Button>
                  </Link>
                </>
              )}
              {canEdit && (
                <Link href={`/instructor/assignments/${id}/edit`}>
                  <Button variant="outline">
                    <Edit2 className="w-4 h-4 mr-2" />
                    Edit
                  </Button>
                </Link>
              )}
              <InstructorHeaderActions email={instructor.email} />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <AssignmentTabs
          assignment={normalizedAssignment}
          students={studentsWithStats}
          shareUrl={shareUrl}
        />
      </main>
    </div>
  );
}
