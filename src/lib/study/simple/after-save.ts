/**
 * The work a save sets going and does not wait for.
 *
 * Saving has to be instant, because the loop this version is built around is
 * "change one line, look at what it did" and anything charged to the save is
 * charged to every repetition of that loop (§6.1). So the save writes a
 * snapshot and returns, and this module does the three things that follow:
 *
 *   1. name the version (a small model, one line, best-effort),
 *   2. judge whatever definitions changed,
 *   3. generate the answers most likely to be looked at next.
 *
 * All of it is best-effort and silent. A version with no name reads "v4 ·
 * 14:02", a definition not yet judged shows its list still filling, and an
 * answer not yet generated is generated when it is opened. None of those are
 * errors and none of them are worth telling anyone about mid-session.
 *
 * Latest-save-wins, like warm.ts: a save arriving mid-run does not cancel the
 * run — its snapshot is already pinned — but queues exactly one re-run, which
 * then works from the newer snapshot.
 */
import { armOf, type StudioView } from '../config';
import {
  childrenOf,
  compileSimpleChain,
  definitionsOf,
  resolveSimpleAll,
  ruleForOwner,
  type SimpleSnapshot,
} from './chain';
import { definitionTasks, judgeBatch, readMatches } from './judge';
import { prefetchResponses } from './respond';
import { generateIntentVersionName, generateVersionName } from './name';
import { nameIntentVersion, previousIntentVersion } from './intent-versions';
import { nameSimpleVersion } from './store';

/** How many questions to get answers for before the participant asks. */
const PREFETCH_LIMIT = 12;

interface SaveJob {
  assignmentId: string;
  condition: StudioView;
  versionId: number;
  snapshot: SimpleSnapshot;
  previous: SimpleSnapshot | null;
  /** 'apply' skips the configuration-wide naming: nothing lists an apply at
   * that level, so a label for it is a model call spent on a string nobody
   * reads. The PER-INTENT versions it wrote are listed, and are named either
   * way. */
  kind: 'apply' | 'save';
  /** The intent versions this write appended, for naming. */
  intentVersions: { id: number; sid: number; versionNo: number; title: string;
    definition: string; rule: string }[];
  /** What the board had selected when they saved — the best guess at what
   * they are about to look at. */
  focusSid: number | null;
  pinned: number[];
  recentMessageIds: number[];
}

const inFlight = new Map<string, Promise<void>>();
const queued = new Map<string, SaveJob>();

/**
 * Start (or re-queue) the follow-up work for one clone. Returns immediately.
 *
 * A floating promise, which survives because the study runs on a long-lived
 * server (`node server.js`). On a serverless host it would be cut at the
 * response and everything here would simply happen later, on demand — slower,
 * never wrong.
 */
export function runAfterSave(job: SaveJob): void {
  if (inFlight.has(job.assignmentId)) {
    queued.set(job.assignmentId, job);
    return;
  }
  start(job);
}

/** The run in progress for this clone, for callers that want to wait. */
export function afterSaveInFlight(assignmentId: string): Promise<void> | null {
  return inFlight.get(assignmentId) ?? null;
}

function start(job: SaveJob): void {
  const run = perform(job).finally(() => {
    inFlight.delete(job.assignmentId);
    const next = queued.get(job.assignmentId);
    if (next) {
      queued.delete(job.assignmentId);
      start(next);
    }
  });
  inFlight.set(job.assignmentId, run);
}

async function perform(job: SaveJob): Promise<void> {
  await Promise.allSettled([
    job.kind === 'save' ? nameVersion(job) : Promise.resolve(),
    nameIntentVersions(job),
    judgeAndPrefetch(job),
  ]);
}

/**
 * A label per intent version, from that intent's own diff.
 *
 * In parallel and best-effort, like every other name here: a version with none
 * reads "v3 · 14:02", which is worse and not broken. Bounded because a single
 * write can touch several intents and this must not become the slow thing
 * behind a save that already returned.
 */
async function nameIntentVersions(job: SaveJob): Promise<void> {
  await Promise.allSettled(
    job.intentVersions.slice(0, 8).map(async (version) => {
      try {
        const previous = await previousIntentVersion(job.assignmentId, version.sid, version.versionNo);
        const named = await generateIntentVersionName(version, previous);
        if (named) await nameIntentVersion(version.id, named.name, named.summary);
      } catch {
        /* the timestamp label is already on screen */
      }
    })
  );
}

async function nameVersion(job: SaveJob): Promise<void> {
  try {
    const named = await generateVersionName(job.snapshot, job.previous);
    if (named) await nameSimpleVersion(job.versionId, named.name, named.summary);
  } catch {
    /* the fallback label is already on screen */
  }
}

/**
 * Judge the definitions this save changed, then answer the questions that are
 * about to be looked at.
 *
 * Judging comes first and prefetch second because ownership decides which rule
 * a question gets — generating answers before the routing settles would spend
 * calls on rules that are about to be superseded.
 */
async function judgeAndPrefetch(job: SaveJob): Promise<void> {
  const arm = armOf(job.condition);
  try {
    if (arm === 'score') {
      const tasks = definitionTasks(definitionsOf(job.snapshot));
      if (tasks.length > 0) {
        // Only the definitions whose text is new to this assignment cost
        // anything; everything else is already in the cache under the same key.
        for (let pass = 0; pass < 40; pass += 1) {
          const progress = await judgeBatch({
            assignmentId: job.assignmentId,
            tasks,
            priorityMessageIds: priorityMessages(job),
          });
          if (progress.remaining === 0 || progress.ratedThisBatch === 0) break;
        }
      }
    }
    await prefetch(job);
  } catch {
    /* the board generates on demand for anything this missed */
  }
}

/**
 * What to look at first: the intent they had open, then their pins, then
 * whatever they were reading recently.
 */
function priorityMessages(job: SaveJob): number[] {
  return [...job.pinned, ...job.recentMessageIds];
}

async function prefetch(job: SaveJob): Promise<void> {
  const arm = armOf(job.condition);
  if (arm === 'baseline') {
    // One document answers everything, so there is no "the questions this
    // change affects" to be clever about — take the top of the list, the pins,
    // and what they were just reading.
    const ids = [...new Set([...job.pinned, ...job.recentMessageIds])].slice(0, PREFETCH_LIMIT);
    await prefetchResponses({
      assignmentId: job.assignmentId,
      pairs: ids.map((messageId) => ({ messageId, rule: job.snapshot.prompt })),
    });
    return;
  }

  const tasks = definitionTasks(definitionsOf(job.snapshot));
  const matches = await readMatches({ assignmentId: job.assignmentId, tasks });
  const messageIds = [...matches.keys()];
  const { owners } = resolveSimpleAll(job.snapshot, matches, messageIds);

  // The intent they had open, and everything nested inside it: after a rule
  // edit those are the answers that changed, and after a definition edit they
  // are the list that just moved.
  const focus = new Set<number>();
  if (job.focusSid != null) {
    focus.add(job.focusSid);
    for (const child of compileSimpleChain(job.snapshot)) {
      if (childrenOf(job.snapshot, job.focusSid).some((c) => c.sid === child.sid)) {
        focus.add(child.sid);
      }
    }
  }

  const ranked = [
    ...messageIds.filter((id) => {
      const sid = owners.get(id)?.sid;
      return sid != null && focus.has(sid);
    }),
    ...job.pinned,
    ...job.recentMessageIds,
  ];
  const seen = new Set<number>();
  const pairs: { messageId: number; rule: string }[] = [];
  for (const messageId of ranked) {
    if (seen.has(messageId) || pairs.length >= PREFETCH_LIMIT) continue;
    seen.add(messageId);
    const ownership = owners.get(messageId);
    if (!ownership || ownership.outcome === 'pending') continue;
    pairs.push({ messageId, rule: ruleForOwner(job.snapshot, ownership.sid) });
  }
  if (pairs.length > 0) await prefetchResponses({ assignmentId: job.assignmentId, pairs });
}
