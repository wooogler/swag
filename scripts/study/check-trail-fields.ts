/**
 * Rebuild one participant's trail and print what the export now carries.
 *
 * A smoke test for the fields added after the first pilot: the timeline's
 * question text, the block test's routing/timing columns, the review-set
 * listing. Run against a participant who has actually finished a session —
 * nothing here writes.
 *
 *   npx tsx --env-file=.env scripts/study/check-trail-fields.ts <participantNumber>
 */
import { db } from '../../src/db/db';
import { studyParticipants } from '../../src/db/schema';
import { eq } from 'drizzle-orm';
import { buildTrailFiles } from '../../src/lib/study/trail-files';
import { ensureStudyTables } from '../../src/lib/study/store';

async function main() {
  // The study tables carry their schema in runtime DDL, so a script that
  // reads them has to let it run first — otherwise a column added since the
  // last app boot is missing here and nowhere else.
  await ensureStudyTables();
  const number = process.argv[2];
  if (!number) throw new Error('usage: check-trail-fields.ts <participantNumber>');
  const [p] = await db
    .select()
    .from(studyParticipants)
    .where(eq(studyParticipants.participantNumber, number));
  if (!p) throw new Error(`no participant ${number}`);

  const built = await buildTrailFiles(p.id);
  if (!built) throw new Error('trail could not be built');

  const flat = Object.keys(built.files).filter(
    (f) => !f.startsWith('snapshots/') && !f.startsWith('rules/')
  );
  console.log(`participant ${built.number}`);
  console.log(`files: ${flat.join(', ')}`);

  const timeline = built.files['timeline.csv'].split('\n');
  console.log(`\ntimeline.csv — ${timeline.length - 1} rows`);
  console.log(`  header: ${timeline[0]}`);
  for (const line of timeline.slice(1, 4)) console.log(`  ${line.slice(0, 200)}`);

  const test = built.files['block-test.csv'].split('\n');
  console.log(`\nblock-test.csv — ${test.length - 1} rows`);
  console.log(`  header: ${test[0]}`);

  const review = built.files['review-set.csv'].split('\n');
  console.log(`\nreview-set.csv — ${review.length - 1} rows`);
  console.log(`  header: ${review[0]}`);
  for (const line of review.slice(1, 3)) console.log(`  ${line.slice(0, 160)}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
