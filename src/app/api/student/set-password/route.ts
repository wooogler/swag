import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { db } from '@/db/db';
import { authTokens, studentSessions } from '@/db/schema';
import { eq, and, gt } from 'drizzle-orm';
import { hashPassword, validatePassword } from '@/lib/password';
import { z } from 'zod';

const setPasswordSchema = z.object({
  token: z.string(),
  sessionId: z.string().uuid(),
  password: z.string().min(8),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { token, sessionId, password } = setPasswordSchema.parse(body);

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
        eq(authTokens.type, 'student_verification'),
        gt(authTokens.expiresAt, new Date())
      ),
    });

    if (!authToken) {
      return NextResponse.json(
        { error: 'Link expired or invalid' },
        { status: 401 }
      );
    }

    // Get session
    const session = await db.query.studentSessions.findFirst({
      where: and(
        eq(studentSessions.id, sessionId),
        eq(studentSessions.studentEmail, authToken.email)
      ),
    });

    if (!session) {
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 }
      );
    }

    // Mark token as used
    await db
      .update(authTokens)
      .set({ used: true })
      .where(eq(authTokens.id, authToken.id));

    // Hash password and update session
    const hashedPassword = await hashPassword(password);
    await db
      .update(studentSessions)
      .set({
        password: hashedPassword,
        isVerified: true,
        lastLoginAt: new Date(),
      })
      .where(eq(studentSessions.id, sessionId));

    // Set session cookie
    const cookieStore = await cookies();
    cookieStore.set(`student_session_${session.assignmentId}`, sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60, // 30 days
      path: '/',
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Set password error:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to set password' },
      { status: 500 }
    );
  }
}

