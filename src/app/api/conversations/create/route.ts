import { NextResponse } from 'next/server';
import { db } from '@/db/db';
import { chatConversations } from '@/db/schema';
import { z } from 'zod';

const createConversationSchema = z.object({
  sessionId: z.string().uuid(),
  title: z.string().min(1).max(200).optional(),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const validated = createConversationSchema.parse(body);

    const conversationId = crypto.randomUUID();
    const title = validated.title || 'New Conversation';

    await db.insert(chatConversations).values({
      id: conversationId,
      sessionId: validated.sessionId,
      title,
      createdAt: new Date(),
    });

    return NextResponse.json({ conversationId, title });
  } catch (error) {
    console.error('Conversation creation error:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid input', details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to create conversation' },
      { status: 500 }
    );
  }
}
