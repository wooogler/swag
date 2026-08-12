/**
 * TEMPORARY: fill the curated sets with machine-picked questions so the build
 * scripts can be exercised before the researchers have curated for real.
 *
 * Picks by type from what the classifier already says, ignoring every quality
 * criterion the real curation applies (subtype spread, look-alike pairs,
 * boundary ratio). NOT a substitute for curating — only a fixture.
 *
 *   npx tsx --env-file=.env scripts/study/seed-fake-curation.ts --apply
 *   npx tsx --env-file=.env scripts/study/seed-fake-curation.ts --clear
 */
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/db';
import { studyCurationMeta, studySetMembers } from '../../src/db/schema';

const APPLY = process.argv.includes('--apply');
const CLEAR = process.argv.includes('--clear');

async function main() {
  const { CURATION_DATASETS } = await import('../../src/lib/study/config');
  const { getCurationState, getSetTargets, setSetMember, setLock, validateCuration } = await import(
    '../../src/lib/study/curation'
  );
  const { SCORE_QUERY_TYPES } = await import('../../src/lib/score/intents');
  const SET_TARGETS_PER_TYPE = await getSetTargets();

  if (CLEAR) {
    for (const d of CURATION_DATASETS) {
      await setLock(d.key, null, false);
      await db.delete(studySetMembers).where(eq(studySetMembers.datasetKey, d.key));
      await db.delete(studyCurationMeta).where(eq(studyCurationMeta.datasetKey, d.key));
    }
    console.log('cleared fixture sets + locks.');
    process.exit(0);
  }
  if (!APPLY) {
    console.log('Pass --apply to seed, or --clear to remove.');
    process.exit(0);
  }

  for (const dataset of CURATION_DATASETS) {
    await setLock(dataset.key, null, false);
    // DESTRUCTIVE: this wipes real curation work too. Say what is going.
    const existing = await db
      .select()
      .from(studySetMembers)
      .where(eq(studySetMembers.datasetKey, dataset.key));
    const byHand = existing.filter((m) => m.addedBy !== 'FIXTURE');
    if (byHand.length > 0) {
      console.log(
        `  ⚠ ${dataset.key}: discarding ${byHand.length} hand-assigned question(s) — ${byHand
          .map((m) => `${m.setKind}:${m.sourceMessageId}`)
          .join(', ')}`
      );
    }
    await db.delete(studySetMembers).where(eq(studySetMembers.datasetKey, dataset.key));

    const state = await getCurationState(dataset.key);
    const excluded = new Set(state.excludedMessageIds);
    console.log(`\n=== ${dataset.label} ===`);

    for (const type of SCORE_QUERY_TYPES) {
      // Prefer questions a subtype actually claims, so the fixture at least
      // looks like curated material; fall back to any question of the type.
      const pool = state.questions
        .filter((q) => q.queryType === type && !excluded.has(q.messageId))
        .sort((a, b) => {
          const rank = (g: string) => (g === 'certain' ? 0 : g === 'boundary' ? 1 : 2);
          return rank(a.grade) - rank(b.grade) || a.messageId - b.messageId;
        });

      let cursor = 0;
      for (const kind of ['review', 'test'] as const) {
        const want = SET_TARGETS_PER_TYPE[kind];
        let taken = 0;
        while (taken < want && cursor < pool.length) {
          await setSetMember({
            datasetKey: dataset.key,
            messageId: pool[cursor].messageId,
            setKind: kind,
            addedBy: 'FIXTURE',
          });
          cursor += 1;
          taken += 1;
        }
        if (taken < want) console.log(`  ${type}/${kind}: only ${taken}/${want} available`);
      }
      console.log(`  ${type}: assigned ${cursor} of ${pool.length} available`);
    }

    const after = await getCurationState(dataset.key);
    const violations = validateCuration(after, SET_TARGETS_PER_TYPE).filter((v) => v.severity === 'error');
    if (violations.length > 0) {
      console.log(`  ✗ still blocking: ${violations.map((v) => v.message).join(' · ')}`);
      continue;
    }
    await setLock(dataset.key, 'FIXTURE', true);
    console.log(`  locked ✓ (${after.members.length} members)`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
