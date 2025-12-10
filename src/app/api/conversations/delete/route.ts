import { NextResponse } from 'next/server';
import { db } from '@/db/db';
import { chatConversations, chatMessages } from '@/db/schema';
import { eq } from 'drizzle-orm';

export async function POST(request: Request) {
  try {
    const { conversationId } = await request.json();

    if (!conversationId) {
      return NextResponse.json(
        { error: 'Conversation ID is required' },
        { status: 400 }
      );
    }

    // Delete messages first (foreign key constraint)
    await db.delete(chatMessages).where(eq(chatMessages.conversationId, conversationId));

    // Delete conversation
    await db.delete(chatConversations).where(eq(chatConversations.id, conversationId));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete conversation:', error);
    return NextResponse.json(
      { error: 'Failed to delete conversation' },
      { status: 500 }
    );
  }
}
