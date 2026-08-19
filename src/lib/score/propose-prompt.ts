/**
 * SCORE — the rule-revision proposal prompt (shared, client-safe: no `openai`).
 *
 * Lives outside the route so scripts/score/propose-eval.ts exercises the EXACT
 * text production sends — the wording below was tuned against that harness on
 * a real mid-thread anchor, not authored blind.
 *
 * Why the prompt reads the way it does (2026-08-04, empirical — plan §9):
 * a rule that only FORBIDS ("do not write the text") loses to the model's
 * helpful-assistant instinct, so every variant must keep substitute examples
 * visibly incomplete. The heavier machinery an
 * earlier revision demanded — mandated section headings, a fixed opening
 * line, a precedent-disavowal sentence — existed to beat the OLD preview's
 * verbatim replay of the prior thread; the digest context (preview-service
 * v4, conversation-digest.ts) removed that adversary, and re-measurement
 * showed compliance holds without them (11/1/0 across 12 generations) while
 * rules come out half the length and read as the instructor's own
 * instruction. The user content shows the agent the prior turn so it knows
 * what the anchor's "it/that" refers to.
 *
 * 2026-08-19 — the mandated lines were cut from three to ONE. Re-measured on
 * the same scenario (12 generations each, compliant/partial/violation):
 * three lines 8/4/0 · the incomplete-examples line alone 9/3/0 · that idea
 * stated abstractly 3/8/1 · nothing 1/11/0. So the countable cap and the
 * pushback line bought nothing measurable — the agent writes both unprompted
 * — while the concrete form requirement is the whole effect, and stating it
 * abstractly loses it. Dropping the other two also stops the rules from
 * carrying stances the instructor never asked for (JELSON pilot §7).
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

/**
 * WHICH rule is being revised. It decides what the agent is told the prompt
 * covers — and the three answers are genuinely different instructions, not
 * wording:
 *
 *   'intent'     one set's rule; it may speak directly to that kind of request
 *   'type-root'  a query type's last resort — everything of that type that no
 *                set claimed, so it must not assume a single kind of request
 *   'prompt'     the BASELINE condition's single system prompt: it answers
 *                EVERY student question. There are no categories and no other
 *                rules, so scoping language ("for this kind of request…") is
 *                actively wrong here.
 *
 * This used to be inferred from an empty definition, which lumped the last two
 * together and told the baseline's agent its prompt was one type's fallback —
 * both mis-scoping the revision and leaking the treatment's mechanism into the
 * control arm's AI.
 */
export type ProposeScope = 'intent' | 'type-root' | 'prompt';

/**
 * `devices` — how much enforcement every variant is told to carry. Production
 * uses 'form' (2026-08-19); the other modes exist so propose-eval.ts can
 * re-run the A/B that chose it. See the header for the measurement.
 *
 *   'form'  ONE line: substitute examples must be visibly incomplete
 *   'all'   + a countable cap + a pushback line + the "how the prompt is used"
 *           preamble (production before 2026-08-19)
 *   'goal'  the same idea as 'form' stated abstractly ("not paste-ready")
 *   'off'   nothing
 */
export function buildProposeSystemPrompt(
  scope: ProposeScope = 'intent',
  opts: { devices?: 'form' | 'all' | 'goal' | 'off' } = {}
): string {
  const devices = opts.devices ?? 'form';
  const framing =
    scope === 'prompt'
      ? [
          'The chatbot has ONE system prompt for the whole assignment, and the instructor is revising it. It answers every student request — there are no categories, and no other prompt runs underneath or alongside it.',
          "You will get: the current prompt, the anchor exchange (the student message the instructor is working from, with its prior turn when it has one), and the instructor's input.",
        ]
      : scope === 'type-root'
        ? [
            'An instructor groups student requests into "intents". Each intent owns a COMPLETE system prompt (its "rule"): whenever a student request matches that intent, the chatbot answers with that prompt and nothing else stacked underneath.',
            'The prompt you are revising is a query TYPE\'s last resort: it answers every request of that type that none of the instructor\'s intents claimed. So it covers a RANGE of leftover requests, not one kind — do not write it as if it had a single trigger.',
            "You will get: what the type covers, the current prompt, the anchor exchange (the student message the instructor is working from, with its prior turn when it has one), and the instructor's input.",
          ]
        : [
            'An instructor groups student requests into "intents". Each intent owns a COMPLETE system prompt (its "rule"): whenever a student request matches that intent, the chatbot answers with that prompt and nothing else stacked underneath.',
            "You will get: the intent definition, the intent's current prompt, the anchor exchange (the student message the instructor is working from, with its prior turn when it has one), and the instructor's input.",
          ];
  return [
    'You revise the SYSTEM PROMPT of a writing-support chatbot that students use for school assignments.',
    ...framing,
    ...(devices === 'all'
      ? [
          "HOW THE PROMPT IS USED — this decides what a good one looks like. The chatbot answers real student messages with only this prompt as guidance, and the model's default instinct is to be maximally helpful — for a \"change the style\" request that means writing the improved text itself. A bare prohibition is not enough to override that instinct.",
          'Therefore, in EVERY variant:',
          '- Whenever the input forbids something, also state POSITIVELY what a reply gives instead, with one concrete hard cap in countable units (e.g. "never more than one complete sentence of finished prose").',
          '- When the rule offers templates or examples as a substitute for a withheld output, require them to be visibly incomplete (blanks like "___", fragments) — never complete sentences the student could paste as-is.',
          '- Say in one line what the chatbot does when the student pushes back and asks again for exactly what the prompt withholds.',
        ]
      : devices === 'form'
        ? [
            'In EVERY variant:',
            '- When the rule offers expressions, templates or examples as a substitute for a withheld output, require them to be visibly incomplete (fragments, sentence stems, blanks like "___") — never complete sentences the student could paste as-is.',
          ]
      : devices === 'goal'
        ? [
            'In EVERY variant:',
            '- If the input withholds finished text, make sure whatever the reply offers instead cannot be pasted into the draft as-is (fragments, stems, cues — not complete sentences).',
          ]
        : ['In EVERY variant:']),
    "- Keep the rule SHORT — it should read as the instructor's own instruction, not a form specification. A few sentences is usually right. Do not mandate named sections, headings, exact bullet counts, or word budgets unless the instructor's input itself asks for structured replies.",
    '- Be imperative, addressed to the chatbot, coherent and self-contained.',
    'Return THREE candidates, one per strength, minimal first. Strength is how much of the CURRENT prompt each touches, never how enforceable it is:',
    '- "minimal": add or adjust only what the instructor\'s input demands (plus the reply shape that makes it enforceable); preserve every other behavior of the current prompt verbatim.',
    '- "moderate": also rework the part of the prompt the input touches so the new behavior lands cleanly — say when it applies, and remove sentences that directly conflict. Leave unrelated parts as they are.',
    '- "aggressive": re-author the prompt with the instructor\'s input as a central requirement. Reorganize freely, merge redundant instructions, drop what no longer earns its place — but keep every behavior the current prompt demands that the input does not contradict.',
    'When the CURRENT prompt is EMPTY there is nothing to preserve or rework and the ladder above collapses into three rewordings. In that case the strengths differ in SCOPE instead, and the rules should get visibly longer down the ladder:',
    '- "minimal": the narrowest rule that implements the input — trigger only on the exact kind of request the input names; say nothing about anything else.',
    '- "moderate": also cover the closely related requests the input plainly implies, so the behavior survives a rephrase.',
    scope === 'prompt'
      ? '- "aggressive": a complete prompt for the whole assignment with the input as its centerpiece — the stance the chatbot takes, when the new behavior applies, and the edge cases around it.'
      : '- "aggressive": a complete prompt for this intent with the input as its centerpiece — the stance the chatbot takes, when the new behavior applies, and the edge cases around it.',
    'The three must genuinely differ in scope, not be three rewordings of one edit.',
    'Mode notes:',
    '- FEEDBACK mode: the input is a complaint about the response — fold it into the prompt as a durable instruction to the chatbot.',
    '- REWRITE mode: the input is the response rewritten the way the instructor wants it — infer the GENERALIZABLE change in behavior (tone, structure, what to withhold or ask), never the anchor-specific content.',
    scope === 'prompt'
      ? '- This prompt runs on EVERY student request, so it must not be written as if it applied to one kind of request; keep it general enough to answer anything the assignment produces.'
      : scope === 'type-root'
        ? '- The prompt runs on every request of its type that no intent claimed — a range of leftovers, so keep it general enough to cover them rather than aimed at the anchor alone.'
        : "- The prompt only ever runs on requests matching this intent's definition, so it may speak directly to that kind of request.",
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
  /** Which rule is being revised — see `ProposeScope`. Decides how an empty
   * `definition` is explained, which is the opposite thing for a type root and
   * for the baseline's single prompt. */
  scope?: ProposeScope;
  /** Empty for a type root AND for the baseline's prompt-holder — `scope` says
   * which, so the two are never described the same way. */
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
  const scope = ctx.scope ?? 'intent';
  const parts = [
    scope === 'prompt'
      ? 'WHAT THIS PROMPT COVERS: every student request in the assignment — it is the chatbot\'s only system prompt.'
      : `INTENT DEFINITION (when a student…): ${
          ctx.definition.trim() ||
          "(none — this is a type's fallback rule: it answers every question of its type that no intent claims)"
        }`,
    `${scope === 'prompt' ? 'CURRENT PROMPT' : 'CURRENT PROMPT FOR THIS INTENT'}:\n${
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
