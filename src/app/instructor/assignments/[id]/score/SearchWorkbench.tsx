'use client';

/**
 * Baseline "search workbench" — a title-LESS stripped IntentWorkbench: type a
 * description, run the judge over the log, see only the clearly_in matches. The
 * ablation is exactly this — no rule, no grades, no pins, no coverage. Preset
 * results preload instantly; custom searches batch-rate with a progress bar.
 * See docs/STUDY_BASELINE_SPEC.md §B-2.
 */
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface ClearlyInRow {
  messageId: number;
  queryText: string;
}

interface SearchWorkbenchProps {
  assignmentId: string;
  initialDescription: string;
  /** Preset results preloaded (instant, no rating). Absent for new/custom. */
  initialResults?: ClearlyInRow[];
  savedSearchId?: string; // present when opened from a saved search
  onClose: () => void;
  onSavedChange: () => void; // parent refreshes its saved-search list
}

export default function SearchWorkbench({
  assignmentId,
  initialDescription,
  initialResults,
  savedSearchId,
  onClose,
  onSavedChange,
}: SearchWorkbenchProps) {
  const [description, setDescription] = useState(initialDescription);
  const [results, setResults] = useState<ClearlyInRow[] | null>(initialResults ?? null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ rated: number; total: number } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [saved, setSaved] = useState(!!savedSearchId);
  const cancelled = useRef(false);
  const base = `/api/instructor/assignments/${assignmentId}/score`;

  useEffect(() => () => { cancelled.current = true; }, []);

  // Editing the description invalidates preset/prior results.
  const dirtyFromInitial = description !== initialDescription;

  async function run() {
    setRunning(true);
    setNote(null);
    setResults(null);
    try {
      // Loop the call-bounded batch until the whole log is rated (or a stall).
      for (let guard = 0; guard < 100; guard++) {
        if (cancelled.current) return;
        const res = await fetch(`${base}/probe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description }),
        });
        if (!res.ok) throw new Error((await res.json()).error || 'probe_failed');
        const data = await res.json();
        setResults(data.clearlyIn);
        setProgress({ rated: data.rated, total: data.total });
        if (data.remaining === 0 || data.ratedThisBatch === 0) break;
      }
    } catch (e) {
      setNote(`검색 실패: ${e instanceof Error ? e.message : e}`);
    } finally {
      setRunning(false);
    }
  }

  async function save() {
    setNote(null);
    try {
      const res = await fetch(`${base}/baseline/searches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'save_failed');
      setSaved(true);
      onSavedChange();
      setNote('저장됨');
    } catch (e) {
      setNote(`저장 실패: ${e instanceof Error ? e.message : e}`);
    }
  }

  const pct = progress && progress.total > 0 ? Math.round((progress.rated / progress.total) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-3xl max-h-[85vh] flex flex-col rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-[hsl(var(--border))]">
          <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">Search the student log</h3>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="px-5 py-4 space-y-3 border-b border-[hsl(var(--border))]">
          <label className="text-xs font-medium text-[hsl(var(--muted-foreground))]">
            Describe the kind of student question to find
          </label>
          <textarea
            className="w-full h-24 resize-none rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm text-[hsl(var(--foreground))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--ring))]"
            value={description}
            onChange={(e) => { setDescription(e.target.value); setSaved(false); }}
            placeholder="예: 학생이 챗봇에게 에세이를 대신 써달라고 요청함"
          />
          <div className="flex items-center gap-2">
            <Button onClick={run} disabled={running || !description.trim()}>
              {running ? `검색 중… ${pct}%` : '검색 실행'}
            </Button>
            <Button variant="outline" onClick={save} disabled={running || !description.trim() || (saved && !dirtyFromInitial)}>
              {saved && !dirtyFromInitial ? '저장됨' : '검색 저장'}
            </Button>
            {note && <span className="text-xs text-[hsl(var(--muted-foreground))]">{note}</span>}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-3">
          {results === null ? (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">검색을 실행하면 매칭되는 학생 질문이 여기 표시됩니다.</p>
          ) : (
            <>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mb-2">{results.length} matching questions</p>
              <ul className="space-y-1">
                {results.map((r) => (
                  <li key={r.messageId} className="px-2 py-1.5 rounded text-sm text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]/40">
                    {r.queryText}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
