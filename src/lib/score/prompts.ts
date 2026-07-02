/**
 * SCORE classifier prompt construction (config-driven, with few-shot examples).
 *
 * Kept separate from classifier.ts (which imports the OpenAI SDK) so the viewer
 * can rebuild the exact prompt that was sent — for the prompt/result preview
 * modal — without bundling `openai` into the client. Client-safe.
 *
 * Few-shot examples come from the (editable) config and are placed in the SYSTEM
 * prompt, which is identical across queries → OpenAI prompt caching applies, so
 * the extra tokens are largely free after the first call.
 */
import type { ScoreConfig, ScoreConfigType, ScoreConfigSubtype } from './config';
import { B_MAX_EXAMPLES_PER_CALL } from './config';

export const MAX_QUERY_CHARS = 4000;
// Prior-context budgets. The query is classified in light of the exchange the
// student had just seen (previous student message + the chatbot reply it drew),
// since that is what the query is reacting to — its referents ("shorten it",
// "translate this", "keep going") live there. The FOLLOWING response is
// deliberately NOT sent: it is downstream of the query, so classifying with it
// leaks the bot's interpretation into the label instead of the student's intent.
export const MAX_PRIOR_QUERY_CHARS = 2000;
export const MAX_PRIOR_RESPONSE_CHARS = 2000;

// Classifier B sends the query context once PER SUBTYPE, so its context budget
// is deliberately tighter than A's: enough to resolve referents ("shorten it",
// "keep going", "that essay") without resending whole essays N times. Cached
// input tokens still count toward OpenAI TPM rate limits, so this cap directly
// buys rate-limit headroom, not just cost.
export const B_MAX_QUERY_CHARS = 3000;
export const B_MAX_PRIOR_QUERY_CHARS = 600;
export const B_MAX_PRIOR_RESPONSE_CHARS = 1000;

/**
 * Truncate long text by keeping the head and the tail, eliding the middle.
 * Students often paste an essay with the actual instruction at the START or the
 * END — a plain prefix slice silently deletes trailing instructions, which is
 * exactly the part that carries intent.
 */
function headTail(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const head = Math.floor(maxChars * 0.7);
  const tail = maxChars - head;
  const omitted = text.length - head - tail;
  return `${text.slice(0, head)}\n[... ${omitted} characters omitted ...]\n${text.slice(text.length - tail)}`;
}

export function buildTaxonomyText(config: ScoreConfig): string {
  return config.types
    .map((t) => {
      const header = `${t.label} (${t.letter}) — ${t.description}`;
      const lines = t.subtypes.map((s) => `  - ${s.code} ${s.label}: ${s.description}`);
      return [header, ...lines].join('\n');
    })
    .join('\n\n');
}

function fewShotA(config: ScoreConfig): string {
  const lines: string[] = [];
  for (const t of config.types) {
    for (const s of t.subtypes) {
      for (const ex of s.examples) {
        lines.push(`Q: ${JSON.stringify(ex)}\nA: {"type":"${t.key}","subtype":"${s.code}"}`);
      }
    }
  }
  return lines.length
    ? `\n\nLABELED EXAMPLES (each query and its single correct classification):\n${lines.join('\n')}`
    : '';
}

function noneBlockA(config: ScoreConfig): string {
  const ex = config.noneExamples ?? [];
  if (!ex.length) return '';
  const lines = ex.map((q) => `Q: ${JSON.stringify(q)}\nA: {"type": null, "subtype": null}`);
  return `\n\nQUERIES THAT FIT NO SUBTYPE (return nulls — do NOT force a category):\n${lines.join('\n')}`;
}

/** System prompt for Classifier A — hierarchical single-label. */
export function buildSystemA(config: ScoreConfig): string {
  return `You are an expert annotator classifying student-to-chatbot writing queries by intent.

Classify the STUDENT QUERY into exactly ONE Type and exactly ONE Subtype within that Type. Use ONLY the Type and Subtype descriptions and the labeled examples below as classification criteria.

If the query fits no subtype — an off-topic remark, a greeting, a thank-you, a meta-question about the chatbot itself, or anything else unrelated to the writing task — return {"type": null, "subtype": null} rather than forcing a category.

Taxonomy:
${buildTaxonomyText(config)}${fewShotA(config)}${noneBlockA(config)}

Respond with ONLY a JSON object, no prose, in exactly one of these shapes:
{"type": "Planning|Translating|Reviewing|All", "subtype": "<one subtype code>"}
{"type": null, "subtype": null}
The subtype MUST belong to the chosen type.`;
}


// --------------------------------------------------------------------------
// Classifier B — SINGLE-subtype scoring (independent per-subtype calls).
//
// Instead of one call that scores all subtypes together, B scores each subtype
// in its own call so the scores are independent (and thus partially cacheable —
// see subtypeDefHash / score_subtype_scores). For prompt caching to pay off, the
// long shared content (fixed rubric + this query + prior context) must be a
// common PREFIX across a query's per-subtype calls; only the small subtype block
// varies, so it goes at the very END of the user message.
// --------------------------------------------------------------------------

/**
 * System prompt for a single-subtype B call. FIXED text (identical for every
 * subtype and every query) → a stable, globally cacheable prefix. Keep in sync
 * with SCORE_B_RUBRIC_VERSION: bump the version whenever this wording changes so
 * previously cached scores are invalidated.
 */
export function buildSystemBSingle(): string {
  return `You are an expert annotator rating student-to-chatbot writing queries by intent.

You are shown a STUDENT QUERY (with the prior exchange it is reacting to, for reference only) and exactly ONE intent category. Rate from 0 to 10 how strongly the STUDENT QUERY requests THIS specific kind of help:
  0     = this intent is clearly absent
  1-3   = only a faint or incidental hint of it
  4-6   = clearly present, but not the main request
  7-8   = a major part of what the query asks for
  9-10  = this is exactly / mainly what the query asks for

Rules:
- Judge ONLY this one intent, on its own merits — do not compare it against other intents, and do not assume the query must match something.
- Use ONLY the category's descriptions and examples below as rating criteria.
- If the query is off-topic, a greeting, a thank-you, or a meta-question about the chatbot, score 0.

Respond with ONLY a JSON object, no prose, in exactly this shape:
{"score": <integer 0-10>}`;
}

/**
 * User message for a single-subtype B call: the shared query block FIRST (so it
 * is a prompt-cache hit across this query's other per-subtype calls), then the
 * one intent to rate LAST as the small variable suffix. `queryContent` must be
 * the exact string returned by buildQueryContentB for this query.
 *
 * The parent Type header is included to place the subtype within its paper
 * category. Examples are capped at B_MAX_EXAMPLES_PER_CALL; subtypeDefHash hashes
 * the SAME slice, so edits beyond the cap don't trigger pointless re-scores.
 */
export function buildBSubtypeUserContent(
  queryContent: string,
  type: ScoreConfigType,
  subtype: ScoreConfigSubtype
): string {
  const shown = subtype.examples.slice(0, B_MAX_EXAMPLES_PER_CALL);
  const examples = shown.length
    ? '\nExamples of queries that DO request this:\n' +
      shown.map((e) => `- ${JSON.stringify(e)}`).join('\n')
    : '';
  return (
    `${queryContent}\n\n` +
    'INTENT TO RATE (score only this one):\n' +
    `Type: ${type.label} (${type.letter}) — ${type.description}\n` +
    `Subtype: ${subtype.code} — ${subtype.label}: ${subtype.description}${examples}`
  );
}

function assembleQueryContent(
  queryText: string,
  prevQueryText: string | null,
  prevResponseText: string | null,
  caps: { query: number; priorQuery: number; priorResponse: number }
): string {
  const query = headTail(queryText, caps.query);

  const priorParts: string[] = [];
  if (prevQueryText && prevQueryText.trim()) {
    priorParts.push(
      `Previous student message:\n"""\n${headTail(prevQueryText, caps.priorQuery)}\n"""`
    );
  }
  if (prevResponseText && prevResponseText.trim()) {
    priorParts.push(
      `Chatbot reply the student is responding to:\n"""\n${headTail(prevResponseText, caps.priorResponse)}\n"""`
    );
  }

  let content = '';
  if (priorParts.length) {
    content +=
      'PRIOR CONTEXT (the exchange the student had just seen — for reference only, do NOT classify this):\n' +
      `${priorParts.join('\n\n')}\n\n`;
  }
  content += `STUDENT QUERY (the message to classify):\n"""\n${query}\n"""`;
  return content;
}

/**
 * Build the user message for a Classifier A call: the query to classify,
 * preceded by the prior exchange it is reacting to (previous student message +
 * the chatbot reply the student had just seen). The prior context is
 * reference-only; only the STUDENT QUERY is classified. See the constant notes
 * above for why the following response is intentionally excluded.
 */
export function buildQueryContent(
  queryText: string,
  prevQueryText: string | null,
  prevResponseText: string | null
): string {
  return assembleQueryContent(queryText, prevQueryText, prevResponseText, {
    query: MAX_QUERY_CHARS,
    priorQuery: MAX_PRIOR_QUERY_CHARS,
    priorResponse: MAX_PRIOR_RESPONSE_CHARS,
  });
}

/**
 * Compact variant for Classifier B calls (sent once per subtype — see the
 * B_MAX_* constants). Same structure as buildQueryContent, tighter budgets.
 */
export function buildQueryContentB(
  queryText: string,
  prevQueryText: string | null,
  prevResponseText: string | null
): string {
  return assembleQueryContent(queryText, prevQueryText, prevResponseText, {
    query: B_MAX_QUERY_CHARS,
    priorQuery: B_MAX_PRIOR_QUERY_CHARS,
    priorResponse: B_MAX_PRIOR_RESPONSE_CHARS,
  });
}
