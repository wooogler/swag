/**
 * Close a recording run.
 *
 * `chunks` is what the client believes it produced. Keeping it beside what
 * actually arrived is the only way anything downstream can tell a complete
 * recording from a truncated one — the file itself plays either way.
 */
import { NextResponse } from 'next/server';
import { getCurrentStudyParticipant } from '@/lib/study/session';
import { finishRecording, recordingFor, type RecordingEndReason } from '@/lib/study/recording-store';
import { logParticipantEvent } from '@/lib/study/events';

export const dynamic = 'force-dynamic';

const REASONS: RecordingEndReason[] = ['finished', 'track_ended', 'unload', 'probe', 'error'];

export async function POST(request: Request) {
  const participant = await getCurrentStudyParticipant();
  if (!participant) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // sendBeacon posts a Blob, so this may arrive as text rather than JSON.
  const raw = await request.text();
  let body: Record<string, unknown> = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  const recording = await recordingFor(id, participant.id);
  if (!recording) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const chunks = typeof body.chunks === 'number' && body.chunks >= 0 ? body.chunks : null;
  const reason = REASONS.includes(body.reason as RecordingEndReason)
    ? (body.reason as RecordingEndReason)
    : 'error';

  await finishRecording({ id, chunksDeclared: chunks, reason });
  await logParticipantEvent(participant.id, 'recording_stopped', {
    id,
    block: recording.block,
    segment: recording.segment,
    reason,
    declared: chunks,
    stored: recording.chunksStored,
  });
  return new NextResponse(null, { status: 204 });
}
