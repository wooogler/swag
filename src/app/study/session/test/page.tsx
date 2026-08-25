import { redirect } from 'next/navigation';
import { getCurrentStudyParticipant } from '@/lib/study/session';
import { ensureStudyTables } from '@/lib/study/store';
import { isStudyPhase, phaseAccess } from '@/lib/study/phases';
import { cloneForBlock, deployedConfigFor, getTestItems } from '@/lib/study/measure-store';
import BlockTest from './BlockTest';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Check your chatbot' };

/**
 * Block test — the participant predicts all of them, then sees, then rates.
 *
 * Reached only during the matching phase, which the participant enters by
 * finishing their setup — and that transition generates these answers first
 * (advance.ts), so "Not ready yet" below means someone was moved here by hand.
 * Until every question in the block has been predicted, NO response is in this
 * payload (measure-store enforces that), so there is nothing on the page to
 * peek at and nothing an early answer could teach a later prediction.
 */
export default async function BlockTestPage() {
  await ensureStudyTables();
  const participant = await getCurrentStudyParticipant();
  if (!participant) redirect('/study');

  const phase = isStudyPhase(participant.phase) ? participant.phase : 'not_started';
  const block = phaseAccess(participant, phase).testBlock;
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
            This step is still being prepared. Message the researcher on the Zoom call.
          </p>
        </div>
      </div>
    );
  }

  return (
    <BlockTest
      config={config}
      items={items}
      phase={phase}
      // NIRVANA turns are raw model output whose single-newline breaks
      // CommonMark would collapse; SWAG's are this app's own markdown.
      legacyLineBreaks={clone.datasetKey === 'nirvana'}
    />
  );
}
