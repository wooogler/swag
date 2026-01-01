import { db } from '@/db/db';
import { chatMessages } from '@/db/schema';
import { eq, asc } from 'drizzle-orm';

export async function POST(req: Request) {
  try {
    const { conversationId } = await req.json();

    if (!conversationId) {
      return new Response('Conversation ID is required', { status: 400 });
    }

    // Fetch all messages for this conversation, ordered by sequence
    const messages = await db.query.chatMessages.findMany({
      where: eq(chatMessages.conversationId, conversationId),
      orderBy: [asc(chatMessages.sequenceNumber)],
    });

    // Format messages for client
    const formattedMessages = messages.map((msg) => ({
      id: `msg_${msg.id}`,
      role: msg.role,
      content: msg.content,
    }));

    return Response.json({ messages: formattedMessages });
  } catch (error) {
    console.error('Failed to fetch messages:', error);
    return new Response('Internal server error', { status: 500 });
  }
}
