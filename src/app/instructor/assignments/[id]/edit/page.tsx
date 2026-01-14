'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';

interface Assignment {
  id: string;
  title: string;
  instructions: string;
  deadline: Date;
  customSystemPrompt: string | null;
  includeInstructionInPrompt: boolean;
  allowWebSearch: boolean;
}

export default function EditAssignmentPage() {
  const router = useRouter();
  const params = useParams();
  const assignmentId = params.id as string;

  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchAssignment() {
      try {
        const res = await fetch(`/api/assignments/${assignmentId}`);
        if (!res.ok) {
          if (res.status === 401) {
            router.push('/instructor/login');
            return;
          }
          throw new Error('Failed to load assignment');
        }
        const data = await res.json();
        setAssignment(data);
      } catch (err) {
        setError('Failed to load assignment');
      } finally {
        setIsLoading(false);
      }
    }

    fetchAssignment();
  }, [assignmentId, router]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const data = {
      title: formData.get('title') as string,
      instructions: formData.get('instructions') as string,
      deadline: formData.get('deadline') as string,
      customSystemPrompt: formData.get('customSystemPrompt') as string || null,
      includeInstructionInPrompt: formData.get('includeInstructionInPrompt') === 'on',
      allowWebSearch: formData.get('allowWebSearch') === 'on',
    };

    try {
      const res = await fetch(`/api/assignments/${assignmentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const result = await res.json();
        throw new Error(result.error || 'Failed to update assignment');
      }

      router.push(`/instructor/assignments/${assignmentId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update assignment');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-600">Loading...</div>
      </div>
    );
  }

  if (!assignment) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-red-600">{error || 'Assignment not found'}</div>
      </div>
    );
  }

  // Format deadline for datetime-local input
  const deadlineValue = new Date(assignment.deadline).toISOString().slice(0, 16);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-4">
            <Link
              href={`/instructor/assignments/${assignmentId}`}
              className="text-gray-600 hover:text-gray-900"
            >
              ← Back
            </Link>
            <h1 className="text-xl font-bold text-gray-900">Edit Assignment</h1>
          </div>
        </div>
      </header>

      {/* Form */}
      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
              {error}
            </div>
          )}

          {/* Title */}
          <div>
            <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-1">
              Title *
            </label>
            <input
              type="text"
              id="title"
              name="title"
              required
              defaultValue={assignment.title}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {/* Instructions */}
          <div>
            <label htmlFor="instructions" className="block text-sm font-medium text-gray-700 mb-1">
              Instructions *
            </label>
            <textarea
              id="instructions"
              name="instructions"
              required
              rows={6}
              defaultValue={assignment.instructions}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {/* Deadline */}
          <div>
            <label htmlFor="deadline" className="block text-sm font-medium text-gray-700 mb-1">
              Deadline *
            </label>
            <input
              type="datetime-local"
              id="deadline"
              name="deadline"
              required
              defaultValue={deadlineValue}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {/* Custom System Prompt */}
          <div className="border-t border-gray-200 pt-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">AI Assistant Settings</h3>

            <div className="space-y-4">
              <div>
                <label htmlFor="customSystemPrompt" className="block text-sm font-medium text-gray-700 mb-1">
                  Custom System Prompt (Optional)
                </label>
                <textarea
                  id="customSystemPrompt"
                  name="customSystemPrompt"
                  rows={4}
                  defaultValue={assignment.customSystemPrompt || ''}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="includeInstructionInPrompt"
                  name="includeInstructionInPrompt"
                  defaultChecked={assignment.includeInstructionInPrompt}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <label htmlFor="includeInstructionInPrompt" className="text-sm text-gray-700">
                  Include assignment instructions in the AI system prompt
                </label>
              </div>

              {/* Web Search Toggle */}
              <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="allowWebSearch"
                    name="allowWebSearch"
                    defaultChecked={assignment.allowWebSearch}
                    className="h-4 w-4 text-amber-600 focus:ring-amber-500 border-gray-300 rounded"
                  />
                  <label htmlFor="allowWebSearch" className="text-sm font-medium text-gray-900">
                    Allow Web Search
                  </label>
                </div>
                <p className="mt-2 text-sm text-gray-600 ml-6">
                  When enabled, students can use the web search feature in the AI assistant to find
                  real-time information from the internet. This allows the AI to access up-to-date
                  information beyond its training data.
                </p>
                <p className="mt-1 text-sm text-amber-700 ml-6">
                  <strong>Note:</strong> Web search is disabled by default. Only enable this if your
                  assignment requires or benefits from accessing external web resources.
                </p>
              </div>
            </div>
          </div>

          {/* Submit */}
          <div className="flex justify-end gap-4 pt-6 border-t border-gray-200">
            <Link
              href={`/instructor/assignments/${assignmentId}`}
              className="px-4 py-2 text-gray-700 hover:text-gray-900"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              {isSubmitting ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
