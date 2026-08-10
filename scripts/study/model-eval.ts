/**
 * Two rating models, same harness, measured against NIRVANA's human coding.
 *
 * The question is whether a cheaper model can carry the study's classification
 * without moving what the prepared sets contain. That is two different claims,
 * so it is measured two ways:
 *
 *   vs HUMAN   — does it agree with the coder? The gold codes (PL01…AL07) are
 *                subtype codes, so they score BOTH layers: the code's prefix is
 *                the 4-way type, the code itself is the subtype.
 *   vs EACH    — do the two models agree with each other, pair by pair? A model
 *                can match the human just as often while disagreeing about
 *                WHICH questions, and it is the questions that end up in the
 *                sets. Human agreement alone would hide that.
 *
 * Both models run the production path: type via classifyMessageType, subtypes
 * one definition per call (the solo shape the sets are now built with), stored
 * dissections as the steer. Nothing is written to score_intent_ratings — this
 * measures, it does not re-rate.
 *
 * The human coded ONE code per query while the judge rates 26 memberships
 * independently, so a single gold label cannot punish a second true match.
 * Recall against gold is therefore the honest headline; set size is reported
 * beside it so greediness stays visible.
 *
 *   npx tsx --env-file=.env scripts/study/model-eval.ts --dry        # join only
 *   npx tsx --env-file=.env scripts/study/model-eval.ts [n] [out.json]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../../src/db/db';
import { assignments, scoreDissections, scoreIntents } from '../../src/db/schema';
import { getQueryRecords } from '../../src/lib/score/queries';
import { classifyMessageType } from '../../src/lib/score/type-classifier';
import { rateMessageIntents } from '../../src/lib/score/intent-classifier';
import { createLimiter, SCORE_CONCURRENCY } from '../../src/lib/score/limiter';
import {
  MATERIAL_PROMPT_MODE,
  INTENT_RATING_VERSION,
  intentDefHash,
  type MaterialKind,
  type MaterialSpan,
  type ScoreQueryType,
} from '../../src/lib/score/intents';
import { getScoreConfig } from '../../src/lib/score/config-store';
import { buildJelsonSuggestions, jelsonToIntent } from '../../src/lib/score/jelson-suggest';

// Override with --models=a,b — passing the SAME id twice measures the judge's
// own test-retest, which is the only honest yardstick for "is this gap big?".
const MODELS = (process.argv.find((a) => a.startsWith('--models='))?.slice(9).split(',') ?? [
  'gpt-5.4-mini',
  'gpt-5.6-luna',
]);

/** Gold code prefix → v7 query type (the old "All" is v7 'drafting'). */
const PREFIX_TO_TYPE: Record<string, ScoreQueryType> = {
  PL: 'planning',
  TR: 'translating',
  RE: 'reviewing',
  AL: 'drafting',
};
const IN = new Set(['clearly_in', 'probably_in']);

/* ── CSV (quoted fields carry embedded newlines) ── */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const loose = (s: string) => norm(s).toLowerCase().replace(/[^a-z0-9 ]/g, '');

function kappa(a: string[], b: string[], classes: string[]): number {
  const n = a.length;
  if (!n) return 0;
  let agree = 0;
  for (let i = 0; i < n; i++) if (a[i] === b[i]) agree++;
  const po = agree / n;
  let pe = 0;
  for (const c of classes) {
    pe += (a.filter((x) => x === c).length / n) * (b.filter((x) => x === c).length / n);
  }
  return pe === 1 ? 1 : (po - pe) / (1 - pe);
}

interface PerModel {
  model: string;
  typePred: Map<number, ScoreQueryType | null>;
  /** messageId → intentId → rating */
  subtype: Map<number, Map<number, string>>;
  typeMs: number[];
  subMs: number[];
}

async function main() {
  const dry = process.argv.includes('--dry');
  // --types-only: skip the 26-per-query subtype fan-out. The type gate is the
  // cheap layer (1 call per query), so a prompt iteration on it should not
  // cost 8,600 subtype calls per arm to measure.
  const typesOnly = process.argv.includes('--types-only');
  const nArg = process.argv.slice(2).find((a) => /^\d+$/.test(a));
  const N = nArg ? Number(nArg) : Infinity;
  const out = process.argv.slice(2).find((a) => a.endsWith('.json'));

  const [asg] = await db
    .select({ id: assignments.id })
    .from(assignments)
    .where(eq(assignments.shareToken, 'nirvana-dataset'));
  if (!asg) throw new Error('NIRVANA dataset not found (shareToken=nirvana-dataset)');
  const assignmentId = asg.id;

  /* ── gold ── */
  const csv = parseCsv(readFileSync(path.join(process.cwd(), 'nirvana/GPTWriting_recoded.csv'), 'utf8'));
  const header = csv[0].map((h) => h.replace(/^﻿/, '').trim());
  const iInq = header.indexOf('Inquiry');
  const iCode = header.indexOf('Code');
  const gold = csv
    .slice(1)
    .filter((r) => r.length > iCode && r[iInq]?.trim())
    .map((r) => ({ inquiry: r[iInq], code: (r[iCode] ?? '').trim().toUpperCase() }));

  /* ── code → subtype template ── */
  const config = await getScoreConfig();
  const suggestions = buildJelsonSuggestions(config);
  const labelByCode = new Map(suggestions.map((s) => [s.code.toUpperCase(), s.label]));
  const chooserHash = new Set(suggestions.map((s) => intentDefHash(jelsonToIntent(s).definition)));

  const templateRows = await db
    .select({ id: scoreIntents.id, title: scoreIntents.title, definition: scoreIntents.definition })
    .from(scoreIntents)
    .where(and(eq(scoreIntents.assignmentId, assignmentId), eq(scoreIntents.isTemplate, true)));
  const templates = templateRows.filter((t) => chooserHash.has(intentDefHash(t.definition)));
  const templateByTitle = new Map(templates.map((t) => [t.title.trim().toLowerCase(), t]));
  const templateByCode = new Map<string, (typeof templates)[number]>();
  const noTemplate: string[] = [];
  for (const [code, label] of labelByCode) {
    const t = templateByTitle.get(label.trim().toLowerCase());
    if (t) templateByCode.set(code, t);
    else noTemplate.push(`${code} (${label})`);
  }

  /* ── join gold → DB ── */
  const records = await getQueryRecords(assignmentId);
  const byExact = new Map<string, typeof records>();
  const byLoose = new Map<string, typeof records>();
  for (const rec of records) {
    for (const [map, key] of [[byExact, norm(rec.queryText)], [byLoose, loose(rec.queryText)]] as const) {
      const list = map.get(key);
      if (list) list.push(rec);
      else map.set(key, [rec]);
    }
  }
  const consumed = new Set<number>();
  const take = (inquiry: string) => {
    for (const [map, key] of [[byExact, norm(inquiry)], [byLoose, loose(inquiry)]] as const) {
      for (const rec of map.get(key) ?? []) {
        if (!consumed.has(rec.messageId)) { consumed.add(rec.messageId); return rec; }
      }
    }
    return null;
  };

  const paired: { rec: (typeof records)[number]; code: string; goldType: ScoreQueryType }[] = [];
  let unmatched = 0;
  let uncoded = 0;
  for (const g of gold) {
    const rec = take(g.inquiry);
    if (!rec) { unmatched++; continue; }
    if (!g.code) { uncoded++; continue; }
    const goldType = PREFIX_TO_TYPE[g.code.slice(0, 2)];
    if (!goldType) { uncoded++; continue; }
    paired.push({ rec, code: g.code, goldType });
  }
  const sample = Number.isFinite(N) ? paired.slice(0, N) : paired;

  console.log(`harness      ${MATERIAL_PROMPT_MODE} · r${INTENT_RATING_VERSION}`);
  console.log(`templates    ${templates.length} chooser-reachable of ${templateRows.length}`);
  if (noTemplate.length) console.log(`  NO TEMPLATE for: ${noTemplate.join(', ')}`);
  console.log(`gold rows    ${gold.length}  (unmatched ${unmatched}, uncoded/blank ${uncoded})`);
  console.log(`evaluating   ${sample.length} human-coded queries × ${templates.length} subtypes × ${MODELS.length} models`);
  console.log(`calls        ${sample.length * MODELS.length} type + ${typesOnly ? 0 : sample.length * templates.length * MODELS.length} subtype\n`);
  if (dry) { process.exit(0); }

  /* ── dissections (production steer) ── */
  const ids = sample.map((s) => s.rec.messageId);
  const dRows = await db
    .select({
      messageId: scoreDissections.messageId,
      materialKinds: scoreDissections.materialKinds,
      requests: scoreDissections.requests,
      materials: scoreDissections.materials,
    })
    .from(scoreDissections)
    .where(and(eq(scoreDissections.assignmentId, assignmentId), inArray(scoreDissections.messageId, ids)));
  const dByMsg = new Map(
    dRows.map((d) => [
      d.messageId,
      {
        materialKinds: (d.materialKinds ?? []) as MaterialKind[],
        requests: (d.requests ?? []) as string[],
        materials: (Array.isArray(d.materials) ? d.materials : []) as MaterialSpan[],
      },
    ])
  );

  /* ── run both models ── */
  const results: PerModel[] = [];
  for (const model of MODELS) {
    const run = createLimiter(SCORE_CONCURRENCY);
    const per: PerModel = { model, typePred: new Map(), subtype: new Map(), typeMs: [], subMs: [] };
    let done = 0;
    const t0 = Date.now();
    await Promise.all(
      sample.flatMap(({ rec }) => {
        const common = {
          queryText: rec.queryText,
          prevQueryText: rec.prevQueryText,
          prevResponseText: rec.prevResponseText,
          dissection: dByMsg.get(rec.messageId) ?? null,
          model,
        };
        const typeJob = run(async () => {
          const s = Date.now();
          try {
            const r = await classifyMessageType(common);
            per.typePred.set(rec.messageId, r.type ?? null);
          } catch { per.typePred.set(rec.messageId, null); }
          per.typeMs.push(Date.now() - s);
        });
        const subJobs = (typesOnly ? [] : templates).map((t) =>
          run(async () => {
            const s = Date.now();
            try {
              const r = await rateMessageIntents({
                ...common,
                intents: [{ id: t.id, definition: t.definition }],
                includeDissection: false,
              });
              const rating = r.ratings.get(t.id)?.rating;
              if (rating) {
                const m = per.subtype.get(rec.messageId) ?? new Map<number, string>();
                m.set(t.id, rating);
                per.subtype.set(rec.messageId, m);
              }
            } catch { /* missing → counted as a miss, reported */ }
            per.subMs.push(Date.now() - s);
            if (++done % 500 === 0) {
              process.stdout.write(`\r  ${model}: ${done}/${sample.length * templates.length} subtype calls`);
            }
          })
        );
        return [typeJob, ...subJobs];
      })
    );
    console.log(`\r  ${model}: done in ${((Date.now() - t0) / 1000).toFixed(0)}s${' '.repeat(20)}`);
    results.push(per);
  }

  /* ── scoring ── */
  const TYPES: ScoreQueryType[] = ['planning', 'translating', 'reviewing', 'drafting'];
  const report: Record<string, unknown> = { harness: MATERIAL_PROMPT_MODE, ratingVersion: INTENT_RATING_VERSION, n: sample.length, models: {} };

  console.log('\n════ vs HUMAN ════\n');
  const head = 'metric'.padEnd(34) + MODELS.map((m) => m.padEnd(16)).join('');
  console.log(head);
  console.log('─'.repeat(head.length));

  const line = (label: string, vals: string[]) =>
    console.log(label.padEnd(34) + vals.map((v) => v.padEnd(16)).join(''));

  // --- type ---
  const typeStats = results.map((r) => {
    const g: string[] = [];
    const p: string[] = [];
    for (const s of sample) {
      const pred = r.typePred.get(s.rec.messageId);
      if (!pred) continue;
      g.push(s.goldType);
      p.push(pred);
    }
    const acc = g.filter((x, i) => x === p[i]).length / g.length;
    return { acc, k: kappa(g, p, TYPES), n: g.length };
  });
  line('TYPE  accuracy (4-way)', typeStats.map((t) => `${(t.acc * 100).toFixed(1)}%`));
  line('TYPE  Cohen κ', typeStats.map((t) => t.k.toFixed(3)));

  // --- subtype ---
  const subStats = results.map((r) => {
    let hitClearly = 0, hitIn = 0, exact1 = 0, clearlySum = 0, inSum = 0, scored = 0;
    for (const s of sample) {
      const t = templateByCode.get(s.code);
      const m = r.subtype.get(s.rec.messageId);
      if (!t || !m || m.size === 0) continue;
      scored++;
      const clearly = [...m.entries()].filter(([, v]) => v === 'clearly_in').map(([id]) => id);
      const inish = [...m.entries()].filter(([, v]) => IN.has(v)).map(([id]) => id);
      clearlySum += clearly.length;
      inSum += inish.length;
      if (clearly.includes(t.id)) hitClearly++;
      if (inish.includes(t.id)) hitIn++;
      if (clearly.length === 1 && clearly[0] === t.id) exact1++;
    }
    return {
      scored,
      hitClearly: hitClearly / scored,
      hitIn: hitIn / scored,
      exact1: exact1 / scored,
      meanClearly: clearlySum / scored,
      meanIn: inSum / scored,
    };
  });
  if (!typesOnly) line('SUB   gold rated clearly_in', subStats.map((s) => `${(s.hitClearly * 100).toFixed(1)}%`));
  if (typesOnly) {
    // per-type table + latency still print below; the subtype block is skipped.
  } else {
  line('SUB   gold rated in-ish', subStats.map((s) => `${(s.hitIn * 100).toFixed(1)}%`));
  line('SUB   gold is the ONLY clearly_in', subStats.map((s) => `${(s.exact1 * 100).toFixed(1)}%`));
  line('SUB   mean |clearly_in| per query', subStats.map((s) => s.meanClearly.toFixed(2)));
  line('SUB   mean |in-ish| per query', subStats.map((s) => s.meanIn.toFixed(2)));
  }

  const med = (xs: number[]) => { const a = [...xs].sort((x, y) => x - y); return a[Math.floor(a.length / 2)] ?? 0; };
  line('median latency  type call', results.map((r) => `${med(r.typeMs)} ms`));
  line('median latency  subtype call', results.map((r) => `${med(r.subMs)} ms`));

  // How the four levels are actually spent. probably_in is not decoration: it
  // is curation's "boundary" grade, so a model that rarely reaches for it moves
  // the certain/boundary split the sets are assembled against.
  if (!typesOnly) {
  console.log('\n──── rating levels emitted ────');
  const LEVELS = ['clearly_in', 'probably_in', 'probably_out', 'clearly_out'];
  const levelStats = results.map((r) => {
    const c = new Map<string, number>();
    let total = 0;
    for (const m of r.subtype.values()) for (const v of m.values()) { c.set(v, (c.get(v) ?? 0) + 1); total++; }
    return { c, total };
  });
  for (const lv of LEVELS) {
    line(`  ${lv}`, levelStats.map((s) => `${(((s.c.get(lv) ?? 0) / s.total) * 100).toFixed(1)}%`));
  }

  // The curation grade each model would produce, by the board's own rule
  // (curation.ts gradeOf): exactly one clearly_in is "certain"; more than one,
  // or any probably_in, is "boundary"; nothing is "unmatched".
  console.log('\n──── curation grade the board would show ────');
  const gradeStats = results.map((r) => {
    const g = { certain: 0, boundary: 0, unmatched: 0 };
    for (const s of sample) {
      const m = r.subtype.get(s.rec.messageId);
      if (!m || m.size === 0) continue;
      let clearly = 0, probably = 0;
      for (const v of m.values()) { if (v === 'clearly_in') clearly++; else if (v === 'probably_in') probably++; }
      if (clearly === 1) g.certain++;
      else if (clearly > 1 || probably > 0) g.boundary++;
      else g.unmatched++;
    }
    const n = g.certain + g.boundary + g.unmatched;
    return { ...g, n };
  });
  for (const k of ['certain', 'boundary', 'unmatched'] as const) {
    line(`  ${k}`, gradeStats.map((s) => `${((s[k] / s.n) * 100).toFixed(1)}%  (${s[k]})`));
  }
  report.levels = Object.fromEntries(results.map((r, i) => [r.model, Object.fromEntries(levelStats[i].c)]));
  report.grades = Object.fromEntries(results.map((r, i) => [r.model, gradeStats[i]]));
  }

  // Per-type accuracy — a 4-way average can hide one type collapsing.
  console.log('\n──── type accuracy by gold type ────');
  for (const t of TYPES) {
    const rows = sample.filter((s) => s.goldType === t);
    line(`  ${t} (n=${rows.length})`, results.map((r) => {
      const scored = rows.filter((s) => r.typePred.get(s.rec.messageId));
      const hit = scored.filter((s) => r.typePred.get(s.rec.messageId) === t).length;
      return scored.length ? `${((hit / scored.length) * 100).toFixed(1)}%` : '—';
    }));
  }

  report.models = Object.fromEntries(
    results.map((r, i) => [r.model, { type: typeStats[i], subtype: subStats[i] }])
  );
  report.raw = {
    subtypeTitles: Object.fromEntries(templates.map((t) => [t.id, t.title])),
    queries: sample.map((s) => ({
      messageId: s.rec.messageId,
      goldCode: s.code,
      goldType: s.goldType,
      goldIntentId: templateByCode.get(s.code)?.id ?? null,
      byModel: Object.fromEntries(
        results.map((r) => [
          r.model,
          {
            type: r.typePred.get(s.rec.messageId) ?? null,
            ratings: Object.fromEntries(r.subtype.get(s.rec.messageId) ?? []),
          },
        ])
      ),
    })),
  };
  const [A, B] = results;
  if (!B) {
    // Single-arm run (a mode sweep, say) — the pairwise section needs two.
    if (out) { writeFileSync(out, JSON.stringify(report, null, 2)); console.log(`\nwrote ${out}`); }
    process.exit(0);
  }
  console.log('\n════ MODEL vs MODEL (does switching move the sets?) ════\n');
  let bothType = 0, sameType = 0;
  for (const s of sample) {
    const a = A.typePred.get(s.rec.messageId), b = B.typePred.get(s.rec.messageId);
    if (!a || !b) continue;
    bothType++;
    if (a === b) sameType++;
  }
  let pairs = 0, same4 = 0, sameSide = 0;
  const flipsBySubtype = new Map<string, number>();
  for (const s of sample) {
    const ma = A.subtype.get(s.rec.messageId), mb = B.subtype.get(s.rec.messageId);
    if (!ma || !mb) continue;
    for (const t of templates) {
      const a = ma.get(t.id), b = mb.get(t.id);
      if (!a || !b) continue;
      pairs++;
      if (a === b) same4++;
      if (IN.has(a) === IN.has(b)) sameSide++;
      else flipsBySubtype.set(t.title, (flipsBySubtype.get(t.title) ?? 0) + 1);
    }
  }
  console.log(`type agreement            ${sameType}/${bothType}  ${((sameType / bothType) * 100).toFixed(1)}%`);
  console.log(`subtype exact 4-level     ${same4}/${pairs}  ${((same4 / pairs) * 100).toFixed(1)}%`);
  console.log(`subtype same side of in   ${sameSide}/${pairs}  ${((sameSide / pairs) * 100).toFixed(1)}%`);
  console.log(`membership flips          ${pairs - sameSide}`);
  const worst = [...flipsBySubtype.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (worst.length) {
    console.log('\nsubtypes that move most:');
    for (const [title, n] of worst) console.log(`  ${String(n).padStart(4)}  ${title}`);
  }

  report.modelVsModel = { sameType, bothType, same4, sameSide, pairs };
  // Raw predictions, so any metric thought of later is a re-read, not a re-run.

  if (out) { writeFileSync(out, JSON.stringify(report, null, 2)); console.log(`\nwrote ${out}`); }
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
