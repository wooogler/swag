import { NextResponse } from 'next/server';
import { db } from '@/db/db';
import { authTokens, instructors } from '@/db/schema';
import { z } from 'zod';
import crypto from 'crypto';

const emailSchema = z.object({
  email: z.string().email(),
});

// Allowed email domains (can be configured via env)
const ALLOWED_DOMAINS = process.env.ALLOWED_EMAIL_DOMAINS?.split(',') || ['vt.edu'];

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email } = emailSchema.parse(body);

    // Check if email domain is allowed
    const domain = email.split('@')[1];
    if (!ALLOWED_DOMAINS.includes(domain)) {
      return NextResponse.json(
        { error: `Only ${ALLOWED_DOMAINS.join(', ')} email addresses are allowed` },
        { status: 403 }
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
      expiresAt,
      used: false,
      createdAt: new Date(),
    });

    // Check if instructor exists
    const existingInstructor = await db.query.instructors.findFirst({
      where: (instructors, { eq }) => eq(instructors.email, email),
    });

    // If instructor exists and is already verified, they should use login instead
    if (existingInstructor?.isVerified) {
      return NextResponse.json(
        { error: 'Account already exists. Please use login instead.' },
        { status: 400 }
      );
    }

    // Create new instructor if doesn't exist
    if (!existingInstructor) {
      await db.insert(instructors).values({
        id: crypto.randomUUID(),
        email,
        isVerified: false,
        createdAt: new Date(),
      });
    }

    // Build magic link URL
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const magicLink = `${baseUrl}/instructor/verify?token=${token}`;

    // In development, log the link; in production, send email
    if (process.env.NODE_ENV === 'development') {
      console.log('\n========================================');
      console.log('EMAIL VERIFICATION LINK (Development Mode)');
      console.log('========================================');
      console.log(`Email: ${email}`);
      console.log(`Link: ${magicLink}`);
      console.log('========================================\n');
    } else {
      // Send verification email via Resend
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
