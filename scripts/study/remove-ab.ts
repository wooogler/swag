/**
 * Delete what the blind A/B left behind.
 *
 * Design v2 dropped the final A/B (§2, §9), and the decision was to remove the
 * data with the code rather than keep a dead arm around. Everything here is
 * from pilot runs and fixtures — no analysed session ever used it.
 *
 * Prints what it would remove and stops. `--apply` is the only thing that
 * deletes, and the counts are shown first either way, because the one row that
 * is NOT fixture data — a hand-assigned curation member that happens to sit in
 * the ab set — would otherwise vanish silently.
 *
 *   npx tsx --env-file=.env scripts/study/remove-ab.ts
 *   npx tsx --env-file=.env scripts/study/remove-ab.ts --apply
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { db } from '../../src/db/db';

const APPLY = process.argv.includes('--apply');

async function count(q: ReturnType<typeof sql>): Promise<number> {
  const rows = (await db.execute(q)) as unknown as { n: number }[];
  return Number(rows[0]?.n ?? 0);
}

async function main() {
  const responses = await count(
    sql`SELECT count(*)::int AS n FROM study_generated_responses WHERE purpose = 'ab'`
  );
  const bank = await count(sql`SELECT count(*)::int AS n FROM study_question_bank WHERE kind = 'ab'`);
  const members = await count(
    sql`SELECT count(*)::int AS n FROM study_set_members WHERE set_kind = 'ab'`
  );
  const stuck = await count(
    sql`SELECT count(*)::int AS n FROM study_participants WHERE phase = 'ab'`
  );
  const answers = await count(sql`
    SELECT count(*)::int AS n FROM information_schema.tables
     WHERE table_name = 'study_ab_answers'`);
  const abRows = answers > 0 ? await count(sql`SELECT count(*)::int AS n FROM study_ab_answers`) : 0;

  console.log('to remove:');
  console.log(`  study_generated_responses  purpose='ab'   ${responses}`);
  console.log(`  study_question_bank        kind='ab'      ${bank}`);
  console.log(`  study_set_members          set_kind='ab'  ${members}`);
  console.log(`  study_ab_answers           (whole table)  ${abRows}${answers ? '' : '  — already gone'}`);
  console.log(`  study_participants         phase='ab' → 'done'  ${stuck}`);

  // Name the curation members rather than reporting a number: they are the one
  // thing here a researcher may have placed by hand.
  if (members > 0) {
    const rows = (await db.execute(sql`
      SELECT dataset_key, source_message_id, query_type, subtype, added_by
        FROM study_set_members WHERE set_kind = 'ab'
       ORDER BY dataset_key, source_message_id`)) as unknown as Record<string, unknown>[];
    console.log('\n  the A/B curation members, in full:');
    for (const r of rows) {
      console.log(
        `    ${r.dataset_key} #${r.source_message_id}  ${r.query_type ?? '—'} / ${r.subtype ?? '—'}  by ${r.added_by ?? '—'}`
      );
    }
  }

  if (!APPLY) {
    console.log('\n(nothing removed — re-run with --apply)');
    process.exit(0);
  }

  // The A/B members turned out to be hand-assigned (added_by = a researcher
  // code, not FIXTURE), so they are somebody's reading of the log and there is
  // no set left to move them to. Written out before the delete: the rows go,
  // the judgement is recoverable.
  if (members > 0) {
    const rows = await db.execute(sql`SELECT * FROM study_set_members WHERE set_kind = 'ab'`);
    const file = path.join(process.cwd(), 'docs/_archive/removed-ab-set-members.json');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(rows, null, 2));
    console.log(`\nsaved the ${members} A/B members to ${file}`);
  }

  await db.execute(sql`DELETE FROM study_generated_responses WHERE purpose = 'ab'`);
  await db.execute(sql`DELETE FROM study_question_bank WHERE kind = 'ab'`);
  await db.execute(sql`DELETE FROM study_set_members WHERE set_kind = 'ab'`);
  // Moved rather than left pointing at a phase that no longer exists: the
  // console renders a label per phase and would show a blank for these.
  await db.execute(sql`UPDATE study_participants SET phase = 'done' WHERE phase = 'ab'`);
  await db.execute(sql`DROP TABLE IF EXISTS study_ab_answers`);
  await db.execute(sql`ALTER TABLE study_set_targets DROP COLUMN IF EXISTS "ab"`);

  console.log('\nremoved.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
