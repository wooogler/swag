import { NextResponse } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/db';
import { assignments, scoreClassifications } from '@/db/schema';
import { getInstructor, isAdministrator } from '@/lib/auth';
import { ensureScoreTable, getQueryRecords, type QueryRecord } from '@/lib/score/queries';
import { classifyQuery, isOpenAIConfigured, CLASSIFIER_VERSION } from '@/lib/score/classifier';
import { getDefaultScoreModel, resolveScoreModel } from '@/lib/score/models';
import { getScoreConfig } from '@/lib/score/config-store';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DEFAULT_BATCH = 50;
const MAX_BATCH = 100;
const CONCURRENCY = 15;

const bodySchema = z.object({
  limit: z.number().int().positive().max(MAX_BATCH).optional(),
  force: z.boolean().optional(),
  model: z.string().optional(), // validated against the allowlist via resolveScoreModel
});

/** Verify the caller may access this assignment; returns it or null. */
async function authorizeAssignment(id: string) {
  const instructor = await getInstructor();
  if (!instructor) return { error: 'unauthorized' as const };

  const assignment = await db.query.assignments.findFirst({
    where: isAdministrator(instructor)
      ? eq(assignments.id, id)
      : and(eq(assignments.id, id), eq(assignments.instructorId, instructor.id)),
  });
  if (!assignment) return { error: 'not_found' as const };
  return { assignment };
}

async function loadStatus(assignmentId: string) {
  const records = await getQueryRecords(assignmentId);
  const cached = await db
    .select({
      messageId: scoreClassifications.messageId,
      classifierVersion: scoreClassifications.classifierVersion,
    })
    .from(scoreClassifications)
    .where(eq(scoreClassifications.assignmentId, assignmentId));
  // A row counts as classified only if it was produced by the CURRENT classifier
  // version. Older rows used a different context strategy, so they are treated as
  // unclassified and re-run on the next batch (no explicit force needed).
  const currentIds = new Set(
    cached.filter((r) => (r.classifierVersion ?? 0) >= CLASSIFIER_VERSION).map((r) => r.messageId)
  );
  const unclassified = records.filter((r) => !currentIds.has(r.messageId));
  return {
    records,
    unclassified,
    total: records.length,
    classified: records.length - unclassified.length,
    remaining: unclassified.length,
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) break;
      results[i] = await fn(items[i]);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// GET: current classification status for the assignment (no LLM calls).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorizeAssignment(id);
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.error === 'unauthorized' ? 401 : 404 });
  }

  await ensureScoreTable();
  const status = await loadStatus(id);
  return NextResponse.json({
    total: status.total,
    classified: status.classified,
    remaining: status.remaining,
    model: getDefaultScoreModel(),
    openaiConfigured: isOpenAIConfigured(),
  });
}

// POST: classify up to `limit` not-yet-cached queries (batched so the client
// can loop with a progress bar). `force: true` clears the cache first.
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

  if (body.force) {
    await db.delete(scoreClassifications).where(eq(scoreClassifications.assignmentId, id));
  }

  const status = await loadStatus(id);
  const limit = body.limit ?? DEFAULT_BATCH;
  const batch = status.unclassified.slice(0, limit);

  let succeeded = 0;
  let failed = 0;

  const classifiedAt = new Date();
  const model = resolveScoreModel(body.model);
  const config = await getScoreConfig();

  await mapWithConcurrency(batch, CONCURRENCY, async (record: QueryRecord) => {
    try {
      const result = await classifyQuery(
        config,
        record.queryText,
        record.prevQueryText,
        record.prevResponseText,
        model
      );
      await db
        .insert(scoreClassifications)
        .values({
          assignmentId: id,
          messageId: record.messageId,
          conversationId: record.conversationId,
          sessionId: record.sessionId,
          queryText: record.queryText,
          responseText: record.responseText,
          prevQueryText: record.prevQueryText,
          prevResponseText: record.prevResponseText,
          turnIndex: record.turnIndex,
          queryTimestamp: record.queryTimestamp,
          typeA: result.a.type,
          subtypeA: result.a.subtype,
          subtypeTagsB: result.b.tags,
          subtypeScoresB: result.b.scores,
          rawResponseA: result.rawA,
          rawResponseB: result.rawB,
          model,
          classifierVersion: CLASSIFIER_VERSION,
          classifiedAt,
        })
        .onConflictDoUpdate({
          target: scoreClassifications.messageId,
          set: {
            queryText: record.queryText,
            responseText: record.responseText,
            prevQueryText: record.prevQueryText,
            prevResponseText: record.prevResponseText,
            turnIndex: record.turnIndex,
            queryTimestamp: record.queryTimestamp,
            typeA: result.a.type,
            subtypeA: result.a.subtype,
            subtypeTagsB: result.b.tags,
            subtypeScoresB: result.b.scores,
            rawResponseA: result.rawA,
            rawResponseB: result.rawB,
            model,
            classifierVersion: CLASSIFIER_VERSION,
            classifiedAt,
          },
        });
      succeeded += 1;
    } catch (error) {
      failed += 1;
      // Log details server-side only; never echo raw LLM/DB errors to the client
      // (they can leak provider error details or model output). See chat/route.ts.
      console.error(`SCORE classify failed for message ${record.messageId}:`, error);
    }
  });

  const after = await loadStatus(id);
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
