/**
 * Write one participant's trail to a directory — the same files the console's
 * download button produces, without going through the browser.
 *
 *   npx tsx --env-file=.env scripts/study/dump-trail.ts <participantNumber> <outDir>
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/db';
import { studyParticipants } from '../../src/db/schema';
import { ensureStudyTables } from '../../src/lib/study/store';
import { buildTrailFiles } from '../../src/lib/study/trail-files';

async function main() {
  const [number, outDir] = process.argv.slice(2);
  if (!number || !outDir) throw new Error('usage: dump-trail.ts <participantNumber> <outDir>');
  await ensureStudyTables();
  const [p] = await db
    .select()
    .from(studyParticipants)
    .where(eq(studyParticipants.participantNumber, number));
  if (!p) throw new Error(`no participant ${number}`);
  const built = await buildTrailFiles(p.id);
  if (!built) throw new Error('trail could not be built');
  for (const [name, body] of Object.entries(built.files)) {
    const path = join(outDir, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }
  console.log(`wrote ${Object.keys(built.files).length} files to ${outDir}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
