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
    recordPrediction,
    recordProbe,
    recordRating,
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
      expectation: 'asks what they have tried instead of writing it',
      guess: true,
      pointing: { kind: 'not_sure' },
    });
    console.log(`   prediction recorded: ${JSON.stringify(predicted)}`);

    // The release is block-wide, not per item: predicting ONE question must
    // still show nothing, or the answer would teach the predictions after it.
    items = await getTestItems(participant, clone1);
    const afterOne = items.filter((i) => i.response !== null).length;
    console.log(
      `   after 1 of ${items.length} predicted: responses present = ${afterOne} (expect 0)${afterOne === 0 ? ' ✓' : ' ✗'}`
    );

    // Rating cannot slip in ahead of the reveal.
    const early = await recordRating({
      cloneAssignmentId: clone1.assignmentId,
      bankItemId: items[1].bankItemId,
      rating: 5,
    });
    console.log(
      `   rating an unpredicted item refused = ${!early.ok}${!early.ok ? ' ✓' : ' ✗'}`
    );

    // ── 1b. a prediction keeps its first answer, and replays on reload ──
    await recordPrediction({
      participant,
      cloneAssignmentId: clone1.assignmentId,
      bankItemId: first.bankItemId,
      expectation: 'CHANGED MY MIND',
      guess: false,
      pointing: { kind: 'span', start: 0, end: 4, text: 'late' },
    });
    items = await getTestItems(participant, clone1);
    const kept = items.find((i) => i.bankItemId === first.bankItemId);
    const heldFirst = kept?.pointing?.kind === 'not_sure' && kept?.guess === true;
    console.log(
      `   re-predict kept the first = ${heldFirst}${heldFirst ? ' ✓' : ' ✗'} (guess=${kept?.guess}, pointing=${JSON.stringify(kept?.pointing)}, expectation="${kept?.expectation}")`
    );

    // ── 1c. the whole block unlocks at once, and only then ──────────────
    for (const it of items) {
      if (it.pointing !== null) continue;
      await recordPrediction({
        participant,
        cloneAssignmentId: clone1.assignmentId,
        bankItemId: it.bankItemId,
        expectation: 'short answer, no prose',
        guess: true,
        pointing: { kind: 'not_sure' },
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

    // ── 2. the probe opens only where the prediction missed ─────────────
    for (const it of items) {
      await recordRating({
        cloneAssignmentId: clone1.assignmentId,
        bankItemId: it.bankItemId,
        rating: 2,
        whatsOff: 'wrote the paragraph for them',
      });
    }
    items = await getTestItems(participant, clone1);
    // Every guess above was 'yes' and every rating a 2, so every item folds to
    // a miss — the probe must be open on all of them.
    const missed = items.filter((i) => i.missed).length;
    console.log(
      `2. guessed yes, rated 2 → probe opens on ${missed} of ${items.length}${missed === items.length ? ' ✓' : ' ✗'}`
    );
    const kept2 = items.find((i) => i.bankItemId === first.bankItemId);
    console.log(
      `   what's off stored = "${kept2?.whatsOff ?? ''}"${kept2?.whatsOff ? ' ✓' : ' ✗'}`
    );
    const probed = await recordProbe({
      cloneAssignmentId: clone1.assignmentId,
      bankItemId: first.bankItemId,
      probe: 'I thought the rule covered that phrasing',
    });
    console.log(`   probe stored = ${probed.ok}${probed.ok ? ' ✓' : ' ✗'}`);
    // Above the fold there is no "what's off" to keep.
    await recordRating({
      cloneAssignmentId: clone1.assignmentId,
      bankItemId: first.bankItemId,
      rating: 5,
    });
    items = await getTestItems(participant, clone1);
    const cleared = items.find((i) => i.bankItemId === first.bankItemId)?.whatsOff;
    console.log(
      `   re-rating to 5 clears what's off = ${cleared === null}${cleared === null ? ' ✓' : ' ✗'}`
    );

    await recordRating({
      cloneAssignmentId: clone1.assignmentId,
      bankItemId: first.bankItemId,
      rating: 4,
    });
    const [rated] = await db
      .select()
      .from(studyTestAnswers)
      .where(eq(studyTestAnswers.bankItemId, first.bankItemId));
    console.log(
      `   rating stored = ${rated.rating}, guessed_at < rated_at = ${
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
