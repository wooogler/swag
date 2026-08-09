'use client';

/**
 * Baseline "filter" workbench — the SCORE IntentWorkbench with the intent-only
 * parts ablated. The GRID IS THE INTENTWORKBENCH'S: same three tracks, the
 * spec on the left, the same results card in the middle, and the third track
 * deliberately EMPTY where "Needs decision" would sit — so the two workbenches
 * put the same things in the same places at the same widths, and what the
 * baseline lacks reads as absence, not as a different tool. Ablated: pins, the
 * probably-in/out "Needs decision" column, boundary/drift chips, versioning.
 *
 * A filter belongs to the query type it was created under. The probe still
 * rates the WHOLE log (that keeps its cache aligned with the prepared
 * templates, so a starter seed's results are there on open), but the list
 * shows only the filter's own type — a filter saved under Planning filters
 * Planning. Server-side this is still a "search" (baseline_searches,
 * search_save/search_run events). See docs/STUDY_BASELINE_SPEC.md §B-2.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Minimize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ScoreQueryType } from '@/lib/score/intents';
import type { ScoreQueryRow } from './IntentBoard';
import { ConversationThread } from './conversation';
import { DefinitionEditor, PaneSearch, QueryTextButton, WorkbenchTopBar } from './workbench-shared';
import { postJSON } from './http';

/** A filter is only ever opened with a seed from the create chooser, or
 * reopened from the saved list — there is no blank entry. `type` is null only
 * on rows saved before filters were grouped by type (those show the whole log). */
export type FilterMode =
  | { kind: 'new'; name: string; definition: string; type: ScoreQueryType }
  | { kind: 'saved'; searchId: string; name: string | null; definition: string; type: ScoreQueryType | null };

interface FilterWorkbenchProps {
  assignmentId: string;
  rows: ScoreQueryRow[];
  isNirvana: boolean;
  mode: FilterMode;
  /** The type's display accents, passed from the board so the top bar names
   * the same place the left column shows. Null on legacy untyped filters. */
  typeLabel: string | null;
  typeDot: string | null;
  onExit: () => void;
}

type FilterSort = 'newest' | 'oldest';

export default function FilterWorkbench({
  assignmentId,
  rows,
  isNirvana,
  mode,
  typeLabel,
  typeDot,
  onExit,
}: FilterWorkbenchProps) {
  const base = `/api/instructor/assignments/${assignmentId}/score`;
  const rowById = useMemo(() => new Map(rows.map((r) => [r.messageId, r])), [rows]);

  const [name, setName] = useState(mode.name ?? '');
  const [definition, setDefinition] = useState(mode.definition);
  const [results, setResults] = useState<number[] | null>(null); // clearly_in messageIds (whole log)
  /** The description `results` actually belong to. Saving a description that
   * has never been run would store a row whose defHash has no probe cache, and
   * the board reads its count straight out of that cache — so the filter would
   * come back reading 0 matches right after a successful "Saved". Mirrors the
   * IntentWorkbench's `applied` gate on Save. */
  const [ranDefinition, setRanDefinition] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<{ rated: number; total: number } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const cancelled = useRef(false);
  useEffect(() => () => { cancelled.current = true; }, []);

  /** What is currently on the server, once there is a row at all. Save writes
   * back to THIS id rather than adding a second copy of the same filter, and a
   * rename with no wording change still counts as something to save. */
  const [persisted, setPersisted] = useState<{ id: string; name: string; definition: string } | null>(
    mode.kind === 'saved' ? { id: mode.searchId, name: mode.name ?? '', definition: mode.definition } : null
  );
  const dirty = !persisted || definition !== persisted.definition || name !== persisted.name;
  const applied = ranDefinition !== null && ranDefinition === definition;

  useEffect(() => {
    // Both entry paths arrive with a description, so both run on open. A seed
    // taken from the starter suggestions is already rated across the log, so
    // its probe is a cache read and the matches are simply there — which is
    // what the chooser's "questions appear immediately" note promised.
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run() {
    // The text this run is FOR: `definition` can change under an await, and the
    // results must not end up labelled with a description that did not produce
    // them.
    const text = definition;
    setRunning(true);
    setNote(null);
    try {
      for (let guard = 0; guard < 100; guard++) {
        if (cancelled.current) return;
        const data = await postJSON<{
          clearlyIn?: { messageId: number }[];
          rated: number;
          total: number;
          remaining: number;
          ratedThisBatch: number;
        }>(`${base}/probe`, { description: text });
        setResults((data.clearlyIn ?? []).map((x) => x.messageId));
        setRanDefinition(text);
        setProgress({ rated: data.rated, total: data.total });
        if (data.remaining === 0 || data.ratedThisBatch === 0) break;
      }
    } catch (e) {
      setNote(`Run failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setRunning(false);
    }
  }

  async function save() {
    if (saving) return; // a second click would insert a duplicate row
    setSaving(true);
    setNote(null);
    try {
      const res = await postJSON<{ id: string }>(`${base}/baseline/searches`, {
        description: definition,
        name: name.trim(),
        ...(mode.type ? { type: mode.type } : {}),
        ...(persisted ? { id: persisted.id } : {}),
      });
      setPersisted({ id: res.id, name, definition });
      setNote('Saved');
    } catch (e) {
      setNote(`Save failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSaving(false);
    }
  }

  // ---- The middle pane: the filter's questions, IntentWorkbench-style ------
  const [sort, setSort] = useState<FilterSort>('newest');
  const [paneSearch, setPaneSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [convoId, setConvoId] = useState<number | null>(null);
  /** The row whose conversation was last opened, marked so a return from the
   * thread lands somewhere recognizable (same affordance as IntentWorkbench). */
  const [lastOpened, setLastOpened] = useState<number | null>(null);

  // The filter's own type is what it shows; the whole-log sweep stays in the
  // cache for anything else that reuses this description. This is the FILTER'S
  // SIZE — the header counts it, and the pane's search box narrows only the
  // rendered rows below (same split as IntentWorkbench, where the search never
  // moves the "In this intent · N" number).
  const inThisFilter = useMemo(() => {
    if (results === null) return null;
    return results
      .map((mid) => rowById.get(mid))
      .filter((r): r is ScoreQueryRow => !!r && (mode.type === null || r.queryType === mode.type));
  }, [results, rowById, mode.type]);

  const visibleRows = useMemo(() => {
    if (inThisFilter === null) return null;
    const q = paneSearch.trim().toLowerCase();
    const dir = sort === 'newest' ? -1 : 1;
    return inThisFilter
      .filter((r) => !q || r.queryText.toLowerCase().includes(q))
      .sort((a, b) => dir * a.queryTimestamp.localeCompare(b.queryTimestamp));
  }, [inThisFilter, paneSearch, sort]);

  const pct = progress && progress.total > 0 ? Math.round((progress.rated / progress.total) * 100) : 0;
  const convoRow = convoId != null ? rowById.get(convoId) : null;

  return (
    <div className="flex flex-col gap-2 flex-1 min-h-0">
      <WorkbenchTopBar
        title={`${mode.kind === 'saved' ? 'Edit filter' : 'New Filter'}${name.trim() ? ` — ${name.trim()}` : ''}`}
        note={
          typeLabel ? (
            <span className="inline-flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${typeDot ?? 'bg-gray-400'}`} />
              in {typeLabel}
            </span>
          ) : undefined
        }
        onBack={onExit}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[380px_minmax(0,1fr)_minmax(0,1fr)] gap-4 flex-1 min-h-0">
        {/* LEFT — the spec: name, description, actions */}
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-y-auto">
          <div className="p-4 space-y-3">
            <label className="block text-sm cursor-text">
              <span className="font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                Name
              </span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Auto-named on save if empty"
                className="mt-1 w-full text-sm border border-[hsl(var(--border))] rounded px-2 py-1.5 bg-[hsl(var(--background))]"
              />
            </label>
            <DefinitionEditor
              value={definition}
              onChange={setDefinition}
              label="When a question…"
              placeholder="e.g. asks the chatbot to write a thesis statement or conclusion for them"
            />
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={run} disabled={running || !definition.trim()}>
                {running ? `Running… ${pct}%` : 'Run'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={save}
                // Saving text that has not been run would store a filter whose
                // results have never been computed — the board reads its count
                // out of that cache, so it would come back reading 0 matches
                // right after a successful "Saved".
                disabled={running || saving || !definition.trim() || !dirty || !applied}
                title={applied ? undefined : 'Run this filter first — Save stores what it collects'}
              >
                {saving ? 'Saving…' : dirty ? 'Save filter' : 'Saved'}
              </Button>
              {note && <span className="text-sm text-[hsl(var(--muted-foreground))]">{note}</span>}
            </div>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              {typeLabel
                ? `Collects every ${typeLabel} question that matches this description. Read them to decide what to write in your rules.`
                : 'Collects every logged question that matches this description. Read them to decide what to write in your rules.'}
            </p>
          </div>
        </div>

        {/* MIDDLE — In this filter (IntentWorkbench's results card, ablated) */}
        <div className="relative rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] flex flex-col overflow-hidden min-h-[300px] lg:min-h-0">
          {/* Conversation view covers the pane instead of replacing it, so the
              list underneath keeps its scroll position on Exit. */}
          {convoRow && (
            <div className="absolute inset-0 z-20 flex flex-col bg-[hsl(var(--card))]">
              <div className="shrink-0 px-3 py-1.5 bg-[hsl(var(--muted))]/40 border-b border-[hsl(var(--border))] flex items-center justify-between gap-2">
                <button
                  onClick={() => setConvoId(null)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[hsl(var(--border))] text-xs font-medium text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]"
                  title="Back to the list — it keeps the place you left it"
                >
                  <Minimize2 className="w-3.5 h-3.5" /> Exit conversation
                </button>
              </div>
              <ConversationThread rows={rows} current={convoRow} isNirvana={isNirvana} expandMaterials />
            </div>
          )}
          {inThisFilter === null || visibleRows === null ? (
            <div className="flex-1 flex items-center justify-center p-8 text-center text-sm text-[hsl(var(--muted-foreground))]">
              {running
                ? 'Rating every question in the log against this description…'
                : 'Run to list the questions this filter collects.'}
            </div>
          ) : (
            <div className="flex-1 min-h-0 flex flex-col">
              <div className="shrink-0 bg-[hsl(var(--card))] border-b border-[hsl(var(--border))]">
                <div className="px-3 py-1.5 bg-[hsl(var(--muted))]/60 border-b border-[hsl(var(--border))] flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                    In this filter · {inThisFilter.length}
                  </span>
                  <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value as FilterSort)}
                    title="Sort"
                    className="text-xs border border-[hsl(var(--border))] rounded px-1 py-0.5 bg-[hsl(var(--background))] text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
                  >
                    <option value="newest">Newest</option>
                    <option value="oldest">Oldest</option>
                  </select>
                </div>
                <div className="px-3 py-1.5">
                  <PaneSearch value={paneSearch} onChange={setPaneSearch} />
                </div>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto">
                {visibleRows.length > 0 ? (
                  <ul className="divide-y divide-[hsl(var(--border))]/60">
                    {visibleRows.map((r) => {
                      const marked = lastOpened === r.messageId;
                      return (
                        <li
                          key={r.messageId}
                          title={marked ? 'The conversation you last opened' : undefined}
                          className={`group relative px-3 py-2 border-l-2 ${
                            marked
                              ? 'border-l-[hsl(var(--ring))] bg-[hsl(var(--muted))]/60'
                              : 'border-l-transparent hover:bg-[hsl(var(--muted))]/40'
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            <QueryTextButton
                              queryText={r.queryText}
                              dissection={r.dissection}
                              expanded={expanded.has(r.messageId)}
                              onToggleExpand={() =>
                                setExpanded((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(r.messageId)) next.delete(r.messageId);
                                  else next.add(r.messageId);
                                  return next;
                                })
                              }
                              onOpen={() => {
                                setConvoId(r.messageId);
                                setLastOpened(r.messageId);
                              }}
                            />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="p-4 text-sm text-[hsl(var(--muted-foreground))]">
                    {paneSearch
                      ? 'No matching question.'
                      : running
                        ? 'Rating the log — collected questions appear here as they land…'
                        : 'Nothing collected — edit the description and Run again.'}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT — deliberately empty. This is where the IntentWorkbench puts
            "Needs decision"; keeping the track (rather than letting the middle
            card swallow it) keeps the two workbenches the same shape, so the
            ablated column reads as absence instead of a different layout. */}
        <div aria-hidden className="hidden lg:block" />
      </div>
    </div>
  );
}
