import { NextResponse } from 'next/server';
import { db } from '@/db/db';
import { editorEvents } from '@/db/schema';
import { eq, and, asc } from 'drizzle-orm';
import { z } from 'zod';

const submissionsSchema = z.object({
  sessionId: z.string().uuid(),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const validated = submissionsSchema.parse(body);

    const submissions = await db
      .select()
      .from(editorEvents)
      .where(and(
        eq(editorEvents.sessionId, validated.sessionId),
        eq(editorEvents.eventType, 'submission')
      ))
      .orderBy(asc(editorEvents.sequenceNumber));

    return NextResponse.json({ submissions }, { status: 200 });
  } catch (error) {
    console.error('Load submissions error:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request', details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to load submissions' },
      { status: 500 }
    );
  }
}
