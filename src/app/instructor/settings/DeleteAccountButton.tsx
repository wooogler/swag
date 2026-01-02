'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface DeleteAccountButtonProps {
  instructorId: string;
}

export default function DeleteAccountButton({ instructorId }: DeleteAccountButtonProps) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  async function handleDelete() {
    if (confirmText !== 'DELETE') {
      return;
    }

    setIsDeleting(true);

    try {
      const res = await fetch('/api/auth/delete-account', {
        method: 'DELETE',
      });

      if (res.ok) {
        // Redirect to login page
        router.push('/instructor/login?message=account-deleted');
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to delete account');
        setIsDeleting(false);
      }
    } catch (error) {
      alert('Failed to delete account');
      setIsDeleting(false);
    }
  }

  if (showConfirm) {
    return (
      <div className="space-y-4">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm text-red-800 font-medium mb-2">
            ⚠️ This action cannot be undone!
          </p>
          <p className="text-sm text-red-700 mb-4">
            Type <span className="font-mono font-bold">DELETE</span> to confirm account deletion:
          </p>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="Type DELETE"
            className="w-full px-3 py-2 border border-red-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 mb-3"
          />
          <div className="flex gap-2">
            <button
              onClick={handleDelete}
              disabled={isDeleting || confirmText !== 'DELETE'}
              className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isDeleting ? 'Deleting...' : 'Delete My Account'}
            </button>
            <button
              onClick={() => {
                setShowConfirm(false);
                setConfirmText('');
              }}
              disabled={isDeleting}
              className="px-4 py-2 text-gray-700 border border-gray-300 text-sm font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={() => setShowConfirm(true)}
      className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition-colors"
    >
      Delete Account
    </button>
  );
}

