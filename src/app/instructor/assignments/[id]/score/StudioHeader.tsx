/**
 * The one header both versions of the board wear.
 *
 * It exists as its own file because there are now two boards under this route
 * — the full one and the simple one — and the header is not where they differ.
 * A participant should be able to tell which version they are in from the
 * name chip and from what the screen below can do, not from the frame around
 * it; two copies of this would have drifted by the second edit.
 *
 * What varies is passed in as slots: whichever publish control this version
 * has, and the "I'm done" button when there is something to measure. Every
 * other decision here — no back arrow for a participant, the participant
 * number in place of the account address, no account controls — is the same in
 * every version, because they are all about the session rather than the tools.
 */
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import InstructorHeaderActions from '@/components/instructor/InstructorHeaderActions';
import WorkElapsed from '@/components/study/WorkElapsed';
import RecordingChip from '@/components/study/RecordingChip';
import AssignmentBriefing from './AssignmentBriefing';
import { STUDY_WORK_MINUTES, STUDY_WORK_WARNING_MINUTES } from '@/lib/study/config';

export default function StudioHeader({
  assignmentId,
  assignmentTitle,
  versionName,
  instructions,
  basePrompt,
  includesInstructions,
  showTask,
  stampWorkStart = false,
  record = false,
  backHref,
  phaseStartedAt,
  accountLabel,
  showAccountControls,
  publish,
  blockDone,
}: {
  assignmentId: string;
  assignmentTitle: string;
  /** The participant-facing code name for this condition (Slate / Clay). */
  versionName: string;
  instructions: string;
  basePrompt: string;
  includesInstructions: boolean;
  showTask: boolean;
  /** Whether the briefing's Start begins this block's clock — participants in
   * a configure phase only. */
  stampWorkStart?: boolean;
  /** Whether this session actually captures the screen — a demo is on the
   * clock but is never recorded (see AssignmentBriefing). */
  record?: boolean;
  /** Null for a participant: see the note where the caller computes it. */
  backHref: string | null;
  phaseStartedAt: string | null;
  accountLabel: string;
  showAccountControls: boolean;
  publish: React.ReactNode;
  blockDone: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-4">
      {/* Absent for a participant — see the caller. Identical to look at for
          everyone who does get one, so the frame is unchanged. */}
      {backHref && (
        <Link href={backHref}>
          <Button variant="ghost" size="icon" className="hover:bg-[hsl(var(--muted))]">
            <ChevronLeft className="w-5 h-5 text-[hsl(var(--muted-foreground))]" />
          </Button>
        </Link>
      )}
      {/* The version's name, and under it the course. Design §3.1 puts the name
          here and only here on the board — it is what the final survey's two
          columns are labelled with, and a participant who never saw it cannot
          tell those columns apart forty minutes later.

          The two descriptive straplines that used to sit under this
          ("Organize · Revise · Evaluate — instructor intents own the log" /
          "Customize the chatbot from real student questions") are gone. They
          differed by condition in a header that is supposed to be the same
          shell either way, and the SCORE one said "intents" — a word §13
          invariant 2 keeps off the Clay surface, which meant the header was
          also teaching each arm a different vocabulary for what it was doing.
          The course title takes the line instead: same shape in both arms, and
          it is the thing a participant actually needs, since the two blocks are
          two different courses. */}
      <div className="flex-1">
        <h1 className="text-xl font-bold font-heading text-[hsl(var(--foreground))]">
          Chatbot Studio · <span className="font-normal">{versionName}</span>
        </h1>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">{assignmentTitle}</p>
      </div>
      {/* What the log is OF, and — for a participant — what they are being
          asked to do with it. Opens by itself on a first visit and sits behind
          this button after that. Every condition gets all of it: neither the
          assignment, nor the prompt the chatbot started from, nor the task is
          part of the mechanism under test. */}
      <AssignmentBriefing
        assignmentId={assignmentId}
        assignmentTitle={assignmentTitle}
        instructions={instructions}
        basePrompt={basePrompt}
        includesInstructions={includesInstructions}
        showTask={showTask}
        stampWorkStart={stampWorkStart}
        record={record}
      />
      {phaseStartedAt && (
        <WorkElapsed
          startedAt={phaseStartedAt}
          budgetMinutes={STUDY_WORK_MINUTES}
          warnMinutes={STUDY_WORK_WARNING_MINUTES}
        />
      )}
      {/* Beside the clock. Gated on `record`, not on the clock: a demo is on
          the clock and is deliberately not recorded, and a chip offering to
          resume a recording that was never meant to run would be in every
          frame of the films. */}
      {record && <RecordingChip />}
      {publish}
      {/* Finishing the block sits next to whatever publishes, because
          publishing is what makes it possible: it appears the moment there is
          a version to be measured, and every publish path router.refresh()es
          so it arrives on its own. */}
      {blockDone}
      {/* Settings carries Delete account, which would remove the row that IS
          this participant. Off for them, along with log out — no other study
          screen has either.

          And a participant is shown their PARTICIPANT NUMBER, not the address
          of the account behind it: study accounts live at @study.score.local,
          which would have sat in the header naming the treatment for the whole
          block. The number is also the thing a facilitator actually reads off
          a shared screen. */}
      <InstructorHeaderActions email={accountLabel} showAccountControls={showAccountControls} />
    </div>
  );
}
