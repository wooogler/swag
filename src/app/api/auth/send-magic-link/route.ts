import { NextResponse } from 'next/server';
import { db } from '@/db/db';
import { authTokens, instructors } from '@/db/schema';
import { z } from 'zod';
import crypto from 'crypto';

const signupSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100).optional(),
  passcode: z.string().optional(),
  shareToken: z.string().optional(),
});

// Allowed email domains (can be configured via env)
const ALLOWED_DOMAINS = process.env.ALLOWED_EMAIL_DOMAINS?.split(',') || ['vt.edu'];

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, name, passcode, shareToken } = signupSchema.parse(body);

    const trimmedPasscode = passcode?.trim();
    const instructorPasscode = process.env.INSTRUCTOR_PASSCODE;
    let role: 'instructor' | 'student' = 'student';

    if (trimmedPasscode) {
      // Instructor signup still enforces allowed domains
      const domain = email.split('@')[1];
      if (!ALLOWED_DOMAINS.includes(domain)) {
        return NextResponse.json(
          { error: `Only ${ALLOWED_DOMAINS.join(', ')} email addresses are allowed` },
          { status: 403 }
        );
      }

      if (!instructorPasscode || trimmedPasscode !== instructorPasscode) {
        return NextResponse.json(
          { error: 'Invalid instructor passcode' },
          { status: 403 }
        );
      }
      role = 'instructor';
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
      expiresAt,
      used: false,
      createdAt: new Date(),
    });

    // Check if user exists
    const existingUser = await db.query.instructors.findFirst({
      where: (instructors, { eq }) => eq(instructors.email, email),
    });

    // If user exists and is already verified, they should use login instead
    if (existingUser?.isVerified) {
      return NextResponse.json(
        { error: 'Account already exists. Please use login instead.' },
        { status: 400 }
      );
    }

    if (existingUser && existingUser.role !== role) {
      return NextResponse.json(
        { error: 'Account already exists with a different role.' },
        { status: 400 }
      );
    }

    // Create new user if doesn't exist
    if (!existingUser) {
      await db.insert(instructors).values({
        id: crypto.randomUUID(),
        email,
        name: name ?? null,
        role,
        isVerified: false,
        createdAt: new Date(),
      });
    } else if (name && !existingUser.name) {
      await db
        .update(instructors)
        .set({ name })
        .where((instructors, { eq }) => eq(instructors.id, existingUser.id));
    }

    // Build magic link URL
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const magicLink = `${baseUrl}/verify?token=${token}${shareToken ? `&shareToken=${encodeURIComponent(shareToken)}` : ''}`;

    // In development, log the link; in production, send email
    if (process.env.NODE_ENV === 'development') {
      console.log('\n========================================');
      console.log('EMAIL VERIFICATION LINK (Development Mode)');
      console.log('========================================');
      console.log(`Email: ${email}`);
      console.log(`Link: ${magicLink}`);
      console.log('========================================\n');
      
      // 개발 모드에서도 실제 이메일 발송 테스트 (GMAIL_USER가 설정되어 있으면)
      if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
        console.log('📧 Gmail SMTP로 실제 이메일 발송 중...');
        try {
          const { sendMagicLink: sendVerificationEmail } = await import('@/lib/email');
          await sendVerificationEmail({
            to: email,
            magicLink,
          });
          console.log('✅ 이메일 발송 성공!');
        } catch (error) {
          console.error('❌ 이메일 발송 실패:', error);
        }
      }
    } else {
      // Send verification email via Gmail
      const { sendMagicLink: sendVerificationEmail } = await import('@/lib/email');
      await sendVerificationEmail({
        to: email,
        magicLink,
      });
    }

    return NextResponse.json({
      success: true,
      message: 'Verification link sent to your email',
      // Only include link in development for testing
      ...(process.env.NODE_ENV === 'development' && { link: magicLink }),
    });
  } catch (error) {
    console.error('Magic link error:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid email address' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to send login link' },
      { status: 500 }
    );
  }
}
