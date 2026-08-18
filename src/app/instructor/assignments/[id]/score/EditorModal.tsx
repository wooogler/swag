'use client';

/**
 * The big editor: one long text, edited in a dialog instead of in a side panel.
 *
 * A definition and a rule both started life as a sentence and both grew into
 * paragraphs — intent definitions run past 1,100 characters, the baseline's
 * rules document is capped at 8,000 — and the workbench columns that hold them
 * are 320-380px wide by design, because their job is to leave the question list
 * the page. Editing a page of prose through a letterbox is the complaint this
 * answers: the panel goes read-only and keeps showing the text, and writing it
 * happens here, at a size the text actually is.
 *
 * IT DOES NOT COMMIT. Save closes the dialog with the new draft; what reaches
 * students is still decided outside by Try (simulate) and Apply (commit), the
 * two verbs both workbenches already speak. Adding a third one in here would
 * put a save on the live boundary in the one place the instructor cannot see
 * the consequences — the preview and the question list are behind the dialog.
 *
 * The draft is local until Save, so Cancel is a real undo of the whole sitting.
 * That is also why a dirty dialog refuses to close on Escape or a backdrop
 * click: those are the two ways to lose a page of writing to a stray keystroke,
 * and the buttons are right there.
 */
import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { X } from 'lucide-react';

export default function EditorModal({
  open,
  title,
  subtitle,
  label,
  hint,
  value,
  placeholder,
  charLimit,
  saveLabel = 'Save',
  onCancel,
  onSave,
}: {
  open: boolean;
  /** What is being edited — "Edit definition", "Edit rule". */
  title: string;
  /** Which one, when there is more than one of them: the intent's name. */
  subtitle?: string | null;
  /** The field's own label, kept identical to the panel's so the dialog reads
   * as the same field made bigger rather than a different one. */
  label: string;
  /** One line under the field: what this text has to do. */
  hint?: string | null;
  value: string;
  placeholder?: string;
  /** Baseline's rules document has one (STUDY_PROMPT_CHAR_LIMIT); definitions
   * and per-intent rules do not. */
  charLimit?: number | null;
  saveLabel?: string;
  onCancel: () => void;
  onSave: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);

  // Re-seed on each opening, not on every `value` change: while the dialog is
  // open the draft is the instructor's, and a background refresh writing over
  // half-typed prose is exactly the loss this component exists to prevent.
  useEffect(() => {
    if (!open) return;
    setDraft(value);
    setConfirmingDiscard(false);
    // Caret at the END. Focusing a textarea selects nothing and parks the caret
    // at position 0, so the first keystroke on a long rule would land in front
    // of the first word.
    const id = window.setTimeout(() => {
      const el = areaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
      el.scrollTop = el.scrollHeight;
    }, 0);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const dirty = draft !== value;
  const overLimit = charLimit != null && draft.length > charLimit;

  const requestCancel = () => {
    if (!dirty) return onCancel();
    setConfirmingDiscard(true);
  };

  const save = () => {
    if (overLimit) return;
    onSave(draft);
  };

  return (
    <Dialog
      open={open}
      // A dirty dialog swallows Escape and backdrop clicks — see the header.
      onClose={() => (dirty ? setConfirmingDiscard(true) : onCancel())}
      // Above the membership diff (65) and the WHY picker (59/60), below the
      // fold review (80). Never open at the same time as either, but the
      // ordering is stated rather than left to whichever mounted last.
      className="relative z-[75]"
    >
      <div className="fixed inset-0 bg-black/50" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden rounded-lg bg-[hsl(var(--card))] border border-[hsl(var(--border))] shadow-xl">
          <div className="shrink-0 flex items-start justify-between gap-3 px-4 py-3 border-b border-[hsl(var(--border))]">
            <div className="min-w-0">
              <DialogTitle className="text-sm font-semibold">{title}</DialogTitle>
              {subtitle && (
                <p className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))] truncate">
                  {subtitle}
                </p>
              )}
            </div>
            <button
              onClick={requestCancel}
              className="shrink-0 p-1 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 min-h-0 flex flex-col p-4 gap-2">
            <div className="shrink-0 flex items-baseline justify-between gap-3">
              <label
                htmlFor="editor-modal-field"
                className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]"
              >
                {label}
              </label>
              {charLimit != null && (
                <span
                  className={`text-[11px] tabular-nums ${
                    overLimit ? 'font-semibold text-rose-600' : 'text-[hsl(var(--muted-foreground))]'
                  }`}
                >
                  {draft.length.toLocaleString()} / {charLimit.toLocaleString()}
                </span>
              )}
            </div>
            <textarea
              id="editor-modal-field"
              ref={areaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // The dialog's own commit key. Plain Enter has to stay a
                // newline — this is prose, and paragraphs are the point.
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault();
                  save();
                }
              }}
              placeholder={placeholder}
              spellCheck
              className="flex-1 min-h-0 w-full resize-none rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-3 text-sm leading-relaxed text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
            />
            {hint && (
              <p className="shrink-0 text-[11px] leading-relaxed text-[hsl(var(--muted-foreground))]">
                {hint}
              </p>
            )}
          </div>

          <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 border-t border-[hsl(var(--border))]">
            {confirmingDiscard ? (
              // Inline rather than a native confirm(): the text at risk stays
              // on screen behind the question being asked about it.
              <>
                <p className="text-xs text-[hsl(var(--foreground))]">
                  Discard your changes to this text?
                </p>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => setConfirmingDiscard(false)}
                    className="rounded border border-[hsl(var(--border))] px-3 py-1.5 text-xs font-medium hover:bg-[hsl(var(--muted))]"
                  >
                    Keep editing
                  </button>
                  <button
                    onClick={onCancel}
                    className="rounded border border-rose-300 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50"
                  >
                    Discard
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
                  {overLimit
                    ? 'Too long to save — shorten it first.'
                    : 'Saving closes this and updates the panel. Nothing reaches students until you deploy.'}
                </p>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={requestCancel}
                    className="rounded border border-[hsl(var(--border))] px-3 py-1.5 text-xs font-medium hover:bg-[hsl(var(--muted))]"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={save}
                    disabled={overLimit}
                    title={overLimit ? 'Over the character limit' : 'Save (⌘/Ctrl + Enter)'}
                    className="rounded bg-[hsl(var(--primary))] px-3 py-1.5 text-xs font-medium text-[hsl(var(--primary-foreground))] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {saveLabel}
                  </button>
                </div>
              </>
            )}
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
