import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { db } from '@/db/db';
import { authTokens, instructors } from '@/db/schema';
import { eq, and, gt } from 'drizzle-orm';
import { hashPassword, validatePassword } from '@/lib/password';

export async function POST(request: Request) {
  try {
    const { token, password } = await request.json();

    if (!token || !password) {
      return NextResponse.json(
        { error: 'Token and password are required' },
        { status: 400 }
      );
    }

    // Validate password
    const validation = validatePassword(password);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400 }
      );
    }

    // Find the token in database
    const authToken = await db.query.authTokens.findFirst({
      where: and(
        eq(authTokens.token, token),
        eq(authTokens.used, false),
        eq(authTokens.type, 'verification'),
        gt(authTokens.expiresAt, new Date())
      ),
    });

    if (!authToken) {
      return NextResponse.json(
        { error: 'Link expired or invalid' },
        { status: 401 }
      );
    }

    // Mark token as used
    await db
      .update(authTokens)
      .set({ used: true })
      .where(eq(authTokens.id, authToken.id));

    // Get instructor
    const instructor = await db.query.instructors.findFirst({
      where: eq(instructors.email, authToken.email),
    });

    if (!instructor) {
      return NextResponse.json(
        { error: 'Instructor not found' },
        { status: 404 }
      );
    }

    // Hash password and update instructor
    const hashedPassword = await hashPassword(password);
    await db
      .update(instructors)
      .set({
        password: hashedPassword,
        isVerified: true,
        lastLoginAt: new Date(),
      })
      .where(eq(instructors.id, instructor.id));

    // Set session cookie
    const cookieStore = await cookies();
    cookieStore.set('instructor_session', instructor.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60, // 30 days
      path: '/',
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Set password error:', error);
    return NextResponse.json(
      { error: 'Failed to set password' },
      { status: 500 }
    );
  }
}
