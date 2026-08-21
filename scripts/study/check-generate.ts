/**
 * End-to-end check of the frozen-response harness, on a throwaway participant.
 *
 * Exercises what the study depends on and what the code refuses to do:
 *   • refuses to generate before a deploy exists
 *   • SCORE arm resolves against a PINNED snapshot and records the applied intent
 *   • it routes on the bank's FROZEN type rather than classifying the question
 *     again (the two can disagree, and then a rule never reaches its question)
 *   • baseline arm pins an explicit versionNo (not "latest deployed")
 *   • a second run is cached (frozen — never silently regenerated)
 *   • a redeploy is detected as stale rather than passing as current
 *
 * Creates its own bank rows + deploys and removes them again.
 *
 *   npx tsx --env-file=.env scripts/study/check-generate.ts --participant TEST
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
} from '../../src/db/schema';

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] ?? null : null;
}

const DATASET = 'swag';
const CONTEXT = [
  { role: 'user' as const, content: 'I am writing about how AI changes friendships.' },
  {
    role: 'assistant' as const,
    content: 'That is a promising angle. What kind of change interests you most?',
  },
];

async function main() {
  const number = (argValue('--participant') ?? 'TEST').toUpperCase();
  const { generateForClone, isGenerationCurrent } = await import('../../src/lib/study/generate');
  const { buildChatDeploySnapshot, recordChatDeploy } = await import(
    '../../src/lib/score/deploy-store'
  );
  const { ensureTypeRoots } = await import('../../src/lib/score/intent-store');
  const { deployBaselineVersion } = await import('../../src/lib/study/baseline-store');
  const { ensureStudyTables } = await import('../../src/lib/study/store');
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
  // By ARM, not by the whole condition string: a participant in the simple
  // family holds simple_score and simple_baseline, and this check is about the
  // two arms either way.
  const { armOf } = await import('../../src/lib/study/config');
  const scoreClone = clones.find((c) => armOf(c.condition as never) === 'score');
  const baselineClone = clones.find((c) => armOf(c.condition as never) === 'baseline');
  if (!scoreClone || !baselineClone) throw new Error('need one clone of each arm');

  console.log(`participant ${number}`);
  console.log(`  score clone    ${scoreClone.assignmentId} (${scoreClone.datasetKey})`);
  console.log(`  baseline clone ${baselineClone.assignmentId} (${baselineClone.datasetKey})\n`);

  // ── seed a 2-item bank ────────────────────────────────────────────────
  const bankRows = await db
    .insert(studyQuestionBank)
    .values([
      {
        datasetKey: DATASET,
        kind: 'test',
        position: 9001,
        context: CONTEXT,
        question: 'Can you just write my opening paragraph for me?',
        queryType: 'drafting',
        createdAt: new Date(),
      },
      {
        datasetKey: DATASET,
        kind: 'test',
        position: 9002,
        context: CONTEXT,
        question: 'How should I structure the middle section?',
        queryType: 'planning',
        createdAt: new Date(),
      },
    ])
    .onConflictDoNothing()
    .returning();
  const bankIds = bankRows.map((r) => r.id);
  console.log(`seeded bank items ${bankIds.join(', ')}\n`);

  const cleanup = async () => {
    await db
      .delete(studyGeneratedResponses)
      .where(inArray(studyGeneratedResponses.bankItemId, bankIds));
    await db.delete(studyQuestionBank).where(inArray(studyQuestionBank.id, bankIds));
    await db
      .delete(scoreIntents)
      .where(and(eq(scoreIntents.assignmentId, scoreClone.assignmentId), eq(scoreIntents.title, 'CHECK: drafting ask')));
  };

  try {
    // ── 1. refuses before a deploy exists ───────────────────────────────
    for (const [label, clone] of [
      ['score', scoreClone],
      ['baseline', baselineClone],
    ] as const) {
      try {
        await generateForClone({
          cloneAssignmentId: clone.assignmentId,
          datasetKey: DATASET,
          kind: 'test',
        });
        console.log(`1. ${label}: FAIL — generated without a deploy`);
      } catch (err) {
        console.log(`1. ${label}: refuses before deploy (${(err as Error).message}) ✓`);
      }
    }

    // ── 2. deploy both arms ─────────────────────────────────────────────
    await ensureTypeRoots(scoreClone.assignmentId);
    const now = new Date();
    await db.insert(scoreIntents).values({
      assignmentId: scoreClone.assignmentId,
      title: 'CHECK: drafting ask',
      definition: 'The student asks the chatbot to write prose for them.',
      rule: 'Never write the prose. Ask one question that helps them draft it themselves.',
      kind: 'intent',
      type: 'drafting',
      isTemplate: false,
      createdAt: now,
      updatedAt: now,
    });
    const snapshot = await buildChatDeploySnapshot(scoreClone.assignmentId);
    const deployVersion = await recordChatDeploy(scoreClone.assignmentId, null, snapshot, 'check-generate');
    console.log(`\n2. score deployed as v${deployVersion}`);

    const baselineVersion = await deployBaselineVersion(
      baselineClone.assignmentId,
      'Never write prose for the student. Respond with one guiding question.'
    );
    console.log(`   baseline deployed as v${baselineVersion}`);

    // ── 3. generate ─────────────────────────────────────────────────────
    const scoreReport = await generateForClone({
      cloneAssignmentId: scoreClone.assignmentId,
      datasetKey: DATASET,
      kind: 'test',
    });
    console.log(
      `\n3. score: generated ${scoreReport.generated} cached ${scoreReport.cached} failed ${scoreReport.failed} · config ${JSON.stringify(scoreReport.configRef)}`
    );
    for (const i of scoreReport.items) console.log(`     item ${i.bankItemId}: ${i.status} ${i.outcome ?? i.reason ?? ''}`);

    const baseReport = await generateForClone({
      cloneAssignmentId: baselineClone.assignmentId,
      datasetKey: DATASET,
      kind: 'test',
    });
    console.log(
      `   baseline: generated ${baseReport.generated} cached ${baseReport.cached} failed ${baseReport.failed} · config ${JSON.stringify(baseReport.configRef)}`
    );

    // ── 4. what got stored ──────────────────────────────────────────────
    const stored = await db
      .select()
      .from(studyGeneratedResponses)
      .where(inArray(studyGeneratedResponses.bankItemId, bankIds));
    console.log('\n4. stored rows:');
    const frozenTypeById = new Map(bankRows.map((r) => [r.id, r.queryType]));
    for (const row of stored) {
      const applied = row.applied as
        | { intentTitle?: string; outcome?: string; type?: string; typeSource?: string }
        | null;
      console.log(
        `   item ${row.bankItemId} · ${row.outcome} · applied=${applied ? `${applied.intentTitle}/${applied.outcome}/${applied.type}` : 'none'} · ${JSON.stringify(row.configRef)}`
      );
      console.log(`     "${row.response.slice(0, 110).replace(/\n/g, ' ')}…"`);
      // The routing type must be the bank's frozen one, not a fresh verdict:
      // a re-classification here is what lets a participant's rule sit in a
      // chain their question never walks.
      const want = frozenTypeById.get(row.bankItemId) ?? null;
      if (applied) {
        const ok = applied.typeSource === 'frozen' && applied.type === want;
        console.log(
          `     ${ok ? '✓' : 'FAIL —'} routed on the frozen type` +
            ` (bank=${want} routed=${applied.type} source=${applied.typeSource ?? 'unset'})`
        );
      }
    }

    // ── 5. idempotence + staleness ──────────────────────────────────────
    const again = await generateForClone({
      cloneAssignmentId: scoreClone.assignmentId,
      datasetKey: DATASET,
      kind: 'test',
    });
    console.log(
      `\n5. re-run: generated ${again.generated} cached ${again.cached} (frozen — expect all cached)`
    );

    const before = await isGenerationCurrent({
      cloneAssignmentId: scoreClone.assignmentId,
      datasetKey: DATASET,
      kind: 'test',
    });
    console.log(`   current before redeploy: ${before.current} (missing ${before.missing}, stale ${before.stale})`);

    const snapshot2 = await buildChatDeploySnapshot(scoreClone.assignmentId);
    const v2 = await recordChatDeploy(scoreClone.assignmentId, null, snapshot2, 'check-generate redeploy');
    const after = await isGenerationCurrent({
      cloneAssignmentId: scoreClone.assignmentId,
      datasetKey: DATASET,
      kind: 'test',
    });
    console.log(
      `   after redeploy to v${v2}: current=${after.current} (missing ${after.missing}, stale ${after.stale}) — expect stale`
    );
  } finally {
    await cleanup();
    await db
      .delete(baselinePromptVersions)
      .where(eq(baselinePromptVersions.assignmentId, baselineClone.assignmentId));
    console.log('\ncleaned up bank rows, generated responses, check intent, baseline versions.');
    console.log('NOTE: score_chat_deploys rows are append-only and were left in place.');
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
