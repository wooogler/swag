/**
 * One version timeline per intent.
 *
 * The configuration's own timeline (simple_config_versions) is still the thing
 * that gets measured and still what a restore moves; this is the axis the
 * participant reads while working. When you are editing one intent, "what did
 * this say before" is a question about that intent, and answering it from a
 * global list means reading past everyone else's edits to find your own.
 *
 * A version is the (definition, rule) PAIR, because in this version those are
 * one thought — when this, do that. A history of Thens with no record of which
 * When they answered is a history of half-sentences: the same rule text can be
 * right or wrong depending on what it was scoped to.
 *
 * Written on every change, not only on save. The point of an easy Apply is to
 * try things, and a history that only remembers what you committed cannot give
 * back the wording you tried and moved past — which is the case people
 * actually want it for.
 */
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db/db';
import { simpleConfigVersions, simpleIntentVersions } from '@/db/schema';
import type { SimpleSnapshot } from './chain';
import { countsByDefinition } from './starters';

/** The everything-else rule keeps a history like any other; it has no sid. */
export const ROOT_SID = 0;

export interface IntentVersion {
  id: number;
  sid: number;
  versionNo: number;
  definition: string;
  rule: string;
  /** The intent's title at the time — what the row is called in the list. */
  title: string;
  name: string | null;
  summary: string | null;
  createdAt: string;
  /** The write this pair first appeared in. */
  configVersionNo: number | null;
  /**
   * The number a reader sees — the SAVE it belongs to, counted the way the
   * timeline counts saves.
   *
   * There is one version axis on this board, and it is the configuration's. A
   * per-intent count of its own edits read as a version number, sat beside a
   * picker labelled with the configuration's, and the two disagreed on screen:
   * a card saying it had one version while the reply beside it said v3. Which
   * saves changed THIS intent is what its history is for, and the gaps in the
   * numbers say that better than a private sequence does.
   */
  displayNo: number | null;
  /**
   * How many of this log's questions that WORDING describes.
   *
   * Matches, not ownership: what an intent ends up holding also depends on
   * what sits above it, and the question a history answers is about the words
   * on the row — did widening this catch more. A lookup, not a judgement, for
   * the same reason the starter counts are: a verdict is keyed by definition
   * text, so an old wording still has its own.
   */
  matches: number | null;
}

/** Every (sid, definition, rule) the configuration currently holds. */
function pairsOf(snapshot: SimpleSnapshot): {
  sid: number;
  title: string;
  definition: string;
  rule: string;
}[] {
  if (snapshot.arm === 'baseline') {
    // One document, one timeline. Its versions ARE the prompt's versions,
    // which is the whole of this arm's history.
    return [{ sid: ROOT_SID, title: 'Rules', definition: '', rule: snapshot.prompt }];
  }
  return [
    { sid: ROOT_SID, title: 'Uncategorized', definition: '', rule: snapshot.rootRule },
    ...snapshot.intents.map((i) => ({
      sid: i.sid,
      title: i.title,
      definition: i.definition,
      rule: i.rule,
    })),
  ];
}

/**
 * Append a version for every intent whose pair differs from its last one.
 *
 * Returns what was written, so the caller can have the names generated. An
 * intent whose pair is unchanged gets nothing — reordering the tree, renaming
 * a neighbour or editing someone else's rule are not events in this intent's
 * history, and recording them there would bury the edits that are.
 *
 * A title-only change does not make a version either: the pair is what the
 * chatbot acts on. The newest row's title is refreshed instead, so the list
 * says what the intent is called now rather than what it was called then.
 */
export async function recordIntentVersions(args: {
  assignmentId: string;
  snapshot: SimpleSnapshot;
  configVersionNo: number;
}): Promise<IntentVersion[]> {
  const { assignmentId, snapshot, configVersionNo } = args;
  const pairs = pairsOf(snapshot);
  if (pairs.length === 0) return [];

  const existing = await db
    .select()
    .from(simpleIntentVersions)
    .where(
      and(
        eq(simpleIntentVersions.assignmentId, assignmentId),
        inArray(
          simpleIntentVersions.sid,
          pairs.map((p) => p.sid)
        )
      )
    )
    .orderBy(asc(simpleIntentVersions.versionNo));

  const latest = new Map<number, (typeof existing)[number]>();
  const nextNo = new Map<number, number>();
  for (const row of existing) {
    latest.set(row.sid, row);
    nextNo.set(row.sid, Math.max(nextNo.get(row.sid) ?? 0, row.versionNo) + 1);
  }

  const written: IntentVersion[] = [];
  const now = new Date();
  for (const pair of pairs) {
    const previous = latest.get(pair.sid);
    if (previous && previous.definition === pair.definition && previous.rule === pair.rule) {
      if (previous.title !== pair.title) {
        await db
          .update(simpleIntentVersions)
          .set({ title: pair.title })
          .where(eq(simpleIntentVersions.id, previous.id));
      }
      continue;
    }
    // An intent that has never had anything written in it is not a version.
    // Creating one seeds its rule from its parent, so without this every new
    // intent would open with a v1 nobody wrote.
    if (!previous && !pair.definition.trim() && !pair.rule.trim()) continue;

    const [row] = await db
      .insert(simpleIntentVersions)
      .values({
        assignmentId,
        sid: pair.sid,
        versionNo: nextNo.get(pair.sid) ?? 1,
        definition: pair.definition,
        rule: pair.rule,
        title: pair.title,
        configVersionNo,
        createdAt: now,
      })
      .returning();
    written.push({
      id: row.id,
      sid: row.sid,
      versionNo: row.versionNo,
      definition: row.definition,
      rule: row.rule,
      title: row.title,
      name: row.name,
      summary: row.summary,
      createdAt: row.createdAt.toISOString(),
      configVersionNo: row.configVersionNo,
      // Written, not read: the number and the count are both read-path
      // concerns, and the caller here is naming what it just wrote.
      displayNo: null,
      matches: null,
    });
  }
  return written;
}

/** Fill in the name a small model produced, if the row is still there. */
export async function nameIntentVersion(
  id: number,
  name: string,
  summary: string | null
): Promise<void> {
  await db
    .update(simpleIntentVersions)
    .set({ name: name.slice(0, 80), summary: summary?.slice(0, 200) ?? null })
    .where(eq(simpleIntentVersions.id, id));
}

/** Every intent's history, newest first, for the board. */
export async function listIntentVersions(
  assignmentId: string
): Promise<Record<string, IntentVersion[]>> {
  const rows = await db
    .select()
    .from(simpleIntentVersions)
    .where(eq(simpleIntentVersions.assignmentId, assignmentId))
    .orderBy(desc(simpleIntentVersions.versionNo));

  // The save numbers, counted the way the timeline counts them: visible saves
  // in order, from one.
  const saves = await db
    .select({ versionNo: simpleConfigVersions.versionNo })
    .from(simpleConfigVersions)
    .where(
      and(
        eq(simpleConfigVersions.assignmentId, assignmentId),
        eq(simpleConfigVersions.kind, 'save'),
        sql`${simpleConfigVersions.hiddenAt} is null`
      )
    )
    .orderBy(asc(simpleConfigVersions.versionNo));
  const displayNo = new Map(saves.map((row, i) => [row.versionNo, i + 1]));

  // One lookup for every distinct wording in the whole history: a verdict is
  // keyed by definition text, so an old one still has its own and nothing has
  // to be judged again to say how many questions it described.
  const matches = await countsByDefinition(
    assignmentId,
    [...new Set(rows.map((r) => r.definition.trim()).filter((d) => d.length > 0))]
  ).catch(() => new Map<string, number>());

  const out: Record<string, IntentVersion[]> = {};
  for (const row of rows) {
    const key = String(row.sid);
    (out[key] ??= []).push({
      id: row.id,
      sid: row.sid,
      versionNo: row.versionNo,
      definition: row.definition,
      rule: row.rule,
      title: row.title,
      name: row.name,
      summary: row.summary,
      createdAt: row.createdAt.toISOString(),
      configVersionNo: row.configVersionNo,
      displayNo: row.configVersionNo == null ? null : displayNo.get(row.configVersionNo) ?? null,
      matches: row.definition.trim() ? matches.get(row.definition.trim()) ?? 0 : null,
    });
  }
  return out;
}

/**
 * How many questions each intent's CURRENT wording describes.
 *
 * The row for what is applied and not saved has no stored version to carry a
 * count, and a column that is full on every row but the top one is worse than
 * no column. Same lookup as the history's: a verdict is keyed by definition
 * text, so this costs a read and never a judgement.
 *
 * Null for the uncategorized rule, which has no words to match with.
 */
export async function currentMatches(
  assignmentId: string,
  snapshot: SimpleSnapshot
): Promise<Record<string, number | null>> {
  const pairs = pairsOf(snapshot);
  const counts = await countsByDefinition(
    assignmentId,
    [...new Set(pairs.map((p) => p.definition.trim()).filter((d) => d.length > 0))]
  ).catch(() => new Map<string, number>());
  const out: Record<string, number | null> = {};
  for (const pair of pairs) {
    out[String(pair.sid)] = pair.definition.trim()
      ? counts.get(pair.definition.trim()) ?? 0
      : null;
  }
  return out;
}

/** The version immediately before this one, for naming its diff. */
export async function previousIntentVersion(
  assignmentId: string,
  sid: number,
  versionNo: number
): Promise<IntentVersion | null> {
  const [row] = await db
    .select()
    .from(simpleIntentVersions)
    .where(
      and(
        eq(simpleIntentVersions.assignmentId, assignmentId),
        eq(simpleIntentVersions.sid, sid),
        sql`${simpleIntentVersions.versionNo} < ${versionNo}`
      )
    )
    .orderBy(desc(simpleIntentVersions.versionNo))
    .limit(1);
  return row
    ? {
        id: row.id,
        sid: row.sid,
        versionNo: row.versionNo,
        definition: row.definition,
        rule: row.rule,
        title: row.title,
        name: row.name,
        summary: row.summary,
        createdAt: row.createdAt.toISOString(),
        displayNo: null,
        configVersionNo: row.configVersionNo,
        // The namer wants the previous WORDING, not what it caught.
        matches: null,
      }
    : null;
}
