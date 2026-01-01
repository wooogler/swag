"use client";

import "@blocknote/core/fonts/inter.css";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import { useEffect, useRef } from "react";
import { EventTracker } from "@/lib/event-tracker";
import { getGlobalValidator } from "@/lib/copy-validator";
import toast, { Toaster } from "react-hot-toast";

interface BlockNoteEditorProps {
  sessionId: string;
}

export default function BlockNoteEditor({ sessionId }: BlockNoteEditorProps) {
  const trackerRef = useRef<EventTracker | null>(null);
  const validator = getGlobalValidator();

  // Create BlockNote editor
  const editor = useCreateBlockNote({
    initialContent: [
      {
        type: "paragraph",
        content: [],
      },
    ],
  });

  // Initialize event tracker
  useEffect(() => {
    trackerRef.current = new EventTracker(sessionId);

    // Force save on page unload
    const handleBeforeUnload = () => {
      trackerRef.current?.forceSave();
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      trackerRef.current?.forceSave();
    };
  }, [sessionId]);

  // Track changes
  useEffect(() => {
    if (!editor) return;

    // Access underlying Tiptap editor for transaction tracking
    const tiptapEditor = (editor as any)._tiptapEditor;

    if (!tiptapEditor) {
      console.warn("Tiptap editor not accessible");
      return;
    }

    // Track transactions
    const handleUpdate = ({ transaction }: any) => {
      if (!transaction.docChanged) return;

      const tracker = trackerRef.current;
      if (!tracker) return;

      // Track each step in the transaction
      transaction.steps.forEach((step: any) => {
        try {
          const stepJSON = step.toJSON();
          tracker.trackTransactionStep({
            stepType: stepJSON.stepType,
            from: stepJSON.from,
            to: stepJSON.to,
            slice: stepJSON.slice,
          });
        } catch (error) {
          console.error("Failed to serialize step:", error);
        }
      });

      // Take snapshot if needed
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

  // Paste validation
  useEffect(() => {
    if (!editor) return;

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

    // Add paste listener only to the editor element
    editorElement.addEventListener("paste", handlePaste as EventListener);

    return () => {
      editorElement.removeEventListener("paste", handlePaste as EventListener);
    };
  }, [validator, editor]);

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
