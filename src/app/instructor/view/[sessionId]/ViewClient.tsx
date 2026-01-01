'use client';

import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';

interface ViewClientProps {
  finalDocument: any[];
}

export default function ViewClient({ finalDocument }: ViewClientProps) {
  const editor = useCreateBlockNote({
    initialContent: finalDocument.length > 0 ? finalDocument : undefined,
  });

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900">Final Submission</h2>
        <p className="text-sm text-gray-600 mt-1">
          This is the final version of the student's work
        </p>
      </div>
      <div className="p-6">
        <div className="max-w-4xl mx-auto">
          <BlockNoteView
            editor={editor}
            editable={false}
            theme="light"
          />
        </div>
      </div>
    </div>
  );
}
