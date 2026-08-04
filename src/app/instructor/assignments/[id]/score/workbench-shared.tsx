'use client';

/**
 * Presentational pieces shared by the SCORE IntentWorkbench and the baseline
 * SearchWorkbench, so the two conditions are byte-identical where they overlap
 * (the ablation's shell parity) with a single source of truth. Extracted
 * verbatim from IntentWorkbench — pure UI, no intent/search logic.
 */
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ChevronDown, ChevronUp } from 'lucide-react';
import { MaterialSegments, QuerySnippet, snippetOverflows, type Dissection } from './materials';
import { useHeaderSlot } from './StudioShell';

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

/** The definition editor: label + textarea, with an optional right-aligned
 * action (e.g. "Prompt preview"). SCORE labels it "When a student…"; baseline
 * search reuses it with its own label. */
export function DefinitionEditor({
  value,
  onChange,
  label = 'When a student…',
  placeholder,
  rows = 5,
  action,
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  placeholder?: string;
  rows?: number;
  action?: React.ReactNode;
}) {
  return (
    <label className="block text-sm cursor-text">
      <span className="flex items-center justify-between gap-2">
        <span className="font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">{label}</span>
        {/* Not part of the field's click target — keeps its own cursor. */}
        {action && <span className="cursor-auto">{action}</span>}
      </span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        className="mt-1 w-full text-sm border border-[hsl(var(--border))] rounded px-2 py-1.5 bg-[hsl(var(--background))]"
      />
    </label>
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
