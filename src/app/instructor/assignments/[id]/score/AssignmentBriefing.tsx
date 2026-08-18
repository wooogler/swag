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
import { Bot, FileText, Info, X } from 'lucide-react';
import { instructionToPlainText } from '@/lib/instruction-content';

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
        title="The assignment these students were given, and the chatbot's starting prompt"
        aria-label="About this assignment"
        className="shrink-0 inline-flex items-center gap-1 rounded border border-[hsl(var(--border))] px-2 py-1 text-[11px] font-medium text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
      >
        <Info className="w-3.5 h-3.5" />
        Assignment
      </button>

      <Dialog open={open} onClose={close} className="relative z-50">
        <div className="fixed inset-0 bg-black/40" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <DialogPanel className="w-full max-w-3xl h-[80vh] flex flex-col overflow-hidden rounded-lg bg-[hsl(var(--card))] border border-[hsl(var(--border))] shadow-xl">
            <div className="shrink-0 flex items-start justify-between gap-3 px-4 py-3 border-b border-[hsl(var(--border))]">
              <div className="min-w-0">
                <DialogTitle className="text-sm font-semibold">
                  What you&rsquo;re working from
                </DialogTitle>
                <p className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))] truncate">
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

            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-5">
              <section className="space-y-2">
                <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))] border-b border-[hsl(var(--border))] pb-1.5">
                  <FileText className="w-3.5 h-3.5" />
                  The assignment students were given
                </h3>
                {prompt ? (
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-[hsl(var(--foreground))]">
                    {prompt}
                  </p>
                ) : (
                  <p className="text-sm italic text-[hsl(var(--muted-foreground))]">
                    This assignment has no written prompt.
                  </p>
                )}
              </section>

              <section className="space-y-2">
                <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))] border-b border-[hsl(var(--border))] pb-1.5">
                  <Bot className="w-3.5 h-3.5" />
                  The chatbot&rsquo;s starting prompt
                </h3>
                <div className="rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 p-3">
                  {base ? (
                    <>
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-[hsl(var(--foreground))]">
                        {base}
                      </p>
                      <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">
                        {includesInstructions
                          ? 'The assignment above is part of this prompt, so the chatbot received it too.'
                          : 'The chatbot was given only this — not the assignment above.'}
                      </p>
                    </>
                  ) : (
                    // The honest empty case, in the assignment page's words.
                    <p className="text-sm italic text-[hsl(var(--muted-foreground))]">
                      No system prompt — the chatbot ran without any default guidance.
                    </p>
                  )}
                </div>
                <p className="text-xs text-[hsl(var(--muted-foreground))]">
                  This is what answered every question in the log. What you write
                  from here replaces it for the questions you write it for.
                </p>
              </section>
            </div>

            <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 border-t border-[hsl(var(--border))]">
              <p className="text-xs text-[hsl(var(--muted-foreground))]">
                Reopen this any time from <span className="font-medium">Assignment</span> in the header.
              </p>
              <button
                onClick={close}
                className="shrink-0 rounded bg-[hsl(var(--primary))] px-3 py-1.5 text-xs font-medium text-[hsl(var(--primary-foreground))] hover:opacity-90"
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
