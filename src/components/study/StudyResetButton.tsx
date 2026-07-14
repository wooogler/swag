'use client';

import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface StudyResetButtonProps {
  /** 'dataset' resets only the given dataset's board; 'all' resets every dataset. */
  scope: 'dataset' | 'all';
  datasetKey?: string;
  datasetLabel?: string;
}

/**
 * Header control shown only to study participants. Resets their workspace back
 * to the fresh starter set (discarding their SCORE work) via /api/study/reset,
 * then navigates to the new board / dashboard the API returns.
 */
export default function StudyResetButton({ scope, datasetKey }: StudyResetButtonProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buttonLabel = scope === 'dataset' ? 'Reset' : 'Reset all';
  const title = scope === 'dataset' ? 'Reset this assignment?' : 'Reset all assignments?';
  const body =
    scope === 'dataset'
      ? 'This discards your SCORE work on this assignment and restarts it from the fresh starter set.'
      : 'This discards your SCORE work on every assignment and restarts them from the fresh starter set.';

  async function doReset() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/study/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(scope === 'dataset' ? { datasetKey } : {}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Reset failed');
      // Fresh clones have new assignment ids — navigate to the returned target.
      window.location.assign(data.redirect as string);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reset failed');
      setLoading(false);
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="gap-1.5 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
        data-tooltip-id="header-tooltip"
        data-tooltip-content="Restart from the starter set"
      >
        <RotateCcw className="w-4 h-4" />
        <span className="hidden sm:inline">{buttonLabel}</span>
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !loading && setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-[hsl(var(--foreground))]">{title}</h3>
            <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
              {body} This cannot be undone.
            </p>
            {error && (
              <div className="mt-3 p-2 rounded-md text-sm bg-destructive/10 text-destructive">{error}</div>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={loading}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={doReset} disabled={loading}>
                {loading ? 'Resetting…' : 'Reset'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
