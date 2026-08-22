/**
 * The starter library: the taxonomy's own categories, offered as a place to
 * start a definition from.
 *
 * WHERE THE COUNTS COME FROM, and why this costs nothing.
 *
 * Every clone is provisioned with the taxonomy's categories already sitting in
 * it as template intents, already rated against every question in its log
 * (provision.ts step 9 copies the verdicts with their def_hash unchanged). And
 * a verdict is keyed by the DEFINITION TEXT — `intentDefHash(definition)` — in
 * both the full version's table and the simple one's. So a starter's questions
 * are a lookup, not a judgement: the dropdown opens with real numbers, picking
 * one fills its list instantly, and no model is called at any point.
 *
 * That shared key is also why nothing about the classifier had to change to
 * support this. The simple version already reads the same keyspace.
 *
 * Two levels, because the taxonomy has two: a Type covers a whole stage of
 * writing, a Subtype covers one kind of request inside it. Both are offered —
 * a Type is a real starter, not a heading — since "everything to do with
 * planning" and "asking for examples" are both things an instructor might want
 * one rule for.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db/db';
import { scoreIntentRatings, scoreIntents, simpleRatings } from '@/db/schema';
import { getScoreConfig } from '@/lib/score/config-store';
import {
  buildJelsonSuggestions,
  jelsonToIntent,
  jelsonTypeToIntent,
} from '@/lib/score/jelson-suggest';
import { intentDefHash, isIncludedRating, type RatingLevel } from '@/lib/score/intents';
import { reviewScope } from './scope';

export interface StarterItem {
  /** Stable within a render; the taxonomy code, or the type key for a Type. */
  key: string;
  title: string;
  definition: string;
  /** The taxonomy's own words for this category — what the tooltip shows. */
  description: string;
  /** How many of this log's questions it describes. Zero is a fine answer: it
   * is a place to start writing from, not a promise of results. */
  count: number;
  /** Whether it describes the one question this intent is being started from.
   * False whenever there is no such question. */
  contains: boolean;
}

export interface StarterGroup {
  key: string;
  label: string;
  description: string;
  /** The Type as a starter in its own right, covering the whole stage. */
  whole: StarterItem;
  items: StarterItem[];
}

/**
 * Newest verdict per (definition text, message), from whichever table has it.
 *
 * Deliberately NOT filtered to the current hash generation. A change to the
 * rating harness moves every hash without moving a single definition, and the
 * prepared verdicts are the whole point of the prepared set — so this takes
 * the most recent verdict for each message under any generation, which is what
 * the baseline arm's probe seeding already does.
 */
export async function countsByDefinition(
  assignmentId: string,
  definitions: string[],
  /**
   * Count only these questions.
   *
   * The dropdown's number is read as "how many would come here if I took
   * this", so it has to be counted over the questions that COULD come here —
   * the pile the new intent is being read before, and everything under it.
   * Counted over the whole log it quietly promised questions an intent above
   * has already taken.
   */
  within?: Set<number> | null
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (definitions.length === 0) return counts;

  // Counted over the questions the board actually lists. A study master also
  // holds the earlier turns of each thread, and counting those would have the
  // dropdown promise a number the board can never show.
  const scope = await reviewScope(assignmentId);
  const inScope = (messageId: number) =>
    (!scope || scope.has(messageId)) && (!within || within.has(messageId));

  // The clone's own prepared categories, matched by text.
  const templates = await db
    .select({ id: scoreIntents.id, definition: scoreIntents.definition })
    .from(scoreIntents)
    .where(and(eq(scoreIntents.assignmentId, assignmentId), eq(scoreIntents.isTemplate, true)));
  const wanted = new Set(definitions.map((d) => d.trim()));
  const byIntent = new Map<number, string>();
  for (const template of templates) {
    const text = template.definition.trim();
    if (wanted.has(text)) byIntent.set(template.id, text);
  }

  if (byIntent.size > 0) {
    const rows = await db
      .select({
        intentId: scoreIntentRatings.intentId,
        messageId: scoreIntentRatings.messageId,
        rating: scoreIntentRatings.rating,
        ratedAt: scoreIntentRatings.ratedAt,
      })
      .from(scoreIntentRatings)
      .where(
        and(
          eq(scoreIntentRatings.assignmentId, assignmentId),
          inArray(scoreIntentRatings.intentId, [...byIntent.keys()])
        )
      );
    const newest = new Map<string, { rating: string; at: Date }>();
    for (const row of rows) {
      const key = `${row.intentId}:${row.messageId}`;
      const prev = newest.get(key);
      if (!prev || row.ratedAt > prev.at) newest.set(key, { rating: row.rating, at: row.ratedAt });
    }
    for (const [key, value] of newest) {
      if (!isIncludedRating(value.rating as RatingLevel)) continue;
      const [intentId, messageId] = key.split(':').map(Number);
      if (!inScope(messageId)) continue;
      const definition = byIntent.get(intentId);
      if (definition) counts.set(definition, (counts.get(definition) ?? 0) + 1);
    }
  }

  // Anything the participant has already worked with is counted from the
  // simple version's own table instead, so a starter they adopted and then
  // edited back to its original wording still reads the same number.
  const hashes = new Map(definitions.map((d) => [intentDefHash(d), d.trim()]));
  const own = await db
    .select({
      defHash: simpleRatings.defHash,
      messageId: simpleRatings.messageId,
      rating: simpleRatings.rating,
    })
    .from(simpleRatings)
    .where(
      and(
        eq(simpleRatings.assignmentId, assignmentId),
        inArray(simpleRatings.defHash, [...hashes.keys()])
      )
    );
  const ownCounts = new Map<string, number>();
  const ownSeen = new Set<string>();
  for (const row of own) {
    const definition = hashes.get(row.defHash);
    if (!definition || !inScope(row.messageId)) continue;
    ownSeen.add(definition);
    if (isIncludedRating(row.rating as RatingLevel)) {
      ownCounts.set(definition, (ownCounts.get(definition) ?? 0) + 1);
    }
  }
  for (const definition of ownSeen) counts.set(definition, ownCounts.get(definition) ?? 0);

  return counts;
}

/**
 * Which of these definitions describe ONE question.
 *
 * The same two sources and the same newest-wins rule as the counts above,
 * narrowed to a single message. It exists so that starting an intent from a
 * question can mark the sets that question is already in.
 *
 * This is a lookup in verdicts that were prepared when the clone was made, so
 * it calls no model — and it tells the participant nothing they could not find
 * by picking each set in turn and reading the list, which is what keeps it on
 * the right side of §1-1: it saves clicks, it does not write or interpret
 * anything on their behalf.
 */
async function definitionsContaining(
  assignmentId: string,
  messageId: number,
  definitions: string[]
): Promise<Set<string>> {
  const hit = new Set<string>();
  const scope = await reviewScope(assignmentId);
  if (scope && !scope.has(messageId)) return hit;

  const wanted = new Set(definitions.map((d) => d.trim()));
  const templates = await db
    .select({ id: scoreIntents.id, definition: scoreIntents.definition })
    .from(scoreIntents)
    .where(and(eq(scoreIntents.assignmentId, assignmentId), eq(scoreIntents.isTemplate, true)));
  const byIntent = new Map<number, string>();
  for (const template of templates) {
    const text = template.definition.trim();
    if (wanted.has(text)) byIntent.set(template.id, text);
  }

  if (byIntent.size > 0) {
    const rows = await db
      .select({
        intentId: scoreIntentRatings.intentId,
        rating: scoreIntentRatings.rating,
        ratedAt: scoreIntentRatings.ratedAt,
      })
      .from(scoreIntentRatings)
      .where(
        and(
          eq(scoreIntentRatings.assignmentId, assignmentId),
          eq(scoreIntentRatings.messageId, messageId),
          inArray(scoreIntentRatings.intentId, [...byIntent.keys()])
        )
      );
    const newest = new Map<number, { rating: string; at: Date }>();
    for (const row of rows) {
      const prev = newest.get(row.intentId);
      if (!prev || row.ratedAt > prev.at) newest.set(row.intentId, { rating: row.rating, at: row.ratedAt });
    }
    for (const [intentId, value] of newest) {
      const definition = byIntent.get(intentId);
      if (definition && isIncludedRating(value.rating as RatingLevel)) hit.add(definition);
    }
  }

  // A starter they already adopted is answered from the simple table instead,
  // for the same reason the counts are.
  const hashes = new Map(definitions.map((d) => [intentDefHash(d), d.trim()]));
  const own = await db
    .select({ defHash: simpleRatings.defHash, rating: simpleRatings.rating })
    .from(simpleRatings)
    .where(
      and(
        eq(simpleRatings.assignmentId, assignmentId),
        eq(simpleRatings.messageId, messageId),
        inArray(simpleRatings.defHash, [...hashes.keys()])
      )
    );
  for (const row of own) {
    const definition = hashes.get(row.defHash);
    if (!definition) continue;
    if (isIncludedRating(row.rating as RatingLevel)) hit.add(definition);
    else hit.delete(definition);
  }

  return hit;
}

/**
 * The library, grouped the way the taxonomy is.
 *
 * `forMessageId` marks the sets that already describe that one question —
 * set when an intent is being started from a question in the list.
 */
export async function loadStarters(
  assignmentId: string,
  forMessageId?: number | null,
  /** The questions this intent could take — see countsByDefinition. */
  within?: Set<number> | null
): Promise<StarterGroup[]> {
  const config = await getScoreConfig();
  const suggestions = buildJelsonSuggestions(config);

  const seeds: { group: string; item: Omit<StarterItem, 'count' | 'contains'>; isWhole: boolean }[] = [];
  const groups = new Map<string, { label: string; description: string }>();
  for (const suggestion of suggestions) {
    if (!groups.has(suggestion.typeKey)) {
      groups.set(suggestion.typeKey, {
        label: suggestion.typeLabel,
        description: suggestion.typeDescription,
      });
      const whole = jelsonTypeToIntent(
        suggestion.typeKey,
        suggestion.typeLabel,
        suggestion.typeDescription
      );
      seeds.push({
        group: suggestion.typeKey,
        isWhole: true,
        item: {
          key: `type:${suggestion.typeKey}`,
          title: whole.title,
          definition: whole.definition,
          description: suggestion.typeDescription,
        },
      });
    }
    const seed = jelsonToIntent(suggestion);
    seeds.push({
      group: suggestion.typeKey,
      isWhole: false,
      item: {
        key: suggestion.code,
        title: seed.title,
        definition: seed.definition,
        description: suggestion.description,
      },
    });
  }

  const [counts, containing] = await Promise.all([
    countsByDefinition(
      assignmentId,
      seeds.map((s) => s.item.definition),
      within
    ),
    forMessageId == null
      ? Promise.resolve(new Set<string>())
      : definitionsContaining(
          assignmentId,
          forMessageId,
          seeds.map((s) => s.item.definition)
        ),
  ]);
  const withCount = (item: Omit<StarterItem, 'count' | 'contains'>): StarterItem => ({
    ...item,
    count: counts.get(item.definition.trim()) ?? 0,
    contains: containing.has(item.definition.trim()),
  });

  return [...groups].map(([key, meta]) => ({
    key,
    label: meta.label,
    description: meta.description,
    whole: withCount(seeds.find((s) => s.group === key && s.isWhole)!.item),
    items: seeds.filter((s) => s.group === key && !s.isWhole).map((s) => withCount(s.item)),
  }));
}
