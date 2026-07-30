'use client';

/**
 * Multi-select picker over the student query log — add logged questions to the
 * Revise "review set" (example tabs), for BOTH the SCORE rule workbench and the
 * baseline ablation (they share this component via RuleWorkbench). Reuses the
 * dashboard's pieces for a consistent UX:
 *   · QuerySnippet (material-aware question text) + the shared sort dropdown, and
 *   · ConversationThread — the SAME full-thread viewer the board uses — so a
 *     candidate's whole conversation is one click away before you add it.
 *
 * Ordering defaults to "Most different": the questions semantically FARTHEST
 * from the one being viewed (anchorId) come first, and the 3 farthest are
 * pre-selected — a diverse review set with one click. Distances come from the
 * embeddings service (…/similar?anchor=), degrading to recency if unavailable.
 * Spec §4.3.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, Loader2, Maximize2, Minimize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ScoreQueryRow } from './IntentBoard';
import { QuerySnippet } from './materials';
import { ConversationThread } from './conversation';
import { sortQueryRows, type QuerySortMode } from './query-list';
import { getJSON } from './http';

// The picker's own sort adds "Most different" (anchor distance) on top of the
// shared dashboard modes — it's anchor-specific, so it stays out of query-list's
// shared SortSelect (which the board, with no anchor, also uses).
type PickerSort = QuerySortMode | 'different';

const SORT_CLASS =
  'text-xs border border-[hsl(var(--border))] rounded px-1.5 py-0.5 bg-[hsl(var(--background))] text-[hsl(var(--foreground))]';

interface QueryPickerProps {
  log: ScoreQueryRow[];
  excludeIds?: Set<number>;
  /** The question currently being viewed — distance is measured FROM here, and
   * it's already excluded (it's an open tab), so it never shows as a candidate. */
  anchorId: number;
  assignmentId: string;
  /** Any intent id on the path; the anchor-distance query ignores pins, so the
   * baseline's prompt-holder intent works the same as a real SCORE intent. */
  intentId: number;
  isNirvana: boolean;
  onAdd: (messageIds: number[]) => void;
  onClose: () => void;
}

export default function QueryPicker({
  log,
  excludeIds,
  anchorId,
  assignmentId,
  intentId,
  isNirvana,
  onAdd,
  onClose,
}: QueryPickerProps) {
  const [q, setQ] = useState('');
  const [sortMode, setSortMode] = useState<PickerSort>('different');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [focusId, setFocusId] = useState<number | null>(null);
  // The preview opens on the focused question's own turn; the full thread is a
  // toggle away and doesn't carry over when you focus a different candidate.
  const [showFull, setShowFull] = useState(false);
  // Cosine to the anchor per messageId; null = still loading, {} = unavailable.
  const [distances, setDistances] = useState<Record<number, number> | null>(null);

  const base = `/api/instructor/assignments/${assignmentId}/score`;

  // Load anchor distances once. On failure/empty, fall back to recency so the
  // dropdown never claims an ordering it can't deliver.
  useEffect(() => {
    let alive = true;
    getJSON<{ scores?: Record<number, number> }>(`${base}/intents/${intentId}/similar?anchor=${anchorId}`)
      .then((d) => {
        if (!alive) return;
        const s = d.scores ?? {};
        setDistances(s);
        if (Object.keys(s).length === 0) setSortMode('recent');
      })
      .catch(() => {
        if (!alive) return;
        setDistances({});
        setSortMode('recent');
      });
    return () => {
      alive = false;
    };
  }, [base, intentId, anchorId]);

  // Pre-select the 3 semantically-farthest candidates (search-independent) and
  // focus the farthest so its conversation shows on open. Seeds once, when the
  // distances first land — the instructor's own checks/unchecks then stick.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || !distances) return;
    seededRef.current = true;
    const ranked = log
      .filter(
        (r) =>
          r.messageId !== anchorId &&
          !excludeIds?.has(r.messageId) &&
          typeof distances[r.messageId] === 'number'
      )
      .sort((a, b) => distances[a.messageId] - distances[b.messageId]);
    const top3 = ranked.slice(0, 3).map((r) => r.messageId);
    if (top3.length) {
      setSelected(new Set(top3));
      setFocusId((f) => f ?? top3[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [distances]);

  // Every newly-focused candidate opens on its single turn.
  useEffect(() => {
    setShowFull(false);
  }, [focusId]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = log.filter(
      (r) =>
        r.messageId !== anchorId &&
        !excludeIds?.has(r.messageId) &&
        (!needle || r.queryText.toLowerCase().includes(needle))
    );
    if (sortMode === 'different') {
      if (!distances) return sortQueryRows(filtered, 'recent'); // hold until scores land
      // Farthest first = ascending cosine; unscored questions sink to the bottom.
      const scored = filtered.filter((r) => typeof distances[r.messageId] === 'number');
      const unscored = filtered.filter((r) => typeof distances[r.messageId] !== 'number');
      scored.sort((a, b) => distances[a.messageId] - distances[b.messageId]);
      return [...scored, ...unscored];
    }
    return sortQueryRows(filtered, sortMode);
  }, [log, q, excludeIds, anchorId, sortMode, distances]);

  function toggle(id: number) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  const focusRow = focusId != null ? log.find((r) => r.messageId === focusId) ?? null : null;
  const distancesReady = distances !== null && Object.keys(distances).length > 0;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-5xl h-[85vh] flex flex-col rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 flex items-center justify-between gap-2 px-5 py-3 border-b border-[hsl(var(--border))]">
          <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">Add examples from the log</h3>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Toolbar — same search + sort styling as the dashboard query list, plus
            the anchor-distance "Most different" default. */}
        <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-[hsl(var(--border))]">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[hsl(var(--muted-foreground))]" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search query text…" className="pl-7" autoFocus />
          </div>
          {sortMode === 'different' && distances === null && (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-[hsl(var(--muted-foreground))]" />
          )}
          <select value={sortMode} onChange={(e) => setSortMode(e.target.value as PickerSort)} className={SORT_CLASS}>
            <option value="different">Most different</option>
            <option value="participant-asc">PID ↑</option>
            <option value="participant-desc">PID ↓</option>
            <option value="recent">Newest</option>
            <option value="oldest">Oldest</option>
          </select>
        </div>

        <div className="flex-1 min-h-0 flex flex-col sm:flex-row">
          {/* LEFT — candidate list. Checkbox adds to the set; the row body opens
              its conversation in the pane on the right. */}
          <div className="sm:w-[42%] sm:max-w-md shrink-0 flex flex-col min-h-0 border-b sm:border-b-0 sm:border-r border-[hsl(var(--border))]">
            {sortMode === 'different' && distancesReady && (
              <p className="shrink-0 px-4 py-1.5 text-[11px] text-[hsl(var(--muted-foreground))] bg-[hsl(var(--muted))]/30 border-b border-[hsl(var(--border))]">
                Ordered by difference from the question you are viewing · 3 pre-selected
              </p>
            )}
            <div className="flex-1 min-h-0 overflow-y-auto">
              {rows.length === 0 ? (
                <p className="px-4 py-6 text-sm text-[hsl(var(--muted-foreground))]">No matching questions.</p>
              ) : (
                <ul className="divide-y divide-[hsl(var(--border))]">
                  {rows.map((r) => {
                    const on = selected.has(r.messageId);
                    const focused = r.messageId === focusId;
                    return (
                      <li
                        key={r.messageId}
                        className={focused ? 'ring-1 ring-inset ring-[hsl(var(--primary))]/50' : ''}
                      >
                        <div
                          className={`flex items-start gap-2 px-4 py-2.5 ${
                            on ? 'bg-[hsl(var(--muted))]' : 'hover:bg-[hsl(var(--muted))]/40'
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="mt-1 shrink-0"
                            checked={on}
                            onChange={() => toggle(r.messageId)}
                            aria-label="Add this question to the review set"
                          />
                          <button
                            type="button"
                            onClick={() => setFocusId(r.messageId)}
                            className="min-w-0 flex-1 text-left"
                          >
                            <span className="flex items-center justify-between gap-2 mb-1">
                              <span className="text-[11px] font-mono text-[hsl(var(--muted-foreground))]">
                                {r.participantToken || '—'}
                                {r.turnNumber > 0 && <span className="ml-1 font-sans">· Turn {r.turnNumber}</span>}
                              </span>
                              <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
                                {new Date(r.queryTimestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                              </span>
                            </span>
                            <span className="block text-sm text-[hsl(var(--foreground))] leading-snug">
                              <QuerySnippet text={r.queryText} dissection={r.dissection} />
                            </span>
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          {/* RIGHT — the focused candidate's Q→response (dashboard viewer), with
              the full thread one toggle away. Same bubbles either way. */}
          <div className="flex-1 min-h-0 flex flex-col">
            {focusRow ? (
              <>
                <div className="shrink-0 px-4 py-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40 text-[11px] text-[hsl(var(--muted-foreground))] flex items-center gap-2 flex-wrap">
                  <span className="font-mono">{focusRow.participantToken || '—'}</span>
                  {focusRow.turnNumber > 0 && <span>· Turn {focusRow.turnNumber}</span>}
                  <span>{new Date(focusRow.queryTimestamp).toLocaleString()}</span>
                  <button
                    type="button"
                    onClick={() => setShowFull((v) => !v)}
                    className="ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-[hsl(var(--border))] text-[10px] font-medium text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
                    title={
                      showFull
                        ? 'Show just this question and its response'
                        : 'Show the whole conversation this question sits in'
                    }
                  >
                    {showFull ? (
                      <>
                        <Minimize2 className="w-2.5 h-2.5" /> This turn
                      </>
                    ) : (
                      <>
                        <Maximize2 className="w-2.5 h-2.5" /> Full conversation
                      </>
                    )}
                  </button>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
                  <ConversationThread
                    rows={log}
                    current={focusRow}
                    isNirvana={isNirvana}
                    singleTurn={!showFull}
                  />
                </div>
              </>
            ) : (
              <p className="m-auto text-sm text-[hsl(var(--muted-foreground))]">
                Select a question to preview it.
              </p>
            )}
          </div>
        </div>

        <div className="shrink-0 flex items-center justify-between px-5 py-3 border-t border-[hsl(var(--border))]">
          <span className="text-xs text-[hsl(var(--muted-foreground))]">{selected.size} selected</span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                onAdd([...selected]);
                onClose();
              }}
              disabled={selected.size === 0}
            >
              Add
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
