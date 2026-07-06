/**
 * SCORE v6 — response comparison for ownership decisions (§1.7/§2.4).
 *
 * POST {intentAId, intentBId, messageIds[]} → for each question × each of the
 * two intents, the chatbot's answer under Base Prompt + that intent's Rule.
 * Generation and caching live in preview-service.ts (shared with the Revise
 * modal) — same model and injection builder as the runtime (preview =
 * runtime), cached per (message, intent) with hash-based staleness.
 *
 * Conversation context is approximated by the question's stored prior turn —
 * a single-turn regeneration, indicative not guaranteed (§4.6; UI states it).
 */
import { NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/db';
import { scoreIntents } from '@/db/schema';
import { assignmentBasePrompt } from '@/lib/assignment-ai';
import { authorizeAssignment, authErrorResponse } from '@/lib/score/authz';
import { isOpenAIConfigured } from '@/lib/score/classifier';
import { getChatModel } from '@/lib/score/injection';
import { ensureIntentTables } from '@/lib/score/intent-store';
import { getCachedRulePreviews } from '@/lib/score/preview-service';
import { ensureScoreTable, getQueryRecords } from '@/lib/score/queries';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// An ownership session compares a handful of questions (§7.6 잠정 3-5) — cap
// hard so one POST stays far inside maxDuration (≤ 2×6 generations).
const MAX_COMPARE_MESSAGES = 6;

const bodySchema = z
  .object({
    intentAId: z.number().int().positive(),
    intentBId: z.number().int().positive(),
    messageIds: z.array(z.number().int().positive()).min(1).max(MAX_COMPARE_MESSAGES),
  })
  .refine((b) => b.intentAId !== b.intentBId, { message: 'cannot compare an intent to itself' });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
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

  await Promise.all([ensureScoreTable(), ensureIntentTables()]);
  const intents = await db
    .select()
    .from(scoreIntents)
    .where(
      and(
        eq(scoreIntents.assignmentId, id),
        inArray(scoreIntents.id, [body.intentAId, body.intentBId])
      )
    );
  const intentA = intents.find((i) => i.id === body.intentAId);
  const intentB = intents.find((i) => i.id === body.intentBId);
  if (!intentA || !intentB || intentA.archived || intentB.archived) {
    return NextResponse.json({ error: 'intent_not_found' }, { status: 404 });
  }

  const records = await getQueryRecords(id);
  const recordById = new Map(records.map((r) => [r.messageId, r]));
  const targets = [...new Set(body.messageIds)]
    .filter((m) => recordById.has(m))
    .map((m) => recordById.get(m)!);

  const model = getChatModel();
  // The FULL runtime base prompt (guidance + optional assignment
  // instructions) — anything less would violate preview = runtime.
  const basePrompt = assignmentBasePrompt(auth.assignment);

  const [a, b] = await Promise.all([
    getCachedRulePreviews({ assignmentId: id, intent: intentA, records: targets, basePrompt, model }),
    getCachedRulePreviews({ assignmentId: id, intent: intentB, records: targets, basePrompt, model }),
  ]);

  return NextResponse.json({
    model,
    failed: a.failed + b.failed,
    comparisons: targets.map((rec) => ({
      messageId: rec.messageId,
      queryText: rec.queryText,
      a: a.responses.get(rec.messageId) ?? null,
      b: b.responses.get(rec.messageId) ?? null,
    })),
    intentA: { id: intentA.id, title: intentA.title, rule: intentA.rule },
    intentB: { id: intentB.id, title: intentB.title, rule: intentB.rule },
  });
}
