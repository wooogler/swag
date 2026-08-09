/**
 * SCORE — candidate reasons for one CORRECTION on one question.
 *
 * POST { messageId, verdict, rationale? } → three short, distinct reasons the
 * instructor might give for overruling the classifier here: why the message does
 * NOT belong (verdict 'out'), or why it DOES (verdict 'in').
 *
 * The UI asks only when the correction DISAGREES with the current rating, which
 * is exactly when the reason carries information. That reason is the fold's main
 * fuel: it becomes a PRINCIPLE in the definition — which generalizes to
 * questions nobody has seen — where a bare verdict could only ever become
 * another special case. On-demand call, like propose/edgecases.
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
import { buildRatingQueryContent } from '@/lib/score/prompts';
import { computeDissections } from '@/lib/score/dissect';
import { ensureScoreTable, getQueryRecords } from '@/lib/score/queries';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const bodySchema = z.object({
  messageId: z.number().int().positive(),
  /** Which way the instructor is overruling. Defaults to 'out' so a client that
   * predates in-corrections keeps working. */
  verdict: z.enum(['in', 'out']).optional(),
  /** The classifier's rationale for this question (from the row) — extra
   * grounding so the suggestions engage with why it was rated as it was. */
  rationale: z.string().trim().max(500).optional(),
});

const REASONS_SCHEMA = {
  name: 'correction_reasons',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['reasons'],
    properties: {
      reasons: {
        type: 'array',
        minItems: 3,
        maxItems: 3,
        items: {
          type: 'string',
          description: 'Twelve words or fewer — a concrete reason for the instructor\'s verdict',
        },
      },
    },
  },
};

function buildSystemPrompt(verdict: 'in' | 'out'): string {
  const isOut = verdict === 'out';
  return [
    'You help an instructor correct a request-classification system used on a school writing assignment.',
    isOut
      ? 'The instructor is marking one student message as NOT belonging to one intent, overruling the classifier. Propose exactly THREE short, DISTINCT reasons WHY it does not belong.'
      : 'The instructor is marking one student message as BELONGING to one intent, overruling the classifier that judged otherwise. Propose exactly THREE short, DISTINCT reasons WHY it does belong.',
    // The reason is folded into the DEFINITION, so a reason that only describes
    // this one message teaches nothing; the prompt has to push for the rule.
    'Each reason will be folded into the intent\'s definition as a general rule, so state the PRINCIPLE that decides this case — not a description of this one message.',
    'Rules:',
    isOut
      ? '- Each reason ≤ 12 words, a concrete clause (e.g. "Asks to brainstorm topics, not write prose").'
      : '- Each reason ≤ 12 words, a concrete clause (e.g. "Wording fixes are style revisions, however small").',
    '- Ground each reason in what the student\'s REQUEST actually asks versus the intent definition.',
    '- Use the PRIOR CONTEXT only to interpret what the current request refers to (e.g. "make it longer" points back to the prior reply); judge ONLY the current STUDENT QUERY, never the prior context itself.',
    '- Make the three genuinely different (different angle each), not rewordings.',
    '- No preamble, no "because", no trailing punctuation beyond a period. Return JSON only.',
  ].join('\n');
}

type RouteParams = { params: Promise<{ id: string; intentId: string }> };

export async function POST(req: Request, { params }: RouteParams) {
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
  const intentRows = await db
    .select()
    .from(scoreIntents)
    .where(and(eq(scoreIntents.assignmentId, id), eq(scoreIntents.id, intentId)));
  const intent = intentRows[0];
  if (!intent) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const records = await getQueryRecords(id);
  const anchor = records.find((r) => r.messageId === body.messageId);
  if (!anchor) {
    return NextResponse.json({ error: 'message_not_found' }, { status: 404 });
  }

  // The dissection too, not just the text: this block claims to be what the
  // classifier rated, and under the abridged material mode a prompt built
  // without it would quote an essay the judge never saw — then hand that
  // reasoning to the instructor as the verdict's rationale.
  const dissection = (await computeDissections(id, new Set([body.messageId]))).get(body.messageId) ?? null;
  const parts = [
    `INTENT DEFINITION (a student's request is "in" when it…): ${intent.definition}`,
    // SAME prior-context + query block the classifier rated with (previous
    // student message + the chatbot reply it was responding to, capped
    // identically), so turn-dependent requests ("make it longer", "redo in 3
    // sentences") get reasons grounded in what the request actually refers to.
    buildRatingQueryContent(anchor.queryText, anchor.prevQueryText, anchor.prevResponseText, dissection),
  ];
  if (body.rationale) {
    parts.push(`CLASSIFIER RATIONALE FOR THIS MESSAGE (context): ${body.rationale}`);
  }

  try {
    const raw = await callModel(
      buildSystemPrompt(body.verdict ?? 'out'),
      parts.join('\n\n'),
      getDefaultScoreModel(),
      'low', // three short labels — cheap, low latency
      REASONS_SCHEMA
    );
    const parsed = extractJsonObject(raw);
    const reasons = Array.isArray(parsed.reasons)
      ? parsed.reasons
          .filter((r): r is string => typeof r === 'string')
          .map((r) => r.trim())
          .filter(Boolean)
          .slice(0, 3)
      : [];
    if (reasons.length === 0) throw new Error('no reasons produced');
    return NextResponse.json({ reasons });
  } catch (error) {
    console.error(`SCORE exclusion-reasons failed for intent ${intentId}:`, error);
    return NextResponse.json(
      { error: 'reasons_failed', message: 'Could not generate reasons — type your own.' },
      { status: 502 }
    );
  }
}
