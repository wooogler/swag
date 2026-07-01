/**
 * Default SCORE taxonomy + few-shot config, seeded from
 * docs/jelson_fewshot_curated.md (the team's working coding).
 *
 * Used when no config has been saved to the DB yet. Editable in the viewer and
 * overridable via JSON import. Counts: Planning 8 / Translating 4 / Reviewing 6
 * / All 3 (= 21 subtypes). Descriptions default to the working label; refine
 * them in the taxonomy editor.
 */
import type { ScoreConfig } from './config';
import { SCORE_CONFIG_VERSION } from './config';

export const DEFAULT_SCORE_CONFIG: ScoreConfig = {
  version: SCORE_CONFIG_VERSION,
  // "Other" — queries that fit no writing-process subtype (md §Other).
  noneExamples: [
    "That's a great idea, thanks!",
    'Thank you, this is helpful.',
    'I think your revision is good.',
    'What can you do?',
    'Can you search the web for me?',
    'What did you change in that revision?',
  ],
  types: [
    {
      key: 'Planning',
      letter: 'P',
      label: 'Planning',
      description: 'Get information or ideas before/around writing (no new essay text is produced).',
      subtypes: [
        {
          code: 'PL01',
          label: 'Information Search',
          description: 'Search for facts, data, or background information.',
          examples: [
            'What was the average unemployment rate in the 2000s?',
            'Give me statistics on automation replacing manufacturing jobs.',
            "What's the history of industrial automation?",
          ],
        },
        {
          code: 'PL02',
          label: 'Asking for Examples',
          description: 'Ask for examples to support an argument.',
          examples: [
            'Give me an example of automation improving workplace safety.',
            "What's a good second example to support this argument?",
            'List a few real cases of AI replacing human jobs.',
          ],
        },
        {
          code: 'PL03',
          label: 'Asking for Definitions',
          description: 'Ask for the definition or meaning of a term.',
          examples: [
            'Can you define "automation" in the context of jobs?',
            'What does "utilitarian" mean here?',
            'Define social anxiety for me.',
          ],
        },
        {
          code: 'PL04',
          label: 'Getting Essay Ideas',
          description: 'Ask for ideas, arguments, or perspectives to write about.',
          examples: [
            'What are some arguments for the progressive view of automation?',
            'Give me an alternative perspective on this issue.',
            'What angles could I take for an essay on AI and work?',
          ],
        },
        {
          code: 'PL05',
          label: 'Essay Structure',
          description: 'Ask how to outline or structure the essay.',
          examples: [
            "What's a good outline for this essay?",
            'How should I structure the body paragraphs?',
            'Suggest a format for a persuasive essay on this topic.',
          ],
        },
        {
          code: 'PL06',
          label: 'Seeking Opinion on Prompt',
          description: "Ask for the chatbot's opinion or take on the topic/prompt.",
          examples: [
            'What do you think about the automation issue?',
            'Can you summarize this opinion more concisely?',
            "What's your take on the dystopian perspective?",
          ],
        },
        {
          code: 'PL07',
          label: 'Compare Perspectives',
          description: 'Ask the chatbot to compare perspectives or viewpoints.',
          examples: [
            'How does the dystopian view differ from mine?',
            'Compare the progressive and dystopian views on automation.',
            "What's the relationship between my perspective and this one?",
          ],
        },
        {
          code: 'PL08',
          label: 'Expand / Interpret the Prompt',
          description: 'Ask the chatbot to elaborate on or interpret the assignment prompt.',
          examples: [
            'Can you elaborate on the perspectives given in this prompt?',
            'Help me understand what this assignment is asking.',
            'Build on the dystopian view mentioned in the prompt.',
          ],
        },
      ],
    },
    {
      key: 'Translating',
      letter: 'T',
      label: 'Translating',
      description: "Turn the student's own ideas into text (continue or complete the student's writing).",
      subtypes: [
        {
          code: 'TR01',
          label: 'Help with Word Choice',
          description: 'Ask for a synonym, stronger word, or better expression.',
          examples: [
            'Give me a synonym for "for example".',
            'What\'s a stronger word for "negatively affecting"?',
            'Suggest a better word than "important" here.',
          ],
        },
        {
          code: 'TR02',
          label: 'Finish Paragraph (given a paragraph)',
          description: "Ask the chatbot to complete a paragraph the student started.",
          examples: [
            'Finish this paragraph: Machines help us complete repetitive tasks, which...',
            'Help me complete this opening paragraph: [paragraph].',
            'Continue this paragraph in the same tone: [paragraph].',
          ],
        },
        {
          code: 'TR03',
          label: 'Finish Sentence (given part)',
          description: 'Ask the chatbot to complete a sentence the student started.',
          examples: [
            'Complete this sentence: Automation has been at the forefront of...',
            'Finish: Humans need attention from other humans because...',
            'Continue: Machines have replaced humans in jobs that...',
          ],
        },
        {
          code: 'TR04',
          label: 'Write Sentence (given a theme)',
          description: 'Ask the chatbot to write a sentence from a theme/idea the student gives.',
          examples: [
            'Write a topic sentence about the benefits of automation.',
            'Give me a sentence introducing the dystopian view.',
            'Write a closing sentence for a paragraph on AI and work.',
          ],
        },
      ],
    },
    {
      key: 'Reviewing',
      letter: 'R',
      label: 'Reviewing',
      description: "Evaluate or revise the student's existing text (theme unchanged).",
      subtypes: [
        {
          code: 'RE01',
          label: 'Proofread',
          description: 'Ask the chatbot to proofread for spelling/grammar/typos.',
          examples: [
            'Can you proofread this paragraph?',
            'Check this essay for spelling and grammar errors.',
            'Fix any typos in this text: [text].',
          ],
        },
        {
          code: 'RE02',
          label: 'Spellcheck',
          description: 'Ask specifically about spelling.',
          examples: [
            'Spell-check this paragraph for me.',
            'Are there any spelling mistakes here?',
            'Fix the spelling in this sentence: [sentence].',
          ],
        },
        {
          code: 'RE03',
          label: 'Evaluate the Essay',
          description: "Ask the chatbot to evaluate or grade the student's text.",
          examples: [
            'Does this essay answer the prompt?',
            'How strong is my argument in this paragraph?',
            'Grade this essay out of 10 and explain why.',
          ],
        },
        {
          code: 'RE04',
          label: 'Semantic Rewrite (clarity / style)',
          description: 'Ask the chatbot to reword for clarity or style.',
          examples: [
            'Rewrite this sentence to sound more formal.',
            'Reword this paragraph to be clearer.',
            'Rephrase this in an academic tone: [text].',
          ],
        },
        {
          code: 'RE05',
          label: 'Rewrite to be Stronger',
          description: 'Ask the chatbot to make existing text more persuasive/compelling.',
          examples: [
            'Make this paragraph more persuasive.',
            'How can I make this argument more compelling?',
            'Strengthen the wording of this sentence: [sentence].',
          ],
        },
        {
          code: 'RE06',
          label: 'Rewrite a Human-written Sentence',
          description: 'Ask the chatbot to polish/improve a sentence the student wrote.',
          examples: [
            'Can you polish this sentence I wrote: [sentence]?',
            'Improve this sentence of mine.',
            'Rewrite this sentence to flow better: [sentence].',
          ],
        },
      ],
    },
    {
      key: 'All',
      letter: 'A',
      label: 'All',
      description: 'ChatGPT directly generates or rewrites the essay or a portion of it.',
      subtypes: [
        {
          code: 'AL01',
          label: 'Write the Essay (full)',
          description: 'Ask the chatbot to generate a whole essay.',
          examples: [
            'Write a short essay about automation replacing human jobs.',
            'Write a full essay arguing the progressive view of automation.',
            'Generate an essay responding to this prompt: [prompt].',
          ],
        },
        {
          code: 'AL02',
          label: 'Write a Portion (paragraph / section)',
          description: 'Ask the chatbot to generate a paragraph or section.',
          examples: [
            'Write a body paragraph arguing automation benefits society.',
            'Write the introduction for an essay on AI and work.',
            'Generate a paragraph on the dystopian view of automation.',
          ],
        },
        {
          code: 'AL03',
          label: "Rewrite ChatGPT's Text (length / structure / detail)",
          description: 'Ask the chatbot to revise text the chatbot previously generated.',
          examples: [
            'Make the essay you wrote longer.',
            'Rewrite that essay with a clearer structure.',
            'Add more detail to the conclusion you generated.',
          ],
        },
      ],
    },
  ],
};
