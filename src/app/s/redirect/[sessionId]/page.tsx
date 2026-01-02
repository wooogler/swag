import { db } from '@/db/db';
import { studentSessions, assignments } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';

interface PageProps {
  params: Promise<{ sessionId: string }>;
}

export default async function RedirectPage({ params }: PageProps) {
  const { sessionId } = await params;

  // Get session and assignment info
  const session = await db.query.studentSessions.findFirst({
    where: eq(studentSessions.id, sessionId),
  });

  if (!session) {
    redirect('/');
  }

  const assignment = await db.query.assignments.findFirst({
    where: eq(assignments.id, session.assignmentId),
  });

  if (!assignment) {
    redirect('/');
  }

  // Redirect to editor
  redirect(`/s/${assignment.shareToken}/editor/${sessionId}`);
}

