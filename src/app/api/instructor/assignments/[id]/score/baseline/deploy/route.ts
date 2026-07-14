/**
 * Deploy the baseline monolithic prompt to the student chat.
 *   POST { prompt } → { versionNo }
 * Saves the current text as a version (if changed) and marks it deployed; the
 * student runtime (/api/chat) then serves the most-recently-deployed version.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeAssignment, authErrorResponse } from '@/lib/score/authz';
import { ensureStudyTables } from '@/lib/study/store';
import { STUDY_PROMPT_CHAR_LIMIT } from '@/lib/study/config';
import { deployBaselineVersion, logStudyEvent } from '@/lib/study/baseline-store';

const schema = z.object({ prompt: z.string().max(STUDY_PROMPT_CHAR_LIMIT) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorizeAssignment(id);
  if ('error' in auth) {
    const { body, status } = authErrorResponse(auth.error);
    return NextResponse.json(body, { status });
  }
  await ensureStudyTables();
  try {
    const { prompt } = schema.parse(await request.json());
    const versionNo = await deployBaselineVersion(id, prompt);
    await logStudyEvent(id, 'prompt_deploy', { versionNo });
    return NextResponse.json({ versionNo });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'invalid_prompt' }, { status: 400 });
    console.error('Baseline deploy error:', error);
    return NextResponse.json({ error: 'deploy_failed' }, { status: 500 });
  }
}
