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
import { simpleIntentVersions } from '@/db/schema';
import type { SimpleSnapshot } from './chain';

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
  /** The write this pair first appeared in. Compared against the newest SAVE,
   * it says whether this wording has been kept or is only in effect. */
  configVersionNo: number | null;
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
    });
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
      configVersionNo: row.configVersionNo,
      }
    : null;
}
