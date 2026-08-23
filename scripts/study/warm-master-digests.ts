/**
 * Generate the conversation digests a master's curated questions need, so that
 * every clone made from it inherits them instead of paying for them again.
 *
 * A digest summarises the turns before a question, and a preview cannot start
 * streaming until it has one (conversation-digest.ts, read by
 * simple/respond.ts and preview-service.ts). Most curated questions sit
 * mid-thread, so without this the first participant to open each one waits on
 * a model call before seeing a word — and so does the first participant on
 * every other clone, for the same conversation, because the cache is keyed by
 * message id and each clone has its own ids.
 *
 * Provisioning copies a master's digests down (provision.ts step 10c). This is
 * the other half: a master has to have them for that to inherit anything.
 *
 * TWO MASTERS PER DATASET, and both are warmed, because the chain has two
 * hops and cloneStarterSet carries digests across each:
 *
 *   full curation master  --build-study-masters-->  study master  --> clone
 *
 * The STUDY master is what participants are provisioned from today, so
 * warming it is what takes effect without rebuilding anything. The FULL master
 * is where a rebuild starts from, so warming it is what stops the next
 * `build-study-masters --apply` from handing back a cold master. Neither one
 * substitutes for the other: they are different assignments with different
 * message ids, and a digest is keyed by message id.
 *
 * Only questions that will actually be LISTED are warmed. On the study master
 * that is its review marks; on the full master, which carries no marks, it is
 * the dataset's curated set from study_set_members — without that it would
 * digest all ~500 messages of the full log to serve the 60 that get used.
 *
 * Re-running is cheap: getConversationDigests reads through, so anything
 * already stored at the current version is a lookup and only gaps cost.
 *
 *   npx tsx --env-file=.env scripts/study/warm-master-digests.ts
 *   npx tsx --env-file=.env scripts/study/warm-master-digests.ts --yes
 *   npx tsx --env-file=.env scripts/study/warm-master-digests.ts --dataset swag --yes
 *
 * Without --yes it reports what WOULD be generated and exits, because the work
 * is a batch of model calls and the number should be seen before it is spent.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../../src/db/db';
import { scoreConversationDigests, studySetMembers } from '../../src/db/schema';
import { STUDY_DATASETS, type StudyDataset } from '../../src/lib/study/config';
import {
  CONVERSATION_DIGEST_VERSION,
  getConversationDigests,
} from '../../src/lib/score/conversation-digest';
import { getConversationHistories, getQueryRecords } from '../../src/lib/score/queries';
import { resolveMasterAssignmentId } from '../../src/lib/study/provision';
import { reviewScope } from '../../src/lib/study/simple/scope';

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

interface Target {
  messageId: number;
  queryText: string;
  history: { role: 'user' | 'assistant'; content: string }[];
}

interface Plan {
  label: string;
  assignmentId: string;
  targets: Target[];
  fresh: number;
}

/**
 * Which questions this assignment is going to be asked about.
 *
 * Its own review marks where it has them — that is what the board lists — and
 * the dataset's curated set where it does not, which is the full curation
 * master's case: its marks live per-dataset in study_set_members, addressed by
 * the source message ids the curation was done against.
 */
async function curatedIds(assignmentId: string, datasetKey: string): Promise<Set<number>> {
  const marks = await reviewScope(assignmentId);
  if (marks) return marks;
  const members = await db
    .select({ messageId: studySetMembers.sourceMessageId })
    .from(studySetMembers)
    .where(and(eq(studySetMembers.datasetKey, datasetKey), eq(studySetMembers.setKind, 'review')));
  return new Set(members.map((m) => m.messageId));
}

/**
 * The questions to digest, as getConversationDigests wants them.
 *
 * Questions with no prior turns are dropped here rather than passed along:
 * they have nothing to digest, and counting them would report a batch bigger
 * than the one that runs.
 */
async function targetsFor(assignmentId: string, datasetKey: string): Promise<Target[]> {
  const ids = await curatedIds(assignmentId, datasetKey);
  if (ids.size === 0) return [];
  const records = (await getQueryRecords(assignmentId)).filter((r) => ids.has(r.messageId));
  const histories = await getConversationHistories(
    assignmentId,
    records.map((r) => r.messageId)
  );
  return records
    .map((record) => ({
      messageId: record.messageId,
      queryText: record.queryText,
      history: histories.get(record.messageId) ?? [],
    }))
    .filter((t) => t.history.length > 0);
}

/**
 * How many of these already have a digest at the CURRENT version.
 *
 * The version matters: after a CONVERSATION_DIGEST_VERSION bump every stored
 * row is stale and the runtime regenerates it, so counting rows at any version
 * would report a batch of zero while the participants pay for all of it.
 */
async function countFresh(assignmentId: string, messageIds: number[]): Promise<number> {
  if (messageIds.length === 0) return 0;
  const rows = await db
    .select({ messageId: scoreConversationDigests.messageId })
    .from(scoreConversationDigests)
    .where(
      and(
        eq(scoreConversationDigests.assignmentId, assignmentId),
        eq(scoreConversationDigests.version, CONVERSATION_DIGEST_VERSION),
        inArray(scoreConversationDigests.messageId, messageIds)
      )
    );
  return rows.length;
}

async function plansFor(dataset: StudyDataset): Promise<Plan[]> {
  const studyMasterId = await resolveMasterAssignmentId(dataset);
  const targets: { label: string; assignmentId: string }[] = [
    { label: `${dataset.key} study master`, assignmentId: studyMasterId },
  ];
  // Same id means no study master has been built yet — resolveMasterAssignmentId
  // fell back to the full one, and there is only one assignment to warm.
  if (studyMasterId !== dataset.assignmentId) {
    targets.push({ label: `${dataset.key} full master`, assignmentId: dataset.assignmentId });
  }

  const plans: Plan[] = [];
  for (const target of targets) {
    const found = await targetsFor(target.assignmentId, dataset.key);
    plans.push({
      ...target,
      targets: found,
      fresh: await countFresh(
        target.assignmentId,
        found.map((t) => t.messageId)
      ),
    });
  }
  return plans;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const only = typeof args.dataset === 'string' ? args.dataset : null;
  const datasets = only ? STUDY_DATASETS.filter((d) => d.key === only) : STUDY_DATASETS;
  if (datasets.length === 0) {
    console.error(
      `No dataset named "${only}". Known: ${STUDY_DATASETS.map((d) => d.key).join(', ')}`
    );
    process.exit(1);
  }

  const plans: Plan[] = [];
  for (const dataset of datasets) plans.push(...(await plansFor(dataset)));

  let totalMissing = 0;
  for (const plan of plans) {
    const missing = plan.targets.length - plan.fresh;
    totalMissing += missing;
    console.log(
      `${plan.label.padEnd(26)} ${plan.assignmentId}  ` +
        `${plan.targets.length} mid-thread curated questions, ${plan.fresh} already fresh, ` +
        `${missing} to generate`
    );
  }

  if (!args.yes) {
    console.log(`\nDry run. ${totalMissing} digest(s) would be generated. Re-run with --yes.`);
    process.exit(0);
  }
  if (totalMissing === 0) {
    console.log('\nNothing to do.');
    process.exit(0);
  }

  for (const plan of plans) {
    if (plan.targets.length === plan.fresh) continue;
    console.log(`\nGenerating ${plan.targets.length - plan.fresh} for ${plan.label}…`);
    // The runtime's own function, not a copy of its prompt: a warmed digest has
    // to be byte-for-byte what the lazy path would have produced, or the
    // response model gets a different input depending on who got there first.
    // It reads through, so the fresh ones cost a lookup.
    const digests = await getConversationDigests(plan.assignmentId, plan.targets);
    const failed = plan.targets.filter((t) => !digests.get(t.messageId)).length;
    console.log(
      `${plan.label}: ${plan.targets.length - failed}/${plan.targets.length} digested` +
        (failed > 0 ? `, ${failed} failed (re-run to retry — failures are not stored)` : '')
    );
  }

  console.log('\nDone. Clones provisioned from here on inherit these.');
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
