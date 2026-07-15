/**
 * SCORE v6 — intent-tailored feedback starters for the rule workbench.
 *
 * GET → the five canonical rule-element feedback templates (finish line, no
 * direct answers, short turns, attempt-first, evidence — the authoring schema
 * from Liu et al. 2026, arXiv:2604.16738) rewritten by a small model so their
 * examples fit THIS intent's kind of student request. The client falls back to
 * the generic templates when this call fails or OpenAI is unconfigured.
 */
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db/db';
import { scoreIntents } from '@/db/schema';
import { authorizeAssignment, authErrorResponse } from '@/lib/score/authz';
import { callModel, extractJsonObject, isOpenAIConfigured } from '@/lib/score/classifier';
import { ensureIntentTables } from '@/lib/score/intent-store';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** Small/fast model — same tier as the auto-title nicety (env-overridable). */
const CHIP_MODEL = process.env.SCORE_TITLE_MODEL || 'gpt-5.4-nano';

const CHIP_KEYS = [
  'finish_line',
  'no_direct_answers',
  'short_turns',
  'attempt_first',
  'ask_evidence',
] as const;

const CANONICAL: Record<(typeof CHIP_KEYS)[number], string> = {
  finish_line:
    'Add an explicit finish line: tell the student up front what "done" looks like (e.g., two evidence-backed points), and wrap up once they reach it.',
  no_direct_answers:
    'Never give the final answer or write the text for the student — even when asked directly. Redirect with a hint or a question instead.',
  short_turns:
    'Keep replies to 1–2 sentences, ask exactly one question per turn, and always end with a concrete next step the student can act on.',
  attempt_first:
    'Require the student to try first: no hints until they have made an attempt, then escalate help gradually.',
  ask_evidence:
    'Whenever the student makes a claim, ask them to support it with evidence from the text or a worked step.',
};

const SYSTEM = `You tailor feedback templates for SCORE, an instructor tool for a writing-assignment chatbot. The instructor is revising the RULE (response guideline) of one INTENT — a category of student requests. Sending one of the five canonical feedback lines below asks a revision agent to fold that rule element into the rule.

Rewrite EACH line so its specifics and example fit the intent's kind of request (e.g., for a "write a conclusion" intent, the finish line should be about the student assembling their own conclusion). Keep:
- the element's core demand intact (a finish line stays a finish line, etc.),
- the same imperative instructor-to-agent voice,
- ONE sentence each, at most ~35 words,
- concrete over generic — name the work products this intent involves.

Answer in JSON with exactly the keys: finish_line, no_direct_answers, short_turns, attempt_first, ask_evidence.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [...CHIP_KEYS],
  properties: Object.fromEntries(
    CHIP_KEYS.map((k) => [k, { type: 'string', description: 'one sentence, ≤35 words' }])
  ),
};

type RouteParams = { params: Promise<{ id: string; intentId: string }> };

export async function GET(_req: Request, { params }: RouteParams) {
  const { id, intentId: intentIdRaw } = await params;
  const auth = await authorizeAssignment(id);
  if ('error' in auth) {
    const { body, status } = authErrorResponse(auth.error);
    return NextResponse.json(body, { status });
  }
  const intentId = Number.parseInt(intentIdRaw, 10);
  if (!Number.isFinite(intentId)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  await ensureIntentTables();
  const rows = await db
    .select()
    .from(scoreIntents)
    .where(and(eq(scoreIntents.id, intentId), eq(scoreIntents.assignmentId, id)));
  const intent = rows[0];
  if (!intent) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  if (!isOpenAIConfigured()) {
    // Graceful degrade: the generic templates are still useful.
    return NextResponse.json({ chips: CANONICAL, tailored: false });
  }

  try {
    const user = [
      `INTENT (when a student…): ${intent.definition}`,
      `CURRENT RULE: ${intent.rule ?? '(none — base prompt fallback)'}`,
      'CANONICAL TEMPLATES:',
      ...CHIP_KEYS.map((k) => `${k}: ${CANONICAL[k]}`),
    ].join('\n\n');
    const raw = await callModel(
      SYSTEM,
      user,
      CHIP_MODEL,
      'low',
      { name: 'feedback_chips', schema: SCHEMA as Record<string, unknown> },
      // A UI nicety — fail fast and let the client keep the generic texts.
      { timeoutMs: 15_000, maxRetries: 1 }
    );
    const parsed = extractJsonObject(raw);
    const chips: Record<string, string> = {};
    for (const k of CHIP_KEYS) {
      const v = parsed[k];
      chips[k] = typeof v === 'string' && v.trim().length > 0 && v.length <= 400 ? v.trim() : CANONICAL[k];
    }
    return NextResponse.json({ chips, tailored: true });
  } catch (error) {
    console.error(`SCORE feedback-chip tailoring failed for intent ${intentId}:`, error);
    return NextResponse.json({ chips: CANONICAL, tailored: false });
  }
}
