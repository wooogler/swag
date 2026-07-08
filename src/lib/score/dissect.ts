/**
 * SCORE v6 — DETERMINISTIC dissection (Material vs Request).
 *
 * Instead of asking the LLM to guess which parts of a chat message are pasted
 * material vs typed request, we reconstruct it from the session's editor-event
 * log, which is authoritative:
 *   - Chat pastes are recorded (`paste_internal`/`paste_external`, targetArea
 *     'chat') with their content and sourceArea; external paste into chat is
 *     blocked, so chat material is always internal & source-attributed.
 *   - As a fallback (for material RE-TYPED rather than pasted), we match message
 *     spans verbatim against the live editor snapshot, the assignment
 *     instructions, and the prior bot reply.
 * Everything NOT identified as material is the student's typed Request.
 *
 * A feasibility probe (see git history) showed this is more PRECISE than the
 * LLM, which over-tags material on follow-up questions and typed originals.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db/db';
import { assignments, editorEvents } from '@/db/schema';
import type { DissectionResult, MaterialKind } from './intents';
import { getQueryRecords, type QueryRecord } from './queries';

const MIN_MATERIAL = 12; // ignore matches shorter than this (noise)
const FALLBACK_WIN = 40; // sliding-window size for source verbatim matching
const FALLBACK_STEP = 12;
const GAP_MERGE = 24; // merge material spans separated by ≤ this (window/step slack)
const MIN_REQUEST = 6; // drop request gaps shorter than this once trimmed

function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Whitespace-normalized copy of `text` plus a map from each normalized-char
 * index to its ORIGINAL index, so a normalized match maps back to a single
 * contiguous original span (robust to whitespace differences in pasted text). */
function normWithMap(text: string): { norm: string; map: number[] } {
  const chars: string[] = [];
  const map: number[] = [];
  let inSpace = false;
  let started = false;
  for (let i = 0; i < text.length; i++) {
    if (/\s/.test(text[i])) {
      if (started && !inSpace) {
        chars.push(' ');
        map.push(i);
      }
      inSpace = true;
    } else {
      chars.push(text[i]);
      map.push(i);
      inSpace = false;
      started = true;
    }
  }
  if (chars[chars.length - 1] === ' ') {
    chars.pop();
    map.pop();
  }
  return { norm: chars.join(''), map };
}

/** Extract plain text from a BlockNote document (a snapshot's event_data). */
function blockText(doc: unknown): string {
  const out: string[] = [];
  const walk = (arr: unknown) => {
    if (!Array.isArray(arr)) return;
    for (const b of arr) {
      if (typeof b === 'string') out.push(b);
      else if (b && typeof b === 'object') {
        const o = b as Record<string, unknown>;
        if (typeof o.text === 'string') out.push(o.text);
        walk(o.content);
        walk(o.children);
      }
    }
  };
  walk(doc);
  return normalize(out.join(' '));
}

function sourceToKind(sourceArea: string | null | undefined): MaterialKind {
  switch (sourceArea) {
    case 'editor':
      return 'student_draft';
    case 'instruction':
      return 'assignment_prompt';
    case 'chat':
      return 'prior_bot_reply';
    default:
      return 'other';
  }
}

type Span = { start: number; end: number; kind: MaterialKind };

/** Extend a span to whole-word boundaries so requests aren't cut mid-word. */
function snapToWords(text: string, start: number, end: number): [number, number] {
  let s = start;
  let e = Math.min(end, text.length);
  while (s > 0 && !/\s/.test(text[s - 1])) s--;
  while (e < text.length && !/\s/.test(text[e])) e++;
  return [s, e];
}

/** Merge overlapping spans and spans separated by ≤ `gap` (fallback windows
 * leave small holes at material↔request boundaries — close them). */
function mergeClose(spans: Span[], gap: number): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end + gap) last.end = Math.max(last.end, s.end);
    else out.push({ ...s });
  }
  return out;
}

/** Requests = the material-free segments of the ORIGINAL text (verbatim), so the
 * viewer can locate each with a plain substring search. Fragments (too short or
 * word-less) are dropped. */
function gapsToRequests(text: string, spans: Span[]): string[] {
  const reqs: string[] = [];
  let cursor = 0;
  for (const s of spans) {
    if (s.start > cursor) {
      const seg = text.slice(cursor, s.start).trim();
      if (seg.length >= MIN_REQUEST && /\w/.test(seg)) reqs.push(seg);
    }
    cursor = Math.max(cursor, s.end);
  }
  if (cursor < text.length) {
    const seg = text.slice(cursor).trim();
    if (seg.length >= MIN_REQUEST && /\w/.test(seg)) reqs.push(seg);
  }
  return reqs;
}

/**
 * Dissect one message given its chat-pastes (in the composition window) and the
 * candidate source texts. Pure — positions are in the ORIGINAL message text.
 */
export function dissectMessage(
  text: string,
  windowPastes: { content: string | null; sourceArea: string | null }[],
  sources: { text: string; kind: MaterialKind }[]
): DissectionResult {
  const { norm: nText, map } = normWithMap(text);
  const spans: Span[] = [];

  // 1. Pasted material — normalized match mapped back to one contiguous span.
  for (const p of windowPastes) {
    const c = normalize(p.content ?? '');
    if (c.length < MIN_MATERIAL) continue;
    const j = nText.indexOf(c);
    if (j !== -1) spans.push({ start: map[j], end: map[j + c.length - 1] + 1, kind: sourceToKind(p.sourceArea) });
  }

  // 2. Re-typed / referenced material — sliding-window verbatim match vs sources.
  const normSources = sources
    .map((s) => ({ n: normalize(s.text), kind: s.kind }))
    .filter((s) => s.n.length >= FALLBACK_WIN);
  if (normSources.length && text.length >= FALLBACK_WIN) {
    for (let i = 0; i + FALLBACK_WIN <= text.length; i += FALLBACK_STEP) {
      const win = normalize(text.slice(i, i + FALLBACK_WIN));
      const hit = normSources.find((s) => s.n.includes(win));
      if (hit) spans.push({ start: i, end: i + FALLBACK_WIN, kind: hit.kind });
    }
  }

  if (spans.length === 0) {
    const t = text.trim();
    return { materialKinds: [], requests: t.length >= MIN_REQUEST ? [t] : [] };
  }
  // Snap to whole words, then merge overlapping/near spans so requests are clean
  // segments rather than window-boundary fragments.
  const snapped = spans.map((s) => {
    const [a, b] = snapToWords(text, s.start, s.end);
    return { start: a, end: b, kind: s.kind };
  });
  const merged = mergeClose(snapped, GAP_MERGE);
  const materialKinds = [...new Set(snapped.map((s) => s.kind))] as MaterialKind[];
  return { materialKinds, requests: gapsToRequests(text, merged) };
}

/**
 * Compute deterministic dissections for the given messages of an assignment.
 * Loads the log records, the sessions' chat-paste + snapshot events, and the
 * assignment instructions; returns messageId → {materialKinds, requests}.
 */
export async function computeDissections(
  assignmentId: string,
  targetIds: Set<number>
): Promise<Map<number, DissectionResult>> {
  if (targetIds.size === 0) return new Map();
  const records = await getQueryRecords(assignmentId);
  const targets = records.filter((r) => targetIds.has(r.messageId));
  if (targets.length === 0) return new Map();
  const sessions = [...new Set(targets.map((r) => r.sessionId))];

  // Composition window per message = (previous user message in the same
  // session, this message]. Grouped/sorted here so we don't rely on the
  // incoming record order.
  const prevTs = new Map<number, Date>();
  const bySession = new Map<string, QueryRecord[]>();
  for (const r of records) {
    const arr = bySession.get(r.sessionId);
    if (arr) arr.push(r);
    else bySession.set(r.sessionId, [r]);
  }
  for (const arr of bySession.values()) {
    arr.sort((a, b) => a.queryTimestamp.getTime() - b.queryTimestamp.getTime());
    let prev = new Date(0);
    for (const r of arr) {
      prevTs.set(r.messageId, prev);
      prev = r.queryTimestamp;
    }
  }

  const [pasteRows, snapRows, asgRows] = await Promise.all([
    db
      .select({ sessionId: editorEvents.sessionId, ts: editorEvents.timestamp, data: editorEvents.eventData })
      .from(editorEvents)
      .where(
        and(
          inArray(editorEvents.sessionId, sessions),
          inArray(editorEvents.eventType, ['paste_internal', 'paste_external'])
        )
      ),
    db
      .select({ sessionId: editorEvents.sessionId, ts: editorEvents.timestamp, data: editorEvents.eventData })
      .from(editorEvents)
      .where(and(inArray(editorEvents.sessionId, sessions), eq(editorEvents.eventType, 'snapshot'))),
    db
      .select({ instructions: assignments.instructions, base: assignments.customSystemPrompt })
      .from(assignments)
      .where(eq(assignments.id, assignmentId)),
  ]);

  const instructionText = normalize(`${asgRows[0]?.instructions ?? ''} ${asgRows[0]?.base ?? ''}`);

  // Chat-pastes per session (targetArea 'chat' only), sorted by time.
  const pastesBySession = new Map<string, { ts: Date; content: string | null; sourceArea: string | null }[]>();
  for (const row of pasteRows) {
    const d = (row.data ?? {}) as Record<string, unknown>;
    if (d.targetArea !== 'chat') continue;
    const entry = {
      ts: row.ts,
      content: typeof d.content === 'string' ? d.content : null,
      sourceArea: typeof d.sourceArea === 'string' ? d.sourceArea : null,
    };
    const arr = pastesBySession.get(row.sessionId);
    if (arr) arr.push(entry);
    else pastesBySession.set(row.sessionId, [entry]);
  }
  for (const arr of pastesBySession.values()) arr.sort((a, b) => a.ts.getTime() - b.ts.getTime());

  // Snapshots per session (text extracted once), sorted by time.
  const snapsBySession = new Map<string, { ts: Date; text: string }[]>();
  for (const row of snapRows) {
    const entry = { ts: row.ts, text: blockText(row.data) };
    const arr = snapsBySession.get(row.sessionId);
    if (arr) arr.push(entry);
    else snapsBySession.set(row.sessionId, [entry]);
  }
  for (const arr of snapsBySession.values()) arr.sort((a, b) => a.ts.getTime() - b.ts.getTime());

  const latestSnapshotBefore = (sessionId: string, ts: Date): string => {
    const arr = snapsBySession.get(sessionId);
    if (!arr) return '';
    let text = '';
    for (const s of arr) {
      if (s.ts <= ts) text = s.text;
      else break;
    }
    return text;
  };

  const out = new Map<number, DissectionResult>();
  for (const r of targets) {
    const start = prevTs.get(r.messageId) ?? new Date(0);
    const windowPastes = (pastesBySession.get(r.sessionId) ?? []).filter(
      (p) => p.ts > start && p.ts <= r.queryTimestamp
    );
    const sources: { text: string; kind: MaterialKind }[] = [
      { text: latestSnapshotBefore(r.sessionId, r.queryTimestamp), kind: 'student_draft' },
      { text: instructionText, kind: 'assignment_prompt' },
      { text: r.prevResponseText ?? '', kind: 'prior_bot_reply' },
    ];
    out.set(r.messageId, dissectMessage(r.queryText, windowPastes, sources));
  }
  return out;
}
