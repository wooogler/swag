/**
 * Turning a confirmed curation into the material a participant actually meets.
 *
 * Two builds, in order:
 *
 *  1. The reduced study masters. A participant should meet exactly the curated
 *     questions, not the whole 507/348-message log. Doing that by filtering the
 *     board would leave the uncurated questions one request away and the
 *     test/A-B questions sitting in the same log a participant is browsing;
 *     building a smaller master instead makes the reduction structural — the
 *     questions are simply not there. Each kept thread is cut at its last
 *     curated turn, so a participant reads the same context the chatbot had and
 *     never a turn from after it.
 *
 *  2. The question bank. Block-test and A/B questions are never part of a
 *     participant's log — they are new to them — so they are frozen as text
 *     (context turns + the question) taken from the ORIGINAL master. Frozen,
 *     not referenced: a later rebuild must not change a question a participant
 *     was already asked.
 *
 * This module is the single implementation; the CLI scripts and the curation
 * tool's build button both call it, so neither can drift into being the one
 * that does it "properly".
 */
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db/db';
import {
  assignments,
  chatMessages,
  scoreIntentPins,
  scoreIntents,
  studyClones,
  studyGeneratedResponses,
  studyQuestionBank,
} from '@/db/schema';
import { CURATION_DATASETS, curationDataset, studyMasterToken } from './config';
import { getConfirmedSet, isLocked } from './curation';
import { cloneStarterSet, type CloneRestriction } from './provision';
import { ensureStudyTables } from './store';
import { deleteCloneAssignment } from './teardown';

/* ------------------------------------------------------------------ */
/* 1 · reduced study masters                                           */
/* ------------------------------------------------------------------ */

export interface MasterBuildResult {
  datasetKey: string;
  label: string;
  /** built = written · planned = dry run · skipped/blocked = nothing done */
  status: 'built' | 'planned' | 'skipped' | 'blocked';
  reason?: string;
  assignmentId?: string;
  reviewQuestions: number;
  threads: number;
  sourceMessages: number;
  /** questions / students / templates / ratings / types / review-set */
  counts?: Record<string, number>;
  perType?: Record<string, number>;
  templatePins?: { kept: number; source: number };
  warnings: string[];
}

export async function buildStudyMasters(opts: {
  apply: boolean;
  datasetKey?: string;
}): Promise<MasterBuildResult[]> {
  await ensureStudyTables();

  const targets = CURATION_DATASETS.filter((d) => !opts.datasetKey || d.key === opts.datasetKey);
  if (targets.length === 0) throw new Error(`unknown dataset ${opts.datasetKey}`);

  const results: MasterBuildResult[] = [];
  for (const dataset of targets) {
    results.push(await buildOneMaster(dataset.key, dataset.label, opts.apply));
  }
  return results;
}

async function buildOneMaster(
  datasetKey: string,
  label: string,
  apply: boolean
): Promise<MasterBuildResult> {
  const base: MasterBuildResult = {
    datasetKey,
    label,
    status: 'skipped',
    reviewQuestions: 0,
    threads: 0,
    sourceMessages: 0,
    warnings: [],
  };
  const source = curationDataset(datasetKey)!;

  if (!(await isLocked(datasetKey))) {
    return { ...base, reason: 'curation is not confirmed — lock the sets first' };
  }

  const review = await getConfirmedSet(datasetKey, 'review');
  if (review.length === 0) return { ...base, reason: 'review set is empty' };

  // Each curated question's thread, cut at the LAST curated turn in it.
  const rows = await db
    .select({
      messageId: chatMessages.id,
      conversationId: chatMessages.conversationId,
      sequenceNumber: chatMessages.sequenceNumber,
    })
    .from(chatMessages)
    .where(
      inArray(
        chatMessages.id,
        review.map((r) => r.messageId)
      )
    );
  const cutoffs = new Map<string, number>();
  for (const row of rows) {
    const prev = cutoffs.get(row.conversationId) ?? 0;
    // +1 keeps the chatbot's reply to the last curated question: the board
    // shows a question WITH its answer, which is the thing being reviewed.
    cutoffs.set(row.conversationId, Math.max(prev, row.sequenceNumber + 1));
  }
  const restrictTo: CloneRestriction[] = [...cutoffs].map(([conversationId, maxSequence]) => ({
    conversationId,
    maxSequence,
  }));

  const totalMsgs = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM chat_messages m
    JOIN chat_conversations c ON c.id = m.conversation_id
    JOIN student_sessions s ON s.id = c.session_id
    WHERE s.assignment_id = ${source.masterAssignmentId}
  `);

  const partial: MasterBuildResult = {
    ...base,
    reviewQuestions: review.length,
    threads: restrictTo.length,
    sourceMessages: totalMsgs[0]?.n ?? 0,
  };

  const token = studyMasterToken(datasetKey);
  const existing = await db.query.assignments.findFirst({
    where: eq(assignments.shareToken, token),
  });
  if (existing) {
    const holders = await db
      .select({ id: studyClones.id })
      .from(studyClones)
      .where(eq(studyClones.sourceAssignmentId, existing.id));
    if (holders.length > 0) {
      return {
        ...partial,
        status: 'blocked',
        reason: `${holders.length} participant clone(s) still hold the current study master — remove or reset them first`,
      };
    }
    partial.warnings.push(`replaces study master ${existing.id.slice(0, 8)}…`);
  }

  if (!apply) return { ...partial, status: 'planned' };

  // The study master belongs to whoever owns the source master — a research
  // dataset, not a participant.
  const sourceRow = await db.query.assignments.findFirst({
    where: eq(assignments.id, source.masterAssignmentId),
  });
  const ownerId = sourceRow?.instructorId;
  if (!ownerId) throw new Error('source master has no owner to inherit');

  const newId = randomUUID();
  await db.transaction(async (tx) => {
    if (existing) await deleteCloneAssignment(tx, existing.id);
    await cloneStarterSet(tx, {
      sourceAssignmentId: source.masterAssignmentId,
      newAssignmentId: newId,
      newInstructorId: ownerId,
      shareToken: token,
      newTitle: `${label} (study)`,
      includeEditorEvents: false,
      restrictTo,
      // The curated questions, marked. The threads around them come along as
      // context, so without this the board would list those earlier turns as
      // material to review and the per-type balance would be whatever the
      // threads happened to contain.
      markReviewSourceMessageIds: review.map((r) => r.messageId),
    });
    // The study forbids the assignment description reaching the prompt; a
    // reduced master must never re-enable it by inheritance.
    await tx
      .update(assignments)
      .set({ includeInstructionInPrompt: false })
      .where(eq(assignments.id, newId));
  });

  const built = await inspectMaster(newId, source.masterAssignmentId);
  const marked = built.counts['review-set'] ?? 0;
  if (marked !== review.length) {
    partial.warnings.push(
      `marked ${marked} but curated ${review.length} — the board would list the wrong set`
    );
  }
  if (built.templatePins.source > built.templatePins.kept) {
    partial.warnings.push(
      `${built.templatePins.source - built.templatePins.kept} template pin(s) dropped (pinned outside the review set)`
    );
  }

  return { ...partial, status: 'built', assignmentId: newId, ...built };
}

/** What the built master actually contains, and what the cut cost. */
async function inspectMaster(
  newId: string,
  sourceId: string
): Promise<{
  counts: Record<string, number>;
  perType: Record<string, number>;
  templatePins: { kept: number; source: number };
}> {
  const rows = await db.execute<{ label: string; n: number }>(sql`
    SELECT 'questions' AS label, count(*)::int AS n
      FROM chat_messages m
      JOIN chat_conversations c ON c.id = m.conversation_id
      JOIN student_sessions s ON s.id = c.session_id
      WHERE s.assignment_id = ${newId} AND m.role = 'user'
    UNION ALL
    SELECT 'students', count(*)::int FROM student_sessions WHERE assignment_id = ${newId}
    UNION ALL
    SELECT 'templates', count(*)::int FROM score_intents WHERE assignment_id = ${newId} AND is_template
    UNION ALL
    SELECT 'ratings', count(*)::int FROM score_intent_ratings WHERE assignment_id = ${newId}
    UNION ALL
    SELECT 'types', count(*)::int FROM score_query_types WHERE assignment_id = ${newId}
    UNION ALL
    SELECT 'review-set', count(*)::int FROM study_review_questions WHERE assignment_id = ${newId}
  `);
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.label] = row.n;

  // Per type over the MARKED questions — what the board will actually list.
  const byType = await db.execute<{ type: string; n: number }>(sql`
    SELECT t.type, count(*)::int AS n
    FROM score_query_types t
    JOIN study_review_questions rq ON rq.message_id = t.message_id AND rq.assignment_id = ${newId}
    WHERE t.assignment_id = ${newId}
    GROUP BY t.type ORDER BY t.type
  `);
  const perType: Record<string, number> = {};
  for (const row of byType) perType[row.type] = row.n;

  // Template pins copy through _msg_map, so a starter boundary example pinned
  // to a question outside the review set is dropped. Not fatal — but it changes
  // what the starter suggestions carry, so it gets said out loud.
  const [srcPins, newPins] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(scoreIntentPins)
      .innerJoin(scoreIntents, eq(scoreIntents.id, scoreIntentPins.intentId))
      .where(and(eq(scoreIntentPins.assignmentId, sourceId), eq(scoreIntents.isTemplate, true))),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(scoreIntentPins)
      .where(eq(scoreIntentPins.assignmentId, newId)),
  ]);

  return {
    counts,
    perType,
    templatePins: { kept: newPins[0]?.n ?? 0, source: srcPins[0]?.n ?? 0 },
  };
}

/* ------------------------------------------------------------------ */
/* 2 · question bank                                                   */
/* ------------------------------------------------------------------ */

interface Candidate {
  messageId: number;
  datasetKey: string;
  queryType: string | null;
  subtype: string | null;
}

export interface BankBuildResult {
  status: 'built' | 'planned' | 'blocked';
  reason?: string;
  testCandidates: number;
  replaced: number;
  written: number;
  warnings: string[];
}

export async function buildQuestionBank(opts: { apply: boolean }): Promise<BankBuildResult> {
  await ensureStudyTables();

  const base: BankBuildResult = {
    status: 'blocked',
    testCandidates: 0,
    replaced: 0,
    written: 0,
    warnings: [],
  };

  // Both datasets, always: a participant's two blocks are one per dataset, so
  // half a bank is a study that cannot run its second block.
  const test: Candidate[] = [];
  for (const dataset of CURATION_DATASETS) {
    if (!(await isLocked(dataset.key))) {
      return { ...base, reason: `${dataset.key}: curation is not confirmed — lock the sets first` };
    }
    for (const row of await getConfirmedSet(dataset.key, 'test')) {
      test.push({ ...row, datasetKey: dataset.key });
    }
  }

  const partial: BankBuildResult = { ...base, testCandidates: test.length };

  // Freeze the text: prior turns + the question itself, as of now.
  const frozen = await freezeQuestions(test);

  if (!opts.apply) return { ...partial, status: 'planned' };

  // Rebuilding is refused once answers exist against the current bank: a
  // participant was already asked those questions, and renumbering or
  // replacing them would orphan what they said.
  const existing = await db.select({ id: studyQuestionBank.id }).from(studyQuestionBank);
  if (existing.length > 0) {
    const used = await db
      .select({ id: studyGeneratedResponses.id })
      .from(studyGeneratedResponses)
      .where(
        inArray(
          studyGeneratedResponses.bankItemId,
          existing.map((e) => e.id)
        )
      )
      .limit(1);
    if (used.length > 0) {
      return {
        ...partial,
        status: 'blocked',
        reason: 'answers already exist against the current bank — refusing to rebuild',
      };
    }
    await db.delete(studyQuestionBank);
    partial.replaced = existing.length;
  }

  const rows: (typeof studyQuestionBank.$inferInsert)[] = [];
  // Block test keeps its per-dataset ordering: it is shown to one clone only.
  const testByDataset = new Map<string, Candidate[]>();
  for (const c of test) {
    const list = testByDataset.get(c.datasetKey) ?? [];
    list.push(c);
    testByDataset.set(c.datasetKey, list);
  }
  for (const [datasetKey, list] of testByDataset) {
    list.forEach((c, i) => {
      const f = frozen.get(c.messageId);
      if (!f) return;
      rows.push({
        datasetKey,
        kind: 'test',
        position: i,
        sourceMessageId: c.messageId,
        context: f.context,
        question: f.question,
        queryType: c.queryType,
        subtype: c.subtype,
        createdAt: new Date(),
      });
    });
  }
  if (rows.length === 0) {
    return { ...partial, status: 'blocked', reason: 'nothing to write — no block-test items' };
  }

  await db.insert(studyQuestionBank).values(rows);
  return { ...partial, status: 'built', written: rows.length };
}

/** The question text plus the turns before it, taken from the source master. */
async function freezeQuestions(
  candidates: Candidate[]
): Promise<Map<number, { context: { role: string; content: string }[]; question: string }>> {
  const out = new Map<number, { context: { role: string; content: string }[]; question: string }>();
  if (candidates.length === 0) return out;

  const anchors = await db
    .select({
      id: chatMessages.id,
      conversationId: chatMessages.conversationId,
      sequenceNumber: chatMessages.sequenceNumber,
      content: chatMessages.content,
    })
    .from(chatMessages)
    .where(
      inArray(
        chatMessages.id,
        candidates.map((c) => c.messageId)
      )
    );

  for (const anchor of anchors) {
    const priors = await db
      .select({ role: chatMessages.role, content: chatMessages.content })
      .from(chatMessages)
      .where(
        sql`${chatMessages.conversationId} = ${anchor.conversationId} AND ${chatMessages.sequenceNumber} < ${anchor.sequenceNumber}`
      )
      .orderBy(chatMessages.sequenceNumber);
    out.set(anchor.id, {
      context: priors.map((p) => ({ role: p.role, content: p.content })),
      question: anchor.content,
    });
  }
  return out;
}
