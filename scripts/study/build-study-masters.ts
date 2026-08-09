/**
 * Build the reduced STUDY masters from a confirmed review set.
 *
 * A participant should meet exactly the curated 60 questions, not the whole
 * 507/348-message log. Doing that by filtering the board would leave the
 * uncurated questions one request away and the test/A-B questions sitting in
 * the same log a participant is browsing; building a smaller master instead
 * makes the reduction structural — the questions are simply not there.
 *
 * Each kept thread is cut at its last curated turn, so a participant reads the
 * same context the chatbot had and never a turn from after it.
 *
 *   npx tsx --env-file=.env scripts/study/build-study-masters.ts            # plan only
 *   npx tsx --env-file=.env scripts/study/build-study-masters.ts --apply
 *   npx tsx --env-file=.env scripts/study/build-study-masters.ts --apply --dataset swag
 *
 * Idempotent by share token: rebuilding replaces the previous study master.
 * Refuses while a participant still holds a clone OF that master.
 */
import { randomUUID } from 'node:crypto';
import type { CloneRestriction } from '../../src/lib/study/provision';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../src/db/db';
import {
  assignments,
  chatMessages,
  scoreIntentPins,
  scoreIntents,
  studyClones,
} from '../../src/db/schema';

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] ?? null : null;
}

const APPLY = process.argv.includes('--apply');
const ONLY = argValue('--dataset');

/** Study masters are addressed by a stable token, not by id. */
export function studyMasterToken(datasetKey: string): string {
  return `${datasetKey}-study`;
}

async function main() {
  const { CURATION_DATASETS, curationDataset } = await import('../../src/lib/study/config');
  const { getConfirmedSet, isLocked } = await import('../../src/lib/study/curation');
  const { cloneStarterSet } = await import('../../src/lib/study/provision');
  const { ensureStudyTables } = await import('../../src/lib/study/store');
  const { deleteCloneAssignment } = await import('../../src/lib/study/teardown');
  await ensureStudyTables();

  const targets = CURATION_DATASETS.filter((d) => !ONLY || d.key === ONLY);
  if (targets.length === 0) throw new Error(`unknown --dataset ${ONLY}`);

  for (const dataset of targets) {
    const source = curationDataset(dataset.key)!;
    console.log(`\n=== ${dataset.label} (${dataset.key}) ===`);

    if (!(await isLocked(dataset.key))) {
      console.log('  curation is NOT confirmed — lock the sets first. Skipping.');
      continue;
    }

    const review = await getConfirmedSet(dataset.key, 'review');
    if (review.length === 0) {
      console.log('  review set is empty. Skipping.');
      continue;
    }

    // Each curated question's thread, cut at the LAST curated turn in it.
    const rows = await db
      .select({
        messageId: chatMessages.id,
        conversationId: chatMessages.conversationId,
        sequenceNumber: chatMessages.sequenceNumber,
      })
      .from(chatMessages)
      .where(inArray(chatMessages.id, review.map((r) => r.messageId)));
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
    console.log(
      `  review questions ${review.length} · threads ${restrictTo.length} · source messages ${totalMsgs[0]?.n ?? 0}`
    );

    const token = studyMasterToken(dataset.key);
    const existing = await db.query.assignments.findFirst({
      where: eq(assignments.shareToken, token),
    });
    if (existing) {
      const holders = await db
        .select({ id: studyClones.id })
        .from(studyClones)
        .where(eq(studyClones.sourceAssignmentId, existing.id));
      if (holders.length > 0) {
        console.log(
          `  ✗ ${holders.length} participant clone(s) still point at the existing study master — deprovision them first.`
        );
        continue;
      }
      console.log(`  existing study master ${existing.id.slice(0, 8)}… will be replaced`);
    }

    if (!APPLY) {
      console.log('  (plan only — re-run with --apply)');
      continue;
    }

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
      const counts = await cloneStarterSet(tx, {
        sourceAssignmentId: source.masterAssignmentId,
        newAssignmentId: newId,
        newInstructorId: ownerId,
        shareToken: token,
        newTitle: `${dataset.label} (study)`,
        includeEditorEvents: false,
        restrictTo,
      });
      // The study forbids the assignment description reaching the prompt; a
      // reduced master must never re-enable it by inheritance.
      await tx
        .update(assignments)
        .set({ includeInstructionInPrompt: false })
        .where(eq(assignments.id, newId));
      console.log(`  built ${newId.slice(0, 8)}… ${JSON.stringify(counts)}`);
    });

    await report(newId, source.masterAssignmentId, review.length);
  }

  console.log(
    '\nNext: point STUDY_DATASETS at these study masters (src/lib/study/config.ts), then re-provision.'
  );
  process.exit(0);
}

/** What the built master actually contains, and what the cut cost. */
async function report(newId: string, sourceId: string, expectedQuestions: number) {
  const counts = await db.execute<{ label: string; n: number }>(sql`
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
  `);
  for (const row of counts) console.log(`    ${row.label.padEnd(10)} ${row.n}`);

  const byType = await db.execute<{ type: string; n: number }>(sql`
    SELECT t.type, count(*)::int AS n
    FROM score_query_types t
    JOIN chat_messages m ON m.id = t.message_id
    WHERE t.assignment_id = ${newId} AND m.role = 'user'
    GROUP BY t.type ORDER BY t.type
  `);
  console.log(`    per type   ${byType.map((r) => `${r.type}=${r.n}`).join(' ')}`);

  const questions = counts.find((c) => c.label === 'questions')?.n ?? 0;
  if (questions !== expectedQuestions) {
    console.log(
      `    NOTE: ${questions} questions vs ${expectedQuestions} curated — the extra are earlier turns of the same threads, which the participant needs as context.`
    );
  }

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
  const lost = (srcPins[0]?.n ?? 0) - (newPins[0]?.n ?? 0);
  console.log(
    `    template pins ${newPins[0]?.n ?? 0}/${srcPins[0]?.n ?? 0}${lost > 0 ? ` — ${lost} dropped (pinned outside the review set)` : ''}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
