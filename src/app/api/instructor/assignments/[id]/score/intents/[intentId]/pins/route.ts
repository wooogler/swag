/**
 * SCORE v6 — Boundary Examples (pins) for one intent.
 *
 * POST   {messageId, verdict} → pin an in/out verdict (upsert; re-pinning
 *        flips the verdict and refreshes recency, which moves the pin to the
 *        head of the prompt's latest-first listing).
 * DELETE ?messageId=N → unpin.
 * DELETE ?all=1       → retire every label of this intent (post-refine).
 *
 * EVERY pin goes into the rating prompt (no cap — selectPromptPins), so any pin
 * change moves the intent's defHash and its ratings read as stale — the UI
 * offers a re-rate.
 * Labeling does NOT record a version: the label set is snapshotted on the next
 * Apply/Save, so the history is one entry per Apply, not one per label.
 */
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/db';
import { scoreIntentPins, scoreIntents } from '@/db/schema';
import { authorizeAssignment, authErrorResponse } from '@/lib/score/authz';
import { ensureIntentTables, getAssignmentMessageText } from '@/lib/score/intent-store';

export const dynamic = 'force-dynamic';

const postSchema = z.object({
  messageId: z.number().int().positive(),
  verdict: z.enum(['in', 'out']),
  source: z.enum(['manual', 'ownership']).optional(),
  /** Optional out-pin rationale — stored and injected into the rating prompt.
   * Ignored for 'in' pins. */
  reason: z.string().trim().max(400).optional(),
});

type RouteParams = { params: Promise<{ id: string; intentId: string }> };

async function resolveIntent(assignmentId: string, intentIdRaw: string) {
  const intentId = Number.parseInt(intentIdRaw, 10);
  if (!Number.isFinite(intentId)) return null;
  await ensureIntentTables();
  const rows = await db
    .select()
    .from(scoreIntents)
    .where(and(eq(scoreIntents.id, intentId), eq(scoreIntents.assignmentId, assignmentId)));
  return rows[0] ?? null;
}

export async function POST(req: Request, { params }: RouteParams) {
  const { id, intentId: intentIdRaw } = await params;
  const auth = await authorizeAssignment(id);
  if ('error' in auth) {
    const { body, status } = authErrorResponse(auth.error);
    return NextResponse.json(body, { status });
  }
  const intent = await resolveIntent(id, intentIdRaw);
  if (!intent) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  let body: z.infer<typeof postSchema>;
  try {
    body = postSchema.parse(await req.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'invalid_input', details: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  // Snapshot the pinned question's text at pin time (and reject messages that
  // are not user messages of this assignment).
  const queryText = await getAssignmentMessageText(id, body.messageId);
  if (!queryText) {
    return NextResponse.json({ error: 'message_not_found' }, { status: 404 });
  }

  const now = new Date();
  const set = {
    verdict: body.verdict,
    queryText,
    // A reason only makes sense for an OUT example; clear it on an 'in' pin so a
    // question flipped in→out→in never carries a stale rationale.
    reason: body.verdict === 'out' ? body.reason?.trim() || null : null,
    source: body.source ?? 'manual',
    createdAt: now, // refresh recency so re-pinned examples lead the prompt
  };
  // Labeling does NOT record a version — the label set is captured on the next
  // Apply/Save (its snapshot's pins), so the history stays one entry per Apply.
  await db
    .insert(scoreIntentPins)
    .values({ assignmentId: id, intentId: intent.id, messageId: body.messageId, ...set })
    .onConflictDoUpdate({
      target: [scoreIntentPins.intentId, scoreIntentPins.messageId],
      set,
    });

  return NextResponse.json({ verdict: body.verdict, messageId: body.messageId });
}

export async function DELETE(req: Request, { params }: RouteParams) {
  const { id, intentId: intentIdRaw } = await params;
  const auth = await authorizeAssignment(id);
  if ('error' in auth) {
    const { body, status } = authErrorResponse(auth.error);
    return NextResponse.json(body, { status });
  }
  const intent = await resolveIntent(id, intentIdRaw);
  if (!intent) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // ?all=1 → retire EVERY label of this intent at once. Used after the
  // definition has been rewritten from them (refine): the boundary knowledge now
  // lives in the definition text, and dropping the examples re-rates the log
  // against that definition alone — which is what proves it stands on its own.
  // Un-labeling (like labeling) does NOT record a version.
  const params_ = new URL(req.url).searchParams;
  if (params_.get('all') === '1') {
    const rows = await db
      .delete(scoreIntentPins)
      .where(eq(scoreIntentPins.intentId, intent.id))
      .returning({ id: scoreIntentPins.id });
    return NextResponse.json({ removed: rows.length });
  }

  const messageId = Number.parseInt(params_.get('messageId') ?? '', 10);
  if (!Number.isFinite(messageId)) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const rows = await db
    .delete(scoreIntentPins)
    .where(and(eq(scoreIntentPins.intentId, intent.id), eq(scoreIntentPins.messageId, messageId)))
    .returning({ queryText: scoreIntentPins.queryText });

  return NextResponse.json({ removed: rows.length > 0, messageId });
}
