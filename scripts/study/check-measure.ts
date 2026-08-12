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
    recordGuess,
    recordPointing,
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
  const plan = blockPlan(participant.participantNumber);
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
    const guessed = await recordGuess({
      participant,
      cloneAssignmentId: clone1.assignmentId,
      bankItemId: first.bankItemId,
      guess: true,
    });
    console.log(`   guess recorded: ${JSON.stringify(guessed)}`);

    // The guess alone must NOT release anything — the pointing step is the
    // last thing asked before the answer, so the reveal belongs to it.
    items = await getTestItems(participant, clone1);
    const afterGuess = items.filter((i) => i.response !== null).length;
    console.log(
      `   after guess only: responses present = ${afterGuess} (expect 0)${afterGuess === 0 ? ' ✓' : ' ✗'}`
    );

    // Rating cannot slip in ahead of the reveal.
    const early = await recordRating({
      cloneAssignmentId: clone1.assignmentId,
      bankItemId: first.bankItemId,
      rating: 5,
    });
    console.log(
      `   rating before reveal refused = ${!early.ok}${!early.ok ? ' ✓' : ' ✗'}`
    );

    const released = await recordPointing({
      cloneAssignmentId: clone1.assignmentId,
      bankItemId: first.bankItemId,
      pointing: { kind: 'not_sure' },
    });
    console.log(
      `   after pointing: released "${'response' in released ? released.response.slice(0, 60) : released.error}…"`
    );

    items = await getTestItems(participant, clone1);
    const withResponse = items.filter((i) => i.response !== null).length;
    console.log(
      `   now responses present = ${withResponse} (expect exactly 1)${withResponse === 1 ? ' ✓' : ' ✗'}`
    );

    // ── 1b. pointing keeps its first answer, and replays on reload ──────
    await recordPointing({
      cloneAssignmentId: clone1.assignmentId,
      bankItemId: first.bankItemId,
      pointing: { kind: 'span', start: 0, end: 4, text: 'late' },
    });
    items = await getTestItems(participant, clone1);
    const kept = items.find((i) => i.bankItemId === first.bankItemId)?.pointing;
    console.log(
      `   pointing kept first answer = ${kept?.kind === 'not_sure'}${kept?.kind === 'not_sure' ? ' ✓' : ' ✗'} (replayed as ${JSON.stringify(kept)})`
    );

    // A pointing with no guess in front of it is refused outright.
    const orphan = await recordPointing({
      cloneAssignmentId: clone1.assignmentId,
      bankItemId: items[1].bankItemId,
      pointing: { kind: 'none' },
    });
    console.log(
      `   pointing without a guess refused = ${'error' in orphan && orphan.error === 'guess_first'}${'error' in orphan ? ' ✓' : ' ✗'}`
    );

    // ── 2. a second guess must not overwrite the first ──────────────────
    await recordGuess({
      participant,
      cloneAssignmentId: clone1.assignmentId,
      bankItemId: first.bankItemId,
      guess: false,
    });
    const [stored] = await db
      .select()
      .from(studyTestAnswers)
      .where(
        and(
          eq(studyTestAnswers.cloneAssignmentId, clone1.assignmentId),
          eq(studyTestAnswers.bankItemId, first.bankItemId)
        )
      );
    console.log(
      `2. re-guess kept the first: stored guess = ${stored.guess} (expect true)${stored.guess === true ? ' ✓' : ' ✗'}`
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
