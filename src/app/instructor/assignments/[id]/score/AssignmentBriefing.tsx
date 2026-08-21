'use client';

/**
 * The briefing: what the students were asked to write, and what the chatbot was
 * told before any of this.
 *
 * The board opens onto hundreds of questions with no statement of what they
 * were questions ABOUT. Everything downstream — whether a rule is too strict,
 * whether a question is off-task, what "the assignment prompt" tag in a pasted
 * message even refers to — is a judgment against a task the instructor is
 * expected to already know, and on this board they have never been shown it.
 * So it opens by itself the first time, and lives behind an info button after
 * that.
 *
 * SHOWN TO BOTH CONDITIONS. Neither half of this is a structuring mechanism:
 * the assignment is a fact about the corpus and the base prompt is the state
 * both arms start editing from. Handing it to one arm would be a difference in
 * what the participant KNOWS about the task rather than in the tool being
 * measured (docs/SCORE_BASELINE_DESIGN.md §0 principle 1).
 *
 * IT ALSO CARRIES THE TASK, for participants only. That used to be a strip
 * across the top of the board, because the 08-18 pilot spent its opening
 * minutes working out what the task even was — time that comes out of the 25
 * and shows up as variance that has nothing to do with the condition. A
 * permanent strip bought that back at the cost of a line of the board forever,
 * so it says it here instead: first section, before the material it is a task
 * about, and one click away from the header for the rest of the block.
 *
 * The rule the strip was written under still holds. The task states the
 * BOUNDARY — what the activity is, where it ends, that there is no set amount —
 * and never the CRITERION: how many conversations to read, how many things to
 * change, what a good rule looks like. How much of the log someone covers is
 * RQ1's primary measure, and a briefing that implied a number would quietly
 * answer the question the block is asking. It is §6.2 verbatim, the same
 * sentences the facilitator says out loud (§6.1) and the same ones the task
 * screen showed a moment ago — a task that arrives in two wordings is two
 * tasks. Byte-identical in both arms.
 *
 * The base prompt is shown VERBATIM, including when it is empty. NIRVANA's
 * chatbot genuinely ran with no system prompt — `import-nirvana` stores `''`
 * on purpose and `assignmentBasePrompt` honors empty-as-empty end to end — and
 * "the chatbot was told nothing" is a fact a participant needs in order to read
 * the log correctly, not a gap to paper over with the app's default coach
 * prompt. The wording matches the assignment page's "How the AI helps" tab so
 * the two places cannot drift into disagreeing about the same field.
 */
import { useCallback, useEffect, useState } from 'react';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { Bot, ClipboardList, FileText, Info, X } from 'lucide-react';
import { instructionToPlainText } from '@/lib/instruction-content';
import TaskGoal from '@/components/study/TaskGoal';

/** Per assignment, not per participant: the two study blocks are two different
 * assignments, so a participant is briefed once at the start of each — which is
 * exactly when the task they are reading against changes. */
const seenKey = (assignmentId: string) => `swag:briefing-seen:${assignmentId}`;

export default function AssignmentBriefing({
  assignmentId,
  assignmentTitle,
  instructions,
  basePrompt,
  includesInstructions,
  showTask = false,
}: {
  assignmentId: string;
  assignmentTitle: string;
  /** Raw `assignments.instructions` — BlockNote JSON in the SWAG datasets,
   * plain text in NIRVANA. `instructionToPlainText` handles both. */
  instructions: string;
  /** `assignmentBasePrompt(assignment)` — may legitimately be empty. */
  basePrompt: string;
  /** Whether that base prompt already embeds the instructions, so the reader
   * knows the repetition below is the real prompt and not a display bug. */
  includesInstructions: boolean;
  /** Participants only. A researcher opening the board is not doing the task,
   * and the section would sit in every screenshot. */
  showTask?: boolean;
}) {
  const [open, setOpen] = useState(false);

  // In an effect, not in the initial state: localStorage does not exist on the
  // server, and seeding state from it would make the first client render
  // disagree with the HTML. The cost is that the dialog arrives a frame late.
  useEffect(() => {
    try {
      if (!window.localStorage.getItem(seenKey(assignmentId))) setOpen(true);
    } catch {
      // Storage blocked (private mode, embedded webview). Not opening is the
      // safe failure — the info button is still there, whereas a briefing that
      // reopened on every navigation would be a modal nobody can get rid of.
    }
  }, [assignmentId]);

  const close = useCallback(() => {
    setOpen(false);
    try {
      window.localStorage.setItem(seenKey(assignmentId), '1');
    } catch {
      /* see above — dismissal simply does not persist */
    }
  }, [assignmentId]);

  const prompt = instructionToPlainText(instructions).trim();
  const base = basePrompt.trim();

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={
          showTask
            ? 'Your task, the assignment these students were given, and the chatbot\u2019s starting prompt'
            : "The assignment these students were given, and the chatbot's starting prompt"
        }
        aria-label={showTask ? 'Your task and this assignment' : 'About this assignment'}
        className="shrink-0 inline-flex items-center gap-1.5 rounded border border-[hsl(var(--border))] px-3 py-2 text-sm font-medium text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
      >
        <Info className="w-4 h-4" />
        {/* Named for what a participant would go looking for. Once the strip
            is gone this button IS the task's address, and "Assignment" is not
            the word anyone reaches for when they have forgotten what they were
            asked to do. */}
        {showTask ? 'Your task' : 'Assignment'}
      </button>

      <Dialog open={open} onClose={close} className="relative z-50">
        <div className="fixed inset-0 bg-black/40" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          {/* max-w-2xl, not 3xl: the prose grew, and at the old width a line
              of it ran past ninety characters, which is the other way to make
              a briefing hard to read. */}
          <DialogPanel className="w-full max-w-2xl h-[80vh] flex flex-col overflow-hidden rounded-lg bg-[hsl(var(--card))] border border-[hsl(var(--border))] shadow-xl">
            <div className="shrink-0 flex items-start justify-between gap-3 px-6 py-4 border-b border-[hsl(var(--border))]">
              <div className="min-w-0">
                <DialogTitle className="text-lg font-semibold">
                  What you&rsquo;re working from
                </DialogTitle>
                <p className="mt-0.5 text-sm text-[hsl(var(--muted-foreground))] truncate">
                  {assignmentTitle}
                </p>
              </div>
              <button
                onClick={close}
                className="shrink-0 p-1 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-6">
              {/* First, because it is the only section that asks for anything.
                  The two below it are the material it is a task about. */}
              {showTask && (
                <section className="space-y-2">
                  <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))] border-b border-[hsl(var(--border))] pb-2">
                    <ClipboardList className="w-4 h-4" />
                    Your task in this round
                  </h3>
                  <p className="text-base leading-relaxed text-[hsl(var(--foreground))]">
                    <TaskGoal>Look through the conversations</TaskGoal> students in this course
                    had with the chatbot. Whenever a chatbot response is not what you would
                    want, <TaskGoal>adjust the setup so that it responds the way you want.</TaskGoal>
                    {' '}When you feel it&apos;s ready, <TaskGoal>deploy it.</TaskGoal>
                  </p>
                  <p className="text-base leading-relaxed text-[hsl(var(--foreground))]">
                    There is no set amount to cover — how much you look at, and how much you
                    change, is <TaskGoal>entirely up to you.</TaskGoal>
                  </p>
                </section>
              )}

              <section className="space-y-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))] border-b border-[hsl(var(--border))] pb-2">
                  <FileText className="w-4 h-4" />
                  The assignment students were given
                </h3>
                {prompt ? (
                  <p className="whitespace-pre-wrap text-base leading-relaxed text-[hsl(var(--foreground))]">
                    {prompt}
                  </p>
                ) : (
                  <p className="text-base italic text-[hsl(var(--muted-foreground))]">
                    This assignment has no written prompt.
                  </p>
                )}
              </section>

              <section className="space-y-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))] border-b border-[hsl(var(--border))] pb-2">
                  <Bot className="w-4 h-4" />
                  The chatbot&rsquo;s starting prompt
                </h3>
                <div className="rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 p-4">
                  {base ? (
                    <>
                      <p className="whitespace-pre-wrap text-base leading-relaxed text-[hsl(var(--foreground))]">
                        {base}
                      </p>
                      <p className="mt-3 text-sm text-[hsl(var(--muted-foreground))]">
                        {includesInstructions
                          ? 'The assignment above is part of this prompt, so the chatbot received it too.'
                          : 'The chatbot was given only this — not the assignment above.'}
                      </p>
                    </>
                  ) : (
                    // The honest empty case, in the assignment page's words.
                    <p className="text-base italic text-[hsl(var(--muted-foreground))]">
                      No system prompt — the chatbot ran without any default guidance.
                    </p>
                  )}
                </div>
                <p className="text-sm text-[hsl(var(--muted-foreground))]">
                  This is what answered every question in the log. What you write
                  from here replaces it for the questions you write it for.
                </p>
              </section>
            </div>

            <div className="shrink-0 flex items-center justify-between gap-3 px-6 py-4 border-t border-[hsl(var(--border))]">
              {/* Names the button it is actually talking about, which is now
                  the participant's way back to the task. */}
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                Reopen this any time from{' '}
                <span className="font-medium">{showTask ? 'Your task' : 'Assignment'}</span> in the
                header.
              </p>
              <button
                onClick={close}
                className="shrink-0 rounded bg-[hsl(var(--primary))] px-5 py-2.5 text-sm font-semibold text-[hsl(var(--primary-foreground))] hover:opacity-90"
              >
                Start
              </button>
            </div>
          </DialogPanel>
        </div>
      </Dialog>
    </>
  );
}
