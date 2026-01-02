"use client";

import "@blocknote/core/fonts/inter.css";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import { useEffect, useRef, useState } from "react";
import { EventTracker } from "@/lib/event-tracker";
import { getGlobalValidator } from "@/lib/copy-validator";
import toast, { Toaster } from "react-hot-toast";

interface BlockNoteEditorProps {
  sessionId: string;
}

export default function BlockNoteEditor({ sessionId }: BlockNoteEditorProps) {
  const trackerRef = useRef<EventTracker | null>(null);
  const validator = getGlobalValidator();
  const [initialContent, setInitialContent] = useState<any[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load snapshot on mount
  useEffect(() => {
    const loadSnapshot = async () => {
      try {
        const response = await fetch('/api/events/load', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        });

        if (!response.ok) {
          throw new Error('Failed to load snapshot');
        }

        const { snapshot } = await response.json();

        if (snapshot && Array.isArray(snapshot) && snapshot.length > 0) {
          setInitialContent(snapshot);
          console.log('✓ Loaded snapshot with', snapshot.length, 'blocks');
        } else {
          // No snapshot found, use default
          setInitialContent([
            {
              type: "paragraph",
              content: [],
            },
          ]);
        }
      } catch (error) {
        console.error('Failed to load snapshot:', error);
        // Fallback to default content
        setInitialContent([
          {
            type: "paragraph",
            content: [],
          },
        ]);
      } finally {
        setIsLoading(false);
      }
    };

    loadSnapshot();
  }, [sessionId]);

  // Create BlockNote editor with loaded content - only when initialContent is ready
  const editor = useCreateBlockNote({
    initialContent: initialContent || undefined,
  }, [initialContent]);

  // Initialize event tracker
  useEffect(() => {
    trackerRef.current = new EventTracker(sessionId);

    // Snapshot 콜백 등록 (타이핑 멈춤 감지용)
    if (trackerRef.current) {
      trackerRef.current.setSnapshotCallback(() => {
        if (editor) {
          try {
            const documentState = editor.document;
            trackerRef.current?.trackSnapshot(documentState);
          } catch (error) {
            console.error("Failed to create snapshot:", error);
          }
        }
      });
    }

    // Force save on page unload
    const handleBeforeUnload = () => {
      trackerRef.current?.forceSave();
    };

    // 주기적으로 snapshot 체크 (1초마다) - 연속 타이핑 중 3초마다 저장용
    const snapshotCheckInterval = setInterval(() => {
      const tracker = trackerRef.current;
      if (tracker && tracker.shouldTakeSnapshot() && editor) {
        try {
          const documentState = editor.document;
          tracker.trackSnapshot(documentState);
        } catch (error) {
          console.error("Failed to create snapshot:", error);
        }
      }
    }, 1000);

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      clearInterval(snapshotCheckInterval);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      trackerRef.current?.forceSave();
    };
  }, [sessionId, editor]);

  // Track changes
  useEffect(() => {
    if (!editor) return;

    // Access underlying Tiptap editor for transaction tracking
    const tiptapEditor = (editor as any)._tiptapEditor;

    if (!tiptapEditor) {
      console.warn("Tiptap editor not accessible");
      return;
    }

    // Track user activity
    const handleUpdate = ({ transaction }: any) => {
      if (!transaction.docChanged) return;

      const tracker = trackerRef.current;
      if (!tracker) return;

      // Track activity (throttled to 1 per second)
      tracker.trackActivity();

      // Take snapshot if needed (activity-based, every 5 seconds)
      if (tracker.shouldTakeSnapshot()) {
        try {
          const documentState = editor.document;
          tracker.trackSnapshot(documentState);
        } catch (error) {
          console.error("Failed to create snapshot:", error);
        }
      }
    };

    tiptapEditor.on("update", handleUpdate);

    return () => {
      tiptapEditor.off("update", handleUpdate);
    };
  }, [editor]);

  // Copy/Paste validation
  useEffect(() => {
    if (!editor) return;

    const handleCopy = () => {
      const copiedContent = window.getSelection()?.toString();

      if (copiedContent) {
        // Mark content as copied from internal editor
        validator.markInternalCopy(copiedContent);
      }
    };

    const handlePaste = (e: ClipboardEvent) => {
      const pastedContent = e.clipboardData?.getData("text/plain");

      if (!pastedContent) return;

      const isInternal = validator.validatePaste(pastedContent);

      // Track the paste event
      const tracker = trackerRef.current;
      if (tracker) {
        tracker.trackPaste(pastedContent, isInternal);
      }

      if (!isInternal) {
        // Block external paste
        e.preventDefault();
        toast.error("External paste is blocked. You can only paste content from within this system.", {
          duration: 4000,
          position: "top-center",
          style: {
            background: "#EF4444",
            color: "#fff",
          },
        });
      } else {
        // Clear the copy buffer after successful paste
        validator.clearCopyBuffer();
      }
    };

    // Get the BlockNote editor DOM element
    const editorElement = document.querySelector(".blocknote-wrapper");

    if (!editorElement) {
      console.warn("BlockNote editor element not found");
      return;
    }

    // Add copy and paste listeners to the editor element
    editorElement.addEventListener("copy", handleCopy);
    editorElement.addEventListener("paste", handlePaste as EventListener);

    return () => {
      editorElement.removeEventListener("copy", handleCopy);
      editorElement.removeEventListener("paste", handlePaste as EventListener);
    };
  }, [validator, editor]);

  if (isLoading) {
    return (
      <div className="blocknote-wrapper">
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-400">Loading editor...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="blocknote-wrapper">
      <Toaster
        toastOptions={{
          className: '',
          style: {
            cursor: 'pointer',
          },
        }}
      />
      <BlockNoteView
        editor={editor}
        theme="light"
        data-placeholder="Start writing your essay here..."
      />
    </div>
  );
}
