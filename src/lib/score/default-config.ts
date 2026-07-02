/**
 * Default SCORE taxonomy + few-shot config, seeded from
 * docs/GPTWriting_fewshot_classifier.md (the Jelson "ChatGPT Query Codes"
 * taxonomy — the authoritative coding scheme from the paper).
 *
 * Used when no config has been saved to the DB yet. Editable in the viewer and
 * overridable via JSON import. Counts: Planning 8 / Translating 4 / Reviewing 7
 * / All 7 (= 26 subtypes).
 *
 * `label` is a short handle for the UI only. Type descriptions, subtype
 * `description`s, and `examples` are taken VERBATIM from the doc — no extra
 * disambiguation is added, so the classifier is driven purely by the paper's
 * own coding scheme. All of them are injected into the classifier prompts
 * (see prompts.ts).
 */
import type { ScoreConfig } from './config';
import { SCORE_CONFIG_VERSION } from './config';

export const DEFAULT_SCORE_CONFIG: ScoreConfig = {
  version: SCORE_CONFIG_VERSION,
  // "Other" — queries that fit no writing-process subtype (off-topic, chit-chat,
  // meta). Not part of the Jelson codes; kept as the "none of the above" few-shot.
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
      description:
        'Ideating and deciding what to write — gathering information, generating ideas, or outlining structure; not generating essay text.',
      subtypes: [
        {
          code: 'PL01',
          label: 'Answer a Topic Question',
          description: 'Provide an answer to a question on a topic.',
          examples: [
            'Would automation cause people to lose their jobs?',
            'List possible reasons why the growth of AI is good.',
            'What does the future of automation look like?',
          ],
        },
        {
          code: 'PL02',
          label: 'Provide Examples',
          description: 'Provide examples.',
          examples: [
            'Give examples of utilitarian uses of modern technology.',
            'What would be a good second example to support this argument?',
            'Where is automation used most in the workforce?',
          ],
        },
        {
          code: 'PL03',
          label: 'Factual Lookup',
          description: 'Search for factual information.',
          examples: [
            'What was the unemployment rate in the 1950s?',
            'Give me statistics on automation replacing manufacturing jobs.',
            'Define "automation" in the context of machines replacing jobs.',
          ],
        },
        {
          code: 'PL04',
          label: 'Essay Structure',
          description: 'Suggest an essay structure.',
          examples: [
            "What's a good outline for this essay?",
            'How should I structure the body paragraphs?',
            'Suggest a format for a persuasive essay on this topic.',
          ],
        },
        {
          code: 'PL05',
          label: 'Expand an Idea',
          description: 'Expand on an existing idea.',
          examples: [
            'How can I further develop this idea: automation frees us from tedious tasks so we can focus on complex work?',
            'Expand on this point and connect it to human history: this is just another step in human evolution.',
            'Build on my argument that machines test what humans are really capable of.',
          ],
        },
        {
          code: 'PL06',
          label: 'Recommend Topics',
          description: 'Recommend topics to write about.',
          examples: [
            'Could you help me come up with arguments both for and against automation?',
            'Read this prompt and give me some ideas for what to write about.',
            "I don't have a perspective on this issue — what could I argue?",
          ],
        },
        {
          code: 'PL07',
          label: 'Interpret the Prompt',
          description: 'Help interpret the writing prompt.',
          examples: [
            'Summarize this writing prompt into a few key takeaways: [prompt]',
            'Help me understand what this assignment is asking.',
            'What exactly is this prompt asking me to do?',
          ],
        },
        {
          code: 'PL08',
          label: 'Compare Viewpoints',
          description: 'Compare the essay to an alternative viewpoint.',
          examples: [
            'How would a dystopian point of view differ from mine?',
            "Would someone with the opposing view agree with any point I've made?",
            'Compare my perspective with the progressive view on automation.',
          ],
        },
      ],
    },
    {
      key: 'Translating',
      letter: 'T',
      label: 'Translating',
      description:
        'Turning a given idea into text the student will use — a paragraph or less; larger requests go to All.',
      subtypes: [
        {
          code: 'TR01',
          label: 'Paragraph from Idea',
          description: 'Write a paragraph given an idea.',
          examples: [
            'Turn this idea into a paragraph: machines test what humans are truly capable of.',
            'Write a short intro paragraph that says this paper claims AI is good because it exposes our inefficiencies.',
            "Here's my point — write a paragraph on it: automation reflects our values about who does technical work.",
          ],
        },
        {
          code: 'TR02',
          label: 'Complete Text',
          description: 'Complete incomplete paragraphs/sentences.',
          examples: [
            'Finish my second paragraph: [incomplete paragraph]',
            'Complete this sentence: automation has been at the forefront of...',
            'Finish this thought: machines have replaced humans in jobs that...',
          ],
        },
        {
          code: 'TR03',
          label: 'Sentence from Idea',
          description: 'Write a sentence given an idea.',
          examples: [
            'Write a sentence that says automation is good because it exposes inefficiencies in the broken hiring system.',
            'Put this into one sentence: society values technical workers more than non-technical ones.',
            'Give me a topic sentence about the benefits of automation.',
          ],
        },
        {
          code: 'TR04',
          label: 'Word Choice',
          description: 'Suggest expression/word choice.',
          examples: [
            'What are some synonyms for "for example"?',
            'What\'s a stronger word for "negatively affecting"?',
            'What\'s a word for understanding how the pacing of something should go?',
          ],
        },
      ],
    },
    {
      key: 'Reviewing',
      letter: 'R',
      label: 'Reviewing',
      description:
        "Evaluating or revising the student's own existing text, without changing its overall theme or viewpoint.",
      subtypes: [
        {
          code: 'RE01',
          label: 'Proofread',
          description: 'Proofread.',
          examples: [
            'Can you proofread this paragraph?',
            'Check this essay for inaccurate or unclear statements.',
            'Fix the grammar in the following text: [text]',
          ],
        },
        {
          code: 'RE02',
          label: 'Spelling/Grammar Q&A',
          description: 'Answer spelling/grammar questions.',
          examples: [
            'How do you spell "sophisticated"?',
            'When is "i.e." used?',
            'Is "convenience" spelled correctly?',
          ],
        },
        {
          code: 'RE03',
          label: 'Give Feedback',
          description: 'Give feedback.',
          examples: [
            'If you were grading my draft as a professor, what grade would you give it?',
            'Grade this essay out of 100 based on the rubric.',
            'Are there any specific phrases or examples I should address?',
          ],
        },
        {
          code: 'RE04',
          label: 'Shorten / Trim',
          description: 'Shorten text/remove some content.',
          examples: [
            'Make this more concise — two sentences only.',
            'Shorten this paragraph: [paragraph]',
            "Remove the part that mentions I'm a CS student.",
          ],
        },
        {
          code: 'RE05',
          label: 'Rewrite to Spec',
          description: "Rewrite existing text based on a user's prompt.",
          examples: [
            'Rewrite this paragraph to better match my writing style.',
            'This conclusion is too whimsical — rewrite it to sound like a science journal.',
            'Rewrite my paragraph but keep the human touch it originally had.',
          ],
        },
        {
          code: 'RE06',
          label: 'Improve the Essay',
          description: 'Improve the essay.',
          examples: [
            'How can this essay be improved?',
            'Make this introduction better: [text]',
            'Word the end of this sentence better.',
          ],
        },
        {
          code: 'RE07',
          label: 'Check vs. Prompt',
          description: 'Check if the essay meets the prompt.',
          examples: [
            'Does this essay actually answer the prompt?',
            'I need to analyze the relationship between my view and another one — did I do that here?',
            'Is my essay on topic for this assignment?',
          ],
        },
      ],
    },
    {
      key: 'All',
      letter: 'A',
      label: 'All',
      description:
        'Spanning all three processes at once — generating a whole essay or a portion, or reworking ChatGPT-generated text.',
      subtypes: [
        {
          code: 'AL01',
          label: 'Write Full Essay (from prompt)',
          description: 'Generate an essay entirely.',
          examples: [
            'Help me write a paper based on this prompt: [prompt]',
            'Write a short essay responding to this prompt: [prompt]',
            'Write an essay that states a perspective on this issue and analyzes it against another: [prompt]',
          ],
        },
        {
          code: 'AL02',
          label: 'Write Conclusion',
          description: 'Write conclusion.',
          examples: [
            'Can you write me a concluding paragraph?',
            'Now write a conclusion for this essay.',
            'Write a conclusion paragraph for the following essay: [essay]',
          ],
        },
        {
          code: 'AL03',
          label: 'Regenerate with Feedback',
          description: 'Generate an alternative essay with some feedback.',
          examples: [
            'Rewrite this at a college level.',
            'Make it sound intelligent, and make it longer.',
            'Rewrite it to sound like a 10th grader.',
          ],
        },
        {
          code: 'AL04',
          label: 'Write a Section',
          description: 'Generate a portion of an essay given a high-level idea.',
          examples: [
            'Write the third body paragraph.',
            'Give me three body paragraphs defending that thesis.',
            'Add a paragraph on how automation affects customer service.',
          ],
        },
        {
          code: 'AL05',
          label: 'Write Full Essay (from idea)',
          description: 'Generate the entire essay given a high-level idea.',
          examples: [
            'Write an essay arguing that automation could lead to a dystopian future for humanity.',
            'Combine all of that into a 500-word persuasive essay.',
            'Write the whole essay from the perspective that progress is good but overreliance is dangerous.',
          ],
        },
        {
          code: 'AL06',
          label: 'Resize Generated Text',
          description: 'Shorten/Lengthen the generated text from the response.',
          examples: [
            'Make it longer.',
            'Redo that with three short sentences.',
            'A little shorter, please.',
          ],
        },
        {
          code: 'AL07',
          label: 'Write Introduction',
          description: 'Write introduction.',
          examples: [
            'Write the introduction paragraph, ending with a clear thesis.',
            'Write an intro that forms an opinion on one of the three views and includes a thesis.',
            'Write an introduction that gives context and flows into the thesis.',
          ],
        },
      ],
    },
  ],
};
