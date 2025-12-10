'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface DeleteAssignmentButtonProps {
  assignmentId: string;
}

export default function DeleteAssignmentButton({ assignmentId }: DeleteAssignmentButtonProps) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  async function handleDelete() {
    setIsDeleting(true);

    try {
      const res = await fetch(`/api/assignments/${assignmentId}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        router.push('/instructor/dashboard');
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to delete assignment');
      }
    } catch (error) {
      alert('Failed to delete assignment');
    } finally {
      setIsDeleting(false);
      setShowConfirm(false);
    }
  }

  if (showConfirm) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-red-600">Delete this assignment?</span>
        <button
          onClick={handleDelete}
          disabled={isDeleting}
          className="px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700 disabled:opacity-50"
        >
          {isDeleting ? 'Deleting...' : 'Yes, Delete'}
        </button>
        <button
          onClick={() => setShowConfirm(false)}
          className="px-3 py-1 text-gray-600 text-sm hover:text-gray-800"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setShowConfirm(true)}
      className="px-4 py-2 text-red-600 border border-red-300 rounded-lg hover:bg-red-50"
    >
      Delete
    </button>
  );
}
