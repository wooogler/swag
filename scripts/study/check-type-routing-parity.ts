/**
 * Is the type a participant is SHOWN the same type their rule is ROUTED on?
 *
 * Generation no longer classifies a bank question — it routes on the type the
 * bank froze (generate.ts rule 3, deploy-store's knownType). That turns a
 * classifier-agreement problem into a data-agreement one, and this checks the
 * data. Three copies of one verdict have to say the same thing:
 *
 *   master — score_query_types on the curation master. The source, and what the
 *            curation board displays while sets are being assigned.
 *   bank   — study_question_bank.query_type, frozen at bank build. What ROUTES.
 *   clone  — score_query_types inside each participant's clone, copied at
 *            provision and never re-derived. What the participant's workbench
 *            SHOWS them while they decide which type to write a rule under.
 *
 * Checking bank↔master and clone↔master gives bank↔clone for free, so those are
 * the two comparisons below.
 *
 * They drift for one reason: these are three snapshots of the same row taken at
 * three different moments. Re-typing a master after clones exist moves master
 * and bank without moving the clones; rebuilding the bank after a re-type moves
 * bank alone. Nothing errors when they disagree — the participant's rule simply
 * sits in a chain their question never walks, and the answer comes back looking
 * untouched. That is exactly the silence this script exists to break.
 *
 * A note on what the clone comparison covers. Test questions are deliberately
 * held OUT of a participant's log, so most of what it compares is the review
 * set — the questions they author against, where a stale verdict misleads them
 * about which type a rule belongs under. Some bank questions do turn up too, as
 * context turns of a kept thread. Both matter and neither is checked elsewhere.
 *
 * Clone messages are matched to master ones by TEXT: provision copies content
 * verbatim, so it is byte-identical, while the ids are remapped twice (curation
 * master → reduced study master → clone). Repeated text is only a problem when
 * its copies disagree with each other; when they agree there is nothing to pick
 * between, and it is counted as a match.
 *
 * Read-only. Exits 1 when anything disagrees, so it can gate a study run.
 *
 *   npx tsx --env-file=.env scripts/study/check-type-routing-parity.ts
 */
import { eq, inArray } from 'drizzle-orm';
import { db } from '../../src/db/db';
import {
  chatConversations,
  chatMessages,
  scoreQueryTypes,
  studentSessions,
  studyClones,
  studyQuestionBank,
} from '../../src/db/schema';
import { isScoreQueryType, TYPE_CLASSIFIER_VERSION } from '../../src/lib/score/intents';
import { CURATION_DATASETS } from '../../src/lib/study/config';

async function main() {
  const bank = await db
    .select({
      id: studyQuestionBank.id,
      datasetKey: studyQuestionBank.datasetKey,
      position: studyQuestionBank.position,
      sourceMessageId: studyQuestionBank.sourceMessageId,
      question: studyQuestionBank.question,
      queryType: studyQuestionBank.queryType,
    })
    .from(studyQuestionBank);

  console.log(`TYPE_CLASSIFIER_VERSION=${TYPE_CLASSIFIER_VERSION}`);
  console.log(`bank items: ${bank.length}\n`);
  if (bank.length === 0) {
    console.log('No bank yet — nothing routes on a frozen type. Build the bank first.');
    process.exit(0);
  }

  let problems = 0;

  /* ── 1. every bank item carries a type at all ── */
  const untyped = bank.filter((b) => !isScoreQueryType(b.queryType));
  console.log(`── bank items with a frozen type ──`);
  console.log(
    `  ${untyped.length === 0 ? '✓' : '✗'} ${bank.length - untyped.length}/${bank.length} typed` +
      (untyped.length ? `  (${untyped.map((u) => `#${u.id}`).join(' ')} fall back to a LIVE call)` : '')
  );
  problems += untyped.length;

  /* ── 2. bank vs the master row it was frozen from ── */
  const sourceIds = bank.map((b) => b.sourceMessageId).filter((v): v is number => v !== null);
  const masterRows = sourceIds.length
    ? await db
        .select({
          messageId: scoreQueryTypes.messageId,
          type: scoreQueryTypes.type,
          version: scoreQueryTypes.version,
        })
        .from(scoreQueryTypes)
        .where(inArray(scoreQueryTypes.messageId, sourceIds))
    : [];
  const masterType = new Map<number, string>();
  for (const r of masterRows) {
    if (r.version >= TYPE_CLASSIFIER_VERSION && isScoreQueryType(r.type)) {
      masterType.set(r.messageId, r.type);
    }
  }

  const bankVsMaster: string[] = [];
  for (const b of bank) {
    if (b.sourceMessageId === null) continue;
    const m = masterType.get(b.sourceMessageId);
    if (!m) {
      bankVsMaster.push(`#${b.id} (msg ${b.sourceMessageId}) master has no current verdict`);
    } else if (m !== b.queryType) {
      bankVsMaster.push(`#${b.id} (msg ${b.sourceMessageId}) bank=${b.queryType} master=${m}`);
    }
  }
  console.log(`\n── bank vs master ──`);
  console.log(
    `  ${bankVsMaster.length === 0 ? '✓' : '✗'} ${bank.length - bankVsMaster.length}/${bank.length} agree`
  );
  for (const line of bankVsMaster.slice(0, 20)) console.log(`      ${line}`);
  if (bankVsMaster.length > 20) console.log(`      … ${bankVsMaster.length - 20} more`);
  problems += bankVsMaster.length;

  /* ── 3. clone vs master (what the participant's workbench shows) ── */
  const clones = await db
    .select({
      participantId: studyClones.participantId,
      assignmentId: studyClones.assignmentId,
      datasetKey: studyClones.datasetKey,
    })
    .from(studyClones);

  console.log(`\n── clone vs master (${clones.length} clones) ──`);
  if (clones.length === 0) console.log('  (no clones provisioned)');

  // Master verdicts keyed by text, since that is the only key that survives the
  // two remaps. A text carrying more than one verdict on the master is skipped
  // and named — it is a master-side ambiguity, not a clone problem.
  const masterByText = await typesByText(
    CURATION_DATASETS.map((d) => d.masterAssignmentId)
  );

  for (const clone of clones) {
    const cloneByText = await typesByText([clone.assignmentId]);

    let compared = 0;
    let unknownOnMaster = 0;
    const disagree: string[] = [];
    for (const [text, cloneVerdict] of cloneByText) {
      const masterVerdict = masterByText.get(text);
      if (masterVerdict === undefined) {
        unknownOnMaster += 1;
        continue;
      }
      // Ambiguous on either side (null) — nothing to compare, not a failure.
      if (masterVerdict === null || cloneVerdict === null) continue;
      compared += 1;
      if (masterVerdict !== cloneVerdict) {
        disagree.push(`shown=${cloneVerdict} master=${masterVerdict}  «${text.slice(0, 46)}…»`);
      }
    }

    console.log(
      `  ${disagree.length === 0 ? '✓' : '✗'} ${clone.participantId.slice(0, 20).padEnd(20)}` +
        ` ${clone.datasetKey.padEnd(10)} compared ${String(compared).padStart(4)}` +
        (unknownOnMaster ? `  ${unknownOnMaster} not on master` : '') +
        (disagree.length ? `  ${disagree.length} DISAGREE` : '')
    );
    for (const line of disagree.slice(0, 5)) console.log(`      ${line}`);
    if (disagree.length > 5) console.log(`      … ${disagree.length - 5} more`);
    problems += disagree.length;
  }

  console.log(
    problems === 0
      ? '\nOne verdict per question, everywhere. What a participant is shown is what routes.'
      : `\n${problems} disagreement(s). Re-type the master and re-provision, or rebuild the bank, ` +
          'so all three copies come from the same pass.'
  );
  process.exit(problems === 0 ? 0 : 1);
}

/**
 * Current type verdicts in the given assignments, keyed by message TEXT.
 * null means the text carries conflicting verdicts and cannot be compared;
 * absent means it carries none at the current classifier version.
 */
async function typesByText(assignmentIds: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (assignmentIds.length === 0) return out;

  const rows = await db
    .select({
      content: chatMessages.content,
      type: scoreQueryTypes.type,
      version: scoreQueryTypes.version,
    })
    .from(chatMessages)
    .innerJoin(chatConversations, eq(chatConversations.id, chatMessages.conversationId))
    .innerJoin(studentSessions, eq(studentSessions.id, chatConversations.sessionId))
    .innerJoin(scoreQueryTypes, eq(scoreQueryTypes.messageId, chatMessages.id))
    .where(inArray(studentSessions.assignmentId, assignmentIds));

  for (const r of rows) {
    if (r.version < TYPE_CLASSIFIER_VERSION || !isScoreQueryType(r.type)) continue;
    if (!out.has(r.content)) out.set(r.content, r.type);
    else if (out.get(r.content) !== r.type) out.set(r.content, null);
  }
  return out;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
