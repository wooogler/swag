'use client';

import { Fragment, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { Dialog, Listbox, ListboxButton, ListboxOption, ListboxOptions, Transition } from '@headlessui/react';

const SubmissionPreview = dynamic(() => import('./SubmissionPreview'), {
  ssr: false,
  loading: () => (
    <div className="text-center text-gray-400 py-16">Loading preview...</div>
  ),
});

interface SubmissionEvent {
  id: number;
  eventData: any;
  timestamp: string | Date;
  sequenceNumber: number;
}

interface SubmissionModalProps {
  isOpen: boolean;
  submissions: SubmissionEvent[];
  selectedSubmissionId: number | null;
  onSelectSubmission: (id: number) => void;
  onClose: () => void;
}

export default function SubmissionModal({
  isOpen,
  submissions,
  selectedSubmissionId,
  onSelectSubmission,
  onClose,
}: SubmissionModalProps) {
  const sortedSubmissions = useMemo(
    () => [...submissions].sort((a, b) => a.sequenceNumber - b.sequenceNumber),
    [submissions]
  );

  const selectedSubmission =
    sortedSubmissions.find(s => s.id === selectedSubmissionId) ||
    sortedSubmissions[sortedSubmissions.length - 1];

  const documentToShow = selectedSubmission?.eventData || [{ type: 'paragraph', content: [] }];

  const selectedIndex = selectedSubmission
    ? sortedSubmissions.findIndex(s => s.id === selectedSubmission.id)
    : -1;
  const hasSubmissions = sortedSubmissions.length > 0;
  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog onClose={onClose} className="relative z-50">
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/50" aria-hidden="true" />
        </Transition.Child>

        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-200"
            enterFrom="opacity-0 scale-95 translate-y-2"
            enterTo="opacity-100 scale-100 translate-y-0"
            leave="ease-in duration-150"
            leaveFrom="opacity-100 scale-100 translate-y-0"
            leaveTo="opacity-0 scale-95 translate-y-2"
          >
            <Dialog.Panel className="w-[90vw] max-w-5xl max-h-[85vh] bg-white rounded-lg shadow-xl flex flex-col overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <div>
              <Dialog.Title className="text-lg font-semibold text-gray-900">
                Submission Preview
              </Dialog.Title>
              <p className="text-sm text-gray-600 mt-1">
                {sortedSubmissions.length > 0
                  ? `${selectedIndex + 1} / ${sortedSubmissions.length} • ${selectedSubmission ? new Date(selectedSubmission.timestamp).toLocaleString() : ''}`
                  : 'No submissions yet'}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Listbox
                value={selectedSubmission ?? null}
                onChange={(submission) => onSelectSubmission(submission.id)}
                disabled={!hasSubmissions}
              >
                <div className="relative">
                  <ListboxButton className="px-3 py-1.5 text-sm border border-gray-300 rounded bg-white text-gray-700 disabled:opacity-50 min-w-[220px] text-left flex items-center justify-between gap-2">
                    <span>
                      {selectedSubmission
                        ? `Submission ${selectedIndex + 1}`
                        : 'No submissions'}
                    </span>
                    <svg className="w-4 h-4 text-gray-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                      <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.292l3.71-4.06a.75.75 0 111.1 1.02l-4.25 4.65a.75.75 0 01-1.1 0l-4.25-4.65a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                    </svg>
                  </ListboxButton>
                  <ListboxOptions className="absolute right-0 mt-2 max-h-60 w-72 overflow-auto rounded-md bg-white py-1 text-sm shadow-lg ring-1 ring-black/5 z-10">
                    {sortedSubmissions.map((submission, index) => (
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
                              {new Date(submission.timestamp).toLocaleString()}
                            </span>
                          </div>
                        )}
                      </ListboxOption>
                    ))}
                  </ListboxOptions>
                </div>
              </Listbox>
              <button
                className="ml-2 px-3 py-1 text-sm text-gray-600 hover:text-gray-900"
                onClick={onClose}
              >
                Close
              </button>
            </div>
          </div>

          <div className="p-6 overflow-auto">
            <div className="max-w-4xl mx-auto">
              {hasSubmissions ? (
                <SubmissionPreview document={documentToShow} />
              ) : (
                <div className="text-center text-gray-500 py-16">
                  No submissions yet.
                </div>
              )}
            </div>
          </div>
            </Dialog.Panel>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition>
  );
}
