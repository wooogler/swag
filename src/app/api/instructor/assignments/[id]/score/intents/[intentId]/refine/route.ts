/**
 * SCORE — fold this intent's pending CORRECTIONS into its definition, and
 * MEASURE the result before anyone is shown it.
 *
 * POST {definition?} → runs the strong fold model (intent-agent.ts) over the
 * current definition draft + every pending correction, then rates the corrected
 * questions against the candidate with the REAL classifier. Corrections it does
 * not reproduce are fed back and the fold is retried, up to MAX_ATTEMPTS. The
 * response carries the proposal plus, per correction, what the classifier
 * actually answered.
 *
 * Why measure at all: the fold model's own "reflected" report is a claim by a
 * different model than the one that judges. It was right often enough to be
 * believed and wrong often enough that instructors watched corrections they had
 * just taught come back reversed on the next Apply — with nothing between the
 * teaching and that reversal. The rating call the check costs is the same call
 * that Apply would make later; running a handful of them here just moves the
 * answer to where it can still change the outcome.
 *
 * NOTHING IS PERSISTED HERE — not even the verification ratings, which are
 * ephemeral (Apply re-rates the whole scope against the definition that is
 * actually saved). The instructor reviews the proposal in the review modal, may
 * edit the text, and only then applies it, which is also the only moment the
 * corrections are consumed.
 *
 * Multi-intent responses are legacy "send here": routing is first-match, so a
 * question could only move if the INTERCEPTING intent's definition narrowed.
 * That flow is gone from the workbench, but pending route_here rows in older
 * data are still folded alongside (unverified — the loop measures this intent).
 */
import { NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/db';
import {
  scoreDissections,
  scoreIntentPins,
  scoreIntentRatings,
  scoreIntents,
  scoreQueryTypes,
  studyReviewQuestions,
} from '@/db/schema';
import { authorizeAssignment, authErrorResponse } from '@/lib/score/authz';
import { logStudyEvent } from '@/lib/study/events';
import { isOpenAIConfigured } from '@/lib/score/classifier';
import { rateMessageIntents } from '@/lib/score/intent-classifier';
import {
  foldCorrections,
  type FoldCorrection,
  type FoldFailure,
} from '@/lib/score/intent-agent';
import { ensureIntentTables } from '@/lib/score/intent-store';
import { createLimiter, SCORE_CONCURRENCY } from '@/lib/score/limiter';
import { getDefaultScoreModel } from '@/lib/score/models';
import { getQueryRecords } from '@/lib/score/queries';
import {
  isIncludedRating,
  type MaterialKind,
  type MaterialSpan,
  type PromptDissection,
} from '@/lib/score/intents';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const bodySchema = z.object({
  // The live textarea draft — unsaved edits should count. Falls back to the
  // stored definition.
  definition: z.string().trim().min(1).max(4000).optional(),
});

/** How many candidates the fold may produce before it settles for the best one.
 * Each round costs one high-effort fold plus one rating call per correction, so
 * this is the ceiling on a wait the instructor spends inside the review modal. */
/**
 * Rewrites per press.
 *
 * Was three. Each retry hands the model the classifier's own reading of the
 * text that failed and asks it to close the gap, which is a pull toward the
 * classifier's literal reading — useful once, and the thing that grew a
 * definition to 1,127 characters when it ran on every correction ever made.
 * Two, now that only NEW decisions can trigger one.
 */
const MAX_ATTEMPTS = 2;
/** Verification is per correction; a workbench with more decisions than this
 * pending is not the case the loop is for, and the wait would stop being one. */
const MAX_VERIFIED = 24;

type RouteParams = { params: Promise<{ id: string; intentId: string }> };

/** What the real classifier answered about one corrected question, reading the
 * candidate definition alone. Null when verification could not run. */
interface VerifiedOutcome {
  rating: string;
  rationale: string;
  /** Did it agree with the instructor? */
  pass: boolean;
}

/** One intent's proposal, as the review modal renders it. */
interface FoldProposal {
  intentId: number;
  title: string;
  /** The text the fold started from — the modal's "Before". */
  before: string;
  after: string;
  suggestedTitle: string | null;
  summary: string;
  /** Measured: how many corrections the candidate reproduces, out of how many
   * were checked, and how many candidates it took. Null when unverified. */
  verifiedPass: number | null;
  verifiedTotal: number | null;
  /** Questions nobody ruled on that this text would newly claim, or release. */
  delta: { gain: { messageId: number; queryText: string }[]; lose: { messageId: number; queryText: string }[] } | null;
  /** How many questions the delta was measured over — null on siblings. */
  deltaScopeSize: number | null;
  attempts: number;
  corrections: {
    id: number;
    /** The question itself — the review modal acts on corrections through the
     * pins API, which is keyed by message. */
    messageId: number;
    verdict: 'in' | 'out';
    queryText: string;
    reason: string | null;
    outcome: 'reflected' | 'already' | 'not_reflected';
    span: string | null;
    note: string | null;
    verified: VerifiedOutcome | null;
    /** A decision a previous fold already took in. */
    standing: boolean;
    taughtCount: number;
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

  // EVERY decision on this assignment — pending and taught alike.
  //
  // A fold used to see only what was new since the last one, which gave the
  // model a single case and nothing to generalize from; the only move available
  // was to append a clause naming it, and ten folds later the definition was a
  // list of its own test cases. The whole ledger is a set of cases with a
  // common rule in it, and the prompt asks for the rule. Taught decisions are
  // marked as such so the model keeps them true rather than writing a phrase
  // for each (intent-agent.ts).
  const pending = await db
    .select()
    .from(scoreIntentPins)
    .where(eq(scoreIntentPins.assignmentId, id));

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
    // Context for the verification calls, loaded once: the judge must read each
    // question exactly as Apply will — same neighbouring turns, same Material
    // split — or the check measures a different prompt than the one it predicts.
    // NEW decisions first: the cap exists so a long ledger cannot blow the
    // route's budget, and if something has to go unmeasured it must not be the
    // decision the instructor just made.
    const verifiable = [...mine]
      .sort((a, b) => Number(a.status !== 'pending') - Number(b.status !== 'pending'))
      .slice(0, MAX_VERIFIED)
      .map((p) => ({
        id: p.id,
        messageId: p.messageId,
        verdict: p.verdict,
        queryText: p.queryText,
        reason: p.reason,
        standing: p.status !== 'pending',
      }));
    // The delta's scope: the questions a move would actually be felt on. On a
    // study clone that is the review set — the material the participant is
    // working from — restricted to this intent's type. Elsewhere it is what the
    // intent claims today plus what is nearly claiming, which is where a
    // boundary moves. Decided questions are excluded: the verification already
    // covers those, and reporting them twice would read as movement.
    const deltaScope = await loadDeltaScope({
      assignmentId: id,
      intentId,
      type: intent.type,
      decided: new Set(mine.map((p) => p.messageId)),
    });
    const contexts = await loadVerifyContexts(id, [
      ...verifiable.map((p) => p.messageId),
      ...deltaScope.map((q) => q.messageId),
    ]);
    const model = getDefaultScoreModel();

    const proposals: FoldProposal[] = await Promise.all(
      targets.map(async (t) => {
        const corrections: FoldCorrection[] = t.rows.map((p) => ({
          id: p.id,
          verdict: p.verdict as 'in' | 'out',
          queryText: p.queryText,
          reason: p.reason,
          standing: p.status !== 'pending',
        }));
        // Only the EDITED intent is measured. A legacy send-here sibling is a
        // second definition being narrowed in the same breath; the loop is about
        // the one the instructor is looking at.
        const verify = t.row.id === intentId ? verifiable : [];
        const { result, verdicts, attempts } = await foldUntilItHolds({
          assignmentId: id,
          intentId: t.row.id,
          before: t.before,
          corrections,
          verify,
          contexts,
          model,
        });
        const outcomeById = new Map(result.outcomes.map((o) => [o.id, o]));
        // Only for the intent being edited — a legacy send-here sibling is
        // being narrowed, and its population is not what the modal is about.
        const delta =
          t.row.id === intentId && deltaScope.length > 0
            ? await measureDelta({
                assignmentId: id,
                intentId,
                definition: result.definition,
                scope: deltaScope,
                contexts,
                model,
              })
            : null;
        return {
          intentId: t.row.id,
          title: t.row.title,
          before: t.before,
          after: result.definition,
          suggestedTitle: result.title,
          summary: result.summary,
          verifiedPass: verdicts ? [...verdicts.values()].filter((v) => v.pass).length : null,
          verifiedTotal: verdicts ? verdicts.size : null,
          attempts,
          /** What else moves, among questions nobody ruled on. */
          delta,
          deltaScopeSize: t.row.id === intentId ? deltaScope.length : null,
          corrections: t.rows.map((p) => {
            const o = outcomeById.get(p.id);
            return {
              id: p.id,
              messageId: p.messageId,
              verdict: p.verdict as 'in' | 'out',
              queryText: p.queryText,
              reason: p.reason,
              outcome: o?.outcome ?? 'not_reflected',
              span: o?.span ?? null,
              note: o?.note ?? null,
              verified: verdicts?.get(p.id) ?? null,
              /** Already folded in before — shown, but never retried on. */
              standing: p.status !== 'pending',
              taughtCount: p.taughtCount ?? 0,
            };
          }),
        };
      })
    );
    // The proposal as it was OFFERED — before the instructor edits, accepts or
    // walks away from it.
    //
    // This used to be counts only, on the reasoning that an accepted fold
    // lands in the next snapshot anyway. It does; what does not land is the
    // rest of the story. A rejected proposal leaves nothing at all, an edited
    // one leaves the edit with no trace of what was edited, and neither leaves
    // the retry count or the verification — which are how the definition
    // ACQUIRES its shape: the loop rewrites until the classifier reproduces
    // the corrections, so a proposal that took three attempts is one that was
    // pushed toward the judge's literal reading, which is where over-specific
    // definitions come from.
    await logStudyEvent(id, 'suggest_fold', {
      intentId,
      correctionCount: mine.length,
      proposalCount: proposals.length,
      proposals: proposals.map((p) => ({
        intentId: p.intentId,
        beforeChars: p.before.length,
        afterChars: p.after.length,
        /** Retries inside one press — 1 means it held the first time. */
        attempts: p.attempts,
        verifiedPass: p.verifiedPass,
        verifiedTotal: p.verifiedTotal,
        suggestedTitle: p.suggestedTitle,
        summary: p.summary,
        // What the candidate would move among questions NOBODY ruled on — the
        // collateral the pilot spent six folds undoing without ever seeing it.
        deltaGain: p.delta?.gain.length ?? null,
        deltaLose: p.delta?.lose.length ?? null,
        deltaScopeSize: p.deltaScopeSize,
        /** The offered text, so an edit is a diff rather than a mystery. */
        definition: p.after,
        outcomes: p.corrections.map((c) => ({
          id: c.id,
          messageId: c.messageId,
          verdict: c.verdict,
          outcome: c.outcome,
          verified: c.verified?.pass ?? null,
          standing: c.standing,
        })),
      })),
    });
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

/** The question as the judge will meet it: neighbouring turns + the Material
 * split. Mirrors what the rate route assembles per message. */
interface VerifyContext {
  queryText: string;
  prevQueryText: string | null;
  prevResponseText: string | null;
  dissection: PromptDissection | null;
}

async function loadVerifyContexts(
  assignmentId: string,
  messageIds: number[]
): Promise<Map<number, VerifyContext>> {
  const out = new Map<number, VerifyContext>();
  if (messageIds.length === 0) return out;
  const wanted = new Set(messageIds);
  const [records, dissections] = await Promise.all([
    getQueryRecords(assignmentId),
    db
      .select({
        messageId: scoreDissections.messageId,
        materialKinds: scoreDissections.materialKinds,
        requests: scoreDissections.requests,
        materials: scoreDissections.materials,
      })
      .from(scoreDissections)
      .where(
        and(
          eq(scoreDissections.assignmentId, assignmentId),
          inArray(scoreDissections.messageId, messageIds)
        )
      ),
  ]);
  const dissectionByMessage = new Map<number, PromptDissection>(
    dissections.map((d) => [
      d.messageId,
      {
        materialKinds: (d.materialKinds ?? []) as MaterialKind[],
        requests: (d.requests ?? []) as string[],
        materials: (Array.isArray(d.materials) ? d.materials : []) as MaterialSpan[],
      },
    ])
  );
  for (const rec of records) {
    if (!wanted.has(rec.messageId)) continue;
    out.set(rec.messageId, {
      queryText: rec.queryText,
      prevQueryText: rec.prevQueryText,
      prevResponseText: rec.prevResponseText,
      dissection: dissectionByMessage.get(rec.messageId) ?? null,
    });
  }
  return out;
}

/**
 * Does the candidate reproduce the instructor's decisions BY ITSELF? One rating
 * call per corrected question, against the candidate alone — nothing is written:
 * these ratings answer a question about a definition that may never be saved,
 * and Apply re-rates the whole scope against whatever is.
 *
 * The pass test is MEMBERSHIP, not the exact level: a question the instructor
 * marked out passes as long as the candidate does not claim it (only clearly_in
 * claims). That is the same test the workbench uses to retire a held pin, and
 * the two must agree — a stricter check here would hold a decision the very next
 * Apply would call satisfied.
 */
async function verifyCandidate(args: {
  intentId: number;
  definition: string;
  rows: { id: number; messageId: number; verdict: string }[];
  contexts: Map<number, VerifyContext>;
  model: string;
}): Promise<Map<number, VerifiedOutcome>> {
  const { intentId, definition, rows, contexts, model } = args;
  const verdicts = new Map<number, VerifiedOutcome>();
  const limit = createLimiter(SCORE_CONCURRENCY);
  await Promise.all(
    rows.map((row) =>
      limit(async () => {
        const ctx = contexts.get(row.messageId);
        if (!ctx) return; // question is gone from the log — nothing to measure
        try {
          const rated = await rateMessageIntents({
            queryText: ctx.queryText,
            prevQueryText: ctx.prevQueryText,
            prevResponseText: ctx.prevResponseText,
            intents: [{ id: intentId, definition }],
            includeDissection: false,
            dissection: ctx.dissection,
            model,
            // A stuck verification must not eat the modal's whole wait.
            callOptions: { timeoutMs: 45_000, maxRetries: 1 },
          });
          const judged = rated.ratings.get(intentId);
          if (!judged) {
            verdicts.set(row.id, {
              rating: 'unrated',
              rationale: 'the classifier returned nothing usable for this question',
              pass: false,
            });
            return;
          }
          verdicts.set(row.id, {
            rating: judged.rating,
            rationale: judged.rationale ?? '',
            pass: (row.verdict === 'in') === (judged.rating === 'clearly_in'),
          });
        } catch (error) {
          console.error(`SCORE fold verification failed for message ${row.messageId}:`, error);
          // A failed CALL is not a failed teaching, but it cannot be called a
          // pass either — it lands as unverified-and-not-passing, which the
          // modal shows as "could not check" and the client holds rather than
          // consumes. Failing safe here means the decision survives.
          verdicts.set(row.id, {
            rating: 'unrated',
            rationale: 'the check could not run for this question',
            pass: false,
          });
        }
      })
    )
  );
  return verdicts;
}

/** How many undecided questions the delta is measured over. */
const MAX_DELTA_SCOPE = 20;

/**
 * The questions a boundary move would be felt on, and what the board says
 * about them today.
 *
 * On a study clone this is the REVIEW SET — the material the participant is
 * actually working from, so "+3 in" names questions they have seen or will.
 * Elsewhere it is what the intent claims now plus what is nearly claiming,
 * which is where a definition's edge actually sits. Decided questions are left
 * out: the verification already reports those, and listing them here again
 * would read as movement when it is teaching.
 */
async function loadDeltaScope(args: {
  assignmentId: string;
  intentId: number;
  type: string | null;
  decided: Set<number>;
}): Promise<{ messageId: number; queryText: string; claimedNow: boolean }[]> {
  const { assignmentId, intentId, type, decided } = args;
  const [reviewRows, ratingRows, records] = await Promise.all([
    db
      .select({ messageId: studyReviewQuestions.messageId })
      .from(studyReviewQuestions)
      .where(eq(studyReviewQuestions.assignmentId, assignmentId)),
    db
      .select({ messageId: scoreIntentRatings.messageId, rating: scoreIntentRatings.rating })
      .from(scoreIntentRatings)
      .where(
        and(
          eq(scoreIntentRatings.assignmentId, assignmentId),
          eq(scoreIntentRatings.intentId, intentId)
        )
      ),
    getQueryRecords(assignmentId),
  ]);
  const ratingByMessage = new Map(ratingRows.map((r) => [r.messageId, r.rating]));
  const textByMessage = new Map(records.map((r) => [r.messageId, r.queryText]));

  let candidates: number[];
  if (reviewRows.length > 0) {
    const typed = type
      ? await db
          .select({ messageId: scoreQueryTypes.messageId })
          .from(scoreQueryTypes)
          .where(
            and(eq(scoreQueryTypes.assignmentId, assignmentId), eq(scoreQueryTypes.type, type))
          )
      : [];
    const ofType = new Set(typed.map((t) => t.messageId));
    candidates = reviewRows
      .map((r) => r.messageId)
      .filter((m) => (type ? ofType.has(m) : true));
  } else {
    candidates = ratingRows
      .filter((r) => r.rating === 'clearly_in' || r.rating === 'probably_in')
      .map((r) => r.messageId);
  }
  return candidates
    .filter((m) => !decided.has(m) && textByMessage.has(m))
    .slice(0, MAX_DELTA_SCOPE)
    .map((m) => ({
      messageId: m,
      queryText: textByMessage.get(m) ?? '',
      claimedNow: isIncludedRating(ratingByMessage.get(m) as never),
    }));
}

/**
 * What ELSE this definition would move, among questions nobody decided on.
 *
 * The verification answers "does the candidate keep my rulings?", which is a
 * question about a dozen questions the instructor has already looked at. It
 * cannot answer the one that actually bites: a definition rewritten to admit
 * one question admits a class, and the rest of that class is sitting in the
 * log. In the pilot a single fold pulled ten unruled questions in, and the six
 * folds after it were spent pushing them back out — with no screen ever saying
 * that was what happened.
 *
 * Measured on the review set where there is one (the questions a study
 * participant is actually working from), else on what the intent claims now
 * plus what is nearly claiming — the two places a boundary moves. Capped,
 * because this runs while a modal waits.
 *
 * NOT fed back into the retry. Whether a move is welcome is exactly the
 * judgement the instructor is here to make, and a model asked to minimise
 * movement would simply write a narrower definition — the failure mode this
 * whole design is about.
 */
async function measureDelta(args: {
  assignmentId: string;
  intentId: number;
  definition: string;
  /** Questions to test, with what the board says about them today. */
  scope: { messageId: number; queryText: string; claimedNow: boolean }[];
  contexts: Map<number, VerifyContext>;
  model: string;
}): Promise<{ gain: { messageId: number; queryText: string }[]; lose: { messageId: number; queryText: string }[] }> {
  const { intentId, definition, scope, contexts, model } = args;
  const gain: { messageId: number; queryText: string }[] = [];
  const lose: { messageId: number; queryText: string }[] = [];
  const limit = createLimiter(SCORE_CONCURRENCY);
  await Promise.all(
    scope.map((q) =>
      limit(async () => {
        const ctx = contexts.get(q.messageId);
        if (!ctx) return;
        try {
          const rated = await rateMessageIntents({
            queryText: ctx.queryText,
            prevQueryText: ctx.prevQueryText,
            prevResponseText: ctx.prevResponseText,
            intents: [{ id: intentId, definition }],
            includeDissection: false,
            dissection: ctx.dissection,
            model,
            callOptions: { timeoutMs: 45_000, maxRetries: 1 },
          });
          const judged = rated.ratings.get(intentId);
          if (!judged) return;
          const claims = isIncludedRating(judged.rating);
          if (claims && !q.claimedNow) gain.push({ messageId: q.messageId, queryText: q.queryText });
          if (!claims && q.claimedNow) lose.push({ messageId: q.messageId, queryText: q.queryText });
        } catch {
          // An unmeasured question is simply absent from the delta — better a
          // short list than a wrong one.
        }
      })
    )
  );
  return { gain, lose };
}

/**
 * Fold, measure, and — when the candidate does not reproduce a decision the
 * instructor has just made — fold again with the failure as evidence. Returns
 * the best candidate seen, which is what the instructor reviews.
 *
 * ONLY NEW DECISIONS DRIVE A RETRY. Every decision is measured, and a standing
 * one the candidate breaks is reported; it is not a reason to rewrite. The
 * retry's whole mechanism is "the classifier read your text and got this
 * wrong — close it", and that pressure points straight at the classifier's
 * literal reading. Applied to one new decision it sharpens a boundary; applied
 * to a ledger of twelve it writes a definition that describes its own test
 * cases, which is the failure this design exists to stop.
 *
 * Bounded three ways: MAX_ATTEMPTS, a wall-clock deadline inside the route's
 * maxDuration, and "stop the moment the new decisions pass". Retrying is not
 * free and a second candidate is not guaranteed to be better, so the best-so-far
 * is kept rather than the last.
 */
async function foldUntilItHolds(args: {
  assignmentId: string;
  intentId: number;
  before: string;
  corrections: FoldCorrection[];
  verify: {
    id: number;
    messageId: number;
    verdict: string;
    queryText: string;
    reason: string | null;
    /** Already folded in once — measured, but never a reason to rewrite. */
    standing: boolean;
  }[];
  contexts: Map<number, VerifyContext>;
  model: string;
}) {
  const { intentId, before, corrections, verify, contexts, model } = args;
  const deadline = Date.now() + 240_000; // inside maxDuration, with room to respond
  let previousAttempt: { definition: string; failures: FoldFailure[] } | undefined;
  let best: {
    result: Awaited<ReturnType<typeof foldCorrections>>;
    verdicts: Map<number, VerifiedOutcome> | null;
    passed: number;
  } | null = null;
  let attempts = 0;

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    attempts += 1;
    const result = await foldCorrections({ definition: before, corrections, previousAttempt });
    if (verify.length === 0) {
      return { result, verdicts: null, attempts };
    }
    const verdicts = await verifyCandidate({
      intentId,
      definition: result.definition,
      rows: verify,
      contexts,
      model,
    });
    // The candidate is scored on the NEW decisions — the ones this fold was
    // called to teach. A standing decision it breaks is reported to the
    // instructor, not repaired behind their back.
    const fresh = verify.filter((row) => !row.standing);
    const freshFailed = fresh.filter((row) => verdicts.get(row.id)?.pass === false);
    const passed = fresh.length - freshFailed.length;
    if (!best || passed > best.passed) best = { result, verdicts, passed };
    if (freshFailed.length === 0) break; // the new teaching holds — done
    if (Date.now() > deadline) break;
    const failures: FoldFailure[] = freshFailed
      .map((row) => {
        const v = verdicts.get(row.id)!;
        return {
          verdict: row.verdict as 'in' | 'out',
          queryText: row.queryText,
          reason: row.reason,
          judgeRating: v.rating,
          judgeRationale: v.rationale,
        };
      });
    previousAttempt = { definition: result.definition, failures };
  }
  return { result: best!.result, verdicts: best!.verdicts, attempts };
}
