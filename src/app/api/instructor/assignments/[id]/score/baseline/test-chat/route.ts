/**
 * Baseline test-chat: one non-streaming turn under the instructor's DRAFT
 * monolithic prompt. Never persisted to the student log (event only). Spec §B-5.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeAssignment, authErrorResponse } from '@/lib/score/authz';
import { isChatConfigured, runChatTurn } from '@/lib/study/chat-run';
import { logStudyEvent } from '@/lib/study/baseline-store';

const schema = z.object({
  promptText: z.string().max(20000),
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })).min(1).max(60),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorizeAssignment(id);
  if ('error' in auth) {
    const { body, status } = authErrorResponse(auth.error);
    return NextResponse.json(body, { status });
  }
  if (!isChatConfigured()) return NextResponse.json({ error: 'openai_not_configured' }, { status: 503 });
  try {
    const { promptText, messages } = schema.parse(await request.json());
    const response = await runChatTurn(promptText, messages);
    await logStudyEvent(id, 'test_chat_message', { condition: 'baseline', turns: messages.length });
    return NextResponse.json({ response });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
    console.error('Baseline test-chat error:', error);
    return NextResponse.json({ error: 'chat_failed' }, { status: 500 });
  }
}
