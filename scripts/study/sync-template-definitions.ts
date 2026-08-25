/**
 * Re-align master template definitions with the chooser text.
 *
 * The parity invariant runs one way: the chooser's seeded definition is the
 * authority, and a prepared template is the SAME text pre-rated. When a subtype
 * description changes at the source (default-config.ts — e.g. restoring the
 * codebook payloads the port truncated), every master template that carried the
 * old text must follow, or picking that suggestion stops matching the prepared
 * set silently — probe.ts seeds by exact intentDefHash, so divergence doesn't
 * error, it just quietly re-rates from scratch.
 *
 * Matches templates by TITLE (stable across rewordings), updates the
 * definition. The old ratings stay where they are — hash-keyed history — and
 * the pending re-rate pass fills the new hash.
 *
 *   npx tsx --env-file=.env scripts/study/sync-template-definitions.ts          # dry
 *   npx tsx --env-file=.env scripts/study/sync-template-definitions.ts --apply
 */
import { and, eq } from 'drizzle-orm';
import { db } from '../../src/db/db';
import { scoreIntents } from '../../src/db/schema';
import { SOURCE_LOGS } from '../../src/lib/study/config';
import { getScoreConfig } from '../../src/lib/score/config-store';
import { buildJelsonSuggestions, jelsonToIntent } from '../../src/lib/score/jelson-suggest';

async function main() {
  const apply = process.argv.includes('--apply');
  const config = await getScoreConfig();
  const wantByTitle = new Map(
    buildJelsonSuggestions(config).map((s) => {
      const seed = jelsonToIntent(s);
      return [seed.title.trim().toLowerCase(), seed.definition];
    })
  );

  for (const ds of SOURCE_LOGS) {
    const templates = await db
      .select({ id: scoreIntents.id, title: scoreIntents.title, definition: scoreIntents.definition })
      .from(scoreIntents)
      .where(and(eq(scoreIntents.assignmentId, ds.masterAssignmentId), eq(scoreIntents.isTemplate, true)));

    console.log(`\n=== ${ds.label} (${ds.key}) — ${templates.length} templates ===`);
    let drifted = 0;
    for (const t of templates) {
      const want = wantByTitle.get(t.title.trim().toLowerCase());
      if (!want || want === t.definition) continue;
      drifted++;
      console.log(`  ${t.title}`);
      console.log(`    old: …${t.definition.slice(-80)}`);
      console.log(`    new: …${want.slice(-80)}`);
      if (apply) {
        await db.update(scoreIntents).set({ definition: want }).where(eq(scoreIntents.id, t.id));
      }
    }
    console.log(drifted === 0 ? '  all aligned.' : apply ? `  ${drifted} updated.` : `  ${drifted} would update (pass --apply).`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
