/**
 * What an intent's question list is ordered by.
 *
 * THE PROBLEM IS TRUST, NOT CONVENIENCE. A participant writes a definition,
 * opens it, and reads the first row. If that row is a question they would
 * argue about, they have learned that the classifier is unreliable — from one
 * example, before seeing the fifteen it got right. The order of the list is
 * therefore part of what the board claims about itself, and the top of it
 * should be the least arguable members of the category.
 *
 * The verdicts cannot supply that order. They are a yes and a no, and every
 * yes looks alike. So the ordering is by distance in embedding space, and the
 * only real question is what to measure the distance FROM.
 *
 *   A QUESTION THEY POINTED AT, when there is one. An intent started from a
 *   row on the board records that row, and it is a better anchor than anything
 *   a model could produce: it is a real question, from this log, chosen by the
 *   person whose category it is.
 *
 *   HYPOTHETICAL QUESTIONS, otherwise. A definition describes a category and a
 *   query is an instance of one, and the two sit in different regions of the
 *   embedding space — so comparing a description against real questions ranks
 *   badly, and comparing invented questions against real ones ranks well.
 *   (The technique is HyDE.) Only the "+ New intent" path needs this; carving
 *   one out of a question does not.
 *
 * WHERE THIS SITS AGAINST §1. The generated questions are never configuration:
 * they are not judged, not sent to the chatbot, not saved in the snapshot, and
 * editing one is not possible. They order a list. The card can show them, but
 * folded away and on request — because a list of "questions your description
 * covers" sitting open beside the box is a rewriting aid, and rewriting aids
 * are what this version exists without (§2). Opening it is logged, so a
 * participant who leaned on it can be told apart from one who never looked.
 *
 * Client-safe: no. Server module, but no `server-only` import — that package
 * is not a declared dependency here and adding it silently breaks every tsx
 * script that reaches into this directory.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db/db';
import { simpleDefinitionAnchors, simpleIntentSeeds } from '@/db/schema';
import { callModel, extractJsonObject, isOpenAIConfigured } from '@/lib/score/classifier';
import { cosineSimilarity, embedTexts, getQueryEmbeddings } from '@/lib/score/embeddings';
import { intentDefHash } from '@/lib/score/intents';
import { scopedRecords } from './scope';

const EXAMPLE_MODEL = process.env.SCORE_EXAMPLE_MODEL || 'gpt-5.4-nano';

/**
 * Five, and measured rather than guessed.
 *
 * The anchor is the MEAN of the examples, so the count is really a question
 * about variance: how much does the top of the list move when the same
 * definition is generated twice? That is the thing the ordering exists to
 * protect — a first row that changes between runs is a first row nobody can
 * trust.
 *
 * Three definitions, three generations each, ranking the same 60 questions:
 * at three examples the top row moved between runs for two of the three, and
 * on the worst one the top FIVE agreed only 2.3/5 between runs. At five it
 * moved for one, and that same worst case rose to 4.3/5. Eight and twelve
 * bought nothing measurable over five (4.0 and 3.5 on the worst case, inside
 * the noise of four runs), so this is the flat part of the curve.
 */
const EXAMPLE_COUNT = 5;

const SYSTEM = `You write example student questions for a similarity search. They are not shown as advice and nobody acts on them.

You are given the assignment students were working on, and one description of a category of questions. Return "examples": ${EXAMPLE_COUNT} short questions a student might actually type that sit squarely inside that description — the most ordinary, least arguable members of it, not the edge cases.

Students often paste material into a message. Where an example would contain pasted material, write the placeholder instead of inventing the text: [Own draft], [Assignment prompt], [Bot reply], [Own question].

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

export interface DefinitionAnchor {
  examples: string[];
  anchor: number[];
}

/** The hypothetical questions for one definition, written once and kept. */
async function buildAnchor(
  assignmentId: string,
  definition: string,
  assignmentPrompt: string
): Promise<DefinitionAnchor | null> {
  if (!isOpenAIConfigured()) return null;
  const raw = await callModel(
    SYSTEM,
    `THE ASSIGNMENT\n${assignmentPrompt.trim().slice(0, 2000) || '(not available)'}\n\nTHE CATEGORY\n${definition.trim().slice(0, 1500)}`,
    EXAMPLE_MODEL,
    'low',
    { name: 'intent_examples', schema: SCHEMA as Record<string, unknown> },
    { timeoutMs: 25_000, maxRetries: 1 }
  );
  const parsed = extractJsonObject(raw);
  const examples = (Array.isArray(parsed.examples) ? parsed.examples : [])
    .filter((e): e is string => typeof e === 'string' && e.trim().length > 0)
    .map((e) => e.trim())
    .slice(0, EXAMPLE_COUNT);
  if (examples.length === 0) return null;

  const vectors = await embedTexts(examples);
  if (vectors.length === 0) return null;
  // The mean of the examples: one point standing for the middle of the
  // category, rather than the nearest single invention.
  const width = vectors[0].length;
  const anchor = new Array<number>(width).fill(0);
  for (const v of vectors) for (let i = 0; i < width; i += 1) anchor[i] += v[i] ?? 0;
  for (let i = 0; i < width; i += 1) anchor[i] /= vectors.length;
  return { examples, anchor };
}

/**
 * The anchor for a definition, generating it if this is the first time.
 *
 * Keyed by the definition TEXT, like the verdicts and the responses, so
 * editing a wording and editing it back costs nothing and two intents that
 * describe the same thing share one.
 */
export async function ensureAnchor(args: {
  assignmentId: string;
  definition: string;
  assignmentPrompt: string;
}): Promise<DefinitionAnchor | null> {
  const definition = args.definition.trim();
  if (definition.length === 0) return null;
  const defHash = intentDefHash(definition);

  const [existing] = await db
    .select()
    .from(simpleDefinitionAnchors)
    .where(
      and(
        eq(simpleDefinitionAnchors.assignmentId, args.assignmentId),
        eq(simpleDefinitionAnchors.defHash, defHash)
      )
    );
  if (existing) {
    return {
      examples: (existing.examples as string[]) ?? [],
      anchor: (existing.anchor as number[]) ?? [],
    };
  }

  const built = await buildAnchor(args.assignmentId, definition, args.assignmentPrompt);
  if (!built) return null;
  await db
    .insert(simpleDefinitionAnchors)
    .values({
      assignmentId: args.assignmentId,
      defHash,
      examples: built.examples,
      anchor: built.anchor,
      model: EXAMPLE_MODEL,
      createdAt: new Date(),
    })
    .onConflictDoNothing();
  return built;
}

/** Whatever is already stored — never generates, for read paths. */
export async function readAnchor(
  assignmentId: string,
  definition: string
): Promise<DefinitionAnchor | null> {
  const text = definition.trim();
  if (text.length === 0) return null;
  const [row] = await db
    .select()
    .from(simpleDefinitionAnchors)
    .where(
      and(
        eq(simpleDefinitionAnchors.assignmentId, assignmentId),
        eq(simpleDefinitionAnchors.defHash, intentDefHash(text))
      )
    );
  if (!row) return null;
  return { examples: (row.examples as string[]) ?? [], anchor: (row.anchor as number[]) ?? [] };
}

/* ------------------------------------------------------------------ */
/* The question an intent was carved out of                            */
/* ------------------------------------------------------------------ */

export async function recordIntentSeed(args: {
  assignmentId: string;
  sid: number;
  messageId: number;
}): Promise<void> {
  await db
    .insert(simpleIntentSeeds)
    .values({ ...args, createdAt: new Date() })
    .onConflictDoNothing();
}

export async function readIntentSeeds(assignmentId: string): Promise<Map<number, number>> {
  const rows = await db
    .select({ sid: simpleIntentSeeds.sid, messageId: simpleIntentSeeds.messageId })
    .from(simpleIntentSeeds)
    .where(eq(simpleIntentSeeds.assignmentId, assignmentId));
  return new Map(rows.map((r) => [r.sid, r.messageId]));
}

/* ------------------------------------------------------------------ */
/* The order itself                                                    */
/* ------------------------------------------------------------------ */

/**
 * Order one intent's questions, most typical first.
 *
 * Returns the ids it was given, rearranged — never a subset, so a caller that
 * uses this cannot accidentally hide a question. Anything without an anchor or
 * without an embedding keeps its incoming position relative to its peers,
 * which means a missing anchor degrades to "the order it already had" rather
 * than to a shuffle.
 */
export async function rankQuestions(args: {
  assignmentId: string;
  sid: number;
  definition: string;
  messageIds: number[];
}): Promise<number[]> {
  const { assignmentId, sid, definition, messageIds } = args;
  if (messageIds.length < 2) return messageIds;

  const seeds = await readIntentSeeds(assignmentId);
  const seedMessageId = seeds.get(sid) ?? null;

  const records = await scopedRecords(assignmentId);
  const embeddings = await getQueryEmbeddings(assignmentId, records).catch(() => new Map());

  let anchor: number[] | null = null;
  if (seedMessageId != null) anchor = embeddings.get(seedMessageId) ?? null;
  if (!anchor) anchor = (await readAnchor(assignmentId, definition))?.anchor ?? null;
  if (!anchor || anchor.length === 0) return messageIds;

  const score = new Map<number, number>();
  for (const id of messageIds) {
    const v = embeddings.get(id);
    score.set(id, v ? cosineSimilarity(anchor, v) : Number.NEGATIVE_INFINITY);
  }
  // The seed itself first when there is one: it is the question this category
  // was built to hold, and burying it under a closer neighbour would be odd.
  return [...messageIds].sort((a, b) => {
    if (a === seedMessageId) return -1;
    if (b === seedMessageId) return 1;
    return (score.get(b) ?? 0) - (score.get(a) ?? 0);
  });
}

/** Definitions that have no anchor yet — what a save has work to do about. */
export async function definitionsNeedingAnchors(
  assignmentId: string,
  definitions: string[]
): Promise<string[]> {
  const wanted = [...new Set(definitions.map((d) => d.trim()).filter((d) => d.length > 0))];
  if (wanted.length === 0) return [];
  const hashes = new Map(wanted.map((d) => [intentDefHash(d), d]));
  const rows = await db
    .select({ defHash: simpleDefinitionAnchors.defHash })
    .from(simpleDefinitionAnchors)
    .where(
      and(
        eq(simpleDefinitionAnchors.assignmentId, assignmentId),
        inArray(simpleDefinitionAnchors.defHash, [...hashes.keys()])
      )
    );
  for (const row of rows) hashes.delete(row.defHash);
  return [...hashes.values()];
}
