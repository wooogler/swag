'use client';

/**
 * Baseline "custom search" — the SCORE IntentWorkbench with the intent-only
 * parts ablated: the same definition editor + clearly_in results list, minus the
 * title, pins, and the probably-in/out "Needs decision" column. Typing a
 * definition runs the judge (probe) and lists only clearly_in; Save persists a
 * named search. Shares WorkbenchTopBar/DefinitionEditor/QueryTextButton +
 * ConversationThread with SCORE. See docs/STUDY_BASELINE_SPEC.md §B-2.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { ScoreQueryRow } from './IntentBoard';
import { ConversationThread } from './conversation';
import { DefinitionEditor, QueryTextButton, WorkbenchTopBar } from './workbench-shared';
import { getJSON, postJSON } from './http';

export type SearchMode =
  | { kind: 'new' }
  | { kind: 'preset'; intentId: number; definition: string; title: string }
  | { kind: 'saved'; searchId: string; definition: string };

interface SearchWorkbenchProps {
  assignmentId: string;
  rows: ScoreQueryRow[];
  isNirvana: boolean;
  mode: SearchMode;
  onExit: () => void;
}

export default function SearchWorkbench({ assignmentId, rows, isNirvana, mode, onExit }: SearchWorkbenchProps) {
  const base = `/api/instructor/assignments/${assignmentId}/score`;
  const rowById = useMemo(() => new Map(rows.map((r) => [r.messageId, r])), [rows]);

  const [definition, setDefinition] = useState(mode.kind === 'new' ? '' : mode.definition);
  const [results, setResults] = useState<number[] | null>(null); // clearly_in messageIds
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ rated: number; total: number } | null>(null);
  const [saved, setSaved] = useState(mode.kind === 'saved');
  const [note, setNote] = useState<string | null>(null);
  const [convoId, setConvoId] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const cancelled = useRef(false);
  useEffect(() => () => { cancelled.current = true; }, []);

  const initialDefinition = mode.kind === 'new' ? '' : mode.definition;
  const dirty = definition !== initialDefinition;

  useEffect(() => {
    if (mode.kind === 'preset') {
      // Instant — read the copied intent ratings, no LLM.
      getJSON<{ clearlyIn?: { messageId: number }[] }>(`${base}/baseline/presets?intentId=${mode.intentId}`)
        .then((d) => setResults((d.clearlyIn ?? []).map((x) => x.messageId)))
        .catch(() => setResults([]));
    } else if (mode.kind === 'saved') {
      void run(); // cached probe → fast
    }
    // 'new' → results stay null until the user runs.
    // eslint-disable-line react-hooks/exhaustive-deps
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function run() {
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
        }>(`${base}/probe`, { description: definition });
        setResults((data.clearlyIn ?? []).map((x) => x.messageId));
        setProgress({ rated: data.rated, total: data.total });
        if (data.remaining === 0 || data.ratedThisBatch === 0) break;
      }
    } catch (e) {
      setNote(`Search failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setRunning(false);
    }
  }

  async function save() {
    setNote(null);
    try {
      await postJSON(`${base}/baseline/searches`, { description: definition });
      setSaved(true);
      setNote('Saved');
    } catch (e) {
      setNote(`Save failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  const pct = progress && progress.total > 0 ? Math.round((progress.rated / progress.total) * 100) : 0;
  const convoRow = convoId != null ? rowById.get(convoId) : null;

  return (
    <div className="flex flex-col gap-3 flex-1 min-h-0">
      <WorkbenchTopBar
        title={mode.kind === 'preset' ? `Search — ${mode.title}` : 'Custom search'}
        note={mode.kind === 'preset' ? 'Preset — edit the description to make it your own' : undefined}
        onBack={onExit}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[380px_minmax(0,1fr)] gap-4 flex-1 min-h-0">
        {/* LEFT — the search definition + actions */}
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-y-auto">
          <div className="p-4 space-y-3">
            <DefinitionEditor
              value={definition}
              onChange={(v) => { setDefinition(v); setSaved(false); }}
              label="When a student…"
              placeholder="e.g. asks the chatbot to write the essay for them"
            />
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={run} disabled={running || !definition.trim()}>
                {running ? `Searching… ${pct}%` : 'Search'}
              </Button>
              <Button size="sm" variant="outline" onClick={save} disabled={running || !definition.trim() || (saved && !dirty)}>
                {saved && !dirty ? 'Saved' : 'Save search'}
              </Button>
              {note && <span className="text-sm text-[hsl(var(--muted-foreground))]">{note}</span>}
            </div>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              Finds every logged student question that matches this description. Read them to decide what to write
              in your rules.
            </p>
          </div>
        </div>

        {/* MIDDLE — matches (or the conversation when a match is opened) */}
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] flex flex-col overflow-hidden">
          {convoRow ? (
            <>
              <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-[hsl(var(--border))]">
                <Button size="sm" variant="ghost" onClick={() => setConvoId(null)}>← Matches</Button>
                <span className="text-sm text-[hsl(var(--muted-foreground))]">{convoRow.participantToken}</span>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto">
                <ConversationThread rows={rows} current={convoRow} isNirvana={isNirvana} />
              </div>
            </>
          ) : (
            <>
              <div className="shrink-0 px-3 py-2 border-b border-[hsl(var(--border))] text-sm font-semibold text-[hsl(var(--foreground))]">
                Matches{results ? ` · ${results.length}` : ''}
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto">
                {results === null ? (
                  <p className="px-3 py-4 text-sm text-[hsl(var(--muted-foreground))]">
                    Run the search to list matching student questions.
                  </p>
                ) : results.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-[hsl(var(--muted-foreground))]">No matching questions.</p>
                ) : (
                  <ul className="divide-y divide-[hsl(var(--border))]/60">
                    {results.map((mid) => {
                      const r = rowById.get(mid);
                      if (!r) return null;
                      return (
                        <li key={mid} className="px-3 py-2 hover:bg-[hsl(var(--muted))]/40">
                          <QueryTextButton
                            queryText={r.queryText}
                            dissection={null}
                            expanded={expanded.has(mid)}
                            onToggleExpand={() =>
                              setExpanded((prev) => {
                                const next = new Set(prev);
                                if (next.has(mid)) next.delete(mid);
                                else next.add(mid);
                                return next;
                              })
                            }
                            onOpen={() => setConvoId(mid)}
                          />
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
