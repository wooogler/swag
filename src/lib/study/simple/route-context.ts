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
 * Authorize, and refuse a clone that belongs to the other version.
 *
 * An assignment that is not a study clone at all is allowed through, and that
 * is the researcher's preview: `?view=simple_score` on their own assignment
 * renders the simple board and can actually be used, because there is no
 * second configuration there for this one to disagree with. The refusal is
 * specifically about a clone whose participant is running the full version —
 * writing a snapshot onto that would leave two answers to "what is their
 * configuration", which is the thing this file exists to prevent.
 *
 * The same convention the full version already follows: a route acts on what
 * the CLONE is, and `?view` only ever changes what is drawn.
 */
export async function simpleContext(
  id: string,
  /** `?view=` from the request — honoured ONLY when there is no clone, so it
   * can pick an arm for a preview and can never re-dress a participant's. */
  viewParam?: string | null
): Promise<{ error: NextResponse } | { context: SimpleContext }> {
  const auth = await authorizeAssignment(id);
  if ('error' in auth) {
    const { body, status } = authErrorResponse(auth.error);
    return { error: NextResponse.json(body, { status }) };
  }
  await ensureStudyTables();
  const condition = await getCloneCondition(id);
  if (condition && familyOf(condition) !== 'simple') {
    return {
      error: NextResponse.json({ error: 'not_available_in_this_version' }, { status: 409 }),
    };
  }
  const preview =
    viewParam === 'simple_baseline' || viewParam === 'simple_score' ? viewParam : 'simple_score';
  return {
    context: {
      condition: condition ?? preview,
      seedPrompt: assignmentBasePrompt(auth.assignment),
    },
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
