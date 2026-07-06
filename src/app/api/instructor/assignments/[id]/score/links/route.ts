/**
 * SCORE v6 — Exception Links ("A except B") for one assignment.
 *
 * POST   {fromIntentId, toIntentId} → declare; when a question is included by
 *        both, B (toIntentId) owns it. Zero LLM cost — the link is applied in
 *        the deterministic assignment resolver.
 * DELETE ?from=&to= → remove (undo = 원복, §1.7).
 *
 * Kept unidirectional & acyclic at this write layer: a link to itself or the
 * exact reverse of an existing link is rejected (the resolver would otherwise
 * dead-end the pair into a permanent boundary).
 */
import { NextResponse } from 'next/server';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/db';
import { scoreIntentLinks, scoreIntents } from '@/db/schema';
import { authorizeAssignment, authErrorResponse } from '@/lib/score/authz';
import { ensureIntentTables, recordConfigVersion } from '@/lib/score/intent-store';

export const dynamic = 'force-dynamic';

/** Sentinel: reverse link found inside the tx → rolls back, mapped to 409. */
class ReverseLinkExists extends Error {}

const postSchema = z
  .object({
    fromIntentId: z.number().int().positive(),
    toIntentId: z.number().int().positive(),
  })
  .refine((b) => b.fromIntentId !== b.toIntentId, { message: 'cannot link an intent to itself' });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorizeAssignment(id);
  if ('error' in auth) {
    const { body, status } = authErrorResponse(auth.error);
    return NextResponse.json(body, { status });
  }

  let body: z.infer<typeof postSchema>;
  try {
    body = postSchema.parse(await req.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'invalid_input', details: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  await ensureIntentTables();
  const intents = await db
    .select({ id: scoreIntents.id, archived: scoreIntents.archived })
    .from(scoreIntents)
    .where(
      and(
        eq(scoreIntents.assignmentId, id),
        inArray(scoreIntents.id, [body.fromIntentId, body.toIntentId])
      )
    );
  if (intents.length !== 2 || intents.some((i) => i.archived)) {
    return NextResponse.json({ error: 'intent_not_found' }, { status: 404 });
  }

  try {
    const versionNo = await db.transaction(async (tx) => {
      // In-tx reverse check behind a normalized advisory lock — two racing
      // opposite declarations would otherwise both pass the guard and create
      // a mutual pair the resolver can only treat as a permanent boundary.
      const [lo, hi] =
        body.fromIntentId < body.toIntentId
          ? [body.fromIntentId, body.toIntentId]
          : [body.toIntentId, body.fromIntentId];
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${lo}, ${hi})`);
      const reverse = await tx
        .select({ id: scoreIntentLinks.id })
        .from(scoreIntentLinks)
        .where(
          and(
            eq(scoreIntentLinks.fromIntentId, body.toIntentId),
            eq(scoreIntentLinks.toIntentId, body.fromIntentId)
          )
        );
      if (reverse.length > 0) throw new ReverseLinkExists();

      const inserted = await tx
        .insert(scoreIntentLinks)
        .values({
          assignmentId: id,
          fromIntentId: body.fromIntentId,
          toIntentId: body.toIntentId,
          createdAt: new Date(),
        })
        .onConflictDoNothing() // idempotent re-declare
        .returning({ id: scoreIntentLinks.id });
      // Re-declaring an existing link changes nothing — don't burn a version.
      if (inserted.length === 0) return null;
      return recordConfigVersion(tx, id, auth.instructor.id, {
        action: 'add_link',
        intentIds: [body.fromIntentId, body.toIntentId],
      });
    });
    return NextResponse.json({ versionNo }, { status: 201 });
  } catch (error) {
    if (error instanceof ReverseLinkExists) {
      return NextResponse.json(
        { error: 'reverse_link_exists', message: 'The reverse link already exists — remove it first.' },
        { status: 409 }
      );
    }
    throw error;
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorizeAssignment(id);
  if ('error' in auth) {
    const { body, status } = authErrorResponse(auth.error);
    return NextResponse.json(body, { status });
  }

  const url = new URL(req.url);
  const from = Number.parseInt(url.searchParams.get('from') ?? '', 10);
  const to = Number.parseInt(url.searchParams.get('to') ?? '', 10);
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  await ensureIntentTables();
  const versionNo = await db.transaction(async (tx) => {
    const removed = await tx
      .delete(scoreIntentLinks)
      .where(
        and(
          eq(scoreIntentLinks.assignmentId, id),
          eq(scoreIntentLinks.fromIntentId, from),
          eq(scoreIntentLinks.toIntentId, to)
        )
      )
      .returning({ id: scoreIntentLinks.id });
    if (removed.length === 0) return null;
    return recordConfigVersion(tx, id, auth.instructor.id, {
      action: 'remove_link',
      intentIds: [from, to],
    });
  });

  return NextResponse.json({ versionNo });
}
