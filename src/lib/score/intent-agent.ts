/**
 * SCORE v6 — LLM helpers for the intent SPEC itself (server-only).
 *
 *  · generateIntentTitle — a short auto-title on every save, like git's
 *    auto-generated commit subject. Cheap model, never blocks a save
 *    (callers fall back to a definition-head title on failure).
 *  · foldCorrections — rewrite the definition FROM the instructor's pending
 *    corrections, so the boundary knowledge moves INTO the definition text.
 *    This is the ONLY path by which a correction reaches the classifier: the
 *    prompt carries definitions and nothing else, so a correction that this
 *    rewrite fails to absorb has taught the system nothing. It therefore also
 *    reports, per correction, WHICH sentence of the rewrite carries it — the
 *    review modal shows that mapping, and a correction marked "not reflected"
 *    is an honest admission rather than a silent loss. Uses the stronger model
 *    with high reasoning effort.
 *
 *    That self-report is a claim, not a measurement: this model and the one
 *    that actually judges are different models, so a span it believes carries a
 *    correction can still be read the other way. The refine route therefore
 *    MEASURES each candidate against the real classifier and hands the failures
 *    back through `previousAttempt` — see its verification loop.
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

const REFINE_SYSTEM = `You maintain the intent definitions of SCORE, an instructor tool that classifies student requests sent to a writing-assignment chatbot. An INTENT DEFINITION describes a category of student requests ("asks to ...").

The classifier sees the DEFINITION AND NOTHING ELSE — no examples are passed alongside it. So every boundary the instructor has decided must survive inside the definition text itself.

Each DECISION is the instructor ruling on one real student question:
- KEEP: belongs to this intent.
- DROP: does NOT belong, even though it looks similar.
Many carry the instructor's own reason. A reason is the general principle behind the verdict — fold in the PRINCIPLE, which covers questions you will never see, not a clause that recognizes this one question.

Each decision is marked NEW (the instructor has just made it) or STANDING (already folded in before). STANDING decisions are shown so you keep them true — they are NOT a to-do list. Do not add wording for a decision the current definition already handles: if the text you write would judge it the instructor's way, it is done.

Reason through these steps IN ORDER in the "reasoning" field BEFORE writing anything else:
1. For each KEEP, name the essential action and object of the request (what is asked, of what).
2. For each DROP, name the one property that separates it from the kept ones.
3. State the common thread of the kept decisions, and the boundary conditions the dropped ones imply.
4. Audit the current definition against steps 1-3: what does it wrongly exclude, wrongly include, or leave vague?

Then write the new definition:
- Start with "asks", one or two sentences, AT MOST 80 WORDS. If it runs longer, you have listed cases instead of stating a rule — go back to step 3 and generalize.
- Define by the KIND of request: the action and the class of thing asked for. Name the assignment's subject matter only where the boundary itself is about subject matter; a definition that would stop working on next term's topic is too narrow.
- Prefer one superordinate term to a list of its members. Use "such as" or "including" AT MOST ONCE, and never to enumerate the decisions one by one.
- Make exclusions explicit as boundary clauses (e.g. "— but not when the student only ...").
- Self-contained and concrete: no "etc.", no reference to "the decisions", never quote a student question verbatim or paraphrase one closely enough to identify it.
- Preserve the current definition's scope except where the decisions contradict it.
- If the decisions require no change, return the current definition unchanged and say so.

Also write a SUMMARY for the instructor — one or two plain sentences naming what the definition now covers or excludes that it did not before, in their words. No step numbers, no decision ids, no meta-talk about the rewrite process. If nothing changed, say so.

Finally, report the OUTCOME of each decision by its id, honestly:
- "reflected" + the exact substring of YOUR NEW definition that carries it (quote it verbatim from the new text).
- "already" if the current definition already handled it and needed no change.
- "not_reflected" if you could not fold it in without breaking the definition — say why in note. Never claim a decision is reflected when it is not.

Also return a short TITLE: an imperative noun phrase of at most 5 words, like a git commit subject. If the definition has grown beyond what the current title names, say so in the title.

A PREVIOUS ATTEMPT block, when present, is your own earlier rewrite MEASURED: the classifier read that text alone and still judged the listed questions the way the instructor says is wrong. It is evidence, not advice — the wording that failed is what has to change. Read each classifier reading, name what in the text let it reach that conclusion, and write a definition that closes it AT THE LEVEL OF THE RULE. Do not bolt on a phrase that effectively names the failing question: a definition that passes by describing its test cases has learned nothing, and the instructor will meet the same failure on the next question you have not seen. Do not simply restate the same principle in new words, and do not fix the listed questions by abandoning decisions the previous attempt already carried.`;

const REFINE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reasoning', 'summary', 'definition', 'title', 'outcomes'],
  properties: {
    reasoning: {
      type: 'string',
      description:
        'steps 1-4, compact (~150 words max), written before the definition. Internal working — never shown to the instructor.',
    },
    summary: {
      type: 'string',
      description: 'one or two plain sentences for the instructor: what the definition now covers or excludes',
    },
    definition: {
      type: 'string',
      // A HARD stop under the prompt's 80-word budget. Left to the prose rule
      // alone the model drifts a little longer with every fold, and the drift
      // is one-way: each pass appends a clause and none removes one.
      maxLength: 700,
      description: 'the rewritten self-contained definition — at most 80 words',
    },
    title: { type: 'string', description: 'at most 5 words, no trailing period' },
    outcomes: {
      type: 'array',
      description: 'one entry per correction id given, same ids',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'outcome', 'span', 'note'],
        properties: {
          id: { type: 'number' },
          outcome: { type: 'string', enum: ['reflected', 'already', 'not_reflected'] },
          span: {
            type: 'string',
            description:
              'verbatim substring of the NEW definition carrying this correction; empty string unless outcome is "reflected"',
          },
          note: { type: 'string', description: 'one short clause; required when not_reflected' },
        },
      },
    },
  },
};

/** What the fold did with one correction — the review modal's ①② mapping. */
export interface CorrectionOutcome {
  id: number;
  outcome: 'reflected' | 'already' | 'not_reflected';
  /** Substring of the proposed definition carrying it — verified to occur. */
  span: string | null;
  note: string | null;
}

export interface RefineResult {
  /** The model's own 4-step analysis. A quality device (reason before writing),
   * NOT display copy — showing it raw put a numbered scratchpad in front of the
   * instructor. Kept for debugging; the UI shows `summary`. */
  reasoning: string;
  /** One or two sentences, written for the instructor. */
  summary: string;
  definition: string;
  title: string | null;
  outcomes: CorrectionOutcome[];
}

/**
 * Rewrite `definition` from the instructor's labeled examples. Throws on
 * failure (the route surfaces a clean error; nothing is persisted here —
 * the result is a DRAFT the instructor reviews and saves).
 */
export interface FoldCorrection {
  id: number;
  verdict: 'in' | 'out';
  queryText: string;
  /** The instructor's own reason, when they gave one. */
  reason?: string | null;
  /**
   * Has this decision been through a fold already?
   *
   * Every fold now sees the intent's WHOLE ledger, not just what is new since
   * the last one — that is what gives the model a set of cases to find the
   * common rule in, instead of one case to append a clause for. But a ledger
   * read as a to-do list is worse than no ledger: the model would write a
   * phrase per entry. The mark separates "decide this" from "keep this true".
   */
  standing?: boolean;
}

/** One correction the previous candidate failed to teach, with the classifier's
 * own reading of it — the evidence a retry works from. */
export interface FoldFailure {
  verdict: 'in' | 'out';
  queryText: string;
  reason?: string | null;
  /** What the classifier answered, reading the candidate alone. */
  judgeRating: string;
  judgeRationale: string;
}

export async function foldCorrections(args: {
  definition: string;
  corrections: FoldCorrection[];
  /** A candidate that was MEASURED and came back wrong (see the refine route's
   * verification loop). Turns the retry from a reword into a repair. */
  previousAttempt?: { definition: string; failures: FoldFailure[] };
}): Promise<RefineResult> {
  const render = (verdict: 'in' | 'out') => {
    const rows = args.corrections.filter((c) => c.verdict === verdict);
    if (rows.length === 0) return '(none)';
    return rows
      .map((c) => {
        const why = c.reason?.trim();
        return `- [id ${c.id}] (${c.standing ? 'STANDING' : 'NEW'}) "${pinPromptText(c.queryText)}"${
          why ? `\n    instructor's reason: ${why}` : ''
        }`;
      })
      .join('\n');
  };
  const previous = args.previousAttempt;
  const user = [
    `CURRENT DEFINITION:\n${args.definition.trim()}`,
    `KEEP decisions (instructor says these DO belong):\n${render('in')}`,
    `DROP decisions (instructor says these do NOT belong):\n${render('out')}`,
    ...(previous && previous.failures.length > 0
      ? [
          [
            `PREVIOUS ATTEMPT (measured — the classifier read this text alone and got these wrong):`,
            previous.definition.trim(),
            '',
            'It should have judged these the instructor\'s way, and did not:',
            ...previous.failures.map(
              (f) =>
                `- "${pinPromptText(f.queryText)}"\n    instructor: ${
                  f.verdict === 'in' ? 'belongs here' : 'does NOT belong here'
                }${f.reason?.trim() ? ` (${f.reason.trim()})` : ''}\n    classifier said: ${
                  f.judgeRating
                }${f.judgeRationale ? ` — "${f.judgeRationale}"` : ''}`
            ),
          ].join('\n'),
        ]
      : []),
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

  // VERIFY the model's own mapping rather than trusting it: a "reflected" span
  // that does not occur in the definition it just wrote is a hallucinated
  // receipt, and the modal would use it to underline text that carries nothing.
  // Downgrade those to 'not_reflected' — the instructor then sees an honest
  // "couldn't fold this in" and can edit the text themselves.
  const given = new Map(args.corrections.map((c) => [c.id, c]));
  const rawOutcomes = Array.isArray(parsed.outcomes) ? parsed.outcomes : [];
  const seen = new Set<number>();
  const outcomes: CorrectionOutcome[] = [];
  for (const o of rawOutcomes) {
    const row = (o ?? {}) as Record<string, unknown>;
    const id = typeof row.id === 'number' ? row.id : NaN;
    if (!given.has(id) || seen.has(id)) continue;
    seen.add(id);
    const span = typeof row.span === 'string' ? row.span.trim() : '';
    const claimed = row.outcome === 'reflected' || row.outcome === 'already' ? row.outcome : 'not_reflected';
    const spanHolds = span.length > 0 && definition.includes(span);
    const note = typeof row.note === 'string' ? row.note.trim() : '';
    outcomes.push(
      claimed === 'reflected' && !spanHolds
        ? { id, outcome: 'not_reflected', span: null, note: note || 'the rewrite does not visibly carry this' }
        : {
            id,
            outcome: claimed,
            span: claimed === 'reflected' ? span : null,
            note: note || null,
          }
    );
  }
  // A correction the model simply omitted is unaccounted for, not absorbed.
  for (const c of args.corrections) {
    if (!seen.has(c.id)) {
      outcomes.push({ id: c.id, outcome: 'not_reflected', span: null, note: 'not addressed by the rewrite' });
    }
  }

  return {
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning.trim() : '',
    summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
    definition,
    title: title.length > 0 && title.length <= 120 ? title : null,
    outcomes,
  };
}
