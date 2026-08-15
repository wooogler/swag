/**
 * The facilitator's probe list for one block (문항지 §3 ④).
 *
 * Fetched on demand rather than folded into the console's poll: it is one
 * participant's eight rows, opened when the facilitator is actually sitting
 * with them, and putting it on the 10-second refresh of every participant
 * would pay for it sixteen times over for nothing.
 */
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db/db';
import { studyParticipants } from '@/db/schema';
import { getInstructor, isAdministrator } from '@/lib/auth';
import { ensureStudyTables } from '@/lib/study/store';
import { getBlockPredictions } from '@/lib/study/console-store';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const instructor = await getInstructor();
  if (!instructor || !isAdministrator(instructor)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  await ensureStudyTables();

  const { searchParams } = new URL(req.url);
  const participantId = searchParams.get('participantId');
  const assignmentId = searchParams.get('assignmentId');
  if (!participantId || !assignmentId) {
    return NextResponse.json({ error: 'missing_params' }, { status: 400 });
  }

  const [participant] = await db
    .select()
    .from(studyParticipants)
    .where(eq(studyParticipants.id, participantId));
  if (!participant) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  try {
    return NextResponse.json({ rows: await getBlockPredictions(participant, assignmentId) });
  } catch (err) {
    console.error('predictions error:', err);
    return NextResponse.json({ error: 'read_failed' }, { status: 500 });
  }
}
