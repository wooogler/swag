/**
 * SCORE v6 — agent rule-revision proposal (§1.10 ②피드백 / ③응답 시연).
 *
 * POST, two modes:
 *  { mode: 'feedback', messageId, feedback }  → the instructor said what's
 *    wrong with the response; the agent folds that into a revised rule.
 *  { mode: 'rewrite', messageId, editedResponse } → the instructor rewrote
 *    the response the way they wanted it; the agent infers the GENERALIZABLE
 *    rule change behind the rewrite (not the specific content).
 *
 * The agent only PROPOSES — the instructor reviews the diff and applies via
 * the normal PATCH (제안 → diff 검토 → 승인, §1.10). On-demand call at a
 * higher reasoning tier than batch rating (§7.6 상위 모델 온디맨드).
 */
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/db';
import { scoreIntents } from '@/db/schema';
import { assignmentBasePrompt } from '@/lib/assignment-ai';
import { authorizeAssignment, authErrorResponse } from '@/lib/score/authz';
import { callModel, extractJsonObject, isOpenAIConfigured } from '@/lib/score/classifier';
import { ensureIntentTables } from '@/lib/score/intent-store';
import { getDefaultScoreModel } from '@/lib/score/models';
import { ensureScoreTable, getQueryRecords } from '@/lib/score/queries';
import { logStudyEvent } from '@/lib/study/events';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const bodySchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('feedback'),
    messageId: z.number().int().positive(),
    feedback: z.string().trim().min(1).max(2000),
    /** The response the feedback is about (the current preview the instructor
     * is looking at) — sent from the client so the agent critiques exactly
     * what was on screen. */
    currentResponse: z.string().trim().max(20000).optional(),
    /** Revise THIS rule instead of the saved one — the edge-case sweep's
     * incremental hardening loop (§1.10) folds feedback into the pending
     * DRAFT before anything is applied. */
    draftRule: z.string().trim().max(8000).nullable().optional(),
  }),
  z.object({
    mode: z.literal('rewrite'),
    messageId: z.number().int().positive(),
    editedResponse: z.string().trim().min(1).max(20000),
    currentResponse: z.string().trim().max(20000).optional(),
    draftRule: z.string().trim().max(8000).nullable().optional(),
    /** The intents the instructor CONFIRMED behind the rewrite (the
     * rewrite-intents step) — treated as requirements, with the rewrite itself
     * as their evidence. A before/after pair alone underdetermines what the
     * instructor meant; these pin it down. */
    changeIntents: z.array(z.string().trim().min(1).max(200)).max(6).optional(),
  }),
]);

/** The three revision strengths, weakest first — the client relies on this
 * order for its columns, so the route sorts model output into it. */
type ProposalStrength = 'minimal' | 'moderate' | 'aggressive';
const STRENGTHS: ProposalStrength[] = ['minimal', 'moderate', 'aggressive'];

const PROPOSAL_SCHEMA = {
  name: 'rule_revision',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['variants'],
    properties: {
      variants: {
        type: 'array',
        minItems: 3,
        maxItems: 3,
        description: 'exactly one variant per strength, minimal first',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['strength', 'revised_rule', 'title', 'note'],
          properties: {
            strength: { type: 'string', enum: ['minimal', 'moderate', 'aggressive'] },
            revised_rule: { type: 'string' },
            title: {
              type: 'string',
              description:
                'a short label naming this rule, AT MOST 5 words, git-commit-subject style, no trailing period',
            },
            note: { type: 'string', description: 'one sentence: what changed and why' },
          },
        },
      },
    },
  },
};

function buildSystemPrompt(): string {
  return [
    'You revise the SYSTEM PROMPT of a writing-support chatbot that students use for school assignments.',
    'An instructor groups student requests into "intents". Each intent owns a COMPLETE system prompt (its "rule"): whenever a student request matches that intent, the chatbot answers with that prompt and nothing else stacked underneath.',
    "You will get: the intent definition, the intent's current prompt, one anchor question with the response it produced, and the instructor's input.",
    'Return THREE candidate revised full prompts, one per strength, minimal first:',
    '- "minimal": change ONLY what the instructor\'s input demands; preserve everything else verbatim and do not restate unchanged parts differently.',
    '- "moderate": fold the input in AND rework the part of the prompt it touches so the new behavior actually lands — say what to do instead, when it applies, and remove sentences that directly conflict. Leave unrelated parts as they are.',
    '- "aggressive": re-author the prompt with the instructor\'s input as a central requirement. Reorganize freely, merge redundant instructions, drop what no longer earns its place — but keep every behavior the current prompt demands that the input does not contradict.',
    'The three must genuinely differ in how much they change, not be three rewordings of one edit.',
    'For every variant:',
    '- FEEDBACK mode: the input is a complaint about the response — fold it into the prompt as a durable instruction to the chatbot.',
    '- REWRITE mode: the input is the response rewritten the way the instructor wants it — infer the GENERALIZABLE change in behavior (tone, structure, what to withhold or ask), never the anchor-specific content.',
    "- The prompt only ever runs on requests matching this intent's definition, so it may speak directly to that kind of request. Imperative voice, addressed to the chatbot, coherent and self-contained; do not bloat it.",
    '- Also give a short TITLE naming this revision: at most 5 words, git-commit-subject style, no trailing period (e.g. "Scaffold, don\'t write").',
    '- The note is one sentence for the instructor: what you changed and why.',
    'Answer in the required JSON shape.',
  ].join('\n');
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string; intentId: string }> }) {
  const { id, intentId: intentIdRaw } = await params;
  const auth = await authorizeAssignment(id);
  if ('error' in auth) {
    const { body, status } = authErrorResponse(auth.error);
    return NextResponse.json(body, { status });
  }
  if (!isOpenAIConfigured()) {
    return NextResponse.json(
      { error: 'openai_not_configured', message: 'OPENAI_API_KEY is not configured on the server.' },
      { status: 503 }
    );
  }
  const intentId = Number.parseInt(intentIdRaw, 10);
  if (!Number.isFinite(intentId)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'invalid_input', details: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  await Promise.all([ensureScoreTable(), ensureIntentTables()]);
  const intents = await db
    .select()
    .from(scoreIntents)
    .where(and(eq(scoreIntents.assignmentId, id), eq(scoreIntents.id, intentId)));
  const intent = intents[0];
  if (!intent || intent.archived) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const records = await getQueryRecords(id);
  const anchor = records.find((r) => r.messageId === body.messageId);
  if (!anchor) {
    return NextResponse.json({ error: 'message_not_found' }, { status: 404 });
  }

  // The rule under revision: the pending draft when the sweep loop is
  // hardening an unapplied proposal, else the saved rule. An empty-string
  // draft means "no rule" — same as null.
  const baseRule = body.draftRule !== undefined ? body.draftRule || null : intent.rule;
  // Exactly what the runtime would send for this intent (buildInjectedSystemPrompt):
  // the rule, or the assignment default when the rule is empty.
  const currentPrompt = baseRule?.trim() || assignmentBasePrompt(auth.assignment).trim();
  const parts = [
    `INTENT DEFINITION (when a student…): ${intent.definition}`,
    `CURRENT PROMPT FOR THIS INTENT:\n${
      currentPrompt || '(empty — the chatbot currently answers these requests with no system prompt at all)'
    }`,
    `ANCHOR QUESTION:\n${anchor.queryText}`,
  ];
  if (body.currentResponse) {
    parts.push(`RESPONSE THE INSTRUCTOR IS LOOKING AT:\n${body.currentResponse}`);
  }
  if (body.mode === 'feedback') {
    parts.push(`INSTRUCTOR FEEDBACK (fold into the prompt):\n${body.feedback}`);
  } else {
    parts.push(`RESPONSE AS THE INSTRUCTOR REWROTE IT (infer the generalizable prompt change):\n${body.editedResponse}`);
    if (body.changeIntents && body.changeIntents.length > 0) {
      parts.push(
        `INTENTS THE INSTRUCTOR CONFIRMED BEHIND THE REWRITE — each is a requirement; fold each into the prompt as a durable, generalizable instruction, using the rewrite as its evidence:\n${body.changeIntents
          .map((s) => `- ${s}`)
          .join('\n')}`
      );
    }
  }

  try {
    const raw = await callModel(
      buildSystemPrompt(),
      parts.join('\n\n'),
      getDefaultScoreModel(),
      'medium', // revision authoring warrants more deliberation than batch rating
      PROPOSAL_SCHEMA,
      // Three full prompts is ~3× the output of the old single proposal — keep
      // the call inside the route's 60s budget rather than the SDK default.
      { timeoutMs: 55_000, maxRetries: 1 }
    );
    const parsed = extractJsonObject(raw);
    // Sort model output into canonical strength order and drop malformed
    // entries; one usable variant is enough to answer.
    const rawVariants = Array.isArray(parsed.variants) ? parsed.variants : [];
    const byStrength = new Map<ProposalStrength, { strength: ProposalStrength; revisedRule: string; title: string; note: string }>();
    for (const v of rawVariants) {
      const row = (v ?? {}) as Record<string, unknown>;
      const strength = STRENGTHS.find((s) => s === row.strength);
      const revisedRule = typeof row.revised_rule === 'string' ? row.revised_rule.trim() : '';
      if (!strength || !revisedRule || byStrength.has(strength)) continue;
      byStrength.set(strength, {
        strength,
        revisedRule,
        title: typeof row.title === 'string' ? row.title.trim() : '',
        note: typeof row.note === 'string' ? row.note.trim() : '',
      });
    }
    const variants = STRENGTHS.map((s) => byStrength.get(s)).filter(
      (v): v is NonNullable<typeof v> => v !== undefined
    );
    if (variants.length === 0) throw new Error('proposal produced no usable variant');
    await logStudyEvent(id, 'revise_submit', { condition: 'score', mode: body.mode, intentId, anchorMessageId: body.messageId });
    return NextResponse.json({ variants, mode: body.mode, raw });
  } catch (error) {
    console.error(`SCORE rule proposal failed for intent ${intentId}:`, error);
    return NextResponse.json(
      { error: 'proposal_failed', message: 'The revision proposal failed — try again.' },
      { status: 502 }
    );
  }
}
