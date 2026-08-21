/**
 * Deploy the baseline monolithic prompt to the student chat.
 *   POST → { versionNo }
 * Publishes the prompt-holder's CURRENT rule (the single source of truth, edited
 * only in Revise) — no client text. Saves it as a version (if changed) + marks it
 * deployed; the student runtime (/api/chat) serves the most-recently-deployed one.
 */
import { NextResponse } from 'next/server';
import { authorizeAssignment, authErrorResponse } from '@/lib/score/authz';
import { refuseSimpleClone } from '@/lib/study/simple/route-context';
import { ensureStudyTables } from '@/lib/study/store';
import { deployBaselinePrompt, logStudyEvent, resolveBaselineChatPrompt } from '@/lib/study/baseline-store';
import { warmClone } from '@/lib/study/warm';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
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
  await ensureStudyTables();
  try {
    const versionNo = await deployBaselinePrompt(id);
    // The baseline's counterpart to SCORE's coverage summary: there is one
    // rule and it always applies, so what is worth recording is its SIZE at
    // the moment it went live — the number the accumulation argument is about.
    const deployed = await resolveBaselineChatPrompt(id, '');
    await logStudyEvent(id, 'prompt_deploy', { versionNo, chars: deployed.length });
    // Start freezing this version's measurement answers now, while the
    // participant is still working. Deliberately not awaited (warm.ts).
    warmClone(id);
    return NextResponse.json({ versionNo });
  } catch (error) {
    console.error('Baseline deploy error:', error);
    return NextResponse.json({ error: 'deploy_failed' }, { status: 500 });
  }
}
