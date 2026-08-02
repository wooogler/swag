/**
 * Classify a master assignment's whole log into the 4 v7 query types.
 *
 * The instructor board does this on its own (the rate route's type pass), but a
 * MASTER dataset has no instructor session driving it, and study clones copy
 * score_query_types verbatim — so typing a master here is what keeps
 * provisioning zero-LLM for every participant cloned from it.
 *
 * Uses the exact production primitives the rate route uses: classifyMessageType
 * with the stored deterministic dissection fed in, staleness by
 * TYPE_CLASSIFIER_VERSION, upsert keyed on message_id.
 *
 *   npx tsx scripts/score/type-sweep.ts                     # status only
 *   npx tsx scripts/score/type-sweep.ts --apply [--limit N] [--assignment <id>]
 *   npx tsx scripts/score/type-sweep.ts --apply --share nirvana-dataset
 *
 * Idempotent: only messages with no fresh row are classified, so re-running a
 * completed sweep costs zero LLM calls.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { DissectionResult, MaterialKind } from '../../src/lib/score/intents';

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

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] ?? null : null;
}

const APPLY = process.argv.includes('--apply');
const LIMIT = Number.parseInt(argValue('--limit') ?? '', 10);
const ASSIGNMENT_ARG = argValue('--assignment');
// Prefer the share token: a re-import mints a fresh assignment UUID.
const SHARE_ARG = argValue('--share') ?? (ASSIGNMENT_ARG ? null : 'nirvana-dataset');

async function main(): Promise<void> {
  const { db } = await import('../../src/db/db');
  const { assignments, scoreDissections, scoreQueryTypes } = await import('../../src/db/schema');
  const { and, eq, inArray } = await import('drizzle-orm');
  const { ensureIntentTables } = await import('../../src/lib/score/intent-store');
  const { classifyMessageType } = await import('../../src/lib/score/type-classifier');
  const { getQueryRecords, ensureScoreTable } = await import('../../src/lib/score/queries');
  const { TYPE_CLASSIFIER_VERSION } = await import('../../src/lib/score/intents');
  const { createLimiter, SCORE_CONCURRENCY } = await import('../../src/lib/score/limiter');
  const { getDefaultScoreModel } = await import('../../src/lib/score/models');
  const { isOpenAIConfigured } = await import('../../src/lib/score/classifier');

  await Promise.all([ensureScoreTable(), ensureIntentTables()]);

  let assignmentId = ASSIGNMENT_ARG;
  if (!assignmentId && SHARE_ARG) {
    const rows = await db
      .select({ id: assignments.id, title: assignments.title })
      .from(assignments)
      .where(eq(assignments.shareToken, SHARE_ARG));
    if (!rows[0]) throw new Error(`No assignment with shareToken=${SHARE_ARG}`);
    assignmentId = rows[0].id;
    console.log(`Assignment: ${rows[0].title} (${assignmentId}) via shareToken=${SHARE_ARG}`);
  }
  if (!assignmentId) throw new Error('Pass --assignment <id> or --share <token>');

  const records = await getQueryRecords(assignmentId);
  const typeRows = await db
    .select({ messageId: scoreQueryTypes.messageId, version: scoreQueryTypes.version })
    .from(scoreQueryTypes)
    .where(eq(scoreQueryTypes.assignmentId, assignmentId));
  const fresh = new Set(
    typeRows.filter((t) => t.version >= TYPE_CLASSIFIER_VERSION).map((t) => t.messageId)
  );
  const pending = records.filter((r) => !fresh.has(r.messageId));

  console.log(
    `messages: ${records.length} | typed: ${records.length - pending.length} | pending: ${pending.length}`
  );
  if (pending.length === 0) {
    console.log('Nothing to do — every message already carries a current type judgment.');
    await summarize();
    return;
  }
  if (!APPLY) {
    console.log('Dry run — re-run with --apply to classify.');
    return;
  }
  if (!isOpenAIConfigured()) throw new Error('OPENAI_API_KEY is not configured.');

  const batch = Number.isFinite(LIMIT) && LIMIT > 0 ? pending.slice(0, LIMIT) : pending;
  const model = getDefaultScoreModel();
  console.log(`Classifying ${batch.length} message(s) with ${model} …`);

  // Stored dissections steer the call exactly as they do in the rate route.
  const dissectionByMsg = new Map<number, DissectionResult>();
  const ids = batch.map((b) => b.messageId);
  for (let i = 0; i < ids.length; i += 500) {
    const slice = ids.slice(i, i + 500);
    const stored = await db
      .select({
        messageId: scoreDissections.messageId,
        materialKinds: scoreDissections.materialKinds,
        requests: scoreDissections.requests,
      })
      .from(scoreDissections)
      .where(
        and(
          eq(scoreDissections.assignmentId, assignmentId),
          inArray(scoreDissections.messageId, slice)
        )
      );
    for (const s of stored) {
      dissectionByMsg.set(s.messageId, {
        materialKinds: (s.materialKinds ?? []) as MaterialKind[],
        requests: (s.requests ?? []) as string[],
      });
    }
  }
  console.log(`  (${dissectionByMsg.size}/${batch.length} have a stored dissection to steer with)`);

  const limit = createLimiter(SCORE_CONCURRENCY);
  const now = new Date();
  let ok = 0;
  let bad = 0;
  let done = 0;
  await Promise.all(
    batch.map((rec) =>
      limit(async () => {
        try {
          const result = await classifyMessageType({
            queryText: rec.queryText,
            prevQueryText: rec.prevQueryText,
            prevResponseText: rec.prevResponseText,
            dissection: dissectionByMsg.get(rec.messageId) ?? null,
            model,
          });
          if (!result.type) {
            bad++;
            return;
          }
          const values = {
            type: result.type,
            rationale: result.rationale || null,
            version: TYPE_CLASSIFIER_VERSION,
            rawResponse: result.raw,
            model,
            createdAt: now,
          };
          await db
            .insert(scoreQueryTypes)
            .values({ assignmentId: assignmentId!, messageId: rec.messageId, ...values })
            .onConflictDoUpdate({ target: scoreQueryTypes.messageId, set: values });
          ok++;
        } catch (error) {
          bad++;
          console.error(`  message ${rec.messageId} failed:`, (error as Error).message);
        } finally {
          done++;
          if (done % 25 === 0) process.stderr.write(`  … ${done}/${batch.length}\n`);
        }
      })
    )
  );
  console.log(`classified: ${ok} | failed: ${bad}`);
  await summarize();

  async function summarize(): Promise<void> {
    const dist = await db.execute<{ type: string; n: number }>(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (await import('drizzle-orm')).sql`
        SELECT type, COUNT(*)::int AS n FROM score_query_types
        WHERE assignment_id = ${assignmentId} GROUP BY type ORDER BY n DESC`
    );
    const total = dist.reduce((s, r) => s + r.n, 0);
    console.log('\ntype distribution:');
    for (const r of dist) {
      const pct = total > 0 ? ((r.n / total) * 100).toFixed(1) : '0.0';
      console.log(`  ${r.type.padEnd(12)} ${String(r.n).padStart(4)}  ${pct}%`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
