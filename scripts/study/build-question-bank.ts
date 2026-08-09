/**
 * Freeze the block-test and A/B questions into the question bank.
 *
 * These questions are never part of a participant's log — they are new to them
 * — so they are stored as text (context turns + the question) taken from the
 * ORIGINAL master. Frozen, not referenced: a later master rebuild must not be
 * able to change a question a participant was already asked.
 *
 * The A/B order is built in BALANCED BLOCKS: every four consecutive items hold
 * both datasets twice and rotate the query types. The pilot may cut 16 → 12 → 8
 * by simply dropping the tail, and each of those prefixes still gives every
 * configuration the same number of home and away questions — an arbitrary
 * shuffle truncated the same way would not, and the imbalance would be
 * identical for every participant rather than averaging out.
 *
 *   npx tsx --env-file=.env scripts/study/build-question-bank.ts          # plan only
 *   npx tsx --env-file=.env scripts/study/build-question-bank.ts --apply
 */
import { inArray, sql } from 'drizzle-orm';
import { db } from '../../src/db/db';
import { chatMessages, studyGeneratedResponses, studyQuestionBank } from '../../src/db/schema';

const APPLY = process.argv.includes('--apply');

const TYPE_ROTATION = ['planning', 'translating', 'reviewing', 'drafting'] as const;

interface Candidate {
  messageId: number;
  datasetKey: string;
  queryType: string | null;
  subtype: string | null;
}

async function main() {
  const { CURATION_DATASETS } = await import('../../src/lib/study/config');
  const { getConfirmedSet, isLocked } = await import('../../src/lib/study/curation');
  const { ensureStudyTables } = await import('../../src/lib/study/store');
  await ensureStudyTables();

  const test: Candidate[] = [];
  const ab: Candidate[] = [];
  for (const dataset of CURATION_DATASETS) {
    if (!(await isLocked(dataset.key))) {
      console.log(`${dataset.key}: curation not confirmed — lock the sets first.`);
      process.exit(1);
    }
    for (const row of await getConfirmedSet(dataset.key, 'test')) {
      test.push({ ...row, datasetKey: dataset.key });
    }
    for (const row of await getConfirmedSet(dataset.key, 'ab')) {
      ab.push({ ...row, datasetKey: dataset.key });
    }
  }
  console.log(`test candidates ${test.length} · A/B candidates ${ab.length}`);

  const ordered = balancedAbOrder(ab);
  console.log(
    `A/B order: ${ordered.map((c) => `${c.datasetKey[0]}${(c.queryType ?? '?')[0]}`).join(' ')}`
  );
  reportBalance(ordered);

  // Freeze the text: prior turns + the question itself, as of now.
  const all = [...test, ...ab];
  const frozen = await freezeQuestions(all);

  if (!APPLY) {
    console.log('\n(plan only — re-run with --apply)');
    const sample = frozen.get(all[0]?.messageId);
    if (sample) {
      console.log(`sample: ${sample.context.length} context turn(s) + "${sample.question.slice(0, 70)}…"`);
    }
    process.exit(0);
  }

  // Rebuilding is refused once answers exist against the current bank: a
  // participant was already asked those questions, and renumbering or
  // replacing them would orphan what they said.
  const existing = await db.select({ id: studyQuestionBank.id }).from(studyQuestionBank);
  if (existing.length > 0) {
    const used = await db
      .select({ id: studyGeneratedResponses.id })
      .from(studyGeneratedResponses)
      .where(inArray(studyGeneratedResponses.bankItemId, existing.map((e) => e.id)))
      .limit(1);
    if (used.length > 0) {
      console.log('\n✗ answers already exist against the current bank — refusing to rebuild.');
      process.exit(1);
    }
    await db.delete(studyQuestionBank);
    console.log(`\nreplaced ${existing.length} previous bank item(s)`);
  }

  const rows: (typeof studyQuestionBank.$inferInsert)[] = [];
  // Block test keeps its per-dataset ordering: it is shown to one clone only.
  const testByDataset = new Map<string, Candidate[]>();
  for (const c of test) {
    const list = testByDataset.get(c.datasetKey) ?? [];
    list.push(c);
    testByDataset.set(c.datasetKey, list);
  }
  for (const [datasetKey, list] of testByDataset) {
    list.forEach((c, i) => {
      const f = frozen.get(c.messageId);
      if (!f) return;
      rows.push({
        datasetKey,
        kind: 'test',
        position: i,
        sourceMessageId: c.messageId,
        context: f.context,
        question: f.question,
        queryType: c.queryType,
        subtype: c.subtype,
        createdAt: new Date(),
      });
    });
  }
  ordered.forEach((c, i) => {
    const f = frozen.get(c.messageId);
    if (!f) return;
    rows.push({
      datasetKey: c.datasetKey,
      kind: 'ab',
      position: i,
      sourceMessageId: c.messageId,
      context: f.context,
      question: f.question,
      queryType: c.queryType,
      subtype: c.subtype,
      createdAt: new Date(),
    });
  });

  await db.insert(studyQuestionBank).values(rows);
  console.log(`\nwrote ${rows.length} bank item(s).`);
  process.exit(0);
}

/**
 * Interleave into blocks of four: both datasets twice, types rotating. Built by
 * taking one item at a time from each (dataset, type) bucket in a fixed order,
 * so any prefix that is a multiple of four is balanced by construction.
 */
function balancedAbOrder(items: Candidate[]): Candidate[] {
  const buckets = new Map<string, Candidate[]>();
  for (const item of items) {
    const key = `${item.datasetKey}:${item.queryType ?? 'unknown'}`;
    const list = buckets.get(key) ?? [];
    list.push(item);
    buckets.set(key, list);
  }
  const datasets = [...new Set(items.map((i) => i.datasetKey))].sort();
  const out: Candidate[] = [];
  // Round r takes type rotation[r] from each dataset in turn, twice over the
  // four types → 4 items per round, 2 per dataset, all four types across two
  // rounds.
  for (let round = 0; round < TYPE_ROTATION.length; round++) {
    for (const datasetKey of datasets) {
      const type = TYPE_ROTATION[round];
      const bucket = buckets.get(`${datasetKey}:${type}`);
      while (bucket && bucket.length > 0) {
        out.push(bucket.shift()!);
        break; // one per (dataset, type) per round; the second pass takes the rest
      }
    }
  }
  // Second pass for the remaining item of each (dataset, type) pair.
  for (let round = 0; round < TYPE_ROTATION.length; round++) {
    for (const datasetKey of datasets) {
      const bucket = buckets.get(`${datasetKey}:${TYPE_ROTATION[round]}`);
      if (bucket && bucket.length > 0) out.push(bucket.shift()!);
    }
  }
  // Anything left (an unexpected type, or an unbalanced set) goes at the end
  // rather than being dropped.
  for (const bucket of buckets.values()) out.push(...bucket);
  return out;
}

/** Show that every planned truncation point stays balanced. */
function reportBalance(ordered: Candidate[]) {
  for (const cut of [8, 12, 16]) {
    if (ordered.length < cut) continue;
    const prefix = ordered.slice(0, cut);
    const byDataset = new Map<string, number>();
    const byType = new Map<string, number>();
    for (const c of prefix) {
      byDataset.set(c.datasetKey, (byDataset.get(c.datasetKey) ?? 0) + 1);
      byType.set(c.queryType ?? '?', (byType.get(c.queryType ?? '?') ?? 0) + 1);
    }
    const datasets = [...byDataset.values()];
    const even = datasets.every((n) => n === datasets[0]);
    console.log(
      `  first ${String(cut).padStart(2)}: datasets ${[...byDataset].map(([k, v]) => `${k}=${v}`).join(' ')} ${
        even ? '✓' : '✗ UNBALANCED'
      } · types ${[...byType].map(([k, v]) => `${k}=${v}`).join(' ')}`
    );
  }
}

/** The question text plus the turns before it, taken from the source master. */
async function freezeQuestions(
  candidates: Candidate[]
): Promise<Map<number, { context: { role: string; content: string }[]; question: string }>> {
  const out = new Map<number, { context: { role: string; content: string }[]; question: string }>();
  if (candidates.length === 0) return out;

  const anchors = await db
    .select({
      id: chatMessages.id,
      conversationId: chatMessages.conversationId,
      sequenceNumber: chatMessages.sequenceNumber,
      content: chatMessages.content,
    })
    .from(chatMessages)
    .where(inArray(chatMessages.id, candidates.map((c) => c.messageId)));

  for (const anchor of anchors) {
    const priors = await db
      .select({ role: chatMessages.role, content: chatMessages.content })
      .from(chatMessages)
      .where(
        sql`${chatMessages.conversationId} = ${anchor.conversationId} AND ${chatMessages.sequenceNumber} < ${anchor.sequenceNumber}`
      )
      .orderBy(chatMessages.sequenceNumber);
    out.set(anchor.id, {
      context: priors.map((p) => ({ role: p.role, content: p.content })),
      question: anchor.content,
    });
  }
  return out;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
