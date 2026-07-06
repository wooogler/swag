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
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/db';
import { scoreDissections, scoreIntentRatings } from '@/db/schema';
import { authorizeAssignment, authErrorResponse } from '@/lib/score/authz';
import { isOpenAIConfigured } from '@/lib/score/classifier';
import { rateMessageIntents } from '@/lib/score/intent-classifier';
import {
  ensureIntentTables,
  loadIntentState,
  type PromptReadyIntent,
} from '@/lib/score/intent-store';
import { DISSECTION_VERSION } from '@/lib/score/intents';
import { createLimiter, SCORE_CONCURRENCY } from '@/lib/score/limiter';
import { getDefaultScoreModel, resolveScoreModel } from '@/lib/score/models';
import { ensureScoreTable, getQueryRecords, type QueryRecord } from '@/lib/score/queries';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DEFAULT_MESSAGE_LIMIT = 40;
const MAX_MESSAGE_LIMIT = 100;

// One rating call is heavier than a Classifier B call (multi-intent prompt,
// effort 'low'), so budget fewer waves than classify's 12 — ~8 waves of the
// pool ≈ 25-30s per POST at ~2-3s/call, inside maxDuration.
const CALLS_PER_BATCH = Math.min(400, Math.max(8, SCORE_CONCURRENCY * 8));

const bodySchema = z.object({
  limit: z.number().int().positive().max(MAX_MESSAGE_LIMIT).optional(),
  force: z.boolean().optional(),
  // Scope the run (and force) to these intents — e.g. the New Intent flow.
  intentIds: z.array(z.number().int().positive()).max(50).optional(),
  model: z.string().optional(), // validated against the allowlist via resolveScoreModel
});

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
  scopedIntentIds: number[] | null
) {
  const records = await getQueryRecords(assignmentId);
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

  const hashByMessage = new Map<number, Map<number, string>>();
  for (const r of ratingRows) {
    let m = hashByMessage.get(r.messageId);
    if (!m) {
      m = new Map();
      hashByMessage.set(r.messageId, m);
    }
    m.set(r.intentId, r.defHash);
  }
  const dissectionFresh = new Set(
    dissectionRows.filter((d) => d.version >= DISSECTION_VERSION).map((d) => d.messageId)
  );

  const jobs: MessageJob[] = [];
  for (const record of records) {
    const have = hashByMessage.get(record.messageId);
    const staleIntents = wanted.filter(
      (p) => have?.get(p.intent.id) !== p.defHash
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
    // Mark stale rather than delete so the UI keeps showing previous ratings
    // until each row is overwritten (same pattern as classify force).
    if (scoped) {
      // assignment filter too: scoped ids are client-provided and must not be
      // able to touch another assignment's rows.
      await db
        .update(scoreIntentRatings)
        .set({ defHash: '' })
        .where(
          and(
            eq(scoreIntentRatings.assignmentId, id),
            inArray(scoreIntentRatings.intentId, scoped)
          )
        );
    } else {
      await db
        .update(scoreIntentRatings)
        .set({ defHash: '' })
        .where(eq(scoreIntentRatings.assignmentId, id));
      await db
        .update(scoreDissections)
        .set({ version: 0 })
        .where(eq(scoreDissections.assignmentId, id));
    }
  }

  const model = resolveScoreModel(body.model);
  const status = await loadRateStatus(id, state.promptReady, scoped);

  // Call-bounded batch: 1 call per message job (always at least one job so we
  // make progress even when a single job exceeds the leftover budget).
  const messageLimit = body.limit ?? DEFAULT_MESSAGE_LIMIT;
  const batch = status.jobs.slice(0, Math.min(messageLimit, CALLS_PER_BATCH));

  let succeeded = 0;
  let failed = 0;
  const now = new Date();
  const limit = createLimiter(SCORE_CONCURRENCY);

  await Promise.all(
    batch.map((job) =>
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
            includeDissection: job.needsDissection,
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
                  target: [scoreIntentRatings.messageId, scoreIntentRatings.intentId],
                  set: values,
                })
            );
          }
          if (job.needsDissection && result.dissection) {
            const values = {
              materialKinds: result.dissection.materialKinds,
              requests: result.dissection.requests,
              version: DISSECTION_VERSION,
              rawResponse: result.raw,
              model,
              createdAt: now,
            };
            writes.push(
              db
                .insert(scoreDissections)
                .values({ assignmentId: id, messageId: rec.messageId, ...values })
                .onConflictDoUpdate({ target: scoreDissections.messageId, set: values })
            );
          }
          await Promise.all(writes);
          // A call that produced NO usable output wrote nothing, so nothing
          // went fresh — counting it as success would let the client loop
          // re-request the same jobs forever without tripping its
          // succeeded===0 stall detector.
          const wroteSomething =
            ratingWrites > 0 || (job.needsDissection && !!result.dissection);
          if (wroteSomething || (job.staleIntents.length === 0 && !job.needsDissection)) {
            succeeded += 1;
          } else {
            failed += 1;
            console.error(
              `SCORE intent rating produced no usable output for message ${rec.messageId} (invalid ratings/dissection)`
            );
          }
        } catch (error) {
          failed += 1;
          // Log server-side only; never echo raw LLM/DB errors to the client.
          console.error(`SCORE intent rating failed for message ${rec.messageId}:`, error);
        }
      })
    )
  );

  const after = await loadRateStatus(id, state.promptReady, scoped);
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
