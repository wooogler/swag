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
import type { ScoreConfig } from './config';
import { allCodes } from './config';

export const MAX_QUERY_CHARS = 4000;
// Prior-context budgets. The query is classified in light of the exchange the
// student had just seen (previous student message + the chatbot reply it drew),
// since that is what the query is reacting to — its referents ("shorten it",
// "translate this", "keep going") live there. The FOLLOWING response is
// deliberately NOT sent: it is downstream of the query, so classifying with it
// leaks the bot's interpretation into the label instead of the student's intent.
export const MAX_PRIOR_QUERY_CHARS = 2000;
export const MAX_PRIOR_RESPONSE_CHARS = 2000;

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

function fewShotB(config: ScoreConfig): string {
  const lines: string[] = [];
  for (const t of config.types) {
    for (const s of t.subtypes) {
      for (const ex of s.examples) {
        lines.push(
          `Q: ${JSON.stringify(ex)}\nA: subtype ${s.code} clearly applies (score it high, ~9; unrelated subtypes near 0).`
        );
      }
    }
  }
  return lines.length
    ? `\n\nLABELED EXAMPLES (each query and the subtype that best applies):\n${lines.join('\n')}`
    : '';
}

function noneBlockA(config: ScoreConfig): string {
  const ex = config.noneExamples ?? [];
  if (!ex.length) return '';
  const lines = ex.map((q) => `Q: ${JSON.stringify(q)}\nA: {"type": null, "subtype": null}`);
  return `\n\nQUERIES THAT FIT NO SUBTYPE (return nulls — do NOT force a category):\n${lines.join('\n')}`;
}

function noneBlockB(config: ScoreConfig): string {
  const ex = config.noneExamples ?? [];
  if (!ex.length) return '';
  const lines = ex.map((q) => `Q: ${JSON.stringify(q)}\nA: every subtype scores 0 (no writing request).`);
  return `\n\nQUERIES THAT MATCH NO SUBTYPE (all scores 0):\n${lines.join('\n')}`;
}

/** System prompt for Classifier A — hierarchical single-label. */
export function buildSystemA(config: ScoreConfig): string {
  return `You are an expert annotator classifying student-to-chatbot writing queries by intent.

Classify the STUDENT QUERY into exactly ONE Type and exactly ONE Subtype within that Type. Pick the single best fit; if the query spans several writing activities or delegates whole-essay generation to the chatbot, use the "All" type.

If the query does NOT fit any subtype below — e.g. an off-topic remark, a greeting, a thank-you, a meta-question about the chatbot itself, or anything unrelated to working on the writing task — return {"type": null, "subtype": null} instead of forcing a category.

Taxonomy:
${buildTaxonomyText(config)}${fewShotA(config)}${noneBlockA(config)}

Respond with ONLY a JSON object, no prose, in exactly one of these shapes:
{"type": "Planning|Translating|Reviewing|All", "subtype": "<one subtype code>"}
{"type": null, "subtype": null}
When a subtype is given it MUST belong to the chosen type.`;
}

/** System prompt for Classifier B — per-subtype multi-tag (0-10 scores). */
export function buildSystemB(config: ScoreConfig): string {
  const codes = allCodes(config);
  const exampleShape = `{${codes.slice(0, 3).map((c) => `"${c}": 0`).join(', ')}}`;
  return `You are an expert annotator classifying student-to-chatbot writing queries by intent.

For the STUDENT QUERY, independently rate EACH subtype below from 0 to 10 for how strongly the query includes that kind of request (0 = clearly absent, 10 = clearly the main request). A single query may genuinely include several kinds of requests — score each one on its own merits; do not force them to sum to anything.

Taxonomy:
${buildTaxonomyText(config)}${fewShotB(config)}${noneBlockB(config)}

Respond with ONLY a JSON object, no prose: keys are ALL of these subtype codes, values are integers 0-10. Example shape (values illustrative):
${exampleShape}
Include every one of these codes: ${codes.join(', ')}.`;
}

/**
 * Build the user message for a classifier call: the query to classify, preceded
 * by the prior exchange it is reacting to (previous student message + the
 * chatbot reply the student had just seen). The prior context is reference-only;
 * only the STUDENT QUERY is classified. See the constant notes above for why the
 * following response is intentionally excluded.
 */
export function buildQueryContent(
  queryText: string,
  prevQueryText: string | null,
  prevResponseText: string | null
): string {
  const query = queryText.slice(0, MAX_QUERY_CHARS);

  const priorParts: string[] = [];
  if (prevQueryText && prevQueryText.trim()) {
    priorParts.push(
      `Previous student message:\n"""\n${prevQueryText.slice(0, MAX_PRIOR_QUERY_CHARS)}\n"""`
    );
  }
  if (prevResponseText && prevResponseText.trim()) {
    priorParts.push(
      `Chatbot reply the student is responding to:\n"""\n${prevResponseText.slice(0, MAX_PRIOR_RESPONSE_CHARS)}\n"""`
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
