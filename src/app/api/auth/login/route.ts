import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { db } from '@/db/db';
import { instructors } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { verifyPassword } from '@/lib/password';
import { z } from 'zod';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, password } = loginSchema.parse(body);

    // Find user
    const user = await db.query.instructors.findFirst({
      where: eq(instructors.email, email),
    });

    if (!user) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    // Check if verified
    if (!user.isVerified || !user.password) {
      return NextResponse.json(
        { error: 'Account not verified. Please check your email for verification link.' },
        { status: 401 }
      );
    }

    // Verify password
    const isValid = await verifyPassword(password, user.password);
    if (!isValid) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    // Update last login
    await db
      .update(instructors)
      .set({ lastLoginAt: new Date() })
      .where(eq(instructors.id, user.id));

    // Set session cookie
    const cookieStore = await cookies();
    cookieStore.set('user_session', user.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60, // 30 days
      path: '/',
    });

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  } catch (error) {
    console.error('Login error:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid email or password format' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Login failed' },
      { status: 500 }
    );
  }
}
