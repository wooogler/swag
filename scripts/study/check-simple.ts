/**
 * End-to-end check of the simple version, over the REAL routes.
 *
 * Drives one clone through everything a participant can do — save, judge,
 * read a reply, reorder, restore, pin — and then asserts that each act left
 * the record the analysis is going to read. Over HTTP rather than the store
 * functions, so the route-level logging is exercised too.
 *
 * This exists because of a specific past failure: events that were in the spec
 * and not in the code, discovered when the analysis needed them and the
 * sessions were over. Events cannot be backfilled, so coverage gets checked
 * before anyone sits down, not after.
 *
 *   npx tsx --env-file=.env scripts/study/check-simple.ts --assignment <id>
 *   npx tsx --env-file=.env scripts/study/check-simple.ts --participant SIM1
 *
 * With --assignment it runs on a researcher's own assignment (no clone row) as
 * a `?view=` preview, which is the cheap way to check the plumbing. With
 * --participant it runs on that participant's block-1 clone, which is the real
 * thing and needs them to be in the simple family.
 */
import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';
import { db } from '../../src/db/db';
import {
  assignments,
  instructors,
  studyReviewQuestions,
  simpleConfigVersions,
  simplePins,
  simpleRatings,
  studyEvents,
  studyParticipants,
} from '../../src/db/schema';

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

interface StateBody {
  arm: string;
  snapshot: { rootRule: string; prompt: string; intents: { sid: number; title: string }[] };
  versions: { versionNo: number; displayNo: number; name: string | null }[];
  atTip: boolean;
  pinned: number[];
  owners: Record<string, { sid: number | null; outcome: string }>;
  counts: Record<string, number>;
  pending: number;
  working: boolean;
  diff: { sid: number | null; entered: number[]; left: number[] }[] | null;
}

async function main() {
  const participantNumber = argValue('--participant');
  const assignmentArg = argValue('--assignment');
  if (!participantNumber && !assignmentArg) {
    throw new Error('pass --participant <number> or --assignment <id>');
  }

  let assignmentId: string;
  let accountId: string | null;
  let view: string | null = null;

  if (participantNumber) {
    const { cloneForBlock } = await import('../../src/lib/study/measure-store');
    const [participant] = await db
      .select()
      .from(studyParticipants)
      .where(eq(studyParticipants.participantNumber, participantNumber.toUpperCase()));
    if (!participant) throw new Error(`No participant ${participantNumber}`);
    const clone = await cloneForBlock(participant, 1);
    if (!clone) throw new Error('that participant has no block-1 clone');
    if (!clone.view.startsWith('simple')) {
      throw new Error(`block 1 is ${clone.view}, not a simple condition`);
    }
    assignmentId = clone.assignmentId;
    accountId = participant.instructorId;
    console.log(`participant ${participantNumber} · block1 ${clone.datasetKey}/${clone.view}\n`);
  } else {
    assignmentId = assignmentArg!;
    const [assignment] = await db.select().from(assignments).where(eq(assignments.id, assignmentId));
    if (!assignment) throw new Error(`No assignment ${assignmentId}`);
    accountId = assignment.instructorId;
    view = argValue('--view') ?? 'simple_score';
    console.log(`assignment ${assignment.title} · preview as ${view}\n`);
  }

  if (!accountId) throw new Error('that assignment has no owner');
  const [account] = await db.select().from(instructors).where(eq(instructors.id, accountId));
  const cookie = `user_session=${account.id}`;
  const root = `${BASE}/api/instructor/assignments/${assignmentId}/score/simple`;
  const url = (path: string, query = '') => {
    const params = new URLSearchParams(query);
    if (view) params.set('view', view);
    const qs = params.toString();
    return `${root}/${path}${qs ? `?${qs}` : ''}`;
  };
  const call = async (path: string, init: RequestInit = {}, query = '') => {
    const res = await fetch(url(path, query), {
      ...init,
      headers: { 'Content-Type': 'application/json', Cookie: cookie, ...(init.headers ?? {}) },
    });
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(text);
    } catch {
      body = { text };
    }
    if (!res.ok) {
      console.log(`   ! ${init.method ?? 'GET'} ${path} → ${res.status} ${text.slice(0, 140)}`);
    }
    return { status: res.status, body, text, res };
  };

  const state = async () => (await call('state')).body as unknown as StateBody;

  const [{ high }] = await db
    .select({ high: sql<number>`coalesce(max(${studyEvents.id}), 0)::int` })
    .from(studyEvents)
    .where(eq(studyEvents.assignmentId, assignmentId));
  const eventsHighWater = high ?? 0;

  /**
   * Wait until every question has a verdict — the board's own loop, in a
   * script: defer while the save's follow-up work is still running, and drive
   * a batch when it is not.
   */
  const settle = async () => {
    for (let round = 0; round < 40; round += 1) {
      const current = await state();
      if (current.pending === 0) return;
      if (current.working) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        continue;
      }
      const progress = (await call('judge', { method: 'POST', body: JSON.stringify({}) })).body as {
        remaining?: number;
        ratedThisBatch?: number;
      };
      if (progress.ratedThisBatch === 0) return;
    }
  };

  // ── the acts, in order ──────────────────────────────────────────────
  const before = await state();
  check('state reads', typeof before.arm === 'string', `arm=${before.arm}`);

  // The board is about the CURATED questions, not the whole master.
  //
  // A study master carries the earlier turns of each thread as well, so that
  // each curated question can be read with what came before it — three times
  // as many rows on SWAG. Listing those would hand a participant 213 questions
  // to organize when the study gave them 60, and put every count on the screen
  // over the wrong denominator. It went out that way once; hence this.
  const [{ marks }] = await db
    .select({ marks: sql<number>`count(*)::int` })
    .from(studyReviewQuestions)
    .where(eq(studyReviewQuestions.assignmentId, assignmentId));
  if (marks > 0 && before.arm === 'score') {
    const listed = Object.keys(before.owners).length;
    check(
      'the board is scoped to the curated set',
      listed === marks,
      `${marks} curated, ${listed} resolved`
    );
  }
  const startingVersions = before.versions.length;
  const arm = before.arm;
  const startersOnly = process.argv.includes('--starters');

  // Steps 1-8 drive every act a participant can perform, which on a real
  // clone means rating a fresh definition against the whole log. --starters
  // skips them to check the library alone, which is the assertion most likely
  // to break silently: a reworded category drifts from the prepared text, the
  // hash stops matching, and adopting a starter quietly becomes a full pass.
  if (!startersOnly) {
  // 1. Save a first configuration.
  const firstSave = await call('save', {
    method: 'POST',
    body: JSON.stringify({
      rootRule: 'Answer briefly and never write the essay for them.',
      prompt: 'Answer briefly and never write the essay for them.',
      intents: [],
    }),
  });
  check('save returns a version', typeof firstSave.body.versionNo === 'number');
  const v1 = firstSave.body.versionNo as number;

  // 2. Add an intent, which is what the judge then has work to do about.
  const withIntent = await call('save', {
    method: 'POST',
    body: JSON.stringify({
      rootRule: 'Answer briefly and never write the essay for them.',
      prompt: 'Answer briefly and never write the essay for them.',
      intents: [
        {
          sid: -1,
          title: 'CHECK: greetings',
          definition: 'is a greeting or small talk rather than a question about the assignment',
          rule: 'Greet them back in one line and ask what they are working on.',
          parentSid: null,
        },
      ],
    }),
  });
  check('second save returns a version', typeof withIntent.body.versionNo === 'number');
  const v2 = withIntent.body.versionNo as number;

  const afterIntent = await state();
  const sid = afterIntent.snapshot.intents[0]?.sid;
  if (arm === 'score') {
    check('the intent came back with a stable id', typeof sid === 'number', `sid=${sid}`);
    check(
      'the id is not the temporary one the client sent',
      typeof sid === 'number' && sid > 0,
      `sid=${sid}`
    );
  } else {
    // One document, no tree: the save above carried an intent and the server
    // was right to drop it.
    check('the baseline arm keeps no tree', afterIntent.snapshot.intents.length === 0);
    check(
      'and the document is what was saved',
      afterIntent.snapshot.prompt.startsWith('Answer briefly'),
      afterIntent.snapshot.prompt.slice(0, 40)
    );
  }

  // 3. Judge. Exactly the way the board does it — including waiting for the
  //    save's own follow-up pass rather than racing it.
  if (arm === 'score') {
    await settle();
    const judged = await state();
    check('judging finished', judged.pending === 0, `pending=${judged.pending}`);
    const rows = await db
      .select()
      .from(simpleRatings)
      .where(eq(simpleRatings.assignmentId, assignmentId));
    check('verdicts are cached by definition text', rows.length > 0, `${rows.length} row(s)`);
    check(
      'the tree counts add up to the log',
      Object.values(judged.counts).reduce((a, b) => a + b, 0) ===
        Object.keys(judged.owners).length,
      `${JSON.stringify(judged.counts)}`
    );
  }

  // 4. Read a reply. Either cached (JSON) or streamed (text) — both count.
  //    The question comes from the log rather than from the ownership map:
  //    the baseline arm has no ownership to map, and it still has replies.
  const { getQueryRecords } = await import('../../src/lib/score/queries');
  const records = await getQueryRecords(assignmentId);
  const messageId = records[0]?.messageId ?? NaN;
  check('the log has a question to read', Number.isFinite(messageId), `${records.length} question(s)`);
  if (Number.isFinite(messageId)) {
    const answer = await call('respond', {
      method: 'POST',
      body: JSON.stringify({ messageId }),
    });
    check(
      'a reply comes back',
      answer.status === 200 && answer.text.trim().length > 0,
      answer.text.slice(0, 60)
    );

    // The same question again must now be a cache hit — the point of keying on
    // the rule text rather than the version.
    const again = await call('respond', { method: 'POST', body: JSON.stringify({ messageId }) });
    const hitEvents = await db
      .select()
      .from(studyEvents)
      .where(
        and(
          eq(studyEvents.assignmentId, assignmentId),
          eq(studyEvents.eventType, 'simple_response_view')
        )
      )
      .orderBy(asc(studyEvents.createdAt));
    const last = hitEvents[hitEvents.length - 1]?.payload as { cacheHit?: boolean } | undefined;
    check('the second read is a cache hit', last?.cacheHit === true, `${again.status}`);

    // 5. Pin, and unpin.
    await call('pins', { method: 'POST', body: JSON.stringify({ messageId }) });
    const pinned = await state();
    check('a pin sticks', pinned.pinned.includes(messageId));
    await call('pins', { method: 'DELETE' }, `messageId=${messageId}`);
    const unpinned = await state();
    check('and comes off again', !unpinned.pinned.includes(messageId));
  }

  // 6. Add a second intent, then swap the two — a save that changes no
  //    definition text at all, which is the case the text-keyed cache exists
  //    for and the one that must cost nothing.
  if (arm === 'score' && typeof sid === 'number') {
    const greetings = {
      sid,
      title: 'CHECK: greetings',
      definition: 'is a greeting or small talk rather than a question about the assignment',
      rule: 'Greet them back in one line and ask what they are working on.',
      parentSid: null,
    };
    const lengths = {
      sid: -2,
      title: 'CHECK: length questions',
      definition: 'asks how long the essay should be or how many words are required',
      rule: 'Point them at the assignment sheet rather than guessing a number.',
      parentSid: null,
    };
    const body = (intents: unknown[]) =>
      JSON.stringify({
        rootRule: 'Answer briefly and never write the essay for them.',
        prompt: 'Answer briefly and never write the essay for them.',
        intents,
      });

    await call('save', { method: 'POST', body: body([greetings, lengths]) });
    await settle();
    const twoIntents = await state();
    const lengthsSid = twoIntents.snapshot.intents.find((i) => i.sid !== sid)?.sid;
    check('the second intent got its own id', typeof lengthsSid === 'number', `sid=${lengthsSid}`);

    // Every verdict now standing, keyed the way the cache keys them.
    //
    // The claim being tested is that the swap TOUCHES none of these — not that
    // no row is ever added afterwards. First-match means a question can be
    // owned before every definition has been rated against it, so `pending`
    // reaching zero leaves real work outstanding by design, and that work
    // finishing during the swap is not a re-rate.
    const rowsBefore = await db
      .select()
      .from(simpleRatings)
      .where(eq(simpleRatings.assignmentId, assignmentId));
    const key = (r: (typeof rowsBefore)[number]) => `${r.defHash}:${r.messageId}`;
    const stamp = (r: (typeof rowsBefore)[number]) => `${r.rating}@${r.ratedAt.toISOString()}`;
    const before = new Map(rowsBefore.map((r) => [key(r), stamp(r)]));

    // The swap. Same two definitions, opposite order.
    await call('save', {
      method: 'POST',
      body: body([{ ...lengths, sid: lengthsSid }, greetings]),
    });
    const reordered = await state();
    check(
      'the swap put the first intent second',
      reordered.snapshot.intents[1]?.sid === sid,
      reordered.snapshot.intents.map((i) => i.sid).join(',')
    );

    // Let the save's follow-up work finish before reading — the claim is that
    // it had nothing to do, not that it had not started yet.
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const rowsAfter = await db
      .select()
      .from(simpleRatings)
      .where(eq(simpleRatings.assignmentId, assignmentId));
    const after = new Map(rowsAfter.map((r) => [key(r), stamp(r)]));
    const touched = [...before].filter(([k, v]) => after.get(k) !== v);
    check(
      'reordering re-rated nothing that was already rated',
      touched.length === 0,
      touched.length
        ? `${touched.length} row(s) rewritten: ${touched.slice(0, 3).map(([k]) => k).join(', ')}`
        : `${rowsBefore.length} row(s) before, ${rowsAfter.length} after — none rewritten`
    );
  }

  // 7. Diff against an earlier version, which is what paints the rows.
  const diffed = (await call('state', {}, `diffFrom=${v1}`)).body as unknown as StateBody;
  check('a diff comes back', Array.isArray(diffed.diff), `${diffed.diff?.length ?? 0} entr(ies)`);

  // 8. Restore, which must hide what came after and keep it in the table.
  //    One more save first, so there is always something after v2 to drop —
  //    the baseline arm has not saved since.
  await call('save', {
    method: 'POST',
    body: JSON.stringify({
      rootRule: 'Answer briefly. Never write the essay. Ask one question back.',
      prompt: 'Answer briefly. Never write the essay. Ask one question back.',
      intents: (await state()).snapshot.intents,
    }),
  });
  const restored = await call('restore', { method: 'POST', body: JSON.stringify({ versionNo: v2 }) });
  check('restore reports what it dropped', typeof restored.body.hidden === 'number', `${restored.body.hidden}`);
  const afterRestore = await state();
  check(
    'the timeline ends at the restored version',
    afterRestore.versions[0]?.versionNo === v2,
    `tip=v${afterRestore.versions[0]?.versionNo}`
  );
  const kept = await db
    .select()
    .from(simpleConfigVersions)
    .where(eq(simpleConfigVersions.assignmentId, assignmentId));
  check(
    'the dropped versions are still in the table',
    kept.some((k) => k.hiddenAt !== null),
    `${kept.filter((k) => k.hiddenAt).length} hidden of ${kept.length}`
  );
  check('and are not in the participant-facing list', afterRestore.versions.length <= kept.length);

  }
  // 9. The starter library, and the claim that adopting one is free.
  //
  //    Every clone is provisioned with the taxonomy's categories already rated
  //    against its whole log, and a verdict is keyed by definition text — so a
  //    starter's questions are a lookup. If this ever stops holding, picking a
  //    starter silently becomes a full re-rating pass over the log, which is
  //    minutes of waiting and a bill, and nothing would say so.
  const starters = (await call('starters')).body as unknown as {
    groups?: {
      label: string;
      whole: { title: string; definition: string; count: number };
      items: { title: string; definition: string; description: string; count: number }[];
    }[];
  };
  const groups = starters.groups ?? [];
  check('the starter library loads', groups.length > 0, `${groups.length} group(s)`);
  const everyItem = groups.flatMap((g) => [g.whole, ...g.items]);
  check(
    'every starter carries a definition and a description',
    everyItem.length > 0 && everyItem.every((i) => i.definition.trim().length > 0),
    `${everyItem.length} starter(s)`
  );

  // Prepared categories only exist on a clone or a master. A scratch
  // assignment has none, and a library of zeroes is the honest answer there.
  const prepared = everyItem.filter((i) => i.count > 0);
  if (arm === 'score' && prepared.length > 0) {
    const pick = prepared.sort((a, b) => b.count - a.count)[0];
    const ratedBefore = (
      await db.select().from(simpleRatings).where(eq(simpleRatings.assignmentId, assignmentId))
    ).length;
    await call('save', {
      method: 'POST',
      body: JSON.stringify({
        rootRule: 'Answer briefly and never write the essay for them.',
        prompt: 'Answer briefly and never write the essay for them.',
        intents: [
          { sid: -9, title: pick.title, definition: pick.definition, rule: '', parentSid: null },
        ],
      }),
    });
    await settle();
    const adopted = await state();
    const sidOf = adopted.snapshot.intents.find((i) => i.title === pick.title)?.sid;
    check(
      `adopting “${pick.title}” lands its questions`,
      sidOf != null && adopted.counts[String(sidOf)] === pick.count,
      `dropdown said ${pick.count}, board resolved ${sidOf != null ? adopted.counts[String(sidOf)] : '—'}`
    );

    // Copied, not re-rated: the prepared verdicts were stamped when the clone
    // was made, so a fresh rating pass would carry today's timestamp.
    const rows = await db
      .select()
      .from(simpleRatings)
      .where(eq(simpleRatings.assignmentId, assignmentId));
    const added = rows.length - ratedBefore;
    const startedAt = Date.now() - 10 * 60_000;
    const fresh = rows.filter((r) => r.ratedAt.getTime() > startedAt).length;
    check(
      'and cost no new judgements',
      added > 0 && fresh === 0,
      `${added} verdict(s) copied, ${fresh} newly rated`
    );
  } else {
    check(
      'the library reports zero where nothing is prepared',
      everyItem.every((i) => i.count === 0),
      `${prepared.length} starter(s) with counts`
    );
  }

  if (!startersOnly) {
  // ── the record it all left ──────────────────────────────────────────
  const events = await db
    .select()
    .from(studyEvents)
    .where(eq(studyEvents.assignmentId, assignmentId))
    .orderBy(asc(studyEvents.createdAt));
  const types = new Set(events.map((e) => e.eventType));
  console.log(`\n${events.length} event(s): ${[...types].sort().join(', ')}\n`);

  // Every one of these is something the analysis reads and nothing else
  // records. A missing one here is a hole that cannot be filled afterwards.
  for (const required of [
    'simple_version_save',
    'simple_version_restore',
    'simple_response_view',
    'simple_pin_add',
    'simple_pin_remove',
  ]) {
    check(`logged ${required}`, types.has(required));
  }
  if (arm === 'score') {
    check('logged simple_judge_run', types.has('simple_judge_run'));
  } else {
    // Nothing to decide about when one document answers everything, so a
    // judging event here would be a record of work that did not happen.
    check('no judging on the one-document arm', !types.has('simple_judge_run'));
  }

  const saves = events.filter((e) => e.eventType === 'simple_version_save');
  if (arm === 'score') {
    const withCreate = saves.find(
      (e) => ((e.payload as { created?: number[] })?.created ?? []).length
    );
    check('a save says which intents it created', !!withCreate);
  } else {
    const withChars = saves.find(
      (e) => typeof (e.payload as { deltaChars?: number })?.deltaChars === 'number'
    );
    check('a save says how much the document changed', !!withChars);
  }
  const reorderEvent = saves.find((e) => (e.payload as { reordered?: boolean })?.reordered);
  check(
    'a save that only reordered says so',
    arm !== 'score' || !!reorderEvent,
    arm === 'score' ? `${saves.length} save(s) logged` : 'baseline arm — no tree'
  );

  }
  // ── clean up what this run made ─────────────────────────────────────
  const written = await db
    .select({ id: simpleConfigVersions.id })
    .from(simpleConfigVersions)
    .where(eq(simpleConfigVersions.assignmentId, assignmentId));
  if (!participantNumber) {
    const ids = written.map((k) => k.id);
    if (ids.length) {
      await db.delete(simpleConfigVersions).where(inArray(simpleConfigVersions.id, ids));
    }
    await db.delete(simpleRatings).where(eq(simpleRatings.assignmentId, assignmentId));
    await db.delete(simplePins).where(eq(simplePins.assignmentId, assignmentId));
    // Only what this run wrote: an assignment may carry events from before it,
    // and a check that tidies up by deleting someone else's data is worse than
    // one that leaves a mess.
    await db
      .delete(studyEvents)
      .where(and(eq(studyEvents.assignmentId, assignmentId), gt(studyEvents.id, eventsHighWater)));
    console.log('\ncleaned up the preview run (versions, verdicts, pins, events)');
  } else {
    console.log(`\nleft ${written.length} version(s) on the participant clone — clean up by hand`);
  }

  console.log(`\n${pass} passed, ${fail} failed · started from ${startingVersions} version(s)`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
