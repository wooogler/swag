/**
 * "Test this query": what the chatbot would answer to one logged student query
 * under the current DRAFT prompt. Cached (baseline_previews). Spec §B-6.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeAssignment, authErrorResponse } from '@/lib/score/authz';
import { refuseSimpleClone } from '@/lib/study/simple/route-context';
import { ensureStudyTables } from '@/lib/study/store';
import { isChatConfigured } from '@/lib/study/chat-run';
import { getOrCreateBaselinePreview, logStudyEvent } from '@/lib/study/baseline-store';

const schema = z.object({ messageId: z.number().int().positive(), promptText: z.string().max(20000) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorizeAssignment(id);
  if ('error' in auth) {
    const { body, status } = authErrorResponse(auth.error);
    return NextResponse.json(body, { status });
  }
  // Not on a simple clone: that version has none of this, and letting it
  // through would write a second, disagreeing answer to "what is this
  // participant's configuration" (lib/study/simple/route-context).
  const wrongVersion = await refuseSimpleClone(id);
  if (wrongVersion) return wrongVersion;
  if (!isChatConfigured()) return NextResponse.json({ error: 'openai_not_configured' }, { status: 503 });
  await ensureStudyTables();
  try {
    const { messageId, promptText } = schema.parse(await request.json());
    const response = await getOrCreateBaselinePreview(id, messageId, promptText);
    await logStudyEvent(id, 'preview_generate', { messageId });
    return NextResponse.json({ response });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
    console.error('Baseline preview error:', error);
    return NextResponse.json({ error: 'preview_failed' }, { status: 500 });
  }
}
