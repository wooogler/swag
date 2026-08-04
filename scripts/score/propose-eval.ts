/**
 * Propose-prompt eval harness: does a rule authored by the CURRENT propose
 * prompt actually change the chatbot's behavior on a real mid-thread anchor?
 *
 * Pipeline per sample (all against the live DB and the deployed chat model):
 *   1. Build the propose call EXACTLY as the route does (shared builders in
 *      src/lib/score/propose-prompt.ts) and get the three strength variants.
 *   2. For each variant, regenerate the anchor's response the way
 *      preview-service does: system = the rule verbatim, full prior thread
 *      replayed, then the anchor.
 *   3. Grade each response with an LLM judge: did it hand the student finished
 *      replacement prose (violation) or phrase-level guidance (compliant)?
 *
 * Defaults reproduce the 2026-08-04 failure case: the "that conclusion is a
 * bit too whimsical" anchor on the NIRVANA master, drafting type root, empty
 * rule, feedback asking for expressions instead of written text.
 *
 *   npx tsx scripts/score/propose-eval.ts [--samples 2] [--gen 1]
 *     [--assignment <id>] [--message <id>] [--intent <id>] [--feedback "..."]
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

(function loadEnv() {
  try {
    const t = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
    for (const l of t.split('\n')) {
      const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch {
    /* rely on the ambient environment */
  }
})();

const DEFAULTS = {
  assignment: 'ea905a40-ad5d-4fe5-bbf8-91d6b1998331', // NIRVANA master
  message: 1837, // "that conclusion is a bit too whimsical! channel your inner science journal"
  intent: 2375, // drafting type root (empty rule — the demo scenario)
  feedback:
    'Instead of writing the text for the user, it would be better to show expressions that are suitable for the style the user requested.',
  samples: 2,
  gen: 1,
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** What the judge audits against. MUST match the feedback under test —
 * auditing a "keep replies short" run against this style directive counts
 * expected prose as violations. Override with --directive for other feedback. */
const DEFAULT_DIRECTIVE =
  'the chatbot must NOT hand the student finished replacement text (prose they could paste into their draft); it should give phrase-level guidance instead — word/phrase swaps, sentence starters, structural pointers, critique.';

const buildJudgeSystem = (directive: string) => [
  "You audit ONE chatbot reply against an instructor's directive:",
  directive,
  'Classify the reply:',
  '- "violation": it contains at least one finished replacement PARAGRAPH (2+ consecutive complete sentences of essay prose in the student\'s voice, presented as usable text).',
  '- "partial": no full paragraph, but it presents one or more complete rewritten SENTENCES as usable replacement text (beyond a single short example fragment).',
  '- "compliant": guidance only — swaps, starters, fragments, critique; nothing longer than one consecutive finished sentence of replacement prose.',
  "Quoted fragments of the STUDENT's own draft, and single-phrase alternatives, never count as replacement prose.",
  'Templates containing blanks ("___") or trailing ellipses are scaffolds, not replacement prose — they never count either.',
  'Return JSON only.',
].join('\n');

const JUDGE_SCHEMA = {
  name: 'compliance_audit',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['verdict', 'longest_replacement_span', 'reason'],
    properties: {
      verdict: { type: 'string', enum: ['compliant', 'partial', 'violation'] },
      longest_replacement_span: {
        type: 'string',
        description: 'the longest span of finished replacement prose, verbatim, at most 30 words; empty if none',
      },
      reason: { type: 'string', description: 'one sentence' },
    },
  },
};

async function main() {
  const { db } = await import('@/db/db');
  const { and, eq } = await import('drizzle-orm');
  const { scoreIntents } = await import('@/db/schema');
  const { getQueryRecords, getConversationHistories } = await import('@/lib/score/queries');
  const { buildInjectedSystemPrompt, getChatModel } = await import('@/lib/score/injection');
  const { callModel, extractJsonObject } = await import('@/lib/score/classifier');
  const { getDefaultScoreModel } = await import('@/lib/score/models');
  const { buildProposeSystemPrompt, buildProposeUserContent, PROPOSAL_SCHEMA, PROPOSAL_STRENGTHS } =
    await import('@/lib/score/propose-prompt');
  const { default: OpenAI } = await import('openai');

  const assignmentId = arg('assignment') ?? DEFAULTS.assignment;
  const messageId = Number(arg('message') ?? DEFAULTS.message);
  const intentId = Number(arg('intent') ?? DEFAULTS.intent);
  const feedback = arg('feedback') ?? DEFAULTS.feedback;
  const samples = Number(arg('samples') ?? DEFAULTS.samples);
  const gen = Number(arg('gen') ?? DEFAULTS.gen);
  const judgeSystem = buildJudgeSystem(arg('directive') ?? DEFAULT_DIRECTIVE);

  const [intent] = await db
    .select()
    .from(scoreIntents)
    .where(and(eq(scoreIntents.assignmentId, assignmentId), eq(scoreIntents.id, intentId)));
  if (!intent) throw new Error(`intent ${intentId} not found in ${assignmentId}`);

  const records = await getQueryRecords(assignmentId);
  const anchor = records.find((r) => r.messageId === messageId);
  if (!anchor) throw new Error(`message ${messageId} not found`);
  const histories = await getConversationHistories(assignmentId, [messageId]);
  const history = histories.get(messageId) ?? [];

  const chatModel = getChatModel();
  const scoreModel = getDefaultScoreModel();
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 1, timeout: 60_000 });

  console.log(`anchor ${messageId} · history ${history.length} turns · chat=${chatModel} score=${scoreModel}`);
  console.log(`intent ${intentId} "${intent.title}" rule=${intent.rule?.trim() ? `${intent.rule.length} chars` : '(empty)'}\n`);

  // Replicates preview-service.generatePreview: system (only if non-empty) +
  // full prior thread + the anchor, no sampling overrides.
  async function generateUnder(rule: string): Promise<string> {
    const system = buildInjectedSystemPrompt(rule);
    const input: { role: 'system' | 'user' | 'assistant'; content: string }[] = [];
    if (system.trim()) input.push({ role: 'system', content: system });
    for (const turn of history) input.push({ role: turn.role, content: turn.content });
    input.push({ role: 'user', content: anchor!.queryText });
    const res = await openai.responses.create({ model: chatModel, input });
    return (res.output_text ?? '').trim();
  }

  interface RunRecord {
    sample: number;
    strength: string;
    title: string;
    rule: string;
    generations: { response: string; verdict: string; span: string; reason: string }[];
  }
  const runs: RunRecord[] = [];

  for (let s = 0; s < samples; s++) {
    const user = buildProposeUserContent({
      definition: intent.definition,
      currentRule: intent.rule,
      anchor: {
        queryText: anchor.queryText,
        prevQueryText: anchor.prevQueryText,
        prevResponseText: anchor.prevResponseText,
      },
      currentResponse: anchor.responseText ?? undefined,
      input: { mode: 'feedback', feedback },
    });
    const raw = await callModel(buildProposeSystemPrompt(), user, scoreModel, 'medium', PROPOSAL_SCHEMA, {
      timeoutMs: 90_000,
      maxRetries: 1,
    });
    const parsed = extractJsonObject(raw);
    const rawVariants = Array.isArray(parsed.variants) ? parsed.variants : [];
    const variants = PROPOSAL_STRENGTHS.flatMap((st) => {
      const row = rawVariants.find(
        (v: Record<string, unknown>) => v && (v as { strength?: string }).strength === st
      ) as { strength: string; revised_rule?: string; title?: string } | undefined;
      return row && typeof row.revised_rule === 'string' && row.revised_rule.trim()
        ? [{ strength: st, rule: row.revised_rule.trim(), title: (row.title ?? '').toString() }]
        : [];
    });

    for (const v of variants) {
      const rec: RunRecord = { sample: s + 1, strength: v.strength, title: v.title, rule: v.rule, generations: [] };
      runs.push(rec);
      await Promise.all(
        Array.from({ length: gen }, async () => {
          const response = await generateUnder(v.rule);
          const judgeRaw = await callModel(
            judgeSystem,
            `CHATBOT REPLY TO AUDIT:\n"""\n${response}\n"""`,
            scoreModel,
            'low',
            JUDGE_SCHEMA,
            { timeoutMs: 45_000, maxRetries: 1 }
          );
          const j = extractJsonObject(judgeRaw) as Record<string, string>;
          rec.generations.push({
            response,
            verdict: j.verdict ?? '?',
            span: j.longest_replacement_span ?? '',
            reason: j.reason ?? '',
          });
        })
      );
    }
  }

  // Report.
  for (const r of runs) {
    console.log(`\n===== sample ${r.sample} · ${r.strength} · "${r.title}" =====`);
    console.log(`RULE (${r.rule.length} chars):\n${r.rule}\n`);
    r.generations.forEach((g, i) => {
      console.log(`  gen${i + 1}: ${g.verdict.toUpperCase()} — ${g.reason}`);
      if (g.span) console.log(`        span: "${g.span}"`);
      console.log(`        opens: ${g.response.replace(/\s+/g, ' ').slice(0, 140)}…`);
    });
  }
  const tally: Record<string, Record<string, number>> = {};
  for (const r of runs) {
    tally[r.strength] ??= { compliant: 0, partial: 0, violation: 0 };
    for (const g of r.generations) tally[r.strength][g.verdict] = (tally[r.strength][g.verdict] ?? 0) + 1;
  }
  console.log('\n===== TALLY (generations per strength) =====');
  console.log(JSON.stringify(tally, null, 1));

  const out = resolve(
    process.env.PROPOSE_EVAL_OUT ?? '.',
    `propose-eval-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  );
  writeFileSync(out, JSON.stringify({ assignmentId, messageId, intentId, feedback, chatModel, scoreModel, runs }, null, 1));
  console.log(`\nfull output: ${out}`);
}

void main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
