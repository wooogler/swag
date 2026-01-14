import { db } from '@/db/db';
import { assignments, instructors, studentSessions, editorEvents } from '@/db/schema';
import { eq, desc, and, sql } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import JoinAssignmentForm from '@/components/student/JoinAssignmentForm';

async function getStudent() {
  const cookieStore = await cookies();
  const userId = cookieStore.get('user_session')?.value;

  if (!userId) {
    return null;
  }

  const user = await db.query.instructors.findFirst({
    where: eq(instructors.id, userId),
  });

  if (!user || user.role !== 'student') {
    return null;
  }

  return user;
}

export default async function StudentDashboardPage() {
  const student = await getStudent();

  if (!student) {
    redirect('/login');
  }

  const sessions = await db
    .select({
      sessionId: studentSessions.id,
      assignmentId: assignments.id,
      title: assignments.title,
      deadline: assignments.deadline,
      shareToken: assignments.shareToken,
      startedAt: studentSessions.startedAt,
      lastLoginAt: studentSessions.lastLoginAt,
    })
    .from(studentSessions)
    .innerJoin(assignments, eq(studentSessions.assignmentId, assignments.id))
    .where(eq(studentSessions.userId, student.id))
    .orderBy(desc(studentSessions.startedAt));

  const sessionsWithActivity = await Promise.all(
    sessions.map(async (session) => {
      const [result] = await db
        .select({
          lastSubmissionAt: sql`max(${editorEvents.timestamp})`,
        })
        .from(editorEvents)
        .where(and(
          eq(editorEvents.sessionId, session.sessionId),
          eq(editorEvents.eventType, 'submission')
        ));

      return {
        ...session,
        lastSubmissionAt: (result?.lastSubmissionAt as Date | null) ?? null,
      };
    })
  );

  const formatDateTime = (value: Date | null) => {
    if (!value) {
      return '—';
    }
    return new Date(value).toLocaleString();
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">SWAG</h1>
              <p className="text-sm text-gray-600">Student Dashboard</p>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-600">{student.email}</span>
              <Link
                href="/student/settings"
                className="text-sm text-gray-600 hover:text-gray-800"
              >
                Settings
              </Link>
              <form action="/api/auth/logout" method="POST">
                <button
                  type="submit"
                  className="text-sm text-red-600 hover:text-red-800"
                >
                  Logout
                </button>
              </form>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Join a new assignment
          </h2>
          <JoinAssignmentForm />
        </div>

        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-900">Your Assignments</h2>
          </div>

          {sessionsWithActivity.length === 0 ? (
            <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
              <p className="text-gray-500">No assignments yet</p>
              <p className="text-sm text-gray-400 mt-1">
                Join an assignment using a share link above
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Title
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Deadline
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Last Active
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Last Submission
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {sessionsWithActivity.map((session) => (
                    <tr key={session.sessionId} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">
                          {session.title}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {new Date(session.deadline).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {formatDateTime(session.lastLoginAt ?? session.startedAt)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {formatDateTime(session.lastSubmissionAt)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                        <Link
                          href={`/s/${session.shareToken}/editor/${session.sessionId}`}
                          className="text-blue-600 hover:text-blue-800"
                        >
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
