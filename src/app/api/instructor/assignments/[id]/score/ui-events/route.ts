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
  /** The simple version. Its board has no workbench to open, so the reads
   * worth keeping are which version is being looked at and, inside one
   * conversation, which version its reply was worked out under — a comparison
   * the participant makes without changing anything, and which therefore
   * leaves no other trace. */
  'simple_version_view',
  'simple_local_version_view',
  /** Reading an intent's list from the far end instead of the near one —
   * "what did my words catch that is least like what I meant". It is where a
   * next intent usually comes from, and it writes nothing, so without this
   * there is no trace that anyone went looking. */
  'simple_order_furthest',
  /** An intent begun from a question in the list rather than from the button.
   * Which of the two doors gets used is the shape of the whole session. */
  'simple_intent_from_query',
  /** A search of the students' own words, once the typing settles. Finding a
   * question this way is the one route to it that leaves no other trace, and
   * on the intent arm it partly does what writing a definition does — so the
   * analysis has to be able to see who used it and for what. */
  'simple_search',
  /** Walking back and forward through what was applied this sitting. Both
   * write a version like any other apply, so the trail already holds WHAT
   * happened; these say the participant got there by stepping rather than by
   * editing, which is a different act. */
  'simple_undo',
  'simple_redo',
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
