/**
 * v7 TYPE classifier × material RENDERING — read-only A/B/C against the human
 * gold labels (docs/SCORE_v7_type_eval.md is the methodology this must stay
 * comparable to).
 *
 * The question: the rating judge already collapses each pasted run into the
 * marker the instructor sees ([OWN DRAFT · 390 words · 100% ▸ …], MATERIAL_
 * PROMPT_MODE='abridged'). The TYPE classifier still gets the paste verbatim.
 * Does collapsing it help, hurt, or do nothing to the type gate?
 *
 * ARMS — same 4-way forced choice, same schema, same model/effort, same prior
 * turn, same dissection preamble. The ONLY difference is how the pasted runs of
 * the student message are rendered:
 *   verbatim  → the message exactly as shipped today (buildQueryContent's output,
 *               byte for byte: buildQueryContentForExperiment with a null body
 *               is assembleQueryContent with no substitution). The instructor
 *               batch — the path that actually writes score_query_types — passes
 *               the dissection, so this arm passes it too; it is type-eval.ts's
 *               `with` arm, NOT its `without` arm.
 *   metadata  → every located material run replaced, in place, by its TAG ALONE
 *               ("[OWN DRAFT · 390 words · 100%]"). No excerpt anywhere.
 *   abridged  → tag + head/tail excerpt ("[OWN DRAFT · 390 words · 100% ▸ The
 *               utilization of … in the cockpit.]"), except assignment_prompt
 *               runs, which are tag-only by construction (prompts.ts).
 *
 * READ-ONLY. This script never writes score_query_types or any other table — it
 * calls the model and scores in memory. It reaches buildQueryContentForExperiment,
 * which exists for exactly this and is called from nowhere under src/.
 *
 *   npx tsx --env-file=.env scripts/score/type-material-eval.ts <out.json> [nQueries] [arm] [--repeat=N]
 *     arm: all (default) | verbatim | metadata | abridged | render
 *     render = DRY smoke mode: builds all three renderings and prints examples,
 *              makes ZERO model calls.
 *     --repeat=N runs the WHOLE eval N times on the SAME inputs and reports the
 *              mean and min/max spread per arm, so an arm gap can be read against
 *              run-to-run variance rather than assumed to exceed it.
 *
 * Comparison points (docs/SCORE_v7_type_eval.md §1 v2 table, same 331 rows):
 *   with dissection 78.5% / κ0.697   ·   without dissection 79.5% / κ0.708
 */
import { readFileSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ReasoningEffort } from '../../src/lib/score/classifier';
import type { MaterialKind, PromptDissection, ScoreQueryType } from '../../src/lib/score/intents';

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

// Flags are pulled out first so --repeat may sit anywhere in the line.
const FLAGS = process.argv.slice(2).filter((a) => a.startsWith('--'));
const POSITIONAL = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const OUT = POSITIONAL[0] ?? 'type-material-eval.json';
const N = Number.parseInt(POSITIONAL[1] ?? '', 10);
type Arm = 'verbatim' | 'metadata' | 'abridged';
const ALL_ARMS: Arm[] = ['verbatim', 'metadata', 'abridged'];
const ARM_ARG = POSITIONAL[2] ?? 'all';
const DRY = ARM_ARG === 'render';
const REPEAT_ARG = Number.parseInt(
  FLAGS.find((f) => f.startsWith('--repeat='))?.slice('--repeat='.length) ?? '',
  10
);
const REPEATS = Number.isFinite(REPEAT_ARG) && REPEAT_ARG > 0 ? REPEAT_ARG : 1;

/**
 * Reasoning effort. Pinned to 'low' — the setting docs/SCORE_v7_type_eval.md
 * reports for every number in it — and deliberately NOT read from
 * SCORE_RATING_EFFORT, which .env currently sets to 'none'. Overridable only via
 * TYPE_EVAL_EFFORT, and always echoed into the output JSON.
 */
const EFFORT_VALUES: readonly string[] = ['none', 'low', 'medium', 'high', 'xhigh'];
const EFFORT: ReasoningEffort = EFFORT_VALUES.includes(process.env.TYPE_EVAL_EFFORT ?? '')
  ? (process.env.TYPE_EVAL_EFFORT as ReasoningEffort)
  : 'low';

/** Same call budget classifyMessageType uses, so the instrument matches. */
const CALL_OPTIONS = { timeoutMs: 60_000, maxRetries: 2 };
const CONCURRENCY = 10;

/** Code prefix → v7 query type. 'AL' is the old "All", now 'drafting'. */
const PREFIX_TO_TYPE: Record<string, ScoreQueryType> = {
  PL: 'planning',
  TR: 'translating',
  RE: 'reviewing',
  AL: 'drafting',
};

/* ------------------------------------------------------------------ */
/* Material notation for the TYPE system prompt (arms 2 and 3 ONLY)     */
/* ------------------------------------------------------------------ */

/**
 * A LOCAL copy of intent-prompts.ts's MATERIAL_NOTATION, appended to the type
 * system prompt for the metadata and abridged arms. Two reasons it is copied
 * rather than imported: that constant is not exported, and it is written for the
 * intent judge ("what you rate") — the two clauses that say so are reworded to
 * classification language here, and nothing else is changed.
 *
 * ⚠️ ARM 1 (verbatim) GETS THE UNMODIFIED buildTypeSystemPrompt() — no notation
 * appended, because there are no markers in its user message to explain. That is
 * the shipped prompt byte for byte.
 *
 * The metadata arm gets a variant with every excerpt clause removed — the
 * "after the ▸ …" sentence, the "runs shorter than 40 words" sentence, and the
 * "including from text inside an excerpt" tail of the no-inferred-request
 * bullet. Its markers carry no excerpt at all, so describing one is a
 * handicap: the model would be reconciling a legend against a notation it
 * never sees, and any accuracy that cost would be charged to the hypothesis
 * instead of to the prompt. Everything else (KIND meanings, the
 * [ASSIGNMENT PROMPT · P%] bullet, the seam-fragment bullet, the
 * referential-ask bullet) is kept identical, so the two arms differ only where
 * the rendering differs.
 *
 * Enforced, not trusted: the ASSERTION block in main() hard-fails the run if a
 * single ▸ survives anywhere in an arm-2 prompt, system or user.
 */
const NOTATION_ABRIDGED = `MATERIAL NOTATION — every run of PASTED text in the student message has been replaced, in place, by a bracketed marker: [KIND · extent ▸ excerpt]. KIND is the source it was pasted from; extent is its size in words and/or how much of that source it covers as a percentage; after the ▸ is the pasted text itself, ABRIDGED (… marks removed text). Runs shorter than 40 words are shown in full.
- [ASSIGNMENT PROMPT · P%] carries NO excerpt. The assignment prompt is the same text for every student and is never part of what this student is asking for; P% is how much of it they pasted.
- A part is absent when it is unknown — an external paste has no source on record and so carries no percentage.
- KIND is one of: OWN DRAFT (the student's own essay text), ASSIGNMENT PROMPT, BOT REPLY (a previous chatbot answer pasted back), OWN QUESTION (one of the student's own earlier chat turns), OTHER SOURCE. "PASTED MATERIAL", or two names joined by "/", means the run's source could not be attributed.
- Everything OUTSIDE the markers is what the student typed in this message. That, and only that, is what you classify.
- A marker is never a request, and no request may be inferred from one — including from text inside an excerpt.
- The split is machine-made and errs at the seams: a short fragment of prose sitting immediately beside a marker ("dumber.", "future.", "that make us human.", "jobs that") is a piece of the pasted run the split left behind, not an instruction. Judge it as a fragment, not as an ask.
- A short referential ask beside a marker ("are these good", "is this better", "how is this paragraph") refers to that marker. Read it as an ask about material of that KIND and that size.`;

const NOTATION_METADATA = `MATERIAL NOTATION — every run of PASTED text in the student message has been replaced, in place, by a bracketed marker: [KIND · extent]. KIND is the source it was pasted from; extent is its size in words and/or how much of that source it covers as a percentage. The pasted text itself is NOT shown — the marker is all there is of it.
- [ASSIGNMENT PROMPT · P%] is the assignment prompt, the same text for every student and never part of what this student is asking for; P% is how much of it they pasted.
- A part is absent when it is unknown — an external paste has no source on record and so carries no percentage.
- KIND is one of: OWN DRAFT (the student's own essay text), ASSIGNMENT PROMPT, BOT REPLY (a previous chatbot answer pasted back), OWN QUESTION (one of the student's own earlier chat turns), OTHER SOURCE. "PASTED MATERIAL", or two names joined by "/", means the run's source could not be attributed.
- Everything OUTSIDE the markers is what the student typed in this message. That, and only that, is what you classify.
- A marker is never a request, and no request may be inferred from one.
- The split is machine-made and errs at the seams: a short fragment of prose sitting immediately beside a marker ("dumber.", "future.", "that make us human.", "jobs that") is a piece of the pasted run the split left behind, not an instruction. Judge it as a fragment, not as an ask.
- A short referential ask beside a marker ("are these good", "is this better", "how is this paragraph") refers to that marker. Read it as an ask about material of that KIND and that size.`;

/** The excerpt marker itself — the one character that must never reach arm 2. */
const EXCERPT_SIGIL = '▸';

/**
 * The dissection preamble is built inside src/lib/score/prompts.ts, which this
 * experiment may not edit, and it describes the marker as
 * "[KIND · extent ▸ …]" for BOTH abridged bodies. Arm 2's markers are tag-only,
 * so the sentence is rewritten HERE, on the returned string, to describe what
 * arm 2 actually sends.
 *
 * A literal replacement rather than a regex over "▸": if prompts.ts reworks that
 * sentence this stops matching, and the assertion below then fails the run
 * loudly instead of letting a stale legend ship into a measurement.
 */
const PREAMBLE_WITH_EXCERPT = 'by a [KIND · extent ▸ …] marker';
const PREAMBLE_TAG_ONLY = 'by a [KIND · extent] marker';
function metadataPreamble(content: string): string {
  return content.split(PREAMBLE_WITH_EXCERPT).join(PREAMBLE_TAG_ONLY);
}

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

interface Scored {
  n: number;
  accuracy: number;
  kappa: number;
  confusion: Record<string, Record<string, number>>;
  recall: Record<string, { hit: number; of: number; rate: number }>;
}

/** Accuracy + Cohen's kappa + the 4×4 confusion matrix over human-coded rows.
 * Lifted from type-eval.ts so the numbers are produced by the same arithmetic. */
function scoreArm(
  types: readonly ScoreQueryType[],
  rows: { messageId: number; goldType: ScoreQueryType }[],
  predicted: Map<number, ScoreQueryType | null>
): Scored {
  const confusion: Record<string, Record<string, number>> = {};
  for (const a of types) confusion[a] = Object.fromEntries(types.map((b) => [b, 0]));
  let agree = 0;
  let scored = 0;
  for (const r of rows) {
    const pred = predicted.get(r.messageId);
    if (!pred) continue;
    scored++;
    confusion[r.goldType][pred] += 1;
    if (pred === r.goldType) agree++;
  }
  const po = scored > 0 ? agree / scored : 0;
  let pe = 0;
  for (const t of types) {
    const goldN = types.reduce((n, b) => n + confusion[t][b], 0);
    const predN = types.reduce((n, a) => n + confusion[a][t], 0);
    pe += (goldN / (scored || 1)) * (predN / (scored || 1));
  }
  const kappa = pe < 1 ? (po - pe) / (1 - pe) : 0;
  const recall: Record<string, { hit: number; of: number; rate: number }> = {};
  for (const t of types) {
    const of = types.reduce((n, b) => n + confusion[t][b], 0);
    recall[t] = { hit: confusion[t][t], of, rate: of ? confusion[t][t] / of : 0 };
  }
  return { n: scored, accuracy: po, kappa, confusion, recall };
}

/** The confusion matrix laid out like docs/SCORE_v7_type_eval.md §2, so a result
 * can be pasted straight under the numbers it is meant to be compared with. */
function printMatrix(types: readonly ScoreQueryType[], s: Scored): void {
  const w = (t: string) => t.length + 2;
  console.error(
    'gold \\ pred'.padEnd(14) + types.map((t) => t.padStart(w(t))).join('') + 'recall'.padStart(9)
  );
  for (const t of types) {
    const r = s.recall[t];
    console.error(
      t.padEnd(14) +
        types.map((b) => String(s.confusion[t][b]).padStart(w(b))).join('') +
        `${(r.rate * 100).toFixed(0)}%`.padStart(9)
    );
  }
}

async function main(): Promise<void> {
  const { db } = await import('../../src/db/db');
  const { assignments } = await import('../../src/db/schema');
  const { eq } = await import('drizzle-orm');
  const { ensureScoreTable, getQueryRecords } = await import('../../src/lib/score/queries');
  const { ensureIntentTables } = await import('../../src/lib/score/intent-store');
  const { computeDissections } = await import('../../src/lib/score/dissect');
  const { createLimiter } = await import('../../src/lib/score/limiter');
  const { getDefaultScoreModel } = await import('../../src/lib/score/models');
  const { callModel, extractJsonObject, isOpenAIConfigured } = await import(
    '../../src/lib/score/classifier'
  );
  const { buildTypeSchema, buildTypeSystemPrompt } = await import(
    '../../src/lib/score/type-prompts'
  );
  const { abridgeQuery, buildQueryContentForExperiment } = await import(
    '../../src/lib/score/prompts'
  );
  const { MATERIAL_PROMPT_MODE, SCORE_QUERY_TYPES, isScoreQueryType } = await import(
    '../../src/lib/score/intents'
  );

  if (!DRY && !isOpenAIConfigured()) throw new Error('OPENAI_API_KEY is not configured.');
  await Promise.all([ensureScoreTable(), ensureIntentTables()]);

  // Resolve NIRVANA by share token — a re-import mints a fresh assignment id.
  // The gold CSV joins to THIS assignment's log and no other.
  const rows = await db
    .select({ id: assignments.id })
    .from(assignments)
    .where(eq(assignments.shareToken, 'nirvana-dataset'));
  if (!rows[0]) throw new Error('NIRVANA dataset not found (shareToken=nirvana-dataset)');
  const assignmentId = rows[0].id;

  // --- gold ---------------------------------------------------------------
  const csv = parseCsv(
    readFileSync(path.join(process.cwd(), 'nirvana/GPTWriting_recoded.csv'), 'utf8')
  );
  const header = csv[0].map((h) => h.replace(/^﻿/, '').trim());
  const iInquiry = header.indexOf('Inquiry');
  const iCode = header.indexOf('Code');
  const gold = csv
    .slice(1)
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

  const paired: {
    rec: (typeof records)[number];
    goldType: ScoreQueryType | null;
    goldCode: string;
  }[] = [];
  let unmatched = 0;
  for (const g of gold) {
    const rec = take(g.inquiry);
    if (!rec) {
      unmatched++;
      continue;
    }
    const prefix = g.code.slice(0, 2).toUpperCase();
    paired.push({ rec, goldType: PREFIX_TO_TYPE[prefix] ?? null, goldCode: g.code });
  }
  // Deterministic order so two runs (and two arms) see the same messages in the
  // same sequence, and `nQueries` always slices the same prefix.
  paired.sort((a, b) => a.rec.messageId - b.rec.messageId);
  const sample = Number.isFinite(N) && N > 0 ? paired.slice(0, N) : paired;
  const coded = sample.filter((p) => p.goldType !== null);
  console.error(
    `gold ${gold.length} · joined ${paired.length} (unmatched ${unmatched}) · evaluating ${sample.length} (${coded.length} human-coded, ${sample.length - coded.length} uncoded)`
  );

  // --- dissections + the three renderings ----------------------------------
  const dissections = await computeDissections(
    assignmentId,
    new Set(sample.map((p) => p.rec.messageId))
  );

  interface Row {
    messageId: number;
    goldType: ScoreQueryType | null;
    goldCode: string;
    dissection: PromptDissection | null;
    materialKinds: MaterialKind[];
    /** abridgeQuery could not locate a material run → all three arms are the
     * same string by construction, so this message can say nothing about the
     * question and is reported separately. */
    fellBack: boolean;
    /** The two marker arms render this message's MARKERS differently — i.e. at
     * least one run carries an excerpt in arm 3. False for assignment-prompt-only
     * messages, where arm 3 is tag-only by construction. Compared on the bodies,
     * not the full content: since arm 2's preamble is rewritten, the full strings
     * always differ and would say nothing. */
    excerptDiffers: boolean;
    content: Record<Arm, string>;
    /** The student's own text carries a ▸ — vanishingly rare, but it would make
     * the arm-2 assertion fire on something that is not our doing. */
    sigilInSource: boolean;
  }

  const rowsById: Row[] = sample.map((p) => {
    const d = dissections.get(p.rec.messageId) ?? null;
    const metaBody = abridgeQuery(p.rec.queryText, d, { excerpts: false });
    const abridgedBody = abridgeQuery(p.rec.queryText, d, { excerpts: true });
    const build = (body: string | null) =>
      buildQueryContentForExperiment(
        p.rec.queryText,
        p.rec.prevQueryText,
        p.rec.prevResponseText,
        d,
        body
      );
    return {
      messageId: p.rec.messageId,
      goldType: p.goldType,
      goldCode: p.goldCode,
      dissection: d,
      materialKinds: d?.materialKinds ?? [],
      fellBack: metaBody === null || abridgedBody === null,
      excerptDiffers: metaBody !== null && abridgedBody !== null && metaBody !== abridgedBody,
      content: {
        // Arm 1 is buildQueryContent's exact output: a null body means no
        // substitution anywhere and the verbatim dissection preamble.
        verbatim: build(null),
        // Arm 2's preamble is rewritten to describe tag-only markers — see
        // metadataPreamble. Without it the legend would promise an excerpt
        // notation this arm never uses.
        metadata: metadataPreamble(build(metaBody)),
        abridged: build(abridgedBody),
      },
      sigilInSource: [p.rec.queryText, p.rec.prevQueryText, p.rec.prevResponseText].some(
        (t) => t?.includes(EXCERPT_SIGIL) ?? false
      ),
    };
  });
  const withMaterial = rowsById.filter((r) => r.materialKinds.length > 0);
  const fellBack = rowsById.filter((r) => r.fellBack);
  const codedRows = rowsById.filter(
    (r): r is Row & { goldType: ScoreQueryType } => r.goldType !== null
  );
  const codedMaterial = codedRows.filter((r) => r.materialKinds.length > 0);
  const codedFellBack = codedRows.filter((r) => r.fellBack);
  console.error(
    `dissection: ${withMaterial.length}/${rowsById.length} carry material · ` +
      `${fellBack.length} fell back to verbatim (no run located) · ` +
      `human-coded WITH material: ${codedMaterial.length}/${codedRows.length}`
  );
  const differing = rowsById.filter(
    (r) => r.content.verbatim !== r.content.metadata || r.content.metadata !== r.content.abridged
  );
  console.error(
    `renderings actually differ on ${differing.length}/${rowsById.length} messages ` +
      `(arm2 markers ≠ arm3 markers on ${rowsById.filter((r) => r.excerptDiffers).length} — ` +
      `the rest are assignment-prompt-only runs, tag-only in BOTH marker arms)`
  );

  const systemPromptFor = (arm: Arm) =>
    // ARM 1 GETS THE UNMODIFIED SHIPPED SYSTEM PROMPT. The other two need the
    // legend for the markers their user message now contains.
    arm === 'verbatim'
      ? buildTypeSystemPrompt()
      : `${buildTypeSystemPrompt()}\n\n${arm === 'metadata' ? NOTATION_METADATA : NOTATION_ABRIDGED}`;

  // --- ASSERTION: arm 2 must be free of the excerpt notation ---------------
  // Runs BEFORE any model call, in dry mode too. A surviving ▸ means arm 2 was
  // told to read a notation it never receives, which would cost it accuracy for
  // a reason that has nothing to do with the hypothesis — so the run dies here
  // rather than producing a number that looks like evidence.
  const metadataSystem = systemPromptFor('metadata');
  const sigilRows = rowsById.filter(
    (r) => r.content.metadata.includes(EXCERPT_SIGIL) && !r.sigilInSource
  );
  const sourceSigilRows = rowsById.filter((r) => r.sigilInSource);
  const systemHasSigil = metadataSystem.includes(EXCERPT_SIGIL);
  console.error(
    `\nASSERTION — no "${EXCERPT_SIGIL}" in any arm-2 prompt: ` +
      `${!systemHasSigil && sigilRows.length === 0 ? 'PASS' : 'FAIL'} ` +
      `(system prompt: ${systemHasSigil ? 'CONTAINS ▸' : 'clean'} · ` +
      `user messages: ${rowsById.length - sigilRows.length}/${rowsById.length} clean · ` +
      `${sourceSigilRows.length} message(s) carry ▸ in the student's own text, exempt)`
  );
  if (systemHasSigil || sigilRows.length > 0) {
    throw new Error(
      `arm 2 (metadata) prompt still contains "${EXCERPT_SIGIL}": ` +
        `system=${systemHasSigil}, user messages=${sigilRows.length} ` +
        `(first: message ${sigilRows[0]?.messageId ?? 'n/a'}). ` +
        'PREAMBLE_WITH_EXCERPT probably no longer matches prompts.ts.'
    );
  }

  // --- DRY smoke mode: show the three renderings, call nothing -------------
  // One example of each shape: a run that carries an excerpt (metadata ≠
  // abridged) and an assignment-prompt-only run (metadata = abridged by
  // construction — the prompt never gets an excerpt).
  const examples = [
    differing.find((r) => r.excerptDiffers),
    differing.find((r) => !r.excerptDiffers),
  ]
    .filter((r): r is Row => r != null)
    .map((r) => ({
      messageId: r.messageId,
      goldCode: r.goldCode,
      materialKinds: r.materialKinds,
      excerptsDiffer: r.excerptDiffers,
      content: r.content,
    }));
  if (DRY) {
    for (const ex of examples) {
      for (const arm of ALL_ARMS) {
        console.error(
          `\n================ ${arm.toUpperCase()} · message ${ex.messageId} (${ex.goldCode}) ` +
            `${ex.content[arm].length} chars ================\n${ex.content[arm]}`
        );
      }
      console.error(
        `\n================ SYSTEM PROMPT SUFFIX ================\n` +
          `verbatim: unmodified buildTypeSystemPrompt() (${buildTypeSystemPrompt().length} chars)\n` +
          `metadata: + NOTATION_METADATA (${NOTATION_METADATA.length} chars)\n` +
          `abridged: + NOTATION_ABRIDGED (${NOTATION_ABRIDGED.length} chars)`
      );
    }
    // The whole of what arm 2 sends for the first example — system AND user —
    // so the legend can be read against the markers it describes.
    const ex = examples[0];
    if (ex) {
      console.error(
        `\n\n#################### ARM 2 (metadata) FULL PROMPT · message ${ex.messageId} ####################\n` +
          `-------- SYSTEM (${metadataSystem.length} chars) --------\n${metadataSystem}\n\n` +
          `-------- USER (${ex.content.metadata.length} chars) --------\n${ex.content.metadata}`
      );
    }
    // Which lines of the legend differ between the two marker arms.
    const metaLines = NOTATION_METADATA.split('\n');
    const abrLines = NOTATION_ABRIDGED.split('\n');
    console.error('\n\n#################### SYSTEM PROMPT DIFF · arm 2 vs arm 3 ####################');
    console.error('(shared base: buildTypeSystemPrompt(); only the notation block differs)');
    for (const line of metaLines) {
      if (!abrLines.includes(line)) console.error(`- [arm2 only] ${line}`);
    }
    for (const line of abrLines) {
      if (!metaLines.includes(line)) console.error(`+ [arm3 only] ${line}`);
    }
    console.error(
      `(identical lines: ${metaLines.filter((l) => abrLines.includes(l)).length}/${metaLines.length})`
    );
    writeFileSync(
      OUT,
      JSON.stringify(
        {
          dryRun: true,
          assignmentId,
          gold: gold.length,
          joined: paired.length,
          unmatched,
          sample: sample.length,
          coded: codedRows.length,
          withMaterial: withMaterial.length,
          codedWithMaterial: codedMaterial.length,
          fellBack: fellBack.length,
          differingRenderings: differing.length,
          markersDifferArm2vs3: rowsById.filter((r) => r.excerptDiffers).length,
          examples,
        },
        null,
        2
      )
    );
    console.error(`\nwrote ${OUT} (dry run — no model calls)`);
    return;
  }

  // --- the arms ------------------------------------------------------------
  const model = getDefaultScoreModel();
  const arms: Arm[] =
    ARM_ARG === 'all' ? ALL_ARMS : ALL_ARMS.includes(ARM_ARG as Arm) ? [ARM_ARG as Arm] : ALL_ARMS;
  console.error(
    `model=${model} effort=${EFFORT} arms=${arms.join(',')} repeats=${REPEATS} ` +
      `(${REPEATS * arms.length * rowsById.length} calls)`
  );

  // --- PAIRED comparison vs verbatim — the number that decides this ---------
  interface Paired {
    n: number;
    changed: number;
    fixes: number;
    breaks: number;
    neutral: number;
    net: number;
  }
  const pairedOn = (
    subset: (Row & { goldType: ScoreQueryType })[],
    base: Map<number, ScoreQueryType | null>,
    other: Map<number, ScoreQueryType | null>
  ): Paired => {
    let n = 0;
    let changed = 0;
    let fixes = 0;
    let breaks = 0;
    let neutral = 0;
    for (const r of subset) {
      const a = base.get(r.messageId);
      const b = other.get(r.messageId);
      if (!a || !b) continue; // only messages BOTH arms answered
      n++;
      if (a === b) continue;
      changed++;
      if (b === r.goldType) fixes++;
      else if (a === r.goldType) breaks++;
      else neutral++;
    }
    return { n, changed, fixes, breaks, neutral, net: fixes - breaks };
  };

  interface RepeatOutcome {
    repeat: number;
    results: Record<string, unknown>;
    paired: Record<string, unknown>;
    errors: Record<string, number>;
    /** Per arm, the two headline rates — the series the spread is taken over. */
    summary: Record<string, { accuracy: number; kappa: number; materialAccuracy: number }>;
    /** Per non-verbatim arm, the paired NET on the material-only subset. */
    materialNet: Record<string, number>;
    perMessage: unknown[];
  }

  /** One complete pass over every arm. Called REPEATS times on the SAME inputs,
   * so the only thing that varies between passes is the model. */
  async function runOnce(rep: number): Promise<RepeatOutcome> {
    const tag = REPEATS > 1 ? `r${rep} ` : '';
    const predictions = new Map<Arm, Map<number, ScoreQueryType | null>>();
    const rationales = new Map<Arm, Map<number, string>>();
    const errors: Record<string, number> = {};
    const results: Record<string, unknown> = {};
    const summary: RepeatOutcome['summary'] = {};

    for (const arm of arms) {
      const system = systemPromptFor(arm);
      const schema = { name: 'query_type', schema: buildTypeSchema() as Record<string, unknown> };
      const limit = createLimiter(CONCURRENCY);
      const predicted = new Map<number, ScoreQueryType | null>();
      const rationale = new Map<number, string>();
      let done = 0;
      let failed = 0;
      await Promise.all(
        rowsById.map((r) =>
          limit(async () => {
            try {
              const raw = await callModel(
                system,
                r.content[arm],
                model,
                EFFORT,
                schema,
                CALL_OPTIONS
              );
              const parsed = extractJsonObject(raw);
              predicted.set(r.messageId, isScoreQueryType(parsed.type) ? parsed.type : null);
              if (typeof parsed.rationale === 'string') {
                rationale.set(r.messageId, parsed.rationale.trim());
              }
            } catch (error) {
              // One dead call must not kill a three-arm run; the row is left
              // unpredicted and excluded from every count (never guessed).
              failed++;
              predicted.set(r.messageId, null);
              console.error(`  [${tag}${arm}] message ${r.messageId} failed: ${String(error)}`);
            }
            done++;
            if (done % 25 === 0) console.error(`  [${tag}${arm}] ${done}/${rowsById.length}`);
          })
        )
      );
      predictions.set(arm, predicted);
      rationales.set(arm, rationale);
      errors[arm] = failed;

      const overall = scoreArm(SCORE_QUERY_TYPES, codedRows, predicted);
      const material = scoreArm(SCORE_QUERY_TYPES, codedMaterial, predicted);

      // Where the uncoded rows landed — reported, never scored (the forced 4-way
      // choice has no "none" to answer with).
      const uncodedDist: Record<string, number> = {};
      for (const r of rowsById) {
        if (r.goldType !== null) continue;
        uncodedDist[predicted.get(r.messageId) ?? 'none'] = (uncodedDist[predicted.get(r.messageId) ?? 'none'] ?? 0) + 1;
      }

      results[arm] = { overall, material, uncodedDist, failed };
      summary[arm] = {
        accuracy: overall.accuracy,
        kappa: overall.kappa,
        materialAccuracy: material.accuracy,
      };
      console.error(
        `\n[${tag}${arm}] n=${overall.n} accuracy=${(overall.accuracy * 100).toFixed(1)}% kappa=${overall.kappa.toFixed(3)}${failed ? ` (${failed} call failures)` : ''}`
      );
      printMatrix(SCORE_QUERY_TYPES, overall);
      console.error(
        `  recall: ${SCORE_QUERY_TYPES.map((t) => `${t} ${overall.recall[t].hit}/${overall.recall[t].of}`).join(' · ')}`
      );
      console.error(
        `  MATERIAL-ONLY subset: n=${material.n} accuracy=${(material.accuracy * 100).toFixed(1)}% kappa=${material.kappa.toFixed(3)}`
      );
      console.error(`  uncoded rows landed: ${JSON.stringify(uncodedDist)}`);
    }

    const pairedResults: Record<string, unknown> = {};
    const materialNet: Record<string, number> = {};
    const basePred = predictions.get('verbatim');
    if (basePred) {
      console.error(`\n=== ${tag}PAIRED vs verbatim (same messages, same gold) ===`);
      for (const arm of arms) {
        if (arm === 'verbatim') continue;
        const other = predictions.get(arm)!;
        const all = pairedOn(codedRows, basePred, other);
        const noFallback = pairedOn(
          codedRows.filter((r) => !r.fellBack),
          basePred,
          other
        );
        const material = pairedOn(codedMaterial, basePred, other);
        const materialNoFallback = pairedOn(
          codedMaterial.filter((r) => !r.fellBack),
          basePred,
          other
        );
        // NOISE FLOOR, free: on fallback rows the two arms sent BYTE-IDENTICAL
        // user content, so every change here is model nondeterminism. Any effect
        // claimed on the material rows has to clear this rate.
        const noiseFloor = pairedOn(codedFellBack, basePred, other);
        // Changes on the rows with no human code — not scoreable, shown so a big
        // behavioural shift there is not invisible.
        let uncodedChanged = 0;
        for (const r of rowsById) {
          if (r.goldType !== null) continue;
          const a = basePred.get(r.messageId);
          const b = other.get(r.messageId);
          if (a && b && a !== b) uncodedChanged++;
        }
        pairedResults[arm] = {
          all,
          excludingFallback: noFallback,
          material,
          materialNoFallback,
          noiseFloor,
          uncodedChanged,
        };
        materialNet[arm] = material.net;
        const line = (label: string, p: Paired) =>
          console.error(
            `  ${label.padEnd(34)} n=${String(p.n).padStart(3)}  changed=${String(p.changed).padStart(3)}  ` +
              `fixes=${String(p.fixes).padStart(3)}  breaks=${String(p.breaks).padStart(3)}  ` +
              `wrong→wrong=${String(p.neutral).padStart(3)}  NET=${p.net > 0 ? '+' : ''}${p.net}`
          );
        console.error(`\n[${tag}${arm} vs verbatim]`);
        line('all coded', all);
        line('all coded, excl. fallback rows', noFallback);
        line('material-only', material);
        line('material-only, excl. fallback', materialNoFallback);
        line('NOISE FLOOR (identical inputs)', noiseFloor);
        console.error(`  (uncoded rows that changed: ${uncodedChanged} — not scoreable)`);
      }
    } else {
      console.error('\n(no verbatim arm in this run — paired comparison skipped)');
    }

    // --- raw per-message rows, so the run can be re-scored without re-calling --
    const perMessage = rowsById.map((r) => ({
      messageId: r.messageId,
      goldCode: r.goldCode,
      goldType: r.goldType,
      materialKinds: r.materialKinds,
      requests: r.dissection?.requests.length ?? 0,
      fellBack: r.fellBack,
      excerptDiffers: r.excerptDiffers,
      chars: Object.fromEntries(ALL_ARMS.map((a) => [a, r.content[a].length])),
      predicted: Object.fromEntries(arms.map((a) => [a, predictions.get(a)?.get(r.messageId) ?? null])),
      rationale: Object.fromEntries(arms.map((a) => [a, rationales.get(a)?.get(r.messageId) ?? null])),
    }));

    return { repeat: rep, results, paired: pairedResults, errors, summary, materialNet, perMessage };
  }

  const allRepeats: RepeatOutcome[] = [];
  for (let rep = 1; rep <= REPEATS; rep++) {
    if (REPEATS > 1) {
      console.error(`\n\n########################## REPEAT ${rep}/${REPEATS} ##########################`);
    }
    allRepeats.push(await runOnce(rep));
  }

  // --- SPREAD across repeats ------------------------------------------------
  // The 179 identical-input rows give a noise floor indirectly; this gives it
  // directly, in the same units as the headline. An arm gap smaller than the
  // spread here is not a result.
  const stat = (xs: number[]) => {
    const min = Math.min(...xs);
    const max = Math.max(...xs);
    return { mean: xs.reduce((a, b) => a + b, 0) / xs.length, min, max, spread: max - min };
  };
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const spread: Record<string, unknown> = {};
  for (const arm of arms) {
    spread[arm] = {
      accuracy: stat(allRepeats.map((r) => r.summary[arm].accuracy)),
      kappa: stat(allRepeats.map((r) => r.summary[arm].kappa)),
      materialAccuracy: stat(allRepeats.map((r) => r.summary[arm].materialAccuracy)),
      ...(arm === 'verbatim'
        ? {}
        : { materialNet: stat(allRepeats.map((r) => r.materialNet[arm] ?? 0)) }),
    };
  }
  if (REPEATS > 1) {
    console.error(`\n\n=== SPREAD ACROSS ${REPEATS} REPEATS (identical inputs every pass) ===`);
    console.error(
      'arm'.padEnd(12) +
        ['acc mean', 'min', 'max', 'spread'].map((h) => h.padStart(9)).join('') +
        ['mat mean', 'min', 'max', 'spread'].map((h) => h.padStart(9)).join('')
    );
    for (const arm of arms) {
      const a = stat(allRepeats.map((r) => r.summary[arm].accuracy));
      const m = stat(allRepeats.map((r) => r.summary[arm].materialAccuracy));
      console.error(
        arm.padEnd(12) +
          [pct(a.mean), pct(a.min), pct(a.max), `${(a.spread * 100).toFixed(1)}pp`]
            .map((s) => s.padStart(9))
            .join('') +
          [pct(m.mean), pct(m.min), pct(m.max), `${(m.spread * 100).toFixed(1)}pp`]
            .map((s) => s.padStart(9))
            .join('')
      );
    }
    for (const arm of arms) {
      if (arm === 'verbatim') continue;
      const nets = allRepeats.map((r) => r.materialNet[arm] ?? 0);
      const s = stat(nets);
      console.error(
        `  paired NET (material-only) ${arm} vs verbatim: mean ${s.mean.toFixed(1)} ` +
          `(min ${s.min}, max ${s.max}) over [${nets.join(', ')}]`
      );
    }
    console.error(
      '  → an arm gap smaller than the accuracy spread above is inside run-to-run variance.'
    );
  }

  writeFileSync(
    OUT,
    JSON.stringify(
      {
        assignmentId,
        model,
        effort: EFFORT,
        repeats: REPEATS,
        materialPromptModeShipped: MATERIAL_PROMPT_MODE,
        gold: gold.length,
        joined: paired.length,
        unmatched,
        sample: sample.length,
        coded: codedRows.length,
        withMaterial: withMaterial.length,
        codedWithMaterial: codedMaterial.length,
        fellBack: fellBack.length,
        codedFellBack: codedFellBack.length,
        differingRenderings: differing.length,
          markersDifferArm2vs3: rowsById.filter((r) => r.excerptDiffers).length,
        arm2SigilAssertion: {
          pass: true,
          systemPromptClean: !systemHasSigil,
          userMessagesChecked: rowsById.length,
          exemptSourceSigilRows: sourceSigilRows.map((r) => r.messageId),
        },
        spread,
        // Repeat 1 mirrored at the top level so a single-pass run reads the same
        // as it did before --repeat existed.
        errors: allRepeats[0].errors,
        results: allRepeats[0].results,
        paired: allRepeats[0].paired,
        examples,
        // Every pass's raw rows, so any repeat can be re-scored without calling.
        runs: allRepeats,
      },
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
