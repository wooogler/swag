"use client";

import dynamic from "next/dynamic";

interface TrackedEditorProps {
  sessionId: string;
}

// Dynamic import to ensure client-side only rendering
// This is required for BlockNote to work with Next.js
const BlockNoteEditor = dynamic(() => import("./BlockNoteEditor"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-64">
      <div className="text-gray-400">Loading editor...</div>
    </div>
  ),
});

export default function TrackedEditor({ sessionId }: TrackedEditorProps) {
  return <BlockNoteEditor sessionId={sessionId} />;
}
