import { NextResponse } from 'next/server';
import { db } from '@/db/db';
import { authTokens, studentSessions } from '@/db/schema';
import { eq, and, gt } from 'drizzle-orm';
import { z } from 'zod';

const verifySchema = z.object({
  token: z.string(),
  sessionId: z.string().uuid(),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { token, sessionId } = verifySchema.parse(body);

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

    // Verify the session exists and matches
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

    // Don't mark token as used yet - will be used when setting password
    return NextResponse.json({
      success: true,
      session: {
        id: session.id,
        studentName: session.studentName,
        studentEmail: session.studentEmail,
      },
    });
  } catch (error) {
    console.error('Student token verification error:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Verification failed' },
      { status: 500 }
    );
  }
}

