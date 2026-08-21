'use client';

/**
 * The one control that moves the session on.
 *
 * Two of the hand-offs spend half a minute generating answers behind this
 * click, so the wait takes over the screen rather than sitting in a button.
 * That is not only for feedback: generation pins the configuration once, up
 * front, and a participant who kept editing and redeployed while it ran would
 * be measured against a version the frozen answers do not come from. Blocking
 * the page for those seconds is what makes the pin true.
 *
 * `confirm` is for placements where the click is cheap to make by accident —
 * the studio header, inches from Deploy. Ending a block cannot be undone from
 * the participant's side: the phase gate shuts the board behind them.
 *
 * `blocked` is for a different thing: not "are you sure" but "not yet, and
 * here is the one button that fixes it". The server refuses the same case
 * independently — this exists so the refusal arrives before the click instead
 * of after it, with the fix attached. Its action is a URL rather than a
 * callback because the pages that render this are server components.
 *
 * Always lands back on /study/session and lets the server decide what comes
 * next — the destination differs per phase, and duplicating that rule here is
 * how the two would drift apart.
 */

import { useState } from 'react';
import { Loader2 } from 'lucide-react';

export default function PhaseAdvance({
  from,
  label,
  waits = false,
  waitLabel = 'Getting the next step ready.',
  confirm,
  blocked = null,
  compact = false,
  className = '',
}: {
  /** The phase this page was rendered for. */
  from: string;
  label: string;
  /** Whether leaving this phase runs a generation batch. */
  waits?: boolean;
  waitLabel?: string;
  /** Ask before acting, with this as the question. */
  confirm?: string;
  /**
   * Something has to happen first. Shows `reason` instead of the confirmation,
   * with a button that POSTs `actionUrl` and then moves on — so the fix and
   * the hand-off are one click, not a trip back to find the right control.
   */
  blocked?: { reason: string; actionLabel: string; actionUrl: string } | null;
  /** Header sizing: small button, messages in a popover rather than in flow. */
  compact?: boolean;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Do the blocking thing, then carry on into the hand-off. */
  const resolveThenGo = async () => {
    if (!blocked) return go();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(blocked.actionUrl, { method: 'POST' });
      if (!res.ok) {
        setError('That did not go through — tell your facilitator.');
        setBusy(false);
        setAsking(false);
        return;
      }
    } catch {
      setError('That did not go through — tell your facilitator.');
      setBusy(false);
      setAsking(false);
      return;
    }
    await go();
  };

  const go = async () => {
    setAsking(false);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/study/session/advance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok && data.error !== 'phase_moved') {
        setError(data.message ?? 'Could not move on — tell your facilitator.');
        setBusy(false);
        return;
      }
      // Stay busy through the navigation: re-enabling the button for the beat
      // before the new page paints just invites a second click.
      window.location.assign('/study/session');
    } catch {
      setError('Could not move on — tell your facilitator.');
      setBusy(false);
    }
  };

  const message = error && (
    <p
      className={
        compact
          ? 'absolute top-full right-0 mt-2 z-30 w-72 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 shadow-lg'
          : 'mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800'
      }
    >
      {error}
    </p>
  );

  return (
    <div className={`relative ${compact ? 'inline-flex items-center' : 'flex flex-col'} ${className}`}>
      <button
        onClick={confirm || blocked ? () => setAsking((v) => !v) : go}
        disabled={busy}
        className={
          compact
            ? 'inline-flex items-center gap-1.5 rounded bg-[hsl(var(--primary))] px-3 py-2 text-sm font-semibold text-white disabled:opacity-60'
            : 'inline-flex items-center justify-center gap-2 rounded-lg bg-[hsl(var(--primary))] px-6 py-3 text-base font-semibold text-white disabled:opacity-60'
        }
      >
        {busy && <Loader2 className={compact ? 'w-3.5 h-3.5 animate-spin' : 'w-4 h-4 animate-spin'} />}
        {busy ? 'Working…' : label}
      </button>

      {asking && (confirm || blocked) && !busy && (
        <div
          className={`absolute top-full z-30 mt-2 w-72 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 shadow-lg ${
            compact ? 'right-0' : 'left-1/2 -translate-x-1/2'
          }`}
        >
          <p className="text-sm text-[hsl(var(--foreground))] leading-relaxed mb-3 text-left">
            {blocked ? blocked.reason : confirm}
          </p>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setAsking(false)}
              className="rounded border border-[hsl(var(--border))] px-3 py-1.5 text-xs font-semibold hover:bg-[hsl(var(--muted))]"
            >
              Not yet
            </button>
            <button
              onClick={blocked ? resolveThenGo : go}
              className="rounded bg-[hsl(var(--primary))] px-3 py-1.5 text-xs font-semibold text-white"
            >
              {blocked ? blocked.actionLabel : "Yes, I'm done"}
            </button>
          </div>
        </div>
      )}

      {message}

      {busy && waits && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[hsl(var(--background))]">
          <div className="max-w-sm px-6 text-center">
            <Loader2 className="mx-auto mb-4 h-6 w-6 animate-spin text-[hsl(var(--primary))]" />
            <p className="text-base font-semibold mb-1">Getting the next step ready</p>
            <p className="text-sm text-[hsl(var(--muted-foreground))] leading-relaxed">
              {waitLabel} This takes a moment — please leave this page open.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
