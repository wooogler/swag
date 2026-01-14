import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { db } from '@/db/db';
import { assignments, instructors } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';

function generateShareToken(): string {
  // Generate a URL-friendly token
  return randomUUID().replace(/-/g, '').slice(0, 12);
}

export async function POST(request: Request) {
  try {
    // Verify instructor session
    const cookieStore = await cookies();
    const userId = cookieStore.get('user_session')?.value;

    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Verify instructor exists
    const instructor = await db.query.instructors.findFirst({
      where: eq(instructors.id, userId),
    });

    if (!instructor || instructor.role !== 'instructor') {
      return NextResponse.json(
        { error: 'Instructor not found' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { title, instructions, deadline, customSystemPrompt, includeInstructionInPrompt, allowWebSearch } = body;

    // Validate required fields
    if (!title || !instructions || !deadline) {
      return NextResponse.json(
        { error: 'Title, instructions, and deadline are required' },
        { status: 400 }
      );
    }

    // Parse deadline
    const deadlineDate = new Date(deadline);
    if (isNaN(deadlineDate.getTime())) {
      return NextResponse.json(
        { error: 'Invalid deadline format' },
        { status: 400 }
      );
    }

    const forwardedProto = request.headers.get('x-forwarded-proto') ?? 'http';
    const forwardedHost = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
    const baseUrl = forwardedHost
      ? `${forwardedProto}://${forwardedHost}`
      : (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000');

    // Create assignment
    const assignmentId = randomUUID();
    const shareToken = generateShareToken();

    await db.insert(assignments).values({
      id: assignmentId,
      title,
      instructions,
      deadline: deadlineDate,
      shareToken,
      instructorId: instructor.id,
      customSystemPrompt: customSystemPrompt || null,
      includeInstructionInPrompt: includeInstructionInPrompt || false,
      allowWebSearch: allowWebSearch || false,
      createdAt: new Date(),
    });

    return NextResponse.json({
      id: assignmentId,
      shareToken,
      shareUrl: `${baseUrl}/s/${shareToken}`,
    });
  } catch (error) {
    console.error('Failed to create assignment:', error);
    return NextResponse.json(
      { error: 'Failed to create assignment' },
      { status: 500 }
    );
  }
}
