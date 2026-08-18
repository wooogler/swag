'use client';

/**
 * The cross-query PREVIEW workbench: review the working rule's response across
 * many questions — and (SCORE) pull the ones that need fixing straight into the
 * workbench as example tabs. This is the merged "Preview + Add example": you
 * see a bad response FIRST, then bring its question in to revise against,
 * instead of picking blind from a list.
 *
 *   LEFT   the questions in scope with generation status, each checkable as an
 *          example — an intent's questions, a type root's unclaimed residue, or
 *          (baseline) the WHOLE log, 10 at a time and review-only
 *   MIDDLE the CURRENT rule pinned on top · the selected question · original response
 *   RIGHT  the NEW rule pinned on top · the regenerated response under it
 *
 * Responses generate in the background (batches of 6) for the VISIBLE page only,
 * so previewing the whole log never fans out to hundreds of calls at once.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, Loader2, Plus, Sparkles, X } from 'lucide-react';
import type { IntentSummary, ScoreQueryRow } from './IntentBoard';
import type { RuleTarget } from './RuleWorkbench';
import { MaterialSegments, QuerySnippet } from './materials';
import { PaneSearch, WorkbenchTopBar } from './workbench-shared';
import { ResponseBody } from './conversation';
import { sortByAnchorDistance, sortQueryRows, type QuerySortMode } from './query-list';
import { getJSON } from './http';

/** Batch cap of the preview endpoint (MAX_PREVIEW_MESSAGES mirror). */
const BATCH = 6;
/** Questions revealed / generated per "Load more" page. */
const PAGE = 10;

// Same sort set the old Add-example picker had: the shared dashboard modes
// plus the anchor-distance "Most different". Both moved here — along with the
// picker's text search — when Add example merged into this preview, in both
// conditions; the picker itself is gone.
type PreviewSort = QuerySortMode | 'different';

const SORT_CLASS =
  'text-[11px] border border-[hsl(var(--border))] rounded px-1.5 py-0.5 bg-[hsl(var(--background))] text-[hsl(var(--foreground))]';

interface RuleApplyPreviewProps {
  assignmentId: string;
  intent: IntentSummary;
  /** Which rule is being previewed — the same three-way split RuleWorkbench
   * makes. It decides what this screen CALLS the set it is showing: an intent's
   * questions, a type's unclaimed residue, or the whole log. Inferring it from
   * a single promptMode flag used to tell a type root it was previewing "all
   * questions" while showing it a narrowed set — the exact misreading the type
   * root's read-only WHEN exists to prevent. */
  variant?: RuleTarget;
  /** The type's display name, for the 'type-root' variant. */
  scopeLabel?: string | null;
  /** WHERE this set sits in its type's first-match chain — the v7 shape of an
   * intent. Shown under the When, in place of the v6 boundary-pin counts that
   * used to sit there: pins were the old membership model, so on a v7 board
   * they read "included 0 · excluded 0" on every set that was never pinned,
   * which says nothing about the set and is wrong about how it is scoped. */
  placement?: { typeLabel: string | null; parentTitle: string | null } | null;
  rows: ScoreQueryRow[];
  /** The questions in scope, anchor first. */
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
  /** Hand the workbench the FULL example set the boxes now describe (anchor
   * excluded — it is never optional), carrying the responses generated here so
   * new tabs open instantly. The checkboxes start on `existingIds`, so this
   * call adds what was ticked AND drops what was unticked. Absent (baseline) →
   * review-only, no checkboxes. */
  onAddExamples?: (ids: number[], responses: Map<number, string | null>) => void;
  /** Questions already open as tabs — their boxes start CHECKED. They used to
   * get no box at all, which made the list disagree with the workbench behind
   * it: three tabs were open and the list showed no sign of them. */
  existingIds?: Set<number>;
}

export default function RuleApplyPreview({
  assignmentId,
  intent,
  variant = 'intent',
  scopeLabel = null,
  placement = null,
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
  /** The baseline's rules DOCUMENT — the only target with no bounded set, and
   * the only one whose copy is plural. */
  const monolith = variant === 'prompt';
  /** What this screen is showing, named. */
  const scopeTitle =
    variant === 'intent'
      ? `Preview across intent — ${intent.title}`
      : variant === 'type-root'
        ? `Preview across ${scopeLabel ?? 'this type'} — questions no set claims`
        : 'Preview across the log';
  const base = `/api/instructor/assignments/${assignmentId}/score`;
  const [selectedId, setSelectedId] = useState(anchorId);
  const [visible, setVisible] = useState(Math.min(PAGE, queryIds.length));
  // messageId → generated response under afterRule (null = failed; absent = pending).
  const [gen, setGen] = useState<Map<number, string | null>>(() => new Map(seed));
  const genRef = useRef(gen);
  genRef.current = gen;
  const [error, setError] = useState<string | null>(null);
  // The example set as the boxes describe it — SEEDED with the tabs already
  // open, so the list opens showing what the workbench is showing. Ticking adds
  // a tab, unticking removes one; the anchor is not in here (it cannot leave).
  const [picked, setPicked] = useState<Set<number>>(
    () => new Set([...(existingIds ?? [])].filter((id) => id !== anchorId))
  );
  const startingPicked = useRef(picked);
  const added = useMemo(() => [...picked].filter((id) => !startingPicked.current.has(id)), [picked]);
  const dropped = useMemo(() => [...startingPicked.current].filter((id) => !picked.has(id)), [picked]);

  const rowById = useMemo(() => new Map(rows.map((r) => [r.messageId, r])), [rows]);
  const selectedRow = rowById.get(selectedId) ?? null;

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

  /** Text search over the questions in scope. This screen is now the ONE door
   * to a rule's other questions in both conditions, and the baseline's scope is
   * the whole log — without a way to jump to a remembered question, "find the
   * one about thesis statements" meant paging through 50 screens. Came over
   * from the picker along with the sort. */
  const [search, setSearch] = useState('');

  const sortedIds = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rest = queryIds.filter((id) => id !== anchorId);
    const restRows = rest
      .map((id) => rowById.get(id))
      .filter((r): r is ScoreQueryRow => r !== undefined)
      // The anchor is exempt: it is the question under revision and stays
      // pinned first whatever is typed.
      .filter((r) => !q || r.queryText.toLowerCase().includes(q));
    let ordered: number[];
    if (sortMode === 'different') {
      // Same helper the workbench seeds its example tabs with, so the tabs are
      // literally the first three rows of this list.
      ordered = distances ? sortByAnchorDistance(restRows, distances).map((r) => r.messageId) : rest;
    } else {
      ordered = sortQueryRows(restRows, sortMode).map((r) => r.messageId);
    }
    return [anchorId, ...ordered];
  }, [queryIds, anchorId, rowById, sortMode, distances, search]);

  const visibleIds = useMemo(() => sortedIds.slice(0, visible), [sortedIds, visible]);

  const doneCount = visibleIds.filter((id) => gen.has(id)).length;
  const failedCount = visibleIds.filter((id) => gen.has(id) && gen.get(id) === null).length;
  const allVisibleDone = doneCount >= visibleIds.length;
  // Against the SEARCHED list, not the raw scope — otherwise a search that
  // narrows to 3 questions still offers "Load more".
  const moreToLoad = visible < sortedIds.length;

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
        {accent ? (monolith ? 'New rules' : 'New rule') : monolith ? 'Deployed rules' : 'Deployed rule'}{' '}
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
        title={scopeTitle}
        onBack={onClose}
        backLabel="Back"
        backTitle="Back to revising"
        note={
          <span className="flex items-center gap-2">
            <span className="flex items-center gap-2 text-[11px] text-[hsl(var(--muted-foreground))]">
              {!allVisibleDone && <Loader2 className="w-3 h-3 animate-spin" />}
              <span className="tabular-nums">
                {doneCount}/{visibleIds.length} shown
                {moreToLoad ? ` · ${sortedIds.length} total` : ''}
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
          {variant === 'intent' ? (
            <>
              <div className="shrink-0 border-b border-[hsl(var(--border))] bg-[hsl(var(--card))]/95 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                  When a student… <span className="font-normal normal-case">· {intent.title}</span>
                </p>
                <p className="mt-1 max-h-28 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-[hsl(var(--foreground))]">
                  {intent.definition}
                </p>
                {/* WHERE the set sits, not how it was once pinned: under v7 a
                    set is a node in one type's first-match chain, and that
                    placement is what decides which questions reach it — which
                    is exactly the list underneath. */}
                <p
                  className="mt-1 text-[10px] text-[hsl(var(--muted-foreground))]"
                  title="A set only ever sees its own type, and only the questions no earlier set in that chain already answered."
                >
                  {placement?.typeLabel ? (
                    <span className="font-medium text-[hsl(var(--foreground))]">{placement.typeLabel}</span>
                  ) : (
                    <span className="italic">Not typed yet</span>
                  )}
                  {' · '}
                  {placement?.parentTitle ? `inside “${placement.parentTitle}”` : 'top-level set'}
                </p>
              </div>
              <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-1.5 bg-[hsl(var(--muted))]/40 border-b border-[hsl(var(--border))]">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                  In this intent · {queryIds.length}
                </span>
                {sortControl}
              </div>
            </>
          ) : (
            /* A type root's set is neither an intent's nor "everything": it is
               exactly what its chain left over, and saying so here is the point
               — this screen is the type root's only cross-query view, so a
               header reading "All questions" would state the opposite of what
               its rule does. */
            <div className="shrink-0 flex items-center justify-between gap-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40 px-3 py-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                {variant === 'type-root'
                  ? `${scopeLabel ?? 'Type'} · no set claims · ${queryIds.length}`
                  : `All questions · ${queryIds.length}`}
              </span>
              {sortControl}
            </div>
          )}
          {/* Search sits under whichever header rendered, so the count above
              always names the SCOPE and this narrows what is listed. */}
          <div className="shrink-0 px-3 py-1.5 border-b border-[hsl(var(--border))]">
            <PaneSearch value={search} onChange={setSearch} />
          </div>
          <ul className="flex-1 min-h-0 overflow-y-auto divide-y divide-[hsl(var(--border))]/60">
            {visibleIds.map((id) => {
              const r = rowById.get(id);
              if (!r) return null;
              const state = gen.has(id) ? (gen.get(id) ? 'done' : 'failed') : 'pending';
              const active = id === selectedId;
              // Every question in scope carries a box, and the box IS the
              // example set: ticked = open as a tab. The anchor's is ticked and
              // locked — it is the question under revision.
              const boxed = !!onAddExamples;
              const isAnchor = id === anchorId;
              return (
                <li key={id}>
                  <div
                    className={`flex items-start gap-0 ${active ? 'bg-[hsl(var(--muted))]' : 'hover:bg-[hsl(var(--muted))]/40'}`}
                  >
                    {boxed && (
                      <input
                        type="checkbox"
                        className="ml-3 mt-2.5 shrink-0 disabled:opacity-60"
                        checked={isAnchor || picked.has(id)}
                        disabled={isAnchor}
                        onChange={() =>
                          setPicked((prev) => {
                            const next = new Set(prev);
                            if (next.has(id)) next.delete(id);
                            else next.add(id);
                            return next;
                          })
                        }
                        aria-label={isAnchor ? 'The question you are revising' : 'Keep this question as an example'}
                        title={
                          isAnchor
                            ? 'The question you are revising — always open'
                            : picked.has(id)
                              ? 'Open as an example tab — untick to drop it'
                              : 'Tick to open this question as an example tab'
                        }
                      />
                    )}
                    <button
                      onClick={() => setSelectedId(id)}
                      className={`min-w-0 flex-1 py-2 text-left ${boxed ? 'pl-2 pr-3' : 'px-3'}`}
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
                  onClick={() => setVisible((v) => Math.min(v + PAGE, sortedIds.length))}
                  className="w-full inline-flex items-center justify-center gap-1 rounded border border-[hsl(var(--border))] px-2 py-1.5 text-[11px] font-medium text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]"
                >
                  <Plus className="w-3 h-3" /> Load {Math.min(PAGE, sortedIds.length - visible)} more
                </button>
              </li>
            )}
          </ul>
          {/* The merge's second half: the ticked questions ARE the workbench's
              example tabs, carrying the responses generated here (no second
              generation). Says what the click will change, so a stray untick on
              a tab you already had open is visible before it happens. */}
          {onAddExamples && (
            <div className="shrink-0 border-t border-[hsl(var(--border))] px-3 py-2 flex items-center justify-between gap-2">
              <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
                {picked.size + 1} example{picked.size === 0 ? '' : 's'}
                {added.length > 0 && <span className="text-emerald-700"> · {added.length} new</span>}
                {dropped.length > 0 && <span className="text-rose-700"> · {dropped.length} dropped</span>}
              </span>
              <button
                onClick={() =>
                  onAddExamples(
                    [...picked],
                    new Map([...picked].map((id) => [id, gen.get(id) ?? null]))
                  )
                }
                disabled={added.length === 0 && dropped.length === 0}
                className="inline-flex items-center gap-1 rounded bg-[hsl(var(--primary))] px-2 py-1 text-[11px] font-medium text-[hsl(var(--primary-foreground))] disabled:opacity-50"
                title={
                  dropped.length > 0
                    ? 'Open the ticked questions as example tabs and close the unticked ones'
                    : 'Open these as example tabs and revise the rule against them'
                }
              >
                <Plus className="w-3 h-3" /> {dropped.length > 0 ? 'Update examples' : 'Add as examples'}
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
                  <MaterialSegments key={selectedRow.messageId} text={selectedRow.queryText} dissection={selectedRow.dissection} toggleAll />
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
