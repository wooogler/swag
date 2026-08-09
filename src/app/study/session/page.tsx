import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db/db';
import { studyClones } from '@/db/schema';
import { getCurrentStudyParticipant } from '@/lib/study/session';
import { ensureStudyTables } from '@/lib/study/store';
import { isStudyPhase, phaseAccess, type StudyPhase } from '@/lib/study/phases';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Chatbot Studio' };

/**
 * The participant's home during a session.
 *
 * Shows exactly ONE thing: whatever the current phase permits. The facilitator
 * moves the phase from the console, so a participant cannot wander into the
 * next block's workspace (which would let the second condition's material be
 * seen before its tutorial) or back into a finished block (which would change
 * a configuration the measurements have already been frozen against).
 *
 * Nothing here names the conditions: a participant sees "your chatbot", never
 * SCORE or baseline.
 */
export default async function StudySessionPage() {
  await ensureStudyTables();
  const participant = await getCurrentStudyParticipant();
  if (!participant) redirect('/study');

  const phase: StudyPhase = isStudyPhase(participant.phase) ? participant.phase : 'not_started';
  const access = phaseAccess(participant.participantNumber, phase);

  let workAssignmentId: string | null = null;
  if (access.workDatasetKey) {
    const [clone] = await db
      .select({ assignmentId: studyClones.assignmentId })
      .from(studyClones)
      .where(
        and(
          eq(studyClones.participantId, participant.id),
          eq(studyClones.datasetKey, access.workDatasetKey)
        )
      );
    workAssignmentId = clone?.assignmentId ?? null;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[hsl(var(--background))] px-6 py-12">
      <div className="w-full max-w-lg">
        <div className="mb-6 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
            Participant {participant.participantNumber}
          </p>
        </div>

        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-8 text-center">
          {workAssignmentId ? (
            <>
              <h1 className="text-lg font-semibold mb-2">Set up your chatbot</h1>
              <p className="text-sm text-[hsl(var(--muted-foreground))] mb-6 leading-relaxed">
                Read through the conversations students had with the chatbot. Wherever a
                reply is not what you would want, change the setup so it answers the way
                you intend. Deploy when you are satisfied.
              </p>
              <a
                href={`/instructor/assignments/${workAssignmentId}/score`}
                className="inline-flex items-center justify-center rounded-lg bg-[hsl(var(--primary))] px-5 py-2.5 text-sm font-semibold text-white"
              >
                Open Chatbot Studio
              </a>
            </>
          ) : access.testBlock ? (
            <>
              <h1 className="text-lg font-semibold mb-2">Check your chatbot</h1>
              <p className="text-sm text-[hsl(var(--muted-foreground))] mb-6 leading-relaxed">
                A few new student questions. For each one you will say whether you expect
                your chatbot to answer the way you intend, then see what it actually says.
              </p>
              <a
                href="/study/session/test"
                className="inline-flex items-center justify-center rounded-lg bg-[hsl(var(--primary))] px-5 py-2.5 text-sm font-semibold text-white"
              >
                Start
              </a>
            </>
          ) : access.showSurvey ? (
            <>
              <h1 className="text-lg font-semibold mb-2">A few questions</h1>
              <p className="text-sm text-[hsl(var(--muted-foreground))] mb-6 leading-relaxed">
                A short questionnaire about the setup you just did.
              </p>
              <a
                href="/study/session/survey"
                className="inline-flex items-center justify-center rounded-lg bg-[hsl(var(--primary))] px-5 py-2.5 text-sm font-semibold text-white"
              >
                Start
              </a>
            </>
          ) : access.showAb ? (
            <>
              <h1 className="text-lg font-semibold mb-2">Comparing the two chatbots</h1>
              <p className="text-sm text-[hsl(var(--muted-foreground))] mb-6 leading-relaxed">
                Last step: the two chatbots you built today answer the same questions side
                by side, and you pick the answer you would want.
              </p>
              <a
                href="/study/session/ab"
                className="inline-flex items-center justify-center rounded-lg bg-[hsl(var(--primary))] px-5 py-2.5 text-sm font-semibold text-white"
              >
                Start
              </a>
            </>
          ) : access.isBreak ? (
            <>
              <h1 className="text-lg font-semibold mb-2">Take a short break</h1>
              <p className="text-sm text-[hsl(var(--muted-foreground))] leading-relaxed">
                We will pick up with the second version in a few minutes.
              </p>
            </>
          ) : access.isDone ? (
            <>
              <h1 className="text-lg font-semibold mb-2">All done — thank you</h1>
              <p className="text-sm text-[hsl(var(--muted-foreground))] leading-relaxed">
                That is the end of the session. Your facilitator will take it from here.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-lg font-semibold mb-2">Ready when you are</h1>
              <p className="text-sm text-[hsl(var(--muted-foreground))] leading-relaxed">
                Your facilitator will start the session in a moment. You can leave this
                page open.
              </p>
            </>
          )}
        </div>

        <p className="mt-6 text-center text-[11px] text-[hsl(var(--muted-foreground))]">
          This page follows along with the session — it will update when your facilitator
          moves to the next step.
        </p>
      </div>
    </div>
  );
}
