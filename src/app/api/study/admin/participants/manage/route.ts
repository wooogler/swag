/**
 * Destructive session management: reset a participant's workspace, or remove
 * the participant entirely.
 *
 * Both wrap the existing, guarded helpers — resetting re-clones from the
 * current master (so a participant who got stuck starts clean without losing
 * their number), removing deletes clones AND the account. assertNotMaster
 * inside teardown refuses anything that is a source master, so a master
 * dataset can never be destroyed through here.
 *
 * These used to be reachable by participants themselves (/api/study/reset).
 * They belong to the facilitator: a participant resetting mid-session would
 * silently discard the block being measured.
 */
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/db';
import { studyParticipants } from '@/db/schema';
import { resetParticipant, resetParticipantDataset } from '@/lib/study/provision';
import { deleteParticipant } from '@/lib/study/teardown';
import { requireAdmin } from '@/lib/study/admin-guard';
import { logParticipantEvent } from '@/lib/study/events';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const bodySchema = z.object({
  participantId: z.string().min(1),
  action: z.enum(['reset_all', 'reset_dataset', 'remove']),
  datasetKey: z.string().min(1).optional(),
  /** The participant number, retyped. Guards the irreversible actions. */
  confirm: z.string().optional(),
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

  const [participant] = await db
    .select()
    .from(studyParticipants)
    .where(eq(studyParticipants.id, parsed.participantId));
  if (!participant) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Retyping the number is the confirmation: these throw away a participant's
  // whole session, and a mis-aimed click during a live study is unrecoverable.
  if (parsed.confirm?.trim().toUpperCase() !== participant.participantNumber) {
    return NextResponse.json(
      { error: 'confirm_mismatch', message: '참가자 번호를 정확히 입력해야 실행됩니다.' },
      { status: 400 }
    );
  }

  try {
    if (parsed.action === 'remove') {
      // Log BEFORE deleting: the row is about to be gone, and the event is the
      // only remaining trace that the session existed.
      await logParticipantEvent(participant.id, 'participant_removed', {
        participantNumber: participant.participantNumber,
        phase: participant.phase,
        by: gate.actor.code,
      });
      const clones = await deleteParticipant(participant);
      return NextResponse.json({ success: true, action: 'remove', clonesRemoved: clones });
    }

    if (parsed.action === 'reset_dataset') {
      if (!parsed.datasetKey) {
        return NextResponse.json({ error: 'dataset_required' }, { status: 400 });
      }
      await logParticipantEvent(participant.id, 'clone_reset', {
        datasetKey: parsed.datasetKey,
        phase: participant.phase,
        by: gate.actor.code,
      });
      const clone = await resetParticipantDataset(participant, parsed.datasetKey);
      return NextResponse.json({ success: true, action: 'reset_dataset', assignmentId: clone.assignmentId });
    }

    await logParticipantEvent(participant.id, 'clone_reset', {
      datasetKey: 'all',
      phase: participant.phase,
      by: gate.actor.code,
    });
    const result = await resetParticipant(participant);
    return NextResponse.json({
      success: true,
      action: 'reset_all',
      clones: result.clones.length,
    });
  } catch (err) {
    console.error('participant manage error:', err);
    return NextResponse.json(
      { error: 'manage_failed', message: (err as Error).message },
      { status: 500 }
    );
  }
}
