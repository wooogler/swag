/**
 * SCORE classifiers (LLM-backed, temperature 0, cached upstream).
 *
 * Two classifiers are run independently per query so their (dis)agreement is
 * meaningful — they are deliberately NOT combined into one call:
 *
 *   A — Hierarchical single-label: exactly one Type (P/T/R/A) + one Subtype.
 *   B — Per-subtype binary multi-tag: a 0-10 score for every one of the 26
 *       subtypes; subtypes scoring >= SCORE_B_THRESHOLD are the fired tags.
 *
 * Uses the OpenAI Responses API (same as src/app/api/chat/route.ts). The model
 * is configurable via OPENAI_MODEL.
 */
import OpenAI from 'openai';
import { resolveScoreModel } from './models';
import { buildSystemA, buildSystemB, buildQueryContent } from './prompts';
import {
  type ScoreConfig,
  type ScoreTypeKey,
  isValidTypeKey,
  isValidCode,
  typeKeyOfCode,
  allCodes,
  SCORE_B_THRESHOLD,
} from './config';

// v2: classify against PRIOR context (previous student message + the reply the
// student had just seen) instead of the following response — avoids leaking the
// bot's interpretation into the intent label. Rows below this version are
// treated as stale and re-classified on the next run (see loadStatus).
export const CLASSIFIER_VERSION = 2;

export interface ClassifierAResult {
  type: ScoreTypeKey | null;
  subtype: string | null;
}

export interface ClassifierBResult {
  tags: string[];
  scores: Record<string, number>;
}

export interface QueryClassification {
  a: ClassifierAResult;
  b: ClassifierBResult;
  rawA: string;
  rawB: string;
  model: string;
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

// Some newer models reject an explicit temperature; remember and stop sending it.
let temperatureSupported = true;

async function callModel(systemPrompt: string, userPrompt: string, model: string): Promise<string> {
  const client = getClient();
  const baseInput = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: userPrompt },
  ];

  const create = (withTemperature: boolean) =>
    client.responses.create({
      model,
      input: baseInput,
      ...(withTemperature ? { temperature: 0 } : {}),
    });

  let response;
  try {
    response = await create(temperatureSupported);
  } catch (error) {
    if (temperatureSupported && isTemperatureUnsupported(error)) {
      temperatureSupported = false;
      response = await create(false);
    } else {
      throw error;
    }
  }

  return (response.output_text ?? '').trim();
}

function isTemperatureUnsupported(error: unknown): boolean {
  const message =
    typeof error === 'object' && error && 'message' in error
      ? String((error as { message: unknown }).message)
      : String(error);
  return /temperature/i.test(message) && /(unsupported|not supported|does not support|only)/i.test(message);
}

/** Extract the first JSON object from a model reply, tolerating code fences/prose. */
function extractJsonObject(text: string): Record<string, unknown> {
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
    model
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
// Classifier B — per-subtype binary multi-tag (0-10 scores)
// --------------------------------------------------------------------------
export async function classifyB(
  config: ScoreConfig,
  queryText: string,
  prevQueryText: string | null,
  prevResponseText: string | null,
  model: string
): Promise<{ result: ClassifierBResult; raw: string }> {
  const raw = await callModel(
    buildSystemB(config),
    buildQueryContent(queryText, prevQueryText, prevResponseText),
    model
  );
  const parsed = extractJsonObject(raw);

  const codes = allCodes(config);
  const scores: Record<string, number> = {};
  for (const code of codes) {
    const value = parsed[code];
    let n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) n = 0;
    n = Math.max(0, Math.min(10, Math.round(n)));
    scores[code] = n;
  }
  const tags = codes.filter((code) => scores[code] >= SCORE_B_THRESHOLD);
  return { result: { tags, scores }, raw };
}

/** Run both classifiers for one query. Independent calls, run in parallel. */
export async function classifyQuery(
  config: ScoreConfig,
  queryText: string,
  prevQueryText: string | null,
  prevResponseText: string | null,
  model?: string
): Promise<QueryClassification> {
  const resolved = resolveScoreModel(model);
  const [a, b] = await Promise.all([
    classifyA(config, queryText, prevQueryText, prevResponseText, resolved),
    classifyB(config, queryText, prevQueryText, prevResponseText, resolved),
  ]);
  return { a: a.result, b: b.result, rawA: a.raw, rawB: b.raw, model: resolved };
}
