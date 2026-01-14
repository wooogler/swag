import { NextResponse } from 'next/server';
import { db } from '@/db/db';
import { editorEvents, studentSessions } from '@/db/schema';
import { z } from 'zod';
import { eq } from 'drizzle-orm';

const eventSchema = z.object({
  type: z.enum(['paste_internal', 'paste_external', 'snapshot', 'submission']),
  timestamp: z.number(),
  sequenceNumber: z.number(),
  data: z.any().optional(),
});

const saveEventsSchema = z.object({
  sessionId: z.string().uuid(),
  events: z.array(eventSchema),
});

export async function POST(request: Request) {
  try {
    // Check if body is empty (happens on beforeunload sometimes)
    const text = await request.text();
    if (!text || text.trim() === '') {
      return NextResponse.json({
        success: true,
        savedCount: 0,
        message: 'Empty request, skipped',
      });
    }

    const body = JSON.parse(text);
    const validated = saveEventsSchema.parse(body);

    // Verify session exists
    const session = await db.query.studentSessions.findFirst({
      where: eq(studentSessions.id, validated.sessionId),
    });

    if (!session) {
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 }
      );
    }

    // Insert events
    if (validated.events.length > 0) {
      await db.insert(editorEvents).values(
        validated.events.map((event) => ({
          sessionId: validated.sessionId,
          eventType: event.type,
          eventData: event.data || {},
          timestamp: new Date(event.timestamp),
          sequenceNumber: event.sequenceNumber,
        }))
      );

      // Update last saved time
      await db
        .update(studentSessions)
        .set({ lastSavedAt: new Date() })
        .where(eq(studentSessions.id, validated.sessionId));
    }

    return NextResponse.json({
      success: true,
      savedCount: validated.events.length,
    });
  } catch (error) {
    console.error('Event save error:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid input', details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to save events' },
      { status: 500 }
    );
  }
}
