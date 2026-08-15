/**
 * Create a participant, in a cell the researcher picks, and hand back a link.
 *
 * This replaces self-service sign-up. The cell used to fall out of arithmetic
 * on the participant number (n % 4), so the design was decided by whatever the
 * next person happened to be called and renumbering someone moved them to a
 * different condition order. Assigning it here makes the counterbalancing a
 * deliberate act with a record, and lets the researcher fill the cells evenly
 * as recruitment actually lands.
 *
 * The clones are built now rather than at the participant's first click: it is
 * ~15 seconds of cloning per person, and it belongs in the researcher's setup
 * time, not in front of a participant who has just sat down.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/db/db';
import { studyParticipants } from '@/db/schema';
import { getInstructor, isAdministrator } from '@/lib/auth';
import { STUDY_ADMIN_CODES } from '@/lib/study/config';
import {
  ensureStudyTables,
  isValidParticipantNumber,
  normalizeParticipantNumber,
} from '@/lib/study/store';
import { ensureParticipantSetup } from '@/lib/study/provision';
import { isDemoNumber } from '@/lib/study/demo';
import type { StudyCell } from '@/lib/study/phases';

export const dynamic = 'force-dynamic';
// Cloning two datasets runs past the default serverless budget.
export const maxDuration = 300;

const bodySchema = z.object({
  participantNumber: z.string().min(1),
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

  const number = normalizeParticipantNumber(parsed.participantNumber);
  if (!isValidParticipantNumber(number)) {
    return NextResponse.json(
      { error: 'Participant ID may use only letters, digits, "-" and "_" (max 32).' },
      { status: 400 }
    );
  }
  // The two names that mean something else in this system. A researcher code
  // here would mint a participant account that then shows up as a session;
  // DEMO- is the tutorial account, which the demo runner owns.
  if (STUDY_ADMIN_CODES.includes(number)) {
    return NextResponse.json({ error: 'That is a researcher code.' }, { status: 400 });
  }
  if (isDemoNumber(number)) {
    return NextResponse.json({ error: 'DEMO- IDs belong to the tutorial runner.' }, { status: 400 });
  }

  const [existing] = await db
    .select()
    .from(studyParticipants)
    .where(eq(studyParticipants.participantNumber, number));
  if (existing) {
    return NextResponse.json({ error: `${number} already exists.` }, { status: 409 });
  }

  try {
    const { participant } = await ensureParticipantSetup(number, parsed.cell as StudyCell);
    return NextResponse.json({
      success: true,
      participantNumber: participant.participantNumber,
      cell: participant.cell,
      accessToken: participant.accessToken,
    });
  } catch (err) {
    console.error('participant create error:', err);
    return NextResponse.json({ error: 'Could not create that participant.' }, { status: 500 });
  }
}
