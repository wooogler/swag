/**
 * Replay one intent's decision ledger through the fold, and measure the result.
 *
 * The pilot gave us a natural experiment: intent 7059 was taught twelve
 * decisions over ten separate folds, and every decision — with the
 * instructor's own reason — is still in score_intent_pins. The definition it
 * ended with is in the config history. So the question "does folding the whole
 * ledger at once, under a prompt with a length budget, produce something
 * shorter and no less faithful?" can be answered against real data instead of
 * guessed at, and answered BEFORE any of it reaches a participant's screen.
 *
 * What it does:
 *   1. reads the intent's decisions (any status) with their reasons,
 *   2. folds them ALL onto the intent's earliest definition, in one call,
 *   3. optionally rates the decided questions — and the rest of that type's
 *      log — against the candidate, and reports what the membership would be.
 *
 * NOTHING IS WRITTEN. The ratings here are measurements of a definition that
 * exists only in this process; the live rows are read and left alone.
 *
 *   npx tsx --env-file=.env scripts/score/fold-replay.ts <intentId> [--verify] [--seq]
 *
 *   --verify  rate the decisions and the type's log against the candidate
 *             (~1 classifier call per question — a few dozen)
 *   --seq     ALSO fold one decision at a time, in the order they were made,
 *             to separate "the prompt changed" from "the batching changed"
 *             (one strong-model call per decision — slow and not cheap)
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '../../src/db/db';
import {
  chatMessages,
  scoreConfigVersions,
  scoreIntentPins,
  scoreIntents,
  scoreQueryTypes,
} from '../../src/db/schema';
import { foldCorrections, type FoldCorrection } from '../../src/lib/score/intent-agent';
import { rateMessageIntents } from '../../src/lib/score/intent-classifier';
import { createLimiter, SCORE_CONCURRENCY } from '../../src/lib/score/limiter';
import { getDefaultScoreModel } from '../../src/lib/score/models';
import { computeDissections } from '../../src/lib/score/dissect';
import { getQueryRecords, ensureScoreTable } from '../../src/lib/score/queries';
import { ensureIntentTables } from '../../src/lib/score/intent-store';
import {
  isIncludedRating,
  type PromptDissection,
  type RatingLevel,
} from '../../src/lib/score/intents';

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** The definition this intent started life with, before any fold touched it. */
function seedDefinition(
  versions: { snapshot: unknown }[],
  intentId: number,
  fallback: string
): string {
  for (const v of versions) {
    const snap = v.snapshot as { intents?: { id: number; definition?: string }[] } | null;
    const found = snap?.intents?.find((i) => i.id === intentId);
    if (found?.definition) return found.definition;
  }
  return fallback;
}

async function main() {
  const intentId = Number.parseInt(process.argv[2] ?? '', 10);
  if (!Number.isFinite(intentId)) {
    throw new Error('usage: fold-replay.ts <intentId> [--verify] [--seq]');
  }
  const doVerify = process.argv.includes('--verify');
  const doSeq = process.argv.includes('--seq');
  await Promise.all([ensureScoreTable(), ensureIntentTables()]);

  const [intent] = await db.select().from(scoreIntents).where(eq(scoreIntents.id, intentId));
  if (!intent) throw new Error(`no intent ${intentId}`);

  const pins = await db
    .select()
    .from(scoreIntentPins)
    .where(eq(scoreIntentPins.intentId, intentId))
    .orderBy(asc(scoreIntentPins.createdAt));
  if (pins.length === 0) throw new Error(`intent ${intentId} has no decisions to replay`);

  const versions = await db
    .select({ snapshot: scoreConfigVersions.snapshot })
    .from(scoreConfigVersions)
    .where(eq(scoreConfigVersions.assignmentId, intent.assignmentId))
    .orderBy(asc(scoreConfigVersions.versionNo));
  const seed = seedDefinition(versions, intentId, intent.definition);

  console.log(`intent ${intentId} · "${intent.title}" · ${pins.length} decisions`);
  console.log(`\nSEED (${seed.length} chars, ${words(seed)} words)\n  ${seed}`);
  console.log(
    `\nLIVE — what ${versions.length ? 'the session' : 'it'} actually produced ` +
      `(${intent.definition.length} chars, ${words(intent.definition)} words)\n  ${intent.definition}`
  );

  const decisions: FoldCorrection[] = pins.map((p) => ({
    id: p.id,
    verdict: p.verdict as 'in' | 'out',
    queryText: p.queryText ?? '',
    reason: p.reason,
    // A replay is one pass over a finished ledger: every decision is being
    // taught now, none is standing from a previous fold.
    standing: false,
  }));

  // Rate one definition over one set of questions. Declared before the fold so
  // the verification loop can use it too — a fold measured without the loop is
  // a strawman, because production never shows an unverified candidate.
  const model = getDefaultScoreModel();
  const records = await getQueryRecords(intent.assignmentId);
  const typed = intent.type
    ? await db
        .select({ messageId: scoreQueryTypes.messageId })
        .from(scoreQueryTypes)
        .where(
          and(
            eq(scoreQueryTypes.assignmentId, intent.assignmentId),
            eq(scoreQueryTypes.type, intent.type)
          )
        )
    : [];
  const typeIds = new Set(typed.map((t) => t.messageId));
  const decidedIds = new Set(pins.map((p) => p.messageId));
  const scope = records.filter((r) => typeIds.has(r.messageId) || decidedIds.has(r.messageId));
  const dissections = await computeDissections(
    intent.assignmentId,
    new Set(scope.map((r) => r.messageId))
  );
  const byMessage = new Map(scope.map((r) => [r.messageId, r]));

  async function judge(
    definition: string,
    messageIds: number[]
  ): Promise<Map<number, { rating: RatingLevel; rationale: string }>> {
    const limit = createLimiter(SCORE_CONCURRENCY);
    const out = new Map<number, { rating: RatingLevel; rationale: string }>();
    await Promise.all(
      messageIds.map((id) =>
        limit(async () => {
          const rec = byMessage.get(id);
          if (!rec) return;
          try {
            const rated = await rateMessageIntents({
              queryText: rec.queryText,
              prevQueryText: rec.prevQueryText,
              prevResponseText: rec.prevResponseText,
              intents: [{ id: intentId, definition }],
              includeDissection: false,
              dissection: (dissections.get(id) ?? null) as PromptDissection | null,
              model,
              callOptions: { timeoutMs: 45_000, maxRetries: 1 },
            });
            const judged = rated.ratings.get(intentId);
            if (judged) out.set(id, { rating: judged.rating, rationale: judged.rationale ?? '' });
          } catch {
            /* a question that will not rate is simply absent from the map */
          }
        })
      )
    );
    return out;
  }

  /**
   * Fold, measure the decisions against the candidate, feed the failures back.
   *
   * The same shape the refine route runs, so what this prints is what a
   * participant would be offered — not a first draft the real system would
   * have rejected.
   */
  const MAX_ATTEMPTS = 2;
  console.log(`\nBATCH FOLD — all ${decisions.length} decisions, up to ${MAX_ATTEMPTS} attempts…`);
  let batch = await foldCorrections({ definition: seed, corrections: decisions });
  for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt++) {
    const verdicts = await judge(batch.definition, pins.map((p) => p.messageId));
    const failures = pins
      .filter((p) => {
        const v = verdicts.get(p.messageId);
        return v && (p.verdict === 'in') !== isIncludedRating(v.rating);
      })
      .map((p) => ({
        verdict: p.verdict as 'in' | 'out',
        queryText: p.queryText ?? '',
        reason: p.reason,
        judgeRating: verdicts.get(p.messageId)?.rating ?? 'unrated',
        judgeRationale: verdicts.get(p.messageId)?.rationale ?? '',
      }));
    console.log(
      `  attempt ${attempt}: ${batch.definition.length} chars · ` +
        `${pins.length - failures.length}/${pins.length} decisions hold`
    );
    if (failures.length === 0) break;
    batch = await foldCorrections({
      definition: seed,
      corrections: decisions,
      previousAttempt: { definition: batch.definition, failures },
    });
  }
  console.log(
    `\nCANDIDATE (${batch.definition.length} chars, ${words(batch.definition)} words) ` +
      `title "${batch.title ?? '—'}"\n  ${batch.definition}`
  );
  console.log(`\n  summary: ${batch.summary}`);
  const notReflected = batch.outcomes.filter((o) => o.outcome === 'not_reflected');
  console.log(
    `  self-report: ${batch.outcomes.filter((o) => o.outcome !== 'not_reflected').length}/${
      batch.outcomes.length
    } carried` + (notReflected.length ? ` · not reflected: ${notReflected.length}` : '')
  );

  let sequential: string | null = null;
  if (doSeq) {
    console.log(`\nSEQUENTIAL FOLD — one decision at a time, ${decisions.length} calls…`);
    let text = seed;
    for (const [i, d] of decisions.entries()) {
      const step = await foldCorrections({ definition: text, corrections: [d] });
      text = step.definition;
      console.log(`  ${i + 1}. ${d.verdict} → ${text.length} chars, ${words(text)} words`);
    }
    sequential = text;
    console.log(`\nSEQUENTIAL RESULT (${text.length} chars, ${words(text)} words)\n  ${text}`);
  }

  if (doVerify) {
    // The type's whole log is the population a definition has to be right
    // about; the decided questions are the part it was taught on.
    const rate = async (definition: string, label: string) => {
      const out = await judge(definition, scope.map((r) => r.messageId));
      const claimed = [...out.entries()]
        .filter(([, v]) => isIncludedRating(v.rating))
        .map(([m]) => m);
      const kept = pins.filter(
        (p) => (p.verdict === 'in') === claimed.includes(p.messageId)
      ).length;
      console.log(
        `\n  ${label}: claims ${claimed.length}/${scope.length} questions · ` +
          `holds ${kept}/${pins.length} decisions`
      );
      return { claimed: new Set(claimed), kept };
    };

    console.log(`\nVERIFY — rating ${scope.length} questions of type "${intent.type}"…`);
    const live = await rate(intent.definition, 'live definition   ');
    const cand = await rate(batch.definition, 'batch candidate   ');
    if (sequential) await rate(sequential, 'sequential result ');

    const gained = [...cand.claimed].filter((m) => !live.claimed.has(m));
    const lost = [...live.claimed].filter((m) => !cand.claimed.has(m));
    const texts = new Map(
      (
        await db
          .select({ id: chatMessages.id, content: chatMessages.content })
          .from(chatMessages)
          .where(inArray(chatMessages.id, [...gained, ...lost].length ? [...gained, ...lost] : [-1]))
      ).map((m) => [m.id, m.content.replace(/\s+/g, ' ').slice(0, 70)])
    );
    console.log(`\n  candidate vs live: +${gained.length} / -${lost.length}`);
    for (const m of gained) console.log(`    + ${texts.get(m) ?? m}`);
    for (const m of lost) console.log(`    - ${texts.get(m) ?? m}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
