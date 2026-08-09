/**
 * Baseline "search" = an intent-LESS judge sweep of the log for a definition
 * text, exposing only clearly_in (grades hidden — spec). Reuses the EXACT SCORE
 * rating machinery (rateMessageIntents + the deterministic dissection context)
 * with a single synthetic intent so a custom search and a real intent produce
 * the same verdicts; results cache in score_probe_ratings keyed by
 * intentDefHash(definition, []) — the same keyspace preset (template) ratings use.
 *
 * The clone's prepared TEMPLATE intents feed this cache rather than being
 * browsable in their own right (spec S-6b/S-6c): the first probe of a text that
 * matches a template definition copies that template's standing verdicts in,
 * so a filter seeded from a starter suggestion opens with its questions already
 * there instead of re-rating the whole log.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db/db';
import {
  scoreDissections,
  scoreIntentRatings,
  scoreIntents,
  scoreProbeRatings,
} from '@/db/schema';
import { rateMessageIntents } from '@/lib/score/intent-classifier';
import { createLimiter, SCORE_CONCURRENCY } from '@/lib/score/limiter';
import { getDefaultScoreModel } from '@/lib/score/models';
import { getQueryRecords } from '@/lib/score/queries';
import {
  intentDefHash,
  type MaterialKind,
  type MaterialSpan,
  type PromptDissection,
} from '@/lib/score/intents';

// Synthetic intent id for the single-definition probe call.
const PROBE_INTENT_ID = 1;
// Same call budget shape as the rate route.
const PROBE_CALLS_PER_BATCH = Math.min(400, Math.max(8, SCORE_CONCURRENCY * 8));

export interface ClearlyInRow {
  messageId: number;
  queryText: string;
}

export interface ProbeResult {
  defHash: string;
  total: number;
  rated: number;
  remaining: number;
  ratedThisBatch: number;
  clearlyIn: ClearlyInRow[];
}

/**
 * Rate one call-bounded batch of not-yet-cached messages for `description`, then
 * return the current clearly_in set + progress. Callers loop until remaining===0
 * (or ratedThisBatch===0, i.e. a stall). limit caps the batch (tests pass small).
 */
export async function probeBatch(
  assignmentId: string,
  description: string,
  limit?: number
): Promise<ProbeResult> {
  const defHash = intentDefHash(description);
  const records = await getQueryRecords(assignmentId);

  const cached = await db
    .select({ messageId: scoreProbeRatings.messageId, rating: scoreProbeRatings.rating })
    .from(scoreProbeRatings)
    .where(and(eq(scoreProbeRatings.assignmentId, assignmentId), eq(scoreProbeRatings.defHash, defHash)));
  const ratingByMsg = new Map<number, string>(cached.map((r) => [r.messageId, r.rating]));

  // A prepared TEMPLATE with this exact definition already carries a full
  // rating pass over the log — in score_intent_ratings, not here. Copy it into
  // the probe cache the first time the text is probed, so a filter seeded from
  // a starter suggestion opens with its questions already there (the chooser
  // promises "questions appear immediately") instead of re-rating ~everything.
  // The two keyspaces share intentDefHash(definition), so a copied row is the
  // same verdict the probe would have produced.
  if (ratingByMsg.size < records.length) {
    const templates = await db
      .select({ id: scoreIntents.id, definition: scoreIntents.definition })
      .from(scoreIntents)
      .where(and(eq(scoreIntents.assignmentId, assignmentId), eq(scoreIntents.isTemplate, true)));
    const template = templates.find((t) => intentDefHash(t.definition) === defHash);
    if (template) {
      // Deliberately NOT filtered to the current defHash: the templates were
      // rated when the clone was prepared, and a rating-harness version bump
      // since then changes the hash without changing the definition text. The
      // template's standing verdicts are the whole point of the prepared set
      // (spec S-6a) — so take the newest rating per message, whatever hash
      // generation it was stored under.
      const tRows = await db
        .select({
          messageId: scoreIntentRatings.messageId,
          rating: scoreIntentRatings.rating,
          rawResponse: scoreIntentRatings.rawResponse,
          model: scoreIntentRatings.model,
          ratedAt: scoreIntentRatings.ratedAt,
        })
        .from(scoreIntentRatings)
        .where(
          and(
            eq(scoreIntentRatings.assignmentId, assignmentId),
            eq(scoreIntentRatings.intentId, template.id)
          )
        );
      const newestByMsg = new Map<number, (typeof tRows)[number]>();
      for (const r of tRows) {
        const prev = newestByMsg.get(r.messageId);
        if (!prev || r.ratedAt > prev.ratedAt) newestByMsg.set(r.messageId, r);
      }
      // Sorted so two concurrent seeds of the same defHash take the unique
      // index's row locks in the same order — unordered bulk upserts of ~500
      // rows are a deadlock shape in Postgres.
      const fresh = [...newestByMsg.values()]
        .filter((r) => !ratingByMsg.has(r.messageId))
        .sort((a, b) => a.messageId - b.messageId);
      if (fresh.length > 0) {
        await db
          .insert(scoreProbeRatings)
          .values(
            fresh.map((r) => ({
              assignmentId,
              defHash,
              messageId: r.messageId,
              rating: r.rating,
              rawResponse: r.rawResponse,
              model: r.model,
              ratedAt: r.ratedAt,
            }))
          )
          .onConflictDoNothing();
        for (const r of fresh) ratingByMsg.set(r.messageId, r.rating);
      }
    }
  }

  const uncached = records.filter((r) => !ratingByMsg.has(r.messageId));
  const batchSize = Math.min(limit ?? PROBE_CALLS_PER_BATCH, PROBE_CALLS_PER_BATCH);
  const batch = uncached.slice(0, batchSize);
  let ratedThisBatch = 0;

  if (batch.length > 0) {
    const dRows = await db
      .select({
        messageId: scoreDissections.messageId,
        materialKinds: scoreDissections.materialKinds,
        requests: scoreDissections.requests,
        // The baseline judge must read the same markers the treatment judge
        // does. The column is already populated in every clone — only this
        // SELECT separated the two arms.
        materials: scoreDissections.materials,
      })
      .from(scoreDissections)
      .where(
        and(eq(scoreDissections.assignmentId, assignmentId), inArray(scoreDissections.messageId, batch.map((r) => r.messageId)))
      );
    const dByMsg = new Map<number, PromptDissection>(
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
    const now = new Date();
    await Promise.all(
      batch.map((rec) =>
        run(async () => {
          try {
            const result = await rateMessageIntents({
              queryText: rec.queryText,
              prevQueryText: rec.prevQueryText,
              prevResponseText: rec.prevResponseText,
              intents: [{ id: PROBE_INTENT_ID, definition: description }],
              includeDissection: false,
              dissection: dByMsg.get(rec.messageId) ?? null,
              model,
            });
            const r = result.ratings.get(PROBE_INTENT_ID);
            if (!r) return;
            ratingByMsg.set(rec.messageId, r.rating);
            ratedThisBatch += 1;
            const values = { rating: r.rating, rawResponse: result.raw, model, ratedAt: now };
            await db
              .insert(scoreProbeRatings)
              .values({ assignmentId, defHash, messageId: rec.messageId, ...values })
              .onConflictDoUpdate({
                target: [scoreProbeRatings.assignmentId, scoreProbeRatings.defHash, scoreProbeRatings.messageId],
                set: values,
              });
          } catch (error) {
            console.error(`Probe rating failed for message ${rec.messageId}:`, error);
          }
        })
      )
    );
  }

  const clearlyIn = records
    .filter((r) => ratingByMsg.get(r.messageId) === 'clearly_in')
    .map((r) => ({ messageId: r.messageId, queryText: r.queryText }));
  const rated = ratingByMsg.size;
  return { defHash, total: records.length, rated, remaining: records.length - rated, ratedThisBatch, clearlyIn };
}
