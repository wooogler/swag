/**
 * Participant self-reset — CLOSED.
 *
 * This used to let a participant re-clone their own workspace from the header.
 * During a moderated session that is a foot-gun: a reset mid-block silently
 * discards the work being measured, and any frozen block-test or A/B answers
 * would suddenly refer to a workspace that no longer exists (their clone gets a
 * fresh assignment id). Resets now belong to the facilitator console
 * (/api/study/admin/participants/manage), which records who did it and when.
 *
 * The route stays so that any client still calling it gets a clear refusal
 * rather than a 404 that reads like a bug.
 */
import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    { error: 'Resets are handled by the study facilitator.' },
    { status: 403 }
  );
}
