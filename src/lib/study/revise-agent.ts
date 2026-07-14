/**
 * Baseline prompt-revision agent — the parity counterpart of SCORE's rule
 * proposal (intents/[intentId]/propose). Same model + reasoning tier + anchor
 * context; the ONLY difference is the target: SCORE folds the input into one
 * intent's RULE, baseline folds it into the WHOLE monolithic prompt with a
 * MINIMAL EDIT. This is exactly the study manipulation (localized rule vs whole
 * prompt), so the AI-mediated revision itself is shared, not ablated.
 */
import { callModel, extractJsonObject } from '@/lib/score/classifier';
import { getDefaultScoreModel } from '@/lib/score/models';

const SCHEMA = {
  name: 'prompt_revision',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['revised_prompt', 'rationale'],
    properties: {
      revised_prompt: { type: 'string' },
      rationale: { type: 'string', description: 'one sentence: what changed and why' },
    },
  },
};

function buildSystemPrompt(): string {
  return [
    'You revise the SYSTEM PROMPT of a writing-support chatbot that students use for school assignments.',
    "You get: the current full system prompt, one anchor student question with the response it produced, and the instructor's input.",
    'Return the REVISED FULL SYSTEM PROMPT:',
    "- MINIMAL EDIT: change only what the instructor's input demands; preserve everything else verbatim.",
    '- FEEDBACK mode: the input is a complaint about the response — fold it into the prompt as a durable instruction to the chatbot.',
    '- EDIT_RESPONSE mode: the input is the response rewritten the way the instructor wants — infer the GENERALIZABLE behavior change (tone, structure, what to withhold or ask), NOT the anchor-specific content, and encode it in the prompt.',
    '- Keep the prompt coherent, imperative, and self-contained; do not bloat it or restate unchanged parts differently.',
    '- The rationale is ONE sentence for the instructor: what you changed and why.',
    'Answer in the required JSON shape.',
  ].join('\n');
}

export interface ReviseProposal {
  revisedPrompt: string;
  rationale: string;
  raw: string;
}

export async function proposeBaselineRevision(args: {
  promptText: string;
  anchorQueryText: string;
  currentResponse?: string;
  mode: 'feedback' | 'edit_response';
  feedback?: string;
  editedResponse?: string;
}): Promise<ReviseProposal> {
  const parts = [
    `CURRENT SYSTEM PROMPT:\n${args.promptText || '(empty — the chatbot currently has no guidance)'}`,
    `ANCHOR STUDENT QUESTION:\n${args.anchorQueryText}`,
  ];
  if (args.currentResponse) parts.push(`RESPONSE THE INSTRUCTOR IS LOOKING AT:\n${args.currentResponse}`);
  if (args.mode === 'feedback') {
    parts.push(`INSTRUCTOR FEEDBACK (fold into the prompt):\n${args.feedback ?? ''}`);
  } else {
    parts.push(`RESPONSE AS THE INSTRUCTOR REWROTE IT (infer the generalizable change):\n${args.editedResponse ?? ''}`);
  }

  const raw = await callModel(buildSystemPrompt(), parts.join('\n\n'), getDefaultScoreModel(), 'medium', SCHEMA);
  const parsed = extractJsonObject(raw);
  const revisedPrompt = typeof parsed.revised_prompt === 'string' ? parsed.revised_prompt.trim() : '';
  if (!revisedPrompt) throw new Error('proposal missing revised_prompt');
  return {
    revisedPrompt,
    rationale: typeof parsed.rationale === 'string' ? parsed.rationale.trim() : '',
    raw,
  };
}
