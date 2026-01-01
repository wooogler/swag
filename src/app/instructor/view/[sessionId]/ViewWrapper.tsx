'use client';

import Link from 'next/link';
import dynamic from 'next/dynamic';

const ViewClient = dynamic(() => import('./ViewClient'), {
  ssr: false,
});

interface ViewWrapperProps {
  session: {
    id: string;
    studentName: string;
    studentEmail: string;
    startedAt: Date;
    lastSavedAt: Date | null;
  };
  assignment: {
    id: string;
    title: string;
  };
  stats: {
    totalEditorEvents: number;
    externalPasteAttempts: number;
    internalPastes: number;
    totalConversations: number;
    totalChatMessages: number;
    userMessages: number;
    assistantMessages: number;
    timeSpent: number;
    wordCount: number;
  };
  latestSnapshot: any;
}

export default function ViewWrapper({ session, assignment, stats, latestSnapshot }: ViewWrapperProps) {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                href={`/instructor/assignments/${assignment.id}`}
                className="text-gray-600 hover:text-gray-900"
              >
                ← Back
              </Link>
              <div>
                <h1 className="text-xl font-bold text-gray-900">
                  {session.studentName}'s Submission
                </h1>
                <p className="text-sm text-gray-600">
                  {assignment.title} • {session.studentEmail}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href={`/instructor/replay/${session.id}`}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm font-medium"
              >
                View Replay
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Stats Section */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Overview Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {/* Time Spent */}
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-sm text-gray-600 mb-1">Time Spent</div>
            <div className="text-2xl font-bold text-gray-900">
              {Math.floor(stats.timeSpent / (1000 * 60))}m {Math.floor((stats.timeSpent % (1000 * 60)) / 1000)}s
            </div>
            <div className="text-xs text-gray-500 mt-1">
              Started: {session.startedAt.toLocaleString()}
            </div>
          </div>

          {/* Word Count */}
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-sm text-gray-600 mb-1">Word Count</div>
            <div className="text-2xl font-bold text-gray-900">
              {stats.wordCount}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              Total words in final document
            </div>
          </div>

          {/* Chat Messages */}
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-sm text-gray-600 mb-1">Chat Messages</div>
            <div className="text-2xl font-bold text-gray-900">
              {stats.totalChatMessages}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {stats.userMessages} student, {stats.assistantMessages} AI
            </div>
          </div>

          {/* Conversations */}
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-sm text-gray-600 mb-1">Conversations</div>
            <div className="text-2xl font-bold text-gray-900">
              {stats.totalConversations}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              Chat threads created
            </div>
          </div>
        </div>

        {/* Editor Stats */}
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-3">Editor Activity</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-sm text-gray-600 mb-1">Total Editor Events</div>
              <div className="text-xl font-bold text-gray-900">
                {stats.totalEditorEvents}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                All editing actions
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-sm text-gray-600 mb-1">Internal Pastes</div>
              <div className="text-xl font-bold text-green-600">
                {stats.internalPastes}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                From AI assistant
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-sm text-gray-600 mb-1">External Paste Attempts</div>
              <div className="text-xl font-bold text-red-600">
                {stats.externalPasteAttempts}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                Blocked attempts
              </div>
            </div>
          </div>
        </div>

        {/* Chat Stats */}
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-3">Chat Activity</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-sm text-gray-600 mb-1">Student Messages</div>
              <div className="text-xl font-bold text-blue-600">
                {stats.userMessages}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                Questions asked
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-sm text-gray-600 mb-1">AI Responses</div>
              <div className="text-xl font-bold text-purple-600">
                {stats.assistantMessages}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                Assistance provided
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-sm text-gray-600 mb-1">Last Saved</div>
              <div className="text-sm font-bold text-gray-900">
                {session.lastSavedAt ? session.lastSavedAt.toLocaleString() : 'Never'}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                Auto-saved timestamp
              </div>
            </div>
          </div>
        </div>

        {/* Final Document */}
        <ViewClient
          finalDocument={latestSnapshot?.eventData || [{ type: 'paragraph', content: [] }]}
        />
      </div>
    </div>
  );
}
