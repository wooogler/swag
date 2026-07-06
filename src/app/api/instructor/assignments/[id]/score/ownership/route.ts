/**
 * SCORE v6 — commit an ownership decision (§2.4).
 *
 * POST, two shapes:
 *  { intentAId, intentBId, action: 'link', winner: 'a'|'b' }
 *    → the choices converged: declare "loser except winner". The definition
 *      texts stay untouched; the assignment layer resolves the overlap
 *      deterministically from now on. Zero LLM cost.
 *  { intentAId, intentBId, action: 'pins', decisions: [{messageId, choice: 'a'|'b'}] }
 *    → the choices split: each decided question becomes a CONTRAST pair —
 *      pinned 'in' on the chosen intent and 'out' on the other — refining
 *      both boundaries. Pinned questions are settled immediately (pin
 *      overrides); the pins steer future ratings via the prompt.
 *
 * Either way: one transaction, one version snapshot (immediate apply, §1.11).
 */
import { NextResponse } from 'next/server';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/db';
import { scoreIntentLinks, scoreIntentPins, scoreIntents } from '@/db/schema';
import { authorizeAssignment, authErrorResponse } from '@/lib/score/authz';
import {
  ensureIntentTables,
  getAssignmentMessageText,
  recordConfigVersion,
} from '@/lib/score/intent-store';

export const dynamic = 'force-dynamic';

/** Sentinel: reverse link found inside the tx → rolls back, mapped to 409. */
class ReverseLinkExists extends Error {}

const bodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('link'),
    intentAId: z.number().int().positive(),
    intentBId: z.number().int().positive(),
    winner: z.enum(['a', 'b']),
  }),
  z.object({
    action: z.literal('pins'),
    intentAId: z.number().int().positive(),
    intentBId: z.number().int().positive(),
    decisions: z
      .array(
        z.object({
          messageId: z.number().int().positive(),
          choice: z.enum(['a', 'b']),
        })
      )
      .min(1)
      .max(20),
  }),
]);

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorizeAssignment(id);
  if ('error' in auth) {
    const { body, status } = authErrorResponse(auth.error);
    return NextResponse.json(body, { status });
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
  if (body.intentAId === body.intentBId) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  await ensureIntentTables();
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

  if (body.action === 'link') {
    const winner = body.winner === 'a' ? intentA : intentB;
    const loser = body.winner === 'a' ? intentB : intentA;

    try {
      const versionNo = await db.transaction(async (tx) => {
        // Serialize opposite declarations on the same pair: without the lock
        // this is check-then-act, and two racing tabs declaring "A except B"
        // and "B except A" would BOTH pass and dead-end the pair into a
        // permanent boundary (the unique index is on the ordered pair only).
        const [lo, hi] = winner.id < loser.id ? [winner.id, loser.id] : [loser.id, winner.id];
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${lo}, ${hi})`);
        const reverse = await tx
          .select({ id: scoreIntentLinks.id })
          .from(scoreIntentLinks)
          .where(
            and(
              eq(scoreIntentLinks.fromIntentId, winner.id),
              eq(scoreIntentLinks.toIntentId, loser.id)
            )
          );
        if (reverse.length > 0) throw new ReverseLinkExists();

        const inserted = await tx
          .insert(scoreIntentLinks)
          .values({ assignmentId: id, fromIntentId: loser.id, toIntentId: winner.id, createdAt: new Date() })
          .onConflictDoNothing()
          .returning({ id: scoreIntentLinks.id });
        if (inserted.length === 0) return null; // already declared — no version burn
        return recordConfigVersion(tx, id, auth.instructor.id, {
          action: 'add_link',
          intentIds: [loser.id, winner.id],
          detail: `ownership: ${loser.title} except ${winner.title}`,
        });
      });
      return NextResponse.json({ versionNo, link: { fromIntentId: loser.id, toIntentId: winner.id } });
    } catch (error) {
      if (error instanceof ReverseLinkExists) {
        return NextResponse.json(
          { error: 'reverse_link_exists', message: 'The opposite link already exists — remove it first.' },
          { status: 409 }
        );
      }
      throw error;
    }
  }

  // action === 'pins' — dedupe (last decision per question wins; the upsert
  // would otherwise apply duplicates in submission order anyway, but the
  // count and version detail must not lie), then validate every message
  // before writing anything.
  const decisions = [...new Map(body.decisions.map((d) => [d.messageId, d])).values()];
  const texts = new Map<number, string>();
  for (const d of decisions) {
    const text = await getAssignmentMessageText(id, d.messageId);
    if (!text) {
      return NextResponse.json(
        { error: 'message_not_found', messageId: d.messageId },
        { status: 404 }
      );
    }
    texts.set(d.messageId, text);
  }

  const now = new Date();
  const versionNo = await db.transaction(async (tx) => {
    for (const d of decisions) {
      const inIntent = d.choice === 'a' ? intentA : intentB;
      const outIntent = d.choice === 'a' ? intentB : intentA;
      const queryText = texts.get(d.messageId)!;
      for (const [intent, verdict] of [
        [inIntent, 'in'],
        [outIntent, 'out'],
      ] as const) {
        const set = { verdict, queryText, source: 'ownership', createdAt: now };
        await tx
          .insert(scoreIntentPins)
          .values({ assignmentId: id, intentId: intent.id, messageId: d.messageId, ...set })
          .onConflictDoUpdate({
            target: [scoreIntentPins.intentId, scoreIntentPins.messageId],
            set,
          });
      }
    }
    return recordConfigVersion(tx, id, auth.instructor.id, {
      action: 'ownership_pins',
      intentIds: [intentA.id, intentB.id],
      detail: `${decisions.length} contrast pair${decisions.length > 1 ? 's' : ''}`,
    });
  });

  return NextResponse.json({ versionNo, pinned: decisions.length });
}
