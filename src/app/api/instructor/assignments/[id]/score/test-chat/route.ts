/**
 * SCORE test-chat (parity with baseline): one non-streaming turn under the
 * CURRENT DRAFT intent→rule set (buildChatDeploySnapshot, NOT the deploy), so an
 * instructor can test edits before deploying. Never persisted (event only).
 * Spec §5.4 / S-3.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/db/db';
import { assignments } from '@/db/schema';
import { authorizeAssignment, authErrorResponse } from '@/lib/score/authz';
import { assignmentBasePrompt } from '@/lib/assignment-ai';
import { buildChatDeploySnapshot, resolveChatPromptFromSnapshot } from '@/lib/score/deploy-store';
import { isChatConfigured, runChatTurn } from '@/lib/study/chat-run';
import { logStudyEvent } from '@/lib/study/baseline-store';

const schema = z.object({
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
    const { messages } = schema.parse(await request.json());

    const assignment = await db.query.assignments.findFirst({ where: eq(assignments.id, id) });
    const basePrompt = assignmentBasePrompt(assignment ?? {});

    // Derive the classifier context from the message array: last user is the
    // query; the pair before it is the prior exchange.
    const lastUserIdx = messages.map((m) => m.role).lastIndexOf('user');
    const queryText = lastUserIdx >= 0 ? messages[lastUserIdx].content : messages[messages.length - 1].content;
    const before = messages.slice(0, Math.max(0, lastUserIdx));
    const prevAssistantIdx = before.map((m) => m.role).lastIndexOf('assistant');
    const prevResponseText = prevAssistantIdx >= 0 ? before[prevAssistantIdx].content : null;
    const prevUser = before.slice(0, prevAssistantIdx >= 0 ? prevAssistantIdx : before.length).filter((m) => m.role === 'user').pop();

    let systemPrompt = basePrompt;
    try {
      const snapshot = await buildChatDeploySnapshot(id); // current DRAFT
      const resolved = await resolveChatPromptFromSnapshot({
        snapshot,
        basePrompt,
        queryText,
        prevQueryText: prevUser?.content ?? null,
        prevResponseText,
      });
      systemPrompt = resolved.systemPrompt;
    } catch (e) {
      console.error('SCORE test-chat resolution failed (base prompt):', e); // fail-open
    }

    const response = await runChatTurn(systemPrompt, messages);
    await logStudyEvent(id, 'test_chat_message', { condition: 'score', turns: messages.length });
    return NextResponse.json({ response });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
    console.error('SCORE test-chat error:', error);
    return NextResponse.json({ error: 'chat_failed' }, { status: 500 });
  }
}
