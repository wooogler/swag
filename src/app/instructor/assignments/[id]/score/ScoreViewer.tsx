'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import {
  type ScoreConfig,
  type ScoreConfigSubtype,
  type ScoreTypeKey,
  SCORE_B_THRESHOLD,
} from '@/lib/score/config';
import { SCORE_MODELS, SCORE_MODEL_LABELS } from '@/lib/score/models';
import { buildSystemA, buildSystemBSingle, buildQueryContent, buildQueryContentB } from '@/lib/score/prompts';
import { Tooltip } from '@/components/ui/tooltip';
import TaxonomyEditor from './TaxonomyEditor';
import {
  ChevronDown,
  ChevronRight,
  Play,
  RefreshCw,
  AlertTriangle,
  MessageSquare,
  Sparkles,
  Code2,
  Pencil,
  SlidersHorizontal,
  Filter,
  Search,
  Download,
  X,
} from 'lucide-react';

export interface ScoreQueryRow {
  messageId: number;
  sessionId: string;
  participantToken: string;
  queryText: string;
  responseText: string | null;
  prevQueryText: string | null;
  prevResponseText: string | null;
  turnIndex: number;
  turnNumber: number;
  queryTimestamp: string;
  typeA: ScoreTypeKey | null;
  subtypeA: string | null;
  tagsB: string[];
  scoresB: Record<string, number>;
  model: string | null;
  /** Model that produced the B scores ('mixed' after partial re-runs). */
  bModel: string | null;
  rawA: string | null;
  rawB: string | null;
}

interface ScoreViewerProps {
  assignmentId: string;
  assignmentTitle: string;
  rows: ScoreQueryRow[];
  total: number;
  classified: number;
  /** Messages with stale/missing work PER classifier (mirrors the route's
   * staleness rules). The A/B toggle selects which drives "Classify N
   * remaining", keeping it consistent with the scoped "Re-classify" button. */
  pendingA: number;
  pendingB: number;
  defaultModel: string;
  openaiConfigured: boolean;
  initialConfig: ScoreConfig;
  canEditTaxonomy: boolean;
}

type Classifier = 'A' | 'B';

type Selection =
  | { kind: 'all' }
  | { kind: 'type'; key: ScoreTypeKey }
  | { kind: 'subtype'; code: string }
  | { kind: 'combo'; key: string }
  | { kind: 'unclassified' }
  | { kind: 'untagged' };

const TYPE_STYLES: Record<ScoreTypeKey, { chip: string; dot: string }> = {
  Planning: { chip: 'bg-blue-50 text-blue-700 border-blue-200', dot: 'bg-blue-500' },
  Translating: { chip: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  Reviewing: { chip: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
  All: { chip: 'bg-violet-50 text-violet-700 border-violet-200', dot: 'bg-violet-500' },
};
const NEUTRAL_CHIP = 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] border-[hsl(var(--border))]';
// Codes that exist in old classifications but were removed from the taxonomy.
const ORPHAN_CHIP = 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] border-dashed border-[hsl(var(--border))] line-through opacity-70';
const TAG_TOOLTIP_ID = 'score-tag-tooltip';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Bold highlight with no horizontal padding so matches don't shift the layout.
const MARK_CLASS = 'bg-yellow-200 text-black font-semibold rounded-[1px] mx-0 px-0';

/** Highlight every occurrence of `query` in `text` (whitespace preserved). */
function highlightAll(text: string, query: string): React.ReactNode {
  const q = query.trim();
  if (!q) return text;
  const ql = q.toLowerCase();
  const tl = text.toLowerCase();
  const nodes: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i <= text.length) {
    const idx = tl.indexOf(ql, i);
    if (idx === -1) {
      nodes.push(text.slice(i));
      break;
    }
    if (idx > i) nodes.push(text.slice(i, idx));
    nodes.push(
      <mark key={key++} className={MARK_CLASS}>
        {text.slice(idx, idx + ql.length)}
      </mark>
    );
    i = idx + ql.length;
  }
  return nodes;
}

/**
 * Truncate a query for the list, but if there's a search term, center the
 * snippet on the first match and <mark> every occurrence of the term.
 */
function highlightSnippet(text: string, query: string, maxLen: number): React.ReactNode {
  const clean = text.replace(/\s+/g, ' ').trim();
  const q = query.trim();
  if (!q) return clean.length > maxLen ? `${clean.slice(0, maxLen)}…` : clean;

  const ql = q.toLowerCase();
  const first = clean.toLowerCase().indexOf(ql);

  let start = 0;
  let prefix = '';
  if (first > 40 && clean.length > maxLen) {
    start = first - 30;
    prefix = '…';
  }
  let slice = clean.slice(start);
  if (slice.length > maxLen) slice = `${slice.slice(0, maxLen)}…`;
  slice = prefix + slice;

  const nodes: React.ReactNode[] = [];
  const sl = slice.toLowerCase();
  let i = 0;
  let key = 0;
  while (i <= slice.length) {
    const idx = sl.indexOf(ql, i);
    if (idx === -1) {
      nodes.push(slice.slice(i));
      break;
    }
    if (idx > i) nodes.push(slice.slice(i, idx));
    nodes.push(
      <mark key={key++} className={MARK_CLASS}>
        {slice.slice(idx, idx + ql.length)}
      </mark>
    );
    i = idx + ql.length;
  }
  return nodes;
}

function comboKey(tags: string[]): string {
  return [...tags].sort().join('+');
}

function toggleInSet<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

// Classifier B tags are derived live from the stored 0-10 scores using the
// current threshold (so the threshold slider re-tags without re-classifying).
// Ordered by score descending for display.
function firedTags(scoresB: Record<string, number>, threshold: number): string[] {
  return Object.keys(scoresB)
    .filter((c) => (scoresB[c] ?? 0) >= threshold)
    .sort((a, b) => (scoresB[b] ?? 0) - (scoresB[a] ?? 0));
}

// ---- CSV export (matches the GPTWriting_recoded.csv reference: the three
// columns Inquiry, Response, Code; UTF-8 BOM + CRLF so Excel opens it cleanly) --
function csvEscape(value: string): string {
  // RFC-4180 quoting: wrap in quotes and double any embedded quote when the
  // field contains a comma, quote, or line break.
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Build the results CSV for the given rows. `Code` holds Classifier A's single
 * subtype code, or — for Classifier B — the codes whose 0-10 score fired at the
 * current threshold, joined (a query with no fired tag exports an empty Code,
 * mirroring the blank cells in the reference document).
 */
function buildResultsCsv(rows: ScoreQueryRow[], classifier: Classifier, threshold: number): string {
  const header = ['Inquiry', 'Response', 'Code'];
  const lines = [header.join(',')];
  for (const r of rows) {
    const code = classifier === 'A' ? r.subtypeA ?? '' : firedTags(r.scoresB, threshold).join('; ');
    lines.push([r.queryText, r.responseText ?? '', code].map(csvEscape).join(','));
  }
  return '\ufeff' + lines.join('\r\n');
}

/** Slugify the assignment title for a filesystem-friendly download name. */
function slugForFilename(title: string): string {
  const slug = title
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '');
  return slug || 'score';
}

// Config-derived lookups (rebuilt whenever the taxonomy config changes).
interface TaxIndex {
  typeOf: (code: string) => ScoreTypeKey | undefined;
  subtypeOf: (code: string) => ScoreConfigSubtype | undefined;
  labelOf: (code: string) => string;
  chipClass: (code: string) => string;
  tooltipHtml: (code: string, score?: number) => string;
}

function buildIndex(config: ScoreConfig): TaxIndex {
  const typeMap = new Map<string, ScoreTypeKey>();
  const subMap = new Map<string, ScoreConfigSubtype>();
  for (const t of config.types) {
    for (const s of t.subtypes) {
      typeMap.set(s.code, t.key);
      subMap.set(s.code, s);
    }
  }
  return {
    typeOf: (code) => typeMap.get(code),
    subtypeOf: (code) => subMap.get(code),
    labelOf: (code) => {
      const s = subMap.get(code);
      return s ? `${s.code} · ${s.label}` : code;
    },
    chipClass: (code) => {
      const k = typeMap.get(code);
      if (k) return TYPE_STYLES[k].chip;
      return subMap.has(code) ? NEUTRAL_CHIP : ORPHAN_CHIP;
    },
    tooltipHtml: (code, score) => {
      const s = subMap.get(code);
      const head = escapeHtml(s ? `${s.code} · ${s.label}` : code);
      const desc = s
        ? `<div>${escapeHtml(s.description)}</div>`
        : '<div style="opacity:.7">⚠ removed from current taxonomy</div>';
      const sc = score === undefined ? '' : `<div style="opacity:.7;margin-top:2px">Score: ${score}/10</div>`;
      return `<div style="font-weight:600">${head}</div>${desc}${sc}`;
    },
  };
}

export default function ScoreViewer({
  assignmentId,
  assignmentTitle,
  rows,
  total,
  classified,
  pendingA,
  pendingB,
  defaultModel,
  openaiConfigured,
  initialConfig,
  canEditTaxonomy,
}: ScoreViewerProps) {
  const router = useRouter();
  const [config, setConfig] = useState<ScoreConfig>(initialConfig);
  const index = useMemo(() => buildIndex(config), [config]);

  const [classifier, setClassifier] = useState<Classifier>('A');
  const [selection, setSelection] = useState<Selection>({ kind: 'all' });
  const [selectedMessageId, setSelectedMessageId] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Set<ScoreTypeKey>>(
    () => new Set(config.types.filter((t) => t.subtypes.length > 0).map((t) => t.key))
  );
  const [selectedModel, setSelectedModel] = useState<string>(defaultModel);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorFocusCode, setEditorFocusCode] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<
    'recent' | 'oldest' | 'score-desc' | 'score-asc' | 'participant-asc' | 'participant-desc'
  >('recent');
  const [threshold, setThreshold] = useState<number>(SCORE_B_THRESHOLD);
  const [querySearch, setQuerySearch] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterSubtypes, setFilterSubtypes] = useState<Set<string>>(() => new Set());
  const [filterParticipants, setFilterParticipants] = useState<Set<string>>(() => new Set());

  // Stale/missing work for the SELECTED classifier (version bumps and taxonomy
  // edits count) — not merely "messages without any cached row". Switching the
  // A/B toggle re-points both the count and the run scope.
  const remaining = classifier === 'A' ? pendingA : pendingB;

  const [running, setRunning] = useState(false);
  const [runProgress, setRunProgress] = useState<{ classified: number; total: number; failed: number } | null>(null);
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

  const allParticipants = useMemo(
    () =>
      Array.from(new Set(rows.map((r) => r.participantToken).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true })
      ),
    [rows]
  );

  // Global filter (subtypes + participants) applied before everything else.
  const scopedRows = useMemo(() => {
    if (filterSubtypes.size === 0 && filterParticipants.size === 0) return rows;
    return rows.filter((r) => {
      if (filterParticipants.size > 0 && !filterParticipants.has(r.participantToken)) return false;
      if (filterSubtypes.size > 0) {
        if (classifier === 'A') {
          if (!r.subtypeA || !filterSubtypes.has(r.subtypeA)) return false;
        } else {
          if (!firedTags(r.scoresB, threshold).some((c) => filterSubtypes.has(c))) return false;
        }
      }
      return true;
    });
  }, [rows, filterSubtypes, filterParticipants, classifier, threshold]);

  // The filter chooses which subtypes (and thus types) appear in the left
  // browser; scopedRows limits queries to those subtypes accordingly.
  const subFilterActive = filterSubtypes.size > 0;
  const isSubVisible = (code: string) => !subFilterActive || filterSubtypes.has(code);
  const visibleTypes = !subFilterActive
    ? config.types
    : config.types.filter((t) => t.subtypes.some((s) => filterSubtypes.has(s.code)));

  const filterActive = filterSubtypes.size > 0 || filterParticipants.size > 0;
  const filterSummary = filterActive
    ? [
        filterSubtypes.size ? `${filterSubtypes.size} subtype${filterSubtypes.size > 1 ? 's' : ''}` : null,
        filterParticipants.size ? `${filterParticipants.size} student${filterParticipants.size > 1 ? 's' : ''}` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : 'All';

  // ---- Counts -----------------------------------------------------------
  const counts = useMemo(() => {
    const typeA = new Map<ScoreTypeKey, number>();
    const subA = new Map<string, number>();
    const subB = new Map<string, number>();
    let unclassifiedA = 0;
    let untaggedB = 0;
    for (const r of scopedRows) {
      if (r.typeA) typeA.set(r.typeA, (typeA.get(r.typeA) ?? 0) + 1);
      else unclassifiedA += 1;
      if (r.subtypeA) subA.set(r.subtypeA, (subA.get(r.subtypeA) ?? 0) + 1);
      const fired = firedTags(r.scoresB, threshold);
      if (fired.length === 0) untaggedB += 1;
      for (const code of fired) subB.set(code, (subB.get(code) ?? 0) + 1);
    }
    return { typeA, subA, subB, unclassifiedA, untaggedB };
  }, [scopedRows, threshold]);

  const combos = useMemo(() => {
    const m = new Map<string, { codes: string[]; count: number }>();
    for (const r of scopedRows) {
      const fired = firedTags(r.scoresB, threshold);
      if (fired.length >= 2) {
        const codes = [...fired].sort();
        const key = codes.join('+');
        const e = m.get(key);
        if (e) e.count += 1;
        else m.set(key, { codes, count: 1 });
      }
    }
    return Array.from(m.values())
      .filter((c) => c.count >= 1)
      .sort((a, b) => b.count - a.count || a.codes.length - b.codes.length);
  }, [scopedRows, threshold]);

  // ---- Filtered + searched + sorted middle column -----------------------
  const filteredRows = useMemo(() => {
    switch (selection.kind) {
      case 'all':
        return scopedRows;
      case 'unclassified':
        return scopedRows.filter((r) => !r.typeA);
      case 'untagged':
        return scopedRows.filter((r) => firedTags(r.scoresB, threshold).length === 0);
      case 'type':
        return scopedRows.filter((r) => r.typeA === selection.key);
      case 'combo':
        return scopedRows.filter((r) => {
          const fired = firedTags(r.scoresB, threshold);
          return fired.length >= 2 && comboKey(fired) === selection.key;
        });
      case 'subtype':
        return classifier === 'A'
          ? scopedRows.filter((r) => r.subtypeA === selection.code)
          : scopedRows.filter((r) => (r.scoresB[selection.code] ?? 0) >= threshold);
      default:
        return scopedRows;
    }
  }, [scopedRows, selection, classifier, threshold]);

  const searchedRows = useMemo(() => {
    const q = querySearch.trim().toLowerCase();
    if (!q) return filteredRows;
    return filteredRows.filter((r) => r.queryText.toLowerCase().includes(q));
  }, [filteredRows, querySearch]);

  const sortedRows = useMemo(() => {
    const scoreOf = (r: ScoreQueryRow): number => {
      if (selection.kind === 'subtype') return r.scoresB[selection.code] ?? 0;
      if (selection.kind === 'combo') {
        return selection.key.split('+').reduce((m, c) => Math.max(m, r.scoresB[c] ?? 0), 0);
      }
      const vals = Object.values(r.scoresB);
      return vals.length ? Math.max(...vals) : 0;
    };
    const ts = (r: ScoreQueryRow) => new Date(r.queryTimestamp).getTime();
    const pc = (a: ScoreQueryRow, b: ScoreQueryRow) =>
      a.participantToken.localeCompare(b.participantToken, undefined, { numeric: true, sensitivity: 'base' });
    const arr = searchedRows.slice();
    switch (sortMode) {
      case 'recent':
        arr.sort((a, b) => ts(b) - ts(a));
        break;
      case 'oldest':
        arr.sort((a, b) => ts(a) - ts(b));
        break;
      case 'score-desc':
        arr.sort((a, b) => scoreOf(b) - scoreOf(a) || ts(b) - ts(a));
        break;
      case 'score-asc':
        arr.sort((a, b) => scoreOf(a) - scoreOf(b) || ts(b) - ts(a));
        break;
      case 'participant-asc':
        arr.sort((a, b) => pc(a, b) || ts(b) - ts(a));
        break;
      case 'participant-desc':
        arr.sort((a, b) => pc(b, a) || ts(b) - ts(a));
        break;
    }
    return arr;
  }, [searchedRows, sortMode, selection]);

  const selectedRow = useMemo(
    () => rows.find((r) => r.messageId === selectedMessageId) ?? null,
    [rows, selectedMessageId]
  );

  function switchClassifier(next: Classifier) {
    setClassifier(next);
    setSelection({ kind: 'all' });
  }

  function openEditor(code: string | null) {
    setEditorFocusCode(code);
    setEditorOpen(true);
  }

  // ---- Classification runner -------------------------------------------
  async function runClassification(force: boolean, scope: 'all' | 'a' | 'b' = 'all') {
    if (running) return;
    if (force) {
      const what =
        scope === 'a' ? 'Classifier A' : scope === 'b' ? 'Classifier B' : 'both classifiers';
      if (
        !window.confirm(
          `Re-classify ${what} for ALL queries? This re-runs the LLM for every query and overwrites the cached results.`
        )
      ) {
        return;
      }
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setRunError(null);
    // Seed from staleness-aware pending work (server semantics), not from the
    // row count — after a version/taxonomy bump every row exists but is stale,
    // and seeding with rows.length would render a bogus 100% bar.
    setRunProgress({ classified: force ? 0 : total - remaining, total, failed: 0 });
    let first = true;
    let totalFailed = 0;
    try {
      while (true) {
        const res = await fetch(`/api/instructor/assignments/${assignmentId}/score/classify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ force: first && force, scope, limit: 50, model: selectedModel }),
          signal: controller.signal,
        });
        const data = await res.json().catch(() => ({}));
        if (!mountedRef.current) return;
        if (!res.ok) {
          setRunError(typeof data?.message === 'string' ? data.message : 'Classification request failed.');
          break;
        }
        first = false;
        totalFailed += data.failed ?? 0;
        setRunProgress({ classified: data.classified, total: data.total, failed: totalFailed });
        if (data.remaining <= 0 || data.processed === 0) break;
        if ((data.succeeded ?? 0) === 0) {
          setRunError(`Classification stalled — ${data.failed ?? 0} LLM calls failed this batch. Check the server logs.`);
          break;
        }
      }
    } catch (err) {
      if ((err as Error)?.name === 'AbortError' || !mountedRef.current) return;
      setRunError('Classification was interrupted. Please try again.');
    } finally {
      if (mountedRef.current) {
        setRunning(false);
        router.refresh();
      }
    }
  }

  // ---- Results download -------------------------------------------------
  // Exports exactly what the middle column currently shows (global filter +
  // left-panel selection + search + sort all applied) for the active
  // classifier, in the reference Inquiry/Response/Code CSV shape.
  function downloadResults() {
    if (sortedRows.length === 0) return;
    const csv = buildResultsCsv(sortedRows, classifier, threshold);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slugForFilename(assignmentTitle)}_classifier${classifier}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ---- Render -----------------------------------------------------------
  return (
    <div className="space-y-4">
      <ControlBar
        classifier={classifier}
        onSwitch={switchClassifier}
        total={total}
        remaining={remaining}
        model={selectedModel}
        onModelChange={setSelectedModel}
        openaiConfigured={openaiConfigured}
        running={running}
        runProgress={runProgress}
        runError={runError}
        onRun={() => runClassification(false, classifier === 'A' ? 'a' : 'b')}
        onRerunA={() => runClassification(true, 'a')}
        onRerunB={() => runClassification(true, 'b')}
        onEditTaxonomy={() => openEditor(null)}
        canEditTaxonomy={canEditTaxonomy}
        threshold={threshold}
        onThresholdChange={setThreshold}
        onDownload={downloadResults}
        downloadCount={sortedRows.length}
      />

      {classified === 0 ? (
        <EmptyState openaiConfigured={openaiConfigured} total={total} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)_minmax(0,1.1fr)] gap-4 h-[calc(100vh-260px)] min-h-[520px]">
          {/* LEFT — intent list */}
          <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-y-auto">
            <button
              onClick={() => setFilterOpen(true)}
              className={`sticky top-0 z-10 w-full px-3 py-2 border-b border-[hsl(var(--border))] flex items-center justify-between gap-2 ${
                filterActive ? 'bg-[hsl(var(--primary))]/10' : 'bg-[hsl(var(--card))] hover:bg-[hsl(var(--muted))]/50'
              }`}
            >
              <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                <Filter className="w-3.5 h-3.5" /> Filter
              </span>
              <span className="flex items-center gap-2 min-w-0">
                <span className="text-[11px] truncate text-[hsl(var(--muted-foreground))]">{filterSummary}</span>
                <CountBadge n={scopedRows.length} />
              </span>
            </button>
            <button
              onClick={() => setSelection({ kind: 'all' })}
              className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between border-b border-[hsl(var(--border))] ${
                selection.kind === 'all' ? 'bg-[hsl(var(--muted))] font-medium' : 'hover:bg-[hsl(var(--muted))]/50'
              }`}
            >
              <span>All queries</span>
              <CountBadge n={scopedRows.length} />
            </button>

            {classifier === 'A'
              ? visibleTypes.map((type) => {
                  const isOpen = expanded.has(type.key);
                  const typeCount = counts.typeA.get(type.key) ?? 0;
                  return (
                    <div key={type.key} className="border-b border-[hsl(var(--border))]">
                      <div
                        className={`flex items-center ${
                          selection.kind === 'type' && selection.key === type.key ? 'bg-[hsl(var(--muted))]' : ''
                        }`}
                      >
                        <button
                          onClick={() =>
                            setExpanded((prev) => {
                              const next = new Set(prev);
                              if (next.has(type.key)) next.delete(type.key);
                              else next.add(type.key);
                              return next;
                            })
                          }
                          className="p-2 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                          aria-label={isOpen ? 'Collapse' : 'Expand'}
                        >
                          {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </button>
                        <button
                          onClick={() => setSelection({ kind: 'type', key: type.key })}
                          className="flex-1 text-left py-2 pr-3 text-sm font-medium flex items-center justify-between"
                        >
                          <span className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full ${TYPE_STYLES[type.key].dot}`} />
                            {type.label}
                          </span>
                          <CountBadge n={typeCount} />
                        </button>
                      </div>
                      {isOpen && (
                        <div className="pb-1">
                          {type.subtypes.filter((s) => isSubVisible(s.code)).map((s) => (
                            <SubtypeRow
                              key={s.code}
                              code={s.code}
                              label={s.label}
                              count={counts.subA.get(s.code) ?? 0}
                              description={s.description}
                              active={selection.kind === 'subtype' && selection.code === s.code}
                              indent
                              editable={canEditTaxonomy}
                              onSelect={() => setSelection({ kind: 'subtype', code: s.code })}
                              onEdit={() => openEditor(s.code)}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              : visibleTypes.map((type) => (
                  <div key={type.key} className="border-b border-[hsl(var(--border))]">
                    <div className="px-3 py-1.5 text-[11px] uppercase tracking-wide text-[hsl(var(--muted-foreground))] flex items-center gap-2 bg-[hsl(var(--muted))]/30">
                      <span className={`w-2 h-2 rounded-full ${TYPE_STYLES[type.key].dot}`} />
                      {type.label}
                    </div>
                    {type.subtypes.filter((s) => isSubVisible(s.code)).map((s) => (
                      <SubtypeRow
                        key={s.code}
                        code={s.code}
                        label={s.label}
                        count={counts.subB.get(s.code) ?? 0}
                        description={s.description}
                        active={selection.kind === 'subtype' && selection.code === s.code}
                        editable={canEditTaxonomy}
                        onSelect={() => setSelection({ kind: 'subtype', code: s.code })}
                        onEdit={() => openEditor(s.code)}
                      />
                    ))}
                  </div>
                ))}

            {classifier === 'A' && counts.unclassifiedA > 0 && (
              <button
                onClick={() => setSelection({ kind: 'unclassified' })}
                className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between ${
                  selection.kind === 'unclassified' ? 'bg-[hsl(var(--muted))] font-medium' : 'hover:bg-[hsl(var(--muted))]/50'
                }`}
              >
                <span className="text-[hsl(var(--muted-foreground))]">Unclassified</span>
                <CountBadge n={counts.unclassifiedA} />
              </button>
            )}
            {classifier === 'B' && counts.untaggedB > 0 && (
              <button
                onClick={() => setSelection({ kind: 'untagged' })}
                className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between ${
                  selection.kind === 'untagged' ? 'bg-[hsl(var(--muted))] font-medium' : 'hover:bg-[hsl(var(--muted))]/50'
                }`}
              >
                <span className="text-[hsl(var(--muted-foreground))]">No tags fired</span>
                <CountBadge n={counts.untaggedB} />
              </button>
            )}

            {classifier === 'B' && combos.length > 0 && (
              <div className="border-t-4 border-[hsl(var(--border))]">
                <div className="px-3 py-1.5 text-[11px] uppercase tracking-wide text-[hsl(var(--muted-foreground))] bg-[hsl(var(--muted))]/30">
                  Multi-tag combinations ({combos.length})
                </div>
                {combos.map((combo) => {
                  const key = combo.codes.join('+');
                  const active = selection.kind === 'combo' && selection.key === key;
                  return (
                    <button
                      key={key}
                      onClick={() => setSelection({ kind: 'combo', key })}
                      className={`w-full text-left px-3 py-1.5 flex items-center justify-between gap-2 ${
                        active ? 'bg-[hsl(var(--muted))]' : 'hover:bg-[hsl(var(--muted))]/50'
                      }`}
                    >
                      <span className="flex flex-wrap gap-1">
                        {combo.codes.map((c) => (
                          <Chip key={c} className={index.chipClass(c)} tooltipHtml={index.tooltipHtml(c)}>
                            {c}
                          </Chip>
                        ))}
                      </span>
                      <CountBadge n={combo.count} />
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* MIDDLE — query list */}
          <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-y-auto">
            <div className="sticky top-0 z-10 bg-[hsl(var(--card))] border-b border-[hsl(var(--border))] px-3 py-2 flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))] truncate">
                  {selectionLabel(selection, classifier, combos, index)}
                </span>
                <CountBadge n={sortedRows.length} />
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[hsl(var(--muted-foreground))]" />
                  <input
                    value={querySearch}
                    onChange={(e) => setQuerySearch(e.target.value)}
                    placeholder="Search query text…"
                    className="w-44 pl-7 pr-7 py-1 text-xs border border-[hsl(var(--border))] rounded bg-[hsl(var(--background))] text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
                  />
                  {querySearch && (
                    <button
                      onClick={() => setQuerySearch('')}
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
                  title="Sort the query list"
                  className="text-xs border border-[hsl(var(--border))] rounded px-1.5 py-0.5 bg-[hsl(var(--background))] text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
                >
                  <option value="recent">Newest</option>
                  <option value="oldest">Oldest</option>
                  <option value="participant-asc">PID ↑</option>
                  <option value="participant-desc">PID ↓</option>
                  <option value="score-desc">Score ↓</option>
                  <option value="score-asc">Score ↑</option>
                </select>
              </div>
            </div>
            {sortedRows.length === 0 ? (
              <p className="p-6 text-sm text-[hsl(var(--muted-foreground))]">No queries for this selection.</p>
            ) : (
              <ul className="divide-y divide-[hsl(var(--border))]">
                {sortedRows.map((r) => {
                  const active = r.messageId === selectedMessageId;
                  return (
                    <li key={r.messageId}>
                      <button
                        onClick={() => setSelectedMessageId(r.messageId)}
                        className={`w-full text-left px-3 py-2.5 ${
                          active ? 'bg-[hsl(var(--muted))]' : 'hover:bg-[hsl(var(--muted))]/40'
                        }`}
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
                          {highlightSnippet(r.queryText, querySearch, 140)}
                        </p>
                        <div className="flex flex-wrap gap-1">
                          <RowTags row={r} classifier={classifier} index={index} threshold={threshold} />
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* RIGHT — response viewer */}
          <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-y-auto">
            {!selectedRow ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-8 text-[hsl(var(--muted-foreground))]">
                <MessageSquare className="w-8 h-8 mb-3 opacity-50" />
                <p className="text-sm">Select a query to view the chatbot response.</p>
              </div>
            ) : (
              <div className="p-4 space-y-4">
                <div className="flex items-start justify-between gap-2 text-xs text-[hsl(var(--muted-foreground))]">
                  <div className="flex items-center flex-wrap gap-1.5">
                    <span className="font-mono">
                      {selectedRow.participantToken || '—'}
                      {selectedRow.turnNumber > 0 && <span className="ml-1 font-sans">· Turn {selectedRow.turnNumber}</span>}
                    </span>
                    <RowTags row={selectedRow} classifier={classifier} index={index} threshold={threshold} />
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span>{new Date(selectedRow.queryTimestamp).toLocaleString()}</span>
                    <button
                      onClick={() => setPreviewOpen(true)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[hsl(var(--border))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]"
                      title="Show the prompt sent to the model and its result"
                    >
                      <Code2 className="w-3.5 h-3.5" /> Prompt &amp; result
                    </button>
                  </div>
                </div>

                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))] mb-1.5">
                    Student query
                  </h3>
                  <p className="text-sm whitespace-pre-wrap rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 p-3">
                    {highlightAll(selectedRow.queryText, querySearch)}
                  </p>
                </section>

                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))] mb-1.5">
                    Chatbot response <span className="font-normal normal-case">(the reply to this query — not sent to the model)</span>
                  </h3>
                  {selectedRow.responseText && selectedRow.responseText.trim() ? (
                    <div className="prose prose-sm max-w-none dark:prose-invert prose-pre:bg-[hsl(var(--muted))] prose-pre:text-[hsl(var(--foreground))] prose-pre:border prose-pre:border-[hsl(var(--border))]">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{selectedRow.responseText}</ReactMarkdown>
                    </div>
                  ) : (
                    <p className="text-sm text-[hsl(var(--muted-foreground))] italic">
                      No chatbot response was recorded for this query.
                    </p>
                  )}
                </section>
              </div>
            )}
          </div>
        </div>
      )}

      {selectedRow && (
        <PromptPreviewModal
          open={previewOpen}
          onClose={() => setPreviewOpen(false)}
          row={selectedRow}
          config={config}
          index={index}
          threshold={threshold}
          initialClassifier={classifier}
        />
      )}

      <FilterModal
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        types={config.types}
        participants={allParticipants}
        selectedSubtypes={filterSubtypes}
        selectedParticipants={filterParticipants}
        onToggleSubtype={(code) => setFilterSubtypes((prev) => toggleInSet(prev, code))}
        onToggleType={(key) =>
          setFilterSubtypes((prev) => {
            const codes = config.types.find((t) => t.key === key)?.subtypes.map((s) => s.code) ?? [];
            const allOn = codes.length > 0 && codes.every((c) => prev.has(c));
            const next = new Set(prev);
            if (allOn) codes.forEach((c) => next.delete(c));
            else codes.forEach((c) => next.add(c));
            return next;
          })
        }
        onToggleParticipant={(p) => setFilterParticipants((prev) => toggleInSet(prev, p))}
        onClear={() => {
          setFilterSubtypes(new Set());
          setFilterParticipants(new Set());
        }}
      />

      <TaxonomyEditor
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        config={config}
        focusCode={editorFocusCode}
        onSaved={(next) => {
          setConfig(next);
          setExpanded(new Set(next.types.filter((t) => t.subtypes.length > 0).map((t) => t.key)));
          // If the current selection points at a now-deleted subtype, reset it.
          if (
            selection.kind === 'subtype' &&
            !next.types.some((t) => t.subtypes.some((s) => s.code === selection.code))
          ) {
            setSelection({ kind: 'all' });
          }
          router.refresh();
        }}
      />

      <Tooltip id={TAG_TOOLTIP_ID} place="top" className="max-w-xs leading-snug" />
    </div>
  );
}

function SubtypeRow({
  code,
  label,
  count,
  description,
  active,
  indent,
  editable,
  onSelect,
  onEdit,
}: {
  code: string;
  label: string;
  count: number;
  description: string;
  active: boolean;
  indent?: boolean;
  editable?: boolean;
  onSelect: () => void;
  onEdit: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      role="button"
      title={description}
      className={`group flex items-center gap-1.5 ${indent ? 'pl-9' : 'pl-3'} pr-3 py-1.5 text-xs cursor-pointer ${
        active ? 'bg-[hsl(var(--muted))]' : 'hover:bg-[hsl(var(--muted))]/50'
      } ${active ? 'font-medium text-[hsl(var(--foreground))]' : count === 0 ? 'text-[hsl(var(--muted-foreground))]' : 'text-[hsl(var(--foreground))]'}`}
    >
      <span className="truncate min-w-0">
        <span className="font-mono">{code}</span> {label}
      </span>
      {editable && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          className="shrink-0 opacity-0 group-hover:opacity-100 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))]"
          aria-label={`Edit ${code}`}
          title={`Edit ${code}`}
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
      )}
      <span className="flex-1" />
      <CountBadge n={count} />
    </div>
  );
}

function RowTags({
  row,
  classifier,
  index,
  threshold,
}: {
  row: ScoreQueryRow;
  classifier: Classifier;
  index: TaxIndex;
  threshold: number;
}) {
  if (classifier === 'A') {
    if (row.subtypeA) {
      return (
        <Chip className={index.chipClass(row.subtypeA)} tooltipHtml={index.tooltipHtml(row.subtypeA)}>
          {row.subtypeA}
        </Chip>
      );
    }
    if (row.typeA) {
      return (
        <Chip className={TYPE_STYLES[row.typeA].chip} tooltipHtml={`<div style="font-weight:600">Type · ${row.typeA}</div>`}>
          {row.typeA}
        </Chip>
      );
    }
    return <Chip className={NEUTRAL_CHIP}>unclassified</Chip>;
  }
  const fired = firedTags(row.scoresB, threshold);
  if (fired.length === 0) {
    return <Chip className={NEUTRAL_CHIP}>no tags</Chip>;
  }
  return (
    <>
      {fired.map((code) => (
        <Chip key={code} className={index.chipClass(code)} tooltipHtml={index.tooltipHtml(code, row.scoresB[code])}>
          {code}
          <span className="ml-1 font-sans opacity-60">{row.scoresB[code] ?? 0}</span>
        </Chip>
      ))}
    </>
  );
}

function selectionLabel(
  selection: Selection,
  classifier: Classifier,
  combos: { codes: string[]; count: number }[],
  index: TaxIndex
): string {
  switch (selection.kind) {
    case 'all':
      return 'All queries';
    case 'type':
      return `Type · ${selection.key}`;
    case 'subtype':
      return classifier === 'A' ? index.labelOf(selection.code) : `Tag · ${index.labelOf(selection.code)}`;
    case 'combo': {
      const combo = combos.find((c) => c.codes.join('+') === selection.key);
      return `Combination · ${combo ? combo.codes.join(' + ') : selection.key}`;
    }
    case 'unclassified':
      return 'Unclassified';
    case 'untagged':
      return 'No tags fired';
  }
}

function PromptPreviewModal({
  open,
  onClose,
  row,
  config,
  index,
  threshold,
  initialClassifier,
}: {
  open: boolean;
  onClose: () => void;
  row: ScoreQueryRow;
  config: ScoreConfig;
  index: TaxIndex;
  threshold: number;
  initialClassifier: Classifier;
}) {
  const [which, setWhich] = useState<Classifier>(initialClassifier);
  useEffect(() => {
    if (open) setWhich(initialClassifier);
  }, [open, initialClassifier]);

  const system = which === 'A' ? buildSystemA(config) : buildSystemBSingle();
  const user =
    which === 'A'
      ? buildQueryContent(row.queryText, row.prevQueryText, row.prevResponseText)
      : buildQueryContentB(row.queryText, row.prevQueryText, row.prevResponseText);
  const raw = which === 'A' ? row.rawA : row.rawB;

  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/40" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col rounded-lg bg-[hsl(var(--card))] border border-[hsl(var(--border))] shadow-xl">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[hsl(var(--border))]">
            <DialogTitle className="text-sm font-semibold text-[hsl(var(--foreground))]">
              Prompt &amp; result
              {(which === 'A' ? row.model : row.bModel ?? row.model) && (
                <span className="ml-2 text-xs font-normal text-[hsl(var(--muted-foreground))]">
                  ({which === 'A' ? row.model : row.bModel ?? row.model})
                </span>
              )}
            </DialogTitle>
            <div className="flex items-center gap-2">
              <div className="inline-flex rounded-md border border-[hsl(var(--border))] overflow-hidden text-xs">
                {(['A', 'B'] as const).map((c) => (
                  <button
                    key={c}
                    onClick={() => setWhich(c)}
                    className={`px-2.5 py-1 font-medium ${
                      which === c
                        ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]'
                        : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]'
                    } ${c === 'B' ? 'border-l border-[hsl(var(--border))]' : ''}`}
                  >
                    Classifier {c}
                  </button>
                ))}
              </div>
              <button onClick={onClose} className="p-1 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]" aria-label="Close">
                ✕
              </button>
            </div>
          </div>

          <div className="overflow-y-auto px-4 py-3 space-y-4 text-sm">
            <PreBlock
              label={
                which === 'A'
                  ? 'System prompt (includes few-shot examples)'
                  : 'System prompt (shared rubric — one independent call per subtype)'
              }
              text={system}
            />
            <PreBlock
              label={
                which === 'A'
                  ? 'User message (query + context)'
                  : 'User message (query + context; each call appends one subtype block below this)'
              }
              text={user}
            />
            {which === 'B' && (
              <p className="text-xs text-[hsl(var(--muted-foreground))] italic -mt-2">
                Raw output below shows each subtype&apos;s independent 0-10 score.
              </p>
            )}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))] mb-1">Raw model output</p>
              {raw ? (
                <pre className="text-xs whitespace-pre-wrap break-words rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 p-3 max-h-60 overflow-y-auto">
                  {raw}
                </pre>
              ) : (
                <p className="text-xs text-[hsl(var(--muted-foreground))] italic">
                  Raw output was not stored for this row. Re-classify to capture it.
                </p>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))] mb-1.5">Parsed result</p>
              {which === 'A' ? (
                <div className="flex flex-wrap items-center gap-2">
                  {row.typeA ? (
                    <Chip className={TYPE_STYLES[row.typeA].chip}>{row.typeA}</Chip>
                  ) : (
                    <Chip className={NEUTRAL_CHIP}>unclassified</Chip>
                  )}
                  {row.subtypeA && <span className="text-sm">{index.labelOf(row.subtypeA)}</span>}
                </div>
              ) : (
                <BScores row={row} index={index} threshold={threshold} />
              )}
            </div>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}

function PreBlock({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))] mb-1">{label}</p>
      <pre className="text-xs whitespace-pre-wrap break-words rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 p-3 max-h-60 overflow-y-auto">
        {text}
      </pre>
    </div>
  );
}

function BScores({ row, index, threshold }: { row: ScoreQueryRow; index: TaxIndex; threshold: number }) {
  const [showAll, setShowAll] = useState(false);
  const fired = firedTags(row.scoresB, threshold);
  const entries = Object.entries(row.scoresB)
    .filter(([, v]) => (showAll ? true : v > 0))
    .sort((a, b) => b[1] - a[1]);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {fired.length > 0 ? (
          fired.map((code) => (
            <Chip key={code} className={index.chipClass(code)} tooltipHtml={index.tooltipHtml(code, row.scoresB[code])}>
              {index.labelOf(code)}
            </Chip>
          ))
        ) : (
          <Chip className={NEUTRAL_CHIP}>no tags fired (≥ {threshold})</Chip>
        )}
      </div>
      {entries.length > 0 && (
        <div className="space-y-1 pt-1">
          {entries.map(([code, v]) => (
            <div key={code} className="flex items-center gap-2 text-xs">
              <span className="w-28 shrink-0 font-mono text-[hsl(var(--muted-foreground))]">{code}</span>
              <div className="flex-1 h-1.5 rounded-full bg-[hsl(var(--muted))] overflow-hidden">
                <div className="h-full bg-[hsl(var(--primary))]" style={{ width: `${(v / 10) * 100}%` }} />
              </div>
              <span className="w-6 text-right tabular-nums text-[hsl(var(--muted-foreground))]">{v}</span>
            </div>
          ))}
        </div>
      )}
      <button onClick={() => setShowAll((s) => !s)} className="text-xs text-[hsl(var(--primary))] hover:underline">
        {showAll ? 'Show only scored' : 'Show all scores'}
      </button>
    </div>
  );
}

function ControlBar(props: {
  classifier: Classifier;
  onSwitch: (c: Classifier) => void;
  total: number;
  remaining: number;
  model: string;
  onModelChange: (m: string) => void;
  openaiConfigured: boolean;
  running: boolean;
  runProgress: { classified: number; total: number; failed: number } | null;
  runError: string | null;
  onRun: () => void;
  onRerunA: () => void;
  onRerunB: () => void;
  onEditTaxonomy: () => void;
  canEditTaxonomy: boolean;
  threshold: number;
  onThresholdChange: (n: number) => void;
  onDownload: () => void;
  downloadCount: number;
}) {
  const {
    classifier,
    onSwitch,
    total,
    remaining,
    model,
    onModelChange,
    openaiConfigured,
    running,
    runProgress,
    runError,
    onRun,
    onRerunA,
    onRerunB,
    onEditTaxonomy,
    canEditTaxonomy,
    threshold,
    onThresholdChange,
    onDownload,
    downloadCount,
  } = props;
  const runPct = runProgress ? Math.round((runProgress.classified / Math.max(1, runProgress.total)) * 100) : 0;

  return (
    <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="inline-flex rounded-md border border-[hsl(var(--border))] overflow-hidden">
          <button
            onClick={() => onSwitch('A')}
            className={`px-3 py-1.5 text-sm font-medium ${
              classifier === 'A'
                ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]'
                : 'bg-[hsl(var(--card))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]'
            }`}
          >
            Classifier A · single
          </button>
          <button
            onClick={() => onSwitch('B')}
            className={`px-3 py-1.5 text-sm font-medium border-l border-[hsl(var(--border))] ${
              classifier === 'B'
                ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]'
                : 'bg-[hsl(var(--card))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]'
            }`}
          >
            Classifier B · multi-tag
          </button>
        </div>

        {classifier === 'B' && (
          <label
            className="flex items-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))]"
            title="A subtype counts as a fired tag when its 0-10 score is at least this. Re-tags instantly from stored scores."
          >
            <span className="hidden sm:inline">Tag ≥</span>
            <input
              type="range"
              min={0}
              max={10}
              step={1}
              value={threshold}
              onChange={(e) => onThresholdChange(Number(e.target.value))}
              className="w-24 accent-[hsl(var(--primary))]"
            />
            <span className="w-4 tabular-nums font-medium text-[hsl(var(--foreground))]">{threshold}</span>
          </label>
        )}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        {canEditTaxonomy && (
          <button
            onClick={onEditTaxonomy}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm font-medium border border-[hsl(var(--border))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]"
            title="Edit the taxonomy and few-shot examples"
          >
            <SlidersHorizontal className="w-4 h-4" /> Taxonomy
          </button>
        )}

        <button
          onClick={onDownload}
          disabled={downloadCount === 0}
          title={
            downloadCount === 0
              ? 'No results to download for the current view'
              : `Download the ${downloadCount} shown Classifier ${classifier} result${
                  downloadCount === 1 ? '' : 's'
                } as CSV (Inquiry, Response, Code)`
          }
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm font-medium border border-[hsl(var(--border))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] disabled:opacity-50 disabled:pointer-events-none"
        >
          <Download className="w-4 h-4" /> CSV
        </button>

        <label className="flex items-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))]">
          <span className="hidden sm:inline">Model</span>
          <select
            value={model}
            onChange={(e) => onModelChange(e.target.value)}
            disabled={running}
            className="border border-[hsl(var(--border))] rounded px-2 py-1 text-sm bg-[hsl(var(--background))] text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))] disabled:opacity-50"
          >
            {(SCORE_MODELS as readonly string[]).map((m) => (
              <option key={m} value={m}>
                {SCORE_MODEL_LABELS[m] ?? m}
              </option>
            ))}
            {!(SCORE_MODELS as readonly string[]).includes(model) && <option value={model}>{model}</option>}
          </select>
        </label>

        {!openaiConfigured ? (
          <span className="inline-flex items-center gap-1 text-xs text-[hsl(var(--destructive))]">
            <AlertTriangle className="w-3.5 h-3.5" /> OPENAI_API_KEY not set
          </span>
        ) : running ? (
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-[hsl(var(--border))]">
            <RefreshCw className="w-4 h-4 animate-spin text-[hsl(var(--primary))]" />
            <div className="w-32 h-1.5 rounded-full bg-[hsl(var(--muted))] overflow-hidden">
              <div className="h-full bg-[hsl(var(--primary))] transition-all" style={{ width: `${runPct}%` }} />
            </div>
            <span className="text-xs tabular-nums text-[hsl(var(--muted-foreground))]">
              {runProgress?.classified ?? 0}/{runProgress?.total ?? total}
              {runProgress && runProgress.failed > 0 && (
                <span className="text-[hsl(var(--destructive))]"> · {runProgress.failed} failed</span>
              )}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {remaining > 0 && (
              <button
                onClick={onRun}
                title={`Classify only the ${remaining} queries still pending for Classifier ${classifier}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:bg-[hsl(var(--primary))]/90"
              >
                <Play className="w-4 h-4" />
                {`Classify ${remaining} remaining · ${classifier}`}
              </button>
            )}
            <button
              onClick={classifier === 'A' ? onRerunA : onRerunB}
              title={
                classifier === 'A'
                  ? 'Re-run Classifier A (single-label) for every query, overwriting cached results'
                  : 'Re-run Classifier B (per-subtype scores) for every query, overwriting cached results'
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium border border-[hsl(var(--border))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]"
            >
              <RefreshCw className="w-4 h-4" />
              Re-classify {classifier}
            </button>
          </div>
        )}
      </div>
      {runError && <p className="w-full text-xs text-[hsl(var(--destructive))] sm:order-last">{runError}</p>}
    </div>
  );
}

function EmptyState({ openaiConfigured, total }: { openaiConfigured: boolean; total: number }) {
  return (
    <div className="rounded-lg border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--card))] p-12 text-center">
      <div className="w-14 h-14 rounded-full bg-[hsl(var(--muted))] flex items-center justify-center mx-auto mb-4">
        <Sparkles className="w-7 h-7 text-[hsl(var(--muted-foreground))]" />
      </div>
      <h2 className="text-lg font-semibold text-[hsl(var(--foreground))] mb-1">No classifications yet</h2>
      <p className="text-sm text-[hsl(var(--muted-foreground))] max-w-md mx-auto">
        This assignment has <span className="font-medium text-[hsl(var(--foreground))]">{total}</span> student
        {total === 1 ? ' query' : ' queries'}. Run the classifier to label each one with both the hierarchical (A) and
        multi-tag (B) schemes, then browse them here.
      </p>
      {!openaiConfigured && (
        <p className="mt-3 inline-flex items-center gap-1 text-xs text-[hsl(var(--destructive))]">
          <AlertTriangle className="w-3.5 h-3.5" /> Set OPENAI_API_KEY on the server to enable classification.
        </p>
      )}
      {total === 0 && (
        <p className="mt-3 text-xs text-[hsl(var(--muted-foreground))]">
          There are no chatbot queries in this assignment&apos;s logs yet.
        </p>
      )}
      <p className="mt-4 text-xs text-[hsl(var(--muted-foreground))]">Use the “Classify” button above to start.</p>
    </div>
  );
}

function FilterCheckbox({ state }: { state: 'on' | 'off' | 'partial' }) {
  return (
    <span
      className={`w-3.5 h-3.5 shrink-0 rounded-sm border flex items-center justify-center ${
        state === 'off' ? 'border-[hsl(var(--border))]' : 'bg-[hsl(var(--primary))] border-[hsl(var(--primary))]'
      }`}
    >
      {state === 'on' && <span className="text-[hsl(var(--primary-foreground))] text-[9px]">✓</span>}
      {state === 'partial' && <span className="text-[hsl(var(--primary-foreground))] text-[9px]">–</span>}
    </span>
  );
}

function FilterModal({
  open,
  onClose,
  types,
  participants,
  selectedSubtypes,
  selectedParticipants,
  onToggleType,
  onToggleSubtype,
  onToggleParticipant,
  onClear,
}: {
  open: boolean;
  onClose: () => void;
  types: ScoreConfig['types'];
  participants: string[];
  selectedSubtypes: Set<string>;
  selectedParticipants: Set<string>;
  onToggleType: (key: ScoreTypeKey) => void;
  onToggleSubtype: (code: string) => void;
  onToggleParticipant: (p: string) => void;
  onClear: () => void;
}) {
  const [pSearch, setPSearch] = useState('');
  const shownParticipants = useMemo(() => {
    const q = pSearch.trim().toLowerCase();
    return q ? participants.filter((p) => p.toLowerCase().includes(q)) : participants;
  }, [participants, pSearch]);

  const [tSearch, setTSearch] = useState('');
  const shownTypes = useMemo(() => {
    const q = tSearch.trim().toLowerCase();
    if (!q) return types.map((t) => ({ type: t, subs: t.subtypes }));
    const out: { type: (typeof types)[number]; subs: (typeof types)[number]['subtypes'] }[] = [];
    for (const t of types) {
      const typeMatches = t.label.toLowerCase().includes(q) || t.key.toLowerCase().includes(q);
      const subs = typeMatches
        ? t.subtypes
        : t.subtypes.filter((s) => `${s.code} ${s.label}`.toLowerCase().includes(q));
      if (typeMatches || subs.length > 0) out.push({ type: t, subs });
    }
    return out;
  }, [types, tSearch]);

  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/40" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col rounded-lg bg-[hsl(var(--card))] border border-[hsl(var(--border))] shadow-xl">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[hsl(var(--border))]">
            <DialogTitle className="text-sm font-semibold text-[hsl(var(--foreground))]">Filter queries</DialogTitle>
            <button onClick={onClose} className="p-1 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]" aria-label="Close">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="overflow-y-auto px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Types → Subtypes tree */}
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))] mb-2">
                Types &amp; subtypes {selectedSubtypes.size === 0 ? '(all)' : `(${selectedSubtypes.size})`}
              </p>
              <div className="relative mb-2">
                <Search className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[hsl(var(--muted-foreground))]" />
                <input
                  value={tSearch}
                  onChange={(e) => setTSearch(e.target.value)}
                  placeholder="Search type / subtype…"
                  className="w-full pl-7 pr-2 py-1 text-xs border border-[hsl(var(--border))] rounded bg-[hsl(var(--background))] text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
                />
              </div>
              <div className="max-h-72 overflow-y-auto rounded border border-[hsl(var(--border))] divide-y divide-[hsl(var(--border))]">
                {shownTypes.length === 0 ? (
                  <p className="p-3 text-xs text-[hsl(var(--muted-foreground))]">No matching types.</p>
                ) : (
                  shownTypes.map(({ type: t, subs }) => {
                  const codes = t.subtypes.map((s) => s.code);
                  const on = codes.filter((c) => selectedSubtypes.has(c)).length;
                  const typeState = on === 0 ? 'off' : on === codes.length ? 'on' : 'partial';
                  return (
                    <div key={t.key}>
                      <button
                        onClick={() => onToggleType(t.key)}
                        className={`w-full text-left px-2.5 py-1.5 text-xs font-medium flex items-center gap-2 ${
                          typeState !== 'off' ? 'bg-[hsl(var(--primary))]/5' : 'hover:bg-[hsl(var(--muted))]/50'
                        }`}
                      >
                        <FilterCheckbox state={typeState} />
                        <span className={`w-2 h-2 rounded-full ${TYPE_STYLES[t.key].dot}`} />
                        {t.label}
                      </button>
                      {subs.map((s) => {
                        const sOn = selectedSubtypes.has(s.code);
                        return (
                          <button
                            key={s.code}
                            onClick={() => onToggleSubtype(s.code)}
                            className={`w-full text-left pl-8 pr-2.5 py-1 text-xs flex items-center gap-2 ${
                              sOn ? 'bg-[hsl(var(--primary))]/10 font-medium' : 'hover:bg-[hsl(var(--muted))]/50'
                            }`}
                            title={s.description}
                          >
                            <FilterCheckbox state={sOn ? 'on' : 'off'} />
                            <span className="truncate">
                              <span className="font-mono">{s.code}</span> {s.label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  );
                  })
                )}
              </div>
            </div>

            {/* Participants */}
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))] mb-2">
                Students {selectedParticipants.size === 0 ? '(all)' : `(${selectedParticipants.size})`}
              </p>
              <div className="relative mb-2">
                <Search className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[hsl(var(--muted-foreground))]" />
                <input
                  value={pSearch}
                  onChange={(e) => setPSearch(e.target.value)}
                  placeholder="Search participant… (e.g. P76)"
                  className="w-full pl-7 pr-2 py-1 text-xs border border-[hsl(var(--border))] rounded bg-[hsl(var(--background))] text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
                />
              </div>
              <div className="max-h-72 overflow-y-auto rounded border border-[hsl(var(--border))] divide-y divide-[hsl(var(--border))]">
                {shownParticipants.length === 0 ? (
                  <p className="p-3 text-xs text-[hsl(var(--muted-foreground))]">No matching participants.</p>
                ) : (
                  shownParticipants.map((p) => {
                    const on = selectedParticipants.has(p);
                    return (
                      <button
                        key={p}
                        onClick={() => onToggleParticipant(p)}
                        className={`w-full text-left px-3 py-1.5 text-xs font-mono flex items-center gap-2 ${
                          on ? 'bg-[hsl(var(--primary))]/10 font-medium' : 'hover:bg-[hsl(var(--muted))]/50'
                        }`}
                      >
                        <FilterCheckbox state={on ? 'on' : 'off'} />
                        {p}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between px-4 py-3 border-t border-[hsl(var(--border))]">
            <button onClick={onClear} className="text-xs text-[hsl(var(--primary))] hover:underline">
              Clear all
            </button>
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-md text-sm font-medium bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:bg-[hsl(var(--primary))]/90"
            >
              Done
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}

function CountBadge({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center justify-center min-w-[1.5rem] px-1.5 py-0.5 rounded-full text-[11px] font-medium bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]">
      {n}
    </span>
  );
}

function Chip({
  children,
  className = '',
  tooltipHtml,
}: {
  children: React.ReactNode;
  className?: string;
  tooltipHtml?: string;
}) {
  return (
    <span
      {...(tooltipHtml ? { 'data-tooltip-id': TAG_TOOLTIP_ID, 'data-tooltip-html': tooltipHtml } : {})}
      className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[11px] font-medium font-mono ${tooltipHtml ? 'cursor-help' : ''} ${className}`}
    >
      {children}
    </span>
  );
}
