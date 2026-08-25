/**
 * Open a recording run.
 *
 * The client mints the id (it needs a name for its first chunk before any round
 * trip returns) and declares its codec; everything else is read from the
 * participant's own row. The BLOCK in particular is derived, never accepted —
 * a client that could name its own block could file a block-2 recording under
 * block 1 and no later reader would know.
 *
 * `block: 0` is the equipment check, which happens before the session starts,
 * so it is the one case that is allowed outside a configure phase.
 */
import { NextResponse } from 'next/server';
import { getCurrentStudyParticipant } from '@/lib/study/session';
import { blockOf, isStudyPhase, phaseAccess } from '@/lib/study/phases';
import { startRecording } from '@/lib/study/recording-store';
import { logParticipantEvent } from '@/lib/study/events';
import { cloneForBlock } from '@/lib/study/measure-store';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const participant = await getCurrentStudyParticipant();
  if (!participant) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const id = typeof body?.id === 'string' ? body.id : '';
  const mimeType = typeof body?.mimeType === 'string' ? body.mimeType.slice(0, 120) : '';
  const probe = body?.probe === true;
  if (!UUID_RE.test(id) || !mimeType) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const phase = isStudyPhase(participant.phase) ? participant.phase : 'not_started';

  // A real block recording only exists while a board is open. Checked through
  // phaseAccess rather than by comparing phase strings, so this cannot drift
  // from the gate that decides which board the participant may open at all.
  let block = 0;
  let assignmentId: string | null = null;
  if (!probe) {
    if (!phaseAccess(participant, phase).workDatasetKey) {
      return NextResponse.json({ error: 'not_work_phase', phase }, { status: 409 });
    }
    const n = blockOf(phase);
    if (n !== 1 && n !== 2) {
      return NextResponse.json({ error: 'not_work_phase', phase }, { status: 409 });
    }
    block = n;
    assignmentId = (await cloneForBlock(participant, n))?.assignmentId ?? null;
  }

  const { segment } = await startRecording({
    id,
    participantId: participant.id,
    block,
    assignmentId,
    phase,
    mimeType,
    client: body?.client ?? null,
  });

  await logParticipantEvent(participant.id, 'recording_started', { id, block, segment, mimeType });
  return NextResponse.json({ ok: true, block, segment });
}
