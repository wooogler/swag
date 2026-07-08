'use client';

/**
 * SCORE v6 — shared Material-tag rendering for dissected student messages.
 * Pasted Material (assignment prompt / own draft / bot reply / other) collapses
 * into a per-kind colored tag; clicking reveals the verbatim text highlighted
 * in the same color. Requests stay plain text. Used by the conversation viewer
 * (IntentBoard) and the Intent modal's expand view.
 */
import { useMemo, useState } from 'react';
import { FileText } from 'lucide-react';
import { MATERIAL_LABELS, type MaterialKind } from '@/lib/score/intents';

export interface Dissection {
  materialKinds: MaterialKind[];
  requests: string[];
}

/** Per-kind colors so each Material tag reads distinctly. `chip` styles the
 * collapsed placeholder; `hl` tints the revealed verbatim text.
 * Assignment-prompt keeps the old violet for continuity. */
const MATERIAL_STYLE: Record<MaterialKind, { chip: string; hl: string }> = {
  assignment_prompt: { chip: 'bg-violet-50 text-violet-700 border-violet-200', hl: 'bg-violet-100 text-violet-900' },
  student_draft: { chip: 'bg-amber-50 text-amber-700 border-amber-200', hl: 'bg-amber-100 text-amber-900' },
  prior_bot_reply: { chip: 'bg-sky-50 text-sky-700 border-sky-200', hl: 'bg-sky-100 text-sky-900' },
  other: { chip: 'bg-teal-50 text-teal-700 border-teal-200', hl: 'bg-teal-100 text-teal-900' },
};
/** Fallback when a message mixes several material kinds — per-segment kind is
 * not stored, so the exact tag can't be attributed; render it neutral. */
const MATERIAL_MIXED = { chip: 'bg-slate-50 text-slate-600 border-slate-200', hl: 'bg-slate-200/70 text-slate-900' };

export function materialStyle(mk: MaterialKind | null) {
  return mk ? MATERIAL_STYLE[mk] : MATERIAL_MIXED;
}

type MsgSeg =
  | { kind: 'text'; text: string }
  | { kind: 'material'; text: string; mk: MaterialKind | null };

/** Split the message into plain-text runs (the dissected Requests) and Material
 * runs (the gaps between them), so the viewer can replace pasted Material with a
 * collapsible tag. Material kind is known only when the message has a SINGLE
 * kind — per-segment kind is not stored, so multi-kind messages leave it null
 * (rendered neutral). */
export function segmentForMaterials(text: string, requests: string[], kinds: MaterialKind[]): MsgSeg[] {
  const mk = kinds.length === 1 ? kinds[0] : null;
  const segs: MsgSeg[] = [];
  // Push a Material run, but keep its leading/trailing whitespace as plain text
  // so the tag/highlight hugs only real content — otherwise an expanded run that
  // starts with blank lines renders as a big empty highlighted box.
  const pushGap = (a: number, b: number) => {
    if (b <= a) return;
    const g = text.slice(a, b);
    if (!g.trim()) {
      // Whitespace-only gap stays plain — a bare tag here reads as noise.
      segs.push({ kind: 'text', text: g });
      return;
    }
    const lead = g.length - g.trimStart().length;
    const trail = g.length - g.trimEnd().length;
    if (lead) segs.push({ kind: 'text', text: g.slice(0, lead) });
    segs.push({ kind: 'material', text: g.slice(lead, g.length - trail), mk });
    if (trail) segs.push({ kind: 'text', text: g.slice(g.length - trail) });
  };
  if (requests.length === 0) {
    // No requests located → the whole message is Material (when any was detected).
    if (!kinds.length) return [{ kind: 'text', text }];
    pushGap(0, text.length);
    return segs;
  }
  const spans: [number, number][] = [];
  const lower = text.toLowerCase();
  let from = 0;
  for (const req of requests) {
    const r = req.trim();
    if (!r) continue;
    let idx = text.indexOf(r, from);
    if (idx === -1) idx = lower.indexOf(r.toLowerCase(), from);
    if (idx === -1) continue;
    spans.push([idx, idx + r.length]);
    from = idx + r.length;
  }
  if (spans.length === 0) return [{ kind: 'text', text }];
  let cursor = 0;
  for (const [s, e] of spans) {
    pushGap(cursor, s);
    segs.push({ kind: 'text', text: text.slice(s, e) });
    cursor = e;
  }
  pushGap(cursor, text.length);
  return segs;
}

/** Message body with Material collapsed into clickable per-kind tags; click to
 * reveal the verbatim text (highlighted in the same color), click to collapse.
 * Interactive parts are `<span role="button">` (not `<button>`) so the whole
 * thing stays valid inside an outer row-toggle button (Intent modal), with
 * stopPropagation so a tag click doesn't collapse the row. `compact` shrinks
 * the tag for dense list contexts. */
export function MaterialSegments({
  text,
  dissection,
  compact = false,
}: {
  text: string;
  dissection: Dissection | null;
  compact?: boolean;
}) {
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const segs = useMemo(
    () => segmentForMaterials(text, dissection?.requests ?? [], dissection?.materialKinds ?? []),
    [text, dissection]
  );
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
            title="Pasted material — click to collapse"
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
            title={`${label} — click to reveal`}
            className={`mx-0.5 inline-flex cursor-pointer items-center rounded border align-baseline font-medium ${
              compact ? 'gap-0.5 px-1 py-px text-[10px]' : 'gap-1 px-1.5 py-0.5 text-[11px]'
            } ${style.chip}`}
          >
            <FileText className={compact ? 'w-2.5 h-2.5' : 'w-3 h-3'} /> {label}
          </span>
        );
      })}
    </>
  );
}

/** Student message box for the conversation viewer. Expansion state resets per
 * message via a `key` on the message id at the call site. */
export function StudentMessage({ text, dissection }: { text: string; dissection: Dissection | null }) {
  return (
    <p className="text-sm whitespace-pre-wrap rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 p-3 leading-relaxed">
      <MaterialSegments text={text} dissection={dissection} />
    </p>
  );
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
    const segs = segmentForMaterials(text, dissection?.requests ?? [], dissection?.materialKinds ?? []);
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
        const label = s.mk ? MATERIAL_LABELS[s.mk] : 'pasted material';
        out.push(
          <span
            key={key++}
            className={`mx-0.5 inline-flex items-center gap-0.5 rounded border px-1 py-px align-baseline text-[10px] font-medium ${style.chip}`}
          >
            <FileText className="w-2.5 h-2.5" />
            {label}
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
