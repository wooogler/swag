import { db } from '@/db/db';
import { assignments, instructors, studentSessions } from '@/db/schema';
import { eq, desc, count } from 'drizzle-orm';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import CopyLinkButton from '@/components/instructor/CopyLinkButton';

async function getInstructor() {
  const cookieStore = await cookies();
  const userId = cookieStore.get('user_session')?.value;

  if (!userId) {
    return null;
  }

  const user = await db.query.instructors.findFirst({
    where: eq(instructors.id, userId),
  });

  if (!user || user.role !== 'instructor') {
    return null;
  }

  return user;
}

export default async function DashboardPage() {
  const instructor = await getInstructor();

  if (!instructor) {
    redirect('/login');
  }

  const requestHeaders = await headers();
  const forwardedProto = requestHeaders.get('x-forwarded-proto') ?? 'http';
  const forwardedHost = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host');
  const baseUrl = forwardedHost
    ? `${forwardedProto}://${forwardedHost}`
    : (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000');

  // Get instructor's assignments with student counts
  const instructorAssignments = await db
    .select({
      id: assignments.id,
      title: assignments.title,
      deadline: assignments.deadline,
      shareToken: assignments.shareToken,
      createdAt: assignments.createdAt,
    })
    .from(assignments)
    .where(eq(assignments.instructorId, instructor.id))
    .orderBy(desc(assignments.createdAt));

  // Get student counts for each assignment
  const assignmentWithCounts = await Promise.all(
    instructorAssignments.map(async (assignment) => {
      const [result] = await db
        .select({ count: count() })
        .from(studentSessions)
        .where(eq(studentSessions.assignmentId, assignment.id));

      return {
        ...assignment,
        studentCount: result?.count || 0,
      };
    })
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">SWAG</h1>
              <p className="text-sm text-gray-600">Instructor Dashboard</p>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-600">{instructor.email}</span>
              <Link
                href="/instructor/settings"
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

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Create Assignment Button */}
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold text-gray-900">Your Assignments</h2>
          <Link
            href="/instructor/assignments/new"
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
          >
            + New Assignment
          </Link>
        </div>

        {/* Assignments List */}
        {assignmentWithCounts.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
            <p className="text-gray-500">No assignments yet</p>
            <p className="text-sm text-gray-400 mt-1">
              Create your first assignment to get started
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
                    Students
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Share Link
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {assignmentWithCounts.map((assignment) => {
                  const isOverdue = new Date(assignment.deadline) < new Date();
                  const shareUrl = `${baseUrl}/s/${assignment.shareToken}`;

                  return (
                    <tr key={assignment.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">
                          {assignment.title}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className={`text-sm ${isOverdue ? 'text-red-600' : 'text-gray-600'}`}>
                          {new Date(assignment.deadline).toLocaleDateString()}
                          {isOverdue && <span className="ml-2 text-xs">(Overdue)</span>}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">
                          {assignment.studentCount} student{assignment.studentCount !== 1 ? 's' : ''}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <CopyLinkButton url={shareUrl} />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                        <Link
                          href={`/instructor/assignments/${assignment.id}`}
                          className="text-blue-600 hover:text-blue-800 mr-4"
                        >
                          View
                        </Link>
                        <Link
                          href={`/instructor/assignments/${assignment.id}/edit`}
                          className="text-gray-600 hover:text-gray-800"
                        >
                          Edit
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
