'use client';

/**
 * SCORE v6 — shared Material-tag rendering for dissected student messages.
 * Pasted Material (assignment prompt / own draft / bot reply / other) collapses
 * into a per-kind colored tag; clicking reveals the verbatim text highlighted
 * in the same color. Requests stay plain text. Used by the conversation viewer
 * (IntentBoard) and the Intent modal's expand view.
 */
import { useMemo, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { MATERIAL_LABELS, type MaterialKind, type MaterialSpan } from '@/lib/score/intents';
// The tag renderer lives in lib so the intent-rating prompt emits the SAME
// string the instructor reads. `tagText` is the local alias for the bracketed
// form, so the JSX below is unchanged from when it was defined here.
import {
  coveragePct,
  materialTag as tagText,
  segmentForMaterials,
  tagTitle,
} from '@/lib/score/material-render';

export { coveragePct, segmentForMaterials };

export interface Dissection {
  /** Message-wide set of kinds. Kept for filters and for rows dissected before
   * per-run kinds existed (DISSECTION_VERSION < 4), where it is all we have. */
  materialKinds: MaterialKind[];
  requests: string[];
  /** Per-run kind + source coverage, in document order. Empty on older rows. */
  materials?: MaterialSpan[];
}

/** Per-kind colors so each Material tag reads distinctly. `tag` colors the
 * collapsed [PLACEHOLDER] text; `hl` tints the revealed verbatim text.
 * Assignment-prompt keeps the old violet for continuity. */
const MATERIAL_STYLE: Record<MaterialKind, { tag: string; hl: string }> = {
  assignment_prompt: { tag: 'bg-violet-50 text-violet-700', hl: 'bg-violet-100 text-violet-900' },
  student_draft: { tag: 'bg-amber-50 text-amber-700', hl: 'bg-amber-100 text-amber-900' },
  prior_bot_reply: { tag: 'bg-sky-50 text-sky-700', hl: 'bg-sky-100 text-sky-900' },
  // The chat's other side. Emerald reads apart from bot-reply sky at a glance —
  // the pair that matters most, since both come out of the chat panel.
  own_question: { tag: 'bg-emerald-50 text-emerald-700', hl: 'bg-emerald-100 text-emerald-900' },
  other: { tag: 'bg-teal-50 text-teal-700', hl: 'bg-teal-100 text-teal-900' },
};
/** Fallback for a run whose kind can't be attributed — only rows written before
 * per-run kinds existed (DISSECTION_VERSION < 4) still hit this. Pink: visible
 * (the old slate read as disabled text) and clearly apart from all four kind
 * colors (orange collided with own-draft amber). */
const MATERIAL_MIXED = { tag: 'bg-pink-50 text-pink-700', hl: 'bg-pink-100 text-pink-900' };

export function materialStyle(mk: MaterialKind | null) {
  return mk ? MATERIAL_STYLE[mk] : MATERIAL_MIXED;
}

/** Message body with Material collapsed into clickable per-kind tags; click to
 * reveal the verbatim text (highlighted in the same color), click to collapse.
 * Interactive parts are `<span role="button">` (not `<button>`) so the whole
 * thing stays valid inside an outer row-toggle button (Intent modal), with
 * stopPropagation so a tag click doesn't collapse the row. The [TAG] inherits
 * the surrounding font size, so it fits dense and roomy contexts alike. */
export function MaterialSegments({
  text,
  dissection,
  defaultOpen = false,
  toggleAll = false,
}: {
  text: string;
  dissection: Dissection | null;
  /** Start with every run revealed. Reading views (the conversation panes) want
   * the message as the student actually wrote it — a wall of [TAG]s is only
   * worth its density in the question LISTS, where the alternative is a preview
   * drowned in someone's pasted draft. */
  defaultOpen?: boolean;
  /** Append a small show/hide-all control, so a view that collapses by default
   * (the rule workbench, which reads tags as the thing the rule sees) is still
   * one click from the verbatim text. */
  toggleAll?: boolean;
}) {
  const segs = useMemo(
    () =>
      segmentForMaterials(
        text,
        dissection?.requests ?? [],
        dissection?.materialKinds ?? [],
        dissection?.materials
      ),
    [text, dissection]
  );
  const materialIdx = useMemo(
    () => segs.flatMap((s, i) => (s.kind === 'material' ? [i] : [])),
    [segs]
  );
  const [open, setOpen] = useState<Set<number>>(() =>
    defaultOpen ? new Set(materialIdx) : new Set()
  );
  const allOpen = materialIdx.length > 0 && materialIdx.every((i) => open.has(i));
  const toggle = (i: number) =>
    setOpen((prev) => {
      const n = new Set(prev);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });

  return (
    <>
      {segs.map((s, i) => {
        if (s.kind === 'text') return <span key={i}>{s.text}</span>;
        const style = materialStyle(s.mk);
        const label = s.mk ? MATERIAL_LABELS[s.mk] : 'pasted material';
        const onClick = (e: React.MouseEvent) => {
          e.stopPropagation();
          toggle(i);
        };
        // Expanded run is an inline <span> so the verbatim text flows across
        // line breaks and the highlight hugs each line — an inline-block
        // element would render the whole run as one boxy rectangle.
        return open.has(i) ? (
          <span
            key={i}
            role="button"
            tabIndex={0}
            onClick={onClick}
            title={tagTitle(label, s.text, s.span, 'open')}
            className={`cursor-pointer rounded-[2px] box-decoration-clone ${style.hl}`}
          >
            {s.text}
          </span>
        ) : (
          <span
            key={i}
            role="button"
            tabIndex={0}
            onClick={onClick}
            title={tagTitle(label, s.text, s.span, 'closed')}
            className={`mx-0.5 cursor-pointer whitespace-nowrap rounded-[2px] px-0.5 font-medium hover:underline ${style.tag}`}
          >
            {tagText(s.mk, dissection?.materialKinds ?? [], s.text, s.span)}
          </span>
        );
      })}
      {toggleAll && materialIdx.length > 0 && (
        // Its own line, not trailing the prose: inline, it read as part of the
        // sentence the student wrote. `flex` makes this <span> a block-level box
        // (so it breaks the line) while staying phrasing content — the parents
        // here are <p>, and a <div> would be invalid inside one. `w-fit` keeps
        // the hit target on the control instead of the whole width.
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            setOpen(allOpen ? new Set() : new Set(materialIdx));
          }}
          title={
            allOpen
              ? 'Collapse every pasted block back to its tag'
              : 'Show the verbatim text behind every tag'
          }
          // select-none keeps the label out of a drag-selection: the rule
          // workbench turns a selection inside the bubble into quoted feedback,
          // and a drag to the end of the message now lands on this line.
          className="mt-1.5 flex w-fit cursor-pointer select-none items-center gap-0.5 whitespace-nowrap rounded border border-[hsl(var(--border))] px-1 py-px text-[10px] font-medium text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
        >
          {allOpen ? (
            <>
              <EyeOff className="h-2.5 w-2.5" /> hide pasted text
            </>
          ) : (
            <>
              <Eye className="h-2.5 w-2.5" /> show pasted text
            </>
          )}
        </span>
      )}
    </>
  );
}

/** Student message box for the conversation viewer. Expansion state resets per
 * message via a `key` on the message id at the call site. */
export function StudentMessage({
  text,
  dissection,
  defaultOpen = false,
}: {
  text: string;
  dissection: Dissection | null;
  defaultOpen?: boolean;
}) {
  return (
    <p className="text-sm whitespace-pre-wrap rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 p-3 leading-relaxed">
      <MaterialSegments text={text} dissection={dissection} defaultOpen={defaultOpen} toggleAll />
    </p>
  );
}

/** Whether QuerySnippet would actually truncate this message at `max` — the
 * SAME budget rules (material segments collapse to tags and cost nothing), so
 * an expand affordance can be offered exactly when there is hidden text. */
export function snippetOverflows(text: string, dissection: Dissection | null, max: number): boolean {
  const segs = segmentForMaterials(
    text,
    dissection?.requests ?? [],
    dissection?.materialKinds ?? [],
    dissection?.materials
  );
  let used = 0;
  for (const s of segs) {
    if (used >= max) return true;
    if (s.kind === 'material') continue;
    let clean = s.text.replace(/\s+/g, ' ');
    if (used === 0) clean = clean.trimStart();
    if (!clean) continue;
    if (clean.length > max - used) return true;
    used += clean.length;
  }
  return false;
}

/** Compact one-line preview for question lists: plain text is collapsed to
 * single spaces and truncated, pasted Material shows as a small (static) tag.
 * Non-interactive — the whole row is a button, so no nested controls here. */
export function QuerySnippet({
  text,
  dissection,
  max = 140,
}: {
  text: string;
  dissection: Dissection | null;
  /** Plain-text budget (chars) before the preview truncates with an ellipsis. */
  max?: number;
}) {
  const MAX = max;
  const nodes = useMemo(() => {
    const segs = segmentForMaterials(
      text,
      dissection?.requests ?? [],
      dissection?.materialKinds ?? [],
      dissection?.materials
    );
    const out: React.ReactNode[] = [];
    let used = 0;
    let key = 0;
    for (const s of segs) {
      if (used >= MAX) {
        out.push('…');
        break;
      }
      if (s.kind === 'material') {
        const style = materialStyle(s.mk);
        out.push(
          <span
            key={key++}
            title={tagTitle(
              s.mk ? MATERIAL_LABELS[s.mk] : 'Pasted material',
              s.text,
              s.span,
              'static'
            )}
            className={`mx-0.5 whitespace-nowrap rounded-[2px] px-0.5 font-medium ${style.tag}`}
          >
            {tagText(s.mk, dissection?.materialKinds ?? [], s.text, s.span)}
          </span>
        );
        continue;
      }
      let clean = s.text.replace(/\s+/g, ' ');
      if (used === 0) clean = clean.trimStart();
      if (!clean) continue;
      const room = MAX - used;
      if (clean.length > room) clean = `${clean.slice(0, room)}…`;
      used += clean.length;
      out.push(<span key={key++}>{clean}</span>);
    }
    return out;
  }, [text, dissection, MAX]);

  return <>{nodes}</>;
}
