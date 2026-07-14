'use client';

/**
 * Multi-select picker over the student query log — add logged questions to the
 * baseline revise "review set" by hand. Keyword filter only (semantic search
 * lives in the search panel). Spec §4.3.
 */
import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export interface PickerRow {
  messageId: number;
  queryText: string;
  participantToken?: string;
}

interface QueryPickerProps {
  log: PickerRow[];
  excludeIds?: Set<number>;
  onAdd: (messageIds: number[]) => void;
  onClose: () => void;
}

export default function QueryPicker({ log, excludeIds, onAdd, onClose }: QueryPickerProps) {
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return log.filter(
      (r) => !excludeIds?.has(r.messageId) && (!needle || r.queryText.toLowerCase().includes(needle))
    );
  }, [log, q, excludeIds]);

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
        className="w-full max-w-xl h-[75vh] flex flex-col rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-[hsl(var(--border))]">
          <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">Add questions to the review set</h3>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>
        <div className="px-4 py-2 border-b border-[hsl(var(--border))]">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search questions (keyword)" autoFocus />
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-2">
          <ul className="space-y-0.5">
            {filtered.map((r) => (
              <li key={r.messageId}>
                <label className="flex items-start gap-2 px-2 py-1.5 rounded text-sm hover:bg-[hsl(var(--muted))]/40 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={selected.has(r.messageId)}
                    onChange={() => toggle(r.messageId)}
                  />
                  <span className="flex-1 text-[hsl(var(--foreground))] line-clamp-2">{r.queryText}</span>
                </label>
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="px-2 py-4 text-sm text-[hsl(var(--muted-foreground))]">No matching questions.</li>
            )}
          </ul>
        </div>
        <div className="px-5 py-3 border-t border-[hsl(var(--border))] flex justify-between items-center">
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
