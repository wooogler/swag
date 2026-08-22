/**
 * The examples that stand for an intent, and the order they put its questions in.
 *
 * THE PROBLEM IS TRUST, NOT CONVENIENCE. A participant writes a definition,
 * opens it, and reads the first row. If that row is a question they would
 * argue about, they have learned that the classifier is unreliable — from one
 * example, before seeing the fifteen it got right. The order of the list is
 * therefore part of what the board claims about itself, and the top of it
 * should be the least arguable members of the category.
 *
 * The verdicts cannot supply that order. They are a yes and a no, and every
 * yes looks alike. So it is distance in embedding space, and everything here
 * is about what to measure the distance FROM.
 *
 * AN INTENT'S EXAMPLES ARE THE ANSWER, and they are one set however the intent
 * was made. Carved out of a question, it starts with that question — a real
 * one, from this log, chosen by the person whose category it is. Written from
 * nothing, it starts with a few the model wrote, because a definition
 * describes a category while a query is an instance of one and the two sit in
 * different regions of the space (the technique is HyDE). From then on there
 * is no difference: the set is the participant's to add to, remove from and
 * regenerate, and the anchor is its mean.
 *
 * KEYED BY INTENT, NOT BY DEFINITION TEXT. The verdicts and the responses are
 * keyed by the text that produced them, which makes editing a wording and
 * editing it back free. Examples are not derived from the wording — they are
 * chosen — so rewording must not silently discard them. What keeps them from
 * going stale is a button, not an invalidation rule.
 *
 * WHERE THIS SITS AGAINST §1. An example is never configuration: it is not
 * judged, not sent to the chatbot, not in the snapshot. Adding one does not
 * put its question in the intent — the words do that, and the example row
 * carries the same ownership chip as every other row, so a question that went
 * somewhere else says so from inside the list it was added to. What examples
 * change is the order, and ordering is not a ruling.
 *
 * Client-safe: no. Server module, but no `server-only` import — that package
 * is not a declared dependency here and adding it silently breaks every tsx
 * script that reaches into this directory.
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db/db';
import { simpleIntentExamples } from '@/db/schema';
import { callModel, extractJsonObject, isOpenAIConfigured } from '@/lib/score/classifier';
import { cosineSimilarity, embedTexts, getQueryEmbeddings } from '@/lib/score/embeddings';
import { scopedRecords } from './scope';

const EXAMPLE_MODEL = process.env.SCORE_EXAMPLE_MODEL || 'gpt-5.4-nano';

/**
 * Three, and the reasoning changed when they became visible.
 *
 * Measured while they were hidden and fixed, five looked safer than three: the
 * anchor is the MEAN, so more of them meant the top of the list moved less
 * between generations. Once the examples sit at the top of the list where they
 * can be read, edited and regenerated, that argument mostly dissolves — the
 * rows a participant reads first ARE the examples, and they do not move unless
 * asked to.
 *
 * What stayed true in the measurement: three ordinary examples rank about as
 * stably as five (top-5 overlap 4.3/5 either way). What did NOT survive is
 * asking for strong variety — "cover the whole of what the description
 * describes" halved stability (2.3/5) while barely spreading the examples at
 * all (0.72 → 0.62 similarity to each other), because a narrow definition has
 * no corners to spread into. So the variety asked for below is the concrete
 * kind: different phrasings, and some with pasted material and some without.
 */
const EXAMPLE_COUNT = 3;

const SYSTEM = `You write example student questions for a similarity search. They are not shown as advice and nobody acts on them.

You are given the assignment students were working on, and one description of a category of questions. Return "examples": ${EXAMPLE_COUNT} short questions a student might actually type that sit squarely inside that description — ordinary, unarguable members of it rather than edge cases.

Vary them: different phrasings and lengths, and some with pasted material and some without. Students often paste material into a message; where an example would contain some, write the placeholder instead of inventing the text: [Own draft], [Assignment prompt], [Bot reply], [Own question].

Write the way students write — lowercase, brief, imperfect. Stay inside the description: do not broaden it, do not add anything it does not mention, and do not explain.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['examples'],
  properties: {
    examples: {
      type: 'array',
      items: { type: 'string', description: 'one short student question' },
    },
  },
};

export interface IntentExample {
  id: number;
  /** A question from this log, or null when it is a written one. */
  messageId: number | null;
  /** The written text, or null when it is a question from the log. */
  text: string | null;
}

/* ------------------------------------------------------------------ */
/* Reading and writing the set                                         */
/* ------------------------------------------------------------------ */

export async function listIntentExamples(
  assignmentId: string,
  sid: number
): Promise<IntentExample[]> {
  const rows = await db
    .select()
    .from(simpleIntentExamples)
    .where(
      and(eq(simpleIntentExamples.assignmentId, assignmentId), eq(simpleIntentExamples.sid, sid))
    )
    .orderBy(asc(simpleIntentExamples.id));
  return rows.map((r) => ({ id: r.id, messageId: r.messageId, text: r.text }));
}

/** A question from the log, added by hand or as the one an intent came from. */
export async function addQuestionExample(args: {
  assignmentId: string;
  sid: number;
  messageId: number;
}): Promise<void> {
  const existing = await listIntentExamples(args.assignmentId, args.sid);
  if (existing.some((e) => e.messageId === args.messageId)) return;
  await db.insert(simpleIntentExamples).values({
    assignmentId: args.assignmentId,
    sid: args.sid,
    messageId: args.messageId,
    createdAt: new Date(),
  });
}

/** Written examples, with their vectors — there is no query cache for these. */
async function addTextExamples(args: {
  assignmentId: string;
  sid: number;
  texts: string[];
}): Promise<void> {
  const texts = args.texts.map((t) => t.trim()).filter((t) => t.length > 0);
  if (texts.length === 0) return;
  const vectors = await embedTexts(texts).catch(() => [] as number[][]);
  const now = new Date();
  await db.insert(simpleIntentExamples).values(
    texts.map((text, i) => ({
      assignmentId: args.assignmentId,
      sid: args.sid,
      text,
      embedding: vectors[i] ?? null,
      model: EXAMPLE_MODEL,
      createdAt: now,
    }))
  );
}

export async function removeIntentExample(args: {
  assignmentId: string;
  sid: number;
  id: number;
}): Promise<void> {
  await db
    .delete(simpleIntentExamples)
    .where(
      and(
        eq(simpleIntentExamples.assignmentId, args.assignmentId),
        eq(simpleIntentExamples.sid, args.sid),
        eq(simpleIntentExamples.id, args.id)
      )
    );
}

/* ------------------------------------------------------------------ */
/* Writing them from a definition                                      */
/* ------------------------------------------------------------------ */

async function writeExamples(definition: string, assignmentPrompt: string): Promise<string[]> {
  if (!isOpenAIConfigured()) return [];
  const raw = await callModel(
    SYSTEM,
    `THE ASSIGNMENT\n${assignmentPrompt.trim().slice(0, 2000) || '(not available)'}\n\nTHE CATEGORY\n${definition.trim().slice(0, 1500)}`,
    EXAMPLE_MODEL,
    'low',
    { name: 'intent_examples', schema: SCHEMA as Record<string, unknown> },
    { timeoutMs: 25_000, maxRetries: 1 }
  );
  const parsed = extractJsonObject(raw);
  return (Array.isArray(parsed.examples) ? parsed.examples : [])
    .filter((e): e is string => typeof e === 'string' && e.trim().length > 0)
    .map((e) => e.trim())
    .slice(0, EXAMPLE_COUNT);
}

/**
 * Give an intent a starting set, if it has none.
 *
 * Only ever fills an empty set: an intent carved out of a question already has
 * one, and one somebody has edited is theirs. Regenerating is a separate act
 * with a button behind it.
 */
export async function seedIntentExamples(args: {
  assignmentId: string;
  sid: number;
  definition: string;
  assignmentPrompt: string;
}): Promise<number> {
  if (args.definition.trim().length === 0) return 0;
  const existing = await listIntentExamples(args.assignmentId, args.sid);
  if (existing.length > 0) return 0;
  const texts = await writeExamples(args.definition, args.assignmentPrompt);
  await addTextExamples({ assignmentId: args.assignmentId, sid: args.sid, texts });
  return texts.length;
}

/**
 * Replace the WRITTEN examples with a fresh set, on request.
 *
 * Questions from the log survive: those were pointed at rather than produced,
 * and throwing them away would make the button destroy the half of the set the
 * participant actually chose.
 */
export async function regenerateIntentExamples(args: {
  assignmentId: string;
  sid: number;
  definition: string;
  assignmentPrompt: string;
}): Promise<number> {
  const texts = await writeExamples(args.definition, args.assignmentPrompt);
  if (texts.length === 0) return 0;
  await db
    .delete(simpleIntentExamples)
    .where(
      and(
        eq(simpleIntentExamples.assignmentId, args.assignmentId),
        eq(simpleIntentExamples.sid, args.sid),
        // `isNull` on a jsonb-bearing row reads oddly; the discriminator is
        // whether there is text, so ask that.
        inArray(
          simpleIntentExamples.id,
          (await listIntentExamples(args.assignmentId, args.sid))
            .filter((e) => e.text != null)
            .map((e) => e.id)
            .concat([-1])
        )
      )
    );
  await addTextExamples({ assignmentId: args.assignmentId, sid: args.sid, texts });
  return texts.length;
}

/* ------------------------------------------------------------------ */
/* The order itself                                                    */
/* ------------------------------------------------------------------ */

/** The mean of an intent's examples, or null when it has none to average. */
async function anchorFor(
  assignmentId: string,
  sid: number,
  queryVectors: Map<number, number[]>
): Promise<number[] | null> {
  const rows = await db
    .select()
    .from(simpleIntentExamples)
    .where(
      and(eq(simpleIntentExamples.assignmentId, assignmentId), eq(simpleIntentExamples.sid, sid))
    );
  const vectors: number[][] = [];
  for (const row of rows) {
    const v =
      row.messageId != null
        ? queryVectors.get(row.messageId)
        : (row.embedding as number[] | null) ?? undefined;
    if (v && v.length > 0) vectors.push(v);
  }
  if (vectors.length === 0) return null;
  const width = vectors[0].length;
  const anchor = new Array<number>(width).fill(0);
  for (const v of vectors) for (let i = 0; i < width; i += 1) anchor[i] += v[i] ?? 0;
  for (let i = 0; i < width; i += 1) anchor[i] /= vectors.length;
  return anchor;
}

/**
 * Order one intent's questions by distance from its examples.
 *
 * Returns the ids it was given, rearranged — never a subset, so a caller that
 * uses this cannot accidentally hide a question. With no examples, or no
 * embeddings, it hands back what it was given: a missing anchor degrades to
 * "the order it already had" rather than to a shuffle.
 *
 * `furthest` reads the same fact from the other end. Nearest-first answers "is
 * this working"; furthest-first answers "what did my words catch that is least
 * like what I meant" — which is where the next intent usually comes from, and
 * the row it lands on has the button to make one.
 */
export async function rankQuestions(args: {
  assignmentId: string;
  sid: number;
  messageIds: number[];
  furthest?: boolean;
}): Promise<number[]> {
  const { assignmentId, sid, messageIds } = args;
  if (messageIds.length < 2) return messageIds;

  const records = await scopedRecords(assignmentId);
  const embeddings = await getQueryEmbeddings(assignmentId, records).catch(
    () => new Map<number, number[]>()
  );
  const anchor = await anchorFor(assignmentId, sid, embeddings);
  if (!anchor) return messageIds;

  const score = new Map<number, number>();
  for (const id of messageIds) {
    const v = embeddings.get(id);
    score.set(id, v ? cosineSimilarity(anchor, v) : Number.NEGATIVE_INFINITY);
  }
  const direction = args.furthest ? -1 : 1;
  return [...messageIds].sort(
    (a, b) => direction * ((score.get(b) ?? 0) - (score.get(a) ?? 0))
  );
}

/** Which intents have no examples yet — what a save has work to do about. */
export async function intentsNeedingExamples(
  assignmentId: string,
  sids: number[]
): Promise<number[]> {
  if (sids.length === 0) return [];
  const rows = await db
    .select({ sid: simpleIntentExamples.sid })
    .from(simpleIntentExamples)
    .where(
      and(
        eq(simpleIntentExamples.assignmentId, assignmentId),
        inArray(simpleIntentExamples.sid, sids)
      )
    );
  const have = new Set(rows.map((r) => r.sid));
  return sids.filter((sid) => !have.has(sid));
}
