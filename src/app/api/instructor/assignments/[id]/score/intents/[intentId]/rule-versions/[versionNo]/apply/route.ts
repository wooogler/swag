/**
 * SCORE v6 — apply a SAVED rule version to intent queries (Revise modal footer).
 *
 * POST {messageIds[]} → generate what the chatbot would answer for each message
 * under THIS version's rule (same full-history preview builder as the runtime)
 * and store one row per (version, message) in score_rule_version_responses.
 * Re-applying overwrites (upsert) — the stored response is a cache of "this
 * rule on this question", not an audit log.
 *
 * POST {responses: [{messageId, response}]} → store PRE-GENERATED responses
 * instead (the apply-preview flow: the workbench already generated them with
 * the same preview builder, so storing them verbatim avoids paying for — and
 * showing the instructor something different from — a second generation).
 *
 * Batched: ≤6 generated messages per call (mirrors the preview route); the
 * client loops over the intent's question list. Powers the board's per-query
 * version chip and the viewer's version dropdown.
 */
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/db';
import { scoreIntents, scoreRuleVersionResponses, scoreRuleVersions } from '@/db/schema';
import { assignmentBasePrompt } from '@/lib/assignment-ai';
import { authorizeAssignment, authErrorResponse } from '@/lib/score/authz';
import { refuseSimpleClone } from '@/lib/study/simple/route-context';
import { logStudyEvent } from '@/lib/study/events';
import { isOpenAIConfigured } from '@/lib/score/classifier';
import { getChatModel } from '@/lib/score/injection';
import { ensureIntentTables } from '@/lib/score/intent-store';
import { getDraftPreviews } from '@/lib/score/preview-service';
import { ensureScoreTable, getQueryRecords } from '@/lib/score/queries';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_APPLY_MESSAGES = 6;
// Store-only calls carry no LLM work — allow bigger batches.
const MAX_STORE_RESPONSES = 50;

const bodySchema = z
  .object({
    messageIds: z.array(z.number().int().positive()).min(1).max(MAX_APPLY_MESSAGES).optional(),
    responses: z
      .array(
        z.object({
          messageId: z.number().int().positive(),
          response: z.string().min(1).max(20000),
        })
      )
      .min(1)
      .max(MAX_STORE_RESPONSES)
      .optional(),
  })
  .refine((b) => (b.messageIds ? !b.responses : !!b.responses), {
    message: 'send either messageIds (generate) or responses (store), not both',
  });

type RouteParams = { params: Promise<{ id: string; intentId: string; versionNo: string }> };

export async function POST(req: Request, { params }: RouteParams) {
  const { id, intentId: intentIdRaw, versionNo: versionNoRaw } = await params;
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
  const versionNo = Number.parseInt(versionNoRaw, 10);
  if (!Number.isFinite(intentId) || !Number.isFinite(versionNo)) {
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
  const [intents, versions] = await Promise.all([
    db
      .select()
      .from(scoreIntents)
      .where(and(eq(scoreIntents.assignmentId, id), eq(scoreIntents.id, intentId))),
    db
      .select()
      .from(scoreRuleVersions)
      .where(and(eq(scoreRuleVersions.intentId, intentId), eq(scoreRuleVersions.versionNo, versionNo))),
  ]);
  if (!intents[0] || intents[0].archived) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const version = versions[0];
  if (!version || version.assignmentId !== id) {
    return NextResponse.json({ error: 'version_not_found' }, { status: 404 });
  }

  const records = await getQueryRecords(id);
  const recordById = new Map(records.map((r) => [r.messageId, r]));
  const model = getChatModel();

  // Store-only mode: the workbench already generated these (same preview
  // builder) — persist them verbatim for messages of this assignment.
  let responses: Map<number, string>;
  let failed = 0;
  let orderedIds: number[];
  if (body.responses) {
    responses = new Map(
      body.responses.filter((r) => recordById.has(r.messageId)).map((r) => [r.messageId, r.response])
    );
    orderedIds = [...responses.keys()];
  } else {
    const targets = [...new Set(body.messageIds ?? [])]
      .filter((m) => recordById.has(m))
      .map((m) => recordById.get(m)!);
    const basePrompt = assignmentBasePrompt(auth.assignment);
    const result = await getDraftPreviews({
      assignmentId: id,
      records: targets,
      rule: version.rule,
      basePrompt,
      model,
    });
    responses = result.responses;
    failed = result.failed;
    orderedIds = targets.map((t) => t.messageId);
  }

  const now = new Date();
  for (const [messageId, response] of responses) {
    await db
      .insert(scoreRuleVersionResponses)
      .values({
        assignmentId: id,
        intentId,
        ruleVersionId: version.id,
        versionNo: version.versionNo,
        messageId,
        response,
        model,
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: [scoreRuleVersionResponses.ruleVersionId, scoreRuleVersionResponses.messageId],
        set: { response, model, createdAt: now },
      });
  }

  // Not "make this version live" — this generates and caches what the version
  // WOULD answer. Logged anyway: trying a rule against real questions before
  // committing to it is exactly the checking behaviour RQ1 asks about.
  await logStudyEvent(id, 'rule_apply', {
    intentId,
    versionNo: version.versionNo,
    messageCount: orderedIds.length,
    failed,
  });

  return NextResponse.json({
    versionNo: version.versionNo,
    failed,
    responses: orderedIds.map((messageId) => ({
      messageId,
      response: responses.get(messageId) ?? null,
    })),
  });
}
