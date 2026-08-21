/**
 * The demo: a participant session the researcher can walk through themselves.
 *
 * It is not a preview mode. A demo run provisions a real study participant with
 * a real clone and hands the browser that participant's session, so everything
 * from /study/session onward — the walkthrough step, the studio, deploy, the
 * block test, the survey, the blind A/B — is the participant's own code path
 * with nothing branching on "this is a demo". That is the point: a preview that
 * renders through a second path is a preview of the second path.
 *
 * The only thing that differs is the material. The workspace holds just the
 * conversations of the isolated demo subtypes, which are the ones already
 * withheld from every study set — so a demo can be recorded and shown around
 * without spending any question a participant will later be measured on.
 *
 * One demo participant per condition (DEMO-SCORE / DEMO-BASELINE), because a
 * participant may hold only one clone per dataset and a demo wants to show both
 * arms of the same dataset. They are flagged is_demo and kept out of the
 * console and the metrics export. That number is an internal key and is never
 * put on screen as itself — see DEMO_DISPLAY_NUMBER.
 */
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db/db';
import { assignments, chatMessages, studyClones, studyParticipants } from '@/db/schema';
import { STUDY_DATASETS, curationDataset, familyOf, type StudioView } from './config';
import { demoQuestionIds } from './curation';
import { logParticipantEvent } from './events';
import { blockPlan } from './phases';
import { cloneStarterSet, ensureParticipantAccount, type CloneRestriction } from './provision';
import { ensureStudyTables } from './store';
import { deleteParticipantCloneByDataset } from './teardown';
import type { StudyParticipant } from '@/db/schema';

/**
 * Where the researcher's own id waits while a demo has their session.
 *
 * /study/admin spends it to put them back. It holds an id this browser already
 * had in user_session — the same secret, not a new one — and the restore path
 * re-checks the role rather than trusting the cookie.
 */
export const ADMIN_RETURN_COOKIE = 'study_admin_return';

/**
 * Stable, and shaped like any other participant number (PARTICIPANT_NUMBER_RE).
 *
 * One per condition, not per arm: a demo holds one clone per dataset, and the
 * simple family's board is a different film. Four accounts, four walkthroughs.
 */
export function demoParticipantNumber(condition: StudioView): string {
  return `DEMO-${condition.toUpperCase().replace(/_/g, '-')}`;
}

export function isDemoNumber(participantNumber: string): boolean {
  return participantNumber.toUpperCase().startsWith('DEMO-');
}

/**
 * What a demo is called on screen, in place of its own number.
 *
 * The number has to say which arm it is — one account per condition — and the
 * screens that show a participant their number are the board header and the
 * session page, both of which are in shot for the whole walkthrough. A film
 * every participant watches before block 1 would therefore open by captioning
 * itself DEMO-SCORE, which is the same leak the address bar and the header
 * were just closed against, and worse: this one is shown to everybody in both
 * arms.
 *
 * One string for both conditions, so the two films differ in the board and
 * nothing else. It stays shaped like a participant number (it IS one, as far
 * as PARTICIPANT_NUMBER_RE is concerned) so the header reads as the same line
 * a participant will later see with their own number in it.
 */
export const DEMO_DISPLAY_NUMBER = 'DEMO';

/** The number to show a participant — theirs, or the demo's neutral stand-in. */
export function displayParticipantNumber(participant: {
  participantNumber: string;
  isDemo: boolean;
}): string {
  return participant.isDemo ? DEMO_DISPLAY_NUMBER : participant.participantNumber;
}

export interface DemoWorkspace {
  participant: StudyParticipant;
  assignmentId: string;
  datasetKey: string;
  condition: StudioView;
  /** Questions the board will list as material. */
  questions: number;
  threads: number;
}

/**
 * Build (or rebuild) the demo workspace for one dataset in one condition, and
 * return the participant whose session should be handed to the browser.
 *
 * Always rebuilds the clone: the demo subtypes are edited between runs, and a
 * stale workspace showing last week's selection is worse than the wait.
 */
export async function ensureDemoWorkspace(args: {
  datasetKey: string;
  condition: StudioView;
}): Promise<DemoWorkspace> {
  const { datasetKey, condition } = args;
  await ensureStudyTables();

  const dataset = STUDY_DATASETS.find((d) => d.key === datasetKey);
  const source = curationDataset(datasetKey);
  if (!dataset || !source) throw new Error(`unknown dataset ${datasetKey}`);

  const questionIds = await demoQuestionIds(datasetKey);
  if (questionIds.length === 0) throw new Error('no_demo_questions');

  // Same cut as the study master: each thread ends at its last demo question,
  // plus the chatbot's reply to it, so a question is always read with the
  // answer that is being judged.
  const rows = await db
    .select({
      conversationId: chatMessages.conversationId,
      sequenceNumber: chatMessages.sequenceNumber,
    })
    .from(chatMessages)
    .where(inArray(chatMessages.id, questionIds));
  const cutoffs = new Map<string, number>();
  for (const row of rows) {
    const prev = cutoffs.get(row.conversationId) ?? 0;
    cutoffs.set(row.conversationId, Math.max(prev, row.sequenceNumber + 1));
  }
  const restrictTo: CloneRestriction[] = [...cutoffs].map(([conversationId, maxSequence]) => ({
    conversationId,
    maxSequence,
  }));
  if (restrictTo.length === 0) throw new Error('no_demo_questions');

  const participant = await ensureDemoParticipant(condition, datasetKey);

  // Rebuild from scratch so an edited subtype selection actually shows up.
  await deleteParticipantCloneByDataset(participant, datasetKey);

  const assignmentId = randomUUID();
  await db.transaction(async (tx) => {
    await cloneStarterSet(tx, {
      // The FULL master, not the reduced study master: the demo subtypes are
      // isolated, so by construction their conversations are not in the study
      // master at all.
      sourceAssignmentId: source.masterAssignmentId,
      newAssignmentId: assignmentId,
      newInstructorId: participant.instructorId,
      shareToken: `demo-${condition}-${datasetKey}-${assignmentId.slice(0, 8)}`,
      newTitle: dataset.cloneTitle,
      includeEditorEvents: false,
      restrictTo,
      markReviewSourceMessageIds: questionIds,
    });
    await tx
      .update(assignments)
      .set({ includeInstructionInPrompt: false })
      .where(eq(assignments.id, assignmentId));
    await tx.insert(studyClones).values({
      id: randomUUID(),
      participantId: participant.id,
      datasetKey,
      assignmentId,
      sourceAssignmentId: source.masterAssignmentId,
      // Forced: the demo exists to show a chosen arm, so BOTH its clones run
      // that arm — unlike a real participant, whose two blocks split across the
      // conditions according to the cell the researcher assigned them.
      condition,
      createdAt: new Date(),
    });
  });

  // Start the clock LAST, so it reads 0 when the board opens rather than
  // however long the rebuild above took.
  await startDemoClock(participant);

  return {
    participant,
    assignmentId,
    datasetKey,
    condition,
    questions: questionIds.length,
    threads: restrictTo.length,
  };
}

/**
 * Stamp the demo into the work phase it is already in, so the board's elapsed
 * readout has something to count from.
 *
 * Without this the demo was missing a control every participant has: the
 * readout renders only when there IS a phase start (session.ts reads it from
 * events, not from a column), and the demo's phase was set by an UPDATE that
 * logged nothing — so the one header the two arms share was a chip short in
 * every recording, and the frame the films teach would not be the frame of the
 * session.
 *
 * `phase_advance` rather than `work_started`: it is the event a participant
 * has just after they press through into the block and before the task
 * screen's [Start], which is exactly where a demo dropped straight onto the
 * board stands. It also leaves markWorkStarted's guard satisfied, so walking
 * the protocol from /study/session still logs a real [Start] over the top of
 * it instead of being refused.
 *
 * Logged every run, and the readout takes the latest — so a rebuilt demo
 * starts from zero again.
 */
async function startDemoClock(participant: StudyParticipant): Promise<void> {
  await logParticipantEvent(participant.id, 'phase_advance', {
    from: participant.phase,
    to: participant.phase,
    by: 'demo',
  });
}

/**
 * The demo account for a condition, parked in the work phase that opens this
 * dataset's board.
 *
 * The phase gate is left switched on rather than bypassed — a demo that skips
 * it is no longer the participant's path. blockPlan says which block this
 * dataset falls in for this number, and the phase is set to match.
 */
async function ensureDemoParticipant(
  condition: StudioView,
  datasetKey: string
): Promise<StudyParticipant> {
  const number = demoParticipantNumber(condition);
  const participant = await ensureParticipantAccount(number);
  // The family is stamped on the row as well as forced onto the clones below,
  // so everything that reads the participant rather than the clone — which
  // film the session page plays, which board the phase gate expects — agrees
  // with what this demo is actually showing.
  const conditionFamily = familyOf(condition);
  const block =
    blockPlan({ participantNumber: number, conditionFamily }).find(
      (p) => p.datasetKey === datasetKey
    )?.block ?? 1;

  await db
    .update(studyParticipants)
    .set({ isDemo: true, phase: `block${block}_work`, conditionFamily })
    .where(eq(studyParticipants.id, participant.id));

  const [fresh] = await db
    .select()
    .from(studyParticipants)
    .where(eq(studyParticipants.id, participant.id));
  return fresh ?? participant;
}

/** Demo accounts, for the places that must not count them as study data. */
export async function demoParticipantIds(): Promise<string[]> {
  const rows = await db
    .select({ id: studyParticipants.id })
    .from(studyParticipants)
    .where(eq(studyParticipants.isDemo, true));
  return rows.map((r) => r.id);
}

/** Every clone assignment a demo participant holds — used by the phase gate. */
export async function demoAssignmentIds(participant: StudyParticipant): Promise<string[]> {
  const rows = await db
    .select({ assignmentId: studyClones.assignmentId })
    .from(studyClones)
    .where(eq(studyClones.participantId, participant.id));
  return rows.map((r) => r.assignmentId);
}

/** Count of demo rows, for the console's "these are not participants" note. */
export async function demoCount(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(studyParticipants)
    .where(and(eq(studyParticipants.isDemo, true)));
  return row?.n ?? 0;
}
