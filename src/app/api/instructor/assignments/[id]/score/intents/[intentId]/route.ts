/**
 * SCORE v6 — one intent.
 *
 * PATCH  → edit title/definition/rule, or archive/restore. A definition edit
 *          changes the intent's defHash, so its ratings automatically read as
 *          stale (no explicit invalidation write needed).
 * DELETE → archive (soft): ratings/pins/version history keep referencing the
 *          intent so the timeline and granular revert stay reconstructible.
 */
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/db';
import { scoreIntents } from '@/db/schema';
import { authorizeAssignment, authErrorResponse } from '@/lib/score/authz';
import {
  ensureIntentTables,
  recordConfigVersion,
  type VersionSummary,
} from '@/lib/score/intent-store';

export const dynamic = 'force-dynamic';

const patchSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    definition: z.string().trim().min(1).max(4000).optional(),
    // rule: null clears it back to "No rule yet → base prompt applies".
    rule: z.string().trim().max(8000).nullable().optional(),
    archived: z.boolean().optional(),
    // Provenance for the version timeline (§1.10: which GUI action, anchored
    // on which question, produced this change). Display metadata only.
    provenance: z
      .object({
        via: z.enum(['direct', 'feedback', 'rewrite']),
        anchorMessageId: z.number().int().positive().optional(),
      })
      .optional(),
  })
  .refine(
    (b) => b.title !== undefined || b.definition !== undefined || b.rule !== undefined || b.archived !== undefined,
    { message: 'no fields to update' }
  );

async function loadIntent(assignmentId: string, intentId: number) {
  await ensureIntentTables();
  const rows = await db
    .select()
    .from(scoreIntents)
    .where(and(eq(scoreIntents.id, intentId), eq(scoreIntents.assignmentId, assignmentId)));
  return rows[0] ?? null;
}

type RouteParams = { params: Promise<{ id: string; intentId: string }> };

export async function PATCH(req: Request, { params }: RouteParams) {
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

  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await req.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'invalid_input', details: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const existing = await loadIntent(id, intentId);
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const set: Partial<typeof existing> = { updatedAt: new Date() };
  if (body.title !== undefined) set.title = body.title;
  if (body.definition !== undefined) set.definition = body.definition;
  if (body.rule !== undefined) set.rule = body.rule && body.rule.length > 0 ? body.rule : null;
  if (body.archived !== undefined) set.archived = body.archived;

  // One summary per change; archive/restore dominates for the timeline label.
  const changed = [
    body.definition !== undefined ? 'definition' : null,
    body.rule !== undefined ? 'rule' : null,
    body.title !== undefined ? 'title' : null,
  ]
    .filter(Boolean)
    .join('+');
  const summary: VersionSummary = {
    action:
      body.archived === true
        ? 'archive_intent'
        : body.archived === false && existing.archived
          ? 'restore_intent'
          : 'update_intent',
    intentIds: [intentId],
    messageId: body.provenance?.anchorMessageId,
    detail:
      [changed || null, body.provenance ? `via ${body.provenance.via}` : null]
        .filter(Boolean)
        .join(' · ') || undefined,
  };

  const result = await db.transaction(async (tx) => {
    const rows = await tx
      .update(scoreIntents)
      .set(set)
      .where(and(eq(scoreIntents.id, intentId), eq(scoreIntents.assignmentId, id)))
      .returning();
    const versionNo = await recordConfigVersion(tx, id, auth.instructor.id, summary);
    return { intent: rows[0], versionNo };
  });

  return NextResponse.json({
    intent: {
      id: result.intent.id,
      title: result.intent.title,
      definition: result.intent.definition,
      rule: result.intent.rule,
      archived: result.intent.archived,
      updatedAt: result.intent.updatedAt.toISOString(),
    },
    versionNo: result.versionNo,
  });
}

export async function DELETE(_req: Request, { params }: RouteParams) {
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

  const existing = await loadIntent(id, intentId);
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (existing.archived) return NextResponse.json({ versionNo: null, archived: true });

  const versionNo = await db.transaction(async (tx) => {
    await tx
      .update(scoreIntents)
      .set({ archived: true, updatedAt: new Date() })
      .where(and(eq(scoreIntents.id, intentId), eq(scoreIntents.assignmentId, id)));
    return recordConfigVersion(tx, id, auth.instructor.id, {
      action: 'archive_intent',
      intentIds: [intentId],
      detail: existing.title,
    });
  });

  return NextResponse.json({ versionNo, archived: true });
}
