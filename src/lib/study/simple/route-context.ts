/**
 * The check every simple route starts with, and the check every FULL route
 * ends up needing because of it.
 *
 * The two versions share an assignment id and a URL prefix, and they must not
 * share anything else. A simple clone reaching the full version's routes would
 * spend calls on machinery its board cannot show — and worse, would write
 * intents and rule versions into a clone whose configuration lives entirely in
 * a snapshot, leaving two disagreeing answers to "what is this participant's
 * configuration". A full clone reaching the simple routes is the same accident
 * mirrored.
 *
 * So the gate is a fact about the clone, not about the UI: neither board has a
 * button that would do it, and this is what makes that true rather than
 * merely likely.
 */
import 'server-only';
import { NextResponse } from 'next/server';
import { assignmentBasePrompt } from '@/lib/assignment-ai';
import { authErrorResponse, authorizeAssignment } from '@/lib/score/authz';
import { getCloneCondition } from '../baseline-store';
import { ensureStudyTables } from '../store';
import { familyOf, type StudioView } from '../config';

export interface SimpleContext {
  condition: StudioView;
  /** The prompt this chatbot actually ran with — what an unsaved config is. */
  seedPrompt: string;
}

/**
 * Authorize, and refuse anything that is not a simple clone.
 *
 * Researchers previewing with `?view=simple_score` are refused too: the
 * preview renders a board, and a board that could write to a full clone's
 * timeline would be a preview with side effects.
 */
export async function simpleContext(
  id: string
): Promise<{ error: NextResponse } | { context: SimpleContext }> {
  const auth = await authorizeAssignment(id);
  if ('error' in auth) {
    const { body, status } = authErrorResponse(auth.error);
    return { error: NextResponse.json(body, { status }) };
  }
  await ensureStudyTables();
  const condition = await getCloneCondition(id);
  if (!condition || familyOf(condition) !== 'simple') {
    return {
      error: NextResponse.json({ error: 'not_a_simple_clone' }, { status: 409 }),
    };
  }
  return {
    context: { condition, seedPrompt: assignmentBasePrompt(auth.assignment) },
  };
}

/**
 * The mirror image, for the full version's routes: refuse a simple clone.
 *
 * Returns a response to send, or null to carry on. Called after the route's
 * own authorization, so it never leaks whether an assignment exists.
 */
export async function refuseSimpleClone(id: string): Promise<NextResponse | null> {
  const condition = await getCloneCondition(id);
  if (condition && familyOf(condition) === 'simple') {
    return NextResponse.json({ error: 'not_available_in_this_version' }, { status: 409 });
  }
  return null;
}
