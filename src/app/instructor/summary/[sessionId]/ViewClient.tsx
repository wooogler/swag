'use client';

import { useMemo, useState, useEffect } from 'react';
import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from '@headlessui/react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';

interface ViewClientProps {
  finalDocument: any[];
  submissions: Array<{
    id: number;
    eventData: any;
    timestamp: Date | string;
    sequenceNumber: number;
  }>;
}

export default function ViewClient({ finalDocument, submissions }: ViewClientProps) {
  const sortedSubmissions = useMemo(
    () => [...submissions].sort((a, b) => a.sequenceNumber - b.sequenceNumber),
    [submissions]
  );
  const latestSubmission = sortedSubmissions[sortedSubmissions.length - 1];
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<number | null>(
    latestSubmission?.id ?? null
  );

  const selectedSubmission = sortedSubmissions.find(s => s.id === selectedSubmissionId) || null;
  const documentToShow = selectedSubmission?.eventData || finalDocument;

  const editor = useCreateBlockNote({
    initialContent: documentToShow.length > 0 ? documentToShow : undefined,
  });

  useEffect(() => {
    if (!editor) return;
    const currentDoc = editor.document;
    if (JSON.stringify(currentDoc) === JSON.stringify(documentToShow)) return;
    editor.replaceBlocks(editor.document, documentToShow);
  }, [editor, documentToShow]);

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="px-6 py-4 border-b border-gray-200">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Final Submission</h2>
            <p className="text-sm text-gray-600 mt-1">
              {sortedSubmissions.length > 0
                ? 'Select any submission to review'
                : 'This is the latest auto-saved version'}
            </p>
          </div>
          {sortedSubmissions.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">
                Submission
              </span>
              <Listbox
                value={selectedSubmission}
                onChange={(submission) => setSelectedSubmissionId(submission.id)}
              >
                <div className="relative">
                  <ListboxButton className="px-3 py-1.5 text-sm border border-gray-300 rounded bg-white text-gray-700 min-w-[260px] text-left flex items-center justify-between gap-2">
                    <span>
                      {selectedSubmission
                        ? `Submission ${sortedSubmissions.findIndex(s => s.id === selectedSubmission.id) + 1}`
                        : 'Select submission'}
                    </span>
                    <svg className="w-4 h-4 text-gray-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                      <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.292l3.71-4.06a.75.75 0 111.1 1.02l-4.25 4.65a.75.75 0 01-1.1 0l-4.25-4.65a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                    </svg>
                  </ListboxButton>
                  <ListboxOptions className="absolute right-0 mt-2 max-h-60 w-80 overflow-auto rounded-md bg-white py-1 text-sm shadow-lg ring-1 ring-black/5 z-10">
                    {sortedSubmissions.map((submission, index) => {
                      const submittedAt = new Date(submission.timestamp).toLocaleString();
                      return (
                        <ListboxOption
                          key={submission.id}
                          value={submission}
                          className="cursor-pointer select-none px-3 py-2 hover:bg-gray-100"
                        >
                          {({ selected }) => (
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{`Submission ${index + 1}`}</span>
                                {selected && (
                                  <svg className="w-4 h-4 text-blue-600" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                                    <path fillRule="evenodd" d="M16.704 5.29a1 1 0 01.006 1.414l-7.1 7.2a1 1 0 01-1.42.01l-3.3-3.2a1 1 0 011.4-1.44l2.59 2.51 6.39-6.48a1 1 0 011.414-.006z" clipRule="evenodd" />
                                  </svg>
                                )}
                              </div>
                              <span className="text-xs text-gray-500">
                                {submittedAt}
                              </span>
                            </div>
                          )}
                        </ListboxOption>
                      );
                    })}
                  </ListboxOptions>
                </div>
              </Listbox>
            </div>
          )}
        </div>
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
