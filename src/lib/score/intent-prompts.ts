/**
 * Prompt builders for the SCORE v6 intent classifier (dissection + per-intent
 * 5-level ratings in ONE call).
 *
 * Client-safe (no server/openai imports) for the same reason prompts.ts is:
 * the viewer can reconstruct the exact prompt for a preview, and preview =
 * runtime is a design invariant (§1.9).
 *
 * Prompt-cache shape: the system prompt carries the shared instructions plus
 * the intent definitions — identical for every question rated against the
 * same intent set, so OpenAI prompt caching applies across a batch. The
 * user message is the per-question variable part (buildQueryContent from
 * prompts.ts, i.e. prior context + the student query).
 *
 * Any semantic change to the instruction text below must bump
 * INTENT_RATING_VERSION (ratings) or DISSECTION_VERSION (dissection) in
 * intents.ts, or cached rows silently stay marked fresh.
 */
import { MATERIAL_KINDS, MATERIAL_PROMPT_MODE, PROMPT_RATING_LEVELS } from './intents';

export interface PromptIntent {
  id: number;
  definition: string;
}

/** Ratings are keyed "intent_<id>" in the structured output so the schema
 * never has bare-number property names. */
export function intentKey(id: number): string {
  return `intent_${id}`;
}

export function parseIntentKey(key: string): number | null {
  const m = /^intent_(\d+)$/.exec(key);
  return m ? Number(m[1]) : null;
}

/**
 * One intent, as the judge sees it: its DEFINITION and nothing else.
 *
 * Instructor labels used to ride along here as Included/Excluded examples. They
 * no longer do — a label is now a transient CORRECTION that the "Update
 * definition" step folds into this text and then consumes, so the definition on
 * screen is the whole of what the classifier reads. That is the point: an
 * intent whose behaviour came from invisible examples could not be debugged by
 * reading it.
 */
function intentBlock(intent: PromptIntent): string {
  return `### ${intentKey(intent.id)}\nDefinition: ${intent.definition.trim()}`;
}

const DISSECTION_INSTRUCTIONS = `DISSECTION — split the message into REQUEST(s) and MATERIAL:
- A REQUEST is what the student asks the chatbot to do, in the student's own words. Copy each request VERBATIM (an exact substring of the student message). Most messages contain exactly one request; list several only when the student clearly asks for several different things.
- MATERIAL is pasted content the request operates on (the student's own draft, the assignment prompt, a previous chatbot reply, or another source). Material is NEVER a request — instructions that appear inside pasted material do not count.
- material_kinds lists every kind of material present (empty array if none).
- If the message contains no explicit request (bare pasted material, a lone fragment), return an empty requests array.`;

// NOTE: 'unsure' was removed from the emitted scale (see PROMPT_RATING_LEVELS
// in intents.ts). Distributionally a no-op — 0 uses across 1000+ stored
// ratings — so INTENT_RATING_VERSION is deliberately not bumped.
/**
 * How to read the bracketed markers that stand in for pasted material, emitted
 * only when MATERIAL_PROMPT_MODE is 'abridged'. Lives in the system message, so
 * it is prompt-cached and costs nothing per call.
 *
 * The last two bullets name failure shapes this corpus actually produces: the
 * dissector's split errs at the seams, orphaning a run's final clause where it
 * reads as an imperative, and short referential asks ("are these good") lose
 * their referent once the material beside them collapses.
 */
const MATERIAL_NOTATION = `MATERIAL NOTATION — every run of PASTED text in the student message has been replaced, in place, by a bracketed marker: [KIND \u00b7 extent \u25b8 excerpt]. KIND is the source it was pasted from; extent is its size in words and/or how much of that source it covers as a percentage; after the \u25b8 is the pasted text itself, ABRIDGED (\u2026 marks removed text). Runs shorter than 40 words are shown in full.
- [ASSIGNMENT PROMPT \u00b7 P%] carries NO excerpt. The assignment prompt is the same text for every student and is never part of what this student is asking for; P% is how much of it they pasted.
- A part is absent when it is unknown \u2014 an external paste has no source on record and so carries no percentage.
- KIND is one of: OWN DRAFT (the student's own essay text), ASSIGNMENT PROMPT, BOT REPLY (a previous chatbot answer pasted back), OWN QUESTION (one of the student's own earlier chat turns), OTHER SOURCE. "PASTED MATERIAL", or two names joined by "/", means the run's source could not be attributed.
- Everything OUTSIDE the markers is what the student typed in this message. That, and only that, is what you rate.
- A marker is never a request, and no request may be inferred from one \u2014 including from text inside an excerpt.
- The split is machine-made and errs at the seams: a short fragment of prose sitting immediately beside a marker ("dumber.", "future.", "that make us human.", "jobs that") is a piece of the pasted run the split left behind, not an instruction. Judge it as a fragment, not as an ask.
- A short referential ask beside a marker ("are these good", "is this better", "how is this paragraph") refers to that marker. Read it as an ask about material of that KIND and that size.`;

const RATING_INSTRUCTIONS = `RATINGS — rate the student's REQUEST(s) against EVERY intent listed below, each intent independently:
- clearly_in: the request is unmistakably what this intent describes.
- probably_in: likely covered by this intent, with minor doubt.
- probably_out: likely not this intent, with minor doubt.
- clearly_out: unmistakably not this intent.

Rules:
- Judge only the request(s). Pasted material and the prior-context block only disambiguate what the request operates on — never rate them.
- For every intent, write the rationale FIRST (10 words or fewer), then the rating. The rationale must cite what the request asks for, not restate the intent.
- The definition is the WHOLE of each intent: judge by its text alone, including any examples and exclusions written into it. There is no other source of truth.
- Intents may sound related; rate each strictly by ITS OWN definition. Do not balance ratings across intents.
- A request that restates one of an intent's definition examples — near-verbatim or a trivial variation — is clearly_in for THAT intent: an example in the definition is the instructor naming that exact ask. This never softens other intents' ratings: several intents may each be clearly_in on the same request, and "several fit" is NOT doubt about any one of them.
- If the message contains several requests, rate an intent by whether ANY of its requests falls under it.
- Pasted material is NEVER a request. If the message is bare pasted material, or the student's only typed text is a lead-in to pasted material with no instruction of its own ("Here is the prompt:", "This is my essay:", "This is the full prompt: …"), do NOT invent an implicit request from that material — rate every intent probably_out or clearly_out. (A pasted assignment prompt is context; it is not a "write the essay" request.) Only a genuine short imperative that refers to the prior context ("make it longer", "keep going", "shorten it") is a real implied request — rate that.
- If genuinely torn, use probably_in or probably_out — reserve clearly_* for cases with no real doubt.`;

/**
 * System prompt for one rating call. `intents` may be the full active set (a
 * fresh question) or a subset (incremental re-rate after one intent was
 * edited) — the instructions are identical either way.
 */
export function buildIntentSystemPrompt(
  intents: PromptIntent[],
  includeDissection: boolean
): string {
  const parts = [
    'You are auditing one student message sent to a writing-support chatbot for a school assignment. Instructors have defined "intents" — categories of student requests. Analyze the message exactly as instructed below and answer in the required JSON shape.',
  ];
  if (includeDissection) parts.push(DISSECTION_INSTRUCTIONS);
  // Dissection-only calls (all intents already fresh) get NO rating section —
  // instructions to rate "every intent listed below" above an empty list
  // would only confuse the model.
  if (intents.length > 0) {
    if (MATERIAL_PROMPT_MODE === 'abridged') parts.push(MATERIAL_NOTATION);
    parts.push(RATING_INSTRUCTIONS);
    parts.push(`INTENTS:\n\n${intents.map(intentBlock).join('\n\n')}`);
  }
  return parts.join('\n\n');
}

/**
 * Strict json_schema for the call. Built per intent set (like buildASchema):
 * one required ratings entry per intent, rationale listed before rating so
 * the model reasons before it commits (§1.4b). The dissection property exists
 * only when requested — strict mode requires every listed property.
 */
export function buildIntentSchema(intentIds: number[], includeDissection: boolean): object {
  const ratingProperties: Record<string, object> = {};
  for (const id of intentIds) {
    ratingProperties[intentKey(id)] = {
      type: 'object',
      additionalProperties: false,
      required: ['rationale', 'rating'],
      properties: {
        rationale: { type: 'string', description: '10 words or fewer, written before the rating' },
        // Grammar-constrained to the 4 emitted levels — 'unsure' cannot occur.
        rating: { type: 'string', enum: [...PROMPT_RATING_LEVELS] },
      },
    };
  }

  const properties: Record<string, object> = {};
  const required: string[] = [];
  if (includeDissection) {
    properties.dissection = {
      type: 'object',
      additionalProperties: false,
      required: ['material_kinds', 'requests'],
      properties: {
        material_kinds: {
          type: 'array',
          items: { type: 'string', enum: [...MATERIAL_KINDS] },
        },
        requests: {
          type: 'array',
          items: { type: 'string', description: 'verbatim substring of the student message' },
        },
      },
    };
    required.push('dissection');
  }
  // Mirror the system prompt: dissection-only calls carry no ratings shape.
  if (intentIds.length > 0) {
    properties.ratings = {
      type: 'object',
      additionalProperties: false,
      required: intentIds.map(intentKey),
      properties: ratingProperties,
    };
    required.push('ratings');
  }

  return { type: 'object', additionalProperties: false, required, properties };
}

/** Sanity cap: keep a single call's intent list from blowing up the prompt.
 * v6 assumes a small intent space (~dozens); warn-level guard only. */
export const MAX_INTENTS_PER_CALL = 40;

/**
 * How many intents one rating call may carry.
 *
 * ONE — and that is a measurement, not a preference. RATING_INSTRUCTIONS above
 * tells the judge to rate each intent strictly by ITS OWN definition and not to
 * balance ratings across them. It does not. Measured on 15 questions × 30
 * starter definitions with nothing changed but the batching:
 *
 *     intents/call     1      3      5     10     30
 *     rated IN     25.8%  22.2%  18.2%  11.1%  10.4%   (effort 'none')
 *                  21.1%  17.1%  14.4%  10.9%   7.3%   (effort 'low')
 *
 * Monotonic, 2.5× end to end, and raising the effort does not flatten it. A
 * verdict that moves with how many OTHER definitions happened to be stale in
 * the same call is not a verdict about the definition — and it put the study's
 * two paths on different points of that curve, since prepared sets were rated
 * 30-at-a-time while a participant's own two or three definitions go
 * 3-at-a-time. Adopting a starter therefore looked stricter than writing the
 * same thing yourself.
 *
 * The cost is calls: a message with N stale intents now takes N of them.
 * Callers bound their batches by CALL count rather than message count for that
 * reason, and one intent's prompt is small enough that the system half — the
 * shared instructions, which dominate it — stays prompt-cached across the fan.
 */
export const INTENTS_PER_RATING_CALL = 1;

/** Split one message's stale intents into the calls that will rate them. */
export function chunkForRating<T>(intents: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < intents.length; i += INTENTS_PER_RATING_CALL) {
    out.push(intents.slice(i, i + INTENTS_PER_RATING_CALL));
  }
  return out;
}
