import { openai } from '@ai-sdk/openai';
import { streamText } from 'ai';
import { db } from '@/db/db';
import { assignments, chatMessages } from '@/db/schema';
import { eq } from 'drizzle-orm';

export async function POST(req: Request) {
  try {
    const { messages, conversationId, sessionId, assignmentId } = await req.json();

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

    // Stream response from OpenAI
    const result = await streamText({
      model: openai('gpt-4-turbo'),
      messages: messages,
      system: systemPrompt,
      async onFinish({ text, usage }) {
        // Save assistant message to database
        try {
          const lastMessage = messages[messages.length - 1];
          const userSequence = await db.query.chatMessages.findMany({
            where: eq(chatMessages.conversationId, conversationId),
          });

          // Save user message
          await db.insert(chatMessages).values({
            conversationId,
            role: 'user',
            content: lastMessage.content,
            metadata: {},
            timestamp: new Date(),
            sequenceNumber: userSequence.length,
          });

          // Save assistant message
          await db.insert(chatMessages).values({
            conversationId,
            role: 'assistant',
            content: text,
            metadata: { tokens: usage, model: 'gpt-4-turbo' },
            timestamp: new Date(),
            sequenceNumber: userSequence.length + 1,
          });
        } catch (error) {
          console.error('Failed to save chat messages:', error);
        }
      },
    });

    return result.toDataStreamResponse();
  } catch (error) {
    console.error('Chat API error:', error);
    return new Response('Internal server error', { status: 500 });
  }
}
