'use client';

/**
 * The blind comparison: one question, two answers, no labels.
 *
 * The two panels are deliberately identical in every respect a participant
 * could read a hint from — same width, same order of controls, no A/B letters
 * or colour coding, nothing that could pair with "the researchers' one". The
 * only asymmetry is which answer sits on which side, and that is randomised per
 * participant per item.
 */

import { useState } from 'react';
import { Loader2 } from 'lucide-react';

export interface BlindAbItem {
  bankItemId: number;
  context: { role: 'user' | 'assistant'; content: string }[];
  question: string;
  leftResponse: string;
  rightResponse: string;
  choice: 'left' | 'right' | 'both' | 'neither' | null;
}

export default function BlindAb({ items }: { items: BlindAbItem[] }) {
  const firstUnanswered = items.findIndex((i) => i.choice === null);
  const [index, setIndex] = useState(firstUnanswered === -1 ? items.length - 1 : firstUnanswered);
  const [state, setState] = useState(items);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const item = state[index];
  const done = state.filter((i) => i.choice !== null).length;
  const finished = done === state.length;

  const choose = async (choice: BlindAbItem['choice']) => {
    if (!choice) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/study/session/ab', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bankItemId: item.bankItemId, choice }),
      });
      if (!res.ok) {
        setError('Could not save that — tell your facilitator.');
        return;
      }
      setState((prev) =>
        prev.map((i) => (i.bankItemId === item.bankItemId ? { ...i, choice } : i))
      );
      if (index < state.length - 1) setIndex(index + 1);
    } finally {
      setBusy(false);
    }
  };

  if (finished) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="max-w-md text-center">
          <h1 className="text-lg font-semibold mb-2">That is everything — thank you</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Your facilitator will pick up from here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[hsl(var(--background))]">
      <header className="shrink-0 border-b border-[hsl(var(--border))] bg-[hsl(var(--card))]">
        <div className="max-w-[1400px] mx-auto px-6 py-3 flex items-center gap-4">
          <h1 className="text-sm font-semibold">Which answer would you want?</h1>
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

      <main className="flex-1 max-w-[1400px] w-full mx-auto px-6 py-5 space-y-4">
        {item.context.length > 0 && (
          <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 space-y-2">
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
            The student asks
          </p>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{item.question}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <AnswerPanel text={item.leftResponse} onPick={() => choose('left')} busy={busy} />
          <AnswerPanel text={item.rightResponse} onPick={() => choose('right')} busy={busy} />
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => choose('both')}
            disabled={busy}
            className="flex-1 rounded-lg border border-[hsl(var(--border))] py-2.5 text-sm font-semibold hover:bg-[hsl(var(--muted))] disabled:opacity-50"
          >
            Both are fine
          </button>
          <button
            onClick={() => choose('neither')}
            disabled={busy}
            className="flex-1 rounded-lg border border-[hsl(var(--border))] py-2.5 text-sm font-semibold hover:bg-[hsl(var(--muted))] disabled:opacity-50"
          >
            Neither is what I want
          </button>
        </div>

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
      </main>
    </div>
  );
}

function AnswerPanel({
  text,
  onPick,
  busy,
}: {
  text: string;
  onPick: () => void;
  busy: boolean;
}) {
  return (
    <div className="flex flex-col rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-hidden">
      <div className="flex-1 p-4">
        <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{text}</p>
      </div>
      <button
        onClick={onPick}
        disabled={busy}
        className="border-t border-[hsl(var(--border))] py-2.5 text-sm font-semibold text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/5 disabled:opacity-50"
      >
        I want this one
      </button>
    </div>
  );
}
