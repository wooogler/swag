import { NextResponse } from 'next/server';
import { db } from '@/db/db';
import { authTokens, studentSessions } from '@/db/schema';
import { z } from 'zod';
import crypto from 'crypto';
import { eq, and } from 'drizzle-orm';

const emailSchema = z.object({
  email: z.string().email(),
  sessionId: z.string().uuid(),
  assignmentId: z.string().uuid(),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, sessionId, assignmentId } = emailSchema.parse(body);

    // Verify that the session exists and matches the email
    const session = await db.query.studentSessions.findFirst({
      where: and(
        eq(studentSessions.id, sessionId),
        eq(studentSessions.studentEmail, email),
        eq(studentSessions.assignmentId, assignmentId)
      ),
    });

    if (!session) {
      return NextResponse.json(
        { error: 'Session not found or email mismatch' },
        { status: 404 }
      );
    }

    // If already verified, don't send another link
    if (session.isVerified) {
      return NextResponse.json(
        { error: 'This session is already verified' },
        { status: 400 }
      );
    }

    // Generate magic link token
    const token = crypto.randomBytes(32).toString('hex');
    const tokenId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    // Save token to database
    await db.insert(authTokens).values({
      id: tokenId,
      email,
      token,
      type: 'student_verification',
      expiresAt,
      used: false,
      createdAt: new Date(),
    });

    // Build magic link URL
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const magicLink = `${baseUrl}/student/verify?token=${token}&sessionId=${sessionId}`;

    // In development, log the link; in production, send email
    if (process.env.NODE_ENV === 'development') {
      console.log('\n========================================');
      console.log('STUDENT VERIFICATION LINK (Development Mode)');
      console.log('========================================');
      console.log(`Email: ${email}`);
      console.log(`Session ID: ${sessionId}`);
      console.log(`Link: ${magicLink}`);
      console.log('========================================\n');
      
      // 개발 모드에서도 실제 이메일 발송 테스트 (GMAIL_USER가 설정되어 있으면)
      if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
        console.log('📧 Gmail SMTP로 실제 이메일 발송 중...');
        try {
          const { sendStudentVerificationEmail } = await import('@/lib/email');
          await sendStudentVerificationEmail({
            to: email,
            magicLink,
            studentName: session.studentName,
          });
          console.log('✅ 이메일 발송 성공!');
        } catch (error) {
          console.error('❌ 이메일 발송 실패:', error);
        }
      }
    } else {
      // Send verification email via Gmail
      const { sendStudentVerificationEmail } = await import('@/lib/email');
      await sendStudentVerificationEmail({
        to: email,
        magicLink,
        studentName: session.studentName,
      });
    }

    return NextResponse.json({
      success: true,
      message: 'Verification link sent to your email',
      // Only include link in development for testing
      ...(process.env.NODE_ENV === 'development' && { link: magicLink }),
    });
  } catch (error) {
    console.error('Student verification link error:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to send verification link' },
      { status: 500 }
    );
  }
}

