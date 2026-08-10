/**
 * How much of the Jelson codebook actually survived into the system?
 *
 * docs/GPTWriting_fewshot_classifier.md is the document the NIRVANA human
 * coding was done against, so it is the standard the classifier is measured
 * by — every disagreement with the gold labels is, in the end, a disagreement
 * with this file. Two things were ported out of it and they drifted
 * differently:
 *
 *   subtypes → default-config.ts, where each heading became a `label` and the
 *              three few-shot examples were folded into `description` prose
 *   types    → type-prompts.ts, REWRITTEN for a forced 4-way choice rather
 *              than copied (the file says so), which is exactly where a
 *              faithful-looking port can quietly change what it asks for
 *
 * So this checks the mechanical part mechanically — all 26 codes, all 78
 * examples, present or not — and prints the type texts side by side for the
 * judgement part, rather than pretending prose equivalence can be diffed.
 *
 *   npx tsx --env-file=.env scripts/study/check-codebook-fidelity.ts
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_SCORE_CONFIG } from '../../src/lib/score/default-config';
import { TYPE_DEFINITIONS } from '../../src/lib/score/type-prompts';
import { flattenSubtypes } from '../../src/lib/score/config';
import { jelsonToIntent, buildJelsonSuggestions } from '../../src/lib/score/jelson-suggest';
import { SCORE_QUERY_TYPES, type ScoreQueryType } from '../../src/lib/score/intents';

const TYPE_OF_PREFIX: Record<string, ScoreQueryType> = {
  PL: 'planning', TR: 'translating', RE: 'reviewing', AL: 'drafting',
};

/** Loose enough to survive the port's own edits (quotes, trailing period,
 * "[prompt]" placeholders) but not so loose it calls a rewrite a match. */
const key = (s: string) =>
  s.toLowerCase().replace(/\[[^\]]*\]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

interface Entry { code: string; heading: string; examples: string[]; type: ScoreQueryType }

function parseCodebook(md: string): { entries: Entry[]; typeBlurb: Record<string, string> } {
  const entries: Entry[] = [];
  const typeBlurb: Record<string, string> = {};
  let currentType = '';
  let current: Entry | null = null;
  for (const raw of md.split('\n')) {
    const line = raw.trim();
    const h2 = line.match(/^## (.+)$/);
    if (h2) { currentType = h2[1].trim(); current = null; continue; }
    const blurb = line.match(/^\*(.+)\*$/);
    if (blurb && currentType && !typeBlurb[currentType]) { typeBlurb[currentType] = blurb[1].trim(); continue; }
    const h3 = line.match(/^### ([A-Z]{2}\d{2})\s*[—-]\s*(.+)$/);
    if (h3) {
      current = { code: h3[1], heading: h3[2].trim(), examples: [], type: TYPE_OF_PREFIX[h3[1].slice(0, 2)] };
      entries.push(current);
      continue;
    }
    const bullet = line.match(/^-\s+(.+)$/);
    if (bullet && current) current.examples.push(bullet[1].trim());
  }
  return { entries, typeBlurb };
}

async function main() {
  const md = readFileSync(path.join(process.cwd(), 'docs/GPTWriting_fewshot_classifier.md'), 'utf8');
  const { entries, typeBlurb } = parseCodebook(md);
  const flat = flattenSubtypes(DEFAULT_SCORE_CONFIG).map((r) => ({ ...r.subtype, typeKey: r.type.key }));
  const byCode = new Map(flat.map((s) => [s.code.toUpperCase(), s]));
  const judged = new Map(
    buildJelsonSuggestions(DEFAULT_SCORE_CONFIG).map((s) => [s.code.toUpperCase(), jelsonToIntent(s).definition])
  );

  console.log(`codebook: ${entries.length} codes, ${entries.reduce((n, e) => n + e.examples.length, 0)} examples`);
  console.log(`config  : ${flat.length} subtypes\n`);

  /* ── subtype coverage ── */
  const missingCode: string[] = [];
  const labelDrift: { code: string; book: string; cfg: string }[] = [];
  const missingEx: { code: string; label: string; ex: string }[] = [];
  const typeDrift: { code: string; book: ScoreQueryType; cfg: string }[] = [];

  for (const e of entries) {
    const s = byCode.get(e.code);
    if (!s) { missingCode.push(e.code); continue; }
    if (key(s.label) !== key(e.heading)) labelDrift.push({ code: e.code, book: e.heading, cfg: s.label });
    const cfgType = TYPE_OF_PREFIX[e.code.slice(0, 2)];
    const seen = key(judged.get(e.code) ?? s.description);
    for (const ex of e.examples) if (!seen.includes(key(ex))) missingEx.push({ code: e.code, label: s.label, ex });
    void cfgType; void typeDrift;
  }
  const extra = flat.filter((s) => !entries.some((e) => e.code === s.code.toUpperCase()));

  const totalEx = entries.reduce((n, e) => n + e.examples.length, 0);
  console.log('════ SUBTYPES ════');
  console.log(`codes present          ${entries.length - missingCode.length}/${entries.length}${missingCode.length ? `  MISSING ${missingCode.join(', ')}` : ''}`);
  console.log(`codes not in codebook  ${extra.length}${extra.length ? `  (${extra.map((s) => s.code).join(', ')})` : ''}`);
  console.log(`examples carried over  ${totalEx - missingEx.length}/${totalEx}  (${(((totalEx - missingEx.length) / totalEx) * 100).toFixed(1)}%)`);
  console.log(`labels reworded        ${labelDrift.length}/${entries.length}`);

  if (labelDrift.length) {
    console.log('\n  label rewordings (cosmetic unless the meaning moved):');
    for (const d of labelDrift) console.log(`    ${d.code}  "${d.book}"  →  "${d.cfg}"`);
  }
  if (missingEx.length) {
    console.log('\n  EXAMPLES DROPPED — these are the few-shot anchors the coder used:');
    for (const m of missingEx) console.log(`    ${m.code} ${m.label}\n        "${m.ex}"`);
  }

  /* ── type level ── */
  console.log('\n════ TYPES ════');
  const BOOK_TYPE: Record<ScoreQueryType, string> = {
    planning: typeBlurb['Planning'] ?? '', translating: typeBlurb['Translating'] ?? '',
    reviewing: typeBlurb['Reviewing'] ?? '', drafting: typeBlurb['All'] ?? '',
  };
  for (const t of SCORE_QUERY_TYPES) {
    const codes = entries.filter((e) => e.type === t).map((e) => e.code);
    console.log(`\n── ${t}  (codebook: ${codes[0]}–${codes[codes.length - 1]}, ${codes.length} codes)`);
    console.log(`   codebook : ${BOOK_TYPE[t]}`);
    console.log(`   shipped  : ${TYPE_DEFINITIONS[t]}`);
  }

  /* ── the scale seam, since that is where the eval said it breaks ── */
  console.log('\n════ WHERE "A PARAGRAPH" LANDS ════');
  const paraCodes = entries.filter((e) => /paragraph|introduction|conclusion|portion|section/i.test(e.heading + ' ' + e.examples.join(' ')));
  for (const e of paraCodes) {
    console.log(`  ${e.code} [${e.type.padEnd(11)}] ${e.heading}`);
    for (const ex of e.examples.filter((x) => /paragraph|intro|conclusion/i.test(x))) {
      console.log(`        · ${ex.slice(0, 96)}`);
    }
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
