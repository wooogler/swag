/**
 * SCORE — the Material tag, rendered ONCE for two readers.
 *
 * The instructor's board collapses each pasted run into "[OWN DRAFT · 120 words
 * · 40%]"; the intent-rating prompt puts the SAME string in front of the judge
 * (followed by an abridged excerpt, since the judge cannot click to reveal).
 * Moved out of materials.tsx so there is one renderer rather than two that
 * happen to agree today.
 *
 * No 'use client' and no server-only imports: prompts.ts is client-safe by
 * contract and both sides of that boundary import this.
 */
import { MATERIAL_LABELS, type MaterialKind, type MaterialSpan } from './intents';

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

/** Words in the run. The percentage alone under-describes an own draft: the
 * source is a different length for every student, so 40% is 80 words for one
 * and 600 for another. Counted off the located run rather than stored, so it
 * is right for pre-v4 rows too (they have no MaterialSpan at all). */
export function wordCount(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

/** Spelled out, never abbreviated to "49w". The marker sits beside a "%", which
 * frames a bare letter suffix as a unit symbol of the same standing — and "w"
 * is not one. Worse in this audience: instructors read "w … %" as rubric idiom
 * ("weighted 40%"). The dense question lists are where this is met first and
 * most often, so the unit has to survive without a hover. */
export function wordsLabel(n: number): string {
  return `${n} ${n === 1 ? 'word' : 'words'}`;
}

/**
 * How long a run has to be before it counts as pasted Material at all.
 *
 * The locator finds every verbatim overlap, including ones nobody would call a
 * paste: a shared phrase, a few words carried over from the assignment prompt.
 * Tagged, those buried the real blocks under a row of "[ASSIGNMENT PROMPT · 1%]"
 * markers — 1% because `coveragePct` floors at 1, so even a three-word overlap
 * arrives looking like a measured quantity.
 *
 * The floor is counted in WORDS rather than as a share of the source, because a
 * share does not say how much text there is: 1% of a long assignment prompt is a
 * paragraph, and 30% of a two-line draft is half a sentence. Below it the run
 * renders as the plain text it reads as — for the instructor and for the judge
 * alike, since this module is the one renderer for both. That second reader is
 * the bigger win: fragments of the prompt tagged as pasted material are the
 * mechanism behind "pasted prompt rated as the student's own question".
 */
export const MIN_MATERIAL_WORDS = 20;

/** Is this run big enough to be called Material? Strictly more than the floor. */
export function isMaterialRun(text: string): boolean {
  return wordCount(text) > MIN_MATERIAL_WORDS;
}

/**
 * The marker's inside, without the brackets, so the rating prompt can append an
 * excerpt inside the same pair. `materialTag` below is what the UI renders.
 *
 * The percentage is how much of the source the run covers; the word count is
 * how much text that actually is. Both only where both say something: the
 * assignment prompt is the SAME source for every student, so its percentage is
 * already comparable across people and the word count is noise. The per-student
 * sources (own draft, bot reply, own question, other) are a different length
 * for everyone, so there the percentage alone means nothing without it.
 *
 * On pre-v4 rows the kind of an individual run is unknown, so the tag lists the
 * message's candidates instead: "OWN DRAFT / ASSIGNMENT PROMPT" = this block is
 * one of these.
 */
export function materialTagBody(
  mk: MaterialKind | null,
  kinds: MaterialKind[],
  segText: string,
  span?: MaterialSpan | null
): string {
  const pct = coveragePct(span);
  // Shared-source kinds keep the percentage alone — unless there is no
  // percentage to be had, where the word count is better than no extent at all.
  const wordsWorthShowing = mk !== 'assignment_prompt' || pct === null;
  const words = wordsWorthShowing ? wordCount(segText) : 0;
  const parts = [words ? wordsLabel(words) : null, pct === null ? null : `${pct}%`].filter(Boolean);
  const extent = parts.length ? ` · ${parts.join(' · ')}` : '';
  if (mk) return `${MATERIAL_LABELS[mk].toUpperCase()}${extent}`;
  const names = kinds.map((k) => MATERIAL_LABELS[k].toUpperCase());
  return `${names.length > 1 ? names.join(' / ') : 'PASTED MATERIAL'}${extent}`;
}

/** The collapsed placeholder text: reads like redacted-source markers rather
 * than UI chips — "[OWN DRAFT · 120 words · 40%]", "[ASSIGNMENT PROMPT · 82%]". */
export function materialTag(
  mk: MaterialKind | null,
  kinds: MaterialKind[],
  segText: string,
  span?: MaterialSpan | null
): string {
  return `[${materialTagBody(mk, kinds, segText, span)}]`;
}

/** Hover text: the extent in plain numbers, since the tag itself only has room
 * for a rounded percentage — and, for the assignment prompt, deliberately drops
 * the word count the tooltip still carries. `static` is the question-list tag,
 * which is inert (the whole row is the click target) and so must not promise a
 * reveal that clicking it will not perform. */
export function tagTitle(
  label: string,
  segText: string,
  span: MaterialSpan | null | undefined,
  mode: 'open' | 'closed' | 'static'
): string {
  const head = mode === 'open' ? 'Pasted material' : label;
  const size = wordsLabel(wordCount(segText));
  const pct = coveragePct(span);
  const extent =
    pct === null || !span
      ? size
      : `${size}, ${span.chars} of ${span.sourceChars} characters (${pct}% of the source)`;
  const action =
    mode === 'open' ? 'click to collapse' : mode === 'closed' ? 'click to reveal' : null;
  return [head, extent, action].filter(Boolean).join(' — ');
}

export type MsgSeg =
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
  // Located runs, INCLUDING the ones the word floor drops. Falling back is for
  // rows whose runs cannot be found at all (pre-v4); a row whose runs were all
  // found and all judged too short has been answered — the answer is "none of
  // this is pasted material", and re-deriving it from request gaps below would
  // hand back the very fragments the floor just rejected.
  let located = 0;
  for (const m of materials) {
    const t = m.text.trim();
    if (!t) continue;
    let idx = text.indexOf(t, cursor);
    if (idx === -1) idx = lower.indexOf(t.toLowerCase(), cursor);
    if (idx === -1) continue;
    located++;
    // Too short to tag: leave it in place as prose. The cursor does not move,
    // so the run stays inside the next plain-text slice.
    if (!isMaterialRun(t)) continue;
    if (idx > cursor) segs.push({ kind: 'text', text: text.slice(cursor, idx) });
    segs.push({ kind: 'material', text: text.slice(idx, idx + t.length), mk: m.kind, span: m });
    cursor = idx + t.length;
  }
  if (located === 0) return null;
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
    const core = g.slice(lead, g.length - trail);
    // Same floor as the stored-run path: a gap this short is the student
    // writing, not something they pasted in.
    if (!isMaterialRun(core)) {
      segs.push({ kind: 'text', text: g });
      return;
    }
    if (lead) segs.push({ kind: 'text', text: g.slice(0, lead) });
    segs.push({ kind: 'material', text: core, mk });
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
