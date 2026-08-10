/**
 * Why does the type classifier miss `translating`?
 *
 * Translating scored 41.9% against the human coding while the other three types
 * sat between 77% and 88% — far enough below them that it reads as a specific
 * failure rather than general noise. This prints the evidence needed to tell
 * WHICH failure: the query as the classifier saw it, the human's code, the
 * verdict, and the classifier's own one-line rationale.
 *
 * Repeated N times, because a stable wrong answer and a coin-flip are different
 * problems: the first is the type definitions disagreeing with the codebook,
 * the second is the judge's instability and no amount of prompt work fixes it.
 *
 *   npx tsx --env-file=.env scripts/study/diagnose-translating.ts [repeats] [type]
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../../src/db/db';
import { assignments, scoreDissections } from '../../src/db/schema';
import { getQueryRecords } from '../../src/lib/score/queries';
import { classifyMessageType } from '../../src/lib/score/type-classifier';
import { createLimiter, SCORE_CONCURRENCY } from '../../src/lib/score/limiter';
import { getDefaultScoreModel } from '../../src/lib/score/models';
import type { MaterialKind, MaterialSpan, ScoreQueryType } from '../../src/lib/score/intents';
import { getScoreConfig } from '../../src/lib/score/config-store';
import { buildJelsonSuggestions } from '../../src/lib/score/jelson-suggest';

const PREFIX_TO_TYPE: Record<string, ScoreQueryType> = {
  PL: 'planning', TR: 'translating', RE: 'reviewing', AL: 'drafting',
};

function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let field = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += c; }
    else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const loose = (s: string) => norm(s).toLowerCase().replace(/[^a-z0-9 ]/g, '');

async function main() {
  const repeats = Number(process.argv[2] ?? 3);
  const want = (process.argv[3] ?? 'translating') as ScoreQueryType;
  const model = getDefaultScoreModel();

  const [asg] = await db.select({ id: assignments.id }).from(assignments)
    .where(eq(assignments.shareToken, 'nirvana-dataset'));
  const assignmentId = asg.id;

  const config = await getScoreConfig();
  const labelByCode = new Map(buildJelsonSuggestions(config).map((s) => [s.code.toUpperCase(), s.label]));

  const csv = parseCsv(readFileSync(path.join(process.cwd(), 'nirvana/GPTWriting_recoded.csv'), 'utf8'));
  const header = csv[0].map((h) => h.replace(/^﻿/, '').trim());
  const iInq = header.indexOf('Inquiry');
  const iCode = header.indexOf('Code');
  const gold = csv.slice(1).filter((r) => r.length > iCode && r[iInq]?.trim())
    .map((r) => ({ inquiry: r[iInq], code: (r[iCode] ?? '').trim().toUpperCase() }));

  const records = await getQueryRecords(assignmentId);
  const byExact = new Map<string, typeof records>();
  const byLoose = new Map<string, typeof records>();
  for (const rec of records) {
    for (const [m, k] of [[byExact, norm(rec.queryText)], [byLoose, loose(rec.queryText)]] as const) {
      const l = m.get(k); if (l) l.push(rec); else m.set(k, [rec]);
    }
  }
  const consumed = new Set<number>();
  const take = (q: string) => {
    for (const [m, k] of [[byExact, norm(q)], [byLoose, loose(q)]] as const) {
      for (const rec of m.get(k) ?? []) if (!consumed.has(rec.messageId)) { consumed.add(rec.messageId); return rec; }
    }
    return null;
  };

  const target: { rec: (typeof records)[number]; code: string }[] = [];
  for (const g of gold) {
    const rec = take(g.inquiry);
    if (!rec || !g.code) continue;
    if (PREFIX_TO_TYPE[g.code.slice(0, 2)] === want) target.push({ rec, code: g.code });
  }

  const dRows = await db.select({
    messageId: scoreDissections.messageId,
    materialKinds: scoreDissections.materialKinds,
    requests: scoreDissections.requests,
    materials: scoreDissections.materials,
  }).from(scoreDissections).where(and(
    eq(scoreDissections.assignmentId, assignmentId),
    inArray(scoreDissections.messageId, target.map((t) => t.rec.messageId))
  ));
  const dByMsg = new Map(dRows.map((d) => [d.messageId, {
    materialKinds: (d.materialKinds ?? []) as MaterialKind[],
    requests: (d.requests ?? []) as string[],
    materials: (Array.isArray(d.materials) ? d.materials : []) as MaterialSpan[],
  }]));

  console.log(`gold ${want}: ${target.length} queries · ${model} · ${repeats} repeats\n`);

  const run = createLimiter(SCORE_CONCURRENCY);
  const results = new Map<number, { type: ScoreQueryType | null; rationale: string }[]>();
  await Promise.all(
    target.flatMap(({ rec }) =>
      Array.from({ length: repeats }, () =>
        run(async () => {
          try {
            const r = await classifyMessageType({
              queryText: rec.queryText,
              prevQueryText: rec.prevQueryText,
              prevResponseText: rec.prevResponseText,
              dissection: dByMsg.get(rec.messageId) ?? null,
              model,
            });
            const a = results.get(rec.messageId) ?? [];
            a.push({ type: r.type ?? null, rationale: (r.rationale ?? '').trim() });
            results.set(rec.messageId, a);
          } catch { /* counted as missing below */ }
        })
      )
    )
  );

  const confusion = new Map<string, number>();
  let allRight = 0, allWrong = 0, split = 0;
  for (const { rec, code } of target) {
    const rs = results.get(rec.messageId) ?? [];
    const hits = rs.filter((r) => r.type === want).length;
    if (hits === rs.length && rs.length) allRight++;
    else if (hits === 0) allWrong++;
    else split++;
    for (const r of rs) if (r.type !== want) confusion.set(r.type ?? 'null', (confusion.get(r.type ?? 'null') ?? 0) + 1);
  }

  console.log(`stable CORRECT (all ${repeats})   ${allRight}/${target.length}`);
  console.log(`stable WRONG   (0 of ${repeats})  ${allWrong}/${target.length}`);
  console.log(`UNSTABLE (splits the vote)     ${split}/${target.length}`);
  console.log(`\nwhen wrong, it said: ${[...confusion.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join('  ')}`);

  console.log('\n──────── the stably-wrong queries, with the judge\'s own reason ────────');
  for (const { rec, code } of target) {
    const rs = results.get(rec.messageId) ?? [];
    if (rs.some((r) => r.type === want) || !rs.length) continue;
    const d = dByMsg.get(rec.messageId);
    console.log(`\n#${rec.messageId}  gold ${code} = ${labelByCode.get(code) ?? '?'}  →  said ${[...new Set(rs.map((r) => r.type))].join('/')}`);
    console.log(`  query : "${norm(rec.queryText).slice(0, 150)}"`);
    if (d?.materialKinds.length) console.log(`  pasted: ${d.materialKinds.join(', ')} · own request(s): ${d.requests.length ? d.requests.map((r) => `"${norm(r).slice(0, 70)}"`).join(' · ') : 'NONE'}`);
    for (const r of rs) console.log(`  why   : ${r.rationale}`);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
