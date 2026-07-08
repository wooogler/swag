/**
 * SCORE v6 — refine an intent's DEFINITION from the instructor's labels.
 *
 * POST {definition?} → runs the strong refine model (intent-agent.ts) over the
 * current definition draft + this intent's labeled examples (in/out pins), and
 * returns a PROPOSED {reasoning, definition, title}. Nothing is persisted —
 * the instructor reviews the draft in the modal and saves it explicitly.
 * Requires at least one labeled example.
 */
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/db';
import { scoreIntents } from '@/db/schema';
import { authorizeAssignment, authErrorResponse } from '@/lib/score/authz';
import { isOpenAIConfigured } from '@/lib/score/classifier';
import { refineDefinition } from '@/lib/score/intent-agent';
import { ensureIntentTables, loadIntentState } from '@/lib/score/intent-store';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const bodySchema = z.object({
  // The live textarea draft — unsaved edits should count. Falls back to the
  // stored definition.
  definition: z.string().trim().min(1).max(4000).optional(),
});

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

  let body: z.infer<typeof bodySchema> = {};
  try {
    body = bodySchema.parse((await req.json().catch(() => ({}))) ?? {});
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'invalid_input', details: error.errors }, { status: 400 });
    }
  }

  await ensureIntentTables();
  const intentRows = await db
    .select()
    .from(scoreIntents)
    .where(and(eq(scoreIntents.id, intentId), eq(scoreIntents.assignmentId, id)));
  const intent = intentRows[0];
  if (!intent) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const state = await loadIntentState(id);
  const pins = state.pins.filter((p) => p.intentId === intentId);
  if (pins.length === 0) {
    return NextResponse.json(
      { error: 'no_labels', message: 'Label at least one question in/out first.' },
      { status: 400 }
    );
  }

  try {
    const result = await refineDefinition({
      definition: body.definition ?? intent.definition,
      included: pins.filter((p) => p.verdict === 'in').map((p) => p.queryText),
      excluded: pins.filter((p) => p.verdict === 'out').map((p) => p.queryText),
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error('SCORE definition refine failed:', error);
    return NextResponse.json(
      { error: 'refine_failed', message: 'The model could not produce a refined definition. Try again.' },
      { status: 502 }
    );
  }
}
