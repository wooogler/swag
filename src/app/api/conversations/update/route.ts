import { NextResponse } from 'next/server';
import { db } from '@/db/db';
import { chatConversations } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

const updateConversationSchema = z.object({
  conversationId: z.string().uuid(),
  title: z.string().min(1).max(200),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const validated = updateConversationSchema.parse(body);

    await db
      .update(chatConversations)
      .set({ title: validated.title })
      .where(eq(chatConversations.id, validated.conversationId));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Conversation update error:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid input', details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to update conversation' },
      { status: 500 }
    );
  }
}
