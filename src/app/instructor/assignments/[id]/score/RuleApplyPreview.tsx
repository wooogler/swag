'use client';

/**
 * The cross-query PREVIEW workbench: review the working rule's response across
 * many questions — and (SCORE) pull the ones that need fixing straight into the
 * workbench as example tabs. This is the merged "Preview + Add example": you
 * see a bad response FIRST, then bring its question in to revise against,
 * instead of picking blind from a list.
 *
 *   LEFT   the questions in scope with generation status — SCORE: the intent's
 *          questions (each checkable as an example); baseline (promptMode): the
 *          WHOLE log, 10 at a time, review-only
 *   MIDDLE the CURRENT rule pinned on top · the selected question · original response
 *   RIGHT  the NEW rule pinned on top · the regenerated response under it
 *
 * Responses generate in the background (batches of 6) for the VISIBLE page only,
 * so previewing the whole log never fans out to hundreds of calls at once.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, Loader2, Plus, Sparkles, X } from 'lucide-react';
import type { IntentSummary, ScoreQueryRow } from './IntentBoard';
import { MaterialSegments, QuerySnippet } from './materials';
import { WorkbenchTopBar } from './workbench-shared';
import { ResponseBody } from './conversation';
import { sortQueryRows, type QuerySortMode } from './query-list';
import { getJSON } from './http';

/** Batch cap of the preview endpoint (MAX_PREVIEW_MESSAGES mirror). */
const BATCH = 6;
/** Questions revealed / generated per "Load more" page. */
const PAGE = 10;

// Same sort set the old Add-example picker had (QueryPicker): the shared
// dashboard modes plus the anchor-distance "Most different" — it moved here
// with the picker's job when Add example merged into this preview.
type PreviewSort = QuerySortMode | 'different';

const SORT_CLASS =
  'text-[11px] border border-[hsl(var(--border))] rounded px-1.5 py-0.5 bg-[hsl(var(--background))] text-[hsl(var(--foreground))]';

interface RuleApplyPreviewProps {
  assignmentId: string;
  intent: IntentSummary;
  /** Baseline: `intent` is the hidden prompt-holder; scope is the whole log and
   * the intent-only WHEN header is dropped. */
  promptMode?: boolean;
  rows: ScoreQueryRow[];
  /** The questions in scope, anchor first (SCORE: the intent's; baseline: all). */
  queryIds: number[];
  anchorId: number;
  /** The rule students currently get (last saved major; null = base fallback). */
  beforeRule: string | null;
  beforeLabel: string;
  /** The candidate (current) rule being previewed. */
  afterRule: string | null;
  afterLabel: string;
  isNirvana: boolean;
  /** Already-generated responses under `afterRule` (anchor simulation etc.). */
  seed: Map<number, string | null>;
  onClose: () => void;
  /** SCORE: bring checked questions into the workbench as example tabs,
   * carrying the responses generated here so the tabs open instantly. Absent
   * (baseline) → review-only, no checkboxes. */
  onAddExamples?: (ids: number[], responses: Map<number, string | null>) => void;
  /** Questions already open as tabs — not offered again. */
  existingIds?: Set<number>;
}

export default function RuleApplyPreview({
  assignmentId,
  intent,
  promptMode = false,
  rows,
  queryIds,
  anchorId,
  beforeRule,
  beforeLabel,
  afterRule,
  afterLabel,
  isNirvana,
  seed,
  onClose,
  onAddExamples,
  existingIds,
}: RuleApplyPreviewProps) {
  const base = `/api/instructor/assignments/${assignmentId}/score`;
  const [selectedId, setSelectedId] = useState(anchorId);
  const [visible, setVisible] = useState(Math.min(PAGE, queryIds.length));
  // messageId → generated response under afterRule (null = failed; absent = pending).
  const [gen, setGen] = useState<Map<number, string | null>>(() => new Map(seed));
  const genRef = useRef(gen);
  genRef.current = gen;
  const [error, setError] = useState<string | null>(null);
  // Questions checked to become example tabs (SCORE only).
  const [picked, setPicked] = useState<Set<number>>(new Set());

  const rowById = useMemo(() => new Map(rows.map((r) => [r.messageId, r])), [rows]);
  const selectedRow = rowById.get(selectedId) ?? null;
  const includedCount = useMemo(() => rows.filter((r) => r.pinnedIntents[intent.id] === 'in').length, [rows, intent.id]);
  const excludedCount = useMemo(() => rows.filter((r) => r.pinnedIntents[intent.id] === 'out').length, [rows, intent.id]);

  // Sorting — the anchor stays pinned first (it is the question under
  // revision); the rest reorder. "Most different" ranks by anchor distance so
  // the questions most likely to break the rule surface early.
  const [sortMode, setSortMode] = useState<PreviewSort>('different');
  // Cosine to the anchor per messageId; null = loading, {} = unavailable.
  const [distances, setDistances] = useState<Record<number, number> | null>(null);
  useEffect(() => {
    let alive = true;
    getJSON<{ scores?: Record<number, number> }>(`${base}/intents/${intent.id}/similar?anchor=${anchorId}`)
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
  }, [base, intent.id, anchorId]);

  const sortedIds = useMemo(() => {
    const rest = queryIds.filter((id) => id !== anchorId);
    const restRows = rest
      .map((id) => rowById.get(id))
      .filter((r): r is ScoreQueryRow => r !== undefined);
    let ordered: number[];
    if (sortMode === 'different') {
      if (!distances) {
        ordered = rest; // hold the given order until scores land
      } else {
        // Farthest first = ascending cosine; unscored sink to the bottom.
        const scored = restRows.filter((r) => typeof distances[r.messageId] === 'number');
        const unscored = restRows.filter((r) => typeof distances[r.messageId] !== 'number');
        scored.sort((a, b) => distances[a.messageId] - distances[b.messageId]);
        ordered = [...scored, ...unscored].map((r) => r.messageId);
      }
    } else {
      ordered = sortQueryRows(restRows, sortMode).map((r) => r.messageId);
    }
    return [anchorId, ...ordered];
  }, [queryIds, anchorId, rowById, sortMode, distances]);

  const visibleIds = useMemo(() => sortedIds.slice(0, visible), [sortedIds, visible]);

  const doneCount = visibleIds.filter((id) => gen.has(id)).length;
  const failedCount = visibleIds.filter((id) => gen.has(id) && gen.get(id) === null).length;
  const allVisibleDone = doneCount >= visibleIds.length;
  const moreToLoad = visible < queryIds.length;

  // Generate the missing responses for the VISIBLE page, batch by batch.
  // Re-runs when the page grows (Load more) or the sort reorders which ids are
  // visible — only ids without a response are fetched, so reordering never
  // regenerates what already exists.
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const missing = visibleIds.filter((id) => !genRef.current.has(id));
      for (let i = 0; i < missing.length; i += BATCH) {
        const batch = missing.slice(i, i + BATCH);
        try {
          const res = await fetch(`${base}/preview`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ intentId: intent.id, messageIds: batch, draftRule: afterRule }),
            signal: controller.signal,
          });
          const data = await res.json().catch(() => ({}));
          if (controller.signal.aborted) return;
          if (!res.ok) throw new Error(typeof data?.message === 'string' ? data.message : 'Preview generation failed.');
          const got = new Map<number, string | null>(
            (data.previews as { messageId: number; response: string | null }[]).map((p) => [p.messageId, p.response])
          );
          setGen((prev) => {
            const next = new Map(prev);
            for (const id of batch) next.set(id, got.get(id) ?? null);
            return next;
          });
        } catch (e) {
          if ((e as Error)?.name === 'AbortError' || controller.signal.aborted) return;
          setError((e as Error).message);
          setGen((prev) => {
            const next = new Map(prev);
            for (const id of batch) if (!next.has(id)) next.set(id, null);
            return next;
          });
        }
      }
    })();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleIds]);

  const selectedGen = gen.get(selectedId);
  const selectedPending = !gen.has(selectedId);
  const selectedOriginal = selectedRow?.responseText?.trim() ? selectedRow.responseText : null;

  // The picker's sort set, anchor pinned. Reordering only changes which page
  // generates next — existing responses are never thrown away.
  const sortControl = (
    <span className="flex items-center gap-1.5">
      {sortMode === 'different' && distances === null && (
        <Loader2 className="w-3 h-3 animate-spin text-[hsl(var(--muted-foreground))]" />
      )}
      <select
        value={sortMode}
        onChange={(e) => setSortMode(e.target.value as PreviewSort)}
        className={SORT_CLASS}
        title="Order the questions (the ★ anchor stays first)"
      >
        <option value="different">Most different</option>
        <option value="participant-asc">PID ↑</option>
        <option value="participant-desc">PID ↓</option>
        <option value="recent">Newest</option>
        <option value="oldest">Oldest</option>
      </select>
    </span>
  );

  const ruleHeader = (label: string, rule: string | null, accent: boolean) => (
    <div
      className={`sticky top-0 z-10 border-b px-3 py-2 ${
        accent ? 'border-emerald-200 bg-emerald-50/80 backdrop-blur' : 'border-[hsl(var(--border))] bg-[hsl(var(--card))]/95 backdrop-blur'
      }`}
    >
      <p className={`text-[10px] font-semibold uppercase tracking-wide ${accent ? 'text-emerald-700' : 'text-[hsl(var(--muted-foreground))]'}`}>
        {accent ? (promptMode ? 'New rules' : 'New rule') : promptMode ? 'Deployed rules' : 'Deployed rule'}{' '}
        <span className="font-normal normal-case">· {label}</span>
      </p>
      <p className="mt-1 max-h-28 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-[hsl(var(--foreground))]">
        {rule ?? <span className="italic text-[hsl(var(--muted-foreground))]">No rule yet.</span>}
      </p>
    </div>
  );

  return (
    <div className="flex flex-col gap-3 flex-1 min-h-0">
      {/* TOP BAR — back, title, progress (review-only). Takes the page header
          over from the workbench underneath for as long as it is open. */}
      <WorkbenchTopBar
        title={promptMode ? 'Preview across the log' : `Preview across intent — ${intent.title}`}
        onBack={onClose}
        backLabel="Back"
        backTitle="Back to revising"
        note={
          <span className="flex items-center gap-2">
            <span className="flex items-center gap-2 text-[11px] text-[hsl(var(--muted-foreground))]">
              {!allVisibleDone && <Loader2 className="w-3 h-3 animate-spin" />}
              <span className="tabular-nums">
                {doneCount}/{visibleIds.length} shown
                {moreToLoad ? ` · ${queryIds.length} total` : ''}
                {failedCount > 0 ? ` · ${failedCount} failed` : ''}
              </span>
            </span>
            {error && (
              <span className="flex items-center gap-1 text-[11px] text-red-600">
                <AlertTriangle className="w-3.5 h-3.5" /> {error}
              </span>
            )}
          </span>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(260px,320px)_minmax(0,1fr)_minmax(0,1fr)] gap-4 flex-1 min-h-0">
        {/* LEFT — scope + questions with generation status. */}
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] flex flex-col overflow-hidden min-h-[300px] lg:min-h-0">
          {promptMode ? (
            <div className="shrink-0 flex items-center justify-between gap-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40 px-3 py-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                All questions · {queryIds.length}
              </span>
              {sortControl}
            </div>
          ) : (
            <>
              <div className="shrink-0 border-b border-[hsl(var(--border))] bg-[hsl(var(--card))]/95 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                  When a student… <span className="font-normal normal-case">· {intent.title}</span>
                </p>
                <p className="mt-1 max-h-28 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-[hsl(var(--foreground))]">
                  {intent.definition}
                </p>
                <p className="mt-1 text-[10px] text-[hsl(var(--muted-foreground))]">
                  <span className="text-emerald-700">included {includedCount}</span>
                  {' · '}
                  <span className="text-rose-700">excluded {excludedCount}</span>
                  <span className="font-normal"> — your boundary labels</span>
                </p>
              </div>
              <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-1.5 bg-[hsl(var(--muted))]/40 border-b border-[hsl(var(--border))]">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                  In this intent · {queryIds.length}
                </span>
                {sortControl}
              </div>
            </>
          )}
          <ul className="flex-1 min-h-0 overflow-y-auto divide-y divide-[hsl(var(--border))]/60">
            {visibleIds.map((id) => {
              const r = rowById.get(id);
              if (!r) return null;
              const state = gen.has(id) ? (gen.get(id) ? 'done' : 'failed') : 'pending';
              const active = id === selectedId;
              // Checkable as a new example tab: not the anchor, not open already.
              const canPick = !!onAddExamples && id !== anchorId && !existingIds?.has(id);
              return (
                <li key={id}>
                  <div
                    className={`flex items-start gap-0 ${active ? 'bg-[hsl(var(--muted))]' : 'hover:bg-[hsl(var(--muted))]/40'}`}
                  >
                    {canPick && (
                      <input
                        type="checkbox"
                        className="ml-3 mt-2.5 shrink-0"
                        checked={picked.has(id)}
                        onChange={() =>
                          setPicked((prev) => {
                            const next = new Set(prev);
                            if (next.has(id)) next.delete(id);
                            else next.add(id);
                            return next;
                          })
                        }
                        aria-label="Add this question as an example tab"
                        title="Add this question as an example tab"
                      />
                    )}
                    <button
                      onClick={() => setSelectedId(id)}
                      className={`min-w-0 flex-1 py-2 text-left ${canPick ? 'pl-2 pr-3' : 'px-3'}`}
                    >
                      <span className="flex items-center gap-1.5 text-[11px] text-[hsl(var(--muted-foreground))]">
                        <span className="font-mono">
                          {id === anchorId ? '★ ' : ''}
                          {r.participantToken || '—'}
                          {r.turnNumber > 0 ? ` · T${r.turnNumber}` : ''}
                        </span>
                        <span className="ml-auto shrink-0">
                          {state === 'pending' ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : state === 'failed' ? (
                            <X className="w-3 h-3 text-rose-600" />
                          ) : (
                            <Check className="w-3 h-3 text-emerald-600" />
                          )}
                        </span>
                      </span>
                      <p className="mt-0.5 text-xs leading-snug text-[hsl(var(--foreground))]">
                        <QuerySnippet text={r.queryText} dissection={r.dissection} max={90} />
                      </p>
                    </button>
                  </div>
                </li>
              );
            })}
            {moreToLoad && (
              <li className="p-2">
                <button
                  onClick={() => setVisible((v) => Math.min(v + PAGE, queryIds.length))}
                  className="w-full inline-flex items-center justify-center gap-1 rounded border border-[hsl(var(--border))] px-2 py-1.5 text-[11px] font-medium text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]"
                >
                  <Plus className="w-3 h-3" /> Load {Math.min(PAGE, queryIds.length - visible)} more
                </button>
              </li>
            )}
          </ul>
          {/* The merge's second half: checked questions become example tabs,
              carrying the responses generated here (no second generation). */}
          {onAddExamples && (
            <div className="shrink-0 border-t border-[hsl(var(--border))] px-3 py-2 flex items-center justify-between gap-2">
              <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
                {picked.size} checked
              </span>
              <button
                onClick={() =>
                  onAddExamples(
                    [...picked],
                    new Map([...picked].map((id) => [id, gen.get(id) ?? null]))
                  )
                }
                disabled={picked.size === 0}
                className="inline-flex items-center gap-1 rounded bg-[hsl(var(--primary))] px-2 py-1 text-[11px] font-medium text-[hsl(var(--primary-foreground))] disabled:opacity-50"
                title="Open these as example tabs and revise the rule against them"
              >
                <Plus className="w-3 h-3" /> Add as examples
              </button>
            </div>
          )}
        </div>

        {/* MIDDLE — current rule (sticky) · question · original response */}
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-y-auto min-h-[300px] lg:min-h-0">
          {ruleHeader(beforeLabel, beforeRule, false)}
          {selectedRow && (
            <div className="p-3 space-y-3">
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                  Student question
                </p>
                <p className="text-xs whitespace-pre-wrap rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 p-2 leading-relaxed">
                  <MaterialSegments key={selectedRow.messageId} text={selectedRow.queryText} dissection={selectedRow.dissection} />
                </p>
              </div>
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                  Original response <span className="font-normal normal-case">(as delivered)</span>
                </p>
                {selectedOriginal ? (
                  <ResponseBody text={selectedOriginal} raw={isNirvana} />
                ) : (
                  <p className="text-xs italic text-[hsl(var(--muted-foreground))]">No chatbot response was recorded for this question.</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT — new rule (sticky) · regenerated response */}
        <div className="rounded-lg border border-emerald-200 bg-[hsl(var(--card))] overflow-y-auto min-h-[300px] lg:min-h-0">
          {ruleHeader(afterLabel, afterRule, true)}
          <div className="p-3">
            <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
              <Sparkles className="w-3 h-3" /> Updated response
            </p>
            {selectedPending ? (
              <p className="flex items-center gap-2 py-4 text-xs text-[hsl(var(--muted-foreground))]">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating under the new rule…
              </p>
            ) : selectedGen ? (
              <ResponseBody text={selectedGen} raw={false} />
            ) : (
              <p className="text-xs italic text-[hsl(var(--muted-foreground))]">Generation failed for this question.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
