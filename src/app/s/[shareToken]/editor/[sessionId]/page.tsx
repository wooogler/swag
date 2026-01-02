import { db } from '@/db/db';
import { assignments, studentSessions } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { notFound, redirect } from 'next/navigation';
import { cookies } from 'next/headers';
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

  // Check if session is verified
  if (!session.isVerified) {
    // Redirect back to access page with error message
    redirect(`/s/${shareToken}?error=not-verified`);
  }

  // Check if user has valid session cookie
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(`student_session_${assignment.id}`);

  if (!sessionCookie || sessionCookie.value !== sessionId) {
    // No valid session cookie - redirect to login
    redirect(`/s/${shareToken}?error=login-required`);
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

