/**
 * Reading and writing the simple version's configuration timeline.
 *
 * One verb writes: save. It appends a snapshot and returns — nothing waits on
 * a model, because the whole reason this version exists is that the edit →
 * check loop has to be cheap enough to repeat without thinking about it
 * (docs/SCORE_SIMPLE_DESIGN.md §6.1). The version's name and one-line summary
 * are filled in afterwards by a small model, and if that never arrives the
 * timeline reads "v3 · 14:02" forever, which is a worse label and not a
 * broken one.
 *
 * Restore is a rollback: the versions after the restored one stop being part
 * of the timeline, so "the last version" is always the final state and there
 * is no deploy step to keep in step with it (§3.3). They are hidden rather
 * than deleted — a participant who builds something, abandons it and goes
 * back is RQ1 data, and hard-deleting it is the mistake the full version's
 * rule-version revert already makes.
 */
import 'server-only';
import { and, asc, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { db } from '@/db/db';
import { simpleConfigVersions, simplePins } from '@/db/schema';
import { armOf, type StudioView } from '../config';
import { emptySnapshot, type SimpleSnapshot } from './chain';

export interface SimpleVersion {
  id: number;
  /** Internal, monotonic, includes hidden rows. Config refs and logs use this. */
  versionNo: number;
  /** What the timeline calls it: the position among visible rows, from 1. */
  displayNo: number;
  name: string | null;
  summary: string | null;
  createdAt: string;
}

export interface SimpleState {
  /** The configuration as of the version being viewed. */
  snapshot: SimpleSnapshot;
  /** Newest first. Hidden rows are not here — see the module header. */
  versions: SimpleVersion[];
  /** The version being viewed, or null when nothing has been saved yet. */
  viewing: SimpleVersion | null;
  /** True when `viewing` is the newest version, i.e. edits are allowed. */
  atTip: boolean;
  pinned: number[];
}

function parseSnapshot(value: unknown, view: StudioView, seed: string): SimpleSnapshot {
  const arm = armOf(view);
  const base = emptySnapshot(arm, seed);
  if (!value || typeof value !== 'object') return base;
  const raw = value as Partial<SimpleSnapshot>;
  return {
    arm,
    prompt: typeof raw.prompt === 'string' ? raw.prompt : base.prompt,
    rootRule: typeof raw.rootRule === 'string' ? raw.rootRule : base.rootRule,
    intents: Array.isArray(raw.intents)
      ? raw.intents.map((i) => ({
          sid: Number(i.sid),
          title: typeof i.title === 'string' ? i.title : '',
          definition: typeof i.definition === 'string' ? i.definition : '',
          rule: typeof i.rule === 'string' ? i.rule : '',
          parentSid: i.parentSid == null ? null : Number(i.parentSid),
        }))
      : [],
  };
}

async function visibleVersions(assignmentId: string) {
  const rows = await db
    .select()
    .from(simpleConfigVersions)
    .where(
      and(
        eq(simpleConfigVersions.assignmentId, assignmentId),
        isNull(simpleConfigVersions.hiddenAt)
      )
    )
    .orderBy(asc(simpleConfigVersions.versionNo));
  return rows;
}

/**
 * Everything the board needs for one render.
 *
 * `versionNo` selects a past version to look at; the editors lock and the
 * questions are answered against that snapshot instead (§3.4). Without it the
 * newest version is the answer, which is also what a clone that has never
 * been saved gets — an empty timeline and a snapshot seeded from the prompt
 * this chatbot actually ran with.
 */
export async function getSimpleState(args: {
  assignmentId: string;
  condition: StudioView;
  /** The assignment's own prompt, which is what an unsaved configuration is. */
  seedPrompt: string;
  versionNo?: number | null;
}): Promise<SimpleState> {
  const { assignmentId, condition, seedPrompt } = args;
  const rows = await visibleVersions(assignmentId);
  const versions: SimpleVersion[] = rows.map((row, i) => ({
    id: row.id,
    versionNo: row.versionNo,
    displayNo: i + 1,
    name: row.name,
    summary: row.summary,
    createdAt: row.createdAt.toISOString(),
  }));

  const tip = rows.length ? rows[rows.length - 1] : null;
  const wanted =
    args.versionNo != null ? rows.find((r) => r.versionNo === args.versionNo) ?? tip : tip;

  const pins = await db
    .select({ messageId: simplePins.messageId })
    .from(simplePins)
    .where(eq(simplePins.assignmentId, assignmentId))
    .orderBy(desc(simplePins.createdAt));

  return {
    snapshot: wanted
      ? parseSnapshot(wanted.snapshot, condition, seedPrompt)
      : emptySnapshot(armOf(condition), seedPrompt),
    versions: versions.reverse(),
    viewing: wanted ? versions.find((v) => v.versionNo === wanted.versionNo) ?? null : null,
    atTip: !wanted || !tip || wanted.versionNo === tip.versionNo,
    pinned: pins.map((p) => p.messageId),
  };
}

/** The snapshot a question is currently answered against, tip only. */
export async function getSimpleTip(args: {
  assignmentId: string;
  condition: StudioView;
  seedPrompt: string;
}): Promise<{ snapshot: SimpleSnapshot; version: { id: number; versionNo: number } | null }> {
  const [tip] = await db
    .select()
    .from(simpleConfigVersions)
    .where(
      and(
        eq(simpleConfigVersions.assignmentId, args.assignmentId),
        isNull(simpleConfigVersions.hiddenAt)
      )
    )
    .orderBy(desc(simpleConfigVersions.versionNo))
    .limit(1);
  return {
    snapshot: tip
      ? parseSnapshot(tip.snapshot, args.condition, args.seedPrompt)
      : emptySnapshot(armOf(args.condition), args.seedPrompt),
    version: tip ? { id: tip.id, versionNo: tip.versionNo } : null,
  };
}

/** One snapshot by its internal version number, whether hidden or not. */
export async function getSimpleVersion(args: {
  assignmentId: string;
  condition: StudioView;
  seedPrompt: string;
  versionNo: number;
}): Promise<SimpleSnapshot | null> {
  const [row] = await db
    .select()
    .from(simpleConfigVersions)
    .where(
      and(
        eq(simpleConfigVersions.assignmentId, args.assignmentId),
        eq(simpleConfigVersions.versionNo, args.versionNo)
      )
    );
  return row ? parseSnapshot(row.snapshot, args.condition, args.seedPrompt) : null;
}

/**
 * Append a snapshot.
 *
 * The version number counts hidden rows too, so an id in a log or a frozen
 * answer's config reference keeps pointing at the thing it pointed at even
 * after a restore has renumbered what the participant sees.
 */
export async function saveSimpleVersion(args: {
  assignmentId: string;
  snapshot: SimpleSnapshot;
  createdBy?: string | null;
}): Promise<{ id: number; versionNo: number }> {
  const { assignmentId, snapshot } = args;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const [{ max }] = await db
      .select({ max: sql<number>`coalesce(max(${simpleConfigVersions.versionNo}), 0)::int` })
      .from(simpleConfigVersions)
      .where(eq(simpleConfigVersions.assignmentId, assignmentId));
    try {
      const [row] = await db
        .insert(simpleConfigVersions)
        .values({
          assignmentId,
          versionNo: max + 1,
          snapshot,
          createdBy: args.createdBy ?? null,
          createdAt: new Date(),
        })
        .returning({ id: simpleConfigVersions.id, versionNo: simpleConfigVersions.versionNo });
      return row;
    } catch (error) {
      // Two saves at once take the same number; the loser re-reads and retries
      // once. Same shape as the deploy and baseline-version writers.
      const code = (error as { code?: string })?.code;
      if (code !== '23505' || attempt === 1) throw error;
    }
  }
  throw new Error('could not allocate a version number');
}

/** Fill in the name a small model produced, if the row is still there. */
export async function nameSimpleVersion(
  id: number,
  name: string,
  summary: string | null
): Promise<void> {
  await db
    .update(simpleConfigVersions)
    .set({ name: name.slice(0, 80), summary: summary?.slice(0, 200) ?? null })
    .where(eq(simpleConfigVersions.id, id));
}

/**
 * Make an older version the newest one.
 *
 * Everything after it is hidden — not copied forward, not deleted. The
 * participant's timeline simply ends here, which is what makes "the last
 * version is the final state" true without a deploy step.
 */
export async function restoreSimpleVersion(args: {
  assignmentId: string;
  versionNo: number;
}): Promise<{ hidden: number } | null> {
  const [target] = await db
    .select()
    .from(simpleConfigVersions)
    .where(
      and(
        eq(simpleConfigVersions.assignmentId, args.assignmentId),
        eq(simpleConfigVersions.versionNo, args.versionNo),
        isNull(simpleConfigVersions.hiddenAt)
      )
    );
  if (!target) return null;
  const hidden = await db
    .update(simpleConfigVersions)
    .set({ hiddenAt: new Date() })
    .where(
      and(
        eq(simpleConfigVersions.assignmentId, args.assignmentId),
        gt(simpleConfigVersions.versionNo, args.versionNo),
        isNull(simpleConfigVersions.hiddenAt)
      )
    )
    .returning({ id: simpleConfigVersions.id });
  return { hidden: hidden.length };
}

/** The next unused stable id for this assignment, counting hidden versions. */
export async function nextSid(assignmentId: string): Promise<number> {
  const rows = await db
    .select({ snapshot: simpleConfigVersions.snapshot })
    .from(simpleConfigVersions)
    .where(eq(simpleConfigVersions.assignmentId, assignmentId));
  let max = 0;
  for (const row of rows) {
    const intents = (row.snapshot as Partial<SimpleSnapshot>)?.intents;
    if (!Array.isArray(intents)) continue;
    for (const intent of intents) max = Math.max(max, Number(intent?.sid) || 0);
  }
  return max + 1;
}

export async function addSimplePin(assignmentId: string, messageId: number): Promise<void> {
  await db
    .insert(simplePins)
    .values({ assignmentId, messageId, createdAt: new Date() })
    .onConflictDoNothing();
}

export async function removeSimplePin(assignmentId: string, messageId: number): Promise<void> {
  await db
    .delete(simplePins)
    .where(and(eq(simplePins.assignmentId, assignmentId), eq(simplePins.messageId, messageId)));
}
