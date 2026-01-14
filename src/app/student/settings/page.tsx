import { db } from '@/db/db';
import { instructors } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import DeleteAccountButton from '@/app/instructor/settings/DeleteAccountButton';

async function getStudent() {
  const cookieStore = await cookies();
  const userId = cookieStore.get('user_session')?.value;

  if (!userId) {
    return null;
  }

  const user = await db.query.instructors.findFirst({
    where: eq(instructors.id, userId),
  });

  if (!user || user.role !== 'student') {
    return null;
  }

  return user;
}

export default async function StudentSettingsPage() {
  const student = await getStudent();

  if (!student) {
    redirect('/login');
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">SWAG</h1>
              <p className="text-sm text-gray-600">Student Settings</p>
            </div>
            <div className="flex items-center gap-4">
              <Link
                href="/student/dashboard"
                className="text-sm text-gray-600 hover:text-gray-800"
              >
                ← Back to Dashboard
              </Link>
              <form action="/api/auth/logout" method="POST">
                <button
                  type="submit"
                  className="text-sm text-red-600 hover:text-red-800"
                >
                  Logout
                </button>
              </form>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-6">
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Account Information
            </h2>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium text-gray-500">Email</label>
                <p className="text-gray-900">{student.email}</p>
              </div>
              {student.name && (
                <div>
                  <label className="text-sm font-medium text-gray-500">Name</label>
                  <p className="text-gray-900">{student.name}</p>
                </div>
              )}
              <div>
                <label className="text-sm font-medium text-gray-500">Member Since</label>
                <p className="text-gray-900">
                  {new Date(student.createdAt).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </p>
              </div>
              {student.lastLoginAt && (
                <div>
                  <label className="text-sm font-medium text-gray-500">Last Login</label>
                  <p className="text-gray-900">
                    {new Date(student.lastLoginAt).toLocaleString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="bg-white rounded-lg border border-red-200 p-6">
            <h2 className="text-lg font-semibold text-red-900 mb-2">
              Danger Zone
            </h2>
            <p className="text-sm text-gray-600 mb-4">
              Once you delete your account, there is no going back. This will permanently delete your account
              and all of your assignment data.
            </p>
            <DeleteAccountButton instructorId={student.id} />
          </div>
        </div>
      </main>
    </div>
  );
}
