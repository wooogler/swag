import { db } from '@/db/db';
import { chatConversations } from '@/db/schema';
import { eq, asc } from 'drizzle-orm';

export async function POST(req: Request) {
  try {
    const { sessionId } = await req.json();

    if (!sessionId) {
      return new Response('Session ID is required', { status: 400 });
    }

    // Fetch all conversations for this session, ordered by creation time
    const conversations = await db.query.chatConversations.findMany({
      where: eq(chatConversations.sessionId, sessionId),
      orderBy: [asc(chatConversations.createdAt)],
    });

    return Response.json({ conversations });
  } catch (error) {
    console.error('Failed to fetch conversations:', error);
    return new Response('Internal server error', { status: 500 });
  }
}
