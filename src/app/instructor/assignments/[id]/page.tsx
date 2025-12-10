import { db } from '@/db/db';
import { assignments, instructors, studentSessions, editorEvents } from '@/db/schema';
import { eq, desc, count, and } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import DeleteAssignmentButton from './DeleteAssignmentButton';
import CopyLinkButton from '@/components/instructor/CopyLinkButton';

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
  params: Promise<{ id: string }>;
}

export default async function AssignmentDetailPage({ params }: PageProps) {
  const { id } = await params;
  const instructor = await getInstructor();

  if (!instructor) {
    redirect('/instructor/login');
  }

  // Get assignment
  const assignment = await db.query.assignments.findFirst({
    where: and(
      eq(assignments.id, id),
      eq(assignments.instructorId, instructor.id)
    ),
  });

  if (!assignment) {
    notFound();
  }

  // Get students with their event statistics
  const students = await db
    .select({
      id: studentSessions.id,
      studentName: studentSessions.studentName,
      studentEmail: studentSessions.studentEmail,
      startedAt: studentSessions.startedAt,
      lastSavedAt: studentSessions.lastSavedAt,
    })
    .from(studentSessions)
    .where(eq(studentSessions.assignmentId, id))
    .orderBy(desc(studentSessions.startedAt));

  // Get event statistics for each student
  const studentsWithStats = await Promise.all(
    students.map(async (student) => {
      // Count events by type
      const eventCounts = await db
        .select({
          eventType: editorEvents.eventType,
          count: count(),
        })
        .from(editorEvents)
        .where(eq(editorEvents.sessionId, student.id))
        .groupBy(editorEvents.eventType);

      const stats = {
        transactionSteps: 0,
        pasteInternal: 0,
        pasteExternal: 0,
        snapshots: 0,
      };

      eventCounts.forEach(({ eventType, count: c }) => {
        if (eventType === 'transaction_step') stats.transactionSteps = c;
        else if (eventType === 'paste_internal') stats.pasteInternal = c;
        else if (eventType === 'paste_external') stats.pasteExternal = c;
        else if (eventType === 'snapshot') stats.snapshots = c;
      });

      return { ...student, stats };
    })
  );

  const shareUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/s/${assignment.shareToken}`;
  const isOverdue = new Date(assignment.deadline) < new Date();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-4">
            <Link
              href="/instructor/dashboard"
              className="text-gray-600 hover:text-gray-900"
            >
              ← Back
            </Link>
            <div className="flex-1">
              <h1 className="text-xl font-bold text-gray-900">{assignment.title}</h1>
              <p className={`text-sm ${isOverdue ? 'text-red-600' : 'text-gray-600'}`}>
                Deadline: {new Date(assignment.deadline).toLocaleString()}
                {isOverdue && ' (Overdue)'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href={`/instructor/assignments/${id}/edit`}
                className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Edit
              </Link>
              <DeleteAssignmentButton assignmentId={id} />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Assignment Info */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Assignment Details</h2>

          <div className="grid grid-cols-2 gap-6">
            <div>
              <h3 className="text-sm font-medium text-gray-500 mb-1">Share Link</h3>
              <div className="flex items-center gap-2">
                <code className="text-sm bg-gray-100 px-2 py-1 rounded">{shareUrl}</code>
                <CopyLinkButton url={shareUrl} />
              </div>
            </div>
            <div>
              <h3 className="text-sm font-medium text-gray-500 mb-1">Students</h3>
              <p className="text-gray-900">{studentsWithStats.length} student{studentsWithStats.length !== 1 ? 's' : ''}</p>
            </div>
          </div>

          <div className="mt-6">
            <h3 className="text-sm font-medium text-gray-500 mb-1">Instructions</h3>
            <p className="text-gray-900 whitespace-pre-wrap">{assignment.instructions}</p>
          </div>

          {assignment.customSystemPrompt && (
            <div className="mt-6">
              <h3 className="text-sm font-medium text-gray-500 mb-1">Custom System Prompt</h3>
              <p className="text-gray-700 bg-gray-50 p-3 rounded text-sm">{assignment.customSystemPrompt}</p>
            </div>
          )}
        </div>

        {/* Students Table */}
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Student Progress</h2>
          </div>

          {studentsWithStats.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-gray-500">No students have started yet</p>
            </div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Student
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Started
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Last Active
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Typing Events
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Pastes
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {studentsWithStats.map((student) => (
                  <tr key={student.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">{student.studentName}</div>
                      <div className="text-sm text-gray-500">{student.studentEmail}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {new Date(student.startedAt).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {student.lastSavedAt
                        ? new Date(student.lastSavedAt).toLocaleString()
                        : '-'
                      }
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {student.stats.transactionSteps}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-green-600">
                          {student.stats.pasteInternal} internal
                        </span>
                        {student.stats.pasteExternal > 0 && (
                          <span className="text-sm text-red-600 font-medium">
                            {student.stats.pasteExternal} external
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                      <Link
                        href={`/instructor/replay/${student.id}`}
                        className="text-blue-600 hover:text-blue-800"
                      >
                        Replay
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </div>
  );
}
