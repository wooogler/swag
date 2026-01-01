import { db } from '@/db/db';
import { assignments, studentSessions } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import EditorClient from '@/components/editor/EditorClient';

interface EditorPageProps {
  params: Promise<{ shareToken: string; sessionId: string }>;
}

export default async function EditorPage({ params }: EditorPageProps) {
  const { shareToken, sessionId } = await params;

  // Fetch assignment
  const assignment = await db.query.assignments.findFirst({
    where: eq(assignments.shareToken, shareToken),
  });

  if (!assignment) {
    notFound();
  }

  // Fetch the specific student session
  const session = await db.query.studentSessions.findFirst({
    where: and(
      eq(studentSessions.id, sessionId),
      eq(studentSessions.assignmentId, assignment.id)
    ),
  });

  // If session doesn't exist or doesn't belong to this assignment, show 404
  if (!session) {
    notFound();
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
