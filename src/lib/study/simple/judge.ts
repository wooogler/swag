/**
 * Which questions each definition describes.
 *
 * The same judge the full version uses (rateMessageIntents — one call per
 * question covering every definition that needs one, with the deterministic
 * material/request split fed in as context), with one difference that matters:
 * the cache is keyed by the definition TEXT, not by an intent row.
 *
 * That key is the whole performance story of this version (§6.2). Editing one
 * definition re-rates that definition and nothing else. Reordering the tree,
 * nesting an intent inside another, restoring an older version — none of them
 * change any definition text, so all of them cost zero calls. Typing a
 * definition back to what it said five minutes ago is a cache hit.
 *
 * Grades stay internal. The judge still answers on five levels because that is
 * what its prompt is built for, but the board is only ever told yes or no
 * (§6.2): a queue of borderline cases to adjudicate is the kind of work this
 * version exists to remove.
 */
import 'server-only';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db/db';
import { scoreDissections, simpleRatings } from '@/db/schema';
import { rateMessageIntents } from '@/lib/score/intent-classifier';
import { createLimiter, SCORE_CONCURRENCY } from '@/lib/score/limiter';
import { getDefaultScoreModel } from '@/lib/score/models';
import { getQueryRecords, type QueryRecord } from '@/lib/score/queries';
import {
  intentDefHash,
  isIncludedRating,
  type MaterialKind,
  type MaterialSpan,
  type PromptDissection,
  type RatingLevel,
} from '@/lib/score/intents';
import { MAX_INTENTS_PER_CALL } from '@/lib/score/intent-prompts';

/** Same budget shape as the full version's rating route. */
const CALLS_PER_BATCH = Math.min(400, Math.max(8, SCORE_CONCURRENCY * 8));

export interface DefinitionTask {
  sid: number;
  definition: string;
  defHash: string;
}

export function definitionTasks(defs: { sid: number; definition: string }[]): DefinitionTask[] {
  return defs
    .filter((d) => d.definition.trim().length > 0)
    .map((d) => ({ sid: d.sid, definition: d.definition, defHash: intentDefHash(d.definition) }));
}

export interface JudgeProgress {
  /** defHash → how many of the log's questions it has been rated against. */
  ratedByHash: Record<string, number>;
  total: number;
  /** (definition, question) pairs still to do after this batch. */
  remaining: number;
  ratedThisBatch: number;
}

/** Verdicts already known, as the board reads them: yes/no per (sid, message). */
export async function readMatches(args: {
  assignmentId: string;
  tasks: DefinitionTask[];
}): Promise<Map<number, Map<number, boolean>>> {
  const byMessage = new Map<number, Map<number, boolean>>();
  if (args.tasks.length === 0) return byMessage;
  const hashes = [...new Set(args.tasks.map((t) => t.defHash))];
  const rows = await db
    .select({
      defHash: simpleRatings.defHash,
      messageId: simpleRatings.messageId,
      rating: simpleRatings.rating,
    })
    .from(simpleRatings)
    .where(
      and(eq(simpleRatings.assignmentId, args.assignmentId), inArray(simpleRatings.defHash, hashes))
    );
  const sidsByHash = new Map<string, number[]>();
  for (const task of args.tasks) {
    sidsByHash.set(task.defHash, [...(sidsByHash.get(task.defHash) ?? []), task.sid]);
  }
  for (const row of rows) {
    for (const sid of sidsByHash.get(row.defHash) ?? []) {
      const forMessage = byMessage.get(row.messageId) ?? new Map<number, boolean>();
      forMessage.set(sid, isIncludedRating(row.rating as RatingLevel));
      byMessage.set(row.messageId, forMessage);
    }
  }
  return byMessage;
}

async function dissectionsFor(
  assignmentId: string,
  messageIds: number[]
): Promise<Map<number, PromptDissection>> {
  if (messageIds.length === 0) return new Map();
  const rows = await db
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
        inArray(scoreDissections.messageId, messageIds)
      )
    );
  return new Map(
    rows.map((d) => [
      d.messageId,
      {
        materialKinds: (d.materialKinds ?? []) as MaterialKind[],
        requests: (d.requests ?? []) as string[],
        materials: (Array.isArray(d.materials) ? d.materials : []) as MaterialSpan[],
      },
    ])
  );
}

/**
 * Rate one call-bounded batch of the work still outstanding, then report
 * progress. The client loops until `remaining` is zero, or until a batch rates
 * nothing at all — which means the calls are failing, not that the work is
 * done, and looping on it would spin forever.
 *
 * Work is ordered by the caller: the questions on screen first, then the
 * pinned ones, then the rest. A definition being edited shows its own list
 * filling in while the log behind it is still being worked through.
 */
export async function judgeBatch(args: {
  assignmentId: string;
  tasks: DefinitionTask[];
  /** Rate these questions first, in this order. */
  priorityMessageIds?: number[];
  limit?: number;
}): Promise<JudgeProgress> {
  const { assignmentId } = args;
  // Two definitions with the same text are one piece of work — the cache key
  // is the text, so rating it twice would write the same row twice.
  const tasks = [...new Map(args.tasks.map((t) => [t.defHash, t])).values()].slice(
    0,
    MAX_INTENTS_PER_CALL
  );
  const records = await getQueryRecords(assignmentId);
  const total = records.length * tasks.length;
  if (tasks.length === 0 || records.length === 0) {
    return { ratedByHash: {}, total, remaining: 0, ratedThisBatch: 0 };
  }

  const done = await db
    .select({ defHash: simpleRatings.defHash, messageId: simpleRatings.messageId })
    .from(simpleRatings)
    .where(
      and(
        eq(simpleRatings.assignmentId, assignmentId),
        inArray(
          simpleRatings.defHash,
          tasks.map((t) => t.defHash)
        )
      )
    );
  const doneByHash = new Map<string, Set<number>>();
  for (const row of done) {
    const set = doneByHash.get(row.defHash) ?? new Set<number>();
    set.add(row.messageId);
    doneByHash.set(row.defHash, set);
  }

  // One call per QUESTION covering every definition that still needs it, which
  // is what makes a full first pass cost one call per question rather than one
  // per pair.
  const priority = new Map((args.priorityMessageIds ?? []).map((id, i) => [id, i]));
  const outstanding: { record: QueryRecord; tasks: DefinitionTask[] }[] = [];
  for (const record of records) {
    const missing = tasks.filter((t) => !doneByHash.get(t.defHash)?.has(record.messageId));
    if (missing.length > 0) outstanding.push({ record, tasks: missing });
  }
  outstanding.sort((a, b) => {
    const pa = priority.get(a.record.messageId) ?? Number.MAX_SAFE_INTEGER;
    const pb = priority.get(b.record.messageId) ?? Number.MAX_SAFE_INTEGER;
    return pa - pb || a.record.messageId - b.record.messageId;
  });

  const batch = outstanding.slice(0, Math.min(args.limit ?? CALLS_PER_BATCH, CALLS_PER_BATCH));
  const dissections = await dissectionsFor(
    assignmentId,
    batch.map((b) => b.record.messageId)
  );
  const model = getDefaultScoreModel();
  const run = createLimiter(SCORE_CONCURRENCY);
  const now = new Date();
  let ratedThisBatch = 0;

  await Promise.all(
    batch.map((item) =>
      run(async () => {
        try {
          // The synthetic ids are positions in THIS call, not sids: two intents
          // sharing a definition are one entry here, and the row is written
          // against the text either way.
          const result = await rateMessageIntents({
            queryText: item.record.queryText,
            prevQueryText: item.record.prevQueryText,
            prevResponseText: item.record.prevResponseText,
            intents: item.tasks.map((t, i) => ({ id: i + 1, definition: t.definition })),
            includeDissection: false,
            dissection: dissections.get(item.record.messageId) ?? null,
            model,
          });
          const values = item.tasks
            .map((task, i) => ({ task, rating: result.ratings.get(i + 1)?.rating }))
            .filter((r): r is { task: DefinitionTask; rating: RatingLevel } => !!r.rating)
            // Sorted so concurrent writers take the unique index's row locks in
            // the same order — unordered bulk upserts deadlock in Postgres.
            .sort((a, b) => (a.task.defHash < b.task.defHash ? -1 : 1))
            .map((r) => ({
              assignmentId,
              defHash: r.task.defHash,
              messageId: item.record.messageId,
              rating: r.rating,
              model,
              ratedAt: now,
            }));
          if (values.length === 0) return;
          await db
            .insert(simpleRatings)
            .values(values)
            .onConflictDoUpdate({
              target: [simpleRatings.assignmentId, simpleRatings.defHash, simpleRatings.messageId],
              set: {
                rating: sql`excluded."rating"`,
                model: sql`excluded."model"`,
                ratedAt: sql`excluded."rated_at"`,
              },
            });
          ratedThisBatch += values.length;
          for (const v of values) {
            const set = doneByHash.get(v.defHash) ?? new Set<number>();
            set.add(v.messageId);
            doneByHash.set(v.defHash, set);
          }
        } catch (error) {
          // One question's failure is one row still missing, which the next
          // batch picks up. Nothing about the screen goes into an error state.
          console.error(`simple judge failed for message ${item.record.messageId}:`, error);
        }
      })
    )
  );

  const ratedByHash: Record<string, number> = {};
  let ratedPairs = 0;
  for (const task of tasks) {
    const n = doneByHash.get(task.defHash)?.size ?? 0;
    ratedByHash[task.defHash] = n;
    ratedPairs += n;
  }
  return { ratedByHash, total, remaining: total - ratedPairs, ratedThisBatch };
}

