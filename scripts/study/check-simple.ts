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
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { db } from '../../src/db/db';
import {
  assignments,
  instructors,
  studyReviewQuestions,
  simpleConfigVersions,
  simpleIntentVersions,
  simplePins,
  simpleRatings,
  studyEvents,
  studyParticipants,
} from '../../src/db/schema';
import {
  askedVersionNo,
  describeStep,
  flattenStoredIntents,
} from '../../src/lib/study/simple/chain';
import { intentDefHash } from '../../src/lib/score/intents';
import type { StudioView } from '../../src/lib/study/config';

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
  snapshot: {
    rootRule: string;
    prompt: string;
    intents: { sid: number; title: string; definition: string; rule: string }[];
  };
  versions: { versionNo: number; displayNo: number; name: string | null; kind: string }[];
  moments: { versionNo: number; displayNo: number; name: string | null; kind: string }[];
  atTip: boolean;
  savedVersionNo: number | null;
  deployedVersionNo: number | null;
  dirty: boolean;
  unsavedSids: number[];
  intentVersions: Record<
    string,
    {
      id: number;
      versionNo: number;
      displayNo: number | null;
      definition: string;
      rule: string;
      name: string | null;
      matches: number | null;
    }[]
  >;
  pinned: number[];
  owners: Record<string, { sid: number | null; outcome: string; matchedElsewhere: number[] }>;
  counts: Record<string, number>;
  pending: number;
  working: boolean;
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

  const { deployStateFor } = await import('../../src/lib/study/console-store');
  const state = async () => (await call('state')).body as unknown as StateBody;

  // A previous run's follow-up work outlives the script that started it — it
  // is a floating promise on a long-lived server — so its events can land
  // after this run has taken its high-water mark and be counted as this run's.
  // Two back-to-back runs on one assignment is exactly how this script is
  // used, so wait for the board to go quiet before starting.
  for (let round = 0; round < 20; round += 1) {
    if (!(await state()).working) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  // High-water marks for everything this run will write, so the tidy-up at
  // the end can be about THIS run. The assignment may already hold work — a
  // rehearsal configuration, a clone someone has been clicking through — and
  // a check that cleans up by deleting that is worse than one that leaves a
  // mess behind.
  const [events0] = await db
    .select({ high: sql<number>`coalesce(max(${studyEvents.id}), 0)::int` })
    .from(studyEvents)
    .where(eq(studyEvents.assignmentId, assignmentId));
  const [versions0] = await db
    .select({ high: sql<number>`coalesce(max(${simpleConfigVersions.id}), 0)::int` })
    .from(simpleConfigVersions)
    .where(eq(simpleConfigVersions.assignmentId, assignmentId));
  const [ratings0] = await db
    .select({ high: sql<number>`coalesce(max(${simpleRatings.id}), 0)::int` })
    .from(simpleRatings)
    .where(eq(simpleRatings.assignmentId, assignmentId));
  const [pins0] = await db
    .select({ high: sql<number>`coalesce(max(${simplePins.id}), 0)::int` })
    .from(simplePins)
    .where(eq(simplePins.assignmentId, assignmentId));
  // The per-intent rows too. They used to be left behind, which was harmless
  // while nothing deleted them — a restore does now, so a second run on the
  // same assignment read the first one's orphans and saw a history with holes
  // in it.
  const [intentVersions0] = await db
    .select({ high: sql<number>`coalesce(max(${simpleIntentVersions.id}), 0)::int` })
    .from(simpleIntentVersions)
    .where(eq(simpleIntentVersions.assignmentId, assignmentId));
  const eventsHighWater = events0?.high ?? 0;
  const intentVersionsHighWater = intentVersions0?.high ?? 0;
  const versionsHighWater = versions0?.high ?? 0;
  const ratingsHighWater = ratings0?.high ?? 0;
  const pinsHighWater = pins0?.high ?? 0;

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
  // Each arm writes a different field — the tree's else-rule, or the one
  // document — so an assertion on the wrong one passes vacuously. It did once:
  // two checks read rootRule on both arms, so the baseline's save path was
  // never actually being looked at. Declared out here because the sections
  // that need it sit in two different `if (!startersOnly)` blocks.
  const configText = (snap: StateBody['snapshot']) =>
    arm === 'baseline' ? snap.prompt : snap.rootRule;

  // Steps 1-8 drive every act a participant can perform, which on a real
  // clone means rating a fresh definition against the whole log. --starters
  // skips them to check the library alone, which is the assertion most likely
  // to break silently: a reworded category drifts from the prepared text, the
  // hash stops matching, and adopting a starter quietly becomes a full pass.
  if (!startersOnly) {
  // 0. Reading a configuration written back when intents could nest.
  //
  //    The trap is that a nested snapshot stored its intents parent-first and
  //    EVALUATED them child-first, so flattening by array order reverses every
  //    nested pair — quietly, and only in the answers.
  {
    const flat = flattenStoredIntents([
      { sid: 1, title: 'outer', definition: 'a', rule: 'a', parentSid: null },
      { sid: 2, title: 'inner', definition: 'b', rule: 'b', parentSid: 1 },
      { sid: 3, title: 'later', definition: 'c', rule: 'c', parentSid: null },
    ]);
    check(
      'a nested configuration flattens into the order it was evaluated in',
      flat.map((i) => i.sid).join(',') === '2,1,3',
      flat.map((i) => i.sid).join(',')
    );
    const orphaned = flattenStoredIntents([
      { sid: 1, title: 'child of nobody', definition: 'a', rule: 'a', parentSid: 99 },
      { sid: 2, title: 'in a cycle', definition: 'b', rule: 'b', parentSid: 3 },
      { sid: 3, title: 'the other half', definition: 'c', rule: 'c', parentSid: 2 },
    ]);
    check(
      'a broken tree loses its nesting and not its intents',
      orphaned.length === 3,
      orphaned.map((i) => i.sid).join(',')
    );
  }

  // 0b. What an undo step says it will do.
  //
  //     The control offering it used to be two arrows on the open card's own
  //     button row, so a step that brought back an intent deleted a minute ago
  //     looked like it was going to do something to the card it was drawn on.
  //     Now it says where it lands, which only helps if the sentence is right.
  {
    const base = {
      arm: 'score' as const,
      prompt: '',
      rootRule: 'be helpful',
      intents: [
        { sid: 1, title: 'Grammar', definition: 'a', rule: 'a' },
        { sid: 2, title: 'Outlines', definition: 'b', rule: 'b' },
      ],
    };
    const without = { ...base, intents: [base.intents[1]] };
    check(
      'an undo over a delete says which intent comes back',
      describeStep(without, base) === 'brings back “Grammar”',
      describeStep(without, base)
    );
    check(
      'and the redo the other way says it goes',
      describeStep(base, without) === 'removes “Grammar”',
      describeStep(base, without)
    );
    const edited = {
      ...base,
      intents: [{ ...base.intents[0], rule: 'a2' }, base.intents[1]],
    };
    check(
      'a rewrite names the intent it rewrites',
      describeStep(edited, base) === 'changes “Grammar”',
      describeStep(edited, base)
    );
    const rootOnly = { ...base, rootRule: 'be brief' };
    check(
      'and a step over the uncategorized rule says so instead of naming an intent',
      describeStep(rootOnly, base) === 'changes the Uncategorized rule',
      describeStep(rootOnly, base)
    );
    const swapped = { ...base, intents: [base.intents[1], base.intents[0]] };
    check(
      'a step that only moves them says that',
      describeStep(swapped, base) === 'puts the intents back in their old order',
      describeStep(swapped, base)
    );
  }

  // 0b2. Which version a reply is asked about.
  //
  //      `viewing` is never null — at the tip it IS the tip — so a board that
  //      read it directly could not tell "looking at the newest" from "gone
  //      back to v1", and took the second reading. Everything that is allowed
  //      only at the tip then switched itself off, so every question opened
  //      cost a round trip and a wait to be told what the board already knew.
  {
    check(
      'at the tip a reply is asked about no version in particular',
      askedVersionNo({ pick: null, atTip: true, viewingVersionNo: 3 }) === null,
      String(askedVersionNo({ pick: null, atTip: true, viewingVersionNo: 3 }))
    );
    check(
      'and looking back at an old one asks about that one',
      askedVersionNo({ pick: null, atTip: false, viewingVersionNo: 2 }) === 2,
      String(askedVersionNo({ pick: null, atTip: false, viewingVersionNo: 2 }))
    );
    check(
      'a version chosen on the reply itself wins over both',
      askedVersionNo({ pick: 1, atTip: true, viewingVersionNo: 3 }) === 1,
      String(askedVersionNo({ pick: 1, atTip: true, viewingVersionNo: 3 }))
    );
    check(
      'and the delivered reply is no version at all',
      askedVersionNo({ pick: 'original', atTip: false, viewingVersionNo: 2 }) === null,
      String(askedVersionNo({ pick: 'original', atTip: false, viewingVersionNo: 2 }))
    );
  }

  // 0c. An untouched configuration answers with the conversation that is
  //     already there.
  //
  //     Before anything is written the rule IS the assignment's prompt, which
  //     is what produced the logged reply. Generating a second one under it
  //     would show a different answer and make an untouched configuration look
  //     like it had done something — and it is the state every block opens in,
  //     so it would also be sixty generations nobody asked for.
  if (startingVersions === 0) {
    const { getQueryRecords: first } = await import('../../src/lib/score/queries');
    const someone = (await first(assignmentId))[0]?.messageId;
    if (someone != null) {
      const untouched = await call('respond', {
        method: 'POST',
        body: JSON.stringify({ messageId: someone }),
      });
      check(
        'an untouched configuration keeps the reply the student got',
        (untouched.body as { status?: string })?.status === 'original',
        `status=${(untouched.body as { status?: string })?.status ?? untouched.status}`
      );
    }
  }

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
        },
      ],
    }),
  });
  check('second save returns a version', typeof withIntent.body.versionNo === 'number');
  // The ids it handed out. The board sends a temporary negative one for
  // anything new and cannot know the real one until the write comes back —
  // and it needs it to land on what was just made.
  check(
    'and says which ids it created',
    Array.isArray(withIntent.body.created) && (withIntent.body.created as number[]).length === 1,
    JSON.stringify(withIntent.body.created)
  );
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

    // The rule that produced it, asked for on its own: too long for a header,
    // and the streaming path has nowhere else to carry it. The screen prints
    // this under the reply, so it has to be the rule that actually applied.
    const asked = (await call('respond', {}, `messageId=${messageId}`)).body as {
      rule?: string;
      sid?: number | null;
    };
    check(
      'the rule that answered can be read back',
      typeof asked.rule === 'string' && asked.rule.length > 0,
      `${(asked.rule ?? '').slice(0, 40)}…`
    );
    check(
      'and it is the one the configuration would send',
      asked.rule === configText((await state()).snapshot) ||
        (await state()).snapshot.intents.some((i) => i.rule === asked.rule),
      `sid=${asked.sid ?? 'root'}`
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
    };
    const lengths = {
      sid: -2,
      title: 'CHECK: length questions',
      definition: 'asks how long the essay should be or how many words are required',
      rule: 'Point them at the assignment sheet rather than guessing a number.',
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

  // 6a. An id is never handed out twice.
  //
  //     It used to be inferred from the largest sid in any stored snapshot,
  //     which held while every write appended a row. Applies overwrite one
  //     working row now, so an intent created and deleted without ever being
  //     saved left no trace and the next one was given its id back — along
  //     with its examples, its history and its cached verdicts.
  if (arm === 'score') {
    const body = (intents: unknown[]) =>
      JSON.stringify({
        kind: 'apply',
        rootRule: 'Answer briefly and never write the essay for them.',
        prompt: 'Answer briefly and never write the essay for them.',
        intents,
      });
    const first = await call('save', {
      method: 'POST',
      body: body([
        { title: 'CHECK: doomed', definition: 'is a greeting', rule: 'Doomed rule.' },
      ]),
    });
    await call('save', { method: 'POST', body: body([]) });
    const second = await call('save', {
      method: 'POST',
      body: body([
        { title: 'CHECK: fresh', definition: 'asks how many sources', rule: 'Fresh rule.' },
      ]),
    });
    const a = (first.body.created as number[])?.[0];
    const b = (second.body.created as number[])?.[0];
    check(
      'an id is not handed out again after a delete',
      typeof a === 'number' && typeof b === 'number' && a !== b,
      `${a} then ${b}`
    );
    await call('save', { method: 'POST', body: body([]) });
    await settle();
  }

  // 6b. Two intents that describe exactly the same questions.
  //
  //     Identical definitions make first-match testable without depending on
  //     what the judge thinks of any particular wording: every question either
  //     matches both or neither, so the one above must own all of them and the
  //     one below must appear beside every one of them as a loser. That second
  //     half is what an intent's own question list is built from — open the
  //     lower one and it still shows the questions its words describe, with
  //     the chip saying where they actually went.
  if (arm === 'score') {
    const same = 'is a greeting or small talk rather than a question about the assignment';
    const pair = (order: [string, string]) =>
      JSON.stringify({
        rootRule: 'Answer briefly and never write the essay for them.',
        prompt: 'Answer briefly and never write the essay for them.',
        intents: order.map((title) => ({ title, definition: same, rule: `Rule for ${title}.` })),
      });

    await call('save', { method: 'POST', body: pair(['CHECK: above', 'CHECK: below']) });
    await settle();
    const twins = await state();
    const above = twins.snapshot.intents.find((i) => i.title === 'CHECK: above')?.sid;
    const below = twins.snapshot.intents.find((i) => i.title === 'CHECK: below')?.sid;
    const owned = Object.values(twins.owners).filter((o) => o.outcome === 'intent');
    // The claim needs the shared definition to describe at least one question
    // in THIS log, and whether it does is a property of the dataset. Saying so
    // beats asserting it: on a curated set with no greetings in it, every one
    // of these would fail while nothing was wrong.
    if (owned.length === 0) {
      console.log('· nothing here matches the shared definition — first-match not exercised');
    } else {
    check(
      'the intent above takes every question the two share',
      above != null && owned.every((o) => o.sid === above),
      `${owned.length} owned, ${new Set(owned.map((o) => o.sid)).size} distinct owner(s)`
    );
    check(
      'and the one below is still listed beside each of them',
      below != null && owned.length > 0 && owned.every((o) => o.matchedElsewhere.includes(below)),
      `${owned.filter((o) => below != null && o.matchedElsewhere.includes(below)).length}/${owned.length}`
    );
    check(
      'nothing counts twice',
      twins.counts[String(below)] === undefined || twins.counts[String(below)] === 0,
      `above=${twins.counts[String(above)] ?? 0}, below=${twins.counts[String(below)] ?? 0}`
    );
    }

    // Carving one out ABOVE another is the whole of what the board promises
    // when an intent is started from a question: it cannot promise the words
    // will match, only that they are read first. Same two definitions, other
    // way up.
    await call('save', { method: 'POST', body: pair(['CHECK: below', 'CHECK: above']) });
    await settle();
    const flipped = await state();
    const nowFirst = flipped.snapshot.intents[0]?.sid;
    const nowOwned = Object.values(flipped.owners).filter((o) => o.outcome === 'intent');
    if (nowOwned.length > 0) {
      check(
        'putting the other one first hands it every one of those questions',
        nowOwned.every((o) => o.sid === nowFirst),
        `first=${nowFirst}, owners=${[...new Set(nowOwned.map((o) => o.sid))].join(',')}`
      );
    }
  }

  // 6c. An intent written without a name gets one.
  //
  //     The creation form asks for a description and nothing else, so this is
  //     the path every intent takes unless a starter set brought a name with
  //     it. It is a label — never judged, never sent to the chatbot, left out
  //     of the per-intent version axis — so it lands after the write, and the
  //     write is not allowed to wait for it.
  if (arm === 'score') {
    await call('save', {
      method: 'POST',
      body: JSON.stringify({
        rootRule: 'Answer briefly and never write the essay for them.',
        prompt: 'Answer briefly and never write the essay for them.',
        intents: [
          {
            title: '',
            definition: 'asks how many sources the essay needs',
            rule: 'Point them at the assignment sheet.',
          },
        ],
      }),
    });
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const titled = await state();
    const written = titled.snapshot.intents[0];
    check(
      'an intent written without a name is given one',
      (written?.title ?? '').trim().length > 0,
      `title=${JSON.stringify(written?.title ?? null)}`
    );
    check(
      'and its own words are left alone',
      written?.definition === 'asks how many sources the essay needs'
    );
  }

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
  // 8b. Apply, Save and Revert — and the invariant the split rests on: the
  //     study measures the SAVE, so a block must not be endable while
  //     something is applied and unsaved.
  if (!startersOnly) {
    const beforeApply = await state();
    const savedBefore = beforeApply.savedVersionNo;
    await call('save', {
      method: 'POST',
      body: JSON.stringify({
        kind: 'apply',
        rootRule: 'Answer briefly. Applied, not saved.',
        prompt: 'Answer briefly. Applied, not saved.',
        intents: beforeApply.snapshot.intents,
      }),
    });
    const applied = await state();
    check('an apply takes effect', configText(applied.snapshot).includes('Applied, not saved'));
    check('and is not in the history', applied.versions.length === beforeApply.versions.length,
      `${beforeApply.versions.length} → ${applied.versions.length}`);
    check('and leaves the save where it was', applied.savedVersionNo === savedBefore);
    check('and says so', applied.dirty);
    // WHICH one, not just whether — this is what the tree marks, and after
    // the standing "everything is saved" line went away it is the only
    // ambient sign that the next step will not read this work.
    check(
      'and says which part of the configuration moved',
      applied.unsavedSids.length > 0,
      `sids ${applied.unsavedSids.join(',') || 'none'}`
    );

    // The gate the whole split depends on.
    const gate = await deployStateFor({
      assignmentId,
      condition: (view ?? 'simple_score') as StudioView,
    });
    check('a block cannot end on unsaved changes', !gate.deployed && gate.unsaved === true,
      `deployed=${gate.deployed} unsaved=${gate.unsaved} (${gate.label})`);

    // Revert: back to the point they marked.
    await call('revert', { method: 'POST' });
    const reverted = await state();
    check('revert drops the applies', !configText(reverted.snapshot).includes('Applied, not saved'));
    check('and clears the unsaved state', !reverted.dirty && reverted.unsavedSids.length === 0);
    check('and keeps the save', reverted.savedVersionNo === savedBefore);

    // Apply again, then commit it — Save takes what is in EFFECT.
    await call('save', {
      method: 'POST',
      body: JSON.stringify({
        kind: 'apply',
        rootRule: 'Answer briefly. This one gets kept.',
        prompt: 'Answer briefly. This one gets kept.',
        intents: reverted.snapshot.intents,
      }),
    });
    await call('commit', { method: 'POST' });
    const committed = await state();
    check(
      'commit marks what is in effect',
      !committed.dirty && committed.unsavedSids.length === 0
    );
    check('and it is in the history', committed.versions.length === beforeApply.versions.length + 1,
      `${beforeApply.versions.length} → ${committed.versions.length}`);
    check(
      'and it is what the study would measure',
      committed.savedVersionNo === committed.versions[0]?.versionNo &&
        configText(committed.snapshot).includes('This one gets kept')
    );
    // Saving is still not finishing. Deploy is the final save — the briefing
    // tells them to deploy when it is ready — so a block cannot end on a
    // configuration nobody stood behind, however carefully it was saved.
    const gateSaved = await deployStateFor({
      assignmentId,
      condition: (view ?? 'simple_score') as StudioView,
    });
    check(
      'saving is not deploying',
      !gateSaved.deployed && gateSaved.label === 'never deployed',
      `${gateSaved.label}`
    );
    const deployed = await call('deploy', { method: 'POST' });
    check(
      'deploy takes what is in effect',
      deployed.status === 200 && typeof deployed.body.versionNo === 'number',
      `v${deployed.body.versionNo}`
    );
    const afterDeploy = await state();
    check(
      'and the board says which version they stood behind',
      afterDeploy.deployedVersionNo === deployed.body.versionNo,
      `${afterDeploy.deployedVersionNo}`
    );
    const gateAfter = await deployStateFor({
      assignmentId,
      condition: (view ?? 'simple_score') as StudioView,
    });
    check('and the block can end now', gateAfter.deployed, `${gateAfter.label}`);

    // Working on after deploying puts the gate back up: what is on screen is
    // no longer what the next step would read.
    await call('save', {
      method: 'POST',
      body: JSON.stringify({
        kind: 'apply',
        rootRule: 'Answer briefly. Changed after deploying.',
        prompt: 'Answer briefly. Changed after deploying.',
        intents: afterDeploy.snapshot.intents,
      }),
    });
    const gateMoved = await deployStateFor({
      assignmentId,
      condition: (view ?? 'simple_score') as StudioView,
    });
    check(
      'and goes back up once they work on past it',
      !gateMoved.deployed && gateMoved.label === 'changed since deploy',
      `${gateMoved.label}`
    );
    // Deploying again catches up, and saves on the way.
    const again = await call('deploy', { method: 'POST' });
    check(
      'deploying again saves what is in effect first',
      again.status === 200 && again.body.committed === true,
      `committed=${again.body.committed}`
    );
    const gateCaught = await deployStateFor({
      assignmentId,
      condition: (view ?? 'simple_score') as StudioView,
    });
    check('and stands behind it', gateCaught.deployed, `${gateCaught.label}`);
  }

  // 8c. The version axis the participant reads: one timeline per intent.
  if (!startersOnly) {
    const now = await state();
    // sid 0 is the everything-else rule on one arm and the whole document on
    // the other; either way it has a history, and it has been edited by now.
    const rootHistory = now.intentVersions['0'] ?? [];
    check('the else-rule keeps its own history', rootHistory.length > 0, `${rootHistory.length} version(s)`);
    // Numbered per intent: v1 is this intent's first wording whatever the rest
    // of the setup had done by then. The setup keeps its own count, and the
    // board calls those "setup 3" so the two are never both "v".
    check(
      'numbered from 1, newest first',
      rootHistory[0]?.versionNo === rootHistory.length,
      rootHistory.map((v) => `v${v.versionNo}`).join(' ')
    );
    check(
      'each row carries the number of the save it belongs to',
      rootHistory.every((v) => typeof v.displayNo === 'number' && v.displayNo > 0),
      rootHistory.map((v) => `v${v.displayNo ?? '?'}`).join(' ')
    );
    check(
      'newest first, and never more than there are saves',
      rootHistory.every(
        (v, i) => i === 0 || (v.displayNo ?? 0) < (rootHistory[i - 1].displayNo ?? 0)
      ) && (rootHistory[0]?.displayNo ?? 0) <= now.versions.length,
      `${rootHistory.map((v) => `v${v.displayNo ?? '?'}`).join(' ')} · ${now.versions.length} save(s)`
    );

    if (arm === 'score') {
      const sids = Object.keys(now.intentVersions).filter((k) => k !== '0');
      check('each intent has its own timeline', sids.length > 0, `${sids.length} intent(s)`);
      // The point of a per-intent axis, measured directly: change ONE
      // intent's rule and nobody else's timeline moves. (Counting versions
      // across a whole run cannot show this — the script edits the else-rule
      // several times of its own accord.)
      // Commit whatever is applied first. A save carries everything that was
      // in effect, so without this the root rule rides along and the claim
      // being tested — that ONE intent moved — is measured against a save that
      // was always going to move two.
      await call('save', {
        method: 'POST',
        body: JSON.stringify({
          rootRule: now.snapshot.rootRule,
          prompt: now.snapshot.prompt,
          intents: now.snapshot.intents,
        }),
      });
      const clean = await state();
      const countsBefore = Object.fromEntries(
        Object.entries(clean.intentVersions).map(([k, v]) => [k, v.length])
      );
      const target = clean.snapshot.intents[0];
      const changed = (kind: 'apply' | 'save') =>
        JSON.stringify({
          kind,
          rootRule: clean.snapshot.rootRule,
          prompt: clean.snapshot.prompt,
          intents: clean.snapshot.intents.map((i) =>
            i.sid === target.sid ? { ...i, rule: `${i.rule} One sentence only.` } : i
          ),
        });

      await call('save', { method: 'POST', body: changed('apply') });
      const applied = await state();
      // Applying is meant to be cheap enough to do constantly, so it writes
      // no version. It mattered more than tidiness: picking an old wording
      // from the history APPLIES it, so while applies were versioned, reading
      // your own history wrote new entries into it.
      check(
        'an apply versions nobody',
        (applied.intentVersions[String(target.sid)] ?? []).length ===
          (clean.intentVersions[String(target.sid)] ?? []).length,
        `${(clean.intentVersions[String(target.sid)] ?? []).length} → ${(applied.intentVersions[String(target.sid)] ?? []).length}`
      );

      // Keeping it is what writes one, and only for the intent whose words
      // moved.
      await call('save', { method: 'POST', body: changed('save') });
      const after = await state();
      const moved = Object.entries(after.intentVersions)
        .filter(([k, v]) => v.length !== (countsBefore[k] ?? 0))
        .map(([k]) => k);
      check(
        'changing one intent versions only that intent',
        moved.length === 1 && moved[0] === String(target.sid),
        `moved: ${moved.join(', ') || 'none'}`
      );
      // And a version carries what that wording caught, which a reader
      // compares across rows: did widening this pick up more.
      const newest = after.intentVersions[String(target.sid)]?.[0];
      check(
        'a version says how many questions its wording describes',
        newest != null && typeof newest.matches === 'number',
        `${newest?.matches ?? 'null'}`
      );

      // The reply's picker names a wording out of an intent's own history,
      // so the answering route takes a ROW id as well as a configuration. It
      // is still not the client naming a rule: both are rows this board wrote.
      {
        const row = (after.intentVersions[String(target.sid)] ?? [])[0];
        const asked = await call(
          'respond',
          { method: 'GET' },
          `messageId=${Number(Object.keys(after.owners)[0] ?? 0)}&intentVersionId=${row.id}`
        );
        check(
          'a reply can be asked for under one of an intent’s own wordings',
          asked.status === 200 && asked.body.rule === row.rule,
          `${asked.status} ${String(asked.body.rule).slice(0, 30)}`
        );
        const bogus = await call(
          'respond',
          { method: 'GET' },
          `messageId=${Number(Object.keys(after.owners)[0] ?? 0)}&intentVersionId=999999999`
        );
        check('and an id from nowhere is refused', bogus.status === 404, `${bogus.status}`);
      }

      // And a reorder, which changes no text at all, versions nobody.
      const beforeReorder = Object.fromEntries(
        Object.entries(after.intentVersions).map(([k, v]) => [k, v.length])
      );
      await call('save', {
        method: 'POST',
        body: JSON.stringify({
          rootRule: after.snapshot.rootRule,
          prompt: after.snapshot.prompt,
          intents: [...after.snapshot.intents].reverse(),
        }),
      });
      const reordered = await state();
      check(
        'reordering versions nobody',
        Object.entries(reordered.intentVersions).every(
          ([k, v]) => v.length === (beforeReorder[k] ?? 0)
        ),
        Object.entries(reordered.intentVersions).map(([k, v]) => `${k}:${v.length}`).join(' ')
      );
      // The Save BUTTON posts to `commit`, not here, and it has to write the
      // same row. It used to assume every pair "already has the version it is
      // going to get" — true only if applies wrote them, and they deliberately
      // do not — so an intent applied and then saved from the board kept the
      // history it was created with and nothing else, forever.
      const beforeCommit = (reordered.intentVersions[String(target.sid)] ?? []).length;
      await call('save', {
        method: 'POST',
        body: JSON.stringify({
          kind: 'apply',
          rootRule: reordered.snapshot.rootRule,
          prompt: reordered.snapshot.prompt,
          intents: reordered.snapshot.intents.map((i) =>
            i.sid === target.sid ? { ...i, rule: `${i.rule} Kept by the button.` } : i
          ),
        }),
      });
      await call('commit', { method: 'POST' });
      const kept = await state();
      const keptRows = kept.intentVersions[String(target.sid)] ?? [];
      check(
        'pressing Save writes the version the apply was holding',
        keptRows.length === beforeCommit + 1,
        `${beforeCommit} → ${keptRows.length}`
      );
      check(
        'and it carries the wording that was in effect',
        keptRows[0]?.rule.includes('Kept by the button.') === true,
        keptRows[0]?.rule.slice(-30) ?? 'none'
      );

      // A version is the pair, not the rule alone.
      const anyVersion = now.intentVersions[sids[0]]?.[0];
      check(
        'a version carries the when and the then',
        !!anyVersion && typeof anyVersion.definition === 'string' && typeof anyVersion.rule === 'string'
      );
    }
  }

  // 8d. Two lists of versions, because they answer two questions.
  //
  //     The timeline asks "where can I go back to" and only a save is one.
  //     The conversation asks "what did this answer look like then", and an
  //     apply is as much a moment as a save — the run has made several by now,
  //     and an intent's own history points at them. Listing only saves there
  //     meant a wording the history offered could not be looked at.
  {
    const settled = await state();
    check(
      'the timeline is the saves',
      settled.versions.every((v) => v.kind === 'save'),
      settled.versions.map((v) => v.kind).join(',') || 'none'
    );
    // An apply is not a version, so the timeline must not grow — and applying
    // twice must not grow it twice either, because the second overwrites the
    // working state rather than stacking on it.
    const body = (rule: string) =>
      JSON.stringify({
        kind: 'apply',
        rootRule: rule,
        prompt: rule,
        intents: settled.snapshot.intents,
      });
    await call('save', { method: 'POST', body: body('Answer briefly. Applied once.') });
    const once = await state();
    await call('save', { method: 'POST', body: body('Answer briefly. Applied twice.') });
    const twice = await state();
    check(
      'applying does not add a version',
      once.versions.length === settled.versions.length &&
        twice.versions.length === settled.versions.length,
      `${settled.versions.length} → ${once.versions.length} → ${twice.versions.length}`
    );
    check(
      'and applying again overwrites what was applied',
      twice.moments.length === once.moments.length &&
        twice.moments.length === settled.moments.length + 1,
      `${settled.moments.length} → ${once.moments.length} → ${twice.moments.length} moment(s)`
    );
    check(
      'the conversation can be read under the saves and what is applied on top',
      twice.moments.filter((v) => v.kind === 'apply').length === 1 &&
        settled.versions.every((v) => twice.moments.some((m) => m.versionNo === v.versionNo)),
      `${twice.versions.length} save(s) of ${twice.moments.length} moment(s)`
    );
    // And the working row goes away when a save takes its place.
    await call('save', { method: 'POST', body: JSON.stringify({
      rootRule: 'Answer briefly. Applied twice.',
      prompt: 'Answer briefly. Applied twice.',
      intents: twice.snapshot.intents,
    }) });
    const kept = await state();
    check(
      'and saving replaces it rather than sitting on top of it',
      kept.moments.filter((v) => v.kind === 'apply').length === 0 &&
        kept.moments.length === kept.versions.length,
      `${kept.moments.length} moment(s), ${kept.versions.length} save(s)`
    );
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
          { sid: -9, title: pick.title, definition: pick.definition, rule: '' },
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

    // The dot, and the claim behind it: a starter marked as containing a
    // question has to be a starter the board then puts that question in. Both
    // read the same prepared verdicts, so disagreement would mean the dropdown
    // and the list are answering from different places.
    const landed = Object.entries(adopted.owners).find(
      ([, o]) => o.outcome === 'intent' && o.sid === sidOf
    );
    if (landed) {
      const marked = (await call('starters', {}, `forMessageId=${landed[0]}`)).body as {
        groups?: { whole: { title: string; contains: boolean }; items: { title: string; contains: boolean }[] }[];
      };
      const all = (marked.groups ?? []).flatMap((g) => [g.whole, ...g.items]);
      check(
        'a starter is marked as containing a question the board puts in it',
        all.find((i) => i.title === pick.title)?.contains === true,
        `question ${landed[0]}, ${all.filter((i) => i.contains).length}/${all.length} marked`
      );
    }

    // 9b. The order the list is read in.
    //
    //     The first row a participant reads is what tells them whether the
    //     classifier can be trusted, so it should be the least arguable member
    //     of the category rather than whichever student asked first. It is a
    //     REARRANGEMENT and never a filter — a ranking that quietly dropped a
    //     question would be the board lying about what a definition catches.
    {
      const now = adopted;
      // Whichever intent holds the most — on a scratch assignment that may be
      // one question, and the rearrange-not-filter claim still bites there.
      const target = [...now.snapshot.intents].sort(
        (a, b) => (now.counts[String(b.sid)] ?? 0) - (now.counts[String(a.sid)] ?? 0)
      )[0];
      const mine = target
        ? Object.entries(now.owners)
            .filter(([, o]) => o.sid === target.sid || o.matchedElsewhere.includes(target.sid))
            .map(([m]) => Number(m))
        : [];
      // Three green ticks over an empty list say nothing. A scratch assignment
      // has no prepared verdicts and nothing lands in any intent, so say that
      // instead of asserting it.
      if (!target || mine.length === 0) {
        console.log('· no intent holds a question here — order not exercised');
      } else {
        const ranked = (await call('rank', {}, `sid=${target.sid}`)).body as {
          order?: number[];
          examples?: { id: number; messageId: number | null; text: string | null }[];
        };
        const order = ranked.order ?? [];
        check(
          'an order comes back for an intent',
          order.length === mine.length,
          `${order.length} of ${mine.length}`
        );
        check(
          'and it rearranges rather than filters',
          order.length === new Set(order).size && mine.every((m) => order.includes(m)),
          `${new Set(order).size} distinct`
        );
        // The examples are the anchor, and an intent written from nothing gets
        // a set from the words it was written with. Without one the list keeps
        // the order it already had, which is the failure this notices.
        check(
          'the intent stands for something',
          (ranked.examples ?? []).length > 0,
          `${(ranked.examples ?? []).length} example(s)`
        );
        // The same list from the far end: same questions, the other way up. It
        // must not filter — that end is where the next intent comes from, and
        // a missing row is a candidate nobody was offered.
        const far = (await call('rank', {}, `sid=${target.sid}&order=furthest`)).body as {
          order?: number[];
        };
        check(
          'the far end holds the same questions',
          (far.order ?? []).length === order.length &&
            order.every((m) => (far.order ?? []).includes(m)),
          `${(far.order ?? []).length} of ${order.length}`
        );
        check(
          'and turns them over',
          order.length < 2 || (far.order ?? [])[0] !== order[0],
          `${order[0]} → ${(far.order ?? [])[0]}`
        );
        check(
          'the owned questions come before the ones taken elsewhere',
          (() => {
            const ownedAt = order
              .map((m, i) => ({ i, owned: now.owners[String(m)]?.sid === target.sid }))
              .filter((x) => x.owned)
              .map((x) => x.i);
            const elseAt = order
              .map((m, i) => ({ i, owned: now.owners[String(m)]?.sid === target.sid }))
              .filter((x) => !x.owned)
              .map((x) => x.i);
            return ownedAt.length === 0 || elseAt.length === 0 || Math.max(...ownedAt) < Math.min(...elseAt);
          })()
        );
      }
    }

    // Copied, not re-rated: the prepared verdicts were stamped when the clone
    // was made, so a fresh rating pass would carry today's timestamp.
    const rows = await db
      .select()
      .from(simpleRatings)
      .where(eq(simpleRatings.assignmentId, assignmentId));
    const added = rows.length - ratedBefore;
    // Only THIS starter's verdicts. The run writes definitions of its own and
    // those are judged for real, so counting every row stamped in the last ten
    // minutes reports the script's own work as a re-rating of the starter.
    const startedAt = Date.now() - 10 * 60_000;
    const pickHash = intentDefHash(pick.definition);
    const fresh = rows.filter(
      (r) => r.defHash === pickHash && r.ratedAt.getTime() > startedAt
    ).length;
    check(
      'and cost no new judgements',
      added > 0 && fresh === 0,
      `${added} verdict(s) added, ${fresh} of them freshly rated for “${pick.title}”`
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
  // Wait for the last save's follow-up work before reading the trail, so a
  // judging pass that is still running is not counted as never having
  // happened — and so it is inside the window this run then cleans up.
  for (let round = 0; round < 20; round += 1) {
    if (!(await state()).working) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  await new Promise((resolve) => setTimeout(resolve, 1500));

  // THIS run's trail. It used to read every event on the assignment, so a
  // straggler that landed after a previous run's tidy-up was asserted against
  // here — which is how a baseline run came to be told it had judged
  // something, using a score run's event.
  const events = await db
    .select()
    .from(studyEvents)
    .where(and(eq(studyEvents.assignmentId, assignmentId), gt(studyEvents.id, eventsHighWater)))
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
  // ── clean up what this run made, and only that ──────────────────────
  const written = await db
    .select({ id: simpleConfigVersions.id })
    .from(simpleConfigVersions)
    .where(
      and(
        eq(simpleConfigVersions.assignmentId, assignmentId),
        gt(simpleConfigVersions.id, versionsHighWater)
      )
    );
  if (!participantNumber) {
    await db
      .delete(simpleConfigVersions)
      .where(
        and(
          eq(simpleConfigVersions.assignmentId, assignmentId),
          gt(simpleConfigVersions.id, versionsHighWater)
        )
      );
    await db
      .delete(simpleIntentVersions)
      .where(
        and(
          eq(simpleIntentVersions.assignmentId, assignmentId),
          gt(simpleIntentVersions.id, intentVersionsHighWater)
        )
      );
    await db
      .delete(simpleRatings)
      .where(and(eq(simpleRatings.assignmentId, assignmentId), gt(simpleRatings.id, ratingsHighWater)));
    await db
      .delete(simplePins)
      .where(and(eq(simplePins.assignmentId, assignmentId), gt(simplePins.id, pinsHighWater)));
    await db
      .delete(studyEvents)
      .where(and(eq(studyEvents.assignmentId, assignmentId), gt(studyEvents.id, eventsHighWater)));
    console.log('\ncleaned up the preview run (versions, intent versions, verdicts, pins, events)');
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
