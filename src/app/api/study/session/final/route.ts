/**
 * Saving a page of the end-of-session comparison (design §6.5).
 *
 * One request per page rather than one per click: this is the last thing
 * before the interview and the answers are revisable, so the screen holds a
 * page and posts it on the way out.
 *
 * Refuses outside the final phase. The survey names both versions and links to
 * both boards; answering it early would mean rating a version that has not
 * been used yet.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentStudyParticipant } from '@/lib/study/session';
import { isStudyPhase, phaseAccess } from '@/lib/study/phases';
import { saveFinalAnswers } from '@/lib/study/final-survey-store';
import { STUDIO_VIEWS, type StudioView } from '@/lib/study/config';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  answers: z
    .array(
      z.object({
        itemKey: z.string().min(1).max(16),
        condition: z.enum(STUDIO_VIEWS as [StudioView, ...StudioView[]]).optional(),
        value: z.number().int().min(1).max(7).optional(),
        text: z.string().max(4000).optional(),
      })
    )
    .max(64),
});

export async function POST(req: Request) {
  const participant = await getCurrentStudyParticipant();
  if (!participant) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const phase = isStudyPhase(participant.phase) ? participant.phase : 'not_started';
  if (!phaseAccess(participant, phase).showFinal) {
    return NextResponse.json({ error: 'not_final_phase', phase }, { status: 409 });
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await req.json().catch(() => ({})));
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const written = await saveFinalAnswers(participant.id, parsed.answers);
  return NextResponse.json({ success: true, written });
}
