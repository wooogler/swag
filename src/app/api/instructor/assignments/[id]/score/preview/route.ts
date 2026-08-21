/**
 * SCORE v6 — response previews for the Revise modal (§1.10/§2.2).
 *
 * POST {intentId, messageIds[], draftRule?} →
 *  - draftRule ABSENT → previews under the intent's SAVED rule ("Original
 *    Response" column), read-through-cached in score_rule_previews.
 *  - draftRule PRESENT (string, or null = base-only) → previews under the
 *    candidate rule ("Updated Response" column), generated fresh and never
 *    cached — drafts churn within an editing session.
 *
 * Both sides run through preview-service (same injection builder + model as
 * the runtime) so before/after differences are attributable to the rule
 * change alone.
 */
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/db';
import { scoreIntents } from '@/db/schema';
import { assignmentBasePrompt } from '@/lib/assignment-ai';
import { authorizeAssignment, authErrorResponse } from '@/lib/score/authz';
import { refuseSimpleClone } from '@/lib/study/simple/route-context';
import { isOpenAIConfigured } from '@/lib/score/classifier';
import { getChatModel } from '@/lib/score/injection';
import { ensureIntentTables } from '@/lib/score/intent-store';
import { getCachedRulePreviews, getDraftPreviews } from '@/lib/score/preview-service';
import { ensureScoreTable, getQueryRecords } from '@/lib/score/queries';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_PREVIEW_MESSAGES = 6;

const bodySchema = z.object({
  intentId: z.number().int().positive(),
  messageIds: z.array(z.number().int().positive()).min(1).max(MAX_PREVIEW_MESSAGES),
  // Distinguish "absent" (saved rule) from null (draft with NO rule).
  draftRule: z.string().trim().max(8000).nullable().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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

  let body: z.infer<typeof bodySchema>;
  let hasDraft: boolean;
  try {
    const json = await req.json();
    body = bodySchema.parse(json);
    hasDraft = Object.prototype.hasOwnProperty.call(json ?? {}, 'draftRule');
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
    .where(and(eq(scoreIntents.assignmentId, id), eq(scoreIntents.id, body.intentId)));
  const intent = intents[0];
  if (!intent || intent.archived) {
    return NextResponse.json({ error: 'intent_not_found' }, { status: 404 });
  }

  const records = await getQueryRecords(id);
  const recordById = new Map(records.map((r) => [r.messageId, r]));
  const targets = [...new Set(body.messageIds)]
    .filter((m) => recordById.has(m))
    .map((m) => recordById.get(m)!);

  const model = getChatModel();
  const basePrompt = assignmentBasePrompt(auth.assignment);

  const result = hasDraft
    ? await getDraftPreviews({ assignmentId: id, records: targets, rule: body.draftRule ?? null, basePrompt, model })
    : await getCachedRulePreviews({ assignmentId: id, intent, records: targets, basePrompt, model });

  return NextResponse.json({
    model,
    failed: result.failed,
    previews: targets.map((rec) => ({
      messageId: rec.messageId,
      response: result.responses.get(rec.messageId) ?? null,
    })),
  });
}
