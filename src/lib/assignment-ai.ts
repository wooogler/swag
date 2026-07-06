export const DEFAULT_ASSIGNMENT_AI_GUIDANCE =
  'You are a supportive writing coach for students. Help them brainstorm, organize ideas, revise for clarity, and improve grammar. Do not write the full assignment for them. Keep feedback practical, brief, and focused on helping the student produce original work.';

export const ASSIGNMENT_AI_GUIDANCE_EXAMPLES = [
  'Do not write the full essay for the student.',
  'Keep each reply under 50 words.',
  'Focus only on grammar fixes and short explanations.',
  'Ask one clarifying question before giving suggestions.',
  'Point out weak reasoning or missing evidence without rewriting the whole paragraph.',
] as const;

export function resolveAssignmentAiGuidance(value?: string | null) {
  if (typeof value !== 'string') {
    return DEFAULT_ASSIGNMENT_AI_GUIDANCE;
  }

  const trimmedValue = value.trim();
  return trimmedValue ? trimmedValue : DEFAULT_ASSIGNMENT_AI_GUIDANCE;
}

export function buildAssignmentAiGuidance({
  guidance,
  instructions,
  includeInstructions,
}: {
  guidance?: string | null;
  instructions?: string | null;
  includeInstructions?: boolean;
}) {
  const resolvedGuidance = resolveAssignmentAiGuidance(guidance);

  if (!includeInstructions || !instructions?.trim()) {
    return resolvedGuidance;
  }

  return `${resolvedGuidance}\n\nAssignment Instructions:\n${instructions.trim()}`;
}

/**
 * The assignment's FULL base system prompt — guidance plus (when enabled) the
 * assignment instructions — from an assignments row. This is the "Base
 * Prompt" the SCORE loop treats as fixed: /api/chat, the SCORE rule previews,
 * the SCORE page display, and the SCORE config snapshots must all resolve it
 * through here, or previews drift from what students actually get.
 */
export function assignmentBasePrompt(assignment: {
  customSystemPrompt?: string | null;
  instructions?: string | null;
  includeInstructionInPrompt?: boolean | null;
}) {
  return buildAssignmentAiGuidance({
    guidance: assignment.customSystemPrompt,
    instructions: assignment.instructions,
    includeInstructions: assignment.includeInstructionInPrompt ?? false,
  });
}
