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

  // Check if deadline has passed
  const isExpired = assignment.deadline.getTime() < Date.now();
  if (isExpired) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-2xl w-full bg-white rounded-lg shadow-lg p-8">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              {assignment.title}
            </h1>
            <div className="flex items-center gap-4 text-sm text-gray-600">
              <span>Due: {assignment.deadline.toLocaleDateString()}</span>
            </div>
          </div>

          <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
            <svg className="w-16 h-16 mx-auto text-red-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h2 className="text-xl font-semibold text-red-800 mb-2">
              Submission Closed
            </h2>
            <p className="text-red-600">
              The deadline for this assignment has passed. The editor is no longer available.
            </p>
            <p className="text-sm text-gray-500 mt-4">
              If you believe this is an error, please contact your instructor.
            </p>
          </div>
        </div>
      </div>
    );
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
      allowWebSearch={assignment.allowWebSearch ?? false}
    />
  );
}

