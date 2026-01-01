'use client';

import { useEffect, useState } from 'react';
import TrackedEditor from './TrackedEditor';
import ChatPanel from '../chat/ChatPanel';

interface EditorClientProps {
  sessionId: string;
  assignmentId: string;
  assignmentTitle: string;
  assignmentInstructions: string;
  deadline: Date;
}

export default function EditorClient({ sessionId, assignmentId, assignmentTitle, assignmentInstructions, deadline }: EditorClientProps) {
  const [saveStatus, setSaveStatus] = useState<'ready' | 'saved'>('ready');
  const [chatWidth, setChatWidth] = useState(480); // Default 480px (larger chat width)
  const [isResizing, setIsResizing] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);

  // Listen for save events
  useEffect(() => {
    const handleSave = () => {
      setSaveStatus('saved');
      // Reset to ready after 2 seconds
      setTimeout(() => setSaveStatus('ready'), 2000);
    };

    window.addEventListener('prelude:events-saved', handleSave);
    return () => window.removeEventListener('prelude:events-saved', handleSave);
  }, []);

  // Handle resize
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;

      const newWidth = window.innerWidth - e.clientX;
      // Min 300px, max 800px
      setChatWidth(Math.min(Math.max(newWidth, 300), 800));
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

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
                onClick={() => setShowInstructions(!showInstructions)}
                className="text-sm text-blue-600 hover:text-blue-700 font-medium"
              >
                {showInstructions ? 'Hide Instructions' : 'View Instructions'}
              </button>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className={`text-sm ${saveStatus === 'saved' ? 'text-green-600' : 'text-gray-500'}`}>
              {saveStatus === 'saved' ? '✓ Saved' : 'Ready'}
            </span>
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

        {/* Resize Handle */}
        <div
          className="w-1 bg-gray-200 hover:bg-blue-500 cursor-col-resize transition-colors"
          onMouseDown={() => setIsResizing(true)}
        />

        {/* Chat (Right) */}
        <div className="bg-gray-50" style={{ width: `${chatWidth}px` }}>
          <ChatPanel sessionId={sessionId} assignmentId={assignmentId} />
        </div>
      </div>
    </div>
  );
}
