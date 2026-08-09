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
import { authorizeAssignment, authErrorResponse } from '@/lib/score/authz';
import { callModel, extractJsonObject, isOpenAIConfigured } from '@/lib/score/classifier';
import { ensureIntentTables } from '@/lib/score/intent-store';
import { getDefaultScoreModel } from '@/lib/score/models';
import {
  buildProposeSystemPrompt,
  buildProposeUserContent,
  type ProposeScope,
  PROPOSAL_SCHEMA,
  PROPOSAL_STRENGTHS,
  type ProposalStrength,
} from '@/lib/score/propose-prompt';
import { ensureScoreTable, getQueryRecords } from '@/lib/score/queries';
import { logStudyEvent } from '@/lib/study/events';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** What was already asked for and done in this revision session (oldest
 * first). The agent used to be stateless across exchanges — "stronger than
 * last time" meant nothing, and repeated feedback silently re-litigated
 * ground the current rule already reflects. */
const priorExchangesSchema = z
  .array(
    z.object({
      instruction: z.string().trim().min(1).max(4000),
      note: z.string().trim().max(2000).optional(),
    })
  )
  .max(8)
  .optional();

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
    priorExchanges: priorExchangesSchema,
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
    priorExchanges: priorExchangesSchema,
  }),
]);

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
  // draft means "no rule" — same as null. NO base-prompt fallback: v7's
  // runtime injects the rule verbatim (buildInjectedSystemPrompt), so telling
  // the agent to preserve a default prompt the runtime never sends was a bug.
  const baseRule = body.draftRule !== undefined ? body.draftRule || null : intent.rule;
  // WHICH rule this is decides what the agent is told it covers — and what
  // condition the revision is logged under. The row already knows: 'intent' |
  // 'type_root' | 'prompt_holder' (the baseline's monolithic container).
  const scope: ProposeScope =
    intent.kind === 'prompt_holder' ? 'prompt' : intent.kind === 'type_root' ? 'type-root' : 'intent';
  const user = buildProposeUserContent({
    scope,
    definition: intent.definition,
    currentRule: baseRule,
    anchor: {
      queryText: anchor.queryText,
      prevQueryText: anchor.prevQueryText,
      prevResponseText: anchor.prevResponseText,
    },
    priorExchanges: body.priorExchanges,
    currentResponse: body.currentResponse,
    input:
      body.mode === 'feedback'
        ? { mode: 'feedback', feedback: body.feedback }
        : { mode: 'rewrite', editedResponse: body.editedResponse, changeIntents: body.changeIntents },
  });

  try {
    const raw = await callModel(
      buildProposeSystemPrompt(scope),
      user,
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
      const strength = PROPOSAL_STRENGTHS.find((s) => s === row.strength);
      const revisedRule = typeof row.revised_rule === 'string' ? row.revised_rule.trim() : '';
      if (!strength || !revisedRule || byStrength.has(strength)) continue;
      byStrength.set(strength, {
        strength,
        revisedRule,
        title: typeof row.title === 'string' ? row.title.trim() : '',
        note: typeof row.note === 'string' ? row.note.trim() : '',
      });
    }
    const variants = PROPOSAL_STRENGTHS.map((s) => byStrength.get(s)).filter(
      (v): v is NonNullable<typeof v> => v !== undefined
    );
    if (variants.length === 0) throw new Error('proposal produced no usable variant');
    // The condition is derived, not assumed: this route serves BOTH arms now
    // (the baseline's dedicated revise endpoint has no caller left), so
    // hardcoding 'score' filed every baseline revision under the treatment.
    await logStudyEvent(id, 'revise_submit', {
      condition: scope === 'prompt' ? 'baseline' : 'score',
      scope,
      mode: body.mode,
      intentId,
      anchorMessageId: body.messageId,
    });
    return NextResponse.json({ variants, mode: body.mode, raw });
  } catch (error) {
    console.error(`SCORE rule proposal failed for intent ${intentId}:`, error);
    return NextResponse.json(
      { error: 'proposal_failed', message: 'The revision proposal failed — try again.' },
      { status: 502 }
    );
  }
}
