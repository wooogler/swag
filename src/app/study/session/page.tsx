import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db/db';
import { studyClones } from '@/db/schema';
import { getCurrentStudyParticipant } from '@/lib/study/session';
import { ensureStudyTables } from '@/lib/study/store';
import { cloneForBlock, getTestItems } from '@/lib/study/measure-store';
import { blockPlan, isStudyPhase, phaseAccess, type StudyPhase } from '@/lib/study/phases';
import { demoSegmentsFor } from '@/lib/study/config';
import TutorialStep from '@/components/study/TutorialStep';
import WorkStart from '@/components/study/WorkStart';

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
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
            Participant {participant.participantNumber}
          </p>
        </div>

        {phase === 'not_started' ? (
          <TutorialStep
            title="Before you start"
            body="A short walkthrough of what you will be using. Watch it through — your facilitator will take questions after."
            segments={demoSegmentsFor(1, conditionForBlock(1))}
            fromPhase={phase}
            buttonLabel="Start"
          />
        ) : phase === 'break' ? (
          <TutorialStep
            title="Second part"
            body="Take a moment first. The second chatbot is set up with a different version of the tool — here is a walkthrough of that one."
            segments={demoSegmentsFor(2, conditionForBlock(2))}
            fromPhase={phase}
            buttonLabel="I'm ready"
          />
        ) : (
          <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-8 text-center">
            {workAssignmentId ? (
              <>
                {/* Design §6.2, verbatim, and verbatim for a reason: the
                    facilitator says these same sentences out loud (§6.1), and
                    a task that arrives in two wordings is two tasks. Both
                    conditions get the identical string — this is shell parity,
                    so no example or hint may be added for either arm.

                    What it may say is the BOUNDARY (what the activity is,
                    where it ends, that there is no set amount) and never the
                    CRITERION (how many to read, how many to change, what a
                    good rule looks like). How much of the log someone covers
                    is RQ1's primary measure; a screen that suggests a number
                    deletes that measurement.

                    Left-aligned below the heading: three sentences of task
                    definition centred are harder to read, and this is the one
                    screen whose whole purpose is that they are read. */}
                <h1 className="text-lg font-semibold mb-3">Your task in this round</h1>
                <div className="text-left mx-auto max-w-md">
                  <p className="text-sm text-[hsl(var(--muted-foreground))] mb-3 leading-relaxed">
                    Look through the conversations students in this course had with the
                    chatbot. Whenever a chatbot response is not what you would want, adjust
                    the setup so that it responds the way you want. When you feel it&apos;s
                    ready, deploy it.
                  </p>
                  <p className="text-sm text-[hsl(var(--muted-foreground))] mb-6 leading-relaxed">
                    There is no set amount to cover — how much you look at, and how much you
                    change, is entirely up to you.
                  </p>
                </div>
                {/* Not a link: pressing this is when the 25 minutes start, so
                    it stamps the clock before opening the board (§6.2 — the
                    task screen sits BEFORE the timer). The budget itself is no
                    longer stated here; the facilitator gives it out loud and
                    the board's elapsed readout carries the "/ 25", so it is
                    still known before it is spent — which was the point. */}
                <WorkStart href={`/instructor/assignments/${workAssignmentId}/score`} />
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
                <h1 className="text-lg font-semibold mb-2">A few quick questions</h1>
                <p className="text-sm text-[hsl(var(--muted-foreground))] mb-6 leading-relaxed">
                  Five short questions about setting up the chatbot, before we check what it
                  answers.
                </p>
                <a
                  href="/study/session/survey"
                  className="inline-flex items-center justify-center rounded-lg bg-[hsl(var(--primary))] px-5 py-2.5 text-sm font-semibold text-white"
                >
                  Start
                </a>
              </>
            ) : access.showFinal ? (
              <>
                <h1 className="text-lg font-semibold mb-2">One last questionnaire</h1>
                <p className="text-sm text-[hsl(var(--muted-foreground))] mb-6 leading-relaxed">
                  Both rounds are done. This last one asks you to rate the two versions side by
                  side — about five minutes.
                </p>
                <a
                  href="/study/session/final"
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
