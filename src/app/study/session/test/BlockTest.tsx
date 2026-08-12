'use client';

/**
 * One question at a time: predict → reveal → rate.
 *
 * The configuration stays open on the left the whole time. That is deliberate:
 * this measures whether an instructor can READ their own setup and foresee what
 * it does, not whether they memorised it, so hiding it would measure recall
 * instead.
 */

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import PhaseAdvance from '@/components/study/PhaseAdvance';
import SnapshotConfigView, { type SnapshotConfig } from '@/components/study/SnapshotConfigView';
import type { TestItem } from '@/lib/study/measure-store';

export default function BlockTest({
  config,
  items,
  phase,
}: {
  config: SnapshotConfig;
  items: TestItem[];
  phase: string;
}) {
  const firstUnfinished = Math.max(
    0,
    items.findIndex((i) => i.rating === null)
  );
  const [index, setIndex] = useState(firstUnfinished === -1 ? items.length - 1 : firstUnfinished);
  const [state, setState] = useState(items);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const item = state[index];
  const done = state.filter((i) => i.rating !== null).length;
  const finished = done === state.length;

  const submitGuess = async (guess: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/study/session/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'guess', bankItemId: item.bankItemId, guess }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError('Could not save that — tell your facilitator.');
        return;
      }
      setState((prev) =>
        prev.map((i) =>
          i.bankItemId === item.bankItemId ? { ...i, guess, response: data.response } : i
        )
      );
    } finally {
      setBusy(false);
    }
  };

  const submitRating = async (rating: number) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/study/session/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rating', bankItemId: item.bankItemId, rating }),
      });
      if (!res.ok) {
        setError('Could not save that — tell your facilitator.');
        return;
      }
      setState((prev) =>
        prev.map((i) => (i.bankItemId === item.bankItemId ? { ...i, rating } : i))
      );
      if (index < state.length - 1) setIndex(index + 1);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-[hsl(var(--background))]">
      <header className="shrink-0 border-b border-[hsl(var(--border))] bg-[hsl(var(--card))]">
        <div className="max-w-[1400px] mx-auto px-6 py-3 flex items-center gap-4">
          <h1 className="text-sm font-semibold">Check your chatbot</h1>
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <div className="w-32 h-1.5 rounded bg-[hsl(var(--muted))] overflow-hidden">
              <div
                className="h-full bg-[hsl(var(--primary))] transition-all"
                style={{ width: `${(done / state.length) * 100}%` }}
              />
            </div>
            <span className="text-[11px] tabular-nums text-[hsl(var(--muted-foreground))]">
              {done} / {state.length}
            </span>
          </div>
        </div>
      </header>

      <main className="flex-1 min-h-0 max-w-[1400px] w-full mx-auto px-6 py-4 grid grid-cols-1 lg:grid-cols-[minmax(300px,420px)_minmax(0,1fr)] gap-5">
        <aside className="border border-[hsl(var(--border))] rounded-xl bg-[hsl(var(--card))] overflow-hidden min-h-0">
          <SnapshotConfigView config={config} />
        </aside>

        <section className="min-h-0 overflow-y-auto">
          {finished ? (
            <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-8 text-center">
              <h2 className="text-lg font-semibold mb-2">All done</h2>
              <p className="text-sm text-[hsl(var(--muted-foreground))] mb-6">
                That is all the questions for this chatbot.
              </p>
              <div className="flex flex-col items-center">
                <PhaseAdvance from={phase} label="Continue" />
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                  Question {index + 1} of {state.length}
                </span>
              </div>

              {item.context.length > 0 && (
                <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 space-y-3">
                  <p className="text-[10.5px] font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                    Earlier in this conversation
                  </p>
                  {item.context.map((turn, i) => (
                    <div key={i} className="text-[12.5px] leading-relaxed">
                      <span className="font-semibold text-[hsl(var(--muted-foreground))]">
                        {turn.role === 'user' ? 'Student: ' : 'Chatbot: '}
                      </span>
                      <span className="whitespace-pre-wrap">{turn.content}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="rounded-xl border-2 border-[hsl(var(--primary))]/30 bg-[hsl(var(--card))] p-4">
                <p className="text-[10.5px] font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))] mb-2">
                  The student now asks
                </p>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{item.question}</p>
              </div>

              {item.guess === null ? (
                <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5">
                  <p className="text-sm font-semibold mb-1">
                    Will your chatbot answer this the way you intend?
                  </p>
                  <p className="text-xs text-[hsl(var(--muted-foreground))] mb-4">
                    Your setup is on the left — take as long as you like. You will see the
                    actual answer next.
                  </p>
                  <div className="flex gap-3">
                    <button
                      onClick={() => submitGuess(true)}
                      disabled={busy}
                      className="flex-1 rounded-lg border border-[hsl(var(--border))] py-3 text-sm font-semibold hover:bg-[hsl(var(--muted))] disabled:opacity-50"
                    >
                      Yes, it will
                    </button>
                    <button
                      onClick={() => submitGuess(false)}
                      disabled={busy}
                      className="flex-1 rounded-lg border border-[hsl(var(--border))] py-3 text-sm font-semibold hover:bg-[hsl(var(--muted))] disabled:opacity-50"
                    >
                      No, it will not
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
                    <p className="text-[10.5px] font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))] mb-2">
                      Your chatbot answered
                    </p>
                    <p className="text-[13px] leading-relaxed whitespace-pre-wrap">
                      {item.response}
                    </p>
                  </div>

                  <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5">
                    <p className="text-sm font-semibold mb-3">
                      How well does this match what you intended?
                    </p>
                    <div className="flex gap-2">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          onClick={() => submitRating(n)}
                          disabled={busy}
                          className={`flex-1 rounded-lg border py-3 text-sm font-semibold disabled:opacity-50 ${
                            item.rating === n
                              ? 'bg-[hsl(var(--primary))] border-[hsl(var(--primary))] text-white'
                              : 'border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]'
                          }`}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                    <div className="flex justify-between mt-2 text-[10.5px] text-[hsl(var(--muted-foreground))]">
                      <span>Not at all</span>
                      <span>Exactly</span>
                    </div>
                  </div>
                </>
              )}

              {busy && (
                <p className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
                  <Loader2 className="w-3 h-3 animate-spin" /> Saving…
                </p>
              )}
              {error && (
                <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                  {error}
                </p>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
