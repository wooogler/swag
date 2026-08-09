/**
 * SCORE — intent candidates seeded from one student question.
 *
 * POST {messageId, currentIntentId?, scopeType?} → three distinct
 * {title, definition} candidates for a NEW intent that would own this
 * question. The candidates take different altitudes — the specific request,
 * the broader category, an alternative cut — and must differ meaningfully from
 * the scope they are carved out of. The instructor reviews/edits them in the
 * New Intent chooser and picks one as the seed.
 *
 * Definitions carry their example queries INLINE, in the same shape the
 * taxonomy's starter sets use ("… — for example, "…", "…", or "…""). The
 * chooser stands both sources side by side, so a proposal without examples
 * reads as the lesser thing; and the examples are what a definition's boundary
 * is actually argued from — the rating pass reads them as anchors.
 */
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/db';
import { scoreIntents } from '@/db/schema';
import { authorizeAssignment, authErrorResponse } from '@/lib/score/authz';
import { callModel, extractJsonObject, isOpenAIConfigured } from '@/lib/score/classifier';
import { REFINE_MODEL } from '@/lib/score/intent-agent';
import { ensureIntentTables, getAssignmentMessageText } from '@/lib/score/intent-store';
import { QUERY_TYPE_LABELS, SCORE_QUERY_TYPES } from '@/lib/score/intents';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const bodySchema = z.object({
  messageId: z.number().int().positive(),
  currentIntentId: z.number().int().positive().optional(),
  /** v7: the query type the new set will live in. Sent when creation starts
   * from a question, so the candidates read as a refinement of a scope the
   * instructor is already looking at rather than as free-floating ideas. */
  scopeType: z.enum(SCORE_QUERY_TYPES).optional(),
});

const SYSTEM = `You draft intent candidates for SCORE, an instructor tool that classifies student requests sent to a writing-assignment chatbot. An INTENT has a TITLE (imperative noun phrase, at most 5 words, git-commit style) and a DEFINITION that a classifier will read verbatim to decide whether a question belongs.

Given ONE student question — the query type it was classified into, and (when there is one) the intent that currently answers it — propose exactly THREE candidates for a new intent that would own this question, each from a different altitude:
1. SPECIFIC — tightly scoped to this request's action and object.
2. CATEGORY — the broader family of requests this one belongs to.
3. REFRAMED — an alternative cut (e.g., by pedagogical purpose or workflow stage) that would still clearly capture this question.

DEFINITION FORMAT — follow it exactly:

  asks the chatbot to <action, lower case, no final period> — for example, "<question>", "<question>", or "<question>"

- Start with the literal words "asks the chatbot to".
- The action clause is one clause, not a paragraph. Concrete over generic: name the work products involved.
- Then exactly THREE example questions, each in double quotes, comma-separated, with "or" before the last.
- The SPECIFIC candidate must quote the student's actual request as one of its three. Keep their wording, shortened to about 20 words if it runs long.
- The CATEGORY and REFRAMED candidates pick examples that show their RANGE. They may include the student's request, but three restatements of it means the candidate was not actually broader — at least one example must be something the SPECIFIC candidate would not cover.
- Where a student pastes their own writing, the assignment prompt, or any other material, write it as a bracketed placeholder — "Fix the grammar in the following text: [text]" — never reproduce it.
- An example is always a REQUEST. When the student's question is mostly pasted material with little or no request in it, write the request that the paste implies and attach the placeholder — "Review this draft: [text]" — never a bare placeholder on its own.

Rules:
- Each candidate must be meaningfully DIFFERENT from the current intent's definition and from each other.
- The new intent lives INSIDE the given query type, and (when a current intent is shown) is carved out of it — so it must be NARROWER than that scope, not a restatement of it.

Answer in JSON: { "suggestions": [ { "title", "definition" } × 3 ] }.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['suggestions'],
  properties: {
    suggestions: {
      type: 'array',
      description: 'exactly three candidates, ordered: specific, category, reframed',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'definition'],
        properties: {
          title: { type: 'string', description: 'at most 5 words, no trailing period' },
          definition: {
            type: 'string',
            description:
              'asks the chatbot to <action> — for example, "<question>", "<question>", or "<question>"',
          },
        },
      },
    },
  },
};

/** One line per type, enough to keep a candidate inside its scope. */
const TYPE_SCOPE_HINT: Record<(typeof SCORE_QUERY_TYPES)[number], string> = {
  planning: 'deciding WHAT to write, with no essay text produced',
  translating: "turning the student's own idea into a sentence or a paragraph",
  reviewing: 'evaluating or revising text that already exists',
  drafting: 'generating essay text wholesale, or handling several activities at once',
};

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: RouteParams) {
  const { id } = await params;
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

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'invalid_input', details: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  await ensureIntentTables();
  const queryText = await getAssignmentMessageText(id, body.messageId);
  if (!queryText) {
    return NextResponse.json({ error: 'message_not_found' }, { status: 404 });
  }
  let currentDefinition: string | null = null;
  if (body.currentIntentId !== undefined) {
    const rows = await db
      .select({ definition: scoreIntents.definition })
      .from(scoreIntents)
      .where(and(eq(scoreIntents.id, body.currentIntentId), eq(scoreIntents.assignmentId, id)));
    currentDefinition = rows[0]?.definition ?? null;
  }

  try {
    const user = [
      `STUDENT QUESTION (verbatim):\n${queryText.slice(0, 4000)}`,
      body.scopeType
        ? `QUERY TYPE: ${QUERY_TYPE_LABELS[body.scopeType]} — ${TYPE_SCOPE_HINT[body.scopeType]}`
        : 'QUERY TYPE: (unknown)',
      currentDefinition
        ? `CURRENT SCOPE the new intent is carved out of:\n${currentDefinition}`
        : 'CURRENT SCOPE: the query type itself — nothing narrower answers this question yet.',
    ].join('\n\n');
    const raw = await callModel(
      SYSTEM,
      user,
      REFINE_MODEL,
      'low',
      { name: 'intent_suggestions', schema: SCHEMA as Record<string, unknown> },
      { timeoutMs: 25_000, maxRetries: 1 }
    );
    const parsed = extractJsonObject(raw);
    const list = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
    const suggestions = list
      .filter(
        (s): s is { title: string; definition: string } =>
          !!s &&
          typeof (s as { title?: unknown }).title === 'string' &&
          typeof (s as { definition?: unknown }).definition === 'string'
      )
      .slice(0, 3)
      .map((s) => ({ title: s.title.trim().slice(0, 120), definition: s.definition.trim().slice(0, 4000) }));
    if (suggestions.length === 0) throw new Error('no usable suggestions');
    return NextResponse.json({ suggestions });
  } catch (error) {
    console.error(`SCORE intent suggestions failed for message ${body.messageId}:`, error);
    return NextResponse.json(
      // Condition-neutral wording: BOTH create choosers surface `message`
      // verbatim, and the baseline one must not print the word "intents".
      { error: 'suggest_failed', message: 'Failed to draft candidates — try again.' },
      { status: 500 }
    );
  }
}
