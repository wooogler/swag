import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db/db';
import { studyClones } from '@/db/schema';
import { getCurrentStudyParticipant } from '@/lib/study/session';
import { ensureStudyTables } from '@/lib/study/store';
import { cloneForBlock, getTestItems } from '@/lib/study/measure-store';
import { blockPlan, isStudyPhase, phaseAccess, type StudyPhase } from '@/lib/study/phases';
import { demoSegmentsFor } from '@/lib/study/config';
import { displayParticipantNumber } from '@/lib/study/demo';
import TutorialStep from '@/components/study/TutorialStep';
import RecordingCheck from '@/components/study/RecordingCheck';
import { equipmentCheckPassed } from '@/lib/study/recording-store';

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

  /* A work phase has no screen of its own any more.
   *
   * There used to be a task card here — the task, then [Start], then the
   * board. Its whole job was to say what the activity was before the clock
   * started, and the board's briefing modal now says the same sentences
   * (AssignmentBriefing, showTask) in front of the material they are about.
   * Two screens carrying one paragraph is two chances for them to drift apart,
   * and the second one arrives after the participant has already read it.
   *
   * So the phase IS the board. The clock is stamped from the briefing's Start
   * button, which is where the old [Start] went (design §10.3).
   *
   * `redirect` throws, so nothing below runs for a work phase; the fallback
   * card at the bottom is what a work phase with no clone still lands on,
   * which is the one case a participant cannot fix themselves. */
  if (workAssignmentId) redirect(`/studio/${workAssignmentId}`);

  // How far into the block test they are, so a participant who came back on
  // their link is told they are resuming rather than being offered "Start" for
  // work they have already half done.
  let testProgress: { predicted: number; rated: number; total: number } | null = null;
  if (access.testBlock) {
    const clone = await cloneForBlock(participant, access.testBlock);
    if (clone) {
      const items = await getTestItems(participant, clone);
      testProgress = {
        predicted: items.filter((i) => i.expectDesirable !== null && i.pointing !== null).length,
        rated: items.filter((i) => i.desirable !== null && i.follows !== null).length,
        total: items.length,
      };
    }
  }

  // Whether they have already proved the recording pipeline once. Read from
  // the stored runs rather than from anything in the browser: the fix for a
  // denied capture on macOS is to quit the browser and come back, so a check
  // remembered client-side is forgotten by exactly the participant who needed
  // it. Only asked at the step that shows the check.
  const checkPassed = phase === 'not_started' ? await equipmentCheckPassed(participant.id) : false;
  // Their own way back in, for the failure that tells them to quit the browser.
  const accessUrl = participant.accessToken
    ? `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3030'}/study/s/${participant.accessToken}`
    : null;

  // The walkthrough steps carry a video, so they get room the one-line cards
  // do not need.
  const isTutorial = phase === 'not_started' || phase === 'break';
  // Which version the upcoming block runs, so the walkthrough plays that one's
  // segment. Read from the assigned cell rather than from the phase: at these
  // two moments no board is open yet, which is the whole point of the step.
  const plan = blockPlan(participant);
  const conditionForBlock = (block: 1 | 2) =>
    plan.find((b) => b.block === block)?.condition ?? 'score';

  return (
    <div className="min-h-screen flex items-center justify-center bg-[hsl(var(--background))] px-6 py-12">
      <div className={`w-full ${isTutorial ? 'max-w-2xl' : 'max-w-lg'}`}>
        <div className="mb-6 text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
            Participant {displayParticipantNumber(participant)}
          </p>
        </div>

        {phase === 'not_started' ? (
          /* The equipment check goes in FRONT of the walkthrough rather than
             into a phase of its own. Every member of STUDY_PHASES is stamped
             on participant rows and on every phase_advance payload the pilot
             left behind, and `not_started` is additionally the column default
             and the "this cell can still be reassigned" sentinel — so a new
             phase costs a migration's worth of risk to buy a gate a wrapper
             already gives. Keeping the check inside `not_started` also keeps
             the cell reassignable while people are still wrestling with system
             settings, which is exactly when a researcher might want it. */
          <RecordingCheck passed={checkPassed} accessUrl={accessUrl}>
            <TutorialStep
              /* Says who they are about to be before it says what to watch.
                 The task itself is stated later, on the board's briefing, in
                 the §6.2 sentences the facilitator also reads aloud — nothing
                 here may add to them, so this only names the standing
                 situation. */
              title="Before you start"
              body="You are about to set up the chatbot that students wrote with in a real course. First, a short walkthrough of the version you will be using. Watch it through to the end — if anything is unclear, ask on the Zoom call before you go on."
              segments={demoSegmentsFor(1, conditionForBlock(1))}
              fromPhase={phase}
              buttonLabel="Start"
            />
          </RecordingCheck>
        ) : phase === 'break' ? (
          <TutorialStep
            title="Second part"
            body="Another course, another group of students, and a different version of the tool. Here is a walkthrough of that one — watch it through to the end."
            segments={demoSegmentsFor(2, conditionForBlock(2))}
            fromPhase={phase}
            buttonLabel="I'm ready"
          />
        ) : (
          <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-8 text-center">
            {access.testBlock ? (
              <>
                <h1 className="text-xl font-semibold mb-2">Check your chatbot</h1>
                <p className="text-base text-[hsl(var(--muted-foreground))] mb-6 leading-relaxed">
                  {testProgress && testProgress.predicted > 0
                    ? testProgress.predicted < testProgress.total
                      ? `You have said what you expect for ${testProgress.predicted} of ${testProgress.total} questions. Pick up where you left off.`
                      : `You have seen ${testProgress.rated} of ${testProgress.total} answers. Pick up where you left off.`
                    : 'A few new student questions. For each one you will say whether you expect your chatbot to answer the way you intend, then see what it actually says.'}
                </p>
                <a
                  href="/study/session/test"
                  className="inline-flex items-center justify-center rounded-lg bg-[hsl(var(--primary))] px-6 py-3 text-base font-semibold text-white"
                >
                  {testProgress && testProgress.predicted > 0 ? 'Continue' : 'Start'}
                </a>
              </>
            ) : access.showSurvey ? (
              <>
                <h1 className="text-xl font-semibold mb-2">A few quick questions</h1>
                <p className="text-base text-[hsl(var(--muted-foreground))] mb-6 leading-relaxed">
                  Five short questions about setting up the chatbot, before we check what it
                  answers.
                </p>
                <a
                  href="/study/session/survey"
                  className="inline-flex items-center justify-center rounded-lg bg-[hsl(var(--primary))] px-6 py-3 text-base font-semibold text-white"
                >
                  Start
                </a>
              </>
            ) : access.showFinal ? (
              <>
                <h1 className="text-xl font-semibold mb-2">One last questionnaire</h1>
                <p className="text-base text-[hsl(var(--muted-foreground))] mb-6 leading-relaxed">
                  Both rounds are done. This last one asks you to rate the two versions side by
                  side — about eight minutes.
                </p>
                <a
                  href="/study/session/final"
                  className="inline-flex items-center justify-center rounded-lg bg-[hsl(var(--primary))] px-6 py-3 text-base font-semibold text-white"
                >
                  Start
                </a>
              </>
            ) : access.isDone ? (
              <>
                <h1 className="text-xl font-semibold mb-2">All done — thank you</h1>
                <p className="text-base text-[hsl(var(--muted-foreground))] leading-relaxed">
                  That is the end of the session. Let the researcher know on the Zoom call.
                </p>
              </>
            ) : (
              // Only reachable when a work phase has no clone behind it — the
              // participant has nothing to do here and cannot fix it.
              <>
                <h1 className="text-xl font-semibold mb-2">One moment</h1>
                <p className="text-base text-[hsl(var(--muted-foreground))] leading-relaxed">
                  This step is not ready on our side. Message the researcher on the Zoom call.
                </p>
              </>
            )}
          </div>
        )}

        <p className="mt-6 text-center text-xs text-[hsl(var(--muted-foreground))]">
          Go at your own pace. If anything goes wrong, message the researcher on the Zoom call.
        </p>
      </div>
    </div>
  );
}
