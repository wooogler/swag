'use client';

/**
 * Presentational pieces shared by the SCORE IntentWorkbench and the baseline
 * SearchWorkbench, so the two conditions are byte-identical where they overlap
 * (the ablation's shell parity) with a single source of truth. Extracted
 * verbatim from IntentWorkbench — pure UI, no intent/search logic.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ChevronDown, ChevronUp, Pencil, Search, X } from 'lucide-react';
import { MaterialSegments, QuerySnippet, snippetOverflows, type Dissection } from './materials';
import { useHeaderSlot } from './StudioShell';
import EditorModal from './EditorModal';

/**
 * A workbench's own bar: Back button + title + optional note + right-aligned
 * actions. It renders INTO the page header (StudioShell), replacing the studio
 * header for as long as the workbench is open — one page, one back button, and
 * no Deploy/account controls hanging over a screen they do not act on.
 */
export function WorkbenchTopBar({
  title,
  note,
  onBack,
  backTitle,
  backLabel = 'Board',
  actions,
}: {
  title: string;
  note?: React.ReactNode;
  onBack: () => void;
  backTitle?: string;
  /** Where Back goes, when it is not the board (e.g. Preview → revising). */
  backLabel?: string;
  /** Right-aligned controls belonging to THIS workbench (e.g. Preview). */
  actions?: React.ReactNode;
}) {
  const slot = useHeaderSlot();
  useEffect(() => {
    if (!slot) return;
    slot.claim(true);
    return () => slot.claim(false);
  }, [slot]);

  const bar = (
    <div className="flex items-center gap-3">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-sm font-medium text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]"
        title={backTitle ?? 'Back to the board'}
      >
        <ArrowLeft className="w-3.5 h-3.5" /> {backLabel}
      </button>
      <h2 className="text-sm font-semibold truncate">{title}</h2>
      {note && <span className="text-xs text-[hsl(var(--muted-foreground))]">{note}</span>}
      {actions && <span className="ml-auto shrink-0 flex items-center gap-2">{actions}</span>}
    </div>
  );

  // Outside the shell (or before its slot exists) the bar stays where it is —
  // the workbench still works, it just keeps its own header.
  if (!slot) return <div className="shrink-0">{bar}</div>;
  return slot.el ? createPortal(bar, slot.el) : null;
}

/**
 * The definition field: label + the text, READ-ONLY, opening into a full-size
 * editor (EditorModal) on click.
 *
 * It used to be a five-row textarea. Definitions turned out to be paragraphs —
 * 253 characters on average across the 374 written so far, past 1,100 at the
 * long end — and this panel is 320-380px wide because its job is to leave the
 * question list the page. So the field shows the text and the writing happens
 * at the size the text actually is.
 *
 * Read-only is not a lock: the whole block is the button, so the gesture is
 * still "click the text, type". What it buys is that a definition can no longer
 * be altered by a stray keystroke while someone scrolls the column with the
 * caret parked in it — a definition change re-rates the entire log, so an
 * accidental one is expensive rather than merely untidy.
 *
 * SCORE labels it "When a student…"; the baseline's filter workbench reuses it
 * with its own label. `action` is the header's right-aligned controls (undo /
 * redo / Apply) and stays OUTSIDE the modal: those commit, and this only edits.
 */
export function DefinitionEditor({
  value,
  onChange,
  label = 'When a student…',
  placeholder,
  action,
  editTitle = 'Edit definition',
  hint,
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  placeholder?: string;
  action?: React.ReactNode;
  /** Dialog heading — "Edit definition" reads wrong over a baseline filter. */
  editTitle?: string;
  hint?: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const text = value.trim();
  return (
    <div className="block text-sm">
      <span className="flex items-center justify-between gap-2">
        <span className="font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">{label}</span>
        {action}
      </span>
      <button
        type="button"
        onClick={() => setEditing(true)}
        title="Click to edit in a full-size editor"
        className="group mt-1 w-full text-left rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5 hover:border-[hsl(var(--primary))]"
      >
        {/* Capped, and scrolls past the cap: an unbounded block would push
            History and the version list off the column on a long definition,
            and the full text is one click away regardless. */}
        <span className="block max-h-40 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed">
          {text || (
            <span className="italic text-[hsl(var(--muted-foreground))]">{placeholder ?? 'Empty'}</span>
          )}
        </span>
        <span className="mt-1 flex items-center gap-1 text-[11px] font-medium text-[hsl(var(--primary))] opacity-70 group-hover:opacity-100">
          <Pencil className="h-3 w-3" />
          Edit
        </span>
      </button>
      <EditorModal
        open={editing}
        title={editTitle}
        label={label}
        hint={hint}
        value={value}
        placeholder={placeholder}
        onCancel={() => setEditing(false)}
        onSave={(next) => {
          onChange(next);
          setEditing(false);
        }}
      />
    </div>
  );
}

/** A result pane's search box — filters the pane's rows by query text.
 * Extracted verbatim from IntentWorkbench so the baseline FilterWorkbench's
 * pane is the same control, not a look-alike. */
export function PaneSearch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[hsl(var(--muted-foreground))]" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search query text…"
        className="w-full pl-7 pr-7 py-1 text-sm border border-[hsl(var(--border))] rounded bg-[hsl(var(--background))] text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
      />
      {value && (
        <button
          onClick={() => onChange('')}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
          aria-label="Clear search"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

/** One query row's text: the material-aware snippet with in-place expand and a
 * click target that opens the full conversation. The intent-only chips (pins,
 * drift, overlap) are layered around this by the caller. */
export function QueryTextButton({
  queryText,
  dissection,
  expanded,
  onToggleExpand,
  onOpen,
  max = 120,
  children,
}: {
  queryText: string;
  dissection: Dissection | null;
  expanded: boolean;
  onToggleExpand: () => void;
  onOpen: () => void;
  max?: number;
  /** Intent-only extras (rationale / drift / overlap chips) rendered inside the
   * clickable button, right after the query text. */
  children?: React.ReactNode;
}) {
  const truncatable = snippetOverflows(queryText, dissection, max);
  const isExpanded = truncatable && expanded;
  return (
    <button onClick={onOpen} className="text-left flex-1 min-w-0" title="View the full conversation">
      <p className="text-sm leading-snug text-[hsl(var(--foreground))]">
        {isExpanded ? (
          <span className="whitespace-pre-wrap">
            <MaterialSegments text={queryText} dissection={dissection} />
          </span>
        ) : (
          <QuerySnippet text={queryText} dissection={dissection} max={max} />
        )}
        {truncatable && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand();
            }}
            className="ml-1 inline-flex items-center gap-0.5 align-baseline text-xs font-medium text-[hsl(var(--primary))] hover:underline"
          >
            {isExpanded ? (
              <>
                <ChevronUp className="w-3 h-3" /> collapse
              </>
            ) : (
              <>
                <ChevronDown className="w-3 h-3" /> expand
              </>
            )}
          </span>
        )}
      </p>
      {children}
    </button>
  );
}
