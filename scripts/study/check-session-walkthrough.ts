/**
 * A whole session, driven end to end on a throwaway participant.
 *
 * Deploys both arms, walks every phase in order, answers the block tests, the
 * surveys, and leaves the data an export would read. Proves
 * the pieces compose — the phase gates let the right things through and stop
 * the rest — rather than each working alone.
 *
 *   npx tsx --env-file=.env scripts/study/check-session-walkthrough.ts --participant WALK1
 *
 * Requires a built question bank. Removes the participant afterwards unless
 * --keep is passed.
 */
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/db';
import { scoreIntents, studyClones, studyParticipants } from '../../src/db/schema';

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] ?? null : null;
}
const KEEP = process.argv.includes('--keep');

async function main() {
  const number = (argValue('--participant') ?? 'WALK1').toUpperCase();
  const { ensureParticipantSetup } = await import('../../src/lib/study/provision');
  const { deleteParticipant } = await import('../../src/lib/study/teardown');
  const { generateForClone } = await import('../../src/lib/study/generate');
  const { getParticipantStatus, setParticipantPhase } = await import(
    '../../src/lib/study/console-store'
  );
  const {
    cloneForBlock,
    deployedConfigFor,
    getTestItems,
    recordGuess,
    recordRating,
  } = await import('../../src/lib/study/measure-store');
  const { buildChatDeploySnapshot, recordChatDeploy } = await import(
    '../../src/lib/score/deploy-store'
  );
  const { ensureTypeRoots } = await import('../../src/lib/score/intent-store');
  const { deployBaselineVersion } = await import('../../src/lib/study/baseline-store');
  const { STUDY_DATASETS } = await import('../../src/lib/study/config');
  const { blockPlan, nextPhase } = await import('../../src/lib/study/phases');
  const { getSurveyItems } = await import('../../src/lib/study/survey-store');
  const SURVEY_ITEMS = await getSurveyItems();
  const { studySurveyAnswers } = await import('../../src/db/schema');

  const { participant } = await ensureParticipantSetup(number);
  const plan = blockPlan(number);
  console.log(`participant ${number} · cell plan ${plan.map((p) => `${p.block}:${p.datasetKey}/${p.condition}`).join(' ')}\n`);

  try {
    for (const block of [1, 2] as const) {
      const clone = (await cloneForBlock(
        (await db.select().from(studyParticipants).where(eq(studyParticipants.id, participant.id)))[0],
        block
      ))!;
      console.log(`── block ${block}: ${clone.datasetKey} / ${clone.condition} ──`);

      // work phase
      await advanceTo(block === 1 ? 'block1_work' : 'block2_work');

      // configure + deploy
      if (clone.condition === 'baseline') {
        const v = await deployBaselineVersion(
          clone.assignmentId,
          'Never write the student’s prose. Ask one question that helps them write it.'
        );
        console.log(`   deployed rules v${v}`);
      } else {
        await ensureTypeRoots(clone.assignmentId);
        const now = new Date();
        await db.insert(scoreIntents).values({
          assignmentId: clone.assignmentId,
          title: 'WALK: ghostwriting',
          definition: 'The student asks the chatbot to write prose for them.',
          rule: 'Never write the prose. Ask one question that helps them draft it.',
          kind: 'intent',
          type: 'drafting',
          isTemplate: false,
          createdAt: now,
          updatedAt: now,
        });
        const snap = await buildChatDeploySnapshot(clone.assignmentId);
        const v = await recordChatDeploy(clone.assignmentId, null, snap, 'walkthrough');
        console.log(`   deployed chat v${v}`);
      }

      // gate: the test phase is refused until answers are frozen
      const blocked = await getParticipantStatus(await reload(participant.id));
      console.log(`   blockers before generating: ${blocked.blockers.join(' · ') || 'none'}`);

      await generateForClone({
        cloneAssignmentId: clone.assignmentId,
        datasetKey: clone.datasetKey,
        kind: 'test',
      });
      const ready = await getParticipantStatus(await reload(participant.id));
      console.log(`   blockers after generating:  ${ready.blockers.join(' · ') || 'none ✓'}`);

      // test phase
      await advanceTo(block === 1 ? 'block1_test' : 'block2_test');
      const current = await reload(participant.id);
      const items = await getTestItems(current, clone);
      const config = await deployedConfigFor(clone);
      console.log(`   config shown: ${config?.condition} ${config?.versionLabel} · ${items.length} question(s)`);
      let released = 0;
      for (const [i, item] of items.entries()) {
        const r = await recordGuess({
          participant: current,
          cloneAssignmentId: clone.assignmentId,
          bankItemId: item.bankItemId,
          guess: i % 2 === 0,
        });
        if ('response' in r) released += 1;
        await recordRating({
          cloneAssignmentId: clone.assignmentId,
          bankItemId: item.bankItemId,
          rating: ((i * 2) % 5) + 1,
        });
      }
      console.log(`   answered ${items.length}, responses released ${released}`);

      // survey phase
      await advanceTo(block === 1 ? 'block1_survey' : 'block2_survey');
      const now = new Date();
      for (const [i, item] of SURVEY_ITEMS.entries()) {
        await db
          .insert(studySurveyAnswers)
          .values({
            participantId: participant.id,
            block,
            cloneAssignmentId: clone.assignmentId,
            itemKey: item.key,
            value: (i % 7) + 1,
            answeredAt: now,
          })
          .onConflictDoNothing();
      }
      console.log(`   survey: ${SURVEY_ITEMS.length} item(s) recorded`);

      if (block === 1) await advanceTo('break');
    }

    await advanceTo('done');

    const final = await getParticipantStatus(await reload(participant.id));
    console.log(`final phase: ${final.phase}`);
  } finally {
    if (!KEEP) {
      const row = await reload(participant.id);
      await deleteParticipant(row);
      console.log(`\nremoved participant ${number}.`);
    } else {
      console.log(`\nkept participant ${number} (--keep).`);
    }
  }
  process.exit(0);

  async function reload(id: string) {
    const [row] = await db.select().from(studyParticipants).where(eq(studyParticipants.id, id));
    return row;
  }

  async function advanceTo(target: string) {
    let row = await reload(participant.id);
    let guard = 0;
    while (row.phase !== target && guard++ < 12) {
      const next = nextPhase(row.phase as never);
      if (!next) break;
      await setParticipantPhase(row, next, 'WALKTHROUGH');
      row = await reload(participant.id);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
