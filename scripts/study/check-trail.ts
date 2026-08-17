/**
 * End-to-end check of the participant trail, over the REAL routes.
 *
 * Drives one SCORE clone through the acts RQ1 cares about — create, edit,
 * rule save, correction, rewind — then rebuilds the trail and asserts that
 * each one shows up, in order, with the right block clock. Uses HTTP rather
 * than the store functions so the Step-1 event logging is exercised too.
 *
 *   npx tsx --env-file=.env scripts/study/check-trail.ts --participant TRL1
 */
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/db';
import { studyParticipants, instructors } from '../../src/db/schema';

const BASE = process.env.SWAG_URL ?? 'http://localhost:3030';

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] ?? null : null;
}

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
}

async function main() {
  const number = (argValue('--participant') ?? 'TRL1').toUpperCase();
  const { cloneForBlock } = await import('../../src/lib/study/measure-store');
  const { buildParticipantTrail } = await import('../../src/lib/study/trail');
  const { setParticipantPhase } = await import('../../src/lib/study/console-store');
  const { ensureTypeRoots } = await import('../../src/lib/score/intent-store');

  const [participant] = await db
    .select()
    .from(studyParticipants)
    .where(eq(studyParticipants.participantNumber, number));
  if (!participant) throw new Error(`No participant ${number}`);
  const clone = (await cloneForBlock(participant, 1))!;
  console.log(`participant ${number} · block1 ${clone.datasetKey}/${clone.condition}\n`);
  if (clone.condition !== 'score') throw new Error('block 1 must be SCORE for this check');

  // The board is the participant's own instructor account.
  const [account] = await db
    .select()
    .from(instructors)
    .where(eq(instructors.id, participant.instructorId));
  const cookie = `user_session=${account.id}`;
  const A = `${BASE}/api/instructor/assignments/${clone.assignmentId}/score`;
  const call = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`${A}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Cookie: cookie, ...(init.headers ?? {}) },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) console.log(`   ! ${init.method ?? 'GET'} ${path} → ${res.status} ${JSON.stringify(body).slice(0, 120)}`);
    return { status: res.status, body };
  };

  // t=0 for the block clock.
  await setParticipantPhase(participant, 'block1_work', 'researcher');
  await ensureTypeRoots(clone.assignmentId);

  // ── the session, in order ───────────────────────────────────────────
  const created = await call('/intents', {
    method: 'POST',
    body: JSON.stringify({
      title: 'TRAIL: plain facts',
      definition: 'asks the chatbot for a fact or a definition it can answer briefly',
      autoTitle: false,
      recordVersion: true,
      isTemplate: false,
      type: 'planning',
      parentIntentId: null,
      stats: { included: 0, excluded: 0, inCount: 0 },
    }),
  });
  const intentId: number | undefined = created.body?.intent?.id ?? created.body?.id;
  check('intent created over HTTP', typeof intentId === 'number', `id=${intentId}`);
  if (typeof intentId !== 'number') throw new Error('cannot continue without an intent');

  await call(`/intents/${intentId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      definition: 'asks the chatbot for a fact, a definition, or a short explanation',
      recordVersion: true,
    }),
  });
  await call(`/intents/${intentId}/rule-versions`, {
    method: 'POST',
    body: JSON.stringify({ rule: 'Answer plainly in at most three sentences.', source: 'direct' }),
  });

  // A correction needs a real user message of this assignment.
  const { getQueryRecords } = await import('../../src/lib/score/queries');
  const records = await getQueryRecords(clone.assignmentId);
  const messageId = records[0]?.messageId;
  if (messageId) {
    await call(`/intents/${intentId}/pins`, {
      method: 'POST',
      body: JSON.stringify({ messageId, verdict: 'in', reason: 'this is the plain-facts case' }),
    });
    await call(`/intents/${intentId}/pins?messageId=${messageId}`, { method: 'DELETE' });
  }

  // Read the trail BEFORE rewinding: the revert is about to delete the
  // version that holds the definition edit, which is the whole reason the
  // revert event has to carry it.
  const before = await buildParticipantTrail(participant.id);
  // Scoped to the intent THIS run made: the script is re-runnable, so an
  // earlier run's edits are sitting in the same trail.
  const beforeMine = before!.events.filter((e) => e.intentId === intentId).map((e) => e.kind);
  check('intent_update_definition present before the rewind', beforeMine.includes('intent_update_definition'));

  // Rewind to the version THIS run's create wrote, not to v1 — on a re-run v1
  // belongs to an earlier intent and the route rightly refuses it.
  const createdAtVersion = before!.events.find(
    (e) => e.kind === 'intent_create' && e.intentId === intentId
  )?.payload?.versionNo as number | undefined;
  check('found the version to rewind to', typeof createdAtVersion === 'number', `v${createdAtVersion}`);
  await call(`/intents/${intentId}/revert`, {
    method: 'POST',
    body: JSON.stringify({ versionNo: createdAtVersion ?? 1 }),
  });

  // ── rebuild and read ────────────────────────────────────────────────
  const trail = await buildParticipantTrail(participant.id);
  if (!trail) throw new Error('no trail');
  const kinds = trail.events.filter((e) => e.intentId === intentId).map((e) => e.kind);
  console.log(`\n${trail.events.length} event(s):`);
  for (const e of trail.events) {
    console.log(
      `  ${String(e.seq).padStart(3)} t+${String(e.tBlock ?? '-').padStart(5)}s ` +
        `${(e.block ?? '-')}/${(e.condition ?? '-').padEnd(8)} ${e.source.padEnd(8)} ` +
        `${e.kind.padEnd(26)} ${e.intentTitle ?? ''} ${e.detail ?? ''}`.slice(0, 150)
    );
  }
  console.log();

  check('intent_create present', kinds.includes('intent_create'));
  check('rule_save present', kinds.includes('rule_save'));
  check(
    'the rewound definition edit is gone from the snapshots',
    !kinds.includes('intent_update_definition'),
    'as designed — the tool deletes it'
  );
  if (messageId) {
    check('pin_set present', kinds.includes('pin_set'));
    check('pin_remove present', kinds.includes('pin_remove'));
    const removed = trail.events.find((e) => e.kind === 'pin_remove');
    check('withdrawn verdict preserved', removed?.payload?.verdictWas === 'in', String(removed?.payload?.verdictWas));
  }
  const rev = trail.events.find((e) => e.kind === 'revert' && e.intentId === intentId);
  check('revert present', !!rev);
  const dropped = (rev?.payload?.deletedVersions ?? []) as {
    snapshotIntent?: { definition?: string } | null;
  }[];
  check('revert kept what it deleted', dropped.length > 0, `${dropped.length} version(s)`);
  check(
    'the deleted definition survives in the event',
    dropped.some((d) => d.snapshotIntent?.definition?.includes('short explanation')),
    dropped[0]?.snapshotIntent?.definition?.slice(0, 60) ?? 'missing'
  );
  check(
    'config_seed collapses the template set',
    trail.events.filter((e) => e.kind === 'config_seed').length === 1
  );
  check(
    'no duplicate rows for the same act',
    trail.events.filter((e) => e.kind === 'intent_create' && e.intentId === intentId).length === 1
  );
  check(
    'no template noise',
    !trail.events.some((e) => e.kind === 'intent_create' && e.intentTitle === 'Factual Lookup')
  );

  const inBlock = trail.events.filter((e) => e.block === 1);
  check('block-1 events carry a clock', inBlock.length > 0 && inBlock.every((e) => e.tBlock !== null));
  check('events are in time order', trail.events.every((e, i, a) => i === 0 || a[i - 1].at <= e.at));
  check('titles resolved', trail.events.some((e) => e.intentTitle?.includes('plain facts')));
  check(
    'every event carries a phase',
    trail.events.every((e) => typeof e.phase === 'string' && e.phase.length > 0)
  );
  check('block 1 is SCORE', trail.blocks[0]?.condition === 'score', trail.blocks[0]?.tZeroSource);

  const { buildTrailFiles } = await import('../../src/lib/study/trail-files');
  const files = await buildTrailFiles(participant.id);
  const names = Object.keys(files?.files ?? {});
  check('timeline.csv written', names.includes('timeline.csv'));
  check('snapshots written', names.some((n) => n.startsWith('snapshots/')));
  check('rules written', names.some((n) => n.startsWith('rules/')));
  console.log(`   ${names.length} file(s): ${names.slice(0, 6).join(', ')}…`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
