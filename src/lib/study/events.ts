/**
 * Behavioral study-event logging (both conditions) — the source of process
 * metrics. Never throws into callers; a study clone always has study_events
 * (ensureStudyTables), and for non-study assignments the insert simply no-ops.
 */
import { db } from '@/db/db';
import { studyEvents } from '@/db/schema';

export async function logStudyEvent(
  assignmentId: string,
  eventType: string,
  payload?: Record<string, unknown>
): Promise<void> {
  try {
    await db.insert(studyEvents).values({ assignmentId, eventType, payload: payload ?? null, createdAt: new Date() });
  } catch {
    /* instrumentation must never break the action */
  }
}

/**
 * A participant-scoped event (phase transitions, session lifecycle). These have
 * no single assignment — break, A/B and done span both clones — which is why
 * study_events.assignment_id is nullable.
 */
export async function logParticipantEvent(
  participantId: string,
  eventType: string,
  payload?: Record<string, unknown>
): Promise<void> {
  try {
    await db.insert(studyEvents).values({
      participantId,
      assignmentId: null,
      eventType,
      payload: payload ?? null,
      createdAt: new Date(),
    });
  } catch {
    /* instrumentation must never break the action */
  }
}
