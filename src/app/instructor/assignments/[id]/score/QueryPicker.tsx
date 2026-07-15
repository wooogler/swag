'use client';

/**
 * Multi-select picker over the student query log — add logged questions to the
 * Revise "review set" (example tabs). Reuses the dashboard's query list: the same
 * sort dropdown (Newest / Oldest / PID) + keyword search + participant · turn ·
 * date rows with the material-aware snippet. Spec §4.3.
 */
import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ScoreQueryRow } from './IntentBoard';
import { QuerySnippet } from './materials';
import { SortSelect, sortQueryRows, type QuerySortMode } from './query-list';

interface QueryPickerProps {
  log: ScoreQueryRow[];
  excludeIds?: Set<number>;
  onAdd: (messageIds: number[]) => void;
  onClose: () => void;
}

export default function QueryPicker({ log, excludeIds, onAdd, onClose }: QueryPickerProps) {
  const [q, setQ] = useState('');
  const [sortMode, setSortMode] = useState<QuerySortMode>('recent');
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = log.filter(
      (r) => !excludeIds?.has(r.messageId) && (!needle || r.queryText.toLowerCase().includes(needle))
    );
    return sortQueryRows(filtered, sortMode);
  }, [log, q, excludeIds, sortMode]);

  function toggle(id: number) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl h-[80vh] flex flex-col rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 flex items-center justify-between gap-2 px-5 py-3 border-b border-[hsl(var(--border))]">
          <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">Add examples from the log</h3>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Toolbar — same search + sort as the dashboard query list. */}
        <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-[hsl(var(--border))]">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[hsl(var(--muted-foreground))]" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search query text…" className="pl-7" autoFocus />
          </div>
          <SortSelect value={sortMode} onChange={setSortMode} />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {rows.length === 0 ? (
            <p className="px-4 py-6 text-sm text-[hsl(var(--muted-foreground))]">No matching questions.</p>
          ) : (
            <ul className="divide-y divide-[hsl(var(--border))]">
              {rows.map((r) => {
                const on = selected.has(r.messageId);
                return (
                  <li key={r.messageId}>
                    <label
                      className={`flex items-start gap-2 px-4 py-2.5 cursor-pointer ${
                        on ? 'bg-[hsl(var(--muted))]' : 'hover:bg-[hsl(var(--muted))]/40'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="mt-1 shrink-0"
                        checked={on}
                        onChange={() => toggle(r.messageId)}
                      />
                      <span className="min-w-0 flex-1">
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
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="shrink-0 flex items-center justify-between px-5 py-3 border-t border-[hsl(var(--border))]">
          <span className="text-xs text-[hsl(var(--muted-foreground))]">{selected.size} selected</span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => { onAdd([...selected]); onClose(); }} disabled={selected.size === 0}>
              Add
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
