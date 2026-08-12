/**
 * Build the reduced STUDY masters from a confirmed review set.
 *
 * A thin CLI over src/lib/study/build.ts — the curation tool's build button
 * calls the same function, so there is no "proper" way and a second way.
 *
 *   npx tsx --env-file=.env scripts/study/build-study-masters.ts            # plan only
 *   npx tsx --env-file=.env scripts/study/build-study-masters.ts --apply
 *   npx tsx --env-file=.env scripts/study/build-study-masters.ts --apply --dataset swag
 *
 * Idempotent by share token: rebuilding replaces the previous study master.
 * Refuses while a participant still holds a clone OF that master.
 */
// Module scope, not the shared global one every script would otherwise share.
export {};

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] ?? null : null;
}

const APPLY = process.argv.includes('--apply');
const ONLY = argValue('--dataset');

async function main() {
  const { buildStudyMasters } = await import('../../src/lib/study/build');

  const results = await buildStudyMasters({ apply: APPLY, datasetKey: ONLY ?? undefined });
  for (const r of results) {
    console.log(`\n=== ${r.label} (${r.datasetKey}) ===`);
    console.log(
      `  review questions ${r.reviewQuestions} · threads ${r.threads} · source messages ${r.sourceMessages}`
    );
    for (const w of r.warnings) console.log(`  ! ${w}`);

    if (r.status === 'blocked' || r.status === 'skipped') {
      console.log(`  ${r.status === 'blocked' ? '✗' : '–'} ${r.reason}`);
      continue;
    }
    if (r.status === 'planned') {
      console.log('  (plan only — re-run with --apply)');
      continue;
    }

    console.log(`  built ${r.assignmentId!.slice(0, 8)}…`);
    for (const [label, n] of Object.entries(r.counts ?? {})) {
      console.log(`    ${label.padEnd(10)} ${n}`);
    }
    console.log(
      `    per type   ${Object.entries(r.perType ?? {})
        .map(([k, v]) => `${k}=${v}`)
        .join(' ')} (review set)`
    );
    const questions = r.counts?.questions ?? 0;
    const marked = r.counts?.['review-set'] ?? 0;
    console.log(
      `    ${questions} messages in the log, ${marked} listed as review material; the rest are context inside those threads.`
    );
    if (r.templatePins) {
      console.log(`    template pins ${r.templatePins.kept}/${r.templatePins.source}`);
    }
  }

  console.log('\nNext: build the question bank, then re-provision participants.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
