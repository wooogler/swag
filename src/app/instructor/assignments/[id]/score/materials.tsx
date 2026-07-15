'use client';

/**
 * SCORE v6 — shared Material-tag rendering for dissected student messages.
 * Pasted Material (assignment prompt / own draft / bot reply / other) collapses
 * into a per-kind colored tag; clicking reveals the verbatim text highlighted
 * in the same color. Requests stay plain text. Used by the conversation viewer
 * (IntentBoard) and the Intent modal's expand view.
 */
import { useMemo, useState } from 'react';
import { MATERIAL_LABELS, type MaterialKind } from '@/lib/score/intents';

export interface Dissection {
  materialKinds: MaterialKind[];
  requests: string[];
}

/** Per-kind colors so each Material tag reads distinctly. `tag` colors the
 * collapsed [PLACEHOLDER] text; `hl` tints the revealed verbatim text.
 * Assignment-prompt keeps the old violet for continuity. */
const MATERIAL_STYLE: Record<MaterialKind, { tag: string; hl: string }> = {
  assignment_prompt: { tag: 'bg-violet-50 text-violet-700', hl: 'bg-violet-100 text-violet-900' },
  student_draft: { tag: 'bg-amber-50 text-amber-700', hl: 'bg-amber-100 text-amber-900' },
  prior_bot_reply: { tag: 'bg-sky-50 text-sky-700', hl: 'bg-sky-100 text-sky-900' },
  other: { tag: 'bg-teal-50 text-teal-700', hl: 'bg-teal-100 text-teal-900' },
};
/** Fallback when a message mixes several material kinds — per-segment kind is
 * not stored, so the exact tag can't be attributed. Pink: visible (the old
 * slate read as disabled text) and clearly apart from all four kind colors
 * (orange collided with own-draft amber). */
const MATERIAL_MIXED = { tag: 'bg-pink-50 text-pink-700', hl: 'bg-pink-100 text-pink-900' };

/** The collapsed placeholder text: reads like redacted-source markers rather
 * than UI chips — "[OWN DRAFT]", "[BOT REPLY]". A message mixing several
 * material kinds can't attribute the segment (per-segment kind isn't stored),
 * so the tag lists the candidates: "[OWN DRAFT / BOT REPLY]" = this pasted
 * block is one of these. */
function tagText(mk: MaterialKind | null, kinds: MaterialKind[]): string {
  if (mk) return `[${MATERIAL_LABELS[mk].toUpperCase()}]`;
  const names = kinds.map((k) => MATERIAL_LABELS[k].toUpperCase());
  return `[${names.length > 1 ? names.join(' / ') : 'PASTED MATERIAL'}]`;
}

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
 * stopPropagation so a tag click doesn't collapse the row. The [TAG] inherits
 * the surrounding font size, so it fits dense and roomy contexts alike. */
export function MaterialSegments({
  text,
  dissection,
}: {
  text: string;
  dissection: Dissection | null;
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
            className={`mx-0.5 cursor-pointer whitespace-nowrap rounded-[2px] px-0.5 font-medium hover:underline ${style.tag}`}
          >
            {tagText(s.mk, dissection?.materialKinds ?? [])}
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

/** Whether QuerySnippet would actually truncate this message at `max` — the
 * SAME budget rules (material segments collapse to tags and cost nothing), so
 * an expand affordance can be offered exactly when there is hidden text. */
export function snippetOverflows(text: string, dissection: Dissection | null, max: number): boolean {
  const segs = segmentForMaterials(text, dissection?.requests ?? [], dissection?.materialKinds ?? []);
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
        out.push(
          <span
            key={key++}
            className={`mx-0.5 whitespace-nowrap rounded-[2px] px-0.5 font-medium ${style.tag}`}
          >
            {tagText(s.mk, dissection?.materialKinds ?? [])}
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
