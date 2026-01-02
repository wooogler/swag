'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function StudentVerifyPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const sessionId = searchParams.get('sessionId');

  const [isVerifying, setIsVerifying] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionData, setSessionData] = useState<{
    studentName: string;
    studentEmail: string;
  } | null>(null);
  
  // Password setting state
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  useEffect(() => {
    async function verifyToken() {
      if (!token || !sessionId) {
        setError('Invalid verification link');
        setIsVerifying(false);
        return;
      }

      try {
        const res = await fetch('/api/student/verify-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, sessionId }),
        });

        if (res.ok) {
          const data = await res.json();
          setSessionData(data.session);
          setIsVerifying(false);
        } else {
          const data = await res.json();
          setError(data.error || 'Verification failed');
          setIsVerifying(false);
        }
      } catch (err) {
        setError('Verification failed');
        setIsVerifying(false);
      }
    }

    verifyToken();
  }, [token, sessionId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');

    if (password.length < 8) {
      setPasswordError('Password must be at least 8 characters');
      return;
    }

    if (password !== confirmPassword) {
      setPasswordError('Passwords do not match');
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await fetch('/api/student/set-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, sessionId, password }),
      });

      if (res.ok) {
        // Redirect to editor
        router.push(`/s/redirect/${sessionId}`);
      } else {
        const data = await res.json();
        setPasswordError(data.error || 'Failed to set password');
      }
    } catch (err) {
      setPasswordError('Failed to set password');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Email Verification
          </h2>
        </div>

        <div className="bg-white rounded-lg shadow-md p-8">
          {isVerifying && (
            <div className="text-center">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
              <p className="text-gray-600">Verifying your email...</p>
            </div>
          )}

          {error && (
            <div className="text-center">
              <div className="text-red-600 text-5xl mb-4">✗</div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Verification Failed
              </h3>
              <p className="text-red-600 mb-4">{error}</p>
              <p className="text-sm text-gray-600">
                The verification link may have expired or is invalid.
                Please request a new verification email.
              </p>
            </div>
          )}

          {!isVerifying && !error && sessionData && (
            <div>
              <div className="text-center mb-6">
                <div className="text-green-600 text-5xl mb-4">✓</div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  Email Verified!
                </h3>
                <p className="text-gray-600 mb-1">
                  Welcome, <span className="font-semibold">{sessionData.studentName}</span>
                </p>
                <p className="text-sm text-gray-500">
                  Set a password to access your assignment
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                    Password
                  </label>
                  <input
                    type="password"
                    id="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="At least 8 characters"
                  />
                </div>

                <div>
                  <label htmlFor="confirm-password" className="block text-sm font-medium text-gray-700 mb-1">
                    Confirm Password
                  </label>
                  <input
                    type="password"
                    id="confirm-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Repeat password"
                  />
                </div>

                {passwordError && (
                  <div className="text-red-600 text-sm bg-red-50 p-3 rounded-lg">
                    {passwordError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-medium"
                >
                  {isSubmitting ? 'Setting Password...' : 'Set Password & Continue'}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

