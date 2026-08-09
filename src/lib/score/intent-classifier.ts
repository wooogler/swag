/**
 * SCORE v6 intent classifier — ONE call per question covering dissection
 * (Material/Request split, when needed) + a 5-level rating per intent.
 *
 * The call may cover the full active intent set (fresh question) or any
 * subset (incremental re-rate after one intent/pin edit) — the deterministic
 * assignment resolver (intents.ts) runs OUTSIDE the model, over whatever
 * fresh ratings exist, so partial calls compose safely.
 *
 * Reuses classifier.ts's callModel (shared client, self-heal for models that
 * reject reasoning/structured outputs) and prompts.ts's buildQueryContent
 * (prior-context v2 strategy — the following bot reply is never sent).
 */
import { callModel, extractJsonObject, type CallOptions, type ReasoningEffort } from './classifier';
import { buildRatingQueryContent } from './prompts';
import {
  buildIntentSchema,
  buildIntentSystemPrompt,
  intentKey,
  MAX_INTENTS_PER_CALL,
  type PromptIntent,
} from './intent-prompts';
import {
  isRatingLevel,
  MATERIAL_KINDS,
  type DissectionResult,
  type MaterialKind,
  type PromptDissection,
  type RatingLevel,
} from './intents';

// Reasoning effort for rating calls. Default 'low' (a little deliberation for
// boundary judgments); override with SCORE_RATING_EFFORT=none for the fastest/
// cheapest tier. Note: gpt-5.4 accepts none|low|medium|high|xhigh — there is
// no 'minimal' (an invalid value would make callModel's self-heal drop the
// reasoning param entirely, landing on the model DEFAULT effort, i.e. slower).
const EFFORT_VALUES: readonly ReasoningEffort[] = ['none', 'low', 'medium', 'high', 'xhigh'];
const RATING_EFFORT: ReasoningEffort = EFFORT_VALUES.includes(
  process.env.SCORE_RATING_EFFORT as ReasoningEffort
)
  ? (process.env.SCORE_RATING_EFFORT as ReasoningEffort)
  : 'low';

export interface IntentRatingOutput {
  rationale: string;
  rating: RatingLevel;
}

export interface RateMessageResult {
  /** Present iff includeDissection was requested AND the output was usable. */
  dissection: DissectionResult | null;
  /** intentId → rating. Intents whose output failed validation are simply
   * absent — their rows stay stale and retry on the next batch. */
  ratings: Map<number, IntentRatingOutput>;
  raw: string;
}

export async function rateMessageIntents(args: {
  queryText: string;
  prevQueryText: string | null;
  prevResponseText: string | null;
  intents: PromptIntent[];
  includeDissection: boolean;
  /** The deterministic Material/Request split for THIS message (dissect.ts),
   * rendered into the prompt so the judge rates only the typed request and never
   * treats pasted material (esp. the assignment prompt) as an implicit request.
   * Optional: the live chat runtime may not have it and passes null — the
   * reworded no-request rule in the system prompt still applies either way.
   * `materials` is REQUIRED (PromptDissection): the marker carries per-run
   * kinds, so a caller that forgets to load them must fail to compile rather
   * than quietly send the other study arm a different prompt. */
  dissection?: PromptDissection | null;
  model: string;
  /** Override the default timeout/retry budget — the LIVE chat runtime passes
   * a much tighter one (a student is waiting; it fails open to base). */
  callOptions?: CallOptions;
}): Promise<RateMessageResult> {
  const { queryText, prevQueryText, prevResponseText, includeDissection, model } = args;
  const intents = args.intents.slice(0, MAX_INTENTS_PER_CALL);
  if (intents.length === 0 && !includeDissection) {
    return { dissection: null, ratings: new Map(), raw: '' };
  }

  const intentIds = intents.map((i) => i.id);
  const raw = await callModel(
    buildIntentSystemPrompt(intents, includeDissection),
    buildRatingQueryContent(queryText, prevQueryText, prevResponseText, args.dissection),
    model,
    // Boundary judgments against instructor-authored definitions benefit from
    // a little deliberation ('low'). SCORE_RATING_EFFORT=none trades some of
    // that judgment for a big latency/cost cut — gpt-5.4 has no 'minimal';
    // 'none' is the bottom tier. (Server-only module, so env is fine here.)
    RATING_EFFORT,
    {
      name: 'intent_ratings',
      schema: buildIntentSchema(intentIds, includeDissection) as Record<string, unknown>,
    },
    // Fail fast: a hung call must not stall its whole batch for minutes (one
    // 5-min straggler was observed to freeze an Apply). A message that fails
    // here simply stays pending and the next Apply re-rates just that one.
    args.callOptions ?? { timeoutMs: 60_000, maxRetries: 2 }
  );
  const parsed = extractJsonObject(raw);

  // Dissection — validate leniently; a broken dissection must not sink the
  // ratings in the same response.
  let dissection: DissectionResult | null = null;
  if (includeDissection && parsed.dissection && typeof parsed.dissection === 'object') {
    const d = parsed.dissection as Record<string, unknown>;
    const materialKinds = Array.isArray(d.material_kinds)
      ? (d.material_kinds.filter(
          (k): k is MaterialKind =>
            typeof k === 'string' && (MATERIAL_KINDS as readonly string[]).includes(k)
        ) as MaterialKind[])
      : [];
    const requests = Array.isArray(d.requests)
      ? d.requests.filter((r): r is string => typeof r === 'string' && r.trim().length > 0)
      : [];
    dissection = { materialKinds: [...new Set(materialKinds)], requests };
  }

  const ratings = new Map<number, IntentRatingOutput>();
  const ratingsRaw =
    parsed.ratings && typeof parsed.ratings === 'object'
      ? (parsed.ratings as Record<string, unknown>)
      : {};
  for (const id of intentIds) {
    const entry = ratingsRaw[intentKey(id)];
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    if (!isRatingLevel(e.rating)) continue; // invalid → leave stale, retry later
    ratings.set(id, {
      rating: e.rating,
      rationale: typeof e.rationale === 'string' ? e.rationale.trim() : '',
    });
  }

  return { dissection, ratings, raw };
}
