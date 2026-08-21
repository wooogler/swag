/**
 * Routing a question the log has never seen.
 *
 * The board's judgments are cached per (definition, logged question), which is
 * exactly the wrong shape for the block test: its questions are deliberately
 * held out of the log, so there is nothing cached and there never will be. The
 * verdict has to be worked out live, once, at the moment the frozen answer is
 * produced.
 *
 * One model call, not two. The full version needs a second one to decide which
 * of the four query types a question is before it can pick a chain; the simple
 * version has one root, so the type layer — and its call, and its failure mode
 * — are simply gone.
 *
 * Fail-open is not a thing here. If the call fails, the caller must not fall
 * back to the assignment's own prompt and record it as a result: that answer
 * would be measuring a configuration the participant did not write. It throws,
 * and the harness retries.
 */
import 'server-only';
import { rateMessageIntents } from '@/lib/score/intent-classifier';
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

export async function resolveSimpleLive(args: {
  snapshot: SimpleSnapshot;
  queryText: string;
  prevQueryText: string | null;
  prevResponseText: string | null;
  callOptions?: CallOptions;
}): Promise<LiveRoute> {
  const { snapshot } = args;
  if (snapshot.arm === 'baseline') {
    return { systemPrompt: snapshot.prompt, sid: null, outcome: 'root', title: null };
  }

  const definitions = definitionsOf(snapshot);
  if (definitions.length === 0) {
    return { systemPrompt: snapshot.rootRule, sid: null, outcome: 'root', title: null };
  }

  const result = await rateMessageIntents({
    queryText: args.queryText,
    prevQueryText: args.prevQueryText,
    prevResponseText: args.prevResponseText,
    // No dissection: it is derived from the editor's paste log, which a
    // held-out question does not have. The judge's own no-request rule still
    // applies, which is what the live chat runtime relies on too.
    intents: definitions.map((d, i) => ({ id: i + 1, definition: d.definition })),
    includeDissection: false,
    dissection: null,
    model: getDefaultScoreModel(),
    callOptions: args.callOptions,
  });

  const matches = new Map<number, boolean>();
  definitions.forEach((definition, i) => {
    const rating = result.ratings.get(i + 1);
    // An intent the model did not answer for is left UNSET, not false: the
    // chain then reports pending rather than quietly handing the question to
    // whatever comes after it.
    if (rating) matches.set(definition.sid, isIncludedRating(rating.rating));
  });

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
