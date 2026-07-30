/**
 * SCORE v6: intent-tailored feedback starters for the rule workbench.
 *
 * GET returns the six canonical rule-element feedback templates (role, no
 * direct answers, attempt first, one at a time, brief with a next step,
 * evidence; the authoring schema from Liu et al. 2026, arXiv:2604.16738)
 * rewritten by a small model so their wording fits THIS intent's kind of
 * student request. The client falls back to the shared canonical templates
 * when this call fails or OpenAI is unconfigured. BASELINE (promptMode) skips
 * the call and shows the canonical set, so both study conditions surface the
 * same six starters. Definitions live in @/lib/score/feedback-chips.
 */
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db/db';
import { scoreIntents } from '@/db/schema';
import { authorizeAssignment, authErrorResponse } from '@/lib/score/authz';
import { callModel, extractJsonObject, isOpenAIConfigured } from '@/lib/score/classifier';
import { ensureIntentTables } from '@/lib/score/intent-store';
import { CHIP_KEYS, CANONICAL_CHIP_TEXT } from '@/lib/score/feedback-chips';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** Small/fast model — same tier as the auto-title nicety (env-overridable). */
const CHIP_MODEL = process.env.SCORE_TITLE_MODEL || 'gpt-5.4-nano';

const SYSTEM = `You tailor feedback templates for SCORE, an instructor tool for a writing-assignment chatbot. The instructor is revising the RULE (response guideline) of one INTENT, a category of student requests. Sending one of the six canonical feedback lines below asks a revision agent to fold that rule element into the rule.

Rewrite EACH line so its wording fits this intent's kind of request (e.g., for a "brainstorm a thesis" intent, "attempt first" becomes asking the student for a rough idea before you help). Keep:
- the element's core demand intact (a guardrail stays a guardrail, etc.),
- the same short imperative instructor-to-agent voice,
- ONE short line each, at most ~15 words,
- plain and readable, concrete over generic.

Do not use em dashes. Answer in JSON with exactly these keys: ${CHIP_KEYS.join(', ')}.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [...CHIP_KEYS],
  properties: Object.fromEntries(
    CHIP_KEYS.map((k) => [k, { type: 'string', description: 'one short line, ≤15 words' }])
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
    return NextResponse.json({ chips: CANONICAL_CHIP_TEXT, tailored: false });
  }

  try {
    const user = [
      `INTENT (when a student…): ${intent.definition}`,
      `CURRENT RULE: ${intent.rule ?? '(none — the chatbot answers these with no guidance of its own)'}`,
      'CANONICAL TEMPLATES:',
      ...CHIP_KEYS.map((k) => `${k}: ${CANONICAL_CHIP_TEXT[k]}`),
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
      chips[k] = typeof v === 'string' && v.trim().length > 0 && v.length <= 400 ? v.trim() : CANONICAL_CHIP_TEXT[k];
    }
    return NextResponse.json({ chips, tailored: true });
  } catch (error) {
    console.error(`SCORE feedback-chip tailoring failed for intent ${intentId}:`, error);
    return NextResponse.json({ chips: CANONICAL_CHIP_TEXT, tailored: false });
  }
}
