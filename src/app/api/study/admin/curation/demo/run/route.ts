/**
 * Start a demo: build the workspace, then hand the browser the demo
 * participant's own session, already inside the studio.
 *
 * Swapping `user_session` rather than adding a preview mode is the whole design
 * (demo.ts). From the redirect onward the researcher IS a participant as far as
 * every page is concerned, so what they see and record cannot drift from what a
 * participant gets — landing straight on the board skips a click, not a code
 * path: it is the same board the participant's own session page links to.
 *
 * The researcher's own id is stashed in a return cookie, and /study/admin
 * spends it to put them back. Nothing about the demo itself is decorated with
 * an exit control: a banner would be in the recording.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { requireAdmin } from '@/lib/study/admin-guard';
import { ADMIN_RETURN_COOKIE, ensureDemoWorkspace } from '@/lib/study/demo';
import { STUDY_SESSION_MAX_AGE_SECONDS } from '@/lib/study/config';

export const dynamic = 'force-dynamic';
export const maxDuration = 800;

const bodySchema = z.object({
  datasetKey: z.string().min(1),
  condition: z.enum(['score', 'baseline']),
  /**
   * Where to land. 'board' by default: a demo exists to show the studio, and
   * the session page in front of it is a click to film past. 'session' is kept
   * for walking the whole protocol — the walkthrough step, the block test, the
   * survey, the blind A/B — which is a different recording.
   */
  start: z.enum(['session', 'board']).default('board'),
});

export async function POST(req: Request) {
  const gate = await requireAdmin();
  if (gate.response) return gate.response;

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  let workspace;
  try {
    workspace = await ensureDemoWorkspace({
      datasetKey: parsed.datasetKey,
      condition: parsed.condition,
    });
  } catch (err) {
    const message =
      (err as Error).message === 'no_demo_questions'
        ? 'None of the selected subtypes have questions in this dataset.'
        : `Could not build the demo: ${(err as Error).message}`;
    return NextResponse.json({ error: 'demo_failed', message }, { status: 409 });
  }

  const cookieStore = await cookies();
  const common = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/',
  };
  // Written BEFORE the swap, and only ever holding an id the caller already
  // had in user_session — the same secret, not a new one.
  cookieStore.set(ADMIN_RETURN_COOKIE, gate.actor.id, {
    ...common,
    maxAge: STUDY_SESSION_MAX_AGE_SECONDS,
  });
  cookieStore.set('user_session', workspace.participant.instructorId, {
    ...common,
    maxAge: STUDY_SESSION_MAX_AGE_SECONDS,
  });

  return NextResponse.json({
    success: true,
    url:
      parsed.start === 'board'
        ? `/instructor/assignments/${workspace.assignmentId}/score`
        : '/study/session',
    participantNumber: workspace.participant.participantNumber,
    questions: workspace.questions,
    threads: workspace.threads,
  });
}
