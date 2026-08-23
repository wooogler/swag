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
    console.log(`  desirable (Q5)  ${f(r.mean)} of 6   (${r.rated}/${r.total} judged)`);
    console.log(`  follows (Q6)    ${f(r.meanFollows)} of 6`);
    if (r.covered && r.uncovered) {
      console.log(
        `  rule reached    ${f(r.covered.mean)} (n=${r.covered.n})  vs  no rule ${f(r.uncovered.mean)} (n=${r.uncovered.n})`
      );
    }
    console.log(
      `  predicted       ${r.predictionHits}/${r.predictionScored}  (mean |Q4−Q5| ${f(r.meanError)})`
    );
    if (r.pointingScored !== null) console.log(`  pointed         ${r.pointingHits}/${r.pointingScored}`);
    console.log(
      `  confidence      ${f(r.meanConfidence)} of 6   (${r.dontKnow} × "I don't know")`
    );
    console.log(
      `  quadrants       blind spots ${r.blindSpots} · rule≠want ${r.selfModelErrors}`
    );
    console.log(
      `  survey          ${r.survey
        .filter((s) => s.value !== null)
        .map((s) => `${s.key}=${s.value}`)
        .join(' ')} (of ${r.surveyScaleMax})`
    );
    console.log(
      `  items           ${r.rows
        .map((x) => `${x.desirable ?? '·'}${x.ruleChars === 0 ? '∅' : ''}${x.foldMissed ? '!' : ''}`)
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
