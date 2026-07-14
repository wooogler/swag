/**
 * Baseline monolithic-prompt versions.
 *   GET               → { versions } (list, newest first)
 *   GET ?versionNo=N  → { prompt }   (restore one version's full text)
 *   POST { prompt }   → { versionNo } (Save — new coarse version, deduped)
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeAssignment, authErrorResponse } from '@/lib/score/authz';
import { ensureStudyTables } from '@/lib/study/store';
import { STUDY_PROMPT_CHAR_LIMIT } from '@/lib/study/config';
import {
  getBaselineState,
  getBaselineVersion,
  logStudyEvent,
  saveBaselineVersion,
} from '@/lib/study/baseline-store';

const saveSchema = z.object({ prompt: z.string().max(STUDY_PROMPT_CHAR_LIMIT) });

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorizeAssignment(id);
  if ('error' in auth) {
    const { body, status } = authErrorResponse(auth.error);
    return NextResponse.json(body, { status });
  }
  await ensureStudyTables();
  const versionNoParam = new URL(request.url).searchParams.get('versionNo');
  if (versionNoParam) {
    const prompt = await getBaselineVersion(id, Number(versionNoParam));
    if (prompt === null) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json({ prompt });
  }
  const state = await getBaselineState(id);
  return NextResponse.json({ versions: state.versions, deployedVersionNo: state.deployedVersionNo });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorizeAssignment(id);
  if ('error' in auth) {
    const { body, status } = authErrorResponse(auth.error);
    return NextResponse.json(body, { status });
  }
  await ensureStudyTables();
  try {
    const { prompt } = saveSchema.parse(await request.json());
    const versionNo = await saveBaselineVersion(id, prompt);
    await logStudyEvent(id, 'prompt_save', { versionNo, chars: prompt.length });
    return NextResponse.json({ versionNo });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'invalid_prompt' }, { status: 400 });
    console.error('Baseline save error:', error);
    return NextResponse.json({ error: 'save_failed' }, { status: 500 });
  }
}
