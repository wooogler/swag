/**
 * Re-rate intents whose cached verdicts have gone stale, headlessly.
 *
 * The rate route only rates what a board asks it to, and the board is a browser
 * loop — so an INTENT_RATING_VERSION or DISSECTION_VERSION bump reaches an
 * instructor's own intents the next time they open the workbench, and reaches
 * the study's PREPARED SETS never: a clone's template intents are seeded into
 * simple_ratings by seedFromPreparedSets and no one opens a board on them.
 * Every participant then inherits the stale verdict. This script is the driver
 * those rows do not otherwise have.
 *
 * It is the rate route's rating half and nothing else: same staleness test
 * (stored def_hash ≠ the intent's current intentDefHash), same call, same
 * hash-keyed upsert, same model from SCORE_RATING_MODEL. It does NOT dissect —
 * run redissect.ts first, and this refuses to rate against a dissection below
 * the current version rather than baking one in.
 *
 *   npx tsx --env-file=.env scripts/score/rerate-intents.ts --all            # plan only
 *   npx tsx --env-file=.env scripts/score/rerate-intents.ts --all --apply
 *   npx tsx --env-file=.env scripts/score/rerate-intents.ts <assignmentId> … --apply
 *
 * By default only TEMPLATE intents (the prepared sets) are rated, since those
 * are the ones with no UI driver; --every-intent widens it to the whole board.
 */
export {};

const APPLY = process.argv.includes('--apply');
const EVERY_INTENT = process.argv.includes('--every-intent');
const ALL = process.argv.includes('--all');

async function main() {
  const { and, eq, inArray } = await import('drizzle-orm');
  const { db } = await import('../../src/db/db');
  const { assignments, scoreDissections, scoreIntentRatings } = await import('../../src/db/schema');
  const { rateMessageIntents } = await import('../../src/lib/score/intent-classifier');
  const { loadIntentState } = await import('../../src/lib/score/intent-store');
  const { chunkForRating } = await import('../../src/lib/score/intent-prompts');
  const { DISSECTION_VERSION } = await import('../../src/lib/score/intents');
  type MaterialKind = import('../../src/lib/score/intents').MaterialKind;
  type MaterialSpan = import('../../src/lib/score/intents').MaterialSpan;
  const { createLimiter, SCORE_CONCURRENCY } = await import('../../src/lib/score/limiter');
  const { getDefaultScoreModel } = await import('../../src/lib/score/models');
  const { getQueryRecords } = await import('../../src/lib/score/queries');

  const ids = ALL
    ? (await db.select({ id: assignments.id }).from(assignments)).map((a) => a.id)
    : process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (ids.length === 0) {
    console.error('usage: rerate-intents.ts --all | <assignmentId> … [--every-intent] [--apply]');
    process.exit(1);
  }

  const model = getDefaultScoreModel();
  console.log(`model ${model} · ${EVERY_INTENT ? 'every intent' : 'template intents only'}${APPLY ? '' : ' · PLAN ONLY'}\n`);

  let grandCalls = 0;
  let grandWrites = 0;
  let grandFailed = 0;

  for (const assignmentId of ids) {
    const state = await loadIntentState(assignmentId);
    const wanted = state.promptReady.filter((p) => EVERY_INTENT || p.intent.isTemplate);
    if (wanted.length === 0) continue;
    const records = await getQueryRecords(assignmentId);
    if (records.length === 0) continue;

    // Staleness, exactly as the route defines it: a rating row is fresh iff its
    // stored def_hash equals the intent's current defHash.
    const have = new Set(
      (
        await db
          .select({
            messageId: scoreIntentRatings.messageId,
            intentId: scoreIntentRatings.intentId,
            defHash: scoreIntentRatings.defHash,
          })
          .from(scoreIntentRatings)
          .where(eq(scoreIntentRatings.assignmentId, assignmentId))
      ).map((r) => `${r.messageId}:${r.intentId}:${r.defHash}`)
    );

    const dissections = new Map(
      (
        await db
          .select()
          .from(scoreDissections)
          .where(
            and(
              eq(scoreDissections.assignmentId, assignmentId),
              inArray(scoreDissections.messageId, records.map((r) => r.messageId))
            )
          )
      ).map((d) => [d.messageId, d])
    );
    const behind = [...dissections.values()].filter((d) => d.version < DISSECTION_VERSION).length;
    const undissected = records.filter((r) => !dissections.has(r.messageId)).length;
    if (behind > 0 || undissected > 0) {
      console.log(
        `${assignmentId}: SKIPPED — ${behind} dissection(s) below v${DISSECTION_VERSION}, ${undissected} missing. Run redissect.ts first.`
      );
      continue;
    }

    // One call per (message, stale intent) — the route's shape
    // (INTENTS_PER_RATING_CALL), so the prompt the judge sees here is the
    // prompt it sees there and a prepared verdict is comparable to a
    // participant-authored one.
    const jobs: { record: (typeof records)[number]; chunk: typeof wanted }[] = [];
    for (const record of records) {
      const stale = wanted.filter((p) => !have.has(`${record.messageId}:${p.intent.id}:${p.defHash}`));
      for (const chunk of chunkForRating(stale)) jobs.push({ record, chunk });
    }
    if (jobs.length === 0) {
      console.log(`${assignmentId}: up to date (${wanted.length} intents × ${records.length} questions)`);
      continue;
    }
    grandCalls += jobs.length;
    if (!APPLY) {
      console.log(
        `${assignmentId}: ${jobs.length} call(s) — ${wanted.length} intents × ${records.length} questions, ${jobs.reduce((a, j) => a + j.chunk.length, 0)} stale pair(s)`
      );
      continue;
    }

    const now = new Date();
    const limit = createLimiter(SCORE_CONCURRENCY);
    let writes = 0;
    let failed = 0;
    const t0 = Date.now();
    await Promise.all(
      jobs.map((job) =>
        limit(async () => {
          const rec = job.record;
          const d = dissections.get(rec.messageId)!;
          try {
            const result = await rateMessageIntents({
              queryText: rec.queryText,
              prevQueryText: rec.prevQueryText,
              prevResponseText: rec.prevResponseText,
              intents: job.chunk.map((p) => ({ id: p.intent.id, definition: p.intent.definition })),
              includeDissection: false,
              dissection: {
                materialKinds: (d.materialKinds ?? []) as MaterialKind[],
                requests: (d.requests ?? []) as string[],
                materials: (Array.isArray(d.materials) ? d.materials : []) as MaterialSpan[],
              },
              model,
            });
            for (const p of job.chunk) {
              const rating = result.ratings.get(p.intent.id);
              if (!rating) continue; // unusable output → stays stale, rerun picks it up
              const values = {
                rating: rating.rating,
                rationale: rating.rationale || null,
                defHash: p.defHash,
                rawResponse: result.raw,
                model,
                ratedAt: now,
              };
              await db
                .insert(scoreIntentRatings)
                .values({ assignmentId, messageId: rec.messageId, intentId: p.intent.id, ...values })
                .onConflictDoUpdate({
                  target: [
                    scoreIntentRatings.messageId,
                    scoreIntentRatings.intentId,
                    scoreIntentRatings.defHash,
                  ],
                  set: values,
                });
              writes += 1;
            }
          } catch (error) {
            failed += 1;
            console.error(`  message ${rec.messageId} failed:`, (error as Error).message);
          }
        })
      )
    );
    grandWrites += writes;
    grandFailed += failed;
    console.log(
      `${assignmentId}: ${jobs.length} call(s) → ${writes} rating(s) in ${((Date.now() - t0) / 1000).toFixed(1)}s${failed ? `  ⚠ ${failed} failed` : ''}`
    );
  }

  console.log(
    APPLY
      ? `\n${grandCalls} call(s) · ${grandWrites} rating(s) written · ${grandFailed} failed`
      : `\n${grandCalls} call(s) would run — re-run with --apply`
  );
  process.exit(grandFailed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
