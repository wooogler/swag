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
import { Bot, ClipboardList, FileText, Info, Loader2, Video, X } from 'lucide-react';
import { instructionToPlainText } from '@/lib/instruction-content';
import TaskGoal from '@/components/study/TaskGoal';
import SharePickerHint from '@/components/study/SharePickerHint';
import {
  recorderActive,
  recordingSupported,
  reportRecordingEvent,
  requestScreen,
  startRecording,
  surfaceOf,
  surfaceOk,
} from '@/lib/study/recorder';

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
  stampWorkStart = false,
  record = false,
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
  /**
   * Whether pressing Start here is the moment the block's clock begins.
   *
   * It is, for a participant in a configure phase, because this dialog is now
   * where the task is read. The task screen that used to carry [[Start]] is
   * gone — it said the same sentences this dialog says, one screen earlier —
   * so the stamp it owned moves here with it (design §10.3).
   *
   * Charging the reading of the task to the budget the reading exists to
   * inform is backwards, and under parallel breakout rooms it is also
   * load-dependent: the phase advance happens on the walkthrough card, and
   * everything between it and this dialog is a redirect and a board render
   * that gets slower the more participants are working at once. Left as the
   * zero, that would quietly subtract minutes from whoever the server was
   * busiest for.
   */
  stampWorkStart?: boolean;
  /**
   * Whether pressing Start also takes the screen.
   *
   * Separate from `stampWorkStart`, which it otherwise tracks exactly, because
   * of the demo. A demo IS a participant — same account, same phase, same
   * board, deliberately no branch anywhere (demo.ts) — so it is on the clock
   * and stamps like one. But it exists to be filmed, and a demo that also
   * recorded would upload the researcher's own screen into the participants'
   * recording table on every take.
   *
   * The dialog keeps the participant's SHAPE either way — Start is still the
   * only way out — because what the films teach has to be the frame the session
   * actually has.
   */
  record?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [arming, setArming] = useState(false);
  const [armError, setArmError] = useState<string | null>(null);

  // In an effect, not in the initial state: localStorage does not exist on the
  // server, and seeding state from it would make the first client render
  // disagree with the HTML. The cost is that the dialog arrives a frame late.
  useEffect(() => {
    // For a participant in a configure block this dialog is the arming step,
    // so what decides whether it opens is whether this DOCUMENT is recording,
    // not whether the briefing has been read before: a mid-block reload has
    // the "seen" key set and no recorder, and left to localStorage it would
    // sail past the dialog and record nothing for the rest of the block. With
    // no recorder to arm — the demo — the key is the right test again.
    if (stampWorkStart && record) {
      if (!recorderActive()) setOpen(true);
      return;
    }
    try {
      if (!window.localStorage.getItem(seenKey(assignmentId))) setOpen(true);
    } catch {
      // Storage blocked (private mode, embedded webview). Which way to fail
      // depends on who is looking. For a researcher, not opening is safe — the
      // info button is still there, and a briefing that reopened on every
      // navigation would be a modal nobody can get rid of. For a participant
      // it is not: this dialog is the only place the task is written down
      // since the task screen was deleted, and a participant who never sees it
      // is doing an unstated task, which is the 08-18 pilot's failure and the
      // thing §5.2 exists to prevent. So they get it, once per page load,
      // dismissable as always.
      if (showTask) setOpen(true);
    }
  }, [assignmentId, record, showTask, stampWorkStart]);

  const close = useCallback(() => {
    setOpen(false);
    try {
      window.localStorage.setItem(seenKey(assignmentId), '1');
    } catch {
      /* see above — dismissal simply does not persist */
    }
    if (!stampWorkStart) return;
    // Not awaited, and nothing waits on it: the board is already open behind
    // this dialog, so there is nothing to hold back. The server refuses the
    // stamp outside a work phase and ignores a second one (markWorkStarted),
    // which is what makes a reopened briefing harmless.
    void fetch('/api/study/session/work-start', { method: 'POST' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        // The elapsed readout in the header is a sibling from the server
        // render, so it is still counting from the phase advance. Same bridge
        // the simple board already uses for the same reason — without it the
        // participant's number and the console's would disagree by however
        // long this dialog was open.
        if (data?.startedAt) {
          window.dispatchEvent(
            new CustomEvent('study:work-started', { detail: { startedAt: data.startedAt } })
          );
        }
      })
      .catch(() => {
        /* The clock falls back to the phase advance, which is the old
           behaviour and off by the reading of this dialog. Not worth putting
           an error in front of someone about to start a timed block. */
      });
  }, [assignmentId, stampWorkStart]);

  /**
   * Start, for a participant on the clock: take the screen, then close.
   *
   * `requestScreen` runs FIRST and with nothing awaited in front of it. The
   * click carries about five seconds of transient activation and the display
   * picker consumes it, so a network round trip in front — the clock stamp, for
   * instance — would spend the gesture on a loaded server and fail as
   * `InvalidStateError`, which reads like a bug rather than like a permission.
   *
   * A refusal leaves the dialog open with the reason and a second try. It never
   * traps: `Continue without recording` appears after the first failure,
   * because a lost recording costs the study less than a lost participant does.
   */
  const closeViaStart = useCallback(async () => {
    if (!stampWorkStart) return close();
    // The demo lands here: participant shape, no capture.
    if (!record) return close();
    if (!recordingSupported()) {
      void reportRecordingEvent('unsupported_browser');
      setArmError('This browser cannot record the screen. Tell the researcher on the Zoom call.');
      return;
    }
    setArming(true);
    setArmError(null);
    try {
      const stream = await requestScreen();
      const surface = surfaceOf(stream);
      if (!surfaceOk(surface)) {
        stream.getTracks().forEach((t) => t.stop());
        void reportRecordingEvent('wrong_surface');
        setArmError(
          'That shared a single tab rather than the window. Press Start again and choose Window — the one showing this page.'
        );
        return;
      }
      await startRecording({ stream });
      close();
    } catch {
      void reportRecordingEvent('permission_denied');
      setArmError(
        'The window was not shared. Press Start again and choose the window showing this page — the recording is how we see what you did.'
      );
    } finally {
      setArming(false);
    }
  }, [close, record, stampWorkStart]);

  const skipRecording = useCallback(() => {
    void reportRecordingEvent('check_skipped', { where: 'block_start' });
    close();
  }, [close]);

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

      {/* For a participant on the clock, Esc and the backdrop do NOT close this.
          Not to trap them — Start and the skip below are both right there —
          but because the display picker needs a real click to authorise it,
          and HeadlessUI's onClose cannot tell a backdrop click from a keypress.
          A dialog that could be dismissed without arming would leave someone
          working, unrecorded, with nothing on screen saying so. */}
      <Dialog
        open={open}
        onClose={stampWorkStart ? () => {} : close}
        className="relative z-50"
      >
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
              {!stampWorkStart && (
                <button
                  onClick={close}
                  className="shrink-0 p-1 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-6">
              {/* Who the participant is in this, said once, ABOVE the task and
                  never inside it.

                  The four task sentences below are §6.2 verbatim because the
                  facilitator reads the same ones out loud (§6.1), and how much
                  of the log someone covers versus changes is RQ1's primary
                  measure — so nothing on this screen may lean on effort. This
                  lede therefore states only the standing situation (whose
                  chatbot, answering whom, and what a setup is for) and asks
                  for nothing: no amount, no standard, no encouragement.

                  It is the same sentence the walkthrough video opens on, so
                  the two layers arrive in one voice rather than two. Byte
                  identical in both arms, like the rest of the shell, and shown
                  only where there is a task — outside the study this modal is
                  an instructor reading their own course, and none of it
                  applies. */}
              {showTask && (
                <p className="text-base leading-relaxed text-[hsl(var(--muted-foreground))]">
                  Students in this course wrote with a chatbot, and it answered them
                  without you in the room. What you set up here is what it answers with.
                </p>
              )}

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

              {/* Last, and only when Start is going to ask for the screen.
                  The browser cannot carry a capture across a page load, so the
                  dialog comes back at the start of each round however many
                  times it has already been answered — which makes it worth
                  showing the answer rather than only naming it. */}
              {record && (
                <section className="space-y-2">
                  <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))] border-b border-[hsl(var(--border))] pb-2">
                    <Video className="w-4 h-4" />
                    Before you start
                  </h3>
                  <p className="text-base leading-relaxed text-[hsl(var(--foreground))]">
                    Pressing Start asks your browser what to share, the same way it did at the
                    beginning. Only this browser window is recorded.
                  </p>
                  <SharePickerHint compact />
                </section>
              )}
            </div>

            <div className="shrink-0 flex items-center justify-between gap-3 px-6 py-4 border-t border-[hsl(var(--border))]">
              <div className="min-w-0">
                {armError ? (
                  <p className="text-sm font-semibold text-amber-800">{armError}</p>
                ) : (
                  /* Names the button it is actually talking about, which is
                     now the participant's way back to the task. */
                  <p className="text-sm text-[hsl(var(--muted-foreground))]">
                    {stampWorkStart && record ? (
                      <>
                        Reopen this any time from{' '}
                        <span className="font-medium">Your task</span> in the header.
                      </>
                    ) : (
                      <>
                        Reopen this any time from{' '}
                        <span className="font-medium">
                          {showTask ? 'Your task' : 'Assignment'}
                        </span>{' '}
                        in the header.
                      </>
                    )}
                  </p>
                )}
              </div>
              <div className="shrink-0 flex items-center gap-3">
                {/* Only after a refusal. Offered up front it becomes the easy
                    path and the recording stops happening; withheld entirely
                    it costs the study a whole cell over a picker. */}
                {stampWorkStart && armError && (
                  <button
                    onClick={skipRecording}
                    className="text-sm font-medium text-[hsl(var(--muted-foreground))] underline underline-offset-2"
                  >
                    Continue without recording
                  </button>
                )}
                <button
                  onClick={() => (stampWorkStart ? void closeViaStart() : close())}
                  disabled={arming}
                  className="inline-flex items-center gap-2 rounded bg-[hsl(var(--primary))] px-5 py-2.5 text-sm font-semibold text-[hsl(var(--primary-foreground))] hover:opacity-90 disabled:opacity-60"
                >
                  {arming && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {armError ? 'Try again' : 'Start'}
                </button>
              </div>
            </div>
          </DialogPanel>
        </div>
      </Dialog>
    </>
  );
}
