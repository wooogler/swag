/**
 * Prompt builder for the v7 type layer: which of the 4 fixed query types a
 * student message belongs to (docs/SCORE_v7_intent_tree_design.md §3.1).
 *
 * Client-safe (no server/openai imports), same reason as intent-prompts.ts:
 * the viewer must be able to reconstruct the exact prompt, and preview =
 * runtime is a design invariant.
 *
 * ⚠️ Any semantic change to the text below MUST bump TYPE_CLASSIFIER_VERSION
 * in intents.ts. A message's type is judged once per message EVER — there is no
 * definition to invalidate against, so a silent wording change would leave
 * every cached row marked fresh against a prompt it never saw.
 *
 * Measured alternative, REJECTED: scoring all four types and taking the argmax
 * instead of this forced single choice. It scored 8pp WORSE on the same 331
 * human-coded rows (docs/SCORE_v7_type_eval.md §7) — independent scoring
 * invites "does this partly fit?", spreads credit across the near misses, and
 * the argmax then lands on a partial match. The forced choice is what makes the
 * model commit to the dominant reading. Do not retry without new evidence.
 *
 * The type definitions descend from the hand-written whole-Type definitions in
 * jelson-suggest.ts (TYPE_INTENT_DEFINITIONS), reworded here for the forced
 * 4-way choice: the legacy 'All' is this scheme's 'drafting', and the
 * multi-activity tie-break that used to be implicit in 'All' is now an explicit
 * rule.
 */
import { SCORE_QUERY_TYPES, type ScoreQueryType } from './intents';

/**
 * What puts a message in each type. Exported because the board shows it: a type
 * root's WHEN is read-only, and the honest way to render a condition nobody can
 * edit is to show the text the classifier was actually given — not a paraphrase
 * of it that can drift away from the judgment it describes.
 */
export const TYPE_DEFINITIONS: Record<ScoreQueryType, string> = {
  planning:
    'The student is deciding WHAT to write, and asks for no essay text in return — a question about the topic, examples or factual information, a suggested structure or list of topics, expanding or comparing ideas, or interpreting the assignment prompt.',
  translating:
    "The student already has the idea and asks the chatbot to turn it into usable text at PARAGRAPH SCALE OR SMALLER — writing a sentence or paragraph from a given idea, completing an unfinished sentence or paragraph, or suggesting wording and word choice.",
  reviewing:
    "The student asks the chatbot to evaluate or revise THE STUDENT'S OWN WRITING — text they wrote themselves — without changing its overall theme or viewpoint: proofreading, a spelling or grammar question, feedback or a grade, shortening, rewriting to a specification, general improvement, or checking it against the assignment prompt.",
  drafting:
    'The student asks the chatbot to PRODUCE ESSAY PROSE — writing the whole essay or a complete section of it (introduction, body paragraph, conclusion) from a prompt or an idea, or producing another version of prose THE CHATBOT ITSELF wrote earlier (rewriting, regenerating, restyling or resizing it).',
};

const INSTRUCTIONS = `Classify the STUDENT QUERY into exactly one of four types describing what the student is asking the chatbot to do.

TYPES:

${SCORE_QUERY_TYPES.map((t) => `- ${t}: ${TYPE_DEFINITIONS[t]}`).join('\n')}

RULES:
- Judge only what the student is ASKING FOR in this message. Pasted material — the student's own draft, the assignment prompt, a previous chatbot reply — is context, never a request in itself.
- Prior context is shown for reference only. Classify the STUDENT QUERY.
- Scale separates translating from drafting: a sentence or a paragraph built from the student's own idea is translating; a whole essay or a complete section produced by the chatbot is drafting.
- WHOSE TEXT separates reviewing from drafting — not whether text exists. Acting on writing the STUDENT produced is reviewing. Acting on prose THE CHATBOT produced earlier in the conversation is drafting: asking for it again in another shape ("rewrite it adding the dystopian view", "make it sound like a 10th grader", "make it longer") is asking the chatbot to write it again, not to review the student's work.
- WHAT THE ANSWER WOULD BE separates planning from drafting. Planning answers are ABOUT the writing — topics, facts, structure, comparisons. Drafting answers ARE the writing. A request phrased as a question still counts as drafting when the only way to answer it is to produce essay prose (e.g. "how would I defend the utilitarian view?", "state your perspective and analyse it against the others").
- MULTIPLE ACTIVITIES: when one message asks for two or more different activities (for example "translate this and also fix the grammar"), answer drafting. Instructors handle these by carving out a narrower category inside drafting.
- There is no "other" type. Off-topic messages, chit-chat, and meta questions about the chatbot still take the closest of the four.
- Write the rationale FIRST, in 10 words or fewer, then give the type.`;

export function buildTypeSystemPrompt(): string {
  return `You are auditing one student message sent to a writing-support chatbot for a school assignment.\n\n${INSTRUCTIONS}`;
}

/** Strict json_schema: rationale before type so the model reasons before it
 * commits, and the type is grammar-constrained to the 4 keys (no null escape —
 * the classification is total by design). */
export function buildTypeSchema(): object {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['rationale', 'type'],
    properties: {
      rationale: { type: 'string', description: '10 words or fewer, written before the type' },
      type: { type: 'string', enum: [...SCORE_QUERY_TYPES] },
    },
  };
}
