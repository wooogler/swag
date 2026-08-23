/**
 * SCORE v6 — batch intent rating (dissection + 5-level ratings per intent).
 *
 * Same client-driven batch contract as classify/route.ts: POST processes a
 * call-bounded batch and reports remaining; the client loops until 0.
 *
 * One LLM call covers ONE (message, intent) pair — see INTENTS_PER_RATING_CALL
 * for the measurement that forced that, and why the batch below is bounded by
 * calls rather than by messages. Staleness is per (message, intent) via
 * intentDefHash — editing one intent (or its pins) re-rates only that intent.
 * Exclusive assignment is NOT stored: it is derived at read time by the
 * deterministic resolver (intents.ts), so link edits re-assign instantly with
 * zero LLM cost.
 *
 * Optional `intentIds` scopes a run to specific intents — the New Intent
 * modal uses this to rate a freshly created intent across the log without
 * touching the rest.
 */
import { NextResponse } from 'next/server';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/db';
import {
  scoreDissections,
  scoreIntentPins,
  scoreIntentRatings,
  scoreQueryEmbeddings,
  scoreQueryTypes,
} from '@/db/schema';
import { authorizeAssignment, authErrorResponse } from '@/lib/score/authz';
import { refuseSimpleClone } from '@/lib/study/simple/route-context';
import { isOpenAIConfigured } from '@/lib/score/classifier';
import { rateMessageIntents } from '@/lib/score/intent-classifier';
import { classifyMessageType } from '@/lib/score/type-classifier';
import { computeDissections, hasEditorEventLog } from '@/lib/score/dissect';
import {
  ensureIntentTables,
  loadIntentState,
  pickDisplayRatings,
  type PromptReadyIntent,
} from '@/lib/score/intent-store';
import {
  DISSECTION_VERSION,
  isIncludedRating,
  isRatingLevel,
  TYPE_CLASSIFIER_VERSION,
  type DissectionResult,
  type MaterialKind,
  type MaterialSpan,
  type PromptDissection,
} from '@/lib/score/intents';
import { chunkForRating } from '@/lib/score/intent-prompts';
import { createLimiter, SCORE_CONCURRENCY } from '@/lib/score/limiter';
import { getDefaultScoreModel } from '@/lib/score/models';
import { ensureScoreTable, getQueryRecords, type QueryRecord } from '@/lib/score/queries';
import { logStudyEvent } from '@/lib/study/events';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DEFAULT_MESSAGE_LIMIT = 40;
// Raised so a single shard POST can drain its whole partition in one round
// trip: the client fans out shardCount POSTs in parallel, each handling a
// disjoint messageId slice, so one wave of the concurrency pool applies the
// intent to the entire log at once (rate-limit headroom is ~500 req/s).
const MAX_MESSAGE_LIMIT = 150;

// One rating call is heavier than a Classifier B call (multi-intent prompt,
// effort 'low'), so budget fewer waves than classify's 12 — ~8 waves of the
// pool ≈ 25-30s per POST at ~2-3s/call, inside maxDuration.
const CALLS_PER_BATCH = Math.min(400, Math.max(8, SCORE_CONCURRENCY * 8));

const bodySchema = z.object({
  limit: z.number().int().positive().max(MAX_MESSAGE_LIMIT).optional(),
  force: z.boolean().optional(),
  // Scope the run (and force) to these intents — e.g. the New Intent flow.
  intentIds: z.array(z.number().int().positive()).max(50).optional(),
  // Scope the run to these messages — the workbench's two-phase Apply rates
  // the queries the instructor is LOOKING AT first (a nested intent's
  // enclosing scope), then sweeps the rest in the background without them.
  // total/rated/remaining then describe only this subset, so the progress
  // bar is the visible scope's bar.
  messageIds: z.array(z.number().int().positive()).max(5000).optional(),
  // Deterministic parallel sharding: this POST only handles messages whose
  // (messageId % shardCount) === shardIndex. The client dispatches shardCount
  // POSTs at once so the whole log is rated in one wave. Defaults = no shard.
  shardIndex: z.number().int().min(0).max(63).optional(),
  shardCount: z.number().int().min(1).max(64).optional(),
  model: z.string().optional(), // vestigial — server uses SCORE_RATING_MODEL env
});

type Shard = { index: number; count: number };
const NO_SHARD: Shard = { index: 0, count: 1 };

/** True when messageId falls in this shard's disjoint partition. */
function inShard(messageId: number, shard: Shard): boolean {
  if (shard.count <= 1) return true;
  return ((messageId % shard.count) + shard.count) % shard.count === shard.index;
}

interface MessageJob {
  record: QueryRecord;
  staleIntents: PromptReadyIntent[];
  needsDissection: boolean;
  /** v7: no score_query_types row yet (or one below TYPE_CLASSIFIER_VERSION). */
  needsType: boolean;
}

/**
 * Pending work per message against the CURRENT intent config. A rating row is
 * stale when missing or its stored def_hash ≠ the intent's current defHash;
 * a dissection is stale when missing or below DISSECTION_VERSION; a type
 * judgment is stale when missing or below TYPE_CLASSIFIER_VERSION. Dissection
 * piggybacks on intent-scoped runs only when the message is already being
 * rated (the modal loop should not re-dissect the whole log).
 *
 * The type pass is intent-INDEPENDENT: it must run even on a board with zero
 * intents, because the v7 entry experience is browsing the log by type BEFORE
 * any intent exists. So it is computed outside the "no intents in scope" guard
 * that suppresses rating/dissection work.
 */
async function loadRateStatus(
  assignmentId: string,
  promptReady: PromptReadyIntent[],
  scopedIntentIds: number[] | null,
  shard: Shard = NO_SHARD,
  messageIds: number[] | null = null
) {
  const allRecords = await getQueryRecords(assignmentId);
  // Restrict to this shard's disjoint slice so parallel POSTs never rate the
  // same message twice; `total`/`remaining` then reflect the shard (the client
  // sums across shards for the aggregate progress bar). A message scope cuts
  // further: the run covers (and counts) only those messages.
  const msgScope = messageIds ? new Set(messageIds) : null;
  const records = allRecords.filter(
    (r) =>
      (shard.count <= 1 || inShard(r.messageId, shard)) &&
      (msgScope === null || msgScope.has(r.messageId))
  );
  const wanted = scopedIntentIds
    ? promptReady.filter((p) => scopedIntentIds.includes(p.intent.id))
    : promptReady;
  // No intents in scope → no RATING work (and no dissection-only sweep, which
  // would churn the whole log for a viewer nicety). Type work still applies.
  const noIntents = wanted.length === 0;

  const [ratingRows, dissectionRows, typeRows, ownsEventLog] = await Promise.all([
    noIntents
      ? Promise.resolve([])
      : db
          .select({
            messageId: scoreIntentRatings.messageId,
            intentId: scoreIntentRatings.intentId,
            defHash: scoreIntentRatings.defHash,
          })
          .from(scoreIntentRatings)
          .where(eq(scoreIntentRatings.assignmentId, assignmentId)),
    db
      .select({ messageId: scoreDissections.messageId, version: scoreDissections.version })
      .from(scoreDissections)
      .where(eq(scoreDissections.assignmentId, assignmentId)),
    db
      .select({
        messageId: scoreQueryTypes.messageId,
        type: scoreQueryTypes.type,
        version: scoreQueryTypes.version,
      })
      .from(scoreQueryTypes)
      .where(eq(scoreQueryTypes.assignmentId, assignmentId)),
    hasEditorEventLog(assignmentId),
  ]);

  // Hash-keyed history: a (message, intent) can hold rows for several specs.
  // Pending = no row exists for the intent's CURRENT hash.
  const hashesByMessage = new Map<number, Set<string>>();
  for (const r of ratingRows) {
    let s = hashesByMessage.get(r.messageId);
    if (!s) {
      s = new Set();
      hashesByMessage.set(r.messageId, s);
    }
    s.add(`${r.intentId}:${r.defHash}`);
  }
  const dissectionFresh = new Set(
    dissectionRows.filter((d) => d.version >= DISSECTION_VERSION).map((d) => d.messageId)
  );
  const typeFresh = new Set(
    typeRows.filter((t) => t.version >= TYPE_CLASSIFIER_VERSION).map((t) => t.messageId)
  );
  const typeByMessage = new Map(
    typeRows.filter((t) => t.version >= TYPE_CLASSIFIER_VERSION).map((t) => [t.messageId, t.type])
  );

  /**
   * v7 scoping (plan invariant 4): an intent that carries a `type` is judged
   * ONLY against that type's queries — the tree is per-type, so a rating for a
   * query of another type could never be routed anywhere and would be pure
   * spend. Type-LESS rows stay whole-log: starter/preset templates back the
   * baseline condition's searches (which sweep the entire log by definition),
   * and pre-backfill intents must keep behaving exactly as they did.
   *
   * Deliberately NOT keyed on isTemplate: a create-flow draft is isTemplate
   * until Save yet already carries its type, and rating it against the whole
   * log would cost ~4x for judgments the chain can never use.
   */
  const isNeeded = (p: PromptReadyIntent, messageType: string | undefined): boolean => {
    if (!p.intent.type) return true; // type-less → whole-log (templates, legacy)
    return p.intent.type === messageType;
  };
  /** Any wanted intent whose scope depends on knowing the message's type. */
  const wantedNeedsTypes = wanted.some((p) => !!p.intent.type);

  const jobs: MessageJob[] = [];
  for (const record of records) {
    const have = hashesByMessage.get(record.messageId);
    const messageType = typeByMessage.get(record.messageId);
    const staleIntents = noIntents
      ? []
      : wanted.filter(
          (p) => isNeeded(p, messageType) && !have?.has(`${p.intent.id}:${p.defHash}`)
        );
    // An intent-scoped run (the workbench Apply loop) types a message when it
    // must: a TYPED intent's scope is undecidable until the message has a type,
    // so without this an untyped message would yield neither a type job nor a
    // rating job and the intent would silently never see it. When every wanted
    // intent is type-less (a template), the old piggyback policy stands and the
    // Apply does not sweep the log.
    const needsType =
      !typeFresh.has(record.messageId) &&
      (scopedIntentIds ? wantedNeedsTypes || staleIntents.length > 0 : true);
    const dissectionStale = !dissectionFresh.has(record.messageId);
    // A message being typed gets its dissection first: the split is deterministic
    // (no LLM cost) and it materially steers the type call, whose verdict is then
    // cached for the message's lifetime.
    //
    // `ownsEventLog` is the hard gate: a study clone holds the master's cached
    // dissections but none of the editor events they were reconstructed from, so
    // re-running the dissector there would find no pasted material at all and
    // overwrite a good split with an empty one. A clone's rows are therefore
    // final across DISSECTION_VERSION bumps — exactly like its cloned query
    // types — and the improvement reaches participants by re-copying from the
    // re-dissected master (scripts/score/redissect.ts).
    const needsDissection =
      dissectionStale &&
      ownsEventLog &&
      (needsType || (!noIntents && (scopedIntentIds ? staleIntents.length > 0 : true)));
    if (staleIntents.length > 0 || needsDissection || needsType) {
      jobs.push({ record, staleIntents, needsDissection, needsType });
    }
  }

  // `total` stays the shard's message count and `rated` = messages with no
  // pending work — the same meaning as before type scoping. A run scoped to a
  // typed intent therefore STARTS at a high rated count, because out-of-type
  // messages genuinely need no work; the bar fills the rest. Client and server
  // denominators still agree (both are the log size), so progress is honest.
  const total = records.length;
  const remaining = jobs.length;
  return { jobs, total, remaining, rated: total - remaining };
}

/**
 * Which questions each in-scope intent CLAIMS right now, as the board reads it.
 *
 * Taken before a run and again after, the difference is the thing an
 * instructor actually experiences and no table records: a definition rewritten
 * to fix one question re-judges every question, so decisions they had already
 * settled can quietly come back the other way. Reading it through
 * pickDisplayRatings is what makes it the board's answer rather than a
 * different one — when no row carries the current hash, the newest row is what
 * is on screen.
 */
async function membershipSnapshot(
  assignmentId: string,
  promptReady: PromptReadyIntent[],
  scopedIntentIds: number[] | null,
  messageIds: number[] | null
): Promise<Map<number, Set<number>>> {
  const wanted = scopedIntentIds
    ? promptReady.filter((p) => scopedIntentIds.includes(p.intent.id))
    : promptReady;
  const out = new Map<number, Set<number>>();
  if (wanted.length === 0) return out;
  const rows = await db
    .select({
      messageId: scoreIntentRatings.messageId,
      intentId: scoreIntentRatings.intentId,
      defHash: scoreIntentRatings.defHash,
      rating: scoreIntentRatings.rating,
      ratedAt: scoreIntentRatings.ratedAt,
    })
    .from(scoreIntentRatings)
    .where(eq(scoreIntentRatings.assignmentId, assignmentId));
  const hashByIntent = new Map(wanted.map((p) => [p.intent.id, p.defHash]));
  const scope = messageIds ? new Set(messageIds) : null;
  const display = pickDisplayRatings(rows, hashByIntent);
  for (const p of wanted) out.set(p.intent.id, new Set());
  for (const [messageId, byIntent] of display) {
    if (scope && !scope.has(messageId)) continue;
    for (const [intentId, entry] of byIntent) {
      const set = out.get(intentId);
      if (!set) continue;
      if (isRatingLevel(entry.row.rating) && isIncludedRating(entry.row.rating)) {
        set.add(messageId);
      }
    }
  }
  return out;
}

/** in/out movement between two membership snapshots, per intent. */
function membershipDelta(
  before: Map<number, Set<number>>,
  after: Map<number, Set<number>>
): { intentId: number; before: number; after: number; gained: number[]; lost: number[] }[] {
  const out: { intentId: number; before: number; after: number; gained: number[]; lost: number[] }[] = [];
  for (const [intentId, now] of after) {
    const was = before.get(intentId) ?? new Set<number>();
    const gained = [...now].filter((m) => !was.has(m));
    const lost = [...was].filter((m) => !now.has(m));
    if (gained.length === 0 && lost.length === 0 && was.size === now.size) {
      out.push({ intentId, before: was.size, after: now.size, gained: [], lost: [] });
      continue;
    }
    out.push({ intentId, before: was.size, after: now.size, gained, lost });
  }
  return out;
}

/**
 * Per intent: how many of the instructor's decisions the definition now
 * reproduces, and how many it does not.
 *
 * The pair is the loop's temperature. A definition rewritten to teach one
 * decision re-judges every question, so decisions already settled come back the
 * other way — in the pilot that happened four times and cost three re-teachings
 * each, with nothing anywhere counting it. Read off rows the run has just
 * written, so it costs one query and no model calls.
 */
async function decisionStanding(
  assignmentId: string,
  promptReady: PromptReadyIntent[],
  scopedIntentIds: number[] | null
): Promise<{ intentId: number; hold: number; dont: number }[]> {
  const wanted = scopedIntentIds
    ? promptReady.filter((p) => scopedIntentIds.includes(p.intent.id))
    : promptReady;
  if (wanted.length === 0) return [];
  const ids = wanted.map((p) => p.intent.id);
  const [pins, ratings] = await Promise.all([
    db
      .select({
        intentId: scoreIntentPins.intentId,
        messageId: scoreIntentPins.messageId,
        verdict: scoreIntentPins.verdict,
        status: scoreIntentPins.status,
      })
      .from(scoreIntentPins)
      .where(
        and(eq(scoreIntentPins.assignmentId, assignmentId), inArray(scoreIntentPins.intentId, ids))
      ),
    db
      .select({
        messageId: scoreIntentRatings.messageId,
        intentId: scoreIntentRatings.intentId,
        defHash: scoreIntentRatings.defHash,
        rating: scoreIntentRatings.rating,
        ratedAt: scoreIntentRatings.ratedAt,
      })
      .from(scoreIntentRatings)
      .where(eq(scoreIntentRatings.assignmentId, assignmentId)),
  ]);
  const display = pickDisplayRatings(ratings, new Map(wanted.map((p) => [p.intent.id, p.defHash])));
  const out = new Map(ids.map((id) => [id, { intentId: id, hold: 0, dont: 0 }]));
  for (const p of pins) {
    if (p.status === 'pending') continue; // not folded in — nothing to check yet
    const pick = display.get(p.messageId)?.get(p.intentId);
    if (!pick || !pick.fresh || !isRatingLevel(pick.row.rating)) continue;
    const row = out.get(p.intentId);
    if (!row) continue;
    if ((p.verdict === 'in') === isIncludedRating(pick.row.rating)) row.hold += 1;
    else row.dont += 1;
  }
  return [...out.values()].filter((r) => r.hold > 0 || r.dont > 0);
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorizeAssignment(id);
  if ('error' in auth) {
    const { body, status } = authErrorResponse(auth.error);
    return NextResponse.json(body, { status });
  }
  // Not on a simple clone: that version has none of this, and letting it
  // through would write a second, disagreeing answer to "what is this
  // participant's configuration" (lib/study/simple/route-context).
  const wrongVersion = await refuseSimpleClone(id);
  if (wrongVersion) return wrongVersion;

  await Promise.all([ensureScoreTable(), ensureIntentTables()]);
  const state = await loadIntentState(id);
  const scopedParam = new URL(req.url).searchParams.get('intentIds');
  const scoped = scopedParam
    ? scopedParam
        .split(',')
        .map((s) => Number.parseInt(s, 10))
        .filter((n) => Number.isFinite(n))
    : null;
  const status = await loadRateStatus(id, state.promptReady, scoped);
  return NextResponse.json({
    total: status.total,
    rated: status.rated,
    remaining: status.remaining,
    activeIntents: state.promptReady.length,
    model: getDefaultScoreModel(),
    openaiConfigured: isOpenAIConfigured(),
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorizeAssignment(id);
  if ('error' in auth) {
    const { body, status } = authErrorResponse(auth.error);
    return NextResponse.json(body, { status });
  }
  // Not on a simple clone: that version has none of this, and letting it
  // through would write a second, disagreeing answer to "what is this
  // participant's configuration" (lib/study/simple/route-context).
  const wrongVersion = await refuseSimpleClone(id);
  if (wrongVersion) return wrongVersion;

  if (!isOpenAIConfigured()) {
    return NextResponse.json(
      { error: 'openai_not_configured', message: 'OPENAI_API_KEY is not configured on the server.' },
      { status: 503 }
    );
  }

  let body: z.infer<typeof bodySchema> = {};
  try {
    const json = await req.json().catch(() => ({}));
    body = bodySchema.parse(json ?? {});
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'invalid_input', details: error.errors }, { status: 400 });
    }
  }

  const shard: Shard = { index: body.shardIndex ?? 0, count: body.shardCount ?? 1 };
  if (shard.index >= shard.count) {
    return NextResponse.json(
      { error: 'invalid_input', message: 'shardIndex must be < shardCount' },
      { status: 400 }
    );
  }

  await Promise.all([ensureScoreTable(), ensureIntentTables()]);
  const state = await loadIntentState(id);
  const scoped = body.intentIds ?? null;
  // NOTE: there is deliberately no "no active intents → return" guard here any
  // more. Rating and dissection work is still suppressed in that state (see
  // loadRateStatus), but the v7 type pass must be able to run on a board that
  // has no intents yet — browsing the log by type is what precedes creating the
  // first one.

  if (body.force) {
    // Ratings are hash-keyed history now — force must NOT rewrite hashes (that
    // would corrupt stored versions). Instead DELETE the CURRENT-hash rows of
    // the targeted intents so they read as unrated and get re-run; historical
    // rows for other hashes stay untouched. Shard-scoped as before.
    const ratingShardCond =
      shard.count > 1
        ? sql`(${scoreIntentRatings.messageId} % ${shard.count}) = ${shard.index}`
        : undefined;
    const targets = scoped
      ? state.promptReady.filter((p) => scoped.includes(p.intent.id))
      : state.promptReady;
    for (const p of targets) {
      // assignment filter too: scoped ids are client-provided and must not be
      // able to touch another assignment's rows.
      await db
        .delete(scoreIntentRatings)
        .where(
          and(
            eq(scoreIntentRatings.assignmentId, id),
            eq(scoreIntentRatings.intentId, p.intent.id),
            eq(scoreIntentRatings.defHash, p.defHash),
            ratingShardCond
          )
        );
    }
    if (!scoped) {
      await db
        .update(scoreDissections)
        .set({ version: 0 })
        .where(
          and(
            eq(scoreDissections.assignmentId, id),
            shard.count > 1
              ? sql`(${scoreDissections.messageId} % ${shard.count}) = ${shard.index}`
              : undefined
          )
        );
    }
  }

  // Server config wins: the rating model comes from SCORE_RATING_MODEL (env),
  // not the client — the picker is gone and body.model is now vestigial.
  const model = getDefaultScoreModel();
  const status = await loadRateStatus(id, state.promptReady, scoped, shard, body.messageIds ?? null);
  // Before the writes below — the "after" is taken once they have all landed.
  const membershipBefore = await membershipSnapshot(
    id,
    state.promptReady,
    scoped,
    body.messageIds ?? null
  );

  // Call-bounded batch. A rating call now carries ONE intent
  // (INTENTS_PER_RATING_CALL), so a single message can be thirty calls and
  // slicing by message count would make a POST's real size depend on how many
  // intents happened to go stale. Count the calls instead — and always take at
  // least one job, so a job bigger than the whole budget still makes progress
  // rather than deadlocking the client's loop.
  const messageLimit = body.limit ?? DEFAULT_MESSAGE_LIMIT;
  const batch: MessageJob[] = [];
  let plannedCalls = 0;
  for (const job of status.jobs) {
    if (batch.length >= messageLimit) break;
    const calls = chunkForRating(job.staleIntents).length + (job.needsType ? 1 : 0);
    if (batch.length > 0 && plannedCalls + calls > CALLS_PER_BATCH) break;
    batch.push(job);
    plannedCalls += calls;
  }

  const now = new Date();

  // Dissection is now DETERMINISTIC (reconstructed from the editor-event log,
  // see dissect.ts) — computed here for the batch's stale-dissection messages,
  // NOT by the LLM. It cannot fail on model output, so it always makes progress.
  const dissectTargets = new Set(
    batch.filter((j) => j.needsDissection).map((j) => j.record.messageId)
  );
  const dissections = await computeDissections(id, dissectTargets);
  await Promise.all(
    [...dissections].map(([messageId, d]) => {
      const values = {
        materialKinds: d.materialKinds,
        requests: d.requests,
        materials: d.materials,
        version: DISSECTION_VERSION,
        rawResponse: null,
        model: 'deterministic',
        createdAt: now,
      };
      return db
        .insert(scoreDissections)
        .values({ assignmentId: id, messageId, ...values })
        .onConflictDoUpdate({ target: scoreDissections.messageId, set: values });
    })
  );
  // The embedding is computed on the dissected text → invalidate it so it
  // recomputes against the fresh dissection on next use.
  if (dissections.size > 0) {
    await db
      .delete(scoreQueryEmbeddings)
      .where(inArray(scoreQueryEmbeddings.messageId, [...dissections.keys()]));
  }
  // Progress is tracked per MESSAGE: a job counts as succeeded when at least one
  // of its pending items (dissection / type / ratings) actually wrote. That keeps
  // the client's `succeeded === 0` stall detector honest now that a job can carry
  // three kinds of work, while `remaining` (recomputed from the DB below) stays
  // the authoritative loop condition.
  const progressed = new Set<number>();
  // Jobs whose ONLY pending work was the (now-done) dissection are complete.
  for (const j of batch) {
    if (j.needsDissection && j.staleIntents.length === 0 && !j.needsType) {
      progressed.add(j.record.messageId);
    }
  }

  // The LLM handles the per-intent ratings and — as a SEPARATE call — the type
  // judgment (see type-classifier.ts: keeping the rating prompt byte-identical
  // is what avoids an INTENT_RATING_VERSION bump).
  const ratingJobs = batch.filter((j) => j.staleIntents.length > 0);
  // One entry per CALL, not per message: the same job appears once for each of
  // its stale intents.
  const ratingCalls = ratingJobs.flatMap((job) =>
    chunkForRating(job.staleIntents).map((intents) => ({ job, intents }))
  );
  const typeJobs = batch.filter((j) => j.needsType);
  let failed = 0;
  const limit = createLimiter(SCORE_CONCURRENCY);

  // Each rating call gets THIS message's deterministic Material/Request split so
  // the judge rates only the typed request and never treats pasted material as an
  // implicit intent. The split just computed above (`dissections`) is authoritative
  // for the messages it covers; for the rest (dissection already fresh) load the
  // stored rows. Missing → null → the reworded no-request rule still applies.
  const dissectionByMsg = new Map<number, PromptDissection>();
  // Type calls need the split just as much as rating calls do — more, even: a
  // type verdict is cached for the message's lifetime, so classifying it without
  // the steer bakes in the exact error (pasted material read as a request) the
  // dissection exists to prevent. Load stored rows for BOTH waves.
  const needDissectionText = [
    ...new Set([...ratingJobs, ...typeJobs].map((j) => j.record.messageId)),
  ];
  if (needDissectionText.length > 0) {
    const stored = await db
      .select({
        messageId: scoreDissections.messageId,
        materialKinds: scoreDissections.materialKinds,
        requests: scoreDissections.requests,
        materials: scoreDissections.materials,
      })
      .from(scoreDissections)
      .where(
        and(
          eq(scoreDissections.assignmentId, id),
          inArray(scoreDissections.messageId, needDissectionText)
        )
      );
    for (const s of stored) {
      dissectionByMsg.set(s.messageId, {
        materialKinds: (s.materialKinds ?? []) as MaterialKind[],
        requests: (s.requests ?? []) as string[],
        materials: (Array.isArray(s.materials) ? s.materials : []) as MaterialSpan[],
      });
    }
  }
  for (const [mid, d] of dissections) dissectionByMsg.set(mid, d); // fresh overrides stored

  // Type pass — one call per message, sharing the limiter with the rating wave
  // so total concurrency stays bounded. A message's type is judged ONCE EVER
  // (content is immutable), so an unusable output must NOT be written: leaving
  // the row absent retries it next POST, whereas a guessed type would be cached
  // for good and is unrecoverable downstream (the intent only ever sees its own
  // type's queries).
  const typeWave = typeJobs.map((job) =>
    limit(async () => {
      const rec = job.record;
      try {
        const result = await classifyMessageType({
          queryText: rec.queryText,
          prevQueryText: rec.prevQueryText,
          prevResponseText: rec.prevResponseText,
          dissection: dissectionByMsg.get(rec.messageId) ?? null,
          model,
        });
        if (!result.type) {
          console.error(`SCORE type classification produced no usable output for message ${rec.messageId}`);
          return;
        }
        const values = {
          type: result.type,
          rationale: result.rationale || null,
          version: TYPE_CLASSIFIER_VERSION,
          rawResponse: result.raw,
          model,
          createdAt: now,
        };
        await db
          .insert(scoreQueryTypes)
          .values({ assignmentId: id, messageId: rec.messageId, ...values })
          .onConflictDoUpdate({ target: scoreQueryTypes.messageId, set: values });
        progressed.add(rec.messageId);
      } catch (error) {
        console.error(`SCORE type classification failed for message ${rec.messageId}:`, error);
      }
    })
  );

  await Promise.all([
    ...typeWave,
    ...ratingCalls.map(({ job, intents }) =>
      limit(async () => {
        const rec = job.record;
        try {
          const result = await rateMessageIntents({
            queryText: rec.queryText,
            prevQueryText: rec.prevQueryText,
            prevResponseText: rec.prevResponseText,
            intents: intents.map((p) => ({
              id: p.intent.id,
              definition: p.intent.definition,
            })),
            includeDissection: false,
            dissection: dissectionByMsg.get(rec.messageId) ?? null,
            model,
          });

          const writes: Promise<unknown>[] = [];
          let ratingWrites = 0;
          for (const p of intents) {
            const rating = result.ratings.get(p.intent.id);
            if (!rating) continue; // invalid/missing → stays stale, retried next POST
            ratingWrites += 1;
            const values = {
              rating: rating.rating,
              rationale: rating.rationale || null,
              defHash: p.defHash,
              rawResponse: result.raw,
              model,
              ratedAt: now,
            };
            writes.push(
              db
                .insert(scoreIntentRatings)
                .values({
                  assignmentId: id,
                  messageId: rec.messageId,
                  intentId: p.intent.id,
                  ...values,
                })
                .onConflictDoUpdate({
                  // Hash-keyed history: same spec re-rated overwrites its own
                  // row; a new spec inserts alongside the old rows.
                  target: [
                    scoreIntentRatings.messageId,
                    scoreIntentRatings.intentId,
                    scoreIntentRatings.defHash,
                  ],
                  set: values,
                })
            );
          }
          await Promise.all(writes);
          // A call that produced no usable rating wrote nothing → no progress
          // from this item (the job may still have progressed via its type call).
          if (ratingWrites > 0) {
            progressed.add(rec.messageId);
          } else {
            console.error(`SCORE intent rating produced no usable output for message ${rec.messageId}`);
          }
        } catch (error) {
          // Log server-side only; never echo raw LLM/DB errors to the client.
          console.error(`SCORE intent rating failed for message ${rec.messageId}:`, error);
        }
      })
    ),
  ]);

  const succeeded = progressed.size;
  failed = batch.length - succeeded;

  const after = await loadRateStatus(id, state.promptReady, scoped, shard, body.messageIds ?? null);
  if (batch.length > 0) {
    const membershipAfter = await membershipSnapshot(
      id,
      state.promptReady,
      scoped,
      body.messageIds ?? null
    );
    const delta = membershipDelta(membershipBefore, membershipAfter);
    // How the instructor's own rulings stand after this re-judgement. The
    // membership delta above says what moved; this says whether what moved was
    // something they had decided — the whack-a-mole, counted.
    const decisions = await decisionStanding(id, state.promptReady, scoped);
    await logStudyEvent(id, 'rating_run', {
      condition: 'score',
      processed: batch.length,
      intentIds: scoped ?? null,
      // A pass is sharded across several POSTs, so a delta is this slice's;
      // the shard is recorded to let the analysis add them back up.
      shard: shard.count > 1 ? { index: shard.index, count: shard.count } : null,
      // WHAT MOVED. Without this the trail says a re-rating happened and not
      // that it took three questions away from the intent — which is the loop
      // the instructor is actually fighting when a definition will not settle.
      membership: delta.filter((d) => d.gained.length > 0 || d.lost.length > 0),
      flips: delta.reduce((n, d) => n + d.gained.length + d.lost.length, 0),
      decisions,
    });
  }
  return NextResponse.json({
    // processed/succeeded are MESSAGES (the progress bar's unit); `failed`
    // counts CALLS, and one message is now one call per stale intent, so the
    // two are no longer on the same denominator. Deliberate: a message where 29
    // of 30 ratings landed has both progressed and lost something, and the
    // client's stall detector keys off `succeeded`, which stays per-message.
    processed: batch.length,
    succeeded,
    failed,
    total: after.total,
    rated: after.rated,
    remaining: after.remaining,
    model,
  });
}
