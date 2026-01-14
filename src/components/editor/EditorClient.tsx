'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import TrackedEditor from './TrackedEditor';
import ChatPanel from '../chat/ChatPanel';
import { useUIStore } from '@/stores/uiStore';
import SubmissionModal from './SubmissionModal';

interface EditorClientProps {
  sessionId: string;
  assignmentId: string;
  assignmentTitle: string;
  assignmentInstructions: string;
  deadline: Date;
  allowWebSearch: boolean;
}

export default function EditorClient({ sessionId, assignmentId, assignmentTitle, assignmentInstructions, deadline, allowWebSearch }: EditorClientProps) {
  const {
    isChatOpen,
    chatWidth,
    isResizing,
    showInstructions,
    saveStatus,
    setChatOpen,
    toggleInstructions,
    setSaveStatus,
    startResize,
    handleResize,
    stopResize,
  } = useUIStore();

  const [submissions, setSubmissions] = useState<Array<{
    id: number;
    eventData: any;
    timestamp: string | Date;
    sequenceNumber: number;
  }>>([]);
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<number | null>(null);
  const [isSubmissionModalOpen, setIsSubmissionModalOpen] = useState(false);

  // Listen for save events
  useEffect(() => {
    const handleSaving = () => {
      setSaveStatus('saving');
    };

    const handleSaved = () => {
      setSaveStatus('saved');
      // Reset to ready after 2 seconds
      setTimeout(() => setSaveStatus('ready'), 2000);
    };

    window.addEventListener('prelude:events-saving', handleSaving);
    window.addEventListener('prelude:events-saved', handleSaved);
    return () => {
      window.removeEventListener('prelude:events-saving', handleSaving);
      window.removeEventListener('prelude:events-saved', handleSaved);
    };
  }, [setSaveStatus]);

  const loadSubmissions = useCallback(async () => {
    const response = await fetch('/api/events/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });

    if (!response.ok) {
      throw new Error('Failed to load submissions');
    }

    const { submissions: loaded } = await response.json();
    const nextSubmissions = Array.isArray(loaded) ? loaded : [];
    setSubmissions(nextSubmissions);

    if (nextSubmissions.length > 0) {
      setSelectedSubmissionId(nextSubmissions[nextSubmissions.length - 1].id);
    } else {
      setSelectedSubmissionId(null);
    }
  }, [sessionId]);

  // Open submission modal after a successful submission
  useEffect(() => {
    const handleSubmissionSaved = () => {
      loadSubmissions()
        .then(() => setIsSubmissionModalOpen(true))
        .catch(() => {
          // If loading fails, just keep the editor view
        });
    };

    window.addEventListener('prelude:submission-saved', handleSubmissionSaved);
    return () => {
      window.removeEventListener('prelude:submission-saved', handleSubmissionSaved);
    };
  }, [loadSubmissions]);

  const handleOpenSubmissions = () => {
    loadSubmissions()
      .then(() => setIsSubmissionModalOpen(true))
      .catch(() => {
        setIsSubmissionModalOpen(true);
      });
  };

  // Handle resize with mouse events
  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => handleResize(e.clientX);
    const handleMouseUp = () => stopResize();

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, handleResize, stopResize]);

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">
              {assignmentTitle}
            </h1>
            <div className="flex items-center gap-3 mt-1">
              <p className="text-sm text-gray-600">
                Due: {deadline.toLocaleDateString()}
              </p>
              <span className="text-gray-400">•</span>
              <button
                onClick={toggleInstructions}
                className="text-sm text-blue-600 hover:text-blue-700 font-medium"
              >
                {showInstructions ? 'Hide Instructions' : 'View Instructions'}
              </button>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className={`text-sm font-medium ${
              saveStatus === 'saving' ? 'text-blue-600' : 
              saveStatus === 'saved' ? 'text-green-600' : 
              'text-gray-500'
            }`}>
              {saveStatus === 'saving' ? '💾 Saving...' : 
               saveStatus === 'saved' ? '✓ Saved' : 
               'Ready'}
            </span>
            <Link
              href="/student/dashboard"
              className="px-3 py-2 border border-gray-300 text-gray-700 rounded hover:bg-gray-50 text-sm font-medium"
            >
              Dashboard
            </Link>
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('prelude:submit-request'))}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 text-sm font-medium"
              title="You can resubmit anytime before the deadline"
            >
              Submit
            </button>
            <button
              onClick={handleOpenSubmissions}
              className="px-3 py-2 border border-gray-300 text-gray-700 rounded hover:bg-gray-50 text-sm font-medium"
              title="View previous submissions"
            >
              Submissions
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Editor (Left) */}
        <div className="flex-1 flex flex-col border-r border-gray-200">
          {/* Instructions Panel (Collapsible) */}
          {showInstructions && (
            <div className="border-b border-gray-200 bg-blue-50">
              <div className="max-w-4xl mx-auto p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-3">Assignment Instructions</h2>
                <div className="prose prose-sm max-w-none max-h-80 overflow-auto bg-white rounded-lg p-4 border border-blue-200">
                  <div className="whitespace-pre-wrap text-gray-700">
                    {assignmentInstructions}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Editor */}
          <div className="flex-1 overflow-auto p-6">
            <div className="max-w-4xl mx-auto">
              <TrackedEditor sessionId={sessionId} />
            </div>
          </div>
        </div>

        {/* Resize Handle - only show when chat is open */}
        {isChatOpen && (
          <div
            className="w-1 bg-gray-200 hover:bg-blue-500 cursor-col-resize transition-colors"
            onMouseDown={startResize}
          />
        )}

        {/* Chat (Right) - only show when open */}
        {isChatOpen && (
          <div className="bg-gray-50" style={{ width: `${chatWidth}px` }}>
            <ChatPanel
              sessionId={sessionId}
              assignmentId={assignmentId}
              isOpen={isChatOpen}
              onToggle={setChatOpen}
              allowWebSearch={allowWebSearch}
            />
          </div>
        )}

        {/* Floating chat button when closed */}
        {!isChatOpen && (
          <div className="fixed top-1/2 right-0 -translate-y-1/2 z-50">
            <button
              onClick={() => setChatOpen(true)}
              className="bg-blue-600 text-white px-3 py-6 rounded-l-lg shadow-lg hover:px-4 transition-all duration-300 flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
              <span className="text-xs font-medium">AI</span>
            </button>
          </div>
        )}
      </div>

      <SubmissionModal
        isOpen={isSubmissionModalOpen}
        submissions={submissions}
        selectedSubmissionId={selectedSubmissionId}
        onSelectSubmission={setSelectedSubmissionId}
        onClose={() => setIsSubmissionModalOpen(false)}
      />
    </div>
  );
}
