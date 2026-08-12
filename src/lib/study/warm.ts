/**
 * Freeze a study clone's measurement answers as soon as it deploys, instead of
 * making someone wait for them later.
 *
 * Deploying is the moment the thing being measured exists, so it is also the
 * moment its answers can be made — and the participant is still working, which
 * is the only stretch of the session with time to spare. By the time they say
 * they are done, the batch is usually already sitting in the table and the
 * hand-off is instant.
 *
 * This is a HEAD START, never the guarantee. advance.ts still generates on the
 * way out of the block, because this can be superseded (they redeploy), cut
 * short (the process restarts), or never have run at all (the console's manual
 * Generate). Everything here is best-effort and silent: a failed warm-up must
 * not surface as a failed deploy, and the real attempt reports its own errors.
 *
 * Latest-deploy-wins: a deploy during a run does not cancel it (the batch is
 * already pinned to the older version) but queues exactly one re-run, whose
 * pin is the newer version. Rows from the superseded run are then stale by
 * configRef, which is precisely how generateForClone knows to replace them.
 */
import { eq } from 'drizzle-orm';
import { db } from '@/db/db';
import { studyClones } from '@/db/schema';
import { STUDY_DATASETS } from './config';
import { generateForClone, type BankKind } from './generate';

/** Runs keyed by clone, so a second deploy can find the first still going. */
const inFlight = new Map<string, Promise<void>>();
const queued = new Set<string>();

/** Test first: it is the hand-off the participant reaches first. */
const WARM_KINDS: BankKind[] = ['test'];

/**
 * Kick off (or re-queue) the warm-up for a clone. Returns immediately — the
 * caller is a deploy request and must not wait on a batch of model calls.
 *
 * A floating promise, which survives because the study runs on a long-lived
 * server (Dockerfile: `node server.js`). Under a serverless host it would be
 * cut off at the response instead, and the flow still works: the hand-off just
 * pays the generation time it pays today.
 */
export function warmClone(assignmentId: string): void {
  if (inFlight.has(assignmentId)) {
    queued.add(assignmentId);
    return;
  }
  start(assignmentId);
}

/**
 * The run currently freezing this clone's answers, if any — so the real
 * attempt can let it finish rather than issue a second call for every item.
 */
export function warmInFlight(assignmentId: string): Promise<void> | null {
  return inFlight.get(assignmentId) ?? null;
}

function start(assignmentId: string): void {
  const run = warm(assignmentId).finally(() => {
    inFlight.delete(assignmentId);
    if (queued.delete(assignmentId)) start(assignmentId);
  });
  inFlight.set(assignmentId, run);
}

async function warm(assignmentId: string): Promise<void> {
  try {
    const [clone] = await db
      .select()
      .from(studyClones)
      .where(eq(studyClones.assignmentId, assignmentId));
    if (!clone) return; // an ordinary assignment — nothing to measure

    for (const kind of WARM_KINDS) {
      // Block test = this clone's own dataset. A/B = both datasets, which is
      // how one configuration comes to answer the other set's questions.
      const datasetKeys = kind === 'test' ? [clone.datasetKey] : STUDY_DATASETS.map((d) => d.key);
      for (const datasetKey of datasetKeys) {
        try {
          await generateForClone({ cloneAssignmentId: assignmentId, datasetKey, kind });
        } catch {
          // empty_bank before curation is published, not_deployed on a race
          // with a rollback — both are the real attempt's to report.
        }
      }
    }
  } catch {
    /* a head start must never break the deploy that triggered it */
  }
}
