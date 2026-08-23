/**
 * Reading and writing the simple version's configuration timeline.
 *
 * Two verbs write, and they differ only in what they claim.
 *
 *   APPLY takes effect. The board judges and answers from it immediately, and
 *   that is the whole of it — nothing is added to the history, because the
 *   history is meant to be a short list of places worth coming back to and a
 *   participant iterating for twenty minutes would bury it.
 *
 *   SAVE takes effect AND marks the point. It is what the history lists, what
 *   a restore can return to, and — this is the part that has to stay true —
 *   what the study measures. The block test reads the newest SAVE, so a
 *   configuration nobody saved is a configuration nobody is measured on, and
 *   the board says so rather than letting that pass quietly.
 *
 * Both are rows in the same timeline, so "the newest row is the current
 * configuration" holds regardless, and the trail keeps every attempt.
 *
 * Neither waits on a model, because the whole reason this version exists is
 * that the edit → check loop has to be cheap enough to repeat without thinking
 * about it (docs/SCORE_SIMPLE_DESIGN.md §6.1). A save's name and one-line
 * summary are filled in afterwards by a small model, and if that never arrives
 * the timeline reads "v3 · 14:02" forever, which is a worse label and not a
 * broken one.
 *
 * NO `server-only` in this directory, deliberately. It is not a declared
 * dependency — Next resolves it and nothing else does — so a module carrying it
 * cannot be imported by a script, and these modules are reached from generate.ts
 * and console-store.ts, which half of scripts/study/ imports. Adding it once
 * broke six checking scripts while tsc and the build both stayed green. The
 * protection it offered is redundant anyway: everything here imports the
 * database, which was never going to run in a browser.
 *
 * Restore is a rollback: the versions after the restored one stop being part
 * of the timeline, so "the last version" is always the final state and there
 * is no deploy step to keep in step with it (§3.3). They are hidden rather
 * than deleted — a participant who builds something, abandons it and goes
 * back is RQ1 data, and hard-deleting it is the mistake the full version's
 * rule-version revert already makes.
 */
import { and, asc, desc, eq, gt, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { db } from '@/db/db';
import {
  simpleConfigVersions,
  simpleIntentExamples,
  simpleIntentVersions,
  simplePins,
  simpleSidCounter,
} from '@/db/schema';
import { armOf, type StudioView } from '../config';
import { emptySnapshot, flattenStoredIntents, type SimpleSnapshot } from './chain';

export type SimpleVersionKind = 'apply' | 'save';

export interface SimpleVersion {
  id: number;
  /** Internal, monotonic, includes hidden rows. Config refs and logs use this. */
  versionNo: number;
  /** What the timeline calls it: the position among visible rows, from 1. */
  displayNo: number;
  name: string | null;
  summary: string | null;
  createdAt: string;
  kind: SimpleVersionKind;
}

export interface SimpleState {
  /** The configuration as of the version being viewed. */
  snapshot: SimpleSnapshot;
  /** Saves only, newest first. Applies are not places to come back to. */
  versions: SimpleVersion[];
  /**
   * Every version, newest first — what the conversation can be read under.
   *
   * A different question from the timeline's. "Where can I go back to" is
   * answered only by a save; "what did this answer look like then" is answered
   * by every moment the configuration passed through, and most of the moments
   * an intent's own history points at are applies.
   */
  moments: SimpleVersion[];
  /** The version being viewed, or null when nothing has been written yet. */
  viewing: SimpleVersion | null;
  /** True when `viewing` is the newest version, i.e. edits are allowed. */
  atTip: boolean;
  /** The newest SAVE — what the study measures. Null if they never saved. */
  savedVersionNo: number | null;
  /** The version they stood behind, if they have deployed one. */
  deployedVersionNo: number | null;
  /** Applied changes the newest save does not carry. */
  dirty: boolean;
  /**
   * Which intents differ from the last save — 0 is the everything-else rule,
   * or the whole document on the baseline arm. What the tree marks, so that
   * "not saved" says WHERE rather than only whether.
   */
  unsavedSids: number[];
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
    // Snapshots written before the list was flattened still carry parent
    // pointers; `flattenStoredIntents` turns those into the order they were
    // actually evaluated in, so an old version restores to what it did.
    intents: Array.isArray(raw.intents)
      ? flattenStoredIntents(
          (raw.intents as unknown as Record<string, unknown>[]).map((i) => ({
            sid: Number(i.sid),
            title: typeof i.title === 'string' ? i.title : '',
            definition: typeof i.definition === 'string' ? i.definition : '',
            rule: typeof i.rule === 'string' ? i.rule : '',
            parentSid: i.parentSid == null ? null : Number(i.parentSid),
          }))
        )
      : [],
  };
}

/**
 * The one row an apply writes to: after the newest save, and not a save.
 *
 * There is at most one because an apply overwrites it. A configuration that
 * has never been saved has one too — everything applied before the first save
 * lives there.
 */
async function workingRow(assignmentId: string) {
  const rows = await visibleVersions(assignmentId);
  const last = rows[rows.length - 1];
  return last && last.kind !== 'save' ? last : null;
}

/** Drop the working row, keeping anything numbered above the save that just
 * replaced it out of the way. */
async function clearWorkingRow(assignmentId: string, upToVersionNo: number): Promise<number> {
  const dropped = await db
    .delete(simpleConfigVersions)
    .where(
      and(
        eq(simpleConfigVersions.assignmentId, assignmentId),
        eq(simpleConfigVersions.kind, 'apply'),
        lt(simpleConfigVersions.versionNo, upToVersionNo),
        // Hidden rows belong to a restore, which is a record of something that
        // was undone rather than a working state waiting to be replaced.
        isNull(simpleConfigVersions.hiddenAt)
      )
    )
    .returning({ id: simpleConfigVersions.id });
  return dropped.length;
}

/**
 * The timeline, WITHOUT the configurations themselves.
 *
 * Every column but `snapshot`. Everything left reading this only asks what
 * kind a row is and where it sits — which one is the working row, whether the
 * newest is a save, which save to fall back to — and none of it opens a
 * configuration. `timelineFor` below is the one that needs the text.
 */
async function visibleVersions(assignmentId: string) {
  const rows = await db
    .select({
      id: simpleConfigVersions.id,
      versionNo: simpleConfigVersions.versionNo,
      kind: simpleConfigVersions.kind,
      name: simpleConfigVersions.name,
      summary: simpleConfigVersions.summary,
      deployedAt: simpleConfigVersions.deployedAt,
      createdAt: simpleConfigVersions.createdAt,
    })
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
 * The timeline, carrying the configuration on the rows whose text gets read.
 *
 * Three of them at most — what is being looked at, what is in effect, and what
 * was last saved — and usually one row wearing three hats. Everything else on
 * the timeline is a label and a number.
 *
 * Which three they are depends on the list, so the obvious shape is to read
 * the list and then go back for those snapshots. That is wrong twice over.
 * `clearWorkingRow` deletes the working row as part of every save, so a read
 * landing in the gap comes back with a row on the timeline and nothing to put
 * under it — and the fallback for a configuration that will not load is the
 * prompt the assignment shipped with, so the board would show a participant
 * someone else's work. One statement, and there is no gap to land in.
 *
 * Picked in SQL rather than by fetching every snapshot and choosing afterwards
 * because that is the point: an apply appends a row, so "every snapshot" grows
 * for as long as somebody works, and this is on the path the board polls.
 */
async function timelineFor(assignmentId: string, versionNo: number | null) {
  const rows = await db.execute<{
    id: number;
    version_no: number;
    kind: string;
    name: string | null;
    summary: string | null;
    deployed_at: Date | null;
    created_at: Date;
    snapshot: unknown;
  }>(sql`
    SELECT id, version_no, kind, name, summary, deployed_at, created_at,
           CASE
             WHEN version_no = max(version_no) OVER ()
               OR version_no = max(version_no) FILTER (WHERE kind = 'save') OVER ()
               OR version_no = ${versionNo}
             THEN snapshot
           END AS snapshot
    FROM simple_config_versions
    WHERE assignment_id = ${assignmentId} AND hidden_at IS NULL
    ORDER BY version_no ASC
  `);
  return [...rows].map((row) => ({
    id: Number(row.id),
    versionNo: Number(row.version_no),
    kind: row.kind,
    name: row.name,
    summary: row.summary,
    deployedAt: row.deployed_at,
    createdAt: new Date(row.created_at),
    snapshot: row.snapshot,
  }));
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
  const rows = await timelineFor(assignmentId, args.versionNo ?? null);
  // The history is the saves. Applies took effect and are kept for the trail,
  // but they are not places to come back to and listing them would bury the
  // ones that are.
  const saved = rows.filter((r) => r.kind === 'save');
  const versions: SimpleVersion[] = saved.map((row, i) => ({
    id: row.id,
    versionNo: row.versionNo,
    displayNo: i + 1,
    name: row.name,
    summary: row.summary,
    createdAt: row.createdAt.toISOString(),
    kind: 'save',
  }));

  // The saves, plus whatever is applied on top of the newest one. An apply is
  // not a version, but it IS a thing the reply can be read under — it is what
  // the board is answering with right now.
  const savedNo = new Map(saved.map((row, i) => [row.versionNo, i + 1]));
  const moments: SimpleVersion[] = rows.map((row) => ({
    id: row.id,
    versionNo: row.versionNo,
    displayNo: savedNo.get(row.versionNo) ?? 0,
    name: row.name,
    summary: row.summary,
    createdAt: row.createdAt.toISOString(),
    kind: row.kind === 'save' ? 'save' : 'apply',
  }));

  const tip = rows.length ? rows[rows.length - 1] : null;
  const savedTip = saved.length ? saved[saved.length - 1] : null;
  /**
   * Version 0 is the configuration AS DELIVERED — the prompt this chatbot
   * actually ran with, before anyone touched it.
   *
   * It is not a row: nobody wrote it, so there is nothing to store. But it is
   * where every board starts and the floor its history stands on, and the
   * reply's picker has always offered it per question ("Original (as
   * delivered)"). This is the same fact for the whole board.
   */
  const asDelivered = args.versionNo === 0;
  const wanted = asDelivered
    ? null
    : args.versionNo != null
      ? rows.find((r) => r.versionNo === args.versionNo) ?? tip
      : tip;

  const pins = await db
    .select({ messageId: simplePins.messageId })
    .from(simplePins)
    .where(eq(simplePins.assignmentId, assignmentId))
    .orderBy(desc(simplePins.createdAt));

  const shown =
    wanted && !asDelivered
      ? parseSnapshot(wanted.snapshot, condition, seedPrompt)
      : emptySnapshot(armOf(condition), seedPrompt);
  const deliveredRow: SimpleVersion = {
    id: 0,
    versionNo: 0,
    displayNo: 0,
    name: 'As delivered',
    summary: null,
    createdAt: (rows[0]?.createdAt ?? new Date()).toISOString(),
    kind: 'save',
  };

  return {
    snapshot: shown,
    versions: versions.reverse(),
    moments: moments.reverse(),
    viewing: asDelivered
      ? deliveredRow
      : wanted
        ? versions.find((v) => v.versionNo === wanted.versionNo) ??
          moments.find((v) => v.versionNo === wanted.versionNo) ??
          null
        : null,
    atTip: !asDelivered && (!wanted || !tip || wanted.versionNo === tip.versionNo),
    savedVersionNo: savedTip?.versionNo ?? null,
    deployedVersionNo:
      [...rows].reverse().find((r) => r.deployedAt != null)?.versionNo ?? null,
    // Something took effect that the newest save does not carry. The board
    // says so, and the study refuses to end a block on it.
    dirty: !!tip && tip.versionNo !== (savedTip?.versionNo ?? -1),
    // Against the TIP, not against what is being shown: what somebody has
    // applied and not saved is a fact about their work, and it does not stop
    // being true because they are looking at an older version. Read off the
    // shown snapshot it went away exactly when they went to look, taking the
    // row that offers the way back with it.
    // Nothing saved YET is compared against the configuration as delivered,
    // not against nothing: before the first save, everything applied is
    // unsaved, and answering "[]" there hid the only row that leads back to
    // it — the state a participant is in for the first minutes of a block.
    unsavedSids: unsavedAgainst(
      tip ? parseSnapshot(tip.snapshot, condition, seedPrompt) : shown,
      savedTip
        ? parseSnapshot(savedTip.snapshot, condition, seedPrompt)
        : emptySnapshot(armOf(condition), seedPrompt)
    ),
    pinned: pins.map((p) => p.messageId),
  };
}

/**
 * Which intents have moved since the last save.
 *
 * Position counts, not only the texts: reordering changes which intent answers
 * a question first, so two intents swapped and not saved have changed what the
 * chatbot does even though neither one's words did.
 *
 * A DELETED intent cannot be marked — it has no row left to mark it on — which
 * is why the whole-configuration statement stays: it is the one case the tree
 * cannot show.
 */
function unsavedAgainst(now: SimpleSnapshot, saved: SimpleSnapshot): number[] {
  const out: number[] = [];
  if (now.arm === 'baseline') {
    if (now.prompt !== saved.prompt) out.push(0);
    return out;
  }
  if (now.rootRule !== saved.rootRule) out.push(0);
  const before = new Map(saved.intents.map((i, index) => [i.sid, { ...i, index }]));
  now.intents.forEach((intent, index) => {
    const was = before.get(intent.sid);
    if (
      !was ||
      was.title !== intent.title ||
      was.definition !== intent.definition ||
      was.rule !== intent.rule ||
      was.index !== index
    ) {
      out.push(intent.sid);
    }
  });
  return out;
}

/**
 * The newest SAVE — the configuration the study measures.
 *
 * Separate from the tip on purpose: what the board answers from is whatever
 * took effect last, and what the block test asks about is what the participant
 * decided was worth keeping. Those are the same thing only when they saved,
 * which is why nothing lets them finish a block until they have.
 */
/**
 * The configuration the participant stands behind — what the study measures.
 *
 * Deploy is the final save. There is no separate live copy here: the board has
 * always answered from the newest write, and the briefing has always told
 * participants to deploy when it is ready. What deploying adds is the
 * DECLARATION — of the saves they made, this is the one — and until it exists
 * there is nothing to measure, because "the last one they happened to save"
 * is not an answer anybody gave.
 */
export async function getSimpleDeployed(args: {
  assignmentId: string;
  condition: StudioView;
  seedPrompt: string;
}): Promise<{ snapshot: SimpleSnapshot; version: { id: number; versionNo: number } | null }> {
  const [row] = await db
    .select()
    .from(simpleConfigVersions)
    .where(
      and(
        eq(simpleConfigVersions.assignmentId, args.assignmentId),
        isNotNull(simpleConfigVersions.deployedAt),
        isNull(simpleConfigVersions.hiddenAt)
      )
    )
    .orderBy(desc(simpleConfigVersions.deployedAt))
    .limit(1);
  return {
    snapshot: row
      ? parseSnapshot(row.snapshot, args.condition, args.seedPrompt)
      : emptySnapshot(armOf(args.condition), args.seedPrompt),
    version: row ? { id: row.id, versionNo: row.versionNo } : null,
  };
}

/**
 * Deploy: save whatever is in effect, and stand behind it.
 *
 * Two acts in one press because they are one decision. Deploying with an
 * unsaved change and deploying the save before it are both wrong answers to
 * "is this what you meant" — so the applied state is committed first, and the
 * version that results is the one stamped.
 */
export async function deploySimpleVersion(args: {
  assignmentId: string;
  versionNo: number;
}): Promise<{ versionNo: number } | null> {
  const [row] = await db
    .update(simpleConfigVersions)
    .set({ deployedAt: new Date() })
    .where(
      and(
        eq(simpleConfigVersions.assignmentId, args.assignmentId),
        eq(simpleConfigVersions.versionNo, args.versionNo),
        eq(simpleConfigVersions.kind, 'save')
      )
    )
    .returning({ versionNo: simpleConfigVersions.versionNo });
  return row ?? null;
}

export async function getSimpleSaved(args: {
  assignmentId: string;
  condition: StudioView;
  seedPrompt: string;
}): Promise<{ snapshot: SimpleSnapshot; version: { id: number; versionNo: number } | null }> {
  const [row] = await db
    .select()
    .from(simpleConfigVersions)
    .where(
      and(
        eq(simpleConfigVersions.assignmentId, args.assignmentId),
        eq(simpleConfigVersions.kind, 'save'),
        isNull(simpleConfigVersions.hiddenAt)
      )
    )
    .orderBy(desc(simpleConfigVersions.versionNo))
    .limit(1);
  return {
    snapshot: row
      ? parseSnapshot(row.snapshot, args.condition, args.seedPrompt)
      : emptySnapshot(armOf(args.condition), args.seedPrompt),
    version: row ? { id: row.id, versionNo: row.versionNo } : null,
  };
}

/** Whether anything has taken effect that the newest save does not carry. */
export async function isSimpleDirty(assignmentId: string): Promise<boolean> {
  const rows = await visibleVersions(assignmentId);
  if (rows.length === 0) return false;
  const tip = rows[rows.length - 1];
  return tip.kind !== 'save';
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
  // 0 is the configuration as delivered — no row, because nobody wrote it.
  if (args.versionNo === 0) return emptySnapshot(armOf(args.condition), args.seedPrompt);
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
/**
 * Write a configuration — and only a SAVE makes a version.
 *
 * An apply takes effect and nothing else. It writes to a single working row
 * that sits after the newest save and is overwritten by the next apply, so
 * trying six wordings leaves one row rather than six, and the numbers a
 * participant reads count the points they decided were worth keeping. Saving
 * writes a version and clears the working row, because what it held has just
 * become the version.
 *
 * The applies are not lost to the record: every write logs `simple_version_save`
 * with what it changed, field by field, which is what the analysis reads. What
 * they no longer do is inflate a version history that is meant to be a list of
 * decisions.
 */
export async function saveSimpleVersion(args: {
  assignmentId: string;
  snapshot: SimpleSnapshot;
  /** 'apply' takes effect; 'save' also marks the point. */
  kind: SimpleVersionKind;
  createdBy?: string | null;
}): Promise<{ id: number; versionNo: number }> {
  const { assignmentId, snapshot } = args;

  if (args.kind === 'apply') {
    const working = await workingRow(assignmentId);
    if (working) {
      const [row] = await db
        .update(simpleConfigVersions)
        .set({ snapshot, createdAt: new Date() })
        .where(eq(simpleConfigVersions.id, working.id))
        .returning({ id: simpleConfigVersions.id, versionNo: simpleConfigVersions.versionNo });
      return row;
    }
  }

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
          kind: args.kind,
          snapshot,
          createdBy: args.createdBy ?? null,
          createdAt: new Date(),
        })
        .returning({ id: simpleConfigVersions.id, versionNo: simpleConfigVersions.versionNo });
      // The working row's content is this version now.
      if (args.kind === 'save') await clearWorkingRow(assignmentId, row.versionNo);
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
  // 0 is the configuration as delivered: no row to find, and everything is
  // after it. Starting over from what the chatbot came with is a place to go
  // back to like any other — the difference is only that it is the floor.
  if (args.versionNo !== 0) {
    // Only whether it is there — reading the configuration to answer that
    // would carry the whole thing back to be thrown away.
    const [target] = await db
      .select({ id: simpleConfigVersions.id })
      .from(simpleConfigVersions)
      .where(
        and(
          eq(simpleConfigVersions.assignmentId, args.assignmentId),
          eq(simpleConfigVersions.versionNo, args.versionNo),
          isNull(simpleConfigVersions.hiddenAt)
        )
      );
    if (!target) return null;
  }
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
  // The per-intent rows that belonged to those writes go with them, and here
  // deleted rather than hidden: every one of them is a copy of a pair that is
  // still in the snapshot above, so the trail loses nothing — and leaving them
  // would number the next save v5 after a card whose last row says v1.
  await db
    .delete(simpleIntentVersions)
    .where(
      and(
        eq(simpleIntentVersions.assignmentId, args.assignmentId),
        gt(simpleIntentVersions.configVersionNo, args.versionNo)
      )
    );
  return { hidden: hidden.length };
}

/**
 * Throw away what has been applied since the last save.
 *
 * The partner of Apply: try things, and if none of them were right, go back to
 * the point you marked. Hidden rather than deleted, like a restore — an
 * attempt someone abandoned is the RQ1 material, and it is only the
 * participant's timeline it leaves.
 *
 * Nothing saved yet means there is no point to go back to, and this reports
 * that rather than wiping their work.
 */
/**
 * Throw away what is applied and go back to the last SAVE.
 *
 * Only ever to a save — there is nowhere else to go. With applies overwriting
 * one working row there is exactly one thing to drop, so this deletes it
 * rather than hiding it: a row that was never a version has no history to
 * preserve, and the trail of what was applied lives in the events.
 */
export async function revertSimpleWorking(assignmentId: string): Promise<{
  to: number;
  dropped: number;
} | null> {
  const rows = await visibleVersions(assignmentId);
  const saved = rows.filter((r) => r.kind === 'save');
  const target = saved.length ? saved[saved.length - 1] : null;
  if (!target) return null;
  const dropped = await db
    .delete(simpleConfigVersions)
    .where(
      and(
        eq(simpleConfigVersions.assignmentId, assignmentId),
        gt(simpleConfigVersions.versionNo, target.versionNo)
      )
    )
    .returning({ id: simpleConfigVersions.id });
  return { to: target.versionNo, dropped: dropped.length };
}

/** The next unused stable id for this assignment, counting hidden versions. */
/**
 * Hand out `count` intent ids, and never hand the same one out twice.
 *
 * It used to be inferred — the largest sid in any stored snapshot, plus one —
 * which held while every write appended a row. Applies overwrite a single
 * working row now, so an intent created and deleted without ever being saved
 * left nothing behind, and the next one was given its id back along with its
 * examples, its history and its cached verdicts. An id is what judgments,
 * answers and logged events all hang off; it cannot be a guess about which
 * rows happen to still exist.
 *
 * The counter is seeded on first use from everything that ever mentioned an
 * id, so an assignment that predates it does not start again at 1.
 */
export async function reserveSids(assignmentId: string, count: number): Promise<number[]> {
  if (count <= 0) return [];
  const [row] = await db
    .insert(simpleSidCounter)
    .values({ assignmentId, nextSid: (await highestSidSoFar(assignmentId)) + 1 + count })
    .onConflictDoUpdate({
      target: simpleSidCounter.assignmentId,
      set: { nextSid: sql`${simpleSidCounter.nextSid} + ${count}` },
    })
    .returning({ nextSid: simpleSidCounter.nextSid });
  const after = row?.nextSid ?? count + 1;
  const first = after - count;
  return Array.from({ length: count }, (_, i) => first + i);
}

/** Every id this assignment has ever used, from all four places one can be
 * mentioned — the seed for the counter and nothing else. */
async function highestSidSoFar(assignmentId: string): Promise<number> {
  const [snapshots, versions, examples] = await Promise.all([
    db
      .select({ snapshot: simpleConfigVersions.snapshot })
      .from(simpleConfigVersions)
      .where(eq(simpleConfigVersions.assignmentId, assignmentId)),
    db
      .select({ high: sql<number>`coalesce(max(${simpleIntentVersions.sid}), 0)::int` })
      .from(simpleIntentVersions)
      .where(eq(simpleIntentVersions.assignmentId, assignmentId)),
    db
      .select({ high: sql<number>`coalesce(max(${simpleIntentExamples.sid}), 0)::int` })
      .from(simpleIntentExamples)
      .where(eq(simpleIntentExamples.assignmentId, assignmentId)),
  ]);
  let max = Math.max(versions[0]?.high ?? 0, examples[0]?.high ?? 0);
  for (const row of snapshots) {
    const intents = (row.snapshot as Partial<SimpleSnapshot>)?.intents;
    if (!Array.isArray(intents)) continue;
    for (const intent of intents) max = Math.max(max, Number(intent?.sid) || 0);
  }
  return max;
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
