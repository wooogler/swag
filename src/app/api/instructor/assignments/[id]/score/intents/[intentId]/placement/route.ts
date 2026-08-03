/**
 * SCORE v7 — move an intent inside its type's tree.
 *
 * One endpoint covers both tree edits, because they are the same operation with
 * different arguments: "put this set under PARENT, immediately before BEFORE".
 *   • reorder  → same parent, different neighbour
 *   • move     → different parent (carving a set into/out of another)
 *
 * Placement is pure bookkeeping — position/parent are NOT part of intentDefHash,
 * so a move never re-rates anything (docs/SCORE_v7_intent_tree_design.md §3.4).
 * It IS a routing change though (the chain's order decides who answers first),
 * so it records a major config version like any definition edit.
 *
 * Ordering key is (position ?? id): untouched rows keep creation order, and a
 * move writes an explicit fractional midpoint for the moved row alone. When the
 * gap is exhausted — the midpoint would equal a neighbour — the whole sibling
 * list is renumbered 0,1,2,… in the same transaction and the midpoint retried.
 */
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/db';
import { scoreIntents } from '@/db/schema';
import { authorizeAssignment, authErrorResponse } from '@/lib/score/authz';
import { ensureIntentTables, recordConfigVersion } from '@/lib/score/intent-store';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  /** New enclosing set. null = directly under the type root. A type-root id is
   * accepted and normalized to null, so the client may send either. */
  parentIntentId: z.number().int().positive().nullable().optional(),
  /** Sibling to land immediately before; null/omitted = last among siblings. */
  beforeIntentId: z.number().int().positive().nullable().optional(),
});

/** Effective sort key of a row, mirroring compileChains. */
const keyOf = (r: { id: number; position: number | null }) => r.position ?? r.id;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; intentId: string }> }
) {
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

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse((await req.json().catch(() => ({}))) ?? {});
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'invalid_input', details: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  await ensureIntentTables();

  const result = await db.transaction(async (tx) => {
    const all = await tx
      .select()
      .from(scoreIntents)
      .where(eq(scoreIntents.assignmentId, id));
    const moved = all.find((i) => i.id === intentId);
    if (!moved || moved.kind !== 'intent' || moved.archived) return { error: 'not_found' as const };
    if (!moved.type) return { error: 'untyped' as const };

    // Normalize the parent: a type-root parent means "top level of this type",
    // which the tree stores as NULL so there is exactly one representation.
    let parentId = body.parentIntentId === undefined ? moved.parentIntentId : body.parentIntentId;
    if (parentId !== null) {
      const parent = all.find((i) => i.id === parentId);
      if (!parent || parent.archived) return { error: 'bad_parent' as const };
      if (parent.kind === 'type_root') {
        if (parent.type !== moved.type) return { error: 'cross_type' as const };
        parentId = null;
      } else if (parent.kind !== 'intent' || parent.type !== moved.type) {
        return { error: 'cross_type' as const };
      }
    }
    // A set cannot be moved inside itself or its own descendants.
    if (parentId !== null) {
      const byId = new Map(all.map((i) => [i.id, i]));
      for (let cur: number | null = parentId, guard = 0; cur !== null && guard < 100; guard++) {
        if (cur === intentId) return { error: 'cycle' as const };
        cur = byId.get(cur)?.parentIntentId ?? null;
      }
    }

    const siblings = all
      .filter(
        (i) =>
          i.kind === 'intent' &&
          !i.archived &&
          i.type === moved.type &&
          i.id !== intentId &&
          (i.parentIntentId ?? null) === parentId
      )
      .sort((a, b) => keyOf(a) - keyOf(b) || a.id - b.id);

    const beforeId = body.beforeIntentId ?? null;
    const targetIdx =
      beforeId === null ? siblings.length : siblings.findIndex((s) => s.id === beforeId);
    if (targetIdx === -1) return { error: 'bad_before' as const };

    const computePosition = (list: typeof siblings): number | null => {
      const prev = list[targetIdx - 1];
      const next = list[targetIdx];
      if (!prev && !next) return 0;
      if (!prev) return keyOf(next) - 1;
      if (!next) return keyOf(prev) + 1;
      const mid = (keyOf(prev) + keyOf(next)) / 2;
      // Tie or float exhaustion: no value can sit strictly between them.
      return mid > keyOf(prev) && mid < keyOf(next) ? mid : null;
    };

    let position = computePosition(siblings);
    if (position === null) {
      // Renumber the siblings 0,1,2,… so the gap reopens, then retry. Safe and
      // cheap: position is outside intentDefHash, so nothing re-rates.
      for (let i = 0; i < siblings.length; i++) {
        await tx
          .update(scoreIntents)
          .set({ position: i, updatedAt: new Date() })
          .where(eq(scoreIntents.id, siblings[i].id));
        siblings[i] = { ...siblings[i], position: i };
      }
      position = computePosition(siblings);
      if (position === null) return { error: 'reorder_failed' as const };
    }

    const reparented = (moved.parentIntentId ?? null) !== parentId;
    await tx
      .update(scoreIntents)
      .set({ parentIntentId: parentId, position, updatedAt: new Date() })
      .where(and(eq(scoreIntents.id, intentId), eq(scoreIntents.assignmentId, id)));

    const versionNo = await recordConfigVersion(tx, id, auth.instructor.id, {
      action: reparented ? 'move_intent' : 'reorder_intent',
      intentIds: [intentId],
      detail: moved.title,
    });
    return { versionNo, parentIntentId: parentId, position };
  });

  if ('error' in result) {
    const status = result.error === 'not_found' ? 404 : 400;
    const message =
      result.error === 'untyped'
        ? 'This intent has no query type yet, so it has no place in a tree.'
        : result.error === 'cross_type'
          ? 'An intent can only move inside its own query type.'
          : result.error === 'cycle'
            ? 'An intent cannot be moved inside itself.'
            : undefined;
    return NextResponse.json({ error: result.error, ...(message ? { message } : {}) }, { status });
  }
  return NextResponse.json(result);
}
