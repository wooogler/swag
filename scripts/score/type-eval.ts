/**
 * v7 type classifier vs HUMAN labels (design doc §6.1 — the precondition of the
 * whole type layer).
 *
 * The type gate is unrecoverable downstream: a query put in the wrong type can
 * never reach the right intent, no matter how the instructor writes it. So the
 * classifier has to be measured against human coding before the design is
 * trusted, not after.
 *
 * Gold: nirvana/GPTWriting_recoded.csv (Inquiry, Response, Code). The Code's
 * prefix gives the type — PL/TR/RE map to planning/translating/reviewing and
 * AL (the old "All") to drafting. Blank codes are uncoded by the human and are
 * reported SEPARATELY, never counted as errors: the v7 classifier is a forced
 * 4-way choice with no "none" to answer.
 *
 * Joining to the DB follows docs/SCORE_classifierA_vs_human_eval.md:12-14 —
 * whitespace-normalized exact match first, then a collapsed+lowercased
 * fallback, duplicates consumed in order.
 *
 * Two ARMS, because they answer different questions:
 *   with-dissection    → what the instructor board produces (batch path)
 *   without-dissection → what a live student message gets (the chat runtime has
 *                        no dissection). This is the number the design's bet
 *                        actually rests on.
 *
 *   npx tsx scripts/score/type-eval.ts out.json [nQueries] [arm]
 *     arm: both (default) | with | without
 *
 * Reference to beat/compare: the pre-substitution Classifier A scored 79.2%
 * type agreement, kappa 0.72 — but that was a DIFFERENT instrument (26-subtype
 * few-shot, a null escape, no dissection steer), so treat it as context, not a
 * baseline.
 */
import { readFileSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ScoreQueryType } from '../../src/lib/score/intents';

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

const OUT = process.argv[2] ?? 'type-eval.json';
const N = Number.parseInt(process.argv[3] ?? '', 10);
const ARM = (process.argv[4] ?? 'both') as 'both' | 'with' | 'without';

/** Code prefix → v7 query type. 'AL' is the old "All", now 'drafting'. */
const PREFIX_TO_TYPE: Record<string, ScoreQueryType> = {
  PL: 'planning',
  TR: 'translating',
  RE: 'reviewing',
  AL: 'drafting',
};

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const loose = (s: string) => norm(s).toLowerCase().replace(/[^a-z0-9 ]/g, '');

/** Minimal CSV reader: quoted fields, doubled quotes, embedded newlines. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (c !== '\r') cell += c;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

async function main(): Promise<void> {
  const { db } = await import('../../src/db/db');
  const { assignments } = await import('../../src/db/schema');
  const { eq } = await import('drizzle-orm');
  const { ensureScoreTable, getQueryRecords } = await import('../../src/lib/score/queries');
  const { ensureIntentTables } = await import('../../src/lib/score/intent-store');
  const { classifyMessageType } = await import('../../src/lib/score/type-classifier');
  const { computeDissections } = await import('../../src/lib/score/dissect');
  const { createLimiter } = await import('../../src/lib/score/limiter');
  const { getDefaultScoreModel } = await import('../../src/lib/score/models');
  const { isOpenAIConfigured } = await import('../../src/lib/score/classifier');
  const { SCORE_QUERY_TYPES } = await import('../../src/lib/score/intents');

  if (!isOpenAIConfigured()) throw new Error('OPENAI_API_KEY is not configured.');
  await Promise.all([ensureScoreTable(), ensureIntentTables()]);

  // Resolve NIRVANA by share token — a re-import mints a fresh assignment id.
  const rows = await db
    .select({ id: assignments.id })
    .from(assignments)
    .where(eq(assignments.shareToken, 'nirvana-dataset'));
  if (!rows[0]) throw new Error('NIRVANA dataset not found (shareToken=nirvana-dataset)');
  const assignmentId = rows[0].id;

  // --- gold ---------------------------------------------------------------
  const csv = parseCsv(readFileSync(path.join(process.cwd(), 'nirvana/GPTWriting_recoded.csv'), 'utf8'));
  const header = csv[0].map((h) => h.replace(/^﻿/, '').trim());
  const iInquiry = header.indexOf('Inquiry');
  const iCode = header.indexOf('Code');
  const gold = csv.slice(1)
    .filter((r) => r.length > iCode && r[iInquiry]?.trim())
    .map((r) => ({ inquiry: r[iInquiry], code: (r[iCode] ?? '').trim() }));

  // --- join to the DB log --------------------------------------------------
  const records = await getQueryRecords(assignmentId);
  const byExact = new Map<string, typeof records>();
  const byLoose = new Map<string, typeof records>();
  for (const rec of records) {
    for (const [map, key] of [
      [byExact, norm(rec.queryText)],
      [byLoose, loose(rec.queryText)],
    ] as const) {
      const list = map.get(key);
      if (list) list.push(rec);
      else map.set(key, [rec]);
    }
  }
  const consumed = new Set<number>();
  const take = (inquiry: string) => {
    for (const [map, key] of [
      [byExact, norm(inquiry)],
      [byLoose, loose(inquiry)],
    ] as const) {
      for (const rec of map.get(key) ?? []) {
        if (!consumed.has(rec.messageId)) {
          consumed.add(rec.messageId);
          return rec;
        }
      }
    }
    return null;
  };

  const paired: { rec: (typeof records)[number]; goldType: ScoreQueryType | null }[] = [];
  let unmatched = 0;
  for (const g of gold) {
    const rec = take(g.inquiry);
    if (!rec) {
      unmatched++;
      continue;
    }
    const prefix = g.code.slice(0, 2).toUpperCase();
    paired.push({ rec, goldType: PREFIX_TO_TYPE[prefix] ?? null });
  }
  const sample = Number.isFinite(N) && N > 0 ? paired.slice(0, N) : paired;
  const coded = sample.filter((p) => p.goldType !== null);
  console.error(
    `gold ${gold.length} · joined ${paired.length} (unmatched ${unmatched}) · evaluating ${sample.length} (${coded.length} human-coded, ${sample.length - coded.length} uncoded)`
  );

  // --- dissections (the with-arm's steer) ----------------------------------
  const dissections = await computeDissections(
    assignmentId,
    new Set(sample.map((p) => p.rec.messageId))
  );

  const model = getDefaultScoreModel();
  const arms = ARM === 'both' ? (['with', 'without'] as const) : ([ARM] as const);
  const results: Record<string, unknown> = {};

  for (const arm of arms) {
    const limit = createLimiter(10);
    const predicted = new Map<number, ScoreQueryType | null>();
    let done = 0;
    await Promise.all(
      sample.map((p) =>
        limit(async () => {
          const out = await classifyMessageType({
            queryText: p.rec.queryText,
            prevQueryText: p.rec.prevQueryText,
            prevResponseText: p.rec.prevResponseText,
            dissection: arm === 'with' ? dissections.get(p.rec.messageId) ?? null : null,
            model,
          });
          predicted.set(p.rec.messageId, out.type);
          done++;
          if (done % 25 === 0) console.error(`  [${arm}] ${done}/${sample.length}`);
        })
      )
    );

    // Accuracy + Cohen's kappa over the HUMAN-CODED rows only.
    const confusion: Record<string, Record<string, number>> = {};
    for (const a of SCORE_QUERY_TYPES) {
      confusion[a] = Object.fromEntries(SCORE_QUERY_TYPES.map((b) => [b, 0]));
    }
    let agree = 0;
    let scored = 0;
    for (const p of coded) {
      const pred = predicted.get(p.rec.messageId);
      if (!pred) continue;
      scored++;
      confusion[p.goldType!][pred] += 1;
      if (pred === p.goldType) agree++;
    }
    const po = scored > 0 ? agree / scored : 0;
    let pe = 0;
    for (const t of SCORE_QUERY_TYPES) {
      const goldN = SCORE_QUERY_TYPES.reduce((n, b) => n + confusion[t][b], 0);
      const predN = SCORE_QUERY_TYPES.reduce((n, a) => n + confusion[a][t], 0);
      pe += (goldN / (scored || 1)) * (predN / (scored || 1));
    }
    const kappa = pe < 1 ? (po - pe) / (1 - pe) : 0;

    // Where the uncoded rows landed — reported, never scored.
    const uncodedDist: Record<string, number> = {};
    for (const p of sample) {
      if (p.goldType !== null) continue;
      const pred = predicted.get(p.rec.messageId) ?? 'none';
      uncodedDist[pred] = (uncodedDist[pred] ?? 0) + 1;
    }

    results[arm] = { n: scored, accuracy: po, kappa, confusion, uncodedDist };
    console.error(
      `\n[${arm}] n=${scored} accuracy=${(po * 100).toFixed(1)}% kappa=${kappa.toFixed(3)}`
    );
    console.error('  gold \\ pred   ' + SCORE_QUERY_TYPES.map((t) => t.slice(0, 5).padStart(6)).join(''));
    for (const t of SCORE_QUERY_TYPES) {
      console.error(
        `  ${t.padEnd(13)}` + SCORE_QUERY_TYPES.map((b) => String(confusion[t][b]).padStart(6)).join('')
      );
    }
    console.error(`  uncoded rows landed: ${JSON.stringify(uncodedDist)}`);
  }

  writeFileSync(
    OUT,
    JSON.stringify(
      { assignmentId, model, gold: gold.length, joined: paired.length, unmatched, results },
      null,
      2
    )
  );
  console.error(`\nwrote ${OUT}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
