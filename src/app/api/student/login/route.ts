import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { db } from '@/db/db';
import { studentSessions } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { verifyPassword } from '@/lib/password';
import { z } from 'zod';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  assignmentId: z.string().uuid(),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, password, assignmentId } = loginSchema.parse(body);

    // Find session for this email and assignment
    const session = await db.query.studentSessions.findFirst({
      where: and(
        eq(studentSessions.studentEmail, email),
        eq(studentSessions.assignmentId, assignmentId)
      ),
    });

    if (!session) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    // Check if verified
    if (!session.isVerified || !session.password) {
      return NextResponse.json(
        { error: 'Account not verified. Please check your email for verification link.' },
        { status: 401 }
      );
    }

    // Verify password
    const isValid = await verifyPassword(password, session.password);
    if (!isValid) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    // Update last login
    await db
      .update(studentSessions)
      .set({ lastLoginAt: new Date() })
      .where(eq(studentSessions.id, session.id));

    // Set session cookie
    const cookieStore = await cookies();
    cookieStore.set(`student_session_${assignmentId}`, session.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60, // 30 days
      path: '/',
    });

    return NextResponse.json({
      success: true,
      sessionId: session.id,
    });
  } catch (error) {
    console.error('Student login error:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Login failed' },
      { status: 500 }
    );
  }
}

