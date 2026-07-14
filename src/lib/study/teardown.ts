/**
 * Deletion helpers for SCORE study clones — shared by the deprovision (full
 * teardown) and reset (refresh clones, keep account) scripts.
 *
 * SAFE BY CONSTRUCTION: only assignments registered in study_clones are ever
 * deleted, and a clone whose assignment is a source master for other clones is
 * refused — so a master dataset can never be deleted through here.
 */
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db/db';
import {
  assignments,
  instructors,
  studyClones,
  studyParticipants,
  type StudyParticipant,
} from '@/db/schema';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Score/content tables to clear for a clone, in FK-safe order (children first).
const SCORE_TABLES_BY_ASSIGNMENT = [
  'score_rule_version_responses',
  'score_rule_versions',
  'score_rule_previews',
  'score_intent_pins',
  'score_intent_links',
  'score_intent_ratings',
  'score_dissections',
  'score_query_embeddings',
  'score_subtype_scores',
  'score_classifications',
  'score_chat_deploys',
  'score_config_versions',
  'score_intents',
] as const;

/** Delete one clone assignment and all of its sessions / messages / SCORE rows. */
export async function deleteCloneAssignment(tx: Tx, assignmentId: string): Promise<void> {
  for (const table of SCORE_TABLES_BY_ASSIGNMENT) {
    await tx.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE assignment_id = ${assignmentId}`);
  }
  await tx.execute(sql`
    DELETE FROM chat_messages WHERE conversation_id IN (
      SELECT c.id FROM chat_conversations c
      JOIN student_sessions s ON s.id = c.session_id
      WHERE s.assignment_id = ${assignmentId}
    )`);
  await tx.execute(sql`
    DELETE FROM chat_conversations WHERE session_id IN (
      SELECT id FROM student_sessions WHERE assignment_id = ${assignmentId}
    )`);
  await tx.execute(sql`
    DELETE FROM editor_events WHERE session_id IN (
      SELECT id FROM student_sessions WHERE assignment_id = ${assignmentId}
    )`);
  await tx.execute(sql`DELETE FROM student_sessions WHERE assignment_id = ${assignmentId}`);
  await tx.delete(assignments).where(eq(assignments.id, assignmentId));
}

/** Refuse to touch any clone whose assignment is a source master for others. */
async function assertNotMaster(assignmentId: string): Promise<void> {
  const usedAsSource = await db.query.studyClones.findFirst({
    where: eq(studyClones.sourceAssignmentId, assignmentId),
  });
  if (usedAsSource) {
    throw new Error(`Assignment ${assignmentId} is a source master — refusing to delete.`);
  }
}

/**
 * Delete every clone assignment (data + study_clones row) owned by this
 * participant, KEEPING the account. Returns the number of clones removed.
 * Use for reset (the account/number/passcode stay valid; clones are re-made).
 */
export async function deleteParticipantClones(participant: StudyParticipant): Promise<number> {
  const clones = await db.select().from(studyClones).where(eq(studyClones.participantId, participant.id));
  for (const c of clones) await assertNotMaster(c.assignmentId);

  await db.transaction(async (tx) => {
    for (const c of clones) await deleteCloneAssignment(tx, c.assignmentId);
    await tx.delete(studyClones).where(eq(studyClones.participantId, participant.id));
  });
  return clones.length;
}

/** Delete just ONE dataset clone of a participant (data + study_clones row),
 *  keeping the account and the participant's other dataset clones. No-op if the
 *  participant has no clone for that dataset. Use for a per-dataset reset. */
export async function deleteParticipantCloneByDataset(
  participant: StudyParticipant,
  datasetKey: string
): Promise<void> {
  const clone = await db.query.studyClones.findFirst({
    where: and(eq(studyClones.participantId, participant.id), eq(studyClones.datasetKey, datasetKey)),
  });
  if (!clone) return;
  await assertNotMaster(clone.assignmentId);
  await db.transaction(async (tx) => {
    await deleteCloneAssignment(tx, clone.assignmentId);
    await tx.delete(studyClones).where(eq(studyClones.id, clone.id));
  });
}

/** Full teardown: clones + account + instructor. Use for deprovision. */
export async function deleteParticipant(participant: StudyParticipant): Promise<number> {
  const n = await deleteParticipantClones(participant);
  await db.transaction(async (tx) => {
    await tx.delete(studyParticipants).where(eq(studyParticipants.id, participant.id));
    await tx.delete(instructors).where(eq(instructors.id, participant.instructorId));
  });
  return n;
}
