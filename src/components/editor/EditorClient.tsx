'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import BackLink from '@/components/ui/BackLink';
import TrackedEditor from './TrackedEditor';
import ChatPanel from '../chat/ChatPanel';
import { useUIStore } from '@/stores/uiStore';
import SubmissionModal from './SubmissionModal';
import { Button } from '@/components/ui/button';
import { FileText, History, Send, Bot, Check, Loader2, ListChecks, LogOut } from 'lucide-react';
import dynamic from 'next/dynamic';
import { getGlobalValidator } from '@/lib/copy-validator';
import { SWAG_CUSTOM_EVENTS } from '@/lib/swag-events';
import { instructionToPlainText } from '@/lib/instruction-content';

const InstructionEditor = dynamic(
  () => import('@/components/editor/InstructionEditor'),
  { ssr: false, loading: () => <div className="p-2 text-[hsl(var(--muted-foreground))]">Loading...</div> }
);

interface EditorClientProps {
  sessionId: string;
  assignmentId: string;
  assignmentTitle: string;
  assignmentInstructions: string;
  assignmentCriteria: string | null;
  deadline: Date;
  allowWebSearch: boolean;
  strictPasteBlocking: boolean;
}

export default function EditorClient({
  sessionId,
  assignmentId,
  assignmentTitle,
  assignmentInstructions,
  assignmentCriteria,
  deadline,
  allowWebSearch,
  strictPasteBlocking,
}: EditorClientProps) {
  const validator = getGlobalValidator();
  const hasCriteria = Boolean(assignmentCriteria?.trim());

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
    eventData: Record<string, unknown>[];
    timestamp: string | Date;
    sequenceNumber: number;
  }>>([]);
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<number | null>(null);
  const [isSubmissionModalOpen, setIsSubmissionModalOpen] = useState(false);
  const [hasChangesAfterSubmit, setHasChangesAfterSubmit] = useState(false);
  const [showCriteria, setShowCriteria] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [panelHeight, setPanelHeight] = useState(280);
  const showInstructionsRef = useRef(showInstructions);
  useEffect(() => { showInstructionsRef.current = showInstructions; }, [showInstructions]);
  const showCriteriaRef = useRef(showCriteria);
  useEffect(() => { showCriteriaRef.current = showCriteria; }, [showCriteria]);

  const startPanelResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = panelHeight;

    const onMove = (e: MouseEvent) => {
      const next = startHeight + (e.clientY - startY);
      if (next < 80) {
        setPanelHeight(280);
        if (showInstructionsRef.current) toggleInstructions();
        if (showCriteriaRef.current) setShowCriteria(false);
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      } else {
        setPanelHeight(next);
      }
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  useEffect(() => {
    validator.registerInstruction(instructionToPlainText(assignmentInstructions));
    if (assignmentCriteria) {
      validator.registerInstruction(instructionToPlainText(assignmentCriteria));
    }
  }, [assignmentCriteria, assignmentInstructions, validator]);

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

    window.addEventListener(SWAG_CUSTOM_EVENTS.EVENTS_SAVING, handleSaving);
    window.addEventListener(SWAG_CUSTOM_EVENTS.EVENTS_SAVED, handleSaved);
    return () => {
      window.removeEventListener(SWAG_CUSTOM_EVENTS.EVENTS_SAVING, handleSaving);
      window.removeEventListener(SWAG_CUSTOM_EVENTS.EVENTS_SAVED, handleSaved);
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
      setHasChangesAfterSubmit(false);
      loadSubmissions()
        .then(() => setIsSubmissionModalOpen(true))
        .catch(() => {
          // If loading fails, just keep the editor view
        });
    };

    window.addEventListener(SWAG_CUSTOM_EVENTS.SUBMISSION_SAVED, handleSubmissionSaved);
    return () => {
      window.removeEventListener(SWAG_CUSTOM_EVENTS.SUBMISSION_SAVED, handleSubmissionSaved);
    };
  }, [loadSubmissions]);

  // Listen for editor changes to enable submit button
  useEffect(() => {
    const handleEditorChange = () => {
      setHasChangesAfterSubmit(true);
    };

    window.addEventListener(SWAG_CUSTOM_EVENTS.EDITOR_CHANGED, handleEditorChange);
    return () => {
      window.removeEventListener(SWAG_CUSTOM_EVENTS.EDITOR_CHANGED, handleEditorChange);
    };
  }, []);

  const handleOpenSubmissions = () => {
    loadSubmissions()
      .then(() => setIsSubmissionModalOpen(true))
      .catch(() => {
        setIsSubmissionModalOpen(true);
      });
  };

  const handleInstructionCopy = useCallback(() => {
    const copiedContent = window.getSelection()?.toString();
    if (copiedContent) {
      validator.markInternalCopy(copiedContent, 'instruction');
    }
  }, [validator]);

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
    <div className="h-screen flex flex-col bg-[hsl(var(--background))]">
      {/* Header */}
      <header className="bg-[hsl(var(--card))] border-b border-[hsl(var(--border))] px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <BackLink href="/student/dashboard" label="Dashboard" className="text-[hsl(var(--muted-foreground))]" />
            <div>
              <h1 className="text-xl font-bold text-[hsl(var(--foreground))]">
                {assignmentTitle}
              </h1>
              <div className="flex items-center gap-3 mt-1">
                <p className="text-sm text-[hsl(var(--muted-foreground))]">
                  Due: {deadline.toLocaleDateString()}
                </p>
                <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
                  strictPasteBlocking
                    ? 'border-red-200 bg-red-50 text-red-700'
                    : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                }`}>
                  {strictPasteBlocking ? 'External Paste: Blocked' : 'External Paste: Allowed'}
                </span>
                <span className="text-[hsl(var(--border))]">•</span>
                <Button
                  onClick={toggleInstructions}
                  variant="ghost"
                  size="sm"
                  className="h-auto p-0 text-[hsl(var(--primary))] hover:text-[hsl(var(--primary))]/80 font-medium hover:bg-transparent"
                >
                  <FileText className="w-4 h-4 mr-1" />
                  {showInstructions ? 'Hide Instructions' : 'View Instructions'}
                </Button>
                {hasCriteria ? (
                  <>
                    <span className="text-[hsl(var(--border))]">•</span>
                    <Button
                      onClick={() => setShowCriteria((current) => !current)}
                      variant="ghost"
                      size="sm"
                      className="h-auto p-0 text-[hsl(var(--primary))] hover:text-[hsl(var(--primary))]/80 font-medium hover:bg-transparent"
                    >
                      <ListChecks className="w-4 h-4 mr-1" />
                      {showCriteria ? 'Hide Criteria' : 'View Criteria'}
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {showLogoutConfirm ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-[hsl(var(--muted-foreground))]">Log out?</span>
                <form action="/api/auth/logout" method="POST" className="inline-flex">
                  <Button type="submit" variant="destructive" size="sm">Yes, log out</Button>
                </form>
                <Button variant="ghost" size="sm" onClick={() => setShowLogoutConfirm(false)}>Cancel</Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowLogoutConfirm(true)}
                className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--destructive))] hover:bg-[hsl(var(--destructive))]/10"
                title="Log out"
              >
                <LogOut className="w-4 h-4" />
              </Button>
            )}
            <div className="flex items-center gap-2 text-sm text-[hsl(var(--muted-foreground))] mr-2">
              <span className={`font-medium flex items-center gap-1.5 ${saveStatus === 'saving' ? 'text-[hsl(var(--primary))]' :
                saveStatus === 'saved' ? 'text-green-600' :
                  'text-[hsl(var(--muted-foreground))]'
                }`}>
                {saveStatus === 'saving' ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Saving...
                  </>
                ) : saveStatus === 'saved' ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    Saved
                  </>
                ) : (
                  'Ready'
                )}
              </span>
            </div>
            <Button
              onClick={handleOpenSubmissions}
              variant="secondary"
              size="sm"
              title="View previous submissions"
            >
              <History className="w-4 h-4 mr-2" />
              Submissions
            </Button>
            <Button
              onClick={() => window.dispatchEvent(new CustomEvent(SWAG_CUSTOM_EVENTS.SUBMIT_REQUEST))}
              className={hasChangesAfterSubmit ? "" : "opacity-50 cursor-not-allowed"}
              disabled={!hasChangesAfterSubmit}
              title={hasChangesAfterSubmit ? "You can resubmit anytime before the deadline" : "No changes since last submission"}
              size="sm"
            >
              <Send className="w-4 h-4 mr-2" />
              {hasChangesAfterSubmit ? 'Submit' : 'Submitted'}
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Editor (Left) */}
        <div className="flex-1 flex flex-col border-r border-[hsl(var(--border))]">
          {/* Instructions / Criteria Panels (Resizable) */}
          {(showInstructions || (showCriteria && hasCriteria)) && (
            <div
              className="flex flex-col border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 shrink-0"
              style={{ height: `${panelHeight}px` }}
            >
              <div className={`flex-1 min-h-0 w-full max-w-4xl mx-auto px-6 pt-6 pb-2 ${
                showInstructions && showCriteria && hasCriteria ? 'flex gap-6' : 'flex flex-col'
              }`}>
                {showInstructions && (
                  <div className={`flex flex-col min-h-0 ${showCriteria && hasCriteria ? 'flex-1 min-w-0' : 'flex-1'}`}>
                    <h2 className="text-lg font-semibold text-[hsl(var(--foreground))] mb-3 shrink-0">Assignment Instructions</h2>
                    <div
                      className="flex-1 min-h-0 overflow-auto bg-[hsl(var(--card))] rounded-lg border border-[hsl(var(--border))]"
                      onCopy={handleInstructionCopy}
                    >
                      <InstructionEditor initialContent={assignmentInstructions} editable={false} />
                    </div>
                  </div>
                )}
                {showCriteria && hasCriteria && (
                  <div className={`flex flex-col min-h-0 ${showInstructions ? 'flex-1 min-w-0' : 'flex-1'}`}>
                    <h2 className="text-lg font-semibold text-[hsl(var(--foreground))] mb-3 shrink-0">Assignment Criteria</h2>
                    <div
                      className="flex-1 min-h-0 overflow-auto bg-[hsl(var(--card))] rounded-lg border border-[hsl(var(--border))]"
                      onCopy={handleInstructionCopy}
                    >
                      <InstructionEditor initialContent={assignmentCriteria || ''} editable={false} />
                    </div>
                  </div>
                )}
              </div>
              <div
                className="h-2 shrink-0 cursor-row-resize flex items-center justify-center hover:bg-[hsl(var(--primary))]/10 transition-colors group"
                onMouseDown={startPanelResize}
              >
                <div className="w-10 h-1 rounded-full bg-[hsl(var(--border))] group-hover:bg-[hsl(var(--primary))]/50 transition-colors" />
              </div>
            </div>
          )}

          {/* Editor */}
          <div className="flex-1 min-h-0 px-6 pb-6 pt-2">
            <div className="max-w-4xl mx-auto h-full min-h-0">
              <TrackedEditor sessionId={sessionId} strictPasteBlocking={strictPasteBlocking} />
            </div>
          </div>
        </div>

        {/* Resize Handle - only show when chat is open */}
        {isChatOpen && (
          <div
            className="w-2 shrink-0 cursor-col-resize flex items-center justify-center hover:bg-[hsl(var(--primary))]/10 transition-colors group"
            onMouseDown={startResize}
          >
            <div className="h-10 w-1 rounded-full bg-[hsl(var(--border))] group-hover:bg-[hsl(var(--primary))]/50 transition-colors" />
          </div>
        )}

        {/* Chat (Right) - only show when open */}
        {isChatOpen && (
          <div className="bg-[hsl(var(--muted))]/10" style={{ width: `${chatWidth}px` }}>
            <ChatPanel
              sessionId={sessionId}
              assignmentId={assignmentId}
              isOpen={isChatOpen}
              onToggle={setChatOpen}
              allowWebSearch={allowWebSearch}
              strictPasteBlocking={strictPasteBlocking}
            />
          </div>
        )}

        {/* Floating chat button when closed */}
        {!isChatOpen && (
          <div className="fixed top-1/2 right-0 -translate-y-1/2 z-50">
            <Button
              onClick={() => setChatOpen(true)}
              className="rounded-r-none rounded-l-lg shadow-lg h-auto py-4 pl-3 pr-4"
            >
              <Bot className="w-5 h-5 mr-2" />
              <span className="text-xs font-medium">Chat</span>
            </Button>
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
