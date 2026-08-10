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
 * The type definitions are drawn from the Jelson paper's coding scheme
 * (docs/2026_StudentsUseChatGPTEssays_Jelson.en.md §3.4, §4.1), reworded for
 * the forced 4-way choice: the legacy 'All' is this scheme's 'drafting', and
 * the multi-activity tie-break that used to be implicit in 'All' is now an
 * explicit rule. The paper's translating criterion is a TWO-gate test — the
 * student supplied the substance AND the ask is a paragraph or less (§3.4.2
 * "both a request to generate text and sufficient context about the desired
 * content") — and its All examples are section requests carrying NO student
 * content ("Write the third body paragraph"). Substance first, scale as the
 * cap; v2 of this prompt had scale first, and translating recall was 42%.
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
    "The student SUPPLIES THE SUBSTANCE — an idea, a stance, an outline, or their own unfinished text — and asks the chatbot to turn it into usable text at paragraph scale or smaller: writing a sentence or paragraph that says what the student specified, completing the student's unfinished sentence or paragraph, or suggesting wording and word choice.",
  reviewing:
    "The student asks the chatbot to evaluate or revise THE STUDENT'S OWN WRITING — text they wrote themselves — without changing its overall theme or viewpoint: proofreading, a spelling or grammar question, feedback or a grade, shortening, rewriting to a specification, general improvement, or checking it against the assignment prompt.",
  drafting:
    'The student asks the chatbot to PRODUCE ESSAY PROSE the student did not supply the substance for — writing the whole essay from the assignment prompt or a high-level idea, writing a section (introduction, body paragraph, conclusion) requested with at most its name or a topic, or producing another version of prose THE CHATBOT ITSELF wrote earlier (rewriting, regenerating, restyling or resizing it).',
};

const INSTRUCTIONS = `Classify the STUDENT QUERY into exactly one of four types describing what the student is asking the chatbot to do.

TYPES:

${SCORE_QUERY_TYPES.map((t) => `- ${t}: ${TYPE_DEFINITIONS[t]}`).join('\n')}

RULES:
- Judge only what the student is ASKING FOR in this message. Pasted material — the student's own draft, the assignment prompt, a previous chatbot reply — is context, never a request in itself.
- Prior context is shown for reference only. Classify the STUDENT QUERY.
- WHO DECIDES THE CONTENT separates translating from drafting at paragraph scale. Translating means the student has already decided what the text should say — a stated idea or stance ("write an intro sentence that says this paper claims X"), or their own unfinished sentence to finish — and the chatbot's job is only the wording. When the chatbot must decide the content itself, it is drafting: a section requested by name or topic alone ("write the third body paragraph"), or a paragraph the chatbot must think out ("analyze my paragraph against the utilitarian view") — supplying material to think ABOUT is not deciding what the text will say. SCALE then caps translating: anything larger than a paragraph is drafting even when the idea is the student's.
- WHOSE TEXT separates reviewing from drafting — not whether text exists. Acting on writing the STUDENT produced is reviewing. Acting on prose THE CHATBOT produced earlier in the conversation is drafting: asking for it again in another shape ("rewrite it adding the dystopian view", "make it sound like a 10th grader", "make it longer") is asking the chatbot to write it again — even when the student contributes a new idea for it to include. Completing the STUDENT'S OWN unfinished sentence is translating, not reviewing: reviewing evaluates or revises text that is already written; completion produces the text that is missing.
- A message that is nothing but the student's own draft prose stopping mid-sentence, with no instruction, is an implicit ask to complete it: translating. Only the student's own mid-sentence draft counts — a pasted assignment prompt or other material with no instruction is not an implicit completion ask.
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
