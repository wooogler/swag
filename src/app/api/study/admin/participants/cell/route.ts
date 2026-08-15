/**
 * Reassign a participant's cell — only before they have started.
 *
 * The cell decides which dataset each block is and which condition it runs in,
 * and the condition is stamped on the clone rows, so moving it after a session
 * is under way would relabel work that was done under the other arm. Refused
 * once the phase has left `not_started`; the recovery for a mis-assigned
 * participant who has begun is Reset, which discards the work honestly.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db/db';
import { studyClones, studyParticipants } from '@/db/schema';
import { getInstructor, isAdministrator } from '@/lib/auth';
import { ensureStudyTables } from '@/lib/study/store';
import { planForCell, type StudyCell } from '@/lib/study/phases';
import { logParticipantEvent } from '@/lib/study/events';
import { adminCodeOf } from '@/lib/study/admin';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  participantId: z.string().min(1),
  cell: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
});

export async function POST(req: Request) {
  const instructor = await getInstructor();
  if (!instructor || !isAdministrator(instructor)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  await ensureStudyTables();

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
  if (participant.phase !== 'not_started') {
    return NextResponse.json(
      { error: 'They have already started. Reset their workspaces first.' },
      { status: 409 }
    );
  }

  const cell = parsed.cell as StudyCell;
  const plan = planForCell(cell);
  await db
    .update(studyParticipants)
    .set({ cell, blockOrder: plan.map((b) => b.datasetKey).join(',') })
    .where(eq(studyParticipants.id, participant.id));
  // The clone rows carry the condition too, and the export reads it from there.
  for (const block of plan) {
    await db
      .update(studyClones)
      .set({ condition: block.condition })
      .where(
        and(
          eq(studyClones.participantId, participant.id),
          eq(studyClones.datasetKey, block.datasetKey)
        )
      );
  }

  await logParticipantEvent(participant.id, 'cell_assigned', {
    cell,
    actor: adminCodeOf(instructor),
  });
  return NextResponse.json({ success: true, cell });
}
