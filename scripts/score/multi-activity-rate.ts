/**
 * How often does one student message ask for TWO DIFFERENT activities?
 * (design doc §6.2 — the evidence behind the Drafting-wins tie-break.)
 *
 * v7 forces a single type per message, and resolves multi-activity messages to
 * Drafting. That rule is cheap if such messages are rare and load-bearing if
 * they are common: at a few percent one sentence in the classifier prompt is
 * enough, but in the double digits the board should probably SAY when a message
 * was multi-activity, because the instructor will otherwise keep finding
 * "translating" questions sitting in Drafting.
 *
 * Method: the deterministic dissection already splits each message into its
 * verbatim requests (dissect.ts, no LLM). Messages with ≥2 requests get each
 * request classified on its own; a message whose requests disagree on type is
 * multi-activity. Single-request messages cost nothing — they cannot disagree.
 *
 *   npx tsx scripts/score/multi-activity-rate.ts out.json [maxMessages]
 *
 * Also reports what the WHOLE-message classifier said for the same messages, so
 * the Drafting-wins rule can be checked directly rather than assumed.
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

const OUT = process.argv[2] ?? 'multi-activity.json';
const MAX = Number.parseInt(process.argv[3] ?? '', 10);

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

  const records = await getQueryRecords(assignmentId);
  const dissections = await computeDissections(
    assignmentId,
    new Set(records.map((r) => r.messageId))
  );

  const multiRequest = records.filter((r) => (dissections.get(r.messageId)?.requests.length ?? 0) >= 2);
  const scope = Number.isFinite(MAX) && MAX > 0 ? multiRequest.slice(0, MAX) : multiRequest;
  console.error(
    `${records.length} messages · ${multiRequest.length} have ≥2 dissected requests (${((multiRequest.length / records.length) * 100).toFixed(1)}%) · classifying ${scope.length}`
  );

  const model = getDefaultScoreModel();
  const limit = createLimiter(10);
  const out: {
    messageId: number;
    query: string;
    requests: string[];
    requestTypes: (ScoreQueryType | null)[];
    wholeMessageType: ScoreQueryType | null;
    spansTypes: boolean;
  }[] = [];
  let done = 0;

  await Promise.all(
    scope.map((rec) =>
      limit(async () => {
        const d = dissections.get(rec.messageId)!;
        // Each request judged ALONE — the same prompt, just a narrower input.
        const requestTypes = await Promise.all(
          d.requests.map(async (req) =>
            (
              await classifyMessageType({
                queryText: req,
                prevQueryText: rec.prevQueryText,
                prevResponseText: rec.prevResponseText,
                dissection: null,
                model,
              })
            ).type
          )
        );
        const whole = await classifyMessageType({
          queryText: rec.queryText,
          prevQueryText: rec.prevQueryText,
          prevResponseText: rec.prevResponseText,
          dissection: d,
          model,
        });
        const distinct = new Set(requestTypes.filter(Boolean));
        out.push({
          messageId: rec.messageId,
          query: rec.queryText.replace(/\s+/g, ' ').slice(0, 120),
          requests: d.requests.map((r) => r.replace(/\s+/g, ' ').slice(0, 80)),
          requestTypes,
          wholeMessageType: whole.type,
          spansTypes: distinct.size >= 2,
        });
        done++;
        if (done % 20 === 0) console.error(`  ${done}/${scope.length}`);
      })
    )
  );

  const spanning = out.filter((o) => o.spansTypes);
  const truncated = scope.length < multiRequest.length;
  // Rate over the WHOLE log. Only multi-request messages can span types, so the
  // numerator is measured on that subset and projected onto the log. When --max
  // truncated the run the projection is an ESTIMATE and is labelled as one —
  // reporting `spanning / allMessages` there would silently divide a partial
  // numerator by a full denominator and understate the rate.
  const spanShare = scope.length > 0 ? spanning.length / scope.length : 0;
  const rate = records.length > 0 ? (spanShare * multiRequest.length) / records.length : 0;
  // Does Drafting-wins describe what the classifier already does?
  const draftingWins = spanning.filter((o) => o.wholeMessageType === 'drafting').length;

  console.error(
    `\nof the ${scope.length} multi-request messages classified, ${spanning.length} span ≥2 types (${(spanShare * 100).toFixed(1)}%)`
  );
  console.error(
    `multi-activity rate over the whole log${truncated ? ' (ESTIMATE — run without --max for the real number)' : ''}: ${(rate * 100).toFixed(1)}%`
  );
  console.error(
    `of those, the whole-message classifier answered drafting: ${draftingWins}/${spanning.length}` +
      (spanning.length > 0 ? ` (${((draftingWins / spanning.length) * 100).toFixed(0)}%)` : '')
  );
  console.error(
    rate < 0.05
      ? '→ rare: the tie-break rule alone is enough, no UI needed.'
      : '→ common: consider surfacing "this message asked for several things" on the board (§6.2).'
  );
  for (const o of spanning.slice(0, 10)) {
    console.error(`  #${o.messageId} [${o.requestTypes.join('+')}] → whole=${o.wholeMessageType}  "${o.query.slice(0, 70)}"`);
  }

  writeFileSync(
    OUT,
    JSON.stringify(
      {
        assignmentId,
        model,
        totalMessages: records.length,
        multiRequestMessages: multiRequest.length,
        classified: scope.length,
        spanningTypes: spanning.length,
        multiActivityRate: rate,
        multiActivityRateIsEstimate: truncated,
        spanShareOfClassified: spanShare,
        draftingWins,
        details: out,
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
