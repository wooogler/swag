/**
 * SCORE v7 type classifier — ONE call per message deciding which of the 4
 * fixed query types it belongs to (docs/SCORE_v7_intent_tree_design.md §3.1).
 *
 * Deliberately SEPARATE from the intent rating call (intent-classifier.ts)
 * rather than another field in its schema: the rating prompt must stay
 * byte-identical, because any change to it forces an INTENT_RATING_VERSION
 * bump, which re-rates every message × intent pair and orphans the baseline
 * study's probe/preset keyspace. Two calls also parallelize at runtime, so the
 * student's wall-clock cost is max(type, ratings), not their sum.
 *
 * The judgment is cached per message forever (score_query_types) — content is
 * immutable, so only a TYPE_CLASSIFIER_VERSION bump invalidates a row.
 *
 * Reuses classifier.ts's callModel (shared client, self-heal for models that
 * reject reasoning/structured outputs) and prompts.ts's buildQueryContent, so
 * the dissection steer applies wherever a dissection is available (instructor
 * batches). The live chat path has none and passes null — the same asymmetry
 * the rating call already lives with.
 */
import { callModel, extractJsonObject, type CallOptions, type ReasoningEffort } from './classifier';
import { buildQueryContent } from './prompts';
import { buildTypeSchema, buildTypeSystemPrompt } from './type-prompts';
import { isScoreQueryType, type DissectionResult, type ScoreQueryType } from './intents';

// Same tier and env override as the rating call: a little deliberation for the
// scale/existing-text boundaries, overridable for the cheapest run.
const EFFORT_VALUES: readonly ReasoningEffort[] = ['none', 'low', 'medium', 'high', 'xhigh'];
const TYPE_EFFORT: ReasoningEffort = EFFORT_VALUES.includes(
  process.env.SCORE_RATING_EFFORT as ReasoningEffort
)
  ? (process.env.SCORE_RATING_EFFORT as ReasoningEffort)
  : 'low';

export interface TypeClassificationResult {
  /** Null when the model returned something unusable — the caller leaves the
   * message untyped so the next batch retries it (never guess a type: a wrong
   * type is unrecoverable downstream). */
  type: ScoreQueryType | null;
  rationale: string;
  raw: string;
}

export async function classifyMessageType(args: {
  queryText: string;
  prevQueryText: string | null;
  prevResponseText: string | null;
  /** Deterministic Material/Request split for THIS message (dissect.ts), when
   * the caller has one — instructor batches do, the live runtime does not. */
  dissection?: DissectionResult | null;
  model: string;
  /** Override the default timeout/retry budget — the LIVE chat runtime passes
   * a much tighter one (a student is waiting; it fails open). */
  callOptions?: CallOptions;
}): Promise<TypeClassificationResult> {
  const raw = await callModel(
    buildTypeSystemPrompt(),
    buildQueryContent(args.queryText, args.prevQueryText, args.prevResponseText, args.dissection),
    args.model,
    TYPE_EFFORT,
    { name: 'query_type', schema: buildTypeSchema() as Record<string, unknown> },
    args.callOptions ?? { timeoutMs: 60_000, maxRetries: 2 }
  );
  const parsed = extractJsonObject(raw);
  const type = isScoreQueryType(parsed.type) ? parsed.type : null;
  return {
    type,
    rationale: typeof parsed.rationale === 'string' ? parsed.rationale.trim() : '',
    raw,
  };
}
