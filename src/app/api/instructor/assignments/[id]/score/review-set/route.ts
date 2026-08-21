/**
 * Review set (shared, both conditions). scope='prompt' (baseline) | 'intent:<id>' (score).
 *   GET ?scope=…                          → { items }
 *   POST { scope, messageIds[], source }  → add
 *   DELETE ?scope=…&messageId=…           → remove
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeAssignment, authErrorResponse } from '@/lib/score/authz';
import { refuseSimpleClone } from '@/lib/study/simple/route-context';
import { ensureStudyTables } from '@/lib/study/store';
import { addToReviewSet, listReviewSet, logStudyEvent, removeFromReviewSet } from '@/lib/study/baseline-store';

async function guard(id: string) {
  const auth = await authorizeAssignment(id);
  if ('error' in auth) {
    const { body, status } = authErrorResponse(auth.error);
    return { fail: NextResponse.json(body, { status }) };
  }
  await ensureStudyTables();
  // Not on a simple clone: that version has none of this, and letting it
  // through would write a second, disagreeing answer to "what is this
  // participant's configuration" (lib/study/simple/route-context).
  const wrongVersion = await refuseSimpleClone(id);
  if (wrongVersion) return { fail: wrongVersion };
  return { ok: true as const };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guard(id);
  if ('fail' in g) return g.fail;
  const scope = new URL(request.url).searchParams.get('scope') ?? 'prompt';
  return NextResponse.json({ items: await listReviewSet(id, scope) });
}

const addSchema = z.object({
  scope: z.string().min(1),
  messageIds: z.array(z.number().int().positive()).min(1).max(200),
  source: z.enum(['auto', 'manual', 'similar', 'search']).default('manual'),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guard(id);
  if ('fail' in g) return g.fail;
  try {
    const { scope, messageIds, source } = addSchema.parse(await request.json());
    await addToReviewSet(id, scope, messageIds, source);
    await logStudyEvent(id, 'set_add', { scope, count: messageIds.length, source });
    return NextResponse.json({ items: await listReviewSet(id, scope) });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
    console.error('Review-set add error:', error);
    return NextResponse.json({ error: 'add_failed' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guard(id);
  if ('fail' in g) return g.fail;
  const url = new URL(request.url);
  const scope = url.searchParams.get('scope') ?? 'prompt';
  const messageId = Number(url.searchParams.get('messageId'));
  if (!Number.isFinite(messageId)) return NextResponse.json({ error: 'missing_messageId' }, { status: 400 });
  await removeFromReviewSet(id, scope, messageId);
  await logStudyEvent(id, 'set_remove', { scope, messageId });
  return NextResponse.json({ items: await listReviewSet(id, scope) });
}
