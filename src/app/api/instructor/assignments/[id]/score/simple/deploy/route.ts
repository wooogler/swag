/**
 * Deploy — the final save, and the only thing the study measures.
 *
 * There is no separate live copy on this board. It has always answered from
 * the newest write, and the briefing has always told participants to deploy
 * when it is ready. What this adds is the DECLARATION: of the saves they made,
 * this is the one they stand behind. Without it the measured artefact would be
 * "the last one they happened to save", which is not an answer anybody gave.
 *
 * It saves first when something is applied and unsaved, because deploying a
 * version older than what is on screen and deploying an unsaved change are
 * both wrong answers to "is this what you meant". One press, one decision.
 *
 * Deploying again is allowed and expected: it moves the declaration to
 * whatever is current. The old row keeps its stamp, so the trail holds every
 * point they stood behind and when.
 */
import { NextResponse } from 'next/server';
import { logStudyEvent } from '@/lib/study/events';
import { runAfterSave } from '@/lib/study/simple/after-save';
import { simpleContext } from '@/lib/study/simple/route-context';
import {
  deploySimpleVersion,
  getSimpleDeployed,
  getSimpleSaved,
  getSimpleTip,
  saveSimpleVersion,
} from '@/lib/study/simple/store';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await simpleContext(id, new URL(request.url).searchParams.get('view'));
  if ('error' in gate) return gate.error;
  const { condition, seedPrompt } = gate.context;

  const tip = await getSimpleTip({ assignmentId: id, condition, seedPrompt });
  if (!tip.version) return NextResponse.json({ error: 'nothing_to_deploy' }, { status: 409 });

  // Whatever is in effect becomes a version first, so what gets stamped is
  // what is on the screen.
  const saved = await getSimpleSaved({ assignmentId: id, condition, seedPrompt });
  let target = saved.version;
  let committed = false;
  if (!target || target.versionNo !== tip.version.versionNo) {
    const version = await saveSimpleVersion({
      assignmentId: id,
      snapshot: tip.snapshot,
      kind: 'save',
    });
    target = version;
    committed = true;
    runAfterSave({
      assignmentId: id,
      condition,
      seedPrompt,
      kind: 'save',
      versionId: version.id,
      snapshot: tip.snapshot,
      previous: saved.version ? saved.snapshot : null,
      intentVersions: [],
      focusSid: null,
      pinned: [],
      recentMessageIds: [],
    });
  }

  const before = await getSimpleDeployed({ assignmentId: id, condition, seedPrompt });
  const deployed = await deploySimpleVersion({ assignmentId: id, versionNo: target.versionNo });
  if (!deployed) return NextResponse.json({ error: 'nothing_to_deploy' }, { status: 409 });

  await logStudyEvent(id, 'simple_deploy', {
    condition,
    versionNo: deployed.versionNo,
    // Whether the press also had to save, and what it replaced — the two
    // things that tell a first deploy from a redeploy after more work.
    committed,
    previousVersionNo: before.version?.versionNo ?? null,
    intents: tip.snapshot.intents.length,
  });

  return NextResponse.json({ versionNo: deployed.versionNo, committed });
}
