/**
 * SCORE — APPLY a reviewed fold: write the new definition(s), consume the
 * corrections they carry, and hold the ones they do not, in one transaction.
 *
 * POST {applies: [{intentId, definition, title?}], correctionIds, holdIds?}
 *
 * Which is which was MEASURED by the refine route (it rated each corrected
 * question against the candidate with the real classifier), so this split is a
 * result rather than a guess. A consumed correction survives only as a display
 * marker ("you marked this in at v2"); a held one keeps overriding the judgment
 * until some later definition reproduces it. Consuming and rewriting MUST be
 * atomic — a definition saved without consuming would re-fold the same
 * corrections forever, and corrections consumed without the definition would
 * erase the instructor's teaching outright.
 *
 * The definition sent here is whatever the instructor left in the modal, not
 * necessarily what the model proposed: the review gate exists so they can edit
 * it, so this route trusts the text it is given.
 *
 * Ratings are NOT touched. A new definition means a new intentDefHash, so every
 * rating of these intents reads stale on the next load and the workbench's
 * Apply re-rates them — the same path any definition edit takes.
 */
import { NextResponse } from 'next/server';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/db';
import { scoreIntentPins, scoreIntents } from '@/db/schema';
import { authorizeAssignment, authErrorResponse } from '@/lib/score/authz';
import { logStudyEvent } from '@/lib/study/events';
import {
  ensureIntentTables,
  recordConfigVersion,
  type VersionSummary,
} from '@/lib/score/intent-store';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  applies: z
    .array(
      z.object({
        intentId: z.number().int().positive(),
        definition: z.string().trim().min(1).max(4000),
        title: z.string().trim().min(1).max(200).optional(),
      })
    )
    .min(1)
    .max(10),
  /** The corrections these definitions absorbed — verified to survive in the
   * text, so they can stop being corrections. Ids are re-checked server-side
   * against the intents being written, so a stale client cannot consume
   * somebody else's pending work. May be EMPTY: a fold where the classifier
   * reproduced none of the decisions still writes the definition, and holds all
   * of them. */
  correctionIds: z.array(z.number().int().positive()).max(500),
  /** The corrections the definitions did NOT absorb. They stay, as HELD: the
   * instructor decided, the definition measurably cannot reproduce it, so the
   * decision keeps overriding the judgment until it can. Passing none is fine —
   * a fold where everything held has nothing to hold back. */
  holdIds: z.array(z.number().int().positive()).max(500).optional(),
});

type RouteParams = { params: Promise<{ id: string; intentId: string }> };

export async function POST(req: Request, { params }: RouteParams) {
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
    body = bodySchema.parse(await req.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'invalid_input', details: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  await ensureIntentTables();

  // Every intent being written must belong to this assignment, and the edited
  // one must be among them — the route is scoped to that workbench.
  const targetIds = [...new Set(body.applies.map((a) => a.intentId))];
  if (!targetIds.includes(intentId)) {
    return NextResponse.json({ error: 'invalid_input', message: 'intent not in applies' }, { status: 400 });
  }
  const owned = await db
    .select({ id: scoreIntents.id, title: scoreIntents.title })
    .from(scoreIntents)
    .where(and(eq(scoreIntents.assignmentId, id), inArray(scoreIntents.id, targetIds)));
  if (owned.length !== targetIds.length) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const now = new Date();
  const result = await db.transaction(async (tx) => {
    for (const a of body.applies) {
      await tx
        .update(scoreIntents)
        .set({
          definition: a.definition,
          ...(a.title ? { title: a.title } : {}),
          updatedAt: now,
        })
        .where(and(eq(scoreIntents.id, a.intentId), eq(scoreIntents.assignmentId, id)));
    }

    // Consume ONLY live corrections that belong to the intents just rewritten.
    // Anything else in the id list is ignored rather than trusted. HELD rows are
    // consumable too: a held decision that the new definition finally reproduces
    // is one the definition has caught up with, which is the whole point of
    // holding it.
    const consumed = await tx
      .update(scoreIntentPins)
      .set({ status: 'consumed', consumedAt: now, consumedAtVersion: null })
      .where(
        and(
          eq(scoreIntentPins.assignmentId, id),
          inArray(scoreIntentPins.status, ['pending', 'held']),
          inArray(scoreIntentPins.intentId, targetIds),
          inArray(scoreIntentPins.id, body.correctionIds)
        )
      )
      .returning({ id: scoreIntentPins.id });

    // …and the ones it could not carry become (or stay) held.
    if (body.holdIds?.length) {
      await tx
        .update(scoreIntentPins)
        .set({ status: 'held' })
        .where(
          and(
            eq(scoreIntentPins.assignmentId, id),
            inArray(scoreIntentPins.status, ['pending', 'held']),
            inArray(scoreIntentPins.intentId, targetIds),
            inArray(scoreIntentPins.id, body.holdIds)
          )
        );
    }

    const titleOf = new Map(owned.map((o) => [o.id, o.title]));
    const summary: VersionSummary = {
      action: 'update_intent',
      intentIds: targetIds,
      detail:
        `definition from ${consumed.length} correction${consumed.length === 1 ? '' : 's'}` +
        (targetIds.length > 1
          ? ` · also narrowed ${targetIds
              .filter((t) => t !== intentId)
              .map((t) => `“${titleOf.get(t) ?? t}”`)
              .join(', ')}`
          : ''),
      minor: true,
    };
    const versionNo = await recordConfigVersion(tx, id, auth.instructor.id, summary);

    // The marker cites the version the fold produced — known only now.
    if (consumed.length > 0 && versionNo !== null) {
      await tx
        .update(scoreIntentPins)
        .set({ consumedAtVersion: versionNo })
        .where(
          and(
            eq(scoreIntentPins.assignmentId, id),
            inArray(
              scoreIntentPins.id,
              consumed.map((c) => c.id)
            )
          )
        );
    }
    return { consumed: consumed.length, versionNo, applies: body.applies };
  });

  // Anything still pending on these intents was NOT part of this fold (the
  // instructor may have labelled more while the modal was open). Report it so
  // the client can keep showing the waiting card instead of silently clearing.
  const stillPending = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(scoreIntentPins)
    .where(
      and(
        eq(scoreIntentPins.assignmentId, id),
        eq(scoreIntentPins.status, 'pending'),
        inArray(scoreIntentPins.intentId, targetIds)
      )
    );

  // What the instructor DID with the proposal.
  //
  // The config version records the definition that landed; it cannot say
  // whether that text is the model's or the instructor's, because the review
  // modal lets them edit before applying. Pairing this with the `suggest_fold`
  // that preceded it is what separates "accepted as offered" from "rewrote it"
  // — and, with the modal's dwell (fold_open/fold_close), from "accepted
  // without reading".
  await logStudyEvent(id, 'fold_apply', {
    intentId,
    versionNo: result.versionNo,
    consumed: result.consumed,
    held: body.holdIds?.length ?? 0,
    stillPending: stillPending[0]?.n ?? 0,
    applied: body.applies.map((a) => ({
      intentId: a.intentId,
      chars: a.definition.length,
      titleChanged: !!a.title,
      definition: a.definition,
    })),
  });

  return NextResponse.json({
    consumed: result.consumed,
    versionNo: result.versionNo,
    stillPending: stillPending[0]?.n ?? 0,
  });
}
