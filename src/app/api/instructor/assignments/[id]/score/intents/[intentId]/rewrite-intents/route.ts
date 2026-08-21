/**
 * SCORE — candidate INTENTS behind one response rewrite.
 *
 * POST { messageId, editedResponse, currentResponse? } → three to five short,
 * distinct readings of what the instructor's rewrite MEANS as a general change
 * in behavior ("end with one guiding question, not the answer", "halve the
 * length"), grounded in the actual differences between the two responses.
 *
 * The rewrite flow's problem was that a before/after pair underdetermines the
 * instructor's intent: the model saw WHAT changed but had to guess WHY. The
 * instructor confirms (or rewords) these candidates and propose folds the
 * confirmed ones in as requirements — the same shape as exclusion-reasons,
 * where a picked reason becomes the fold's principle. On-demand, low effort:
 * this runs between "I rewrote it" and "propose", so it has to feel instant.
 */
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/db';
import { scoreIntents } from '@/db/schema';
import { authorizeAssignment, authErrorResponse } from '@/lib/score/authz';
import { refuseSimpleClone } from '@/lib/study/simple/route-context';
import { logStudyEvent } from '@/lib/study/events';
import { callModel, extractJsonObject, isOpenAIConfigured } from '@/lib/score/classifier';
import { ensureIntentTables } from '@/lib/score/intent-store';
import { getDefaultScoreModel } from '@/lib/score/models';
import { ensureScoreTable, getQueryRecords } from '@/lib/score/queries';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const bodySchema = z.object({
  messageId: z.number().int().positive(),
  /** The response as the instructor rewrote it. */
  editedResponse: z.string().trim().min(1).max(20000),
  /** The response the rewrite was made AGAINST (what was on screen). Falls
   * back to the anchor's delivered response when omitted. */
  currentResponse: z.string().trim().max(20000).optional(),
});

const INTENTS_SCHEMA = {
  name: 'rewrite_intents',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['intents'],
    properties: {
      intents: {
        type: 'array',
        minItems: 3,
        maxItems: 5,
        items: {
          type: 'string',
          description:
            'Fifteen words or fewer — one generalizable change in behavior the rewrite implies',
        },
      },
    },
  },
};

function buildSystemPrompt(): string {
  return [
    'You help an instructor revise the system prompt of a writing-support chatbot that students use for school assignments.',
    'The instructor rewrote one chatbot response the way they wanted it. Propose three to five short, DISTINCT candidate INTENTS behind the rewrite — the general changes in behavior it implies, which will be folded into the system prompt as durable instructions.',
    'Rules:',
    '- Each intent ≤ 15 words, imperative, addressed to the chatbot (e.g. "End with one guiding question instead of the full answer").',
    '- State the GENERALIZABLE behavior, never this response\'s specific content or topic.',
    '- Ground every intent in a real difference between the two responses — do not invent changes the rewrite does not show.',
    '- Make them genuinely different (length, structure, tone, what is withheld, what is asked of the student), not rewordings of one change.',
    '- One intent per real difference: a rewrite that changed one thing deserves three readings of THAT change at different generality, not padding.',
    '- No preamble, no "because". Return JSON only.',
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
  // Not on a simple clone: that version has none of this, and letting it
  // through would write a second, disagreeing answer to "what is this
  // participant's configuration" (lib/study/simple/route-context).
  const wrongVersion = await refuseSimpleClone(id);
  if (wrongVersion) return wrongVersion;
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
  if (!intent || intent.archived) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const records = await getQueryRecords(id);
  const anchor = records.find((r) => r.messageId === body.messageId);
  if (!anchor) {
    return NextResponse.json({ error: 'message_not_found' }, { status: 404 });
  }

  const before = body.currentResponse?.trim() || anchor.responseText?.trim() || '';
  const parts = [
    intent.definition.trim()
      ? `INTENT (the kind of student request this prompt answers): ${intent.definition}`
      : null,
    `STUDENT QUESTION:\n${anchor.queryText}`,
    `RESPONSE BEFORE THE REWRITE:\n${before || '(no response was recorded)'}`,
    `RESPONSE AS THE INSTRUCTOR REWROTE IT:\n${body.editedResponse}`,
  ].filter((p): p is string => p !== null);

  try {
    const raw = await callModel(
      buildSystemPrompt(),
      parts.join('\n\n'),
      getDefaultScoreModel(),
      'low', // a handful of short labels — cheap, low latency
      INTENTS_SCHEMA
    );
    const parsed = extractJsonObject(raw);
    const intents = Array.isArray(parsed.intents)
      ? parsed.intents
          .filter((r): r is string => typeof r === 'string')
          .map((r) => r.trim())
          .filter(Boolean)
          .slice(0, 5)
      : [];
    if (intents.length === 0) throw new Error('no intents produced');
    await logStudyEvent(id, 'suggest_rewrite_intents', {
      intentId,
      messageId: body.messageId,
      count: intents.length,
      intents,
    });
    return NextResponse.json({ intents });
  } catch (error) {
    console.error(`SCORE rewrite-intents failed for intent ${intentId}:`, error);
    return NextResponse.json(
      { error: 'intents_failed', message: 'Could not read the rewrite — proposing directly.' },
      { status: 502 }
    );
  }
}
