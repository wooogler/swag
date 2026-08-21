'use client';

/**
 * [Start] on the task screen: stamp the clock, then open the board.
 *
 * The stamp is awaited rather than fired off, because it is the zero the
 * participant's own readout and the facilitator's chip are both measured from
 * — a request still in flight while the board paints would leave the two
 * disagreeing for as long as it took.
 *
 * A failed stamp still opens the board. The alternative is stranding someone
 * in front of a dead button at the top of a 25-minute block over an
 * instrumentation write; the clock falls back to the phase advance, which is
 * the old behaviour and off by the seconds spent reading this screen.
 */
import { useState } from 'react';
import { Loader2 } from 'lucide-react';

export default function WorkStart({ href, label = 'Start' }: { href: string; label?: string }) {
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setBusy(true);
    try {
      await fetch('/api/study/session/work-start', { method: 'POST' });
    } catch {
      /* the board matters more than the timestamp */
    }
    window.location.assign(href);
  };

  return (
    <button
      onClick={() => void go()}
      disabled={busy}
      className="inline-flex items-center justify-center gap-2 rounded-lg bg-[hsl(var(--primary))] px-7 py-3 text-base font-semibold text-white disabled:opacity-60"
    >
      {busy && <Loader2 className="w-4 h-4 animate-spin" />}
      {label}
    </button>
  );
}
