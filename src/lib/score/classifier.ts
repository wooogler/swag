/**
 * SCORE — shared LLM client for the Responses API.
 *
 * Was the Jelson A/B classifier; the tags/classify layer has been removed, so
 * this now holds only the pieces every SCORE LLM call shares: one OpenAI client
 * (single retry policy), the self-healing `callModel` wrapper, and JSON
 * extraction. Consumed by the v6 intent classifier and the intent routes.
 */
import OpenAI from 'openai';

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
    // Client-wide timeout caps a HUNG request at 120s instead of the SDK's
    // 600s default — one stuck call must not stall a whole rate batch for
    // minutes. Latency-sensitive callers pass tighter per-call opts below.
    cachedClient = new OpenAI({ apiKey, maxRetries: 4, timeout: 120_000 });
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
 * `top_p`, and `seed` are NOT accepted, so temperature=0 is impossible here and
 * true determinism cannot be forced. We approximate it with low reasoning effort
 * + strict json_schema output (grammar-constrained to a small discrete set), so a
 * confident answer lands on the same value across runs. Best-effort, not a
 * guarantee — genuinely uncertain inputs can still flip.
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

/** Per-call overrides for latency-sensitive callers: `timeoutMs` aborts a hung
 * request early; `maxRetries` caps the SDK's backoff loop (a failed rating is
 * cheap to re-run on the next Apply, so fail fast beats waiting minutes). */
export interface CallOptions {
  timeoutMs?: number;
  maxRetries?: number;
}

// Shared by the v6 intent classifier (intent-classifier.ts) so all SCORE LLM
// calls use one client, one self-heal path, and one retry policy.
export async function callModel(
  systemPrompt: string,
  userPrompt: string,
  model: string,
  effort: ReasoningEffort,
  schema?: StructuredSchema,
  opts?: CallOptions
): Promise<string> {
  const client = getClient();
  const requestOptions = {
    ...(opts?.timeoutMs !== undefined ? { timeout: opts.timeoutMs } : {}),
    ...(opts?.maxRetries !== undefined ? { maxRetries: opts.maxRetries } : {}),
  };
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
      const response = await client.responses.create(
        {
          model,
          input: baseInput,
          ...(withReasoning ? { reasoning: { effort } } : {}),
          ...(withSchema && schema
            ? { text: { format: { type: 'json_schema', name: schema.name, schema: schema.schema, strict: true } } }
            : {}),
        },
        requestOptions
      );
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
