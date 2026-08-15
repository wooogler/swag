import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db/db';
import { studyClones } from '@/db/schema';
import { getCurrentStudyParticipant } from '@/lib/study/session';
import { ensureStudyTables } from '@/lib/study/store';
import { cloneForBlock, getTestItems } from '@/lib/study/measure-store';
import { isStudyPhase, phaseAccess, type StudyPhase } from '@/lib/study/phases';
import TutorialStep from '@/components/study/TutorialStep';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Chatbot Studio' };

/**
 * The participant's home during a session.
 *
 * Shows exactly ONE thing: whatever the current phase permits. A participant
 * cannot wander into the next block's workspace (which would let the second
 * condition's material be seen before its walkthrough) or back into a finished
 * block (which would change a configuration the measurements have already been
 * frozen against) — the phase decides, and the only move offered is the next
 * one, which they make themselves. The console watches; it does not drive.
 *
 * Nothing here names the conditions: a participant sees "your chatbot", never
 * SCORE or baseline.
 */
export default async function StudySessionPage() {
  await ensureStudyTables();
  const participant = await getCurrentStudyParticipant();
  if (!participant) redirect('/study');

  const phase: StudyPhase = isStudyPhase(participant.phase) ? participant.phase : 'not_started';
  const access = phaseAccess(participant, phase);

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

  // How far into the block test they are, so a participant who came back on
  // their link is told they are resuming rather than being offered "Start" for
  // work they have already half done.
  let testProgress: { predicted: number; rated: number; total: number } | null = null;
  if (access.testBlock) {
    const clone = await cloneForBlock(participant, access.testBlock);
    if (clone) {
      const items = await getTestItems(participant, clone);
      testProgress = {
        predicted: items.filter((i) => i.guess !== null && i.pointing !== null).length,
        rated: items.filter((i) => i.rating !== null).length,
        total: items.length,
      };
    }
  }

  // The walkthrough steps carry a video, so they get room the one-line cards
  // do not need.
  const isTutorial = phase === 'not_started' || phase === 'break';

  return (
    <div className="min-h-screen flex items-center justify-center bg-[hsl(var(--background))] px-6 py-12">
      <div className={`w-full ${isTutorial ? 'max-w-2xl' : 'max-w-lg'}`}>
        <div className="mb-6 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
            Participant {participant.participantNumber}
          </p>
        </div>

        {phase === 'not_started' ? (
          <TutorialStep
            title="Before you start"
            body="Your facilitator will show you the tool you will use for the first part."
            fromPhase={phase}
            buttonLabel="Start"
          />
        ) : phase === 'break' ? (
          <TutorialStep
            title="Second part"
            body="Take a moment first. The second chatbot is set up with a different tool, and your facilitator will show you that one."
            fromPhase={phase}
            buttonLabel="I'm ready"
          />
        ) : (
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
                  {testProgress && testProgress.predicted > 0
                    ? testProgress.predicted < testProgress.total
                      ? `You have said what you expect for ${testProgress.predicted} of ${testProgress.total} questions. Pick up where you left off.`
                      : `You have seen ${testProgress.rated} of ${testProgress.total} answers. Pick up where you left off.`
                    : 'A few new student questions. For each one you will say whether you expect your chatbot to answer the way you intend, then see what it actually says.'}
                </p>
                <a
                  href="/study/session/test"
                  className="inline-flex items-center justify-center rounded-lg bg-[hsl(var(--primary))] px-5 py-2.5 text-sm font-semibold text-white"
                >
                  {testProgress && testProgress.predicted > 0 ? 'Continue' : 'Start'}
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
            ) : access.isDone ? (
              <>
                <h1 className="text-lg font-semibold mb-2">All done — thank you</h1>
                <p className="text-sm text-[hsl(var(--muted-foreground))] leading-relaxed">
                  That is the end of the session. Your facilitator will take it from here.
                </p>
              </>
            ) : (
              // Only reachable when a work phase has no clone behind it — the
              // participant has nothing to do here and cannot fix it.
              <>
                <h1 className="text-lg font-semibold mb-2">One moment</h1>
                <p className="text-sm text-[hsl(var(--muted-foreground))] leading-relaxed">
                  This step is not ready on our side. Let your facilitator know.
                </p>
              </>
            )}
          </div>
        )}

        <p className="mt-6 text-center text-[11px] text-[hsl(var(--muted-foreground))]">
          Go at your own pace — your facilitator is watching along and can help at any point.
        </p>
      </div>
    </div>
  );
}
