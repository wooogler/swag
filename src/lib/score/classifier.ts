/**
 * SCORE classifiers (LLM-backed, Structured-Outputs constrained, cached upstream).
 *
 * Two classifiers are run independently per query so their (dis)agreement is
 * meaningful — they are deliberately NOT combined into one call:
 *
 *   A — Hierarchical single-label: exactly one Type (P/T/R/A) + one Subtype.
 *   B — Per-subtype binary multi-tag: a 0-10 score for every one of the 26
 *       subtypes; subtypes scoring >= SCORE_B_THRESHOLD are the fired tags.
 *
 * Uses the OpenAI Responses API. The model is configurable via OPENAI_MODEL.
 * These are reasoning models: temperature/top_p/seed are unavailable, so output
 * consistency comes from low reasoning effort + strict json_schema output — see
 * the determinism note above callModel.
 */
import OpenAI from 'openai';
import {
  buildSystemA,
  buildQueryContent,
  buildSystemBSingle,
  buildBSubtypeUserContent,
} from './prompts';
import {
  type ScoreConfig,
  type ScoreConfigType,
  type ScoreConfigSubtype,
  type ScoreTypeKey,
  SCORE_TYPE_KEYS,
  allCodes,
  isValidTypeKey,
  isValidCode,
  typeKeyOfCode,
} from './config';

// Gates Classifier A rows only (B rows are gated per-subtype by subtypeDefHash,
// which folds in SCORE_B_RUBRIC_VERSION).
//
// v2: classify against PRIOR context (previous student message + the reply the
// student had just seen) instead of the following response — avoids leaking the
// bot's interpretation into the intent label.
// v3: guidance block in the A system prompt (instructions-vs-pasted-text, whose
// text is operated on, referent resolution) + head/tail truncation so trailing
// instructions survive. Rows below the current version are treated as stale and
// re-classified on the next run (see loadStatus).
// v4: taxonomy replaced with the authoritative Jelson "ChatGPT Query Codes"
// scheme (docs/GPTWriting_fewshot_classifier.md) — subtype codes were remapped
// (Planning 8 / Translating 4 / Reviewing 7 / All 7), so every prior label is
// semantically stale and must be re-classified.
export const CLASSIFIER_VERSION = 4;

export interface ClassifierAResult {
  type: ScoreTypeKey | null;
  subtype: string | null;
}

export function isOpenAIConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

let cachedClient: OpenAI | null = null;
function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured on the server.');
  }
  if (!cachedClient) {
    // Higher maxRetries (default is 2) so transient 429/connection errors under
    // the batch's concurrency self-heal with the SDK's exponential backoff.
    cachedClient = new OpenAI({ apiKey, maxRetries: 4 });
  }
  return cachedClient;
}

// Self-heal flags for optional params a model may reject (non-reasoning models
// reject `reasoning`; a few reject strict Structured Outputs). Global hints only;
// the retry decision is made from local state (see callModel).
let reasoningSupported = true;
let structuredSupported = true;

/**
 * Determinism note: the SCORE models are reasoning models — `temperature`,
 * `top_p`, and `seed` are NOT accepted (temperature is fixed at 1 internally,
 * and seed isn't offered on the Responses API), so temperature=0 is impossible
 * here and true determinism cannot be forced. We approximate it the only way
 * these models allow:
 *   1. reasoning effort pinned LOW ('none' for B, 'low' for A) → far less
 *      hidden-chain variance, and the biggest latency/cost lever for the batch.
 *   2. Structured Outputs (strict json_schema) → the output is grammar-
 *      constrained to a tiny discrete set (a 0-10 integer for B; a Type/Subtype
 *      enum for A), so a confident classification lands on the same value across
 *      runs even though sampling can't be pinned. This is best-effort, not a
 *      guarantee — genuinely uncertain (~50/50) inputs can still flip.
 *
 * NOTE: gpt-5.4-* accept effort 'none' | 'low' | 'medium' | 'high' | 'xhigh'
 * (NOT the older 'minimal'). callModel self-heals by dropping `reasoning` or the
 * schema if a model rejects either.
 */
export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh';

export interface StructuredSchema {
  name: string;
  schema: Record<string, unknown>;
}

// Exported for reuse by the v6 intent classifier (intent-classifier.ts) so all
// SCORE LLM calls share one client, one self-heal path, and one retry policy.
export async function callModel(
  systemPrompt: string,
  userPrompt: string,
  model: string,
  effort: ReasoningEffort,
  schema?: StructuredSchema
): Promise<string> {
  const client = getClient();
  const baseInput = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: userPrompt },
  ];

  // Decide retries from what THIS call actually sent (local), not the shared
  // flags. Under the batch's concurrency another call can flip a global flag
  // between our send and our catch; keying the retry off the global would make a
  // call that DID send a param see the flag already false and wrongly give up.
  // We seed from the globals (to skip params known-unsupported) and write back
  // to them as a hint, but the retry guard is purely local.
  let withReasoning = reasoningSupported;
  let withSchema = schema ? structuredSupported : false;

  for (;;) {
    try {
      const response = await client.responses.create({
        model,
        input: baseInput,
        ...(withReasoning ? { reasoning: { effort } } : {}),
        ...(withSchema && schema
          ? { text: { format: { type: 'json_schema', name: schema.name, schema: schema.schema, strict: true } } }
          : {}),
      });
      return (response.output_text ?? '').trim();
    } catch (error) {
      if (withReasoning && isReasoningUnsupported(error)) {
        withReasoning = false;
        reasoningSupported = false; // hint for other calls
        continue;
      }
      if (withSchema && isStructuredOutputUnsupported(error)) {
        // Fall back to free-form JSON; the prompt still instructs the exact
        // shape and extractJsonObject tolerates it.
        withSchema = false;
        structuredSupported = false; // hint for other calls
        continue;
      }
      throw error;
    }
  }
}

function errorMessageOf(error: unknown): string {
  return typeof error === 'object' && error && 'message' in error
    ? String((error as { message: unknown }).message)
    : String(error);
}

/** OpenAI SDK APIError carries the offending field in `.param` (e.g.
 * 'reasoning.effort', 'temperature') — more reliable than scraping the message,
 * whose wording ("Unsupported value: 'minimal' ...") may omit the param name. */
function errorParamOf(error: unknown): string {
  if (typeof error === 'object' && error && 'param' in error) {
    const p = (error as { param: unknown }).param;
    return typeof p === 'string' ? p : '';
  }
  return '';
}

function isReasoningUnsupported(error: unknown): boolean {
  if (errorParamOf(error).startsWith('reasoning')) return true;
  const message = errorMessageOf(error);
  return /reasoning/i.test(message) && /(unsupported|not supported|does not support|unknown|unexpected|invalid)/i.test(message);
}

function isStructuredOutputUnsupported(error: unknown): boolean {
  const param = errorParamOf(error);
  if (param.includes('format') || param.includes('response_format')) return true;
  const message = errorMessageOf(error);
  return (
    /(json.?schema|structured output|text\.format|response_format)/i.test(message) &&
    /(unsupported|not supported|does not support|unknown|unexpected|invalid)/i.test(message)
  );
}

/** Extract the first JSON object from a model reply, tolerating code fences/prose. */
export function extractJsonObject(text: string): Record<string, unknown> {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    // fall through to brace-scan
  }
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    const slice = cleaned.slice(start, end + 1);
    return JSON.parse(slice) as Record<string, unknown>;
  }
  throw new Error(`Model did not return JSON: ${text.slice(0, 200)}`);
}

// Strict json_schema for A: the model may only emit one of the valid Type keys
// (or null) and one of the valid subtype codes (or null). Grammar-constraining
// the labels is our main determinism lever now that temperature is unavailable
// (see the callModel note). Built per-config since codes are editable.
function buildASchema(config: ScoreConfig): StructuredSchema {
  return {
    name: 'intent_classification',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'subtype'],
      properties: {
        type: { type: ['string', 'null'], enum: [...SCORE_TYPE_KEYS, null] },
        subtype: { type: ['string', 'null'], enum: [...allCodes(config), null] },
      },
    },
  };
}

// Strict json_schema for B: exactly one integer 0-10.
const B_SCORE_SCHEMA: StructuredSchema = {
  name: 'subtype_score',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['score'],
    properties: {
      score: { type: 'integer', enum: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
    },
  },
};

// --------------------------------------------------------------------------
// Classifier A — hierarchical single-label
// --------------------------------------------------------------------------
export async function classifyA(
  config: ScoreConfig,
  queryText: string,
  prevQueryText: string | null,
  prevResponseText: string | null,
  model: string
): Promise<{ result: ClassifierAResult; raw: string }> {
  const raw = await callModel(
    buildSystemA(config),
    buildQueryContent(queryText, prevQueryText, prevResponseText),
    model,
    'low', // full-taxonomy pick benefits from a little deliberation
    buildASchema(config)
  );
  const parsed = extractJsonObject(raw);

  let type = typeof parsed.type === 'string' ? (parsed.type as string) : null;
  let subtype = typeof parsed.subtype === 'string' ? (parsed.subtype as string).toUpperCase().trim() : null;

  if (subtype && !isValidCode(config, subtype)) {
    subtype = null;
  }
  // Trust the subtype's own type if present; reconcile a mismatched/invalid type.
  if (subtype) {
    type = typeKeyOfCode(config, subtype) ?? null;
  } else if (!isValidTypeKey(type)) {
    type = null;
  }

  return { result: { type: isValidTypeKey(type) ? type : null, subtype }, raw };
}

// --------------------------------------------------------------------------
// Classifier B — SINGLE subtype, scored in isolation (0-10)
//
// One call rates exactly ONE subtype. Scoring each subtype independently is what
// makes the scores partially cacheable: editing one subtype only invalidates
// that subtype's rows (see subtypeDefHash / score_subtype_scores). The caller
// (route) fans this out over every subtype for a query. For prompt-cache reuse,
// pass a `queryContent` built once per query (buildQueryContentB) so all its
// per-subtype calls share the same long prefix.
// --------------------------------------------------------------------------
export async function classifyBSubtype(
  type: ScoreConfigType,
  subtype: ScoreConfigSubtype,
  queryContent: string,
  model: string
): Promise<{ score: number; raw: string }> {
  const raw = await callModel(
    buildSystemBSingle(),
    buildBSubtypeUserContent(queryContent, type, subtype),
    model,
    'none', // one-subtype 0-10 rating against an explicit rubric — no reasoning
    B_SCORE_SCHEMA
  );
  const parsed = extractJsonObject(raw);
  let n = typeof parsed.score === 'number' ? parsed.score : Number(parsed.score);
  if (!Number.isFinite(n)) n = 0;
  n = Math.max(0, Math.min(10, Math.round(n)));
  return { score: n, raw };
}
