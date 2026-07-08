/**
 * SCORE — student-query content builder (client-safe, no `openai` import).
 *
 * Formats the message-to-classify with the prior exchange it is reacting to.
 * The Jelson A/B classifier prompts have been removed; this now serves only the
 * v6 intent classifier (intent-classifier.ts) via buildQueryContent.
 */
import { MATERIAL_LABELS, type DissectionResult } from './intents';

export const MAX_QUERY_CHARS = 4000;
// Prior-context budgets. The query is classified in light of the exchange the
// student had just seen (previous student message + the chatbot reply it drew),
// since that is what the query is reacting to — its referents ("shorten it",
// "translate this", "keep going") live there. The FOLLOWING response is
// deliberately NOT sent: it is downstream of the query, so classifying with it
// leaks the bot's interpretation into the label instead of the student's intent.
export const MAX_PRIOR_QUERY_CHARS = 2000;
export const MAX_PRIOR_RESPONSE_CHARS = 2000;

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

/**
 * Render the deterministic Material/Request split (from dissect.ts) as an
 * explicit steer. This is the fix for the "pasted material read as an implicit
 * request" failure mode: when a student pastes the assignment prompt (or a prior
 * bot reply, or their own draft) the judge used to invent an implicit intent and
 * rate it clearly_in. Telling it — up front, from an authoritative source — which
 * spans are the student's typed request and what KIND the rest of the material is
 * removes that guess. Emitted only when material is actually present; a clean
 * request-only message renders exactly as before.
 */
function renderDissection(dissection: DissectionResult | null | undefined): string {
  if (!dissection || dissection.materialKinds.length === 0) return '';
  const kinds = dissection.materialKinds.map((k) => MATERIAL_LABELS[k]).join(', ');
  const lines = [
    "DISSECTION (reconstructed from the student's edit log — authoritative; use it to tell the request apart from pasted material):",
  ];
  if (dissection.requests.length > 0) {
    const reqs = dissection.requests
      .map((r) => `"${headTail(r.replace(/\s+/g, ' ').trim(), 600)}"`)
      .join('  ·  ');
    lines.push(`- The student's OWN typed request(s) — rate ONLY these: ${reqs}`);
  } else {
    lines.push(
      '- The student typed NO request of their own — the message is pasted material only. Rate every intent probably_out or clearly_out unless an intent is unmistakably implied.'
    );
  }
  lines.push(
    `- The rest is PASTED MATERIAL, context only (${kinds}). NEVER rate material, and do NOT infer a request from it — a pasted assignment prompt is context, not a "write the essay" request; a request that is only a lead-in to pasted material ("Here is the prompt:", "This is my essay:") carries no instruction on its own.`
  );
  return lines.join('\n') + '\n\n';
}

function assembleQueryContent(
  queryText: string,
  prevQueryText: string | null,
  prevResponseText: string | null,
  caps: { query: number; priorQuery: number; priorResponse: number },
  dissection?: DissectionResult | null
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
  content += renderDissection(dissection);
  content += `STUDENT QUERY (the message to classify):\n"""\n${query}\n"""`;
  return content;
}

/**
 * Build the user message: the query to classify, preceded by the prior exchange
 * it is reacting to (previous student message + the chatbot reply the student
 * had just seen). The prior context is reference-only; only the STUDENT QUERY is
 * classified. The following response is intentionally excluded (see the constant
 * notes above).
 */
export function buildQueryContent(
  queryText: string,
  prevQueryText: string | null,
  prevResponseText: string | null,
  dissection?: DissectionResult | null
): string {
  return assembleQueryContent(
    queryText,
    prevQueryText,
    prevResponseText,
    {
      query: MAX_QUERY_CHARS,
      priorQuery: MAX_PRIOR_QUERY_CHARS,
      priorResponse: MAX_PRIOR_RESPONSE_CHARS,
    },
    dissection
  );
}
