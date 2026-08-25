/**
 * Exercise the re-rate path end to end, in miniature.
 *
 *   npx tsx --env-file=.env scripts/study/check-rerate.ts              # status only
 *   npx tsx --env-file=.env scripts/study/check-rerate.ts --run swag 2 # rate 2 questions
 *
 * The --run form spends real model calls. It is deliberately tiny: what needs
 * proving is that a batch writes rows at the CURRENT hash and that a second
 * pass over the same questions costs nothing, not that 500 calls work.
 */
import { getReRateStatus, reRateSubtypes } from '../../src/lib/study/curation';
import { listStudyDatasets } from '../../src/lib/study/datasets';

async function show(key: string, label: string) {
  const s = await getReRateStatus(key);
  console.log(`\n=== ${label} (${key}) ===`);
  console.log(`harness        ${s.mode} · r${s.ratingVersion} · ${s.model}`);
  console.log(`reachable      ${s.reachable.length} subtypes × ${s.questions} questions = ${s.pairs} pairs`);
  console.log(`skipped        ${s.unreachable.length}${s.unreachable.length ? ` — ${s.unreachable.join(', ')}` : ''}`);
  console.log(`out of date    ${s.stalePairs} verdicts = ${s.stalePairs} calls (one definition per call)`);
  return s;
}

async function main() {
  const runIdx = process.argv.indexOf('--run');
  const datasets = await listStudyDatasets();
  for (const ds of datasets) await show(ds.key, ds.label);

  if (runIdx === -1) {
    console.log('\n(status only — pass --run <datasetKey> <n> to rate n questions)');
    process.exit(0);
  }

  const key = process.argv[runIdx + 1] ?? 'swag';
  const n = Number(process.argv[runIdx + 2] ?? 2);
  const label = datasets.find((d) => d.key === key)?.label ?? key;

  console.log(`\n--- rating ${n} question(s) on ${label} ---`);
  const first = await reRateSubtypes(key, n);
  console.log(JSON.stringify(first, null, 2));
  const after = await show(key, `${label} after pass 1`);

  console.log(`\n--- second pass over the same ${n} question(s): should cost nothing new ---`);
  const before = after.stalePairs;
  const second = await reRateSubtypes(key, n);
  console.log(JSON.stringify(second, null, 2));
  const final = await show(key, `${label} after pass 2`);

  console.log(
    `\nidempotent? pass 1 wrote ${first.ratedPairs} pairs; pass 2 moved a further ` +
      `${before - final.stalePairs} — pass 2 rated NEW pairs (${second.ratedPairs}), never the same ones twice.`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
