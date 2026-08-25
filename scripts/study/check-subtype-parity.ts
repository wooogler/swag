/**
 * Does a prepared subtype set judge the same as a hand-made intent?
 *
 * The promise: pick a starter suggestion in the chooser, and the definition it
 * seeds is the SAME text the master template carries. Both keyspaces key on
 * intentDefHash(definition), so identical text means the copied verdicts ARE
 * the verdicts a fresh rating pass would have produced. Divergence breaks that
 * silently — probe.ts seeds templates by hash match, so a drifted definition
 * simply finds nothing and the participant waits on a live rating instead.
 *
 * Read-only. Prints, per dataset, which templates match the chooser text,
 * which drifted, and whether the newest stored ratings are of the current
 * rating generation.
 *
 *   npx tsx --env-file=.env scripts/study/check-subtype-parity.ts
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../../src/db/db';
import { scoreIntentRatings, scoreIntents } from '../../src/db/schema';
import { SOURCE_LOGS } from '../../src/lib/study/config';
import { getScoreConfig } from '../../src/lib/score/config-store';
import { buildJelsonSuggestions, jelsonToIntent } from '../../src/lib/score/jelson-suggest';
import { intentDefHash, INTENT_RATING_VERSION, MATERIAL_PROMPT_MODE } from '../../src/lib/score/intents';

async function main() {
  const config = await getScoreConfig();
  const chooser = new Map<string, { code: string; definition: string }>();
  for (const s of buildJelsonSuggestions(config)) {
    chooser.set(s.label.trim().toLowerCase(), { code: s.code, definition: jelsonToIntent(s).definition });
  }
  console.log(`mode=${MATERIAL_PROMPT_MODE}  INTENT_RATING_VERSION=r${INTENT_RATING_VERSION}`);
  console.log(`chooser subtypes: ${chooser.size}\n`);

  for (const ds of SOURCE_LOGS) {
    const templates = await db
      .select({ id: scoreIntents.id, title: scoreIntents.title, definition: scoreIntents.definition })
      .from(scoreIntents)
      .where(and(eq(scoreIntents.assignmentId, ds.masterAssignmentId), eq(scoreIntents.isTemplate, true)));

    const matched: string[] = [];
    const drifted: { title: string; template: string; chooser: string }[] = [];
    const unknown: string[] = [];

    for (const t of templates) {
      const want = chooser.get(t.title.trim().toLowerCase());
      if (!want) {
        unknown.push(t.title);
        continue;
      }
      if (t.definition.trim() === want.definition.trim()) matched.push(t.title);
      else drifted.push({ title: t.title, template: t.definition, chooser: want.definition });
    }

    console.log(`=== ${ds.label} (${ds.key}) — ${templates.length} templates ===`);
    console.log(`  parity   ✓ ${matched.length}   ✗ ${drifted.length}   not-a-subtype ${unknown.length}`);
    if (unknown.length) console.log(`  not-a-subtype: ${unknown.join(', ')}`);
    for (const d of drifted.slice(0, 4)) {
      console.log(`\n  ✗ ${d.title}`);
      console.log(`     template: ${d.template}`);
      console.log(`     chooser : ${d.chooser}`);
    }
    if (drifted.length > 4) console.log(`\n  … and ${drifted.length - 4} more drifted`);

    // Rating generation, for the templates only.
    const ids = templates.map((t) => t.id);
    let current = 0;
    let stale = 0;
    let none = 0;
    if (ids.length) {
      for (const t of templates) {
        const want = chooser.get(t.title.trim().toLowerCase());
        const expected = intentDefHash(want ? want.definition : t.definition);
        const newest = await db
          .select({ defHash: scoreIntentRatings.defHash })
          .from(scoreIntentRatings)
          .where(
            and(
              eq(scoreIntentRatings.assignmentId, ds.masterAssignmentId),
              eq(scoreIntentRatings.intentId, t.id)
            )
          )
          .orderBy(desc(scoreIntentRatings.ratedAt))
          .limit(1);
        if (!newest.length) none++;
        else if (newest[0].defHash === expected) current++;
        else stale++;
      }
    }
    console.log(
      `\n  ratings vs the chooser-text hash:  current ${current}   stale ${stale}   none ${none}\n`
    );
    void inArray;
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
