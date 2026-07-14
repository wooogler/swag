/**
 * Baseline "search" = an intent-LESS judge sweep of the log for a definition
 * text, exposing only clearly_in (grades hidden — spec). Reuses the EXACT SCORE
 * rating machinery (rateMessageIntents + the deterministic dissection context)
 * with a single synthetic intent so a custom search and a real intent produce
 * the same verdicts; results cache in score_probe_ratings keyed by
 * intentDefHash(definition, []) — the same keyspace preset (template) ratings use.
 *
 * Presets are the clone's template intents; their clearly_in is read straight
 * from the copied score_intent_ratings (instant, zero LLM).
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db/db';
import {
  chatMessages,
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
  type DissectionResult,
  type MaterialKind,
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
  const defHash = intentDefHash(description, []);
  const records = await getQueryRecords(assignmentId);

  const cached = await db
    .select({ messageId: scoreProbeRatings.messageId, rating: scoreProbeRatings.rating })
    .from(scoreProbeRatings)
    .where(and(eq(scoreProbeRatings.assignmentId, assignmentId), eq(scoreProbeRatings.defHash, defHash)));
  const ratingByMsg = new Map<number, string>(cached.map((r) => [r.messageId, r.rating]));

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
      })
      .from(scoreDissections)
      .where(
        and(eq(scoreDissections.assignmentId, assignmentId), inArray(scoreDissections.messageId, batch.map((r) => r.messageId)))
      );
    const dByMsg = new Map<number, DissectionResult>(
      dRows.map((d) => [
        d.messageId,
        { materialKinds: (d.materialKinds ?? []) as MaterialKind[], requests: (d.requests ?? []) as string[] },
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
              intents: [{ id: PROBE_INTENT_ID, definition: description, pins: [] }],
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

/** The clone's template intents, shown as read-only search presets. */
export async function listPresets(assignmentId: string): Promise<{ intentId: number; title: string; definition: string }[]> {
  return db
    .select({ intentId: scoreIntents.id, title: scoreIntents.title, definition: scoreIntents.definition })
    .from(scoreIntents)
    .where(and(eq(scoreIntents.assignmentId, assignmentId), eq(scoreIntents.isTemplate, true), eq(scoreIntents.archived, false)))
    .orderBy(asc(scoreIntents.id));
}

/** A preset's clearly_in — read straight from the copied intent ratings (instant).
 * Template intents carry no pins in the study clones, so their current defHash is
 * intentDefHash(definition, []). */
export async function getPresetClearlyIn(assignmentId: string, intentId: number): Promise<ClearlyInRow[]> {
  const intent = await db.query.scoreIntents.findFirst({ where: eq(scoreIntents.id, intentId) });
  if (!intent || intent.assignmentId !== assignmentId) return [];
  const defHash = intentDefHash(intent.definition, []);
  const rows = await db
    .select({ messageId: scoreIntentRatings.messageId, queryText: chatMessages.content })
    .from(scoreIntentRatings)
    .innerJoin(chatMessages, eq(scoreIntentRatings.messageId, chatMessages.id))
    .where(
      and(
        eq(scoreIntentRatings.assignmentId, assignmentId),
        eq(scoreIntentRatings.intentId, intentId),
        eq(scoreIntentRatings.defHash, defHash),
        eq(scoreIntentRatings.rating, 'clearly_in')
      )
    );
  return rows;
}
