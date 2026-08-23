/**
 * Routing a question the log has never seen.
 *
 * The board's judgments are cached per (definition, logged question), which is
 * exactly the wrong shape for the block test: its questions are deliberately
 * held out of the log, so there is nothing cached and there never will be. The
 * verdict has to be worked out live, once, at the moment the frozen answer is
 * produced.
 *
 * No type call. The full version needs one to decide which of the four query
 * types a question is before it can pick a chain; the simple version has one
 * root, so the type layer — and its call, and its failure mode — are gone.
 *
 * Fail-open is not a thing here. If the call fails, the caller must not fall
 * back to the assignment's own prompt and record it as a result: that answer
 * would be measuring a configuration the participant did not write. It throws,
 * and the harness retries.
 */
import { rateMessageIntents, type IntentRatingOutput } from '@/lib/score/intent-classifier';
import { chunkForRating } from '@/lib/score/intent-prompts';
import { createLimiter, SCORE_CONCURRENCY } from '@/lib/score/limiter';
import { getDefaultScoreModel } from '@/lib/score/models';
import { isIncludedRating } from '@/lib/score/intents';
import type { CallOptions } from '@/lib/score/classifier';
import {
  compileSimpleChain,
  definitionsOf,
  resolveSimpleOwnership,
  ruleForOwner,
  type SimpleSnapshot,
} from './chain';

export interface LiveRoute {
  systemPrompt: string;
  /** Which intent answered, or null for the root's else rule. */
  sid: number | null;
  outcome: 'intent' | 'root';
  title: string | null;
}

/**
 * How many definitions ride in one call to the judge.
 *
 * THIS CHANGES THE ANSWER, which is why it is a parameter and not a detail.
 * Measured on 15 questions × 30 starter definitions with nothing varied but
 * the batching (the table is in intent-prompts.ts): a definition rated on its
 * own comes back "in" 25.8% of the time, three to a call 22.2%, five 18.2%,
 * thirty 10.4%. The judge is told to rate each definition strictly by its own
 * words and not to balance across them; it does not.
 *
 * 'per-definition' is what the BOARD does, so it is the default and it is what
 * anything the study measures must use. The block test is the measurement of a
 * participant's routing, and if it batched, a configuration would catch fewer
 * questions there than on the screen where the participant tuned it — by an
 * amount that grows with how many intents they wrote. That is a property of
 * the batching, not of their writing, and it would land in the data as "the
 * configuration did not work".
 *
 * 'one-call' exists for the student chat runtime alone, where a student is
 * waiting on the reply, the budget is one 15s attempt with no retry, and the
 * path fails open to the base prompt. Fanning out there multiplies the ways
 * that attempt can miss its window. It is a deliberate, stated exception on a
 * path nothing is measured from.
 */
export type LiveBatching = 'per-definition' | 'one-call';

export async function resolveSimpleLive(args: {
  snapshot: SimpleSnapshot;
  queryText: string;
  prevQueryText: string | null;
  prevResponseText: string | null;
  callOptions?: CallOptions;
  /** See LiveBatching. Anything measured leaves this alone. */
  batching?: LiveBatching;
}): Promise<LiveRoute> {
  const { snapshot } = args;
  if (snapshot.arm === 'baseline') {
    return { systemPrompt: snapshot.prompt, sid: null, outcome: 'root', title: null };
  }

  const definitions = definitionsOf(snapshot);
  if (definitions.length === 0) {
    return { systemPrompt: snapshot.rootRule, sid: null, outcome: 'root', title: null };
  }

  const rate = (chunk: typeof definitions) =>
    rateMessageIntents({
      queryText: args.queryText,
      prevQueryText: args.prevQueryText,
      prevResponseText: args.prevResponseText,
      // No dissection: it is derived from the editor's paste log, which a
      // held-out question does not have. The judge's own no-request rule still
      // applies, which is what the live chat runtime relies on too.
      // The ids are positions in THIS call, not sids.
      intents: chunk.map((d, i) => ({ id: i + 1, definition: d.definition })),
      includeDissection: false,
      dissection: null,
      model: getDefaultScoreModel(),
      callOptions: args.callOptions,
    });

  // An intent the model did not answer for is left UNSET, not false: the chain
  // then reports pending rather than quietly handing the question to whatever
  // comes after it.
  const matches = new Map<number, boolean>();
  const record = (chunk: typeof definitions, ratings: ReadonlyMap<number, IntentRatingOutput>) => {
    chunk.forEach((definition, i) => {
      const rating = ratings.get(i + 1);
      if (rating) matches.set(definition.sid, isIncludedRating(rating.rating));
    });
  };

  if (args.batching === 'one-call') {
    record(definitions, (await rate(definitions)).ratings);
  } else {
    // chunkForRating rather than one call each, so this tracks
    // INTENTS_PER_RATING_CALL instead of restating today's value of it — the
    // board's judge splits its work with the same function.
    const chunks = chunkForRating(definitions);
    const run = createLimiter(SCORE_CONCURRENCY);
    const settled = await Promise.allSettled(
      chunks.map((chunk) => run(async () => ({ chunk, result: await rate(chunk) })))
    );
    // allSettled, not all: a chunk that fails leaves its intents unjudged, and
    // an unjudged intent BELOW the winner cannot change the answer. Failing the
    // whole question on it would throw away a route that was already decided.
    for (const outcome of settled) {
      if (outcome.status === 'fulfilled') record(outcome.value.chunk, outcome.value.result.ratings);
    }
  }

  const ownership = resolveSimpleOwnership(snapshot, compileSimpleChain(snapshot), matches);
  if (ownership.outcome === 'pending') {
    throw new Error('rating_incomplete');
  }
  return {
    systemPrompt: ruleForOwner(snapshot, ownership.sid),
    sid: ownership.sid,
    outcome: ownership.outcome,
    title:
      ownership.sid == null
        ? null
        : snapshot.intents.find((i) => i.sid === ownership.sid)?.title ?? null,
  };
}
