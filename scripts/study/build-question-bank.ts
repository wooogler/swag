/**
 * Freeze the block-test and A/B questions into the question bank.
 *
 * A thin CLI over src/lib/study/build.ts — the curation tool's build button
 * calls the same function, so there is no "proper" way and a second way.
 *
 *   npx tsx --env-file=.env scripts/study/build-question-bank.ts          # plan only
 *   npx tsx --env-file=.env scripts/study/build-question-bank.ts --apply
 */
// Module scope, not the shared global one every script would otherwise share.
export {};

const APPLY = process.argv.includes('--apply');

async function main() {
  const { buildQuestionBank } = await import('../../src/lib/study/build');

  const r = await buildQuestionBank({ apply: APPLY });
  console.log(`test candidates ${r.testCandidates} · A/B candidates ${r.abCandidates}`);
  if (r.abOrder.length > 0) console.log(`A/B order: ${r.abOrder.join(' ')}`);
  for (const b of r.balance) {
    console.log(
      `  first ${String(b.cut).padStart(2)}: datasets ${Object.entries(b.datasets)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ')} ${b.even ? '✓' : '✗ UNBALANCED'} · types ${Object.entries(b.types)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ')}`
    );
  }
  for (const w of r.warnings) console.log(`! ${w}`);

  if (r.status === 'blocked') {
    console.log(`\n✗ ${r.reason}`);
    process.exit(1);
  }
  if (r.status === 'planned') {
    console.log('\n(plan only — re-run with --apply)');
    process.exit(0);
  }
  if (r.replaced > 0) console.log(`\nreplaced ${r.replaced} previous bank item(s)`);
  console.log(`\nwrote ${r.written} bank item(s).`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
