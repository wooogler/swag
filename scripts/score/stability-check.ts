/**
 * SCORE — LLM-as-a-judge STABILITY (test-retest reliability) check.
 *
 * Runs the EXACT production rating path (rateMessageIntents → callModel →
 * gpt-5.4-mini, effort 'low', strict 4-level schema) repeatedly on a sample of
 * real NIRVANA student queries, rating each against the 26 Jelson "starter set"
 * subtypes (built the same way "Run all starter sets" builds them). Because the
 * SCORE models are reasoning models (no temperature/seed), this measures the
 * judge's INHERENT run-to-run nondeterminism.
 *
 * Output: a JSON blob (raw draws + computed stability metrics) written to the
 * path given as argv[2]. Read-only w.r.t. the app DB (never writes ratings).
 *
 * Usage: npx tsx scripts/score/stability-check.ts <outPath.json> [numQueries] [repeats]
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ---- env (mirror import-nirvana.ts: load .env before importing db/openai) ----
function loadEnv() {
  try {
    const envText = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
    for (const line of envText.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const key = m[1];
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {
    /* .env optional if already exported */
  }
}
loadEnv();

const NIRVANA_ASSIGNMENT = 'ea905a40-ad5d-4fe5-bbf8-91d6b1998331';
const OUT = process.argv[2] ?? 'stability.json';
const NUM_QUERIES = Number.parseInt(process.argv[3] ?? '20', 10);
const REPEATS = Number.parseInt(process.argv[4] ?? '8', 10);
const CONCURRENCY = 10;

// Ordinal map for the 4 EMITTED levels (unsure is never emitted).
const ORD: Record<string, number> = { clearly_in: 0, probably_in: 1, probably_out: 2, clearly_out: 3 };
const LEVELS = ['clearly_in', 'probably_in', 'probably_out', 'clearly_out'] as const;

async function main() {
  const { getQueryRecords } = await import('@/lib/score/queries');
  const { rateMessageIntents } = await import('@/lib/score/intent-classifier');
  const { computeDissections } = await import('@/lib/score/dissect');
  const { buildJelsonSuggestions, jelsonToIntent } = await import('@/lib/score/jelson-suggest');
  const { DEFAULT_SCORE_CONFIG } = await import('@/lib/score/default-config');
  const { getDefaultScoreModel } = await import('@/lib/score/models');
  const { createLimiter } = await import('@/lib/score/limiter');

  const model = getDefaultScoreModel();

  // ---- Build the 26 subtype "starter set" intents exactly like the UI does ----
  const suggestions = buildJelsonSuggestions(DEFAULT_SCORE_CONFIG);
  const intents = suggestions.map((s, i) => {
    const { title, definition } = jelsonToIntent(s);
    return { id: i + 1, code: s.code, label: title, typeKey: s.typeKey, definition, pins: [] as [] };
  });

  // ---- Sample queries: evenly spaced across all NIRVANA queries by messageId ----
  const all = (await getQueryRecords(NIRVANA_ASSIGNMENT)).sort((a, b) => a.messageId - b.messageId);
  const n = Math.min(NUM_QUERIES, all.length);
  const sample = Array.from({ length: n }, (_, i) => all[Math.floor((i + 0.5) * (all.length / n))]);

  // Feed the deterministic Material/Request dissection into every rating call,
  // exactly as the batch rate route now does (fix #1). Set SCORE_NO_DISSECTION=1
  // to reproduce the pre-fix behaviour for an A/B baseline.
  const feedDissection = process.env.SCORE_NO_DISSECTION !== '1';
  const dissByMsg = feedDissection
    ? await computeDissections(NIRVANA_ASSIGNMENT, new Set(sample.map((q) => q.messageId)))
    : new Map();

  console.error(
    `[stability] model=${model} intents=${intents.length} queries=${sample.length} repeats=${REPEATS} ` +
      `→ ${sample.length * REPEATS} calls`
  );

  // ---- Run: REPEATS independent calls per query, each rating all 26 intents ----
  type Draw = { intentId: number; rating: string; rationale: string };
  const draws = new Map<number, Draw[][]>(); // messageId → repeat[] → Draw[]
  for (const q of sample) draws.set(q.messageId, Array.from({ length: REPEATS }, () => []));

  const limit = createLimiter(CONCURRENCY);
  const tasks: Promise<void>[] = [];
  let done = 0;
  const totalCalls = sample.length * REPEATS;

  for (const q of sample) {
    for (let r = 0; r < REPEATS; r++) {
      tasks.push(
        limit(async () => {
          let attempt = 0;
          for (;;) {
            try {
              const res = await rateMessageIntents({
                queryText: q.queryText,
                prevQueryText: q.prevQueryText,
                prevResponseText: q.prevResponseText,
                intents,
                includeDissection: false,
                dissection: dissByMsg.get(q.messageId) ?? null,
                model,
                callOptions: { timeoutMs: 90_000, maxRetries: 3 },
              });
              const bucket = draws.get(q.messageId)![r];
              for (const it of intents) {
                const rr = res.ratings.get(it.id);
                if (rr) bucket.push({ intentId: it.id, rating: rr.rating, rationale: rr.rationale });
              }
              break;
            } catch (err) {
              if (++attempt >= 3) {
                console.error(`[stability] msg ${q.messageId} rep ${r} FAILED:`, String(err).slice(0, 160));
                break;
              }
            }
          }
          done++;
          if (done % 10 === 0 || done === totalCalls) console.error(`[stability] ${done}/${totalCalls} calls`);
        })
      );
    }
  }
  await Promise.all(tasks);

  // ---- Metrics ----
  // Per cell (query,intent): the K draws.
  interface Cell {
    messageId: number;
    intentId: number;
    code: string;
    label: string;
    typeKey: string;
    ratings: string[]; // length ≤ REPEATS (missing draws omitted)
    modal: string;
    modalAgreement: number; // maxCount / observed
    unanimous: boolean;
    includeFrac: number; // clearly_in count / observed
    decisionStable: boolean; // all-in or all-not-in on the clearly_in boundary
    ordinalSpread: number; // max ordinal index − min (0..3)
    distinct: number;
  }
  const cells: Cell[] = [];
  let missingDraws = 0;
  let totalCells = 0;

  const intentById = new Map(intents.map((i) => [i.id, i]));
  for (const q of sample) {
    const reps = draws.get(q.messageId)!;
    for (const it of intents) {
      totalCells++;
      const ratings: string[] = [];
      for (let r = 0; r < REPEATS; r++) {
        const hit = reps[r].find((d) => d.intentId === it.id);
        if (hit) ratings.push(hit.rating);
      }
      missingDraws += REPEATS - ratings.length;
      if (ratings.length === 0) continue;
      const counts = new Map<string, number>();
      for (const x of ratings) counts.set(x, (counts.get(x) ?? 0) + 1);
      let modal = ratings[0];
      let maxCount = 0;
      for (const [k, c] of counts) if (c > maxCount) { maxCount = c; modal = k; }
      const includeCount = ratings.filter((x) => x === 'clearly_in').length;
      const ords = ratings.map((x) => ORD[x] ?? 0);
      cells.push({
        messageId: q.messageId,
        intentId: it.id,
        code: it.code,
        label: it.label,
        typeKey: it.typeKey,
        ratings,
        modal,
        modalAgreement: maxCount / ratings.length,
        unanimous: counts.size === 1,
        includeFrac: includeCount / ratings.length,
        decisionStable: includeCount === 0 || includeCount === ratings.length,
        ordinalSpread: Math.max(...ords) - Math.min(...ords),
        distinct: counts.size,
      });
    }
  }

  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const usable = cells.filter((c) => c.ratings.length >= 2); // need ≥2 draws to judge stability

  const summary = {
    unanimityRate: mean(usable.map((c) => (c.unanimous ? 1 : 0))),
    meanModalAgreement: mean(usable.map((c) => c.modalAgreement)),
    decisionFlipRate: mean(usable.map((c) => (c.decisionStable ? 0 : 1))),
    spreadDist: [0, 1, 2, 3].map((s) => ({
      spread: s,
      frac: mean(usable.map((c) => (c.ordinalSpread === s ? 1 : 0))),
    })),
    krippendorffOrdinal: krippendorffAlphaOrdinal(usable.map((c) => c.ratings)),
    missingDraws,
    totalCells,
    usableCells: usable.length,
  };

  // Per-intent instability (mean modal agreement + flip rate), worst first.
  const byIntent = intents.map((it) => {
    const cs = usable.filter((c) => c.intentId === it.id);
    return {
      code: it.code,
      label: it.label,
      typeKey: it.typeKey,
      meanModalAgreement: mean(cs.map((c) => c.modalAgreement)),
      flipRate: mean(cs.map((c) => (c.decisionStable ? 0 : 1))),
      unanimityRate: mean(cs.map((c) => (c.unanimous ? 1 : 0))),
    };
  }).sort((a, b) => a.meanModalAgreement - b.meanModalAgreement);

  // Per-query instability.
  const byQuery = sample.map((q) => {
    const cs = usable.filter((c) => c.messageId === q.messageId);
    return {
      messageId: q.messageId,
      sessionId: q.sessionId,
      queryPreview: q.queryText.replace(/\s+/g, ' ').slice(0, 160),
      meanModalAgreement: mean(cs.map((c) => c.modalAgreement)),
      flippedCells: cs.filter((c) => !c.decisionStable).length,
      nonUnanimousCells: cs.filter((c) => !c.unanimous).length,
    };
  }).sort((a, b) => a.meanModalAgreement - b.meanModalAgreement);

  // The unstable cells that matter most: the include/exclude (clearly_in) flips.
  const flippedCells = usable
    .filter((c) => !c.decisionStable)
    .map((c) => {
      const q = sample.find((s) => s.messageId === c.messageId)!;
      // gather the varying rationales for this cell
      const rats: string[] = [];
      const reps = draws.get(c.messageId)!;
      for (let r = 0; r < REPEATS; r++) {
        const hit = reps[r].find((d) => d.intentId === c.intentId);
        if (hit) rats.push(`${hit.rating}: ${hit.rationale}`);
      }
      return {
        code: c.code,
        label: c.label,
        messageId: c.messageId,
        queryPreview: q.queryText.replace(/\s+/g, ' ').slice(0, 220),
        ratings: c.ratings,
        includeFrac: c.includeFrac,
        rationales: rats,
      };
    })
    .sort((a, b) => Math.abs(0.5 - a.includeFrac) - Math.abs(0.5 - b.includeFrac)); // most 50/50 first

  const out = {
    meta: {
      model,
      effort: process.env.SCORE_RATING_EFFORT?.trim() || 'low',
      assignment: NIRVANA_ASSIGNMENT,
      numQueries: sample.length,
      repeats: REPEATS,
      totalCalls,
      intents: intents.map((i) => ({ id: i.id, code: i.code, label: i.label, typeKey: i.typeKey })),
    },
    summary,
    byIntent,
    byQuery,
    flippedCells,
    cells,
    queries: sample.map((q) => ({
      messageId: q.messageId,
      sessionId: q.sessionId,
      queryText: q.queryText,
      prevQueryText: q.prevQueryText,
      prevResponseText: q.prevResponseText,
    })),
  };

  const { writeFileSync } = await import('fs');
  writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.error(`\n[stability] wrote ${OUT}`);
  console.error(
    `[stability] unanimity=${(summary.unanimityRate * 100).toFixed(1)}%  ` +
      `meanAgree=${(summary.meanModalAgreement * 100).toFixed(1)}%  ` +
      `decisionFlip=${(summary.decisionFlipRate * 100).toFixed(1)}%  ` +
      `alpha=${summary.krippendorffOrdinal.toFixed(3)}  missing=${summary.missingDraws}`
  );
  process.exit(0);
}

/**
 * Krippendorff's alpha, ordinal metric. units = list of rating arrays (the K
 * repeats per cell). Treats the repeats as coders. Values are the 4 ordinal
 * levels. Standard coincidence-matrix formulation.
 */
function krippendorffAlphaOrdinal(units: string[][]): number {
  const vals = LEVELS as readonly string[];
  const V = vals.length;
  const o = Array.from({ length: V }, () => new Array<number>(V).fill(0));
  for (const u of units) {
    const m = u.length;
    if (m < 2) continue;
    const idx = u.map((x) => vals.indexOf(x)).filter((i) => i >= 0);
    for (let a = 0; a < idx.length; a++) {
      for (let b = 0; b < idx.length; b++) {
        if (a === b) continue;
        o[idx[a]][idx[b]] += 1 / (m - 1);
      }
    }
  }
  const nv = o.map((row) => row.reduce((a, b) => a + b, 0)); // marginals
  const nTotal = nv.reduce((a, b) => a + b, 0);
  if (nTotal < 2) return NaN;

  // ordinal delta²(c,k) = ( sum_{g=c..k} n_g − (n_c+n_k)/2 )²
  const delta = (c: number, k: number): number => {
    if (c === k) return 0;
    const lo = Math.min(c, k);
    const hi = Math.max(c, k);
    let s = 0;
    for (let g = lo; g <= hi; g++) s += nv[g];
    s -= (nv[c] + nv[k]) / 2;
    return s * s;
  };

  let Do = 0;
  let De = 0;
  for (let c = 0; c < V; c++) {
    for (let k = c + 1; k < V; k++) {
      const d = delta(c, k);
      Do += o[c][k] * d;
      De += nv[c] * nv[k] * d;
    }
  }
  if (De === 0) return 1; // no expected disagreement (degenerate) → perfectly reliable
  return 1 - (nTotal - 1) * (Do / De);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
