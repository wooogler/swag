import { db } from '@/db/db';
import { assignments, instructors, studentSessions } from '@/db/schema';
import { eq, desc, count, sql } from 'drizzle-orm';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import CopyLinkButton from '@/components/instructor/CopyLinkButton';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import EmptyStateCard from '@/components/ui/EmptyStateCard';
import InstructorHeaderActions from '@/components/instructor/InstructorHeaderActions';
import { Plus, Users, Calendar, Edit2 } from 'lucide-react';
import { getInstructor, isAdministrator } from '@/lib/auth';
import { getCurrentStudyParticipant } from '@/lib/study/session';

export default async function DashboardPage() {
  const instructor = await getInstructor();

  if (!instructor) {
    redirect('/login');
  }

  // A study participant never belongs on the dashboard: it lists BOTH of their
  // clones at once, which would hand them the second block's material before
  // its tutorial, plus New Assignment / share-link controls that are not part
  // of the study. Their home is the phase-gated session page.
  const studyParticipant = await getCurrentStudyParticipant();
  if (studyParticipant) {
    redirect('/study/session');
  }

  const isAdmin = isAdministrator(instructor);
  const assignmentsQuery = db
    .select({
      id: assignments.id,
      title: assignments.title,
      deadline: assignments.deadline,
      shareToken: assignments.shareToken,
      instructorId: assignments.instructorId,
      createdAt: assignments.createdAt,
      ownerEmail: instructors.email,
      ownerFirstName: instructors.firstName,
      ownerLastName: instructors.lastName,
    })
    .from(assignments)
    .leftJoin(instructors, eq(assignments.instructorId, instructors.id));

  // Parallelize independent queries
  const [requestHeaders, instructorAssignments] = await Promise.all([
    headers(),
    isAdmin
      ? assignmentsQuery.orderBy(desc(assignments.createdAt))
      : assignmentsQuery
          .where(eq(assignments.instructorId, instructor.id))
          .orderBy(desc(assignments.createdAt)),
  ]);

  const forwardedProto = requestHeaders.get('x-forwarded-proto') ?? 'http';
  const forwardedHost = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host');
  const baseUrl = forwardedHost
    ? `${forwardedProto}://${forwardedHost}`
    : (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3030');

  // Single aggregate query instead of N+1
  const assignmentIds = instructorAssignments.map(a => a.id);
  const studentCounts = assignmentIds.length > 0
    ? await db
        .select({
          assignmentId: studentSessions.assignmentId,
          count: count(),
        })
        .from(studentSessions)
        .where(sql`${studentSessions.assignmentId} IN ${assignmentIds}`)
        .groupBy(studentSessions.assignmentId)
    : [];

  const countMap = new Map(studentCounts.map(sc => [sc.assignmentId, sc.count]));
  const assignmentWithCounts = instructorAssignments.map(assignment => ({
    ...assignment,
    studentCount: countMap.get(assignment.id) || 0,
    ownerName: [assignment.ownerFirstName, assignment.ownerLastName].filter(Boolean).join(' ') || assignment.ownerEmail || 'Unknown',
    canEdit: assignment.instructorId === instructor.id,
  }));

  return (
    <div className="min-h-screen bg-[hsl(var(--background))]">
      {/* Header */}
      <header className="bg-[hsl(var(--card))] border-b border-[hsl(var(--border))]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold font-heading text-[hsl(var(--foreground))]">SWAG</h1>
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                {isAdmin ? 'Administrator Dashboard' : 'Instructor Dashboard'}
              </p>
            </div>
            <InstructorHeaderActions
              email={instructor.email}
            />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Create Assignment Button */}
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-semibold font-heading text-[hsl(var(--foreground))]">
            {isAdmin ? 'All Assignments' : 'Your Assignments'}
          </h2>
          <Link href="/instructor/assignments/new">
            <Button className="font-medium gap-2">
              <Plus className="w-4 h-4" />
              New Assignment
            </Button>
          </Link>
        </div>

        {/* Assignments List */}
        {assignmentWithCounts.length === 0 ? (
          <EmptyStateCard
            minHeightClass="min-h-[320px]"
            icon={<Calendar className="w-8 h-8 text-[hsl(var(--muted-foreground))]" />}
            title="No assignments yet"
            description="Create your first assignment to verify student essays."
            descriptionClassName="max-w-sm"
            action={(
              <Link href="/instructor/assignments/new">
                <Button>Create Assignment</Button>
              </Link>
            )}
          />
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-[hsl(var(--border))]">
                <thead className="bg-[hsl(var(--muted))]/50">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wider">
                      Title
                    </th>
                    {!studyParticipant && (
                      <th className="px-6 py-4 text-left text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wider">
                        Deadline
                      </th>
                    )}
                    <th className="px-6 py-4 text-left text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wider">
                      Students
                    </th>
                    {isAdmin && (
                      <th className="px-6 py-4 text-left text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wider">
                        Instructor
                      </th>
                    )}
                    <th className="px-6 py-4 text-left text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wider">
                      Share Link
                    </th>
                    <th className="px-6 py-4 text-right text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-[hsl(var(--card))] divide-y divide-[hsl(var(--border))]">
                  {assignmentWithCounts.map((assignment) => {
                    const isOverdue = new Date(assignment.deadline) < new Date();
                    const shareUrl = `${baseUrl}/s/${assignment.shareToken}`;

                    return (
                      <tr key={assignment.id} className="hover:bg-[hsl(var(--muted))]/30 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <Link
                            href={`/instructor/assignments/${assignment.id}`}
                            className="text-sm font-medium text-[hsl(var(--foreground))] hover:text-[hsl(var(--primary))] hover:underline decoration-2 underline-offset-4 transition-colors block"
                          >
                            {assignment.title}
                          </Link>
                        </td>
                        {!studyParticipant && (
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className={`text-sm ${isOverdue ? 'text-[hsl(var(--destructive))]' : 'text-[hsl(var(--muted-foreground))]'}`}>
                              {new Date(assignment.deadline).toLocaleDateString()}
                              {isOverdue && <span className="ml-2 text-xs font-medium">(Overdue)</span>}
                            </div>
                          </td>
                        )}
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-2 text-sm text-[hsl(var(--foreground))]">
                            <Users className="w-4 h-4 text-[hsl(var(--muted-foreground))]" />
                            {assignment.studentCount}
                          </div>
                        </td>
                        {isAdmin && (
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-[hsl(var(--muted-foreground))]">
                            {assignment.ownerName}
                          </td>
                        )}
                        <td className="px-6 py-4 whitespace-nowrap">
                          <CopyLinkButton url={shareUrl} iconOnly={false} />
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                          <div className="flex items-center justify-end gap-2">
                            {assignment.canEdit && (
                              <Link href={`/instructor/assignments/${assignment.id}/edit`} title="Edit Assignment">
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]">
                                  <Edit2 className="w-4 h-4" />
                                </Button>
                              </Link>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </main>
    </div>
  );
}
