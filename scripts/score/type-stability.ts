/**
 * Test-retest reliability of the v7 type classifier (design doc §6.6).
 *
 * This matters MORE than the intent judge's stability, for one reason: a type
 * verdict is cached for the message's LIFETIME (score_query_types, invalidated
 * only by a TYPE_CLASSIFIER_VERSION bump). Whatever the first draw says, the
 * query lives in that type forever — so the flip rate here is not noise that
 * averages out, it is a coin flip that gets frozen.
 *
 * Reasoning models take no temperature/seed, so repeating the identical call is
 * the only way to see the inherent noise floor.
 *
 *   npx tsx scripts/score/type-stability.ts out.json [nQueries=20] [repeats=5]
 *
 * Reports, per arm: unanimity (all repeats identical), the flip rate, and the
 * queries that flipped with their competing verdicts — those are the ones whose
 * type is genuinely ambiguous, which is a design signal, not just noise.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ScoreQueryType } from '../../src/lib/score/intents';

for (const file of ['.env.local', '.env']) {
  try {
    const text = readFileSync(path.join(process.cwd(), file), 'utf8');
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let value = m[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(m[1] in process.env)) process.env[m[1]] = value;
    }
  } catch {
    /* file absent — fine */
  }
}

const OUT = process.argv[2] ?? 'type-stability.json';
const N_QUERIES = Number.parseInt(process.argv[3] ?? '', 10) || 20;
const REPEATS = Number.parseInt(process.argv[4] ?? '', 10) || 5;
const NO_DISSECTION = process.env.SCORE_NO_DISSECTION === '1';

async function main(): Promise<void> {
  const { db } = await import('../../src/db/db');
  const { assignments } = await import('../../src/db/schema');
  const { eq } = await import('drizzle-orm');
  const { ensureScoreTable, getQueryRecords } = await import('../../src/lib/score/queries');
  const { ensureIntentTables } = await import('../../src/lib/score/intent-store');
  const { classifyMessageType } = await import('../../src/lib/score/type-classifier');
  const { computeDissections } = await import('../../src/lib/score/dissect');
  const { createLimiter } = await import('../../src/lib/score/limiter');
  const { getDefaultScoreModel } = await import('../../src/lib/score/models');
  const { isOpenAIConfigured } = await import('../../src/lib/score/classifier');

  if (!isOpenAIConfigured()) throw new Error('OPENAI_API_KEY is not configured.');
  await Promise.all([ensureScoreTable(), ensureIntentTables()]);

  const rows = await db
    .select({ id: assignments.id })
    .from(assignments)
    .where(eq(assignments.shareToken, 'nirvana-dataset'));
  if (!rows[0]) throw new Error('NIRVANA dataset not found (shareToken=nirvana-dataset)');
  const assignmentId = rows[0].id;

  // Evenly spaced across the log, so the sample spans the whole conversation
  // arc rather than clustering at one end.
  const all = await getQueryRecords(assignmentId);
  const step = Math.max(1, Math.floor(all.length / N_QUERIES));
  const sample = all.filter((_, i) => i % step === 0).slice(0, N_QUERIES);
  const dissections = NO_DISSECTION
    ? new Map()
    : await computeDissections(assignmentId, new Set(sample.map((r) => r.messageId)));

  const model = getDefaultScoreModel();
  console.error(
    `${sample.length} queries × ${REPEATS} repeats · model=${model} · dissection=${NO_DISSECTION ? 'off' : 'on'}`
  );

  const limit = createLimiter(10);
  const draws = new Map<number, (ScoreQueryType | null)[]>();
  let done = 0;
  await Promise.all(
    sample.flatMap((rec) =>
      Array.from({ length: REPEATS }, () =>
        limit(async () => {
          const out = await classifyMessageType({
            queryText: rec.queryText,
            prevQueryText: rec.prevQueryText,
            prevResponseText: rec.prevResponseText,
            dissection: dissections.get(rec.messageId) ?? null,
            model,
          });
          const list = draws.get(rec.messageId) ?? [];
          list.push(out.type);
          draws.set(rec.messageId, list);
          done++;
          if (done % 25 === 0) console.error(`  ${done}/${sample.length * REPEATS}`);
        })
      )
    )
  );

  let unanimous = 0;
  const flipped: { messageId: number; query: string; verdicts: Record<string, number> }[] = [];
  for (const rec of sample) {
    const list = draws.get(rec.messageId) ?? [];
    const counts: Record<string, number> = {};
    for (const t of list) counts[t ?? 'none'] = (counts[t ?? 'none'] ?? 0) + 1;
    if (Object.keys(counts).length === 1) unanimous++;
    else {
      flipped.push({
        messageId: rec.messageId,
        query: rec.queryText.replace(/\s+/g, ' ').slice(0, 110),
        verdicts: counts,
      });
    }
  }
  const unanimity = sample.length > 0 ? unanimous / sample.length : 0;

  console.error(
    `\nunanimous ${unanimous}/${sample.length} (${(unanimity * 100).toFixed(1)}%) · flipped ${flipped.length}`
  );
  for (const f of flipped) {
    console.error(`  #${f.messageId} ${JSON.stringify(f.verdicts)}  "${f.query}"`);
  }
  console.error(
    '\nEvery flipped query is one whose cached type is a coin toss — the first run wins for good.'
  );

  writeFileSync(
    OUT,
    JSON.stringify(
      {
        assignmentId,
        model,
        repeats: REPEATS,
        dissection: !NO_DISSECTION,
        n: sample.length,
        unanimity,
        flipped,
        draws: Object.fromEntries([...draws].map(([k, v]) => [k, v])),
      },
      null,
      2
    )
  );
  console.error(`wrote ${OUT}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
