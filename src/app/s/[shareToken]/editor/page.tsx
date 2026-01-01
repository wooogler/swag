import { db } from '@/db/db';
import { assignments, studentSessions } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';
import { notFound, redirect } from 'next/navigation';
import EditorClient from '@/components/editor/EditorClient';

interface EditorPageProps {
  params: Promise<{ shareToken: string }>;
}

export default async function EditorPage({ params }: EditorPageProps) {
  const { shareToken } = await params;

  // Fetch assignment
  const assignment = await db.query.assignments.findFirst({
    where: eq(assignments.shareToken, shareToken),
  });

  if (!assignment) {
    notFound();
  }

  // Find the most recent student session for this assignment
  const session = await db.query.studentSessions.findFirst({
    where: eq(studentSessions.assignmentId, assignment.id),
    orderBy: [desc(studentSessions.startedAt)],
  });

  // If no session exists, redirect to the access page
  if (!session) {
    redirect(`/s/${shareToken}`);
  }

  return (
    <EditorClient
      sessionId={session.id}
      assignmentId={assignment.id}
      assignmentTitle={assignment.title}
      assignmentInstructions={assignment.instructions}
      deadline={assignment.deadline}
    />
  );
}
