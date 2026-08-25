/**
 * Does a subtype get the same verdict alone as it does among its siblings?
 *
 * The prepared sets are rated with all 26 subtype definitions in one call. The
 * probe that powers "create a new intent" rates the SAME definition on its own
 * (probe.ts passes a single intent). Same code, same prompt template, same
 * model — different neighbours. The system prompt's own rules ("rate each
 * strictly by ITS OWN definition", "do not balance ratings across intents")
 * exist because that context is known to pull; this measures how hard.
 *
 * It matters for parity: if the two disagree, then "the same description gives
 * the same result whichever way you got there" holds by hash but not in fact.
 *
 * Writes NOTHING. Both calls are made fresh here so the comparison isolates the
 * neighbour count and nothing else — no cached row, no harness-version drift.
 *
 *   npx tsx --env-file=.env scripts/study/check-neighbor-effect.ts [subtype] [n]
 */
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../../src/db/db';
import { scoreDissections, scoreIntentRatings, scoreIntents } from '../../src/db/schema';
import { getQueryRecords } from '../../src/lib/score/queries';
import { rateMessageIntents } from '../../src/lib/score/intent-classifier';
import { createLimiter, SCORE_CONCURRENCY } from '../../src/lib/score/limiter';
import { getDefaultScoreModel } from '../../src/lib/score/models';
import { intentDefHash, type MaterialKind, type MaterialSpan } from '../../src/lib/score/intents';
import { getScoreConfig } from '../../src/lib/score/config-store';
import { buildJelsonSuggestions, jelsonToIntent } from '../../src/lib/score/jelson-suggest';
import { sourceLog } from '../../src/lib/study/config';

const IN = new Set(['clearly_in', 'probably_in']);

async function main() {
  const wantTitle = process.argv[2] ?? 'Give Feedback';
  const n = Number(process.argv[3] ?? 30);
  const assignmentId = sourceLog('swag')!.masterAssignmentId;

  const config = await getScoreConfig();
  const chooser = new Set(
    buildJelsonSuggestions(config).map((s) => intentDefHash(jelsonToIntent(s).definition))
  );
  const templates = (
    await db
      .select({ id: scoreIntents.id, title: scoreIntents.title, definition: scoreIntents.definition })
      .from(scoreIntents)
      .where(and(eq(scoreIntents.assignmentId, assignmentId), eq(scoreIntents.isTemplate, true)))
  ).filter((t) => chooser.has(intentDefHash(t.definition)));

  const target = templates.find((t) => t.title === wantTitle);
  if (!target) {
    console.error(`no such subtype: ${wantTitle}\n${templates.map((t) => t.title).join('\n')}`);
    process.exit(1);
  }

  // Stratified: half the sample from questions the standing verdict calls IN,
  // half from OUT. An unstratified draw is ~95% clearly_out on both sides and
  // would report near-perfect agreement while saying nothing about the cases
  // curation actually reads.
  const standing = await db
    .select({ messageId: scoreIntentRatings.messageId, rating: scoreIntentRatings.rating })
    .from(scoreIntentRatings)
    .where(
      and(eq(scoreIntentRatings.assignmentId, assignmentId), eq(scoreIntentRatings.intentId, target.id))
    );
  const inIds = standing.filter((r) => IN.has(r.rating)).map((r) => r.messageId);
  const outIds = standing.filter((r) => !IN.has(r.rating)).map((r) => r.messageId);
  const half = Math.floor(n / 2);
  const pick = [...inIds.slice(0, half), ...outIds.slice(0, n - half)];

  const records = (await getQueryRecords(assignmentId)).filter((r) => pick.includes(r.messageId));
  const dRows = await db
    .select({
      messageId: scoreDissections.messageId,
      materialKinds: scoreDissections.materialKinds,
      requests: scoreDissections.requests,
      materials: scoreDissections.materials,
    })
    .from(scoreDissections)
    .where(
      and(
        eq(scoreDissections.assignmentId, assignmentId),
        inArray(scoreDissections.messageId, records.map((r) => r.messageId))
      )
    );
  const dByMsg = new Map(
    dRows.map((d) => [
      d.messageId,
      {
        materialKinds: (d.materialKinds ?? []) as MaterialKind[],
        requests: (d.requests ?? []) as string[],
        materials: (Array.isArray(d.materials) ? d.materials : []) as MaterialSpan[],
      },
    ])
  );

  const model = getDefaultScoreModel();
  const run = createLimiter(SCORE_CONCURRENCY);
  console.log(`subtype "${target.title}" · ${records.length} questions · ${model}`);
  console.log(`(${Math.min(half, inIds.length)} standing-IN, ${records.length - Math.min(half, inIds.length)} standing-OUT)\n`);

  const rows: { messageId: number; group: string; solo: string; query: string }[] = [];
  await Promise.all(
    records.map((rec) =>
      run(async () => {
        const common = {
          queryText: rec.queryText,
          prevQueryText: rec.prevQueryText,
          prevResponseText: rec.prevResponseText,
          includeDissection: false as const,
          dissection: dByMsg.get(rec.messageId) ?? null,
          model,
        };
        const [grouped, solo] = await Promise.all([
          rateMessageIntents({ ...common, intents: templates.map((t) => ({ id: t.id, definition: t.definition })) }),
          rateMessageIntents({ ...common, intents: [{ id: target.id, definition: target.definition }] }),
        ]);
        const g = grouped.ratings.get(target.id)?.rating;
        const s = solo.ratings.get(target.id)?.rating;
        if (!g || !s) return;
        rows.push({ messageId: rec.messageId, group: g, solo: s, query: rec.queryText.replace(/\s+/g, ' ').slice(0, 70) });
      })
    )
  );

  let exact = 0;
  let sameSide = 0;
  const flips: typeof rows = [];
  for (const r of rows) {
    if (r.group === r.solo) exact++;
    if (IN.has(r.group) === IN.has(r.solo)) sameSide++;
    else flips.push(r);
  }
  const pct = (k: number) => `${((k / rows.length) * 100).toFixed(1)}%`;
  console.log(`exact 4-level agreement   ${exact}/${rows.length}  ${pct(exact)}`);
  console.log(`same side of the in/out line  ${sameSide}/${rows.length}  ${pct(sameSide)}`);
  console.log(`\nmembership FLIPS (${flips.length}) — these change what curation shows:`);
  for (const f of flips) {
    console.log(`  #${f.messageId}  among-26=${f.group.padEnd(12)} alone=${f.solo.padEnd(12)} "${f.query}"`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
