/**
 * SCORE v6 — batch intent rating (dissection + 5-level ratings per intent).
 *
 * Same client-driven batch contract as classify/route.ts: POST processes a
 * call-bounded batch and reports remaining; the client loops until 0.
 *
 * One LLM call covers ONE message: dissection (only when stale) + ratings for
 * every stale intent of that message. Staleness is per (message, intent) via
 * intentDefHash — editing one intent (or its pins) re-rates only that intent.
 * Exclusive assignment is NOT stored: it is derived at read time by the
 * deterministic resolver (intents.ts), so link edits re-assign instantly with
 * zero LLM cost.
 *
 * Optional `intentIds` scopes a run to specific intents — the New Intent
 * modal uses this to rate a freshly created intent across the log without
 * touching the rest.
 */
import { NextResponse } from 'next/server';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/db';
import { scoreDissections, scoreIntentRatings, scoreQueryEmbeddings } from '@/db/schema';
import { authorizeAssignment, authErrorResponse } from '@/lib/score/authz';
import { isOpenAIConfigured } from '@/lib/score/classifier';
import { rateMessageIntents } from '@/lib/score/intent-classifier';
import { computeDissections } from '@/lib/score/dissect';
import {
  ensureIntentTables,
  loadIntentState,
  type PromptReadyIntent,
} from '@/lib/score/intent-store';
import { DISSECTION_VERSION, type DissectionResult, type MaterialKind } from '@/lib/score/intents';
import { createLimiter, SCORE_CONCURRENCY } from '@/lib/score/limiter';
import { getDefaultScoreModel } from '@/lib/score/models';
import { ensureScoreTable, getQueryRecords, type QueryRecord } from '@/lib/score/queries';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DEFAULT_MESSAGE_LIMIT = 40;
// Raised so a single shard POST can drain its whole partition in one round
// trip: the client fans out shardCount POSTs in parallel, each handling a
// disjoint messageId slice, so one wave of the concurrency pool applies the
// intent to the entire log at once (rate-limit headroom is ~500 req/s).
const MAX_MESSAGE_LIMIT = 150;

// One rating call is heavier than a Classifier B call (multi-intent prompt,
// effort 'low'), so budget fewer waves than classify's 12 — ~8 waves of the
// pool ≈ 25-30s per POST at ~2-3s/call, inside maxDuration.
const CALLS_PER_BATCH = Math.min(400, Math.max(8, SCORE_CONCURRENCY * 8));

const bodySchema = z.object({
  limit: z.number().int().positive().max(MAX_MESSAGE_LIMIT).optional(),
  force: z.boolean().optional(),
  // Scope the run (and force) to these intents — e.g. the New Intent flow.
  intentIds: z.array(z.number().int().positive()).max(50).optional(),
  // Deterministic parallel sharding: this POST only handles messages whose
  // (messageId % shardCount) === shardIndex. The client dispatches shardCount
  // POSTs at once so the whole log is rated in one wave. Defaults = no shard.
  shardIndex: z.number().int().min(0).max(63).optional(),
  shardCount: z.number().int().min(1).max(64).optional(),
  model: z.string().optional(), // vestigial — server uses SCORE_RATING_MODEL env
});

type Shard = { index: number; count: number };
const NO_SHARD: Shard = { index: 0, count: 1 };

/** True when messageId falls in this shard's disjoint partition. */
function inShard(messageId: number, shard: Shard): boolean {
  if (shard.count <= 1) return true;
  return ((messageId % shard.count) + shard.count) % shard.count === shard.index;
}

interface MessageJob {
  record: QueryRecord;
  staleIntents: PromptReadyIntent[];
  needsDissection: boolean;
}

/**
 * Pending work per message against the CURRENT intent config. A rating row is
 * stale when missing or its stored def_hash ≠ the intent's current defHash;
 * a dissection is stale when missing or below DISSECTION_VERSION. Dissection
 * piggybacks on intent-scoped runs only when the message is already being
 * rated (the modal loop should not re-dissect the whole log).
 */
async function loadRateStatus(
  assignmentId: string,
  promptReady: PromptReadyIntent[],
  scopedIntentIds: number[] | null,
  shard: Shard = NO_SHARD
) {
  const allRecords = await getQueryRecords(assignmentId);
  // Restrict to this shard's disjoint slice so parallel POSTs never rate the
  // same message twice; `total`/`remaining` then reflect the shard (the client
  // sums across shards for the aggregate progress bar).
  const records =
    shard.count > 1 ? allRecords.filter((r) => inShard(r.messageId, shard)) : allRecords;
  const wanted = scopedIntentIds
    ? promptReady.filter((p) => scopedIntentIds.includes(p.intent.id))
    : promptReady;

  // No intents in scope → no work. (Without this, dissection-only jobs would
  // be counted here but refused by POST — a lying "remaining".)
  if (wanted.length === 0) {
    return { jobs: [], total: records.length, remaining: 0, rated: records.length };
  }

  const [ratingRows, dissectionRows] = await Promise.all([
    db
      .select({
        messageId: scoreIntentRatings.messageId,
        intentId: scoreIntentRatings.intentId,
        defHash: scoreIntentRatings.defHash,
      })
      .from(scoreIntentRatings)
      .where(eq(scoreIntentRatings.assignmentId, assignmentId)),
    db
      .select({ messageId: scoreDissections.messageId, version: scoreDissections.version })
      .from(scoreDissections)
      .where(eq(scoreDissections.assignmentId, assignmentId)),
  ]);

  // Hash-keyed history: a (message, intent) can hold rows for several specs.
  // Pending = no row exists for the intent's CURRENT hash.
  const hashesByMessage = new Map<number, Set<string>>();
  for (const r of ratingRows) {
    let s = hashesByMessage.get(r.messageId);
    if (!s) {
      s = new Set();
      hashesByMessage.set(r.messageId, s);
    }
    s.add(`${r.intentId}:${r.defHash}`);
  }
  const dissectionFresh = new Set(
    dissectionRows.filter((d) => d.version >= DISSECTION_VERSION).map((d) => d.messageId)
  );

  const jobs: MessageJob[] = [];
  for (const record of records) {
    const have = hashesByMessage.get(record.messageId);
    const staleIntents = wanted.filter(
      (p) => !have?.has(`${p.intent.id}:${p.defHash}`)
    );
    const dissectionStale = !dissectionFresh.has(record.messageId);
    const needsDissection = dissectionStale && (scopedIntentIds ? staleIntents.length > 0 : true);
    if (staleIntents.length > 0 || needsDissection) {
      jobs.push({ record, staleIntents, needsDissection });
    }
  }

  const total = records.length;
  const remaining = jobs.length;
  return { jobs, total, remaining, rated: total - remaining };
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorizeAssignment(id);
  if ('error' in auth) {
    const { body, status } = authErrorResponse(auth.error);
    return NextResponse.json(body, { status });
  }

  await Promise.all([ensureScoreTable(), ensureIntentTables()]);
  const state = await loadIntentState(id);
  const scopedParam = new URL(req.url).searchParams.get('intentIds');
  const scoped = scopedParam
    ? scopedParam
        .split(',')
        .map((s) => Number.parseInt(s, 10))
        .filter((n) => Number.isFinite(n))
    : null;
  const status = await loadRateStatus(id, state.promptReady, scoped);
  return NextResponse.json({
    total: status.total,
    rated: status.rated,
    remaining: status.remaining,
    activeIntents: state.promptReady.length,
    model: getDefaultScoreModel(),
    openaiConfigured: isOpenAIConfigured(),
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorizeAssignment(id);
  if ('error' in auth) {
    const { body, status } = authErrorResponse(auth.error);
    return NextResponse.json(body, { status });
  }

  if (!isOpenAIConfigured()) {
    return NextResponse.json(
      { error: 'openai_not_configured', message: 'OPENAI_API_KEY is not configured on the server.' },
      { status: 503 }
    );
  }

  let body: z.infer<typeof bodySchema> = {};
  try {
    const json = await req.json().catch(() => ({}));
    body = bodySchema.parse(json ?? {});
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'invalid_input', details: error.errors }, { status: 400 });
    }
  }

  const shard: Shard = { index: body.shardIndex ?? 0, count: body.shardCount ?? 1 };
  if (shard.index >= shard.count) {
    return NextResponse.json(
      { error: 'invalid_input', message: 'shardIndex must be < shardCount' },
      { status: 400 }
    );
  }

  await Promise.all([ensureScoreTable(), ensureIntentTables()]);
  const state = await loadIntentState(id);
  const scoped = body.intentIds ?? null;
  if (state.promptReady.length === 0) {
    // No active intents → nothing to rate (dissection-only sweeps would burn
    // the whole log for a viewer nicety; they ride along once intents exist).
    return NextResponse.json({
      processed: 0, succeeded: 0, failed: 0, total: 0, rated: 0, remaining: 0,
      model: getDefaultScoreModel(),
    });
  }

  if (body.force) {
    // Ratings are hash-keyed history now — force must NOT rewrite hashes (that
    // would corrupt stored versions). Instead DELETE the CURRENT-hash rows of
    // the targeted intents so they read as unrated and get re-run; historical
    // rows for other hashes stay untouched. Shard-scoped as before.
    const ratingShardCond =
      shard.count > 1
        ? sql`(${scoreIntentRatings.messageId} % ${shard.count}) = ${shard.index}`
        : undefined;
    const targets = scoped
      ? state.promptReady.filter((p) => scoped.includes(p.intent.id))
      : state.promptReady;
    for (const p of targets) {
      // assignment filter too: scoped ids are client-provided and must not be
      // able to touch another assignment's rows.
      await db
        .delete(scoreIntentRatings)
        .where(
          and(
            eq(scoreIntentRatings.assignmentId, id),
            eq(scoreIntentRatings.intentId, p.intent.id),
            eq(scoreIntentRatings.defHash, p.defHash),
            ratingShardCond
          )
        );
    }
    if (!scoped) {
      await db
        .update(scoreDissections)
        .set({ version: 0 })
        .where(
          and(
            eq(scoreDissections.assignmentId, id),
            shard.count > 1
              ? sql`(${scoreDissections.messageId} % ${shard.count}) = ${shard.index}`
              : undefined
          )
        );
    }
  }

  // Server config wins: the rating model comes from SCORE_RATING_MODEL (env),
  // not the client — the picker is gone and body.model is now vestigial.
  const model = getDefaultScoreModel();
  const status = await loadRateStatus(id, state.promptReady, scoped, shard);

  // Call-bounded batch: 1 call per message job (always at least one job so we
  // make progress even when a single job exceeds the leftover budget).
  const messageLimit = body.limit ?? DEFAULT_MESSAGE_LIMIT;
  const batch = status.jobs.slice(0, Math.min(messageLimit, CALLS_PER_BATCH));

  const now = new Date();

  // Dissection is now DETERMINISTIC (reconstructed from the editor-event log,
  // see dissect.ts) — computed here for the batch's stale-dissection messages,
  // NOT by the LLM. It cannot fail on model output, so it always makes progress.
  const dissectTargets = new Set(
    batch.filter((j) => j.needsDissection).map((j) => j.record.messageId)
  );
  const dissections = await computeDissections(id, dissectTargets);
  await Promise.all(
    [...dissections].map(([messageId, d]) => {
      const values = {
        materialKinds: d.materialKinds,
        requests: d.requests,
        version: DISSECTION_VERSION,
        rawResponse: null,
        model: 'deterministic',
        createdAt: now,
      };
      return db
        .insert(scoreDissections)
        .values({ assignmentId: id, messageId, ...values })
        .onConflictDoUpdate({ target: scoreDissections.messageId, set: values });
    })
  );
  // The embedding is computed on the dissected text → invalidate it so it
  // recomputes against the fresh dissection on next use.
  if (dissections.size > 0) {
    await db
      .delete(scoreQueryEmbeddings)
      .where(inArray(scoreQueryEmbeddings.messageId, [...dissections.keys()]));
  }
  // Jobs whose ONLY pending work was the (now-done) dissection are complete.
  const dissectionOnly = batch.filter(
    (j) => j.needsDissection && j.staleIntents.length === 0
  ).length;

  // The LLM now handles ONLY the per-intent ratings (no dissection).
  const ratingJobs = batch.filter((j) => j.staleIntents.length > 0);
  let succeeded = dissectionOnly;
  let failed = 0;
  const limit = createLimiter(SCORE_CONCURRENCY);

  // Each rating call gets THIS message's deterministic Material/Request split so
  // the judge rates only the typed request and never treats pasted material as an
  // implicit intent. The split just computed above (`dissections`) is authoritative
  // for the messages it covers; for the rest (dissection already fresh) load the
  // stored rows. Missing → null → the reworded no-request rule still applies.
  const dissectionByMsg = new Map<number, DissectionResult>();
  const ratingMsgIds = ratingJobs.map((j) => j.record.messageId);
  if (ratingMsgIds.length > 0) {
    const stored = await db
      .select({
        messageId: scoreDissections.messageId,
        materialKinds: scoreDissections.materialKinds,
        requests: scoreDissections.requests,
      })
      .from(scoreDissections)
      .where(
        and(eq(scoreDissections.assignmentId, id), inArray(scoreDissections.messageId, ratingMsgIds))
      );
    for (const s of stored) {
      dissectionByMsg.set(s.messageId, {
        materialKinds: (s.materialKinds ?? []) as MaterialKind[],
        requests: (s.requests ?? []) as string[],
      });
    }
  }
  for (const [mid, d] of dissections) dissectionByMsg.set(mid, d); // fresh overrides stored

  await Promise.all(
    ratingJobs.map((job) =>
      limit(async () => {
        const rec = job.record;
        try {
          const result = await rateMessageIntents({
            queryText: rec.queryText,
            prevQueryText: rec.prevQueryText,
            prevResponseText: rec.prevResponseText,
            intents: job.staleIntents.map((p) => ({
              id: p.intent.id,
              definition: p.intent.definition,
              pins: p.promptPins,
            })),
            includeDissection: false,
            dissection: dissectionByMsg.get(rec.messageId) ?? null,
            model,
          });

          const writes: Promise<unknown>[] = [];
          let ratingWrites = 0;
          for (const p of job.staleIntents) {
            const rating = result.ratings.get(p.intent.id);
            if (!rating) continue; // invalid/missing → stays stale, retried next POST
            ratingWrites += 1;
            const values = {
              rating: rating.rating,
              rationale: rating.rationale || null,
              defHash: p.defHash,
              rawResponse: result.raw,
              model,
              ratedAt: now,
            };
            writes.push(
              db
                .insert(scoreIntentRatings)
                .values({
                  assignmentId: id,
                  messageId: rec.messageId,
                  intentId: p.intent.id,
                  ...values,
                })
                .onConflictDoUpdate({
                  // Hash-keyed history: same spec re-rated overwrites its own
                  // row; a new spec inserts alongside the old rows.
                  target: [
                    scoreIntentRatings.messageId,
                    scoreIntentRatings.intentId,
                    scoreIntentRatings.defHash,
                  ],
                  set: values,
                })
            );
          }
          await Promise.all(writes);
          // A call that produced no usable rating wrote nothing → count as failed
          // so the client's succeeded===0 stall detector can trip.
          if (ratingWrites > 0) {
            succeeded += 1;
          } else {
            failed += 1;
            console.error(`SCORE intent rating produced no usable output for message ${rec.messageId}`);
          }
        } catch (error) {
          failed += 1;
          // Log server-side only; never echo raw LLM/DB errors to the client.
          console.error(`SCORE intent rating failed for message ${rec.messageId}:`, error);
        }
      })
    )
  );

  const after = await loadRateStatus(id, state.promptReady, scoped, shard);
  return NextResponse.json({
    processed: batch.length,
    succeeded,
    failed,
    total: after.total,
    rated: after.rated,
    remaining: after.remaining,
    model,
  });
}
