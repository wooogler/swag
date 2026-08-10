/**
 * Read-only smoke check for the curation state reader.
 *
 * Verifies the load-bearing assumption that starter TEMPLATE titles map onto
 * the taxonomy's subtype labels (template rows carry type=NULL, so the type a
 * subtype hangs under is derived from that mapping, not from the row).
 *
 *   npx tsx --env-file=.env scripts/study/check-curation-state.ts
 */
import { getCurationState } from '../../src/lib/study/curation';
import { CURATION_DATASETS } from '../../src/lib/study/config';

async function main() {
  for (const ds of CURATION_DATASETS) {
    const state = await getCurationState(ds.key);
    // Type-level starters are dropped when the state is read, so this counts
    // only real subtypes — the ones curation browses by.
    const graded = state.subtypes.reduce((n, s) => n + s.clearlyIn + s.probablyIn, 0);

    console.log(`\n=== ${ds.label} (${ds.key}) ===`);
    console.log(`questions        ${state.questions.length}`);
    console.log(`type counts      ${JSON.stringify(state.typeCounts)}  missing=${state.missingTypeCount}`);
    console.log(`subtypes         ${state.subtypes.length} (type-level starters excluded)`);
    console.log(`subtype verdicts ${graded} (clearly+probably)`);
    console.log(`question grades  ${JSON.stringify(state.gradeCounts)}`);
    console.log(`natural boundary ${(state.naturalBoundaryRatio * 100).toFixed(1)}%`);
    console.log(`members          ${state.members.length}  excluded=${state.excludedMessageIds.length}`);

    const perType = new Map<string, number>();
    for (const s of state.subtypes) {
      if (!s.type) continue;
      perType.set(s.type, (perType.get(s.type) ?? 0) + 1);
    }
    console.log(`subtypes/type    ${JSON.stringify(Object.fromEntries(perType))}`);

    const top = [...state.subtypes].sort((a, b) => b.clearlyIn - a.clearlyIn).slice(0, 5);
    for (const s of top) {
      console.log(`  ${(s.type ?? '—').padEnd(12)} ${s.title.padEnd(28)} ●${s.clearlyIn} ◐${s.probablyIn}`);
    }
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
