'use client';

/**
 * SCORE v6 — shared Material-tag rendering for dissected student messages.
 * Pasted Material (assignment prompt / own draft / bot reply / other) collapses
 * into a per-kind colored tag; clicking reveals the verbatim text highlighted
 * in the same color. Requests stay plain text. Used by the conversation viewer
 * (IntentBoard) and the Intent modal's expand view.
 */
import { useMemo, useState } from 'react';
import { MATERIAL_LABELS, type MaterialKind, type MaterialSpan } from '@/lib/score/intents';

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

/** How much of the source this run covers, as a whole percent — the answer to
 * "did they paste the whole assignment prompt or one line of it". Null when the
 * source size is unknown (an external paste has no source on record), and the
 * tag then carries no extent rather than a made-up one. */
export function coveragePct(span: MaterialSpan | null | undefined): number | null {
  if (!span?.sourceChars || !span.chars) return null;
  const pct = (span.chars / span.sourceChars) * 100;
  if (!Number.isFinite(pct)) return null;
  return Math.min(100, Math.max(1, Math.round(pct)));
}

/** The collapsed placeholder text: reads like redacted-source markers rather
 * than UI chips — "[OWN DRAFT · 40%]", "[BOT REPLY]". The percentage is how
 * much of that source the run covers. On pre-v4 rows the kind of an individual
 * run is unknown, so the tag lists the message's candidates instead:
 * "[OWN DRAFT / ASSIGNMENT PROMPT]" = this block is one of these. */
function tagText(
  mk: MaterialKind | null,
  kinds: MaterialKind[],
  span?: MaterialSpan | null
): string {
  const pct = coveragePct(span);
  const extent = pct === null ? '' : ` · ${pct}%`;
  if (mk) return `[${MATERIAL_LABELS[mk].toUpperCase()}${extent}]`;
  const names = kinds.map((k) => MATERIAL_LABELS[k].toUpperCase());
  return `[${names.length > 1 ? names.join(' / ') : 'PASTED MATERIAL'}${extent}]`;
}

/** Hover text: the extent in plain numbers, since the tag only has room for a
 * percentage. */
function tagTitle(label: string, span: MaterialSpan | null | undefined, open: boolean): string {
  const action = open ? 'click to collapse' : 'click to reveal';
  const pct = coveragePct(span);
  if (pct === null || !span) return `${open ? 'Pasted material' : label} — ${action}`;
  return `${label} — ${span.chars} of ${span.sourceChars} characters (${pct}%) — ${action}`;
}

export function materialStyle(mk: MaterialKind | null) {
  return mk ? MATERIAL_STYLE[mk] : MATERIAL_MIXED;
}

type MsgSeg =
  | { kind: 'text'; text: string }
  | { kind: 'material'; text: string; mk: MaterialKind | null; span?: MaterialSpan | null };

/** Locate each stored Material run in the message and split around it, so every
 * run carries its OWN kind and extent. Runs are verbatim substrings in document
 * order, found by a forward-scanning indexOf (same technique as requests below)
 * — no stored offsets to drift. Returns null when the dissection has no runs
 * (pre-v4 row) or none of them can be located, so the caller falls back. */
function segmentFromMaterials(text: string, materials: MaterialSpan[]): MsgSeg[] | null {
  const segs: MsgSeg[] = [];
  const lower = text.toLowerCase();
  let cursor = 0;
  for (const m of materials) {
    const t = m.text.trim();
    if (!t) continue;
    let idx = text.indexOf(t, cursor);
    if (idx === -1) idx = lower.indexOf(t.toLowerCase(), cursor);
    if (idx === -1) continue;
    if (idx > cursor) segs.push({ kind: 'text', text: text.slice(cursor, idx) });
    segs.push({ kind: 'material', text: text.slice(idx, idx + t.length), mk: m.kind, span: m });
    cursor = idx + t.length;
  }
  if (!segs.some((s) => s.kind === 'material')) return null;
  if (cursor < text.length) segs.push({ kind: 'text', text: text.slice(cursor) });
  return segs;
}

/** Split the message into plain-text runs (the dissected Requests) and Material
 * runs (the gaps between them), so the viewer can replace pasted Material with a
 * collapsible tag. Prefers the stored per-run kinds; on rows written before
 * those existed it falls back to the message-wide set, where the kind is known
 * only when the message has a SINGLE one (multi-kind → null → neutral tag). */
export function segmentForMaterials(
  text: string,
  requests: string[],
  kinds: MaterialKind[],
  materials?: MaterialSpan[]
): MsgSeg[] {
  if (materials?.length) {
    const byRun = segmentFromMaterials(text, materials);
    if (byRun) return byRun;
  }
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
    () =>
      segmentForMaterials(
        text,
        dissection?.requests ?? [],
        dissection?.materialKinds ?? [],
        dissection?.materials
      ),
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
            title={tagTitle(label, s.span, true)}
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
            title={tagTitle(label, s.span, false)}
            className={`mx-0.5 cursor-pointer whitespace-nowrap rounded-[2px] px-0.5 font-medium hover:underline ${style.tag}`}
          >
            {tagText(s.mk, dissection?.materialKinds ?? [], s.span)}
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
            className={`mx-0.5 whitespace-nowrap rounded-[2px] px-0.5 font-medium ${style.tag}`}
          >
            {tagText(s.mk, dissection?.materialKinds ?? [], s.span)}
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
