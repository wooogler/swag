'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface AccessFormProps {
  assignmentId: string;
  shareToken: string;
}

export default function AccessForm({ assignmentId, shareToken }: AccessFormProps) {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [currentUser, setCurrentUser] = useState<{ name?: string | null; email: string; role: string } | null>(null);
  const [isChecking, setIsChecking] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [verificationSent, setVerificationSent] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function fetchMe() {
      try {
        const res = await fetch('/api/auth/me');
        if (!res.ok) {
          return;
        }
        const data = await res.json();
        if (mounted) {
          setCurrentUser(data.user);
        }
      } catch {
        // ignore
      } finally {
        if (mounted) {
          setIsChecking(false);
        }
      }
    }

    fetchMe();
    return () => {
      mounted = false;
    };
  }, []);

  const startSession = async () => {
    const response = await fetch('/api/student-sessions/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        assignmentId,
        shareToken,
      }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to start session');
    }

    const { sessionId } = await response.json();
    router.push(`/s/${shareToken}/editor/${sessionId}`);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          password,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Login failed');
      }

      const data = await response.json();
      if (data.user?.role !== 'student') {
        throw new Error('Please log in with a student account.');
      }

      await startSession();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/auth/send-magic-link', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name,
          email,
          shareToken,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to send verification email');
      }

      setVerificationSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signup failed');
    } finally {
      setIsLoading(false);
    }
  };

  if (verificationSent) {
    return (
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <div className="flex items-start gap-3">
          <div className="text-blue-600 text-2xl">📧</div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-blue-900 mb-2">
              Check Your Email
            </h3>
            <p className="text-blue-800 mb-3">
              We've sent a verification link to <strong>{email}</strong>
            </p>
            <p className="text-sm text-blue-700">
              Click the link in the email to set your password and access the assignment.
              The link will expire in 15 minutes.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!isChecking && currentUser?.role === 'student') {
    return (
      <div className="bg-green-50 border border-green-200 rounded-lg p-6">
        <div className="flex items-start gap-3">
          <div className="text-green-600 text-2xl">✅</div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-green-900 mb-2">
              Continue as {currentUser.name || currentUser.email}
            </h3>
            <p className="text-sm text-green-800 mb-4">
              We'll start your session for this assignment.
            </p>
            {error && (
              <div className="text-red-600 text-sm bg-red-50 p-3 rounded-lg mb-3">
                {error}
              </div>
            )}
            <button
              type="button"
              disabled={isLoading}
              onClick={async () => {
                setError('');
                setIsLoading(true);
                try {
                  await startSession();
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Failed to start session');
                } finally {
                  setIsLoading(false);
                }
              }}
              className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-medium"
            >
              {isLoading ? 'Starting...' : 'Start Assignment'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!isChecking && currentUser?.role === 'instructor') {
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
        <div className="flex items-start gap-3">
          <div className="text-yellow-600 text-2xl">⚠️</div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-yellow-900 mb-2">
              Instructor account detected
            </h3>
            <p className="text-sm text-yellow-800">
              Please log out and sign in with a student account to access this assignment.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Toggle buttons */}
      <div className="flex gap-2 mb-6">
        <button
          type="button"
          onClick={() => {
            setMode('login');
            setError('');
          }}
          className={`flex-1 py-2 px-4 rounded-lg font-medium transition-colors ${
            mode === 'login'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          Login
        </button>
        <button
          type="button"
          onClick={() => {
            setMode('signup');
            setError('');
          }}
          className={`flex-1 py-2 px-4 rounded-lg font-medium transition-colors ${
            mode === 'signup'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          Sign Up
        </button>
      </div>

      {mode === 'login' ? (
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label htmlFor="login-email" className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              type="email"
              id="login-email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="your.email@example.com"
            />
          </div>

          <div>
            <label htmlFor="login-password" className="block text-sm font-medium text-gray-700 mb-1">
              Password
            </label>
            <input
              type="password"
              id="login-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Your password"
            />
          </div>

          {error && (
            <div className="text-red-600 text-sm bg-red-50 p-3 rounded-lg">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-medium"
          >
            {isLoading ? 'Logging in...' : 'Login'}
          </button>
        </form>
      ) : (
        <form onSubmit={handleSignup} className="space-y-4">
          <div>
            <label htmlFor="signup-name" className="block text-sm font-medium text-gray-700 mb-1">
              Name
            </label>
            <input
              type="text"
              id="signup-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Enter your full name"
            />
          </div>

          <div>
            <label htmlFor="signup-email" className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              type="email"
              id="signup-email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="your.email@example.com"
            />
            <p className="mt-1 text-xs text-gray-500">
              You'll receive a verification email to set your password
            </p>
          </div>

          {error && (
            <div className="text-red-600 text-sm bg-red-50 p-3 rounded-lg">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-medium"
          >
            {isLoading ? 'Processing...' : 'Sign Up'}
          </button>
        </form>
      )}
    </div>
  );
}


