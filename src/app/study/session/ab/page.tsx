import { redirect } from 'next/navigation';
import { getCurrentStudyParticipant } from '@/lib/study/session';
import { ensureStudyTables } from '@/lib/study/store';
import { isStudyPhase, phaseAccess } from '@/lib/study/phases';
import { getAbItems } from '@/lib/study/measure-store';
import BlindAb from './BlindAb';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Which answer would you want?' };

/**
 * Blind A/B — the study's primary measure.
 *
 * Both configurations answer the same question side by side. Nothing in the
 * payload says which side is which: the client receives two response strings
 * and the item id, and the server recomputes the attribution when a choice
 * comes back.
 */
export default async function BlindAbPage() {
  await ensureStudyTables();
  const participant = await getCurrentStudyParticipant();
  if (!participant) redirect('/study');

  const phase = isStudyPhase(participant.phase) ? participant.phase : 'not_started';
  if (!phaseAccess(participant.participantNumber, phase).showAb) redirect('/study/session');

  const items = await getAbItems(participant);
  if (items.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="max-w-md text-center">
          <h1 className="text-lg font-semibold mb-2">Not ready yet</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Your facilitator needs to prepare this step. Hold on a moment.
          </p>
        </div>
      </div>
    );
  }

  // Strip the attribution before it reaches the browser: which side is which
  // is never needed there, and shipping it would put the blind one devtools
  // panel away.
  const blind = items.map((i) => ({
    bankItemId: i.bankItemId,
    context: i.context,
    question: i.question,
    leftResponse: i.leftResponse,
    rightResponse: i.rightResponse,
    choice: i.choice,
  }));

  return <BlindAb items={blind} />;
}
