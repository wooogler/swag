/**
 * Run the subtype re-rate to completion, outside a browser tab.
 *
 * The admin button drives the same function in a loop, which is fine for
 * topping up — but a first full pass is ~13,000 calls per master, and a tab
 * that has to stay open for that long is a fragile place to keep a job. This is
 * the same work, resumable, with the count printed after every batch.
 *
 *   npx tsx --env-file=.env scripts/study/rerate-subtypes.ts            # status
 *   npx tsx --env-file=.env scripts/study/rerate-subtypes.ts --apply
 *   npx tsx --env-file=.env scripts/study/rerate-subtypes.ts --apply swag
 *
 * Idempotent by definition hash: interrupt it and run it again, and it picks up
 * exactly where it stopped.
 */
import { getReRateStatus, isLocked, reRateSubtypes } from '../../src/lib/study/curation';
import { listStudyDatasets } from '../../src/lib/study/datasets';

const BATCH = 500;

async function main() {
  const apply = process.argv.includes('--apply');
  const all = await listStudyDatasets();
  // One re-rate per SOURCE LOG, not per dataset: the verdicts live on the
  // master's template intents, so two datasets curating the same log would rate
  // the same pairs twice for one set of rows.
  const perSource = all.filter((d, i) => all.findIndex((x) => x.sourceKey === d.sourceKey) === i);
  const only = process.argv.find((a) => !a.startsWith('--') && all.some((d) => d.key === a));
  const datasets = only ? all.filter((d) => d.key === only) : perSource;

  for (const ds of datasets) {
    const status = await getReRateStatus(ds.key);
    console.log(`\n=== ${ds.label} (${ds.key}) ===`);
    console.log(`harness      ${status.mode} · r${status.ratingVersion} · ${status.model}`);
    console.log(`prepared set ${status.reachable.length} subtypes × ${status.questions} questions`);
    console.log(`out of date  ${status.stalePairs} verdicts = ${status.stalePairs} calls`);
    if (status.unreachable.length) console.log(`skipped      ${status.unreachable.join(', ')}`);

    if (!apply) continue;
    if (status.stalePairs === 0) {
      console.log('nothing to do.');
      continue;
    }
    if (await isLocked(ds.key)) {
      console.log('SKIPPED — dataset is confirmed. Unlock it first: re-rating moves the');
      console.log('grades its sets were picked on.');
      continue;
    }

    let done = 0;
    const total = status.stalePairs;
    for (;;) {
      const result = await reRateSubtypes(ds.key, BATCH);
      done += result.ratedPairs;
      const pct = ((done / total) * 100).toFixed(1);
      console.log(
        `  ${done}/${total} (${pct}%)  wrote ${result.ratedPairs}` +
          (result.failed ? `  failed ${result.failed}` : '')
      );
      if (!result.pendingPairs) break;
      if (!result.ratedPairs) {
        console.log('  no progress in a full batch — stopping rather than spinning.');
        break;
      }
    }

    const after = await getReRateStatus(ds.key);
    console.log(`done. ${after.stalePairs} verdicts still out of date.`);
  }

  if (!apply) console.log('\n(status only — pass --apply to run)');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
