import OpenAI from 'openai';
import { db } from '@/db/db';
import { assignments, chatMessages } from '@/db/schema';
import { eq } from 'drizzle-orm';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
  try {
    const { messages, conversationId, sessionId, assignmentId, webSearchEnabled } = await req.json();

    console.log('Chat API received:', { conversationId, sessionId, assignmentId, messagesCount: messages?.length, webSearchEnabled });

    // Validate conversationId
    if (!conversationId) {
      console.error('Missing conversationId');
      return new Response('Conversation ID is required', { status: 400 });
    }

    // Fetch assignment to get custom system prompt
    const assignment = await db.query.assignments.findFirst({
      where: eq(assignments.id, assignmentId),
    });

    if (!assignment) {
      return new Response('Assignment not found', { status: 404 });
    }

    // Build system prompt
    let systemPrompt =
      assignment.customSystemPrompt ||
      'You are a helpful writing assistant for students. Help them brainstorm ideas, structure their essays, and improve their writing. Encourage critical thinking and original work.';

    if (assignment.includeInstructionInPrompt) {
      systemPrompt += `\n\nAssignment Instructions:\n${assignment.instructions}`;
    }

    // Save user message immediately
    const lastMessage = messages[messages.length - 1];
    const userMessageContent = lastMessage.content;
    const userMessageTimestamp = new Date();
    const existingMessages = await db.query.chatMessages.findMany({
      where: eq(chatMessages.conversationId, conversationId),
    });

    await db.insert(chatMessages).values({
      conversationId,
      role: 'user',
      content: userMessageContent,
      metadata: { webSearchEnabled: webSearchEnabled || false },
      timestamp: userMessageTimestamp,
      sequenceNumber: existingMessages.length,
    });

    // Format messages for OpenAI Responses API (requires 'msg' prefix for IDs)
    const formattedMessages = messages.map((msg: any, idx: number) => ({
      id: msg.id?.startsWith('msg') ? msg.id : `msg_${Date.now()}_${idx}`,
      role: msg.role,
      content: msg.content,
    }));

    // Create streaming response using OpenAI Responses API
    const stream = await openai.responses.create({
      model: 'gpt-4o',
      input: [
        { id: 'msg_system', role: 'system', content: systemPrompt },
        ...formattedMessages,
      ],
      tools: webSearchEnabled ? [{ type: 'web_search' }] : undefined,
      stream: true,
    });

    // Convert OpenAI stream to Response stream
    const encoder = new TextEncoder();
    let fullResponse = '';
    let webSearchUsed = false;

    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of stream) {
            // Detect web search usage
            if (event.type === 'response.output_item.added') {
              const item = (event as any).item;
              if (item?.type === 'web_search_call') {
                webSearchUsed = true;
              }
            }

            // Handle different event types from Responses API
            if (event.type === 'response.output_text.delta') {
              const delta = event.delta || '';
              if (delta) {
                fullResponse += delta;
                controller.enqueue(encoder.encode(delta));
              }
            }
          }

          // Save assistant message to database after streaming completes
          const updatedMessages = await db.query.chatMessages.findMany({
            where: eq(chatMessages.conversationId, conversationId),
          });

          await db.insert(chatMessages).values({
            conversationId,
            role: 'assistant',
            content: fullResponse,
            metadata: {
              model: 'gpt-4o',
              webSearchEnabled: webSearchEnabled || false,
              webSearchUsed,
            },
            timestamp: new Date(),
            sequenceNumber: updatedMessages.length,
          });

          controller.close();
        } catch (error) {
          console.error('Streaming error:', error);
          controller.error(error);
        }
      },
    });

    return new Response(readableStream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
      },
    });
  } catch (error) {
    console.error('Chat API error:', error);
    return new Response('Internal server error', { status: 500 });
  }
}
