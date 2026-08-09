import { redirect } from 'next/navigation';
import { getCurrentStudyParticipant } from '@/lib/study/session';
import { ensureStudyTables } from '@/lib/study/store';
import { isStudyPhase, phaseAccess } from '@/lib/study/phases';
import { cloneForBlock, deployedConfigFor, getTestItems } from '@/lib/study/measure-store';
import BlockTest from './BlockTest';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Check your chatbot' };

/**
 * Block test — the participant predicts, then sees, then rates.
 *
 * Reached only during the matching phase; the facilitator opens it. Responses
 * for items not yet predicted are NOT in this payload (measure-store enforces
 * that), so there is nothing on the page to peek at.
 */
export default async function BlockTestPage() {
  await ensureStudyTables();
  const participant = await getCurrentStudyParticipant();
  if (!participant) redirect('/study');

  const phase = isStudyPhase(participant.phase) ? participant.phase : 'not_started';
  const block = phaseAccess(participant.participantNumber, phase).testBlock;
  if (!block) redirect('/study/session');

  const clone = await cloneForBlock(participant, block);
  if (!clone) redirect('/study/session');

  const [config, items] = await Promise.all([
    deployedConfigFor(clone),
    getTestItems(participant, clone),
  ]);

  if (!config || items.length === 0) {
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

  return <BlockTest config={config} items={items} />;
}
