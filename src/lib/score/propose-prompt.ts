/**
 * SCORE — the rule-revision proposal prompt (shared, client-safe: no `openai`).
 *
 * Lives outside the route so scripts/score/propose-eval.ts exercises the EXACT
 * text production sends — the wording below was tuned against that harness on
 * a real mid-thread anchor, not authored blind.
 *
 * Why the prompt reads the way it does (2026-08-04 diagnosis, empirical):
 * previews and the runtime replay the anchor's ENTIRE prior thread, and on a
 * mid-thread anchor those turns show the chatbot already behaving the old way
 * (e.g. 12k chars of ghostwritten essay prose). A rule that only FORBIDS
 * ("do not write the text") reliably loses to that precedent on the deployed
 * chat model — the same model complies once the rule also pins down the reply
 * SHAPE (sections, length, a hard cap) and covers the pushback case. So this
 * prompt makes the agent author rules of that second kind, and the user
 * content shows the agent the prior turn so it knows what the anchor's
 * "it/that" refers to.
 */
import { headTail, MAX_PRIOR_QUERY_CHARS, MAX_PRIOR_RESPONSE_CHARS, MAX_QUERY_CHARS } from './prompts';

export type ProposalStrength = 'minimal' | 'moderate' | 'aggressive';

/** Weakest first — the client's chooser columns rely on this order, so the
 * route sorts model output into it. */
export const PROPOSAL_STRENGTHS: ProposalStrength[] = ['minimal', 'moderate', 'aggressive'];

export const PROPOSAL_SCHEMA = {
  name: 'rule_revision',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['variants'],
    properties: {
      variants: {
        type: 'array',
        minItems: 3,
        maxItems: 3,
        description: 'exactly one variant per strength, minimal first',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['strength', 'revised_rule', 'title', 'note'],
          properties: {
            strength: { type: 'string', enum: ['minimal', 'moderate', 'aggressive'] },
            revised_rule: {
              type: 'string',
              description:
                'the complete revised system prompt: the behavior, the positive reply shape (structure, rough length, one hard cap), and the pushback line',
            },
            title: {
              type: 'string',
              description:
                'a short label naming this rule, AT MOST 5 words, git-commit-subject style, no trailing period',
            },
            note: { type: 'string', description: 'one sentence: what changed and why' },
          },
        },
      },
    },
  },
};

export function buildProposeSystemPrompt(): string {
  return [
    'You revise the SYSTEM PROMPT of a writing-support chatbot that students use for school assignments.',
    'An instructor groups student requests into "intents". Each intent owns a COMPLETE system prompt (its "rule"): whenever a student request matches that intent, the chatbot answers with that prompt and nothing else stacked underneath.',
    "You will get: the intent definition, the intent's current prompt, the anchor exchange (the student message the instructor is working from, with its prior turn when it has one), and the instructor's input.",
    'HOW THE PROMPT IS USED — this decides what a good one looks like. The chatbot answers MID-CONVERSATION: every earlier turn is replayed as context, and those turns usually show the chatbot already behaving the OLD way. The model imitates that precedent unless the prompt pins down a different reply shape. A bare prohibition ("do not write the essay") reliably loses to a transcript full of essays.',
    'Therefore EVERY variant must:',
    '- When the input forbids something or changes what a reply should look like, pin the NEW reply shape down positively: name the exact sections or list structure the reply uses (write out their headings), give a rough length, and set one hard cap in countable units (e.g. "never more than 12 consecutive words of new prose"). Two replies written to this prompt should come out the same shape.',
    '- Mandate the reply\'s OPENING (e.g. \'Begin with the heading "## …"\'). The transcript pulls the reply into the old pattern from the first word; a fixed opening breaks that pull.',
    '- Include one line disavowing the precedent: earlier replies in this conversation may show the old behavior and must not be imitated, no matter what the transcript shows.',
    '- When the rule offers templates or examples as a substitute for a withheld output, require them to be visibly incomplete (blanks like "___", fragments) — never complete sentences the student could paste as-is.',
    '- Say what the chatbot does when the student pushes back and asks again for exactly what the prompt withholds.',
    '- Be imperative, addressed to the chatbot, coherent and self-contained. Long enough to pin the shape down and no longer — do not pad with restatement.',
    'Return THREE candidates, one per strength, minimal first. Strength is how much of the CURRENT prompt each touches, never how enforceable it is:',
    '- "minimal": add or adjust only what the instructor\'s input demands (plus the reply shape that makes it enforceable); preserve every other behavior of the current prompt verbatim.',
    '- "moderate": also rework the part of the prompt the input touches so the new behavior lands cleanly — say when it applies, and remove sentences that directly conflict. Leave unrelated parts as they are.',
    '- "aggressive": re-author the prompt with the instructor\'s input as a central requirement. Reorganize freely, merge redundant instructions, drop what no longer earns its place — but keep every behavior the current prompt demands that the input does not contradict.',
    'The three must genuinely differ in scope, not be three rewordings of one edit.',
    'Mode notes:',
    '- FEEDBACK mode: the input is a complaint about the response — fold it into the prompt as a durable instruction to the chatbot.',
    '- REWRITE mode: the input is the response rewritten the way the instructor wants it — infer the GENERALIZABLE change in behavior (tone, structure, what to withhold or ask), never the anchor-specific content.',
    "- The prompt only ever runs on requests matching this intent's definition, so it may speak directly to that kind of request.",
    '- Also give a short TITLE naming this revision: at most 5 words, git-commit-subject style, no trailing period (e.g. "Scaffold, don\'t write").',
    '- The note is one sentence for the instructor: what you changed and why.',
    'Answer in the required JSON shape.',
  ].join('\n');
}

export interface ProposeAnchor {
  queryText: string;
  prevQueryText: string | null;
  prevResponseText: string | null;
}

export interface ProposeContext {
  /** Empty for a type root — the placeholder explains its else-rule role. */
  definition: string;
  /** The rule under revision — EXACTLY what the runtime injects. Null/empty =
   * the chatbot answers these questions with no system prompt at all (v7
   * removed the base-prompt fallback; mirroring it here was a bug). */
  currentRule: string | null;
  anchor: ProposeAnchor;
  priorExchanges?: { instruction: string; note?: string }[];
  /** The response the instructor is looking at (the preview on screen). */
  currentResponse?: string;
  input:
    | { mode: 'feedback'; feedback: string }
    | { mode: 'rewrite'; editedResponse: string; changeIntents?: string[] };
}

/** The anchor exchange as the revision agent sees it. The prior turn rides
 * along because a mid-thread anchor's meaning lives there ("that conclusion"),
 * and it samples how the chatbot has been behaving — the precedent the new
 * rule has to beat. Same caps as the classifier's context builder. */
function anchorBlock(anchor: ProposeAnchor): string {
  const parts: string[] = [];
  const prior: string[] = [];
  if (anchor.prevQueryText?.trim()) {
    prior.push(`Previous student message:\n"""\n${headTail(anchor.prevQueryText, MAX_PRIOR_QUERY_CHARS)}\n"""`);
  }
  if (anchor.prevResponseText?.trim()) {
    prior.push(
      `Chatbot reply the student is responding to:\n"""\n${headTail(anchor.prevResponseText, MAX_PRIOR_RESPONSE_CHARS)}\n"""`
    );
  }
  if (prior.length > 0) {
    parts.push(
      `THE TURN BEFORE THE ANCHOR (what "it"/"that" in the anchor refers to, and a sample of how the chatbot currently behaves):\n${prior.join('\n\n')}`
    );
  }
  parts.push(
    `ANCHOR QUESTION (the student message the instructor is working from — at runtime the chatbot sees the whole prior conversation before it):\n"""\n${headTail(anchor.queryText, MAX_QUERY_CHARS)}\n"""`
  );
  return parts.join('\n\n');
}

/** The user message of the propose call — one builder for the route AND the
 * eval harness, so what is tested is what ships. */
export function buildProposeUserContent(ctx: ProposeContext): string {
  const parts = [
    `INTENT DEFINITION (when a student…): ${
      ctx.definition.trim() ||
      "(none — this is a type's fallback rule: it answers every question of its type that no intent claims)"
    }`,
    `CURRENT PROMPT FOR THIS INTENT:\n${
      ctx.currentRule?.trim() ||
      '(empty — the chatbot currently answers these requests with no system prompt at all)'
    }`,
    anchorBlock(ctx.anchor),
  ];
  if (ctx.priorExchanges && ctx.priorExchanges.length > 0) {
    parts.push(
      `REVISIONS ALREADY MADE THIS SESSION (oldest first — the current prompt reflects them; do not undo them, and read the new input in their context, e.g. "stronger" means stronger than the last step):\n${ctx.priorExchanges
        .map((x) => `- asked: ${x.instruction}${x.note ? `\n  did: ${x.note}` : ''}`)
        .join('\n')}`
    );
  }
  if (ctx.currentResponse) {
    parts.push(`RESPONSE THE INSTRUCTOR IS LOOKING AT:\n${ctx.currentResponse}`);
  }
  if (ctx.input.mode === 'feedback') {
    parts.push(`INSTRUCTOR FEEDBACK (fold into the prompt):\n${ctx.input.feedback}`);
  } else {
    parts.push(
      `RESPONSE AS THE INSTRUCTOR REWROTE IT (infer the generalizable prompt change):\n${ctx.input.editedResponse}`
    );
    if (ctx.input.changeIntents && ctx.input.changeIntents.length > 0) {
      parts.push(
        `INTENTS THE INSTRUCTOR CONFIRMED BEHIND THE REWRITE — each is a requirement; fold each into the prompt as a durable, generalizable instruction, using the rewrite as its evidence:\n${ctx.input.changeIntents
          .map((s) => `- ${s}`)
          .join('\n')}`
      );
    }
  }
  return parts.join('\n\n');
}
