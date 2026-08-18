import { redirect } from 'next/navigation';
import { getCurrentStudyParticipant } from '@/lib/study/session';
import { ensureStudyTables } from '@/lib/study/store';
import { isStudyPhase, phaseAccess } from '@/lib/study/phases';
import { finalColumns, getFinalAnswers } from '@/lib/study/final-survey-store';
import FinalSurvey from './FinalSurvey';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'One last questionnaire' };

export default async function FinalSurveyPage() {
  await ensureStudyTables();
  const participant = await getCurrentStudyParticipant();
  if (!participant) redirect('/study');

  const phase = isStudyPhase(participant.phase) ? participant.phase : 'not_started';
  if (!phaseAccess(participant, phase).showFinal) redirect('/study/session');

  const [columns, answers] = await Promise.all([
    finalColumns(participant),
    getFinalAnswers(participant.id),
  ]);

  return <FinalSurvey columns={columns} initial={answers} phase={phase} />;
}
