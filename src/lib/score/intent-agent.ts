/**
 * SCORE v6 — LLM helpers for the intent SPEC itself (server-only).
 *
 *  · generateIntentTitle — a short auto-title on every save, like git's
 *    auto-generated commit subject. Cheap model, never blocks a save
 *    (callers fall back to a definition-head title on failure).
 *  · refineDefinition — rewrite the definition FROM the instructor's labeled
 *    examples (Included/Excluded pins), so the boundary knowledge moves INTO
 *    the definition text. The pins are ALSO injected into the rating prompt
 *    (intent-prompts.ts), so the rewrite is what lets the instructor retire
 *    them afterwards — until then the two teach the boundary in parallel. Uses
 *    the stronger refine model with high reasoning effort; the prompt forces
 *    the model to reason example-by-example BEFORE committing to a rewrite.
 */
import { callModel, extractJsonObject } from './classifier';
import { pinPromptText } from './intents';

/** Small/fast model for the git-commit-style auto-title (env-overridable). */
const TITLE_MODEL = process.env.SCORE_TITLE_MODEL || 'gpt-5.4-nano';

/** The stronger model used for definition refinement (env-overridable). */
export const REFINE_MODEL = process.env.SCORE_REFINE_MODEL || 'gpt-5.4';

const TITLE_SYSTEM = `You name intent categories for an instructor dashboard. An intent is a category of student requests sent to a writing-assignment chatbot, described by a definition ("asks to ...").

Return a TITLE for the intent: an imperative noun phrase of AT MOST 5 words, capitalized like a sentence, no trailing period — the style of a git commit subject. Examples: "Write whole essay", "Fix grammar only", "Brainstorm topic ideas".`;

const TITLE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title'],
  properties: { title: { type: 'string', description: 'at most 5 words, no trailing period' } },
};

/** Auto-title from the definition. Returns null on any failure — callers keep
 * their fallback title; a save must never fail because of this call. */
export async function generateIntentTitle(definition: string): Promise<string | null> {
  try {
    const raw = await callModel(
      TITLE_SYSTEM,
      `Definition: ${definition.trim()}`,
      TITLE_MODEL,
      'low',
      { name: 'intent_title', schema: TITLE_SCHEMA as Record<string, unknown> },
      // Best-effort nicety on the save path — never let it hang a save.
      { timeoutMs: 20_000, maxRetries: 1 }
    );
    const parsed = extractJsonObject(raw);
    const title = typeof parsed.title === 'string' ? parsed.title.trim().replace(/\.$/, '') : '';
    return title.length > 0 && title.length <= 120 ? title : null;
  } catch (error) {
    console.error('SCORE intent auto-title failed (keeping fallback):', error);
    return null;
  }
}

const REFINE_SYSTEM = `You maintain the intent definitions of SCORE, an instructor tool that classifies student requests sent to a writing-assignment chatbot. An INTENT DEFINITION describes a category of student requests ("asks to ..."). The labeled examples below are currently handed to the classifier alongside the definition, and the instructor RETIRES them once your rewrite lands — from then on the classifier sees the definition ALONE. So every boundary those labels teach must survive inside the definition text itself.

The instructor reviewed real student questions and hand-labeled them:
- INCLUDED: belongs to this intent.
- EXCLUDED: does NOT belong, even when it looks similar.

Your task: rewrite the current definition so that, standing alone (without ever seeing these labels), it clearly INCLUDES every included example and clearly EXCLUDES every excluded example.

Reason through these steps IN ORDER in the "reasoning" field BEFORE writing anything else:
1. For each INCLUDED example, name the essential action and object of the request (what is asked, of what).
2. For each EXCLUDED example, name the one property that separates it from the included ones.
3. State the common thread of the included examples, and the boundary conditions the excluded ones imply.
4. Audit the current definition against steps 1–3: what does it wrongly exclude, wrongly include, or leave vague?

Then write the new definition:
- One or two sentences, starting with "asks" (keep the current definition's style).
- Generalize the common thread; make exclusions explicit as boundary clauses (e.g. "— but not when the student only ...").
- Self-contained and concrete: no "etc.", no reference to "the examples", never quote an example verbatim.
- Preserve the current definition's scope except where the labels contradict it.
- If the labels do not actually require a change, return the current definition unchanged and say so in the reasoning.

Also return a short TITLE: an imperative noun phrase of at most 5 words, like a git commit subject.`;

const REFINE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reasoning', 'definition', 'title'],
  properties: {
    reasoning: {
      type: 'string',
      description: 'steps 1-4, compact (~150 words max), written before the definition',
    },
    definition: { type: 'string', description: 'the rewritten self-contained definition' },
    title: { type: 'string', description: 'at most 5 words, no trailing period' },
  },
};

export interface RefineResult {
  reasoning: string;
  definition: string;
  title: string | null;
}

/**
 * Rewrite `definition` from the instructor's labeled examples. Throws on
 * failure (the route surfaces a clean error; nothing is persisted here —
 * the result is a DRAFT the instructor reviews and saves).
 */
export async function refineDefinition(args: {
  definition: string;
  included: string[];
  excluded: string[];
}): Promise<RefineResult> {
  const list = (items: string[]) =>
    items.length > 0 ? items.map((t) => `- "${pinPromptText(t)}"`).join('\n') : '(none)';
  const user = [
    `CURRENT DEFINITION:\n${args.definition.trim()}`,
    `INCLUDED examples (instructor-confirmed as THIS intent):\n${list(args.included)}`,
    `EXCLUDED examples (instructor-confirmed as NOT this intent):\n${list(args.excluded)}`,
  ].join('\n\n');

  const raw = await callModel(
    REFINE_SYSTEM,
    user,
    REFINE_MODEL,
    'high',
    { name: 'refined_definition', schema: REFINE_SCHEMA as Record<string, unknown> },
    // High-effort reasoning legitimately takes a while — cap it at 3 minutes
    // rather than the client default.
    { timeoutMs: 180_000, maxRetries: 1 }
  );
  const parsed = extractJsonObject(raw);
  const definition = typeof parsed.definition === 'string' ? parsed.definition.trim() : '';
  if (!definition || definition.length > 4000) {
    throw new Error('refine produced no usable definition');
  }
  const title = typeof parsed.title === 'string' ? parsed.title.trim().replace(/\.$/, '') : '';
  return {
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning.trim() : '',
    definition,
    title: title.length > 0 && title.length <= 120 ? title : null,
  };
}
