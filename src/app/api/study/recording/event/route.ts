/**
 * Whatever the recorder wants on the record: a denied permission, the wrong
 * surface shared, a check skipped, sharing stopped mid-block.
 *
 * Always 204, including for input it rejects — the same posture as the UI event
 * route. This is instrumentation sitting behind a participant who is mid-task;
 * an error surfacing from it would be a problem they cannot act on, reported at
 * the worst possible moment. What it must never do is fail silently on OUR
 * side, which is why every outcome the check can have gets sent here and shows
 * up in the console.
 */
import { NextResponse } from 'next/server';
import { getCurrentStudyParticipant } from '@/lib/study/session';
import { logParticipantEvent } from '@/lib/study/events';

export const dynamic = 'force-dynamic';

const KINDS = new Set([
  'check_started',
  'check_passed',
  'check_failed',
  'check_skipped',
  'playback_confirmed',
  'playback_rejected',
  'permission_denied',
  'wrong_surface',
  'unsupported_browser',
  'track_ended',
  'resumed',
  'upload_failed',
]);

export async function POST(request: Request) {
  const participant = await getCurrentStudyParticipant();
  if (!participant) return new NextResponse(null, { status: 204 });

  const raw = await request.text();
  let body: Record<string, unknown> = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  const kind = typeof body.kind === 'string' ? body.kind : '';
  if (!KINDS.has(kind)) return new NextResponse(null, { status: 204 });

  await logParticipantEvent(participant.id, `recording_${kind}`, {
    ...(body.payload && typeof body.payload === 'object' ? body.payload : {}),
  });
  return new NextResponse(null, { status: 204 });
}
