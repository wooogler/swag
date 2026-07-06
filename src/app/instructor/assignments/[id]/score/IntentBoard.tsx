'use client';

/**
 * SCORE v6 — the intents-mode main page (S1): BASE PROMPT card + INTENTS
 * panel + NEEDS DECISION box + UNASSIGNED row on the left, the selected
 * Question Group in the middle, and the read-only Conversation viewer on the
 * right (Request highlight + Material chips).
 *
 * Assignment resolution is derived here with the shared deterministic
 * resolver (intents.ts) — nothing is stored; link/pin edits re-derive
 * instantly after router.refresh().
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import {
  applyPinOverrides,
  boundaryKey,
  MATERIAL_LABELS,
  RATING_LABELS,
  ratingRank,
  resolveAssignment,
  type AssignmentResolution,
  type MaterialKind,
  type RatingLevel,
} from '@/lib/score/intents';
import { SCORE_MODELS, SCORE_MODEL_LABELS } from '@/lib/score/models';
import {
  AlertTriangle,
  ChevronRight,
  Link2,
  MessageSquare,
  Pencil,
  Pin,
  Play,
  Plus,
  RefreshCw,
  Search,
  Wand2,
  X,
} from 'lucide-react';
import type { ScoreQueryRow } from './ScoreViewer';
import NewIntentModal from './NewIntentModal';
import DecideOwnershipModal from './DecideOwnershipModal';
import ReviseModal from './ReviseModal';

export interface IntentSummary {
  id: number;
  title: string;
  definition: string;
  rule: string | null;
  archived: boolean;
  pinCount: number;
}

export interface IntentLinkSummary {
  fromIntentId: number;
  toIntentId: number;
}

export interface JelsonChip {
  text: string;
  className: string;
  title: string;
}

interface IntentBoardProps {
  assignmentId: string;
  rows: ScoreQueryRow[];
  intents: IntentSummary[];
  links: IntentLinkSummary[];
  versionNo: number;
  pendingRatings: number;
  basePrompt: string;
  defaultModel: string;
  openaiConfigured: boolean;
  /** Jelson tag chip for a row (from the tags-layer index) — browse aid only. */
  jelsonChipOf: (row: ScoreQueryRow) => JelsonChip | null;
  onBrowseTags: () => void;
}

type IntentSelection =
  | { kind: 'all' }
  | { kind: 'intent'; id: number }
  | { kind: 'unassigned' }
  | { kind: 'pending' }
  | { kind: 'boundary'; key: string };

const RATING_CHIP: Record<RatingLevel, string> = {
  clearly_in: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  probably_in: 'bg-lime-50 text-lime-700 border-lime-200',
  unsure: 'bg-amber-50 text-amber-700 border-amber-200',
  probably_out: 'bg-slate-50 text-slate-600 border-slate-200',
  clearly_out: 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] border-[hsl(var(--border))]',
};

const MATERIAL_CHIP = 'bg-violet-50 text-violet-700 border-violet-200';

function Badge({ n }: { n: number }) {
  return (
    <span className="text-[11px] tabular-nums px-1.5 py-0.5 rounded-full bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]">
      {n}
    </span>
  );
}

function SmallChip({ className, children, title }: { className: string; children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] font-medium whitespace-nowrap ${className}`}
    >
      {children}
    </span>
  );
}

function snippet(text: string, maxLen: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > maxLen ? `${clean.slice(0, maxLen)}…` : clean;
}

/** Highlight each dissected Request verbatim inside the full message (§2.1:
 * the viewer highlights the Request; Material stays plain). */
function highlightRequests(text: string, requests: string[]): React.ReactNode {
  if (requests.length === 0) return text;
  // Collect non-overlapping match ranges (first occurrence per request,
  // case-insensitive fallback), then render.
  const ranges: [number, number][] = [];
  const lower = text.toLowerCase();
  for (const req of requests) {
    const r = req.trim();
    if (!r) continue;
    let idx = text.indexOf(r);
    if (idx === -1) idx = lower.indexOf(r.toLowerCase());
    if (idx === -1) continue;
    ranges.push([idx, idx + r.length]);
  }
  if (ranges.length === 0) return text;
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r] as [number, number]);
  }
  const nodes: React.ReactNode[] = [];
  let pos = 0;
  merged.forEach(([s, e], i) => {
    if (s > pos) nodes.push(text.slice(pos, s));
    nodes.push(
      <span key={i} className="bg-sky-100 text-sky-900 rounded-[2px] px-0 mx-0 box-decoration-clone">
        {text.slice(s, e)}
      </span>
    );
    pos = e;
  });
  if (pos < text.length) nodes.push(text.slice(pos));
  return nodes;
}

export default function IntentBoard({
  assignmentId,
  rows,
  intents,
  links,
  versionNo,
  pendingRatings,
  basePrompt,
  defaultModel,
  openaiConfigured,
  jelsonChipOf,
  onBrowseTags,
}: IntentBoardProps) {
  const router = useRouter();
  const activeIntents = useMemo(() => intents.filter((i) => !i.archived), [intents]);
  const intentById = useMemo(() => new Map(intents.map((i) => [i.id, i])), [intents]);
  const titleOf = (id: number) => intentById.get(id)?.title ?? `Intent ${id}`;

  const [selection, setSelection] = useState<IntentSelection>({ kind: 'all' });
  const [selectedMessageId, setSelectedMessageId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [sortMode, setSortMode] = useState<'rating' | 'recent' | 'oldest'>('rating');
  const [selectedModel, setSelectedModel] = useState(defaultModel);
  const [basePromptOpen, setBasePromptOpen] = useState(false);
  const [newIntentOpen, setNewIntentOpen] = useState(false);
  const [newIntentSeed, setNewIntentSeed] = useState<{ title?: string; definition?: string } | null>(null);
  const [editIntent, setEditIntent] = useState<IntentSummary | null>(null);
  const [ownershipPair, setOwnershipPair] = useState<{
    a: IntentSummary;
    b: IntentSummary;
    messageIds: number[];
  } | null>(null);
  const [reviseTarget, setReviseTarget] = useState<{ row: ScoreQueryRow; intent: IntentSummary } | null>(null);

  // ---- Exclusive assignment, derived per message -------------------------
  const activeIds = useMemo(() => activeIntents.map((i) => i.id), [activeIntents]);
  const resolutions = useMemo(() => {
    const map = new Map<number, AssignmentResolution>();
    for (const r of rows) {
      const ratings = new Map<number, RatingLevel>();
      for (const [idStr, v] of Object.entries(r.intentRatings)) {
        // Stale ratings still count for display continuity (same philosophy
        // as classify force: show the previous state until overwritten).
        ratings.set(Number(idStr), v.rating);
      }
      // Instructor pins settle the pinned question immediately (§1.6).
      const pins = new Map<number, 'in' | 'out'>(
        Object.entries(r.pinnedIntents).map(([k, v]) => [Number(k), v])
      );
      map.set(r.messageId, resolveAssignment(applyPinOverrides(ratings, pins), activeIds, links));
    }
    return map;
  }, [rows, activeIds, links]);

  const counts = useMemo(() => {
    const perIntent = new Map<number, number>();
    let unassigned = 0;
    let pending = 0;
    const boundaries = new Map<string, { intentIds: number[]; count: number }>();
    for (const r of rows) {
      const res = resolutions.get(r.messageId);
      if (!res) continue;
      if (res.kind === 'assigned') perIntent.set(res.intentId, (perIntent.get(res.intentId) ?? 0) + 1);
      else if (res.kind === 'fallback') unassigned += 1;
      else if (res.kind === 'pending') pending += 1;
      else {
        const key = boundaryKey(res.intentIds);
        const e = boundaries.get(key);
        if (e) e.count += 1;
        else boundaries.set(key, { intentIds: [...res.intentIds], count: 1 });
      }
    }
    const boundaryList = [...boundaries.entries()]
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => b.count - a.count);
    return { perIntent, unassigned, pending, boundaryList };
  }, [rows, resolutions]);

  // ---- Middle column ------------------------------------------------------
  // Selection can outlive its target (intent archived, boundary resolved,
  // pending bucket drained after a rate run) — fall back to "All" instead of
  // pointing at an empty, unreachable group.
  useEffect(() => {
    const gone =
      (selection.kind === 'intent' && !activeIntents.some((i) => i.id === selection.id)) ||
      (selection.kind === 'boundary' && !counts.boundaryList.some((b) => b.key === selection.key)) ||
      (selection.kind === 'pending' && counts.pending === 0);
    if (gone) setSelection({ kind: 'all' });
  }, [selection, activeIntents, counts]);

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      const res = resolutions.get(r.messageId);
      if (!res) return false;
      switch (selection.kind) {
        case 'all':
          return true;
        case 'intent':
          return res.kind === 'assigned' && res.intentId === selection.id;
        case 'unassigned':
          return res.kind === 'fallback';
        case 'pending':
          return res.kind === 'pending';
        case 'boundary':
          return res.kind === 'boundary' && boundaryKey(res.intentIds) === selection.key;
      }
    });
  }, [rows, resolutions, selection]);

  const searchedRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return filteredRows;
    return filteredRows.filter((r) => r.queryText.toLowerCase().includes(q));
  }, [filteredRows, search]);

  /** Effective rating for sorting/chips in the current selection context —
   * instructor pins override the classifier (same rule the resolver uses). */
  const contextRating = (r: ScoreQueryRow): RatingLevel | null => {
    if (selection.kind !== 'intent') return null;
    const pin = r.pinnedIntents[selection.id];
    if (pin) return pin === 'in' ? 'clearly_in' : 'clearly_out';
    return r.intentRatings[selection.id]?.rating ?? null;
  };

  const sortedRows = useMemo(() => {
    const ts = (r: ScoreQueryRow) => new Date(r.queryTimestamp).getTime();
    const arr = searchedRows.slice();
    if (sortMode === 'rating' && selection.kind === 'intent') {
      arr.sort(
        (a, b) => ratingRank(contextRating(a)) - ratingRank(contextRating(b)) || ts(b) - ts(a)
      );
    } else if (sortMode === 'oldest') {
      arr.sort((a, b) => ts(a) - ts(b));
    } else {
      arr.sort((a, b) => ts(b) - ts(a));
    }
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchedRows, sortMode, selection]);

  const selectedRow = useMemo(
    () => rows.find((r) => r.messageId === selectedMessageId) ?? null,
    [rows, selectedMessageId]
  );

  // ---- Rate runner (same client-driven batch loop as classification) ------
  const [running, setRunning] = useState(false);
  const [runProgress, setRunProgress] = useState<{ rated: number; total: number; failed: number } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  async function runRating(force: boolean) {
    if (running) return;
    if (force && !window.confirm('Re-rate ALL queries against every intent? This re-runs the LLM for the whole log.')) {
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setRunError(null);
    setRunProgress({ rated: force ? 0 : rows.length - pendingRatings, total: rows.length, failed: 0 });
    let first = true;
    let totalFailed = 0;
    try {
      while (true) {
        const res = await fetch(`/api/instructor/assignments/${assignmentId}/score/rate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ force: first && force, limit: 40, model: selectedModel }),
          signal: controller.signal,
        });
        const data = await res.json().catch(() => ({}));
        if (!mountedRef.current) return;
        if (!res.ok) {
          setRunError(typeof data?.message === 'string' ? data.message : 'Rating request failed.');
          break;
        }
        first = false;
        totalFailed += data.failed ?? 0;
        setRunProgress({ rated: data.rated ?? 0, total: data.total ?? rows.length, failed: totalFailed });
        if ((data.remaining ?? 0) <= 0 || (data.processed ?? 0) === 0) break;
        if ((data.succeeded ?? 0) === 0) {
          setRunError(`Rating stalled — ${data.failed ?? 0} LLM calls failed this batch. Check the server logs.`);
          break;
        }
      }
    } catch (err) {
      if ((err as Error)?.name === 'AbortError' || !mountedRef.current) return;
      setRunError('Rating was interrupted. Please try again.');
    } finally {
      if (mountedRef.current) {
        setRunning(false);
        router.refresh();
      }
    }
  }

  const selectionLabel = (() => {
    switch (selection.kind) {
      case 'all':
        return 'All questions';
      case 'intent':
        return titleOf(selection.id);
      case 'unassigned':
        return 'Unassigned (Base only)';
      case 'pending':
        return 'Not yet rated';
      case 'boundary':
        return selection.key.split('+').map((s) => titleOf(Number(s))).join(' ↔ ');
    }
  })();

  return (
    <div className="space-y-4">
      {/* Control bar — version badge, rate runner, new intent */}
      <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 flex flex-wrap items-center gap-3">
        <span
          className="text-xs font-mono px-2 py-1 rounded bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]"
          title="Intent config version — every applied change snapshots a new version"
        >
          v{versionNo}
        </span>
        <span className="text-sm text-[hsl(var(--muted-foreground))]">
          {activeIntents.length} intent{activeIntents.length === 1 ? '' : 's'} · {rows.length} questions
        </span>

        <div className="flex-1" />

        {runError && (
          <span className="flex items-center gap-1 text-xs text-red-600">
            <AlertTriangle className="w-3.5 h-3.5" /> {runError}
          </span>
        )}
        {running && runProgress && (
          <div className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
            <div className="w-32 h-1.5 rounded bg-[hsl(var(--muted))] overflow-hidden">
              <div
                className="h-full bg-[hsl(var(--primary))] transition-all"
                style={{ width: `${runProgress.total ? Math.round((runProgress.rated / runProgress.total) * 100) : 0}%` }}
              />
            </div>
            <span className="tabular-nums">
              {runProgress.rated}/{runProgress.total}
              {runProgress.failed > 0 && <span className="text-red-600"> · {runProgress.failed} failed</span>}
            </span>
          </div>
        )}

        <select
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          title="Model used for intent rating"
          className="text-xs border border-[hsl(var(--border))] rounded px-1.5 py-1 bg-[hsl(var(--background))] text-[hsl(var(--foreground))]"
        >
          {SCORE_MODELS.map((m) => (
            <option key={m} value={m}>
              {SCORE_MODEL_LABELS[m] ?? m}
            </option>
          ))}
        </select>

        {activeIntents.length > 0 && (
          <>
            <button
              onClick={() => runRating(false)}
              disabled={running || !openaiConfigured || pendingRatings === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] disabled:opacity-50"
              title={openaiConfigured ? 'Rate stale/new questions against the current intents' : 'OPENAI_API_KEY is not configured'}
            >
              <Play className="w-3.5 h-3.5" /> Rate {pendingRatings > 0 ? pendingRatings : ''} remaining
            </button>
            <button
              onClick={() => runRating(true)}
              disabled={running || !openaiConfigured}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs border border-[hsl(var(--border))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] disabled:opacity-50"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Re-rate all
            </button>
          </>
        )}
        <button
          onClick={() => setNewIntentOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-[hsl(var(--primary))] text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/10"
        >
          <Plus className="w-3.5 h-3.5" /> New Intent
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)_minmax(0,1.1fr)] gap-4 h-[calc(100vh-280px)] min-h-[520px]">
        {/* LEFT — Base prompt · Intents · Needs decision · Unassigned */}
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-y-auto">
          {/* BASE PROMPT (read-only, managed in assignment settings) */}
          <div className="border-b border-[hsl(var(--border))] px-3 py-2">
            <button
              onClick={() => setBasePromptOpen((v) => !v)}
              className="w-full text-left flex items-center justify-between gap-2"
            >
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                Base Prompt
              </span>
              <ChevronRight
                className={`w-3.5 h-3.5 text-[hsl(var(--muted-foreground))] transition-transform ${basePromptOpen ? 'rotate-90' : ''}`}
              />
            </button>
            <p
              className={`mt-1 text-xs text-[hsl(var(--muted-foreground))] whitespace-pre-wrap ${basePromptOpen ? '' : 'line-clamp-2'}`}
            >
              {basePrompt}
            </p>
            {basePromptOpen && (
              <p className="mt-1 text-[11px] italic text-[hsl(var(--muted-foreground))]">
                Always applied. Managed in assignment settings — not edited in the SCORE loop.
              </p>
            )}
          </div>

          {/* NEEDS DECISION — only when overlaps exist */}
          {counts.boundaryList.length > 0 && (
            <div className="border-b border-[hsl(var(--border))] bg-amber-50/60 px-3 py-2 space-y-1">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                <AlertTriangle className="w-3.5 h-3.5" /> Needs decision
              </div>
              {counts.boundaryList.map((b) => {
                const pairable = b.intentIds.length === 2;
                return (
                  // Sibling buttons (not nested) — a control inside a control
                  // is unfocusable and an ARIA nested-interactive violation.
                  <div
                    key={b.key}
                    className={`rounded flex items-center ${
                      selection.kind === 'boundary' && selection.key === b.key ? 'bg-amber-100' : 'hover:bg-amber-100/60'
                    }`}
                  >
                    <button
                      onClick={() => setSelection({ kind: 'boundary', key: b.key })}
                      className={`flex-1 min-w-0 text-left px-2 py-1.5 text-xs flex items-center justify-between gap-2 ${
                        selection.kind === 'boundary' && selection.key === b.key ? 'font-medium' : ''
                      }`}
                    >
                      <span className="truncate text-amber-900">
                        {b.intentIds.map((id) => titleOf(id)).join(' ↔ ')}
                      </span>
                      <Badge n={b.count} />
                    </button>
                    {pairable && (
                      <button
                        onClick={() => {
                          const a = intentById.get(b.intentIds[0]);
                          const bb = intentById.get(b.intentIds[1]);
                          if (!a || !bb) return;
                          const messageIds = rows
                            .filter((r) => {
                              const res = resolutions.get(r.messageId);
                              return res?.kind === 'boundary' && boundaryKey(res.intentIds) === b.key;
                            })
                            .map((r) => r.messageId);
                          setOwnershipPair({ a, b: bb, messageIds });
                        }}
                        className="shrink-0 mr-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-600 text-white hover:bg-amber-700"
                      >
                        Decide →
                      </button>
                    )}
                  </div>
                );
              })}
              <p className="text-[11px] text-amber-700/80">
                Until decided, these answer with the base prompt only. Deciding compares the two rules&apos; actual
                responses.
              </p>
            </div>
          )}

          {/* INTENTS */}
          <div className="px-3 pt-2 pb-1 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
              Intents
            </span>
            <button
              onClick={() => setSelection({ kind: 'all' })}
              className={`text-[11px] px-1.5 py-0.5 rounded ${
                selection.kind === 'all' ? 'bg-[hsl(var(--muted))] font-medium' : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]/50'
              }`}
            >
              All · {rows.length}
            </button>
          </div>
          {activeIntents.length === 0 ? (
            <div className="px-3 py-3 text-xs text-[hsl(var(--muted-foreground))] space-y-2">
              <p>
                No intents yet. Create one directly, or browse the unassigned log by Jelson tag and promote a
                tag into your first intent.
              </p>
              <button
                onClick={() => setNewIntentOpen(true)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]"
              >
                <Plus className="w-3 h-3" /> New Intent
              </button>
            </div>
          ) : (
            <div className="pb-1">
              {activeIntents.map((intent) => {
                const active = selection.kind === 'intent' && selection.id === intent.id;
                const exceptLinks = links.filter((l) => l.fromIntentId === intent.id);
                return (
                  <div
                    key={intent.id}
                    className={`group border-b border-[hsl(var(--border))]/60 px-3 py-2 cursor-pointer ${
                      active ? 'bg-[hsl(var(--muted))]' : 'hover:bg-[hsl(var(--muted))]/40'
                    }`}
                    onClick={() => setSelection({ kind: 'intent', id: intent.id })}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium truncate">{intent.title}</span>
                      <span className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditIntent(intent);
                          }}
                          className="opacity-0 group-hover:opacity-100 p-0.5 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                          title="Edit intent"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <Badge n={counts.perIntent.get(intent.id) ?? 0} />
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-[hsl(var(--muted-foreground))] line-clamp-2">
                      <span className="font-semibold">When</span> {intent.definition}
                    </p>
                    <p className="mt-0.5 text-[11px] text-[hsl(var(--muted-foreground))] line-clamp-1">
                      <span className="font-semibold">Then</span>{' '}
                      {intent.rule ? intent.rule : <span className="italic">No rule yet — base prompt applies</span>}
                    </p>
                    {(exceptLinks.length > 0 || intent.pinCount > 0) && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {exceptLinks.map((l) => (
                          <button
                            key={l.toIntentId}
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (
                                !window.confirm(
                                  `Remove the exception link "${intent.title} except ${titleOf(l.toIntentId)}"? Overlapping questions go back to Needs Decision.`
                                )
                              )
                                return;
                              try {
                                const res = await fetch(
                                  `/api/instructor/assignments/${assignmentId}/score/links?from=${l.fromIntentId}&to=${l.toIntentId}`,
                                  { method: 'DELETE' }
                                );
                                if (!res.ok) {
                                  window.alert('Failed to remove the exception link.');
                                  return;
                                }
                                router.refresh();
                              } catch {
                                window.alert('Failed to remove the exception link — network error.');
                              }
                            }}
                            title="Exception link — click to remove (undo restores the overlap to Needs Decision)"
                          >
                            <SmallChip className="bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-100">
                              <Link2 className="w-3 h-3" /> except → {titleOf(l.toIntentId)}
                            </SmallChip>
                          </button>
                        ))}
                        {intent.pinCount > 0 && (
                          <SmallChip className="bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] border-[hsl(var(--border))]">
                            <Pin className="w-3 h-3" /> {intent.pinCount}
                          </SmallChip>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* PENDING + UNASSIGNED */}
          <div className="mt-auto border-t border-[hsl(var(--border))]">
            {counts.pending > 0 && (
              <button
                onClick={() => setSelection({ kind: 'pending' })}
                className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between ${
                  selection.kind === 'pending' ? 'bg-[hsl(var(--muted))] font-medium' : 'hover:bg-[hsl(var(--muted))]/50'
                }`}
                title="Questions not yet rated against every active intent"
              >
                <span className="text-[hsl(var(--muted-foreground))]">Not yet rated</span>
                <Badge n={counts.pending} />
              </button>
            )}
            <button
              onClick={() => setSelection({ kind: 'unassigned' })}
              className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between ${
                selection.kind === 'unassigned' ? 'bg-[hsl(var(--muted))] font-medium' : 'hover:bg-[hsl(var(--muted))]/50'
              }`}
            >
              <span className="text-[hsl(var(--muted-foreground))]">Unassigned (Base only)</span>
              <Badge n={counts.unassigned} />
            </button>
            <button
              onClick={onBrowseTags}
              className="w-full text-left px-3 py-1.5 text-[11px] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]/50 flex items-center gap-1"
              title="Open the Jelson tag browser (the tagging layer) to explore unorganized queries"
            >
              <Wand2 className="w-3 h-3" /> Browse by Jelson tags →
            </button>
          </div>
        </div>

        {/* MIDDLE — question group */}
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-y-auto">
          <div className="sticky top-0 z-10 bg-[hsl(var(--card))] border-b border-[hsl(var(--border))] px-3 py-2 flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))] truncate">
                {selectionLabel}
              </span>
              <Badge n={sortedRows.length} />
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[hsl(var(--muted-foreground))]" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search query text…"
                  className="w-44 pl-7 pr-7 py-1 text-xs border border-[hsl(var(--border))] rounded bg-[hsl(var(--background))] text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
                />
                {search && (
                  <button
                    onClick={() => setSearch('')}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                    aria-label="Clear search"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as typeof sortMode)}
                className="text-xs border border-[hsl(var(--border))] rounded px-1.5 py-0.5 bg-[hsl(var(--background))] text-[hsl(var(--foreground))]"
              >
                <option value="rating">By rating</option>
                <option value="recent">Newest</option>
                <option value="oldest">Oldest</option>
              </select>
            </div>
          </div>
          {sortedRows.length === 0 ? (
            <p className="p-6 text-sm text-[hsl(var(--muted-foreground))]">
              {selection.kind === 'pending' || rows.length === 0
                ? 'No questions here.'
                : activeIntents.length === 0
                  ? 'Create an intent to start organizing the log.'
                  : 'No questions for this selection.'}
            </p>
          ) : (
            <ul className="divide-y divide-[hsl(var(--border))]">
              {sortedRows.map((r) => {
                const active = r.messageId === selectedMessageId;
                const res = resolutions.get(r.messageId);
                const rating = contextRating(r);
                const ratingInfo = selection.kind === 'intent' ? r.intentRatings[selection.id] : undefined;
                const jelson = jelsonChipOf(r);
                return (
                  <li key={r.messageId}>
                    <button
                      onClick={() => setSelectedMessageId(r.messageId)}
                      className={`w-full text-left px-3 py-2.5 ${active ? 'bg-[hsl(var(--muted))]' : 'hover:bg-[hsl(var(--muted))]/40'}`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-[11px] font-mono text-[hsl(var(--muted-foreground))]">
                          {r.participantToken || '—'}
                          {r.turnNumber > 0 && <span className="ml-1 font-sans">· Turn {r.turnNumber}</span>}
                        </span>
                        <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
                          {new Date(r.queryTimestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        </span>
                      </div>
                      <p className="text-sm text-[hsl(var(--foreground))] leading-snug mb-1.5">
                        {snippet(r.queryText, 140)}
                      </p>
                      <div className="flex flex-wrap gap-1 items-center">
                        {rating && (
                          <SmallChip
                            className={RATING_CHIP[rating]}
                            title={
                              selection.kind === 'intent' && r.pinnedIntents[selection.id]
                                ? 'Set by instructor pin'
                                : ratingInfo?.rationale ?? undefined
                            }
                          >
                            {RATING_LABELS[rating]}
                            {selection.kind === 'intent' && r.pinnedIntents[selection.id]
                              ? ' · pinned'
                              : ratingInfo?.stale
                                ? ' · stale'
                                : ''}
                          </SmallChip>
                        )}
                        {selection.kind === 'boundary' &&
                          res?.kind === 'boundary' &&
                          res.intentIds.map((iid) => {
                            // Effective rating — a pin can be what PUT the row
                            // in this boundary; showing the raw rating would
                            // contradict the bucket.
                            const pin = r.pinnedIntents[iid];
                            const eff: RatingLevel = pin
                              ? pin === 'in'
                                ? 'clearly_in'
                                : 'clearly_out'
                              : r.intentRatings[iid]?.rating ?? 'unsure';
                            return (
                              <SmallChip
                                key={iid}
                                className={RATING_CHIP[eff]}
                                title={pin ? 'Set by instructor pin' : undefined}
                              >
                                {titleOf(iid)}: {RATING_LABELS[eff]}
                                {pin ? ' · pinned' : ''}
                              </SmallChip>
                            );
                          })}
                        {(selection.kind === 'unassigned' || selection.kind === 'all' || selection.kind === 'pending') &&
                          res?.kind === 'assigned' && (
                            <SmallChip className="bg-emerald-50 text-emerald-700 border-emerald-200">
                              {titleOf(res.intentId)}
                            </SmallChip>
                          )}
                        {jelson && (selection.kind === 'unassigned' || selection.kind === 'pending') && (
                          <SmallChip className={jelson.className} title={jelson.title}>
                            {jelson.text}
                          </SmallChip>
                        )}
                      </div>
                      {/* Only "unsure" rows surface the rationale inline (§2.1 skim rule). */}
                      {rating === 'unsure' && ratingInfo?.rationale && (
                        <p className="mt-1 text-[11px] italic text-amber-700">{ratingInfo.rationale}</p>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* RIGHT — conversation viewer (read-only) */}
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-y-auto">
          {!selectedRow ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 text-[hsl(var(--muted-foreground))]">
              <MessageSquare className="w-8 h-8 mb-3 opacity-50" />
              <p className="text-sm">Select a question to view the conversation.</p>
            </div>
          ) : (
            <div className="p-4 space-y-4">
              <div className="flex items-start justify-between gap-2 text-xs text-[hsl(var(--muted-foreground))]">
                <div className="flex items-center flex-wrap gap-1.5">
                  <span className="font-mono">
                    {selectedRow.participantToken || '—'}
                    {selectedRow.turnNumber > 0 && <span className="ml-1 font-sans">· Turn {selectedRow.turnNumber}</span>}
                  </span>
                  {selectedRow.dissection?.materialKinds.map((k) => (
                    <SmallChip key={k} className={MATERIAL_CHIP} title="Pasted material detected in this message">
                      {MATERIAL_LABELS[k as MaterialKind] ?? k}
                    </SmallChip>
                  ))}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span>{new Date(selectedRow.queryTimestamp).toLocaleString()}</span>
                  {(() => {
                    const res = resolutions.get(selectedRow.messageId);
                    const owner =
                      res?.kind === 'assigned' ? intentById.get(res.intentId) ?? null : null;
                    return (
                      <button
                        disabled={!owner}
                        onClick={() => owner && setReviseTarget({ row: selectedRow, intent: owner })}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded border border-[hsl(var(--border))] ${
                          owner
                            ? 'text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]'
                            : 'text-[hsl(var(--muted-foreground))] opacity-60 cursor-not-allowed'
                        }`}
                        title={
                          owner
                            ? `Revise the rule of "${owner.title}" from this question`
                            : 'Revise edits the owning intent’s rule — this question is not assigned to an intent'
                        }
                      >
                        Revise <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    );
                  })()}
                </div>
              </div>

              {/* Per-intent ratings for this question (pins override, §1.6) */}
              {activeIntents.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {activeIntents.map((i) => {
                    const rr = selectedRow.intentRatings[i.id];
                    const pin = selectedRow.pinnedIntents[i.id];
                    if (!rr && !pin) return null;
                    const eff: RatingLevel = pin
                      ? pin === 'in'
                        ? 'clearly_in'
                        : 'clearly_out'
                      : rr!.rating;
                    return (
                      <SmallChip
                        key={i.id}
                        className={RATING_CHIP[eff]}
                        title={pin ? 'Set by instructor pin' : rr?.rationale ?? undefined}
                      >
                        {i.title}: {RATING_LABELS[eff]}
                        {pin ? ' · pinned' : ''}
                      </SmallChip>
                    );
                  })}
                </div>
              )}

              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))] mb-1.5">
                  Student message{' '}
                  {selectedRow.dissection && selectedRow.dissection.requests.length > 0 && (
                    <span className="font-normal normal-case">(request highlighted)</span>
                  )}
                </h3>
                <p className="text-sm whitespace-pre-wrap rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 p-3">
                  {highlightRequests(selectedRow.queryText, selectedRow.dissection?.requests ?? [])}
                </p>
              </section>

              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))] mb-1.5">
                  Chatbot response
                </h3>
                {selectedRow.responseText && selectedRow.responseText.trim() ? (
                  <div className="prose prose-sm max-w-none dark:prose-invert prose-pre:bg-[hsl(var(--muted))] prose-pre:text-[hsl(var(--foreground))] prose-pre:border prose-pre:border-[hsl(var(--border))]">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{selectedRow.responseText}</ReactMarkdown>
                  </div>
                ) : (
                  <p className="text-sm text-[hsl(var(--muted-foreground))] italic">
                    No chatbot response was recorded for this question.
                  </p>
                )}
              </section>
            </div>
          )}
        </div>
      </div>

      <NewIntentModal
        open={newIntentOpen}
        onClose={() => {
          setNewIntentOpen(false);
          setNewIntentSeed(null);
          router.refresh();
        }}
        assignmentId={assignmentId}
        model={selectedModel}
        openaiConfigured={openaiConfigured}
        seed={newIntentSeed}
      />

      {ownershipPair && (
        <DecideOwnershipModal
          assignmentId={assignmentId}
          intentA={ownershipPair.a}
          intentB={ownershipPair.b}
          messageIds={ownershipPair.messageIds}
          onClose={(changed) => {
            setOwnershipPair(null);
            if (changed) router.refresh();
          }}
          onCreateNew={() => {
            // C-intent flow (§1.7): the overlap region deserves its own
            // response — seed a new intent scoped to exactly that region.
            const { a, b } = ownershipPair;
            setOwnershipPair(null);
            setNewIntentSeed({
              title: '',
              definition: `asks for something that matches both "${a.title}" and "${b.title}" at the same time — <describe the specific combined situation this intent owns>`,
            });
            setNewIntentOpen(true);
          }}
        />
      )}

      {reviseTarget && (
        <ReviseModal
          assignmentId={assignmentId}
          row={reviseTarget.row}
          intent={reviseTarget.intent}
          onClose={(changed) => {
            setReviseTarget(null);
            if (changed) router.refresh();
          }}
          onCreateInstead={() => {
            // §2.3: switching from Revise makes the question being viewed the
            // seed of the new intent.
            const q = reviseTarget.row.queryText.replace(/\s+/g, ' ').trim();
            setReviseTarget(null);
            setNewIntentSeed({
              title: '',
              definition: `asks the chatbot to <describe the request> — e.g. "${q.length > 120 ? `${q.slice(0, 120)}…` : q}"`,
            });
            setNewIntentOpen(true);
          }}
        />
      )}

      {editIntent && (
        <IntentEditModal
          intent={editIntent}
          assignmentId={assignmentId}
          onClose={(changed) => {
            setEditIntent(null);
            if (changed) router.refresh();
          }}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Intent edit modal — direct title/definition/rule edit + archive.        */
/* (Feedback-driven rule diffs arrive with the Revise phase; this is the   */
/* §1.10 "직접 편집" action only.)                                          */
/* ---------------------------------------------------------------------- */
function IntentEditModal({
  intent,
  assignmentId,
  onClose,
}: {
  intent: IntentSummary;
  assignmentId: string;
  onClose: (changed: boolean) => void;
}) {
  const [title, setTitle] = useState(intent.title);
  const [definition, setDefinition] = useState(intent.definition);
  const [rule, setRule] = useState(intent.rule ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const definitionChanged = definition.trim() !== intent.definition;

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/instructor/assignments/${assignmentId}/score/intents/${intent.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim() || undefined,
          definition: definition.trim() || undefined,
          rule: rule.trim() ? rule.trim() : null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data?.message === 'string' ? data.message : 'Save failed.');
      }
      onClose(true);
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  async function archive() {
    if (!window.confirm(`Archive "${intent.title}"? Its questions fall back to Base-only. This is recorded and reversible.`)) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/instructor/assignments/${assignmentId}/score/intents/${intent.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Archive failed.');
      onClose(true);
    } catch {
      setError('Archive failed.');
      setSaving(false);
    }
  }

  return (
    <Dialog open onClose={() => onClose(false)} className="relative z-50">
      <div className="fixed inset-0 bg-black/40" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="w-full max-w-lg rounded-lg bg-[hsl(var(--card))] border border-[hsl(var(--border))] shadow-xl">
          <div className="px-4 py-3 border-b border-[hsl(var(--border))] flex items-center justify-between">
            <DialogTitle className="text-sm font-semibold">Edit intent</DialogTitle>
            <button onClick={() => onClose(false)} className="p-1 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="p-4 space-y-3">
            <label className="block text-xs">
              <span className="font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">Title</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="mt-1 w-full text-sm border border-[hsl(var(--border))] rounded px-2 py-1.5 bg-[hsl(var(--background))]"
              />
            </label>
            <label className="block text-xs">
              <span className="font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                When a student… (definition)
              </span>
              <textarea
                value={definition}
                onChange={(e) => setDefinition(e.target.value)}
                rows={3}
                className="mt-1 w-full text-sm border border-[hsl(var(--border))] rounded px-2 py-1.5 bg-[hsl(var(--background))]"
              />
            </label>
            <label className="block text-xs">
              <span className="font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                Then respond… (rule — optional)
              </span>
              <textarea
                value={rule}
                onChange={(e) => setRule(e.target.value)}
                rows={4}
                placeholder="No rule yet — the base prompt applies to this intent's questions."
                className="mt-1 w-full text-sm border border-[hsl(var(--border))] rounded px-2 py-1.5 bg-[hsl(var(--background))]"
              />
            </label>
            {definitionChanged && (
              <p className="text-[11px] text-amber-700">
                Definition changed — this intent&apos;s ratings become stale; run &quot;Rate remaining&quot; after saving.
              </p>
            )}
            {error && <p className="text-xs text-red-600">{error}</p>}
          </div>
          <div className="px-4 py-3 border-t border-[hsl(var(--border))] flex items-center justify-between">
            <button onClick={archive} disabled={saving} className="text-xs text-red-600 hover:underline disabled:opacity-50">
              Archive intent
            </button>
            <div className="flex gap-2">
              <button
                onClick={() => onClose(false)}
                className="px-3 py-1.5 text-xs rounded border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving || !definition.trim()}
                className="px-3 py-1.5 text-xs font-medium rounded bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
