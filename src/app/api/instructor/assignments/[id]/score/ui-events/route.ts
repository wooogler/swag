/**
 * SCORE — the browsing half of the study trail (ui-log.ts sends here).
 *
 * Which type scope was open, which question was opened, how long a workbench or
 * a review modal stayed up. None of these touch the server on their own: the
 * board browses in React state, so without this route the trail cannot tell a
 * type that was read from a type that was never looked at — a distinction RQ1
 * turns on, and one the screen recording can only give back by stopwatch.
 *
 * STUDY CLONES ONLY. An ordinary instructor using the board is not a research
 * subject, and their browsing is nobody's data; the gate below drops the batch
 * unless the assignment is a participant clone. The event vocabulary is a fixed
 * list for the same reason a client can never name its own event type.
 *
 * Never fails loudly: a rejected batch returns 204 like an accepted one. This
 * is instrumentation, and a participant mid-block must never see it complain.
 */
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/db';
import { studyClones } from '@/db/schema';
import { authorizeAssignment, authErrorResponse } from '@/lib/score/authz';
import { logStudyEvents } from '@/lib/study/events';

export const dynamic = 'force-dynamic';

/**
 * Every browsing act the trail records, and nothing else.
 *
 * `*_open` / `*_close` come in pairs, the close carrying `dwellMs`. Switching
 * straight from one intent to another is a close and an open, not a move.
 */
const UI_EVENTS = [
  /** The left column's scope: a type, an intent's own question list, etc. */
  'scope_view',
  'scope_leave',
  /** A question opened in the list — the read this route exists for. */
  'query_open',
  'query_close',
  /** The intent workbench (SCORE): definition, corrections, ownership. */
  'intent_open',
  'intent_close',
  /** The rule workbench — an intent's rule (SCORE) or the RULES document. */
  'rule_open',
  'rule_close',
  /** The fold review modal: the dwell here is how long a proposal was read. */
  'fold_open',
  'fold_close',
  /** The deploy modal, where "no rule yet" is visible before the deploy. */
  'deploy_open',
  'deploy_close',
  /** The revision chooser closed without a variant. Nothing is written when a
   * proposal is rejected, so without this a round the instructor threw away
   * looks identical to one that never happened. */
  'proposal_dismiss',
] as const;

const bodySchema = z.object({
  events: z
    .array(
      z.object({
        type: z.enum(UI_EVENTS),
        /** How long before the request the act happened, per the client. */
        agoMs: z.number().int().min(0).max(60 * 60 * 1000),
        payload: z.record(z.unknown()).nullable().optional(),
      })
    )
    .max(100),
});

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: RouteParams) {
  const { id } = await params;
  const auth = await authorizeAssignment(id);
  if ('error' in auth) {
    const { body, status } = authErrorResponse(auth.error);
    return NextResponse.json(body, { status });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return new NextResponse(null, { status: 204 });
  }
  if (body.events.length === 0) return new NextResponse(null, { status: 204 });

  const [clone] = await db
    .select({ id: studyClones.id })
    .from(studyClones)
    .where(eq(studyClones.assignmentId, id))
    .limit(1);
  if (!clone) return new NextResponse(null, { status: 204 });

  const now = Date.now();
  await logStudyEvents(
    id,
    body.events.map((e) => ({
      eventType: e.type,
      payload: (e.payload ?? null) as Record<string, unknown> | null,
      at: new Date(now - e.agoMs),
    }))
  );
  return new NextResponse(null, { status: 204 });
}
