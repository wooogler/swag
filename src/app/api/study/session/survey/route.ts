/** Save one block's questionnaire. Answers are upserted per item. */
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/db';
import { studySurveyAnswers } from '@/db/schema';
import { getCurrentStudyParticipant } from '@/lib/study/session';
import { blockOf, isStudyPhase, phaseAccess } from '@/lib/study/phases';
import { cloneForBlock } from '@/lib/study/measure-store';
import { SURVEY_SCALE_MIN } from '@/lib/study/survey-items';
import { getSurveyConfig } from '@/lib/study/survey-store';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  answers: z.record(z.string(), z.number().int().min(SURVEY_SCALE_MIN)),
});

export async function POST(req: Request) {
  const participant = await getCurrentStudyParticipant();
  if (!participant) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const phase = isStudyPhase(participant.phase) ? participant.phase : 'not_started';
  if (!phaseAccess(participant, phase).showSurvey) {
    return NextResponse.json({ error: 'wrong_phase' }, { status: 409 });
  }
  const block = blockOf(phase);
  if (!block) return NextResponse.json({ error: 'no_block' }, { status: 409 });

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const clone = await cloneForBlock(participant, block);
  const config = await getSurveyConfig();
  const validKeys = new Set(config.items.map((i) => i.key));
  const now = new Date();
  for (const [itemKey, value] of Object.entries(parsed.answers)) {
    // Out-of-instrument keys and out-of-scale values are dropped, not stored:
    // the scale is a setting, so the ceiling is read here rather than baked in.
    if (!validKeys.has(itemKey)) continue;
    if (value > config.scaleMax) continue;
    await db
      .insert(studySurveyAnswers)
      .values({
        participantId: participant.id,
        block,
        cloneAssignmentId: clone?.assignmentId ?? null,
        itemKey,
        value,
        answeredAt: now,
      })
      .onConflictDoUpdate({
        target: [
          studySurveyAnswers.participantId,
          studySurveyAnswers.block,
          studySurveyAnswers.itemKey,
        ],
        set: { value, answeredAt: now },
      });
  }

  const saved = await db
    .select({ itemKey: studySurveyAnswers.itemKey })
    .from(studySurveyAnswers)
    .where(
      and(eq(studySurveyAnswers.participantId, participant.id), eq(studySurveyAnswers.block, block))
    );
  return NextResponse.json({ success: true, saved: saved.length });
}
