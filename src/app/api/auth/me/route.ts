import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { db } from '@/db/db';
import { instructors } from '@/db/schema';
import { eq } from 'drizzle-orm';

export async function GET() {
  const cookieStore = await cookies();
  const userId = cookieStore.get('user_session')?.value;

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await db.query.instructors.findFirst({
    where: eq(instructors.id, userId),
  });

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    },
  });
}
