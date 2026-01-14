'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function JoinAssignmentForm() {
  const router = useRouter();
  const [shareInput, setShareInput] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState('');

  const extractShareToken = (value: string) => {
    const trimmed = value.trim();
    const match = trimmed.match(/\/s\/([a-zA-Z0-9_-]+)/);
    if (match?.[1]) {
      return match[1];
    }
    return trimmed || null;
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsJoining(true);

    try {
      const shareToken = extractShareToken(shareInput);
      if (!shareToken) {
        throw new Error('Please enter a valid share link or token.');
      }

      const response = await fetch('/api/student-sessions/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shareToken }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to join assignment.');
      }

      router.push(`/s/${data.shareToken}/editor/${data.sessionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join assignment.');
    } finally {
      setIsJoining(false);
    }
  };

  return (
    <form onSubmit={handleJoin} className="space-y-3">
      <label htmlFor="shareLink" className="block text-sm font-medium text-gray-700">
        Share link or token
      </label>
      <input
        id="shareLink"
        type="text"
        value={shareInput}
        onChange={(e) => setShareInput(e.target.value)}
        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        placeholder="https://.../s/abc123 or abc123"
      />
      {error && (
        <div className="text-red-600 text-sm bg-red-50 p-3 rounded-lg">
          {error}
        </div>
      )}
      <button
        type="submit"
        disabled={isJoining}
        className="bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-medium"
      >
        {isJoining ? 'Joining...' : 'Join Assignment'}
      </button>
    </form>
  );
}
