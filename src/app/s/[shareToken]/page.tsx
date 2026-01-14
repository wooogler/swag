import { db } from '@/db/db';
import { assignments } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import AccessForm from '@/components/student/AccessForm';

interface PageProps {
  params: Promise<{ shareToken: string }>;
}

export default async function AssignmentAccessPage({ params }: PageProps) {
  const { shareToken } = await params;

  // Fetch assignment by share token
  const assignment = await db.query.assignments.findFirst({
    where: eq(assignments.shareToken, shareToken),
  });

  if (!assignment) {
    notFound();
  }

  // Calculate time remaining
  const now = Date.now();
  const timeRemaining = assignment.deadline.getTime() - now;
  const isExpired = timeRemaining <= 0;
  const daysRemaining = Math.floor(timeRemaining / (1000 * 60 * 60 * 24));
  const hoursRemaining = Math.floor((timeRemaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

  // If deadline has passed, show expired message
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
              The deadline for this assignment has passed. New submissions are no longer accepted.
            </p>
            <p className="text-sm text-gray-500 mt-4">
              If you believe this is an error, please contact your instructor.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-2xl w-full bg-white rounded-lg shadow-lg p-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            {assignment.title}
          </h1>
          <div className="flex items-center gap-4 text-sm text-gray-600">
            <span>Due: {assignment.deadline.toLocaleDateString()}</span>
            <span className="text-blue-600 font-medium">
              {daysRemaining > 0
                ? `${daysRemaining} days ${hoursRemaining} hours remaining`
                : hoursRemaining > 0
                ? `${hoursRemaining} hours remaining`
                : 'Due soon'}
            </span>
          </div>
        </div>

        <div className="mb-8 bg-gray-50 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">
            Instructions
          </h2>
          <div className="text-gray-700 whitespace-pre-wrap">
            {assignment.instructions}
          </div>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Enter Your Information
          </h2>
          <AccessForm assignmentId={assignment.id} shareToken={shareToken} />
        </div>
      </div>
    </div>
  );
}
