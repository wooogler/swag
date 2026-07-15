/**
 * SCORE v6 — intent candidates seeded from one student question.
 *
 * POST {messageId, currentIntentId?} → three distinct {title, definition}
 * candidates for a NEW intent that would own this question (the rule
 * workbench's "this doesn't really fit this intent" escape hatch). The
 * candidates take different altitudes — the specific request, the broader
 * category, the pedagogical purpose — and must differ meaningfully from the
 * current intent. The instructor reviews/edits them in a modal and picks one
 * as the New Intent seed.
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

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const bodySchema = z.object({
  messageId: z.number().int().positive(),
  currentIntentId: z.number().int().positive().optional(),
});

const SYSTEM = `You draft intent candidates for SCORE, an instructor tool that classifies student requests sent to a writing-assignment chatbot. An INTENT has a TITLE (imperative noun phrase, at most 5 words, git-commit style) and a DEFINITION (one or two sentences describing a category of student requests, starting with "asks").

Given ONE student question — and the intent the instructor decided it does NOT belong to — propose exactly THREE candidates for a new intent that would own this question, each from a different altitude:
1. SPECIFIC — tightly scoped to this request's action and object.
2. CATEGORY — the broader family of requests this one belongs to.
3. REFRAMED — an alternative cut (e.g., by pedagogical purpose or workflow stage) that would still clearly capture this question.

Rules:
- Every definition starts with "asks" and is self-contained (a classifier will use it verbatim; no "etc.", no references to examples).
- Each candidate must be meaningfully DIFFERENT from the current intent's definition and from each other.
- Concrete over generic — name the work products involved.

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
          definition: { type: 'string', description: 'one or two sentences, starts with "asks"' },
        },
      },
    },
  },
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
      currentDefinition
        ? `CURRENT INTENT it does NOT belong to:\n${currentDefinition}`
        : 'CURRENT INTENT: (none)',
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
      { error: 'suggest_failed', message: 'Failed to propose intents — try again.' },
      { status: 500 }
    );
  }
}
