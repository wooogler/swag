import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/db';
import { scoreClassifications, scoreSubtypeScores } from '@/db/schema';
import { authorizeAssignment } from '@/lib/score/authz';
import { createLimiter, SCORE_CONCURRENCY } from '@/lib/score/limiter';
import { ensureScoreTable, getQueryRecords, type QueryRecord } from '@/lib/score/queries';
import { classifyA, classifyBSubtype, isOpenAIConfigured, CLASSIFIER_VERSION } from '@/lib/score/classifier';
import { getDefaultScoreModel, resolveScoreModel } from '@/lib/score/models';
import { getScoreConfig } from '@/lib/score/config-store';
import { buildQueryContentB } from '@/lib/score/prompts';
import {
  flattenSubtypes,
  subtypeDefHash,
  type ScoreConfig,
  type ScoreConfigType,
  type ScoreConfigSubtype,
} from '@/lib/score/config';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Batching is bounded by LLM CALLS, not messages: Classifier B makes one call
// per subtype, so a full re-score is ~1 (A) + N (B) calls per message while an
// incremental run (e.g. one edited subtype) is a single call per message. A
// call-budget keeps each POST within maxDuration regardless of which case it is;
// the client loops until `remaining` hits 0.
const DEFAULT_MESSAGE_LIMIT = 50; // cap on messages per POST (also the client default)
const MAX_MESSAGE_LIMIT = 100;

// One GLOBAL in-flight cap across all calls in a batch (A and B share it) —
// a single work pool wastes no slots, unlike nested per-message limits.
// Tune to your OpenAI tier via SCORE_LLM_CONCURRENCY:
//   Tier 1 (500 RPM / 500K TPM):  ~8-10 (above that the SDK just burns retries)
//   Tier 2 (5,000 RPM / 2M TPM):  ~48-64
// Default 32 ≈ what Tier 2 TPM sustains with the compact B prompts.
const CONCURRENCY = SCORE_CONCURRENCY;
// Size each POST to ~12 "waves" of the pool (call latency is ~1.5-2.5s →
// ~25-30s per POST), safely inside maxDuration at ANY configured concurrency
// while amortizing per-POST overhead. Never a fixed floor: at low concurrency a
// larger floor would serialize past the 60s limit.
const CALLS_PER_BATCH = Math.min(600, Math.max(12, CONCURRENCY * 12));

const bodySchema = z.object({
  limit: z.number().int().positive().max(MAX_MESSAGE_LIMIT).optional(),
  force: z.boolean().optional(),
  // Which classifier a forced re-run applies to. 'a' re-runs only Classifier A,
  // 'b' only Classifier B, 'all' both. Ignored unless `force` is true.
  scope: z.enum(['all', 'a', 'b']).optional(),
  model: z.string().optional(), // validated against the allowlist via resolveScoreModel
});

/** Which classifier(s) a request operates on. 'a'/'b' scope every count and every
 * LLM call to that one classifier; 'all' does both. The viewer sends the
 * currently-selected classifier so both its buttons ("Classify N remaining" and
 * "Re-classify") act on the same classifier. */
type Scope = 'all' | 'a' | 'b';

/** Pending work for one message: whether A is stale, and which B subtypes are. */
interface SubtypeRef {
  type: ScoreConfigType;
  subtype: ScoreConfigSubtype;
}

interface MessageJob {
  record: QueryRecord;
  aStale: boolean;
  staleSubtypes: SubtypeRef[];
}

/**
 * Compute per-message pending work against the CURRENT config.
 *
 * - Classifier A is stale when its row is missing or below CLASSIFIER_VERSION.
 * - A Classifier B subtype is stale when its (message, subtype) row is missing or
 *   its stored defHash no longer matches the subtype's current definition — so
 *   editing one subtype re-scores only that subtype, leaving the rest valid.
 */
async function loadStatus(assignmentId: string, config: ScoreConfig, scope: Scope = 'all') {
  const wantA = scope !== 'b';
  const wantB = scope !== 'a';
  const records = await getQueryRecords(assignmentId);
  const subtypes: SubtypeRef[] = flattenSubtypes(config);
  const currentHash = new Map(
    subtypes.map((s) => [s.subtype.code, subtypeDefHash(s.type, s.subtype)])
  );

  const [aRows, bRows] = await Promise.all([
    db
      .select({
        messageId: scoreClassifications.messageId,
        classifierVersion: scoreClassifications.classifierVersion,
      })
      .from(scoreClassifications)
      .where(eq(scoreClassifications.assignmentId, assignmentId)),
    db
      .select({
        messageId: scoreSubtypeScores.messageId,
        subtypeCode: scoreSubtypeScores.subtypeCode,
        defHash: scoreSubtypeScores.defHash,
      })
      .from(scoreSubtypeScores)
      .where(eq(scoreSubtypeScores.assignmentId, assignmentId)),
  ]);

  const aFresh = new Set(
    aRows.filter((r) => (r.classifierVersion ?? 0) >= CLASSIFIER_VERSION).map((r) => r.messageId)
  );
  const bHashByMessage = new Map<number, Map<string, string>>();
  for (const r of bRows) {
    let m = bHashByMessage.get(r.messageId);
    if (!m) {
      m = new Map();
      bHashByMessage.set(r.messageId, m);
    }
    m.set(r.subtypeCode, r.defHash);
  }

  const jobs: MessageJob[] = [];
  for (const record of records) {
    const aStale = wantA && !aFresh.has(record.messageId);
    const have = bHashByMessage.get(record.messageId);
    const staleSubtypes = wantB
      ? subtypes.filter((s) => have?.get(s.subtype.code) !== currentHash.get(s.subtype.code))
      : [];
    if (aStale || staleSubtypes.length > 0) {
      jobs.push({ record, aStale, staleSubtypes });
    }
  }

  const total = records.length;
  const remaining = jobs.length;
  return { jobs, total, remaining, classified: total - remaining };
}

// GET: current classification status for the assignment (no LLM calls).
// Optional ?scope=a|b narrows the counts to one classifier.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorizeAssignment(id);
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.error === 'unauthorized' ? 401 : 404 });
  }

  await ensureScoreTable();
  const config = await getScoreConfig();
  const scopeParam = new URL(req.url).searchParams.get('scope');
  const scope: Scope = scopeParam === 'a' || scopeParam === 'b' ? scopeParam : 'all';
  const status = await loadStatus(id, config, scope);
  return NextResponse.json({
    total: status.total,
    classified: status.classified,
    remaining: status.remaining,
    model: getDefaultScoreModel(),
    openaiConfigured: isOpenAIConfigured(),
  });
}

// POST: classify up to a call-budget of pending work (batched so the client can
// loop with a progress bar). `force: true` clears BOTH caches first.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorizeAssignment(id);
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.error === 'unauthorized' ? 401 : 404 });
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

  await ensureScoreTable();

  // Every count and every LLM call below is limited to this scope.
  const scope: Scope = body.scope ?? 'all';

  if (body.force) {
    // Mark the scoped classifier stale (rather than deleting) so the grid keeps
    // showing the previous labels until each row is overwritten by the re-run.
    // A: version 0 < CLASSIFIER_VERSION. B: empty defHash never matches.
    if (scope === 'all' || scope === 'a') {
      await db
        .update(scoreClassifications)
        .set({ classifierVersion: 0 })
        .where(eq(scoreClassifications.assignmentId, id));
    }
    if (scope === 'all' || scope === 'b') {
      await db
        .update(scoreSubtypeScores)
        .set({ defHash: '' })
        .where(eq(scoreSubtypeScores.assignmentId, id));
    }
  }

  const config = await getScoreConfig();
  const model = resolveScoreModel(body.model);
  const status = await loadStatus(id, config, scope);

  // Fill a call-bounded batch of message jobs (always at least one job so we make
  // progress even if a single message exceeds the budget on its own).
  const messageLimit = body.limit ?? DEFAULT_MESSAGE_LIMIT;
  const batch: MessageJob[] = [];
  let budget = CALLS_PER_BATCH;
  for (const job of status.jobs) {
    if (batch.length >= messageLimit) break;
    const calls = (job.aStale ? 1 : 0) + job.staleSubtypes.length;
    if (batch.length > 0 && calls > budget) break;
    batch.push(job);
    budget -= calls;
  }

  let succeeded = 0; // successful LLM calls (A + each B subtype)
  let failed = 0;
  const now = new Date();
  const limit = createLimiter(CONCURRENCY);

  // Every message starts immediately; the global limiter is the only throttle.
  await Promise.all(batch.map(async (job) => {
    const rec = job.record;
    // Built once per message → the shared prefix across this query's B calls.
    const queryContent = buildQueryContentB(rec.queryText, rec.prevQueryText, rec.prevResponseText);

    const runA = async () => {
      try {
        const a = await classifyA(config, rec.queryText, rec.prevQueryText, rec.prevResponseText, model);
        const snapshot = {
          queryText: rec.queryText,
          responseText: rec.responseText,
          prevQueryText: rec.prevQueryText,
          prevResponseText: rec.prevResponseText,
          turnIndex: rec.turnIndex,
          queryTimestamp: rec.queryTimestamp,
          typeA: a.result.type,
          subtypeA: a.result.subtype,
          rawResponseA: a.raw,
          model,
          classifierVersion: CLASSIFIER_VERSION,
          classifiedAt: now,
        };
        await db
          .insert(scoreClassifications)
          .values({
            assignmentId: id,
            messageId: rec.messageId,
            conversationId: rec.conversationId,
            sessionId: rec.sessionId,
            ...snapshot,
          })
          .onConflictDoUpdate({ target: scoreClassifications.messageId, set: snapshot });
        succeeded += 1;
      } catch (error) {
        failed += 1;
        // Log server-side only; never echo raw LLM/DB errors to the client.
        console.error(`SCORE classifyA failed for message ${rec.messageId}:`, error);
      }
    };

    const runSubtype = async ({ type, subtype }: SubtypeRef) => {
      try {
        const b = await classifyBSubtype(type, subtype, queryContent, model);
        const values = {
          score: b.score,
          defHash: subtypeDefHash(type, subtype),
          rawResponse: b.raw,
          model,
          scoredAt: now,
        };
        await db
          .insert(scoreSubtypeScores)
          .values({
            assignmentId: id,
            messageId: rec.messageId,
            subtypeCode: subtype.code,
            ...values,
          })
          .onConflictDoUpdate({
            target: [scoreSubtypeScores.messageId, scoreSubtypeScores.subtypeCode],
            set: values,
          });
        succeeded += 1;
      } catch (error) {
        failed += 1;
        console.error(
          `SCORE classifyB failed for message ${rec.messageId} subtype ${subtype.code}:`,
          error
        );
      }
    };

    // OpenAI prompt caching only kicks in for prefixes >= ~1024 tokens. The
    // shared prefix here is the fixed B rubric (~400 tokens) + queryContent, so
    // serializing a warm-up call only pays when the query block is long enough
    // to cross that line (~2600 chars at ~4 chars/token). For short queries the
    // warm-up would add a full round-trip of latency for zero cache benefit.
    const cacheWorthy = queryContent.length >= 2600;

    await Promise.all([
      job.aStale ? limit(runA) : Promise.resolve(),
      (async () => {
        const subs = job.staleSubtypes;
        if (subs.length === 0) return;
        if (cacheWorthy && subs.length > 1) {
          // Warm the shared query-prefix cache with the first call, then burst
          // the rest so they hit the cached prefix (see prompts.ts).
          await limit(() => runSubtype(subs[0]));
          await Promise.all(subs.slice(1).map((s) => limit(() => runSubtype(s))));
        } else {
          await Promise.all(subs.map((s) => limit(() => runSubtype(s))));
        }
      })(),
    ]);
  }));

  const after = await loadStatus(id, config, scope);
  return NextResponse.json({
    processed: batch.length,
    succeeded,
    failed,
    total: after.total,
    classified: after.classified,
    remaining: after.remaining,
    model,
  });
}
