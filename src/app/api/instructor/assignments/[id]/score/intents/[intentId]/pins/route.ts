/**
 * SCORE v6 — Boundary Examples (pins) for one intent.
 *
 * POST   {messageId, verdict} → pin an in/out verdict (upsert; re-pinning
 *        flips the verdict and refreshes recency, which promotes the pin in
 *        the prompt's latest-first selection).
 * DELETE ?messageId=N → unpin.
 *
 * Pins change what the rating prompt contains, so the intent's defHash moves
 * and its ratings read as stale automatically — the UI offers a re-rate.
 * Every pin change is a config change → version snapshot in-transaction.
 */
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/db';
import { scoreIntentPins, scoreIntents } from '@/db/schema';
import { authorizeAssignment, authErrorResponse } from '@/lib/score/authz';
import {
  ensureIntentTables,
  getAssignmentMessageText,
  recordConfigVersion,
} from '@/lib/score/intent-store';

export const dynamic = 'force-dynamic';

const postSchema = z.object({
  messageId: z.number().int().positive(),
  verdict: z.enum(['in', 'out']),
  source: z.enum(['manual', 'ownership']).optional(),
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
  const versionNo = await db.transaction(async (tx) => {
    const set = {
      verdict: body.verdict,
      queryText,
      source: body.source ?? 'manual',
      createdAt: now, // refresh recency so re-pinned examples lead the prompt
    };
    await tx
      .insert(scoreIntentPins)
      .values({ assignmentId: id, intentId: intent.id, messageId: body.messageId, ...set })
      .onConflictDoUpdate({
        target: [scoreIntentPins.intentId, scoreIntentPins.messageId],
        set,
      });
    return recordConfigVersion(tx, id, auth.instructor.id, {
      action: 'add_pin',
      intentIds: [intent.id],
      messageId: body.messageId,
      detail: body.verdict,
    });
  });

  return NextResponse.json({ versionNo, verdict: body.verdict, messageId: body.messageId });
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

  const messageId = Number.parseInt(new URL(req.url).searchParams.get('messageId') ?? '', 10);
  if (!Number.isFinite(messageId)) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const versionNo = await db.transaction(async (tx) => {
    const removed = await tx
      .delete(scoreIntentPins)
      .where(
        and(eq(scoreIntentPins.intentId, intent.id), eq(scoreIntentPins.messageId, messageId))
      )
      .returning({ id: scoreIntentPins.id });
    if (removed.length === 0) return null; // nothing to record
    return recordConfigVersion(tx, id, auth.instructor.id, {
      action: 'remove_pin',
      intentIds: [intent.id],
      messageId,
    });
  });

  return NextResponse.json({ versionNo, messageId });
}
