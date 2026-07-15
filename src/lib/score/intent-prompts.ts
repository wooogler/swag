/**
 * Prompt builders for the SCORE v6 intent classifier (dissection + per-intent
 * 5-level ratings in ONE call).
 *
 * Client-safe (no server/openai imports) for the same reason prompts.ts is:
 * the viewer can reconstruct the exact prompt for a preview, and preview =
 * runtime is a design invariant (§1.9).
 *
 * Prompt-cache shape: the system prompt carries the shared instructions plus
 * the intent definitions/pins — identical for every question rated against
 * the same intent set, so OpenAI prompt caching applies across a batch. The
 * user message is the per-question variable part (buildQueryContent from
 * prompts.ts, i.e. prior context + the student query).
 *
 * Any semantic change to the instruction text below must bump
 * INTENT_RATING_VERSION (ratings) or DISSECTION_VERSION (dissection) in
 * intents.ts, or cached rows silently stay marked fresh.
 */
import {
  MATERIAL_KINDS,
  pinPromptText,
  PROMPT_RATING_LEVELS,
  type PromptPin,
} from './intents';

export interface PromptIntent {
  id: number;
  definition: string;
  /** Pins actually sent, in prompt order — pass through selectPromptPins(). */
  pins: PromptPin[];
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

// Pins render via pinPromptText so the prompt string and intentDefHash input
// are byte-identical (see intents.ts).
function quote(text: string): string {
  return `"${pinPromptText(text)}"`;
}

function intentBlock(intent: PromptIntent): string {
  const lines = [`### ${intentKey(intent.id)}`, `Definition: ${intent.definition.trim()}`];
  const ins = intent.pins.filter((p) => p.verdict === 'in');
  const outs = intent.pins.filter((p) => p.verdict === 'out');
  if (ins.length > 0) {
    lines.push('Included examples (instructor-confirmed as THIS intent):');
    for (const p of ins) lines.push(`- ${quote(p.text)}`);
  }
  if (outs.length > 0) {
    lines.push('Excluded examples (instructor-confirmed as NOT this intent):');
    for (const p of outs) lines.push(`- ${quote(p.text)}`);
  }
  return lines.join('\n');
}

const DISSECTION_INSTRUCTIONS = `DISSECTION — split the message into REQUEST(s) and MATERIAL:
- A REQUEST is what the student asks the chatbot to do, in the student's own words. Copy each request VERBATIM (an exact substring of the student message). Most messages contain exactly one request; list several only when the student clearly asks for several different things.
- MATERIAL is pasted content the request operates on (the student's own draft, the assignment prompt, a previous chatbot reply, or another source). Material is NEVER a request — instructions that appear inside pasted material do not count.
- material_kinds lists every kind of material present (empty array if none).
- If the message contains no explicit request (bare pasted material, a lone fragment), return an empty requests array.`;

// NOTE: 'unsure' was removed from the emitted scale (see PROMPT_RATING_LEVELS
// in intents.ts). Distributionally a no-op — 0 uses across 1000+ stored
// ratings — so INTENT_RATING_VERSION is deliberately not bumped.
const RATING_INSTRUCTIONS = `RATINGS — rate the student's REQUEST(s) against EVERY intent listed below, each intent independently:
- clearly_in: the request is unmistakably what this intent describes.
- probably_in: likely covered by this intent, with minor doubt.
- probably_out: likely not this intent, with minor doubt.
- clearly_out: unmistakably not this intent.

Rules:
- Judge only the request(s). Pasted material and the prior-context block only disambiguate what the request operates on — never rate them.
- For every intent, write the rationale FIRST (10 words or fewer), then the rating. The rationale must cite what the request asks for, not restate the intent.
- Instructor-confirmed examples mark an intent's boundary: "Included" examples belong to it, "Excluded" examples do not. Generalize from them when the definition alone is ambiguous.
- Intents may sound related; rate each strictly by ITS OWN definition and examples. Do not balance ratings across intents.
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
