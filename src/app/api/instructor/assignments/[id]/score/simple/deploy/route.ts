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
import { warmClone } from '@/lib/study/warm';
import { runAfterSave } from '@/lib/study/simple/after-save';
import { recordIntentVersions } from '@/lib/study/simple/intent-versions';
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

  // AN EMPTY BOARD DEPLOYS. It used to be refused — no version saved, nothing
  // to stamp, 409 — and that refusal sat on the participant's only way out of
  // the block: someone who read the log for twenty-five minutes and decided it
  // needed no changes could not leave. "How much you change is entirely up to
  // you" is what the task promises, and none is a permitted answer to it.
  //
  // So a board with nothing on it deploys the empty configuration, which is a
  // real answer and is measured as one: the block test asks its questions of
  // it and generation already has `empty_config` as an outcome it records
  // rather than an error it throws. The console shows the change count beside
  // the participant, so a block ended without work is visible afterwards
  // rather than prevented at the time.
  //
  // `tip.snapshot` is the seeded empty snapshot in that case (getSimpleTip),
  // so the save below has something well-formed to write either way.
  const saved = await getSimpleSaved({ assignmentId: id, condition, seedPrompt });
  let target = saved.version;
  let committed = false;
  if (!target || !tip.version || target.versionNo !== tip.version.versionNo) {
    const version = await saveSimpleVersion({
      assignmentId: id,
      snapshot: tip.snapshot,
      kind: 'save',
    });
    target = version;
    committed = true;
    // Deploy is the final save, so it writes the same per-intent rows a save
    // does. Without them an intent edited and never separately saved would
    // reach the deployed configuration with no history of having changed.
    const intentVersions = await recordIntentVersions({
      assignmentId: id,
      snapshot: tip.snapshot,
      configVersionNo: version.versionNo,
    });
    runAfterSave({
      assignmentId: id,
      condition,
      seedPrompt,
      kind: 'save',
      versionId: version.id,
      snapshot: tip.snapshot,
      previous: saved.version ? saved.snapshot : null,
      intentVersions,
      focusSid: null,
      pinned: [],
      recentMessageIds: [],
    });
  }

  const before = await getSimpleDeployed({ assignmentId: id, condition, seedPrompt });
  const deployed = await deploySimpleVersion({ assignmentId: id, versionNo: target.versionNo });
  if (!deployed) {
    // A version existed a moment ago and does not now — a rollback racing a
    // deploy. Nothing the participant did, and nothing they can fix.
    return NextResponse.json(
      {
        error: 'nothing_to_deploy',
        message: 'That did not go through — message the researcher on the Zoom call.',
      },
      { status: 409 }
    );
  }

  await logStudyEvent(id, 'simple_deploy', {
    condition,
    versionNo: deployed.versionNo,
    // Whether the press also had to save, and what it replaced — the two
    // things that tell a first deploy from a redeploy after more work.
    committed,
    previousVersionNo: before.version?.versionNo ?? null,
    intents: tip.snapshot.intents.length,
  });

  // Start freezing this version's measurement answers now, while the
  // participant still has the questionnaire ahead of them.
  //
  // Both other deploy routes have always done this; this one never did, so on
  // the simple board the head start advance.ts is written around (warmInFlight)
  // never existed and the whole batch was generated inside the hand-off click
  // instead — the arrangement moving the questionnaire in front of the test was
  // meant to undo. One watched participant absorbs that as a slow spinner. A
  // room of them reaches it within a minute of each other, unwatched.
  //
  // Returns immediately and never throws (warm.ts): a failed head start must
  // not fail the deploy, and advance.ts still generates for real on the way out.
  warmClone(id);

  return NextResponse.json({ versionNo: deployed.versionNo, committed });
}
