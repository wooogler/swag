import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db/db';
import { studySurveyAnswers } from '@/db/schema';
import { getCurrentStudyParticipant } from '@/lib/study/session';
import { ensureStudyTables } from '@/lib/study/store';
import { blockOf, isStudyPhase, phaseAccess } from '@/lib/study/phases';
import { SURVEY_SCALE_MIN } from '@/lib/study/survey-items';
import { getSurveyConfig } from '@/lib/study/survey-store';
import BlockSurvey from './BlockSurvey';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'A few questions' };

export default async function SurveyPage() {
  await ensureStudyTables();
  const participant = await getCurrentStudyParticipant();
  if (!participant) redirect('/study');

  const phase = isStudyPhase(participant.phase) ? participant.phase : 'not_started';
  if (!phaseAccess(participant, phase).showSurvey) redirect('/study/session');
  const block = blockOf(phase);
  if (!block) redirect('/study/session');

  const { items, scaleMax } = await getSurveyConfig();
  const prior = await db
    .select({ itemKey: studySurveyAnswers.itemKey, value: studySurveyAnswers.value })
    .from(studySurveyAnswers)
    .where(
      and(eq(studySurveyAnswers.participantId, participant.id), eq(studySurveyAnswers.block, block))
    );

  return (
    <BlockSurvey
      items={items}
      min={SURVEY_SCALE_MIN}
      max={scaleMax}
      initial={Object.fromEntries(prior.map((p) => [p.itemKey, p.value]))}
      phase={phase}
    />
  );
}
