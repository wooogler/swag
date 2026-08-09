/**
 * SCORE — student-query content builder (client-safe, no `openai` import).
 *
 * Formats the message-to-classify with the prior exchange it is reacting to.
 * The Jelson A/B classifier prompts have been removed; this now serves only the
 * v6 intent classifier (intent-classifier.ts) via buildQueryContent.
 */
import {
  MATERIAL_LABELS,
  MATERIAL_PROMPT_MODE,
  type DissectionResult,
  type MaterialKind,
  type PromptDissection,
} from './intents';
import { materialTagBody, segmentForMaterials, type MsgSeg } from './material-render';

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
export function headTail(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const head = Math.floor(maxChars * 0.7);
  const tail = maxChars - head;
  const omitted = text.length - head - tail;
  return `${text.slice(0, head)}\n[... ${omitted} characters omitted ...]\n${text.slice(text.length - tail)}`;
}

/* ------------------------------------------------------------------ */
/* Abridged material markers (rating prompt only)                      */
/* ------------------------------------------------------------------ */

/** Words kept from the head / tail of an abridged run. The TAIL is not
 * decoration: the dissector's characteristic error is leaving the last word or
 * clause of a pasted run OUTSIDE the run ("dumber.", "future.", "jobs that"),
 * where sitting next to a bare marker it reads as an imperative. The tail
 * reconnects the orphan to the sentence it came from. */
const EXCERPT_HEAD_WORDS = 20;
const EXCERPT_TAIL_WORDS = 10;
/** Collapsing has to delete at least this much to be worth doing, so a run
 * shorter than head+tail+this is shown in full. */
const MIN_WORDS_SAVED = 10;
const ABRIDGE_MIN_WORDS = EXCERPT_HEAD_WORDS + EXCERPT_TAIL_WORDS + MIN_WORDS_SAVED;

function materialExcerpt(runText: string): string | null {
  const w = runText.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (w.length === 0) return null;
  const body =
    w.length < ABRIDGE_MIN_WORDS
      ? w.join(' ')
      : `${w.slice(0, EXCERPT_HEAD_WORDS).join(' ')} … ${w.slice(-EXCERPT_TAIL_WORDS).join(' ')}`;
  // Keep the marker unambiguously delimited when the pasted text has brackets.
  return body.replace(/\[/g, '(').replace(/\]/g, ')');
}

/**
 * One pasted run as the judge sees it. The tag body is EXACTLY the string the
 * instructor's board shows for this run — same function, not a second renderer.
 *
 * ASSIGNMENT PROMPT runs carry no excerpt at all. It is the one source whose
 * content adds nothing a rating decision can use: identical for every student,
 * already known to the instructor, and its coverage % is the whole story (the
 * board's own tag drops the word count for this kind for that same reason). It
 * is also the source whose text IS a list of questions, which is the mechanism
 * behind "pasted prompt rated as the student's own question".
 */
function materialMarker(
  seg: Extract<MsgSeg, { kind: 'material' }>,
  kinds: MaterialKind[],
  excerpts: boolean
): string {
  const body = materialTagBody(seg.mk, kinds, seg.text, seg.span);
  if (!excerpts || seg.mk === 'assignment_prompt') return `[${body}]`;
  const excerpt = materialExcerpt(seg.text);
  return excerpt ? `[${body} ▸ ${excerpt}]` : `[${body}]`;
}

/**
 * The message with every located MATERIAL run replaced, in position, by its
 * marker. Returns null when nothing was replaced — the caller then sends the
 * raw message and the verbatim preamble, byte for byte.
 *
 * Drives off MATERIAL runs, not requests. This is deliberately NOT
 * buildEmbedText's contract, which bails when `requests` is empty: that fires
 * on exactly the messages that are pasted material and nothing else — the
 * population this substitution exists for.
 */
export function abridgeQuery(
  queryText: string,
  dissection?: DissectionResult | null,
  /** `excerpts: false` drops every excerpt, so each run collapses to its tag
   * alone — the "pure metadata" rendering. Shipped behaviour is `true`; this
   * exists so an offline A/B can measure the two against each other. */
  opts?: { excerpts?: boolean }
): string | null {
  if (!dissection || dissection.materialKinds.length === 0) return null;
  const excerpts = opts?.excerpts ?? true;
  const segs = segmentForMaterials(
    queryText,
    dissection.requests,
    dissection.materialKinds,
    dissection.materials
  );
  if (!segs.some((s) => s.kind === 'material')) return null;
  return segs
    .map((s) =>
      s.kind === 'text' ? s.text : materialMarker(s, dissection.materialKinds, excerpts)
    )
    .join('');
}

/**
 * EXPERIMENTS ONLY — the classifier user message with a pre-substituted body.
 *
 * Exists so an offline A/B can compare material renderings for the TYPE
 * classifier without any production caller gaining a way to change the shipped
 * type prompt. buildQueryContent deliberately has no mode argument (a cached
 * type row has no repair path); this is a separate symbol so `grep` shows at a
 * glance that only scripts/ reach it. Nothing under src/ may call this.
 */
export function buildQueryContentForExperiment(
  queryText: string,
  prevQueryText: string | null,
  prevResponseText: string | null,
  dissection: DissectionResult | null | undefined,
  abridgedBody: string | null
): string {
  return assembleQueryContent(
    queryText,
    prevQueryText,
    prevResponseText,
    CAPS,
    dissection,
    abridgedBody
  );
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
function renderDissection(
  dissection: DissectionResult | null | undefined,
  abridged = false
): string {
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
  // "The rest is PASTED MATERIAL" stops being true once each run is marked in
  // place, so the abridged mode names the markers instead of "the rest".
  lines.push(
    abridged
      ? '- Every run of PASTED MATERIAL below has been replaced, in place, by a [KIND · extent ▸ …] marker (see MATERIAL NOTATION). Material is context, NEVER a request: a pasted assignment prompt is context, not a "write the essay" request, and a lead-in to a paste ("Here is the prompt:", "This is my essay:") carries no instruction on its own.'
      : `- The rest is PASTED MATERIAL, context only (${kinds}). NEVER rate material, and do NOT infer a request from it — a pasted assignment prompt is context, not a "write the essay" request; a request that is only a lead-in to pasted material ("Here is the prompt:", "This is my essay:") carries no instruction on its own.`
  );
  return lines.join('\n') + '\n\n';
}

function assembleQueryContent(
  queryText: string,
  prevQueryText: string | null,
  prevResponseText: string | null,
  caps: { query: number; priorQuery: number; priorResponse: number },
  dissection?: DissectionResult | null,
  /** Pre-substituted message body. When set, the preamble switches to the
   * marker legend. Undefined → every line below runs exactly as it did before
   * abridgement existed. */
  abridgedBody?: string | null
): string {
  // Substitute FIRST, cap SECOND — otherwise the 4000-char cap elides material
  // that abridgement was about to delete anyway, and can eat a trailing request.
  const query = headTail(abridgedBody ?? queryText, caps.query);

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
  content += renderDissection(dissection, abridgedBody != null);
  content += `STUDENT QUERY (the message to classify):\n"""\n${query}\n"""`;
  return content;
}

const CAPS = {
  query: MAX_QUERY_CHARS,
  priorQuery: MAX_PRIOR_QUERY_CHARS,
  priorResponse: MAX_PRIOR_RESPONSE_CHARS,
};

/**
 * Build the user message: the query to classify, preceded by the prior exchange
 * it is reacting to (previous student message + the chatbot reply the student
 * had just seen). The prior context is reference-only; only the STUDENT QUERY is
 * classified. The following response is intentionally excluded (see the constant
 * notes above).
 *
 * Material is sent VERBATIM here, in every mode. This is the TYPE classifier's
 * builder (and the eval scripts'). Do NOT give it a mode argument: a defaulted
 * parameter is one careless call away from changing the type prompt, and a
 * TYPE_CLASSIFIER_VERSION bump has no incremental repair path — types are
 * judged once per message ever and copied master→clone to hold every study
 * participant to identical conditions.
 */
export function buildQueryContent(
  queryText: string,
  prevQueryText: string | null,
  prevResponseText: string | null,
  dissection?: DissectionResult | null
): string {
  return assembleQueryContent(queryText, prevQueryText, prevResponseText, CAPS, dissection);
}

/**
 * The INTENT-RATING user message — the one path where pasted material collapses
 * into the marker the instructor reads. Identical to buildQueryContent while
 * MATERIAL_PROMPT_MODE is 'verbatim', and identical for any message whose
 * material cannot be located, in either mode.
 */
export function buildRatingQueryContent(
  queryText: string,
  prevQueryText: string | null,
  prevResponseText: string | null,
  dissection?: PromptDissection | null
): string {
  const abridged =
    MATERIAL_PROMPT_MODE === 'abridged' ? abridgeQuery(queryText, dissection) : null;
  return assembleQueryContent(queryText, prevQueryText, prevResponseText, CAPS, dissection, abridged);
}
