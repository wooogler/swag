/**
 * Baseline prompt-revision proposal (parity with SCORE intents/[intentId]/propose).
 *   POST { mode:'feedback'|'edit_response', promptText, anchorMessageId,
 *          feedback?/editedResponse?, currentResponse? } → { revisedPrompt, rationale }
 * The agent only PROPOSES; the client shows a diff and applies on approval. Spec §5.2.
 */
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/db';
import { chatMessages } from '@/db/schema';
import { authorizeAssignment, authErrorResponse } from '@/lib/score/authz';
import { isOpenAIConfigured } from '@/lib/score/classifier';
import { proposeBaselineRevision } from '@/lib/study/revise-agent';
import { logStudyEvent } from '@/lib/study/baseline-store';

export const maxDuration = 60;

const schema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('feedback'),
    promptText: z.string().max(20000),
    anchorMessageId: z.number().int().positive(),
    feedback: z.string().trim().min(1).max(2000),
    currentResponse: z.string().trim().max(20000).optional(),
  }),
  z.object({
    mode: z.literal('edit_response'),
    promptText: z.string().max(20000),
    anchorMessageId: z.number().int().positive(),
    editedResponse: z.string().trim().min(1).max(20000),
    currentResponse: z.string().trim().max(20000).optional(),
  }),
]);

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorizeAssignment(id);
  if ('error' in auth) {
    const { body, status } = authErrorResponse(auth.error);
    return NextResponse.json(body, { status });
  }
  if (!isOpenAIConfigured()) return NextResponse.json({ error: 'openai_not_configured' }, { status: 503 });
  try {
    const body = schema.parse(await request.json());
    const msg = await db
      .select({ content: chatMessages.content })
      .from(chatMessages)
      .where(eq(chatMessages.id, body.anchorMessageId))
      .limit(1);
    if (!msg[0]) return NextResponse.json({ error: 'message_not_found' }, { status: 404 });

    const proposal = await proposeBaselineRevision({
      promptText: body.promptText,
      anchorQueryText: msg[0].content,
      currentResponse: body.currentResponse,
      mode: body.mode,
      feedback: body.mode === 'feedback' ? body.feedback : undefined,
      editedResponse: body.mode === 'edit_response' ? body.editedResponse : undefined,
    });
    await logStudyEvent(id, 'revise_submit', { mode: body.mode, anchorMessageId: body.anchorMessageId });
    return NextResponse.json({ revisedPrompt: proposal.revisedPrompt, rationale: proposal.rationale });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
    console.error('Baseline revise error:', error);
    return NextResponse.json({ error: 'revise_failed' }, { status: 502 });
  }
}
