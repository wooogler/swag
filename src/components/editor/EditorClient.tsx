'use client';

import { useEffect, useState } from 'react';
import TrackedEditor from './TrackedEditor';
import ChatPanel from '../chat/ChatPanel';

interface EditorClientProps {
  assignmentId: string;
  assignmentTitle: string;
  deadline: Date;
}

export default function EditorClient({ assignmentId, assignmentTitle, deadline }: EditorClientProps) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'ready' | 'saved'>('ready');
  const [chatWidth, setChatWidth] = useState(480); // Default 480px (larger chat width)
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    // Get session ID from localStorage
    const storedSessionId = localStorage.getItem('prelude_session_id');
    console.log('EditorClient: Retrieved session ID:', storedSessionId);
    if (storedSessionId) {
      setSessionId(storedSessionId);
    }
  }, []);

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

  if (!sessionId) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-gray-600">Loading...</div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">
              {assignmentTitle}
            </h1>
            <p className="text-sm text-gray-600">
              Due: {deadline.toLocaleDateString()}
            </p>
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
