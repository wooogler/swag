'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function NewAssignmentPage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const res = await fetch('/api/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const result = await res.json();
        throw new Error(result.error || 'Failed to create assignment');
      }

      router.push('/instructor/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create assignment');
    } finally {
      setIsSubmitting(false);
    }
  }

  // Default deadline: 7 days from now at 11:59 PM (local time)
  const defaultDeadlineDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  defaultDeadlineDate.setHours(23, 59, 0, 0);
  const year = defaultDeadlineDate.getFullYear();
  const month = String(defaultDeadlineDate.getMonth() + 1).padStart(2, '0');
  const day = String(defaultDeadlineDate.getDate()).padStart(2, '0');
  const hours = String(defaultDeadlineDate.getHours()).padStart(2, '0');
  const minutes = String(defaultDeadlineDate.getMinutes()).padStart(2, '0');
  const defaultDeadline = `${year}-${month}-${day}T${hours}:${minutes}`;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-4">
            <Link
              href="/instructor/dashboard"
              className="text-gray-600 hover:text-gray-900"
            >
              ← Back
            </Link>
            <h1 className="text-xl font-bold text-gray-900">New Assignment</h1>
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
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="e.g., AI Ethics Essay"
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
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Provide detailed instructions for the assignment..."
            />
            <p className="mt-1 text-sm text-gray-500">
              These instructions will be shown to students when they start the assignment.
            </p>
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
              defaultValue={defaultDeadline}
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
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="e.g., You are a helpful writing assistant that helps students improve their essays without writing for them..."
                />
                <p className="mt-1 text-sm text-gray-500">
                  Leave empty to use the default system prompt.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="includeInstructionInPrompt"
                  name="includeInstructionInPrompt"
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <label htmlFor="includeInstructionInPrompt" className="text-sm text-gray-700">
                  Include assignment instructions in the AI system prompt
                </label>
              </div>
              <p className="text-sm text-gray-500 ml-6">
                When enabled, the AI assistant will be aware of the assignment requirements.
              </p>

              {/* Web Search Toggle */}
              <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="allowWebSearch"
                    name="allowWebSearch"
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
              href="/instructor/dashboard"
              className="px-4 py-2 text-gray-700 hover:text-gray-900"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              {isSubmitting ? 'Creating...' : 'Create Assignment'}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
