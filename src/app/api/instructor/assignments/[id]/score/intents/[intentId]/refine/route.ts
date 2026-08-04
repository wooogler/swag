/**
 * SCORE — fold this intent's pending CORRECTIONS into its definition.
 *
 * POST {definition?} → runs the strong fold model (intent-agent.ts) over the
 * current definition draft + every pending correction, and returns a PROPOSED
 * {reasoning, definition, title, corrections[]} where each correction carries
 * the outcome of folding it (reflected + the span that carries it / already /
 * not_reflected).
 *
 * NOTHING IS PERSISTED HERE. The instructor reviews the proposal in the review
 * modal, may edit the text, and only then applies it — which is also the only
 * moment the corrections are consumed. That gate exists because the fold is a
 * lossy LLM rewrite and it is now the ONLY route by which a correction reaches
 * the classifier (the rating prompt carries definitions alone).
 *
 * "send here" corrections make this multi-intent: routing is first-match, so a
 * question can only move if the INTERCEPTING intent's definition narrows. Every
 * other intent holding a pending correction from this one's send-here action is
 * folded in the same response, and the modal applies them together.
 */
import { NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/db';
import { scoreIntentPins, scoreIntents } from '@/db/schema';
import { authorizeAssignment, authErrorResponse } from '@/lib/score/authz';
import { isOpenAIConfigured } from '@/lib/score/classifier';
import { foldCorrections, type FoldCorrection } from '@/lib/score/intent-agent';
import { ensureIntentTables } from '@/lib/score/intent-store';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const bodySchema = z.object({
  // The live textarea draft — unsaved edits should count. Falls back to the
  // stored definition.
  definition: z.string().trim().min(1).max(4000).optional(),
});

type RouteParams = { params: Promise<{ id: string; intentId: string }> };

/** One intent's proposal, as the review modal renders it. */
interface FoldProposal {
  intentId: number;
  title: string;
  /** The text the fold started from — the modal's "Before". */
  before: string;
  after: string;
  suggestedTitle: string | null;
  summary: string;
  corrections: {
    id: number;
    verdict: 'in' | 'out';
    queryText: string;
    reason: string | null;
    outcome: 'reflected' | 'already' | 'not_reflected';
    span: string | null;
    note: string | null;
  }[];
}

export async function POST(req: Request, { params }: RouteParams) {
  const { id, intentId: intentIdRaw } = await params;
  const auth = await authorizeAssignment(id);
  if ('error' in auth) {
    const { body, status } = authErrorResponse(auth.error);
    return NextResponse.json(body, { status });
  }
  if (!isOpenAIConfigured()) {
    return NextResponse.json(
      { error: 'openai_not_configured', message: 'OPENAI_API_KEY is not configured on the server.' },
      { status: 503 }
    );
  }
  const intentId = Number.parseInt(intentIdRaw, 10);
  if (!Number.isFinite(intentId)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  let body: z.infer<typeof bodySchema> = {};
  try {
    body = bodySchema.parse((await req.json().catch(() => ({}))) ?? {});
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'invalid_input', details: error.errors }, { status: 400 });
    }
  }

  await ensureIntentTables();
  const intentRows = await db
    .select()
    .from(scoreIntents)
    .where(and(eq(scoreIntents.id, intentId), eq(scoreIntents.assignmentId, id)));
  const intent = intentRows[0];
  if (!intent) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Pending corrections across the whole assignment: this intent's own, plus
  // the ones its send-here actions left on intercepting intents.
  const pending = await db
    .select()
    .from(scoreIntentPins)
    .where(and(eq(scoreIntentPins.assignmentId, id), eq(scoreIntentPins.status, 'pending')));

  const mine = pending.filter((p) => p.intentId === intentId);
  if (mine.length === 0) {
    return NextResponse.json(
      { error: 'no_corrections', message: 'Mark at least one question in/out first.' },
      { status: 400 }
    );
  }
  // Only intents THIS workbench redirected to. "source === 'route_here'" alone
  // is not that test: it matches every send-here anywhere in the assignment,
  // including one left pending from another intent's workbench — folding here
  // would then rewrite a definition the instructor is not editing and consume
  // someone else's teaching, under a modal caption claiming a chain
  // relationship that does not exist.
  //
  // The real link is the QUESTION. A send-here writes both halves for the same
  // messageId: the in-correction here, the out/route_here on the interceptor.
  // So a sibling is a route_here correction on a message this intent is also
  // correcting IN — nothing else can match.
  const myInMessages = new Set(mine.filter((p) => p.verdict === 'in').map((p) => p.messageId));
  const siblingRows = pending.filter(
    (p) => p.intentId !== intentId && p.source === 'route_here' && myInMessages.has(p.messageId)
  );
  const siblingIds = [...new Set(siblingRows.map((p) => p.intentId))];
  const siblings = siblingIds.length
    ? await db
        .select()
        .from(scoreIntents)
        .where(and(eq(scoreIntents.assignmentId, id), inArray(scoreIntents.id, siblingIds)))
    : [];

  const targets: { row: typeof intent; before: string; rows: typeof pending }[] = [
    // The edited intent uses the LIVE textarea draft, not the stored text: the
    // instructor may have been editing when they hit update, and folding into
    // text they can no longer see would be a silent revert.
    { row: intent, before: body.definition ?? intent.definition, rows: mine },
    ...siblings.map((s) => ({
      row: s,
      before: s.definition,
      // Only the rows that paired with OUR send-here — an interceptor may also
      // hold route_here corrections from a different workbench.
      rows: siblingRows.filter((p) => p.intentId === s.id),
    })),
  ];

  try {
    const proposals: FoldProposal[] = await Promise.all(
      targets.map(async (t) => {
        const corrections: FoldCorrection[] = t.rows.map((p) => ({
          id: p.id,
          verdict: p.verdict as 'in' | 'out',
          queryText: p.queryText,
          reason: p.reason,
        }));
        const result = await foldCorrections({ definition: t.before, corrections });
        const outcomeById = new Map(result.outcomes.map((o) => [o.id, o]));
        return {
          intentId: t.row.id,
          title: t.row.title,
          before: t.before,
          after: result.definition,
          suggestedTitle: result.title,
          summary: result.summary,
          corrections: t.rows.map((p) => {
            const o = outcomeById.get(p.id);
            return {
              id: p.id,
              verdict: p.verdict as 'in' | 'out',
              queryText: p.queryText,
              reason: p.reason,
              outcome: o?.outcome ?? 'not_reflected',
              span: o?.span ?? null,
              note: o?.note ?? null,
            };
          }),
        };
      })
    );
    return NextResponse.json({ proposals });
  } catch (error) {
    console.error('SCORE correction fold failed:', error);
    return NextResponse.json(
      {
        error: 'fold_failed',
        message: 'The model could not fold your corrections into the definition. Try again.',
      },
      { status: 502 }
    );
  }
}
