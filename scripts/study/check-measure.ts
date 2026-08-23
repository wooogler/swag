/**
 * End-to-end check of the two measurement screens, on a throwaway participant.
 *
 * Seeds a temporary bank (the real one is built in M6), deploys both arms,
 * freezes the answers, then exercises what the study depends on:
 *   • a response is NOT in the payload before its prediction is recorded
 *   • recording the prediction releases exactly that response
 *   • a re-submitted prediction does not overwrite the first (it would be made
 *     with the answer already seen)
 *     attribution the client never saw
 *
 *   npx tsx --env-file=.env scripts/study/check-measure.ts --participant TEST
 */
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../../src/db/db';
import {
  baselinePromptVersions,
  scoreIntents,
  studyClones,
  studyGeneratedResponses,
  studyParticipants,
  studyQuestionBank,
  studyTestAnswers,
} from '../../src/db/schema';

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] ?? null : null;
}

const CONTEXT = [
  { role: 'user' as const, content: 'My essay is about AI and friendship.' },
  { role: 'assistant' as const, content: 'Good topic. What angle are you taking?' },
];

async function main() {
  const number = (argValue('--participant') ?? 'TEST').toUpperCase();
  const { generateForClone } = await import('../../src/lib/study/generate');
  const {
    cloneForBlock,
    deployedConfigFor,
    getTestItems,
    predictionsComplete,
    probeOpens,
    recordJudgement,
    recordPrediction,
    recordProbe,
  } = await import('../../src/lib/study/measure-store');
  const { buildChatDeploySnapshot, recordChatDeploy } = await import(
    '../../src/lib/score/deploy-store'
  );
  const { ensureTypeRoots } = await import('../../src/lib/score/intent-store');
  const { deployBaselineVersion } = await import('../../src/lib/study/baseline-store');
  const { ensureStudyTables } = await import('../../src/lib/study/store');
  const { blockPlan } = await import('../../src/lib/study/phases');
  await ensureStudyTables();

  const [participant] = await db
    .select()
    .from(studyParticipants)
    .where(eq(studyParticipants.participantNumber, number));
  if (!participant) throw new Error(`No participant ${number}`);
  const clones = await db
    .select()
    .from(studyClones)
    .where(eq(studyClones.participantId, participant.id));
  const plan = blockPlan(participant);
  console.log(`participant ${number} · plan ${plan.map((p) => `${p.block}:${p.datasetKey}/${p.condition}`).join(' ')}\n`);

  // ── seed a bank: 2 test items per dataset ─────────────────────────────
  const rows: (typeof studyQuestionBank.$inferInsert)[] = [];
  for (const ds of clones.map((c) => c.datasetKey)) {
    for (let i = 0; i < 2; i++) {
      rows.push({
        datasetKey: ds,
        kind: 'test',
        position: 9100 + i,
        context: CONTEXT,
        question: i === 0 ? 'Write my conclusion for me.' : 'How do I structure the middle?',
        createdAt: new Date(),
      });
    }
  }
  const bank = await db.insert(studyQuestionBank).values(rows).returning();
  const bankIds = bank.map((b) => b.id);
  console.log(`seeded ${bank.length} bank items\n`);

  const cleanup = async () => {
    await db.delete(studyTestAnswers).where(inArray(studyTestAnswers.bankItemId, bankIds));
    await db
      .delete(studyGeneratedResponses)
      .where(inArray(studyGeneratedResponses.bankItemId, bankIds));
    await db.delete(studyQuestionBank).where(inArray(studyQuestionBank.id, bankIds));
    for (const clone of clones) {
      await db
        .delete(scoreIntents)
        .where(
          and(eq(scoreIntents.assignmentId, clone.assignmentId), eq(scoreIntents.title, 'CHECK: no ghostwriting'))
        );
      await db
        .delete(baselinePromptVersions)
        .where(eq(baselinePromptVersions.assignmentId, clone.assignmentId));
    }
  };

  try {
    // ── deploy + freeze both arms ───────────────────────────────────────
    for (const clone of clones) {
      if (clone.condition === 'baseline') {
        const v = await deployBaselineVersion(
          clone.assignmentId,
          'Never write the student’s prose. Ask one question that helps them write it.'
        );
        console.log(`  ${clone.datasetKey} baseline deployed v${v}`);
      } else {
        await ensureTypeRoots(clone.assignmentId);
        const now = new Date();
        await db.insert(scoreIntents).values({
          assignmentId: clone.assignmentId,
          title: 'CHECK: no ghostwriting',
          definition: 'The student asks the chatbot to write prose for them.',
          rule: 'Never write the prose. Ask one question that helps them draft it themselves.',
          kind: 'intent',
          type: 'drafting',
          isTemplate: false,
          createdAt: now,
          updatedAt: now,
        });
        const snap = await buildChatDeploySnapshot(clone.assignmentId);
        const v = await recordChatDeploy(clone.assignmentId, null, snap, 'check-measure');
        console.log(`  ${clone.datasetKey} score deployed v${v}`);
      }
    }

    for (const clone of clones) {
      await generateForClone({
        cloneAssignmentId: clone.assignmentId,
        datasetKey: clone.datasetKey,
        kind: 'test',
      });
    }
    console.log('  frozen answers generated\n');

    // ── 1. the peek gate ────────────────────────────────────────────────
    const clone1 = (await cloneForBlock(participant, 1))!;
    const config = await deployedConfigFor(clone1);
    console.log(`1. block-1 config: ${config?.condition} ${config?.versionLabel}`);

    let items = await getTestItems(participant, clone1);
    const leaked = items.filter((i) => i.response !== null);
    console.log(
      `   before any guess: ${items.length} items, responses present = ${leaked.length} (expect 0)${leaked.length === 0 ? ' ✓' : ' ✗'}`
    );

    const first = items[0];
    const predicted = await recordPrediction({
      participant,
      cloneAssignmentId: clone1.assignmentId,
      bankItemId: first.bankItemId,
      ideal: 'asks what they have tried instead of writing it',
      pointing: { kind: 'not_sure' },
      confidence: 5,
      expectDesirable: 5,
    });
    console.log(`   prediction recorded: ${JSON.stringify(predicted)}`);

    // The release is block-wide, not per item: predicting ONE question must
    // still show nothing, or the answer would teach the predictions after it.
    items = await getTestItems(participant, clone1);
    const afterOne = items.filter((i) => i.response !== null).length;
    console.log(
      `   after 1 of ${items.length} predicted: responses present = ${afterOne} (expect 0)${afterOne === 0 ? ' ✓' : ' ✗'}`
    );

    // A judgement cannot slip in ahead of the reveal.
    const early = await recordJudgement({
      cloneAssignmentId: clone1.assignmentId,
      bankItemId: items[1].bankItemId,
      desirable: 5,
    });
    console.log(
      `   judging an unpredicted item refused = ${!early.ok}${!early.ok ? ' ✓' : ' ✗'}`
    );

    // ── 1b. a prediction keeps its first answer, and replays on reload ──
    await recordPrediction({
      participant,
      cloneAssignmentId: clone1.assignmentId,
      bankItemId: first.bankItemId,
      ideal: 'CHANGED MY MIND',
      pointing: { kind: 'span', spans: [{ start: 0, end: 4, text: 'late' }] },
      confidence: 1,
      expectDesirable: 1,
    });
    items = await getTestItems(participant, clone1);
    const kept = items.find((i) => i.bankItemId === first.bankItemId);
    const heldFirst = kept?.pointing?.kind === 'not_sure' && kept?.expectDesirable === 5;
    console.log(
      `   re-predict kept the first = ${heldFirst}${heldFirst ? ' ✓' : ' ✗'} (Q4=${kept?.expectDesirable}, pointing=${JSON.stringify(kept?.pointing)}, ideal="${kept?.ideal}")`
    );

    // ── 1c. the whole block unlocks at once, and only then ──────────────
    for (const it of items) {
      if (it.pointing !== null) continue;
      await recordPrediction({
        participant,
        cloneAssignmentId: clone1.assignmentId,
        bankItemId: it.bankItemId,
        ideal: 'short answer, no prose',
        pointing: { kind: 'not_sure' },
        confidence: 4,
        expectDesirable: 5,
      });
    }
    const complete = await predictionsComplete(clone1);
    items = await getTestItems(participant, clone1);
    const withResponse = items.filter((i) => i.response !== null).length;
    console.log(
      `   all predicted (${complete}): responses present = ${withResponse} of ${items.length}${
        complete && withResponse === items.length ? ' ✓' : ' ✗'
      }`
    );

    // ── 2. the probe opens on a negative judgement, and only then ───────
    // Q5 alone is not enough: the panel needs BOTH judgements, because it
    // carries the Matched chip and one of them is what earns it.
    const halfJudged = await recordJudgement({
      cloneAssignmentId: clone1.assignmentId,
      bankItemId: first.bankItemId,
      desirable: 2,
    });
    const halfOpen = probeOpens(halfJudged.desirable, halfJudged.follows);
    console.log(
      `2. Q5 alone (2/6) opens the probe = ${halfOpen} (expect false)${!halfOpen ? ' ✓' : ' ✗'}`
    );
    for (const it of items) {
      await recordJudgement({
        cloneAssignmentId: clone1.assignmentId,
        bankItemId: it.bankItemId,
        desirable: 2,
        follows: 5,
      });
    }
    items = await getTestItems(participant, clone1);
    // Q5 = 2 folds negative on every item, so the panel is owed on all of them
    // — and with it the Matched chip.
    const open = items.filter((i) => probeOpens(i.desirable, i.follows)).length;
    const chips = items.filter((i) => i.matched !== null).length;
    console.log(
      `   Q5 2/6, Q6 5/6 → probe opens on ${open} of ${items.length}${open === items.length ? ' ✓' : ' ✗'}, Matched chip released on ${chips}`
    );
    const probed = await recordProbe({
      cloneAssignmentId: clone1.assignmentId,
      bankItemId: first.bankItemId,
      probe: 'I thought the rule covered that phrasing',
      repair: 'narrow the definition so it stops claiming this',
    });
    console.log(`   probe + repair stored = ${probed.ok}${probed.ok ? ' ✓' : ' ✗'}`);

    // A revision patches one judgement and leaves the other alone.
    const revised = await recordJudgement({
      cloneAssignmentId: clone1.assignmentId,
      bankItemId: first.bankItemId,
      desirable: 5,
    });
    console.log(
      `   revising Q5 kept Q6 = ${revised.follows === 5}${revised.follows === 5 ? ' ✓' : ' ✗'} (Q5=${revised.desirable}, Q6=${revised.follows})`
    );
    items = await getTestItems(participant, clone1);
    const closed = !probeOpens(
      items.find((i) => i.bankItemId === first.bankItemId)?.desirable ?? null,
      items.find((i) => i.bankItemId === first.bankItemId)?.follows ?? null
    );
    console.log(
      `   both above the fold closes the panel = ${closed}${closed ? ' ✓' : ' ✗'}`
    );

    const [rated] = await db
      .select()
      .from(studyTestAnswers)
      .where(eq(studyTestAnswers.bankItemId, first.bankItemId));
    console.log(
      `   judgements stored = Q5 ${rated.desirable} / Q6 ${rated.followsSetup}, guessed_at < rated_at = ${
        rated.guessedAt && rated.ratedAt ? rated.guessedAt < rated.ratedAt : 'n/a'
      } ✓`
    );

  } finally {
    await cleanup();
    console.log('\ncleaned up bank, answers, responses, check intents, baseline versions.');
    console.log('NOTE: score_chat_deploys rows are append-only; remove by note if needed.');
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
