/**
 * Baseline search PRESETS = the clone's template intents (read-only).
 *   GET             → { presets: [{intentId, title}] }
 *   GET ?intentId=N → { clearlyIn } (instant, from copied intent ratings — no LLM)
 */
import { NextResponse } from 'next/server';
import { authorizeAssignment, authErrorResponse } from '@/lib/score/authz';
import { ensureIntentTables } from '@/lib/score/intent-store';
import { getPresetClearlyIn, listPresets } from '@/lib/study/probe';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorizeAssignment(id);
  if ('error' in auth) {
    const { body, status } = authErrorResponse(auth.error);
    return NextResponse.json(body, { status });
  }
  await ensureIntentTables();
  const intentIdParam = new URL(request.url).searchParams.get('intentId');
  if (intentIdParam) {
    const clearlyIn = await getPresetClearlyIn(id, Number(intentIdParam));
    return NextResponse.json({ clearlyIn });
  }
  const presets = await listPresets(id);
  return NextResponse.json({ presets });
}
