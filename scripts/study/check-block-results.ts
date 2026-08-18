/**
 * Print the console's block-results summary for one participant.
 *
 * The same numbers the facilitator console shows, without a browser — a check
 * that the coverage split and the accuracy counts agree with the export.
 *
 *   npx tsx --env-file=.env scripts/study/check-block-results.ts <participantNumber>
 */
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/db';
import { studyClones, studyParticipants } from '../../src/db/schema';
import { ensureStudyTables } from '../../src/lib/study/store';
import { getBlockResults } from '../../src/lib/study/console-store';

async function main() {
  const number = process.argv[2];
  if (!number) throw new Error('usage: check-block-results.ts <participantNumber>');
  await ensureStudyTables();
  const [p] = await db
    .select()
    .from(studyParticipants)
    .where(eq(studyParticipants.participantNumber, number));
  if (!p) throw new Error(`no participant ${number}`);

  const clones = await db.select().from(studyClones).where(eq(studyClones.participantId, p.id));
  for (const clone of clones) {
    const r = await getBlockResults(p, clone.assignmentId);
    if (!r) continue;
    const f = (v: number | null) => (v === null ? '—' : v.toFixed(2));
    console.log(`\nBlock ${r.block} · ${r.datasetKey} · ${r.condition}`);
    console.log(`  mean fit        ${f(r.mean)} of 5   (${r.rated}/${r.total} rated)`);
    if (r.covered && r.uncovered) {
      console.log(
        `  rule reached    ${f(r.covered.mean)} (n=${r.covered.n})  vs  no rule ${f(r.uncovered.mean)} (n=${r.uncovered.n})`
      );
    }
    console.log(`  predicted       ${r.predictionHits}/${r.predictionScored}`);
    if (r.pointingScored !== null) console.log(`  pointed         ${r.pointingHits}/${r.pointingScored}`);
    console.log(`  calibration     said yes ${r.saidYes} → actually fit ${r.fits}`);
    console.log(
      `  survey          ${r.survey
        .filter((s) => s.value !== null)
        .map((s) => `${s.key}=${s.value}`)
        .join(' ')} (of ${r.surveyScaleMax})`
    );
    console.log(
      `  items           ${r.rows
        .map((x) => `${x.rating ?? '·'}${x.ruleChars === 0 ? '∅' : ''}${x.guessMissed ? '!' : ''}`)
        .join(' ')}`
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
