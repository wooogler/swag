'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface DeleteStudentSessionButtonProps {
  sessionId: string;
  studentName: string;
  assignmentId: string;
}

export default function DeleteStudentSessionButton({ 
  sessionId, 
  studentName,
  assignmentId 
}: DeleteStudentSessionButtonProps) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleDelete() {
    const confirmed = window.confirm(
      `Are you sure you want to delete ${studentName}'s work?\n\nThis action cannot be undone. All student data (chat history, edit history, etc.) will be permanently deleted.`
    );

    if (!confirmed) {
      return;
    }

    setIsDeleting(true);

    try {
      const res = await fetch(`/api/student-sessions/${sessionId}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        // Refresh the page to show updated list
        router.refresh();
      } else {
        const data = await res.json();
        alert(`Failed to delete: ${data.error || 'Unknown error'}`);
      }
    } catch (error) {
      alert('Failed to delete: Network error');
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <button
      onClick={handleDelete}
      disabled={isDeleting}
      className="text-red-600 hover:text-red-800 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {isDeleting ? 'Deleting...' : 'Delete'}
    </button>
  );
}

