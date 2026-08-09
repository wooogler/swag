/**
 * Freeze a participant configuration's answers to the study question bank.
 *
 * The facilitator console drives this during a session; this is the fallback
 * (and the way to backfill after a redeploy). Idempotent: an answer already
 * stored is left alone unless --force.
 *
 *   npx tsx --env-file=.env scripts/study/generate-responses.ts --participant P01 --kind test
 *   npx tsx --env-file=.env scripts/study/generate-responses.ts --participant P01 --kind ab
 *   npx tsx --env-file=.env scripts/study/generate-responses.ts --participant P01 --kind ab --force
 *   npx tsx --env-file=.env scripts/study/generate-responses.ts --status --participant P01
 *
 * --kind test  → each clone answers ITS OWN dataset's 8 block-test questions.
 * --kind ab    → each clone answers BOTH datasets' A/B questions (home + away).
 */
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/db';
import { studyClones, studyParticipants } from '../../src/db/schema';
import { CURATION_DATASETS } from '../../src/lib/study/config';
import { generateForClone, isGenerationCurrent, type BankKind } from '../../src/lib/study/generate';

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] ?? null : null;
}

async function main() {
  const participantNumber = argValue('--participant');
  const kind = (argValue('--kind') ?? 'test') as BankKind;
  const force = process.argv.includes('--force');
  const statusOnly = process.argv.includes('--status');

  if (!participantNumber) throw new Error('Pass --participant <number>');
  if (kind !== 'test' && kind !== 'ab') throw new Error('--kind must be test | ab');

  const [participant] = await db
    .select()
    .from(studyParticipants)
    .where(eq(studyParticipants.participantNumber, participantNumber.toUpperCase()));
  if (!participant) throw new Error(`No participant ${participantNumber}`);

  const clones = await db
    .select()
    .from(studyClones)
    .where(eq(studyClones.participantId, participant.id));
  if (clones.length === 0) throw new Error('participant has no clones');

  for (const clone of clones) {
    // Block test = the clone's own dataset. A/B = both, which is what makes a
    // configuration answer the OTHER dataset's questions (home/away).
    const datasetKeys =
      kind === 'test' ? [clone.datasetKey] : CURATION_DATASETS.map((d) => d.key);

    for (const datasetKey of datasetKeys) {
      const where = `${participant.participantNumber} · ${clone.datasetKey} (${clone.condition}) · ${kind} · ${datasetKey}`;
      try {
        if (statusOnly) {
          const s = await isGenerationCurrent({
            cloneAssignmentId: clone.assignmentId,
            datasetKey,
            kind,
          });
          console.log(
            `${where}: ${s.current ? 'CURRENT' : 'NOT CURRENT'} (missing ${s.missing}, stale ${s.stale})`
          );
          continue;
        }

        const report = await generateForClone({
          cloneAssignmentId: clone.assignmentId,
          datasetKey,
          kind,
          force,
        });
        console.log(
          `${where}: generated ${report.generated}, cached ${report.cached}, failed ${report.failed} · config ${JSON.stringify(report.configRef)}`
        );
        for (const item of report.items.filter((i) => i.status === 'failed')) {
          console.log(`   ! item ${item.bankItemId}: ${item.reason}`);
        }
      } catch (error) {
        console.log(`${where}: SKIPPED — ${(error as Error).message}`);
      }
    }
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
