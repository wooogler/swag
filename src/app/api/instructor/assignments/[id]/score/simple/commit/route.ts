/**
 * Mark what is currently in effect as a saved version.
 *
 * Deliberately takes no body. Save commits the configuration the board is
 * ANSWERING with — the last thing applied — not whatever is half-typed in an
 * editor box. If it took the editors' contents it would silently apply them,
 * and the difference between the two verbs would stop meaning anything: Apply
 * would be the one you could skip.
 *
 * So the rule is plain enough to say in a sentence: apply it to see it, save it
 * to keep it, and only what you saved is measured.
 */
import { NextResponse } from 'next/server';
import { logStudyEvent } from '@/lib/study/events';
import { runAfterSave } from '@/lib/study/simple/after-save';
import { recordIntentVersions } from '@/lib/study/simple/intent-versions';
import { simpleContext } from '@/lib/study/simple/route-context';
import { getSimpleSaved, getSimpleTip, saveSimpleVersion } from '@/lib/study/simple/store';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await simpleContext(id, new URL(request.url).searchParams.get('view'));
  if ('error' in gate) return gate.error;
  const { condition, seedPrompt } = gate.context;

  const tip = await getSimpleTip({ assignmentId: id, condition, seedPrompt });
  if (!tip.version) return NextResponse.json({ error: 'nothing_to_save' }, { status: 409 });

  const saved = await getSimpleSaved({ assignmentId: id, condition, seedPrompt });
  // Already the saved one: nothing to do, and saying so is better than writing
  // a second identical row every time the button is pressed.
  if (saved.version?.versionNo === tip.version.versionNo) {
    return NextResponse.json({ versionNo: tip.version.versionNo, unchanged: true });
  }

  const version = await saveSimpleVersion({
    assignmentId: id,
    snapshot: tip.snapshot,
    kind: 'save',
  });

  // The per-intent rows. THIS is where they are written, because this is the
  // press that turns applied work into a version — applying writes none on
  // purpose, so a save that assumed they were already there left every
  // intent's history frozen at whatever it looked like when it was created.
  const intentVersions = await recordIntentVersions({
    assignmentId: id,
    snapshot: tip.snapshot,
    configVersionNo: version.versionNo,
  });

  await logStudyEvent(id, 'simple_version_save', {
    condition,
    kind: 'save',
    versionNo: version.versionNo,
    intents: tip.snapshot.intents.length,
    // What this save is committing: the applies since the last one.
    committedFrom: saved.version?.versionNo ?? null,
    intentVersions: intentVersions.map((v) => ({ sid: v.sid, versionNo: v.versionNo })),
    target: 'commit',
  });

  // Only the naming and the prefetch have anything left to do — the judging
  // already ran for this snapshot when it was applied.
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

  return NextResponse.json({ versionNo: version.versionNo });
}
