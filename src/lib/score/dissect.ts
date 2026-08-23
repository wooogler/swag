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
import { assignments, editorEvents, studentSessions } from '@/db/schema';
import { instructionToPlainText } from '@/lib/instruction-content';
import type { MaterialKind, MaterialSpan, PromptDissection } from './intents';
import { getQueryRecords, type QueryRecord } from './queries';

const MIN_MATERIAL = 12; // ignore matches shorter than this (noise)
const FALLBACK_WIN = 40; // sliding-window size for source verbatim matching
const FALLBACK_STEP = 12;
const GAP_MERGE = 24; // merge material spans separated by ≤ this (window/step slack)
const MIN_REQUEST = 6; // drop request gaps shorter than this once trimmed

/** Words a leftover clause can be and still be one.
 *
 * The split errs at the SEAM of a pasted run: the run's last clause ends up
 * outside it ("future.", "that make us human.", "jobs that"), and a bare clause
 * sitting beside a Material marker reads as an imperative — the judge then
 * rates a request the student never typed, and a message that is pure pasted
 * material gets claimed by an intent. The rating prompt already describes the
 * shape (intent-prompts.ts, MATERIAL_NOTATION) and asks the model to see
 * through it; this drops it at the source instead, so `requests` is empty and
 * the prompt's no-request rule applies with nothing to argue against. */
const MAX_ORPHAN_WORDS = 4;

/** What makes a SHORT segment a real ask rather than a leftover clause. These
 * are the openers of the short referential asks the dissection has to keep —
 * "make it longer", "keep going", "is this better" — so the guard below can be
 * blind to everything else about the words. */
const REQUEST_OPENER =
  /^(add|again|are|be|can|check|complete|continue|could|do|does|expand|explain|finish|fix|give|help|how|is|keep|less|make|more|please|rephrase|review|reword|rewrite|shorten|should|show|summarize|translate|try|use|what|when|where|which|who|why|write)\b/i;

const SENTENCE_END = /[.!?:;]["'’”)]?$/;

/**
 * Is this gap the tail (or head) of the pasted run beside it, rather than
 * something the student typed?
 *
 * Shape decides it, because shape is all the seam leaves behind: a short
 * segment that runs INTO its neighbouring material with no sentence boundary
 * between the two. A segment on its own line, one that closes a sentence
 * before the paste begins ("This is my essay:"), or one that opens like an
 * instruction is the student writing, and is kept.
 */
function isSeamOrphan(
  text: string,
  /** The gap WITH its whitespace — a line break beside it is the evidence that
   * the student started something of their own. */
  raw: string,
  prevEnd: number | null,
  hasNext: boolean
): boolean {
  const seg = raw.trim();
  if (seg.split(/\s+/).length > MAX_ORPHAN_WORDS) return false;
  // The opener list is written in plain stems, so a contraction has to be
  // normalised before it is consulted — "shouldn't this be: …" is an ask, and
  // one that leads straight into the paste it is asking about.
  if (REQUEST_OPENER.test(seg.replace(/^([A-Za-z]+)n['’]t\b/, '$1'))) return false;
  if (seg.includes('?')) return false;
  // Continues the run before it: nothing but spaces between them, and that run
  // stopped mid-sentence.
  const lead = raw.slice(0, raw.length - raw.trimStart().length);
  if (prevEnd !== null && !lead.includes('\n')) {
    if (!SENTENCE_END.test(text.slice(0, prevEnd).trimEnd())) return true;
  }
  // Runs into the run after it: the segment itself does not close a sentence.
  const trail = raw.slice(raw.trimEnd().length);
  if (hasNext && !trail.includes('\n')) {
    if (!SENTENCE_END.test(seg)) return true;
  }
  return false;
}

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

/** Markdown markers and list bullets removed, so text copied out of the RENDERED
 * chat can be compared against the markdown a message is stored as. Mirrors
 * copy-validator's stripMarkdown, plus the block-level markers a multi-line
 * reply carries. */
function stripMarkup(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s{0,3}(?:[-*+]|\d+[.)])\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The kind a paste's recorded sourceArea implies on its own.
 *
 * 'chat' is deliberately absent: it means "copied from the chat panel", which
 * covers the bot's replies, the student's own earlier turns and the chat input
 * box alike — ChatMessages and ChatPanel all record the same source — so it
 * cannot name a kind by itself and is resolved from the content instead.
 */
function sourceToKind(sourceArea: string | null | undefined): MaterialKind | null {
  switch (sourceArea) {
    case 'editor':
      return 'student_draft';
    case 'instruction':
      return 'assignment_prompt';
    case 'chat':
      return null;
    default:
      return 'other';
  }
}

type Span = {
  start: number;
  end: number;
  kind: MaterialKind;
  /** Recorded-paste span: its boundaries and its kind are both authoritative.
   * A verbatim-match span is approximate on both counts (40-char windows). */
  exact: boolean;
  sourceChars: number | null;
};

/** Extend a span to whole-word boundaries so requests aren't cut mid-word. */
function snapToWords(text: string, start: number, end: number): [number, number] {
  let s = start;
  let e = Math.min(end, text.length);
  while (s > 0 && !/\s/.test(text[s - 1])) s--;
  while (e < text.length && !/\s/.test(text[e])) e++;
  return [s, e];
}

/** Cut the spans down to a non-overlapping set, letting recorded pastes claim
 * their region first: where a verbatim-match window overlaps a paste, the
 * paste's attribution wins (a student who pasted the prompt into the editor
 * makes the draft and the prompt match the same text — see the kind order in
 * computeDissections). Remainders below MIN_MATERIAL are noise and dropped. */
function resolveOverlaps(spans: Span[]): Span[] {
  const ordered = [...spans].sort(
    (a, b) => Number(b.exact) - Number(a.exact) || a.start - b.start || b.end - a.end
  );
  const claimed: Span[] = [];
  for (const s of ordered) {
    let pieces: [number, number][] = [[s.start, s.end]];
    for (const c of claimed) {
      const next: [number, number][] = [];
      for (const [a, b] of pieces) {
        if (c.end <= a || c.start >= b) next.push([a, b]);
        else {
          if (c.start > a) next.push([a, c.start]);
          if (c.end < b) next.push([c.end, b]);
        }
      }
      pieces = next;
    }
    for (const [a, b] of pieces) if (b - a >= MIN_MATERIAL) claimed.push({ ...s, start: a, end: b });
  }
  return claimed.sort((a, b) => a.start - b.start);
}

/** Merge each run of SAME-kind spans separated by ≤ `gap`, then hand any
 * remaining sub-gap hole between two DIFFERENT kinds to the earlier run —
 * that hole is window-granularity slack, not typed text, unless both sides are
 * recorded pastes (whose boundaries are exact and may genuinely abut a
 * request). Merging across kinds is what used to erase the per-run kind. */
function mergeRuns(spans: Span[], gap: number): Span[] {
  const out: Span[] = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    if (last && last.kind === s.kind && s.start <= last.end + gap) {
      last.end = Math.max(last.end, s.end);
      last.exact = last.exact && s.exact;
      last.sourceChars = last.sourceChars ?? s.sourceChars;
    } else out.push({ ...s });
  }
  for (let i = 0; i + 1 < out.length; i++) {
    const a = out[i];
    const b = out[i + 1];
    if (b.start > a.end && b.start - a.end <= gap && !(a.exact && b.exact)) a.end = b.start;
  }
  return out;
}

/** Requests = the material-free segments of the ORIGINAL text (verbatim), so the
 * viewer can locate each with a plain substring search. Fragments (too short or
 * word-less) are dropped, and so are the seam orphans above — a message that is
 * pure pasted material must report NO request rather than its own last clause. */
function gapsToRequests(text: string, spans: Span[]): string[] {
  const reqs: string[] = [];
  let cursor = 0;
  let prevEnd: number | null = null;
  const take = (start: number, end: number, hasNext: boolean) => {
    const raw = text.slice(start, end);
    const seg = raw.trim();
    if (seg.length < MIN_REQUEST || !/\w/.test(seg)) return;
    if (isSeamOrphan(text, raw, prevEnd, hasNext)) return;
    reqs.push(seg);
  };
  for (const s of spans) {
    if (s.start > cursor) take(cursor, s.start, true);
    cursor = Math.max(cursor, s.end);
    prevEnd = cursor;
  }
  if (cursor < text.length) take(cursor, text.length, false);
  return reqs;
}

export interface DissectSource {
  text: string;
  kind: MaterialKind;
  /** Whether the verbatim sliding-window sweep may INFER this source from a
   * match alone (default true). False = the source only attributes a recorded
   * paste. The student's own earlier turns are false: two turns of a session
   * routinely share a phrase, and inferring material there would quietly demote
   * a genuine typed request to pasted material. */
  inferable?: boolean;
}

/**
 * Dissect one message given its chat-pastes (in the composition window) and the
 * candidate source texts. Pure — positions are in the ORIGINAL message text.
 *
 * `sources` is ordered: the first source containing a matched window wins the
 * attribution, so the caller decides the tie-break (see computeDissections).
 */
export function dissectMessage(
  text: string,
  windowPastes: { content: string | null; sourceArea: string | null }[],
  sources: DissectSource[]
): PromptDissection {
  const { norm: nText, map } = normWithMap(text);
  const spans: Span[] = [];
  const normSources = sources
    .map((s) => ({
      n: normalize(s.text),
      stripped: stripMarkup(s.text),
      kind: s.kind,
      inferable: s.inferable !== false,
    }))
    .filter((s) => s.n.length > 0);

  /** The source a pasted run came from: its kind (when the paste log could not
   * name one) and its size, the denominator of the extent shown on the tag.
   * Only a source that actually CONTAINS the run counts — comparing markup-free
   * too, since the clipboard carries the RENDERED text while a chat message is
   * stored as markdown. With no such source the extent stays unknown and the
   * tag shows the kind alone rather than a percentage of the wrong thing. */
  const resolvePaste = (
    declared: MaterialKind | null,
    content: string
  ): { kind: MaterialKind; sourceChars: number | null } => {
    const stripped = stripMarkup(content);
    const hit = normSources.find(
      (s) =>
        (declared === null || s.kind === declared) &&
        (s.n.includes(content) || s.stripped.includes(stripped))
    );
    if (hit) return { kind: hit.kind, sourceChars: hit.n.length };
    // Unattributable: a chat paste that matches no stored turn (the chat INPUT
    // box is copyable too, and its text was never a message) is 'other' rather
    // than a guess at which side of the conversation it came from.
    return { kind: declared ?? 'other', sourceChars: null };
  };

  // 1. Pasted material — normalized match mapped back to one contiguous span.
  for (const p of windowPastes) {
    const c = normalize(p.content ?? '');
    if (c.length < MIN_MATERIAL) continue;
    const j = nText.indexOf(c);
    if (j === -1) continue;
    const { kind, sourceChars } = resolvePaste(sourceToKind(p.sourceArea), c);
    spans.push({
      start: map[j],
      end: map[j + c.length - 1] + 1,
      kind,
      exact: true,
      sourceChars,
    });
  }

  // 2. Re-typed / referenced material — sliding-window verbatim match vs sources.
  const matchable = normSources.filter((s) => s.inferable && s.n.length >= FALLBACK_WIN);
  if (matchable.length && text.length >= FALLBACK_WIN) {
    for (let i = 0; i + FALLBACK_WIN <= text.length; i += FALLBACK_STEP) {
      const win = normalize(text.slice(i, i + FALLBACK_WIN));
      const hit = matchable.find((s) => s.n.includes(win));
      if (hit) {
        spans.push({
          start: i,
          end: i + FALLBACK_WIN,
          kind: hit.kind,
          exact: false,
          sourceChars: hit.n.length,
        });
      }
    }
  }

  if (spans.length === 0) {
    const t = text.trim();
    return { materialKinds: [], requests: t.length >= MIN_REQUEST ? [t] : [], materials: [] };
  }
  // Snap to whole words, resolve overlaps (pastes first), then merge each
  // same-kind run so requests are clean segments rather than window fragments.
  const snapped = spans.map((s) => {
    const [a, b] = snapToWords(text, s.start, s.end);
    return { ...s, start: a, end: b };
  });
  const merged = mergeRuns(resolveOverlaps(snapped), GAP_MERGE);
  const materials: MaterialSpan[] = merged.map((s) => {
    const slice = text.slice(s.start, s.end);
    return {
      text: slice.trim(),
      kind: s.kind,
      chars: normalize(slice).length,
      sourceChars: s.sourceChars,
    };
  });
  return {
    materialKinds: [...new Set(merged.map((s) => s.kind))],
    requests: gapsToRequests(text, merged),
    materials,
  };
}

/**
 * Whether this assignment has an editor-event log to reconstruct from at all.
 *
 * A study clone copies the master's message log and its cached dissections but
 * NOT the events (see provision.ts) — so re-dissecting a clone would silently
 * replace an evidence-based split with one that can find no pasted material at
 * all. Callers must therefore treat a clone's stored dissection as final, the
 * same way cloned query types are never re-judged.
 */
export async function hasEditorEventLog(assignmentId: string): Promise<boolean> {
  const rows = await db
    .select({ id: editorEvents.id })
    .from(editorEvents)
    .innerJoin(studentSessions, eq(studentSessions.id, editorEvents.sessionId))
    .where(eq(studentSessions.assignmentId, assignmentId))
    .limit(1);
  return rows.length > 0;
}

/**
 * Compute deterministic dissections for the given messages of an assignment.
 * Loads the log records, the sessions' chat-paste + snapshot events, and the
 * assignment instructions; returns messageId → the split.
 *
 * PRECONDITION: the assignment owns its editor-event log (hasEditorEventLog).
 */
export async function computeDissections(
  assignmentId: string,
  targetIds: Set<number>
): Promise<Map<number, PromptDissection>> {
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

  // Everything the student could have copied out of the chat panel BEFORE this
  // message: every earlier reply and every earlier turn of their own. The paste
  // log records only that a paste came from the chat, so this is what decides
  // WHICH of the two it was.
  const priorTurns = new Map<number, { replies: string[]; questions: string[] }>();
  const byConversation = new Map<string, QueryRecord[]>();
  for (const r of records) {
    const arr = byConversation.get(r.conversationId);
    if (arr) arr.push(r);
    else byConversation.set(r.conversationId, [r]);
  }
  for (const arr of byConversation.values()) {
    arr.sort((a, b) => a.turnIndex - b.turnIndex || a.messageId - b.messageId);
    const replies: string[] = [];
    const questions: string[] = [];
    for (const r of arr) {
      priorTurns.set(r.messageId, { replies: [...replies], questions: [...questions] });
      if (r.responseText) replies.push(r.responseText);
      questions.push(r.queryText);
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
      .select({ instructions: assignments.instructions, criteria: assignments.criteria })
      .from(assignments)
      .where(eq(assignments.id, assignmentId)),
  ]);

  // The two texts the student can actually see and copy, as PLAIN TEXT: a
  // BlockNote-authored prompt is stored as a JSON document, and matching a
  // quoted sentence against that JSON only works by accident (inside a single
  // text node, never across one). The instructor's AI guidance
  // (customSystemPrompt) is deliberately NOT here — students never see it, so
  // it cannot be pasted material, and counting it only inflated the prompt's
  // size, which is now the denominator of the coverage shown on the tag.
  const instructionText = normalize(instructionToPlainText(asgRows[0]?.instructions ?? ''));
  const criteriaText = normalize(instructionToPlainText(asgRows[0]?.criteria ?? ''));

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

  const out = new Map<number, PromptDissection>();
  for (const r of targets) {
    const start = prevTs.get(r.messageId) ?? new Date(0);
    const windowPastes = (pastesBySession.get(r.sessionId) ?? []).filter(
      (p) => p.ts > start && p.ts <= r.queryTimestamp
    );
    // Order matters: the first source containing a matched window wins. The
    // assignment prompt goes FIRST because students routinely paste it into
    // their own draft, which would otherwise make every quote of the prompt
    // read as "own draft" — the draft is the broader, less specific source.
    // The student's own turns come LAST so that text the bot quoted back is
    // still read as the bot's reply, which is where they copied it from.
    const prior = priorTurns.get(r.messageId) ?? { replies: [], questions: [] };
    const sources: DissectSource[] = [
      { text: instructionText, kind: 'assignment_prompt' },
      { text: criteriaText, kind: 'assignment_prompt' },
      { text: latestSnapshotBefore(r.sessionId, r.queryTimestamp), kind: 'student_draft' },
      ...prior.replies.map((text) => ({ text, kind: 'prior_bot_reply' as const })),
      ...prior.questions.map((text) => ({
        text,
        kind: 'own_question' as const,
        inferable: false,
      })),
    ];
    out.set(r.messageId, dissectMessage(r.queryText, windowPastes, sources));
  }
  return out;
}
