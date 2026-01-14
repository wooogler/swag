import { NextResponse } from 'next/server';
import { db } from '@/db/db';
import { authTokens, instructors } from '@/db/schema';
import { eq, and, gt } from 'drizzle-orm';

export async function POST(request: Request) {
  try {
    const { token } = await request.json();

    if (!token) {
      return NextResponse.json(
        { error: 'No token provided' },
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

    const user = await db.query.instructors.findFirst({
      where: eq(instructors.email, authToken.email),
    });

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // Return email without marking token as used (will be used when setting password)
    return NextResponse.json({
      email: authToken.email,
      role: user.role,
    });
  } catch (error) {
    console.error('Token verification error:', error);
    return NextResponse.json(
      { error: 'Verification failed' },
      { status: 500 }
    );
  }
}
