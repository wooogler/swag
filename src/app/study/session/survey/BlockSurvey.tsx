'use client';

/**
 * The per-block questionnaire — every item on one page.
 *
 * One page rather than one-at-a-time: these are short reflective scales, and
 * paging them would add clicks to a session already budgeted to the minute.
 * Nothing here names the two conditions; a participant is answering about "the
 * chatbot you just set up", the same phrasing in either block.
 */

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { SurveyItem } from '@/lib/study/survey-items';

export default function BlockSurvey({
  items,
  min,
  max,
  initial,
}: {
  items: SurveyItem[];
  min: number;
  max: number;
  initial: Record<string, number>;
}) {
  const [answers, setAnswers] = useState<Record<string, number>>(initial);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(Object.keys(initial).length > 0);
  const [error, setError] = useState<string | null>(null);

  const remaining = items.filter((i) => answers[i.key] === undefined).length;
  const scale = Array.from({ length: max - min + 1 }, (_, i) => min + i);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/study/session/survey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers }),
      });
      if (!res.ok) {
        setError('Could not save that — tell your facilitator.');
        return;
      }
      setSaved(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[hsl(var(--background))] py-10 px-6">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-lg font-semibold mb-1">A few questions about that setup</h1>
        <p className="text-sm text-[hsl(var(--muted-foreground))] mb-8">
          There are no right answers — we are asking about your experience just now.
        </p>

        <div className="space-y-5">
          {items.map((item, index) => (
            <div
              key={item.key}
              className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5"
            >
              <p className="text-sm mb-4">
                <span className="text-[hsl(var(--muted-foreground))] mr-2">{index + 1}.</span>
                {item.text}
              </p>
              <div className="flex gap-1.5">
                {scale.map((n) => (
                  <button
                    key={n}
                    onClick={() => setAnswers((prev) => ({ ...prev, [item.key]: n }))}
                    className={`flex-1 rounded-lg border py-2.5 text-sm font-semibold ${
                      answers[item.key] === n
                        ? 'bg-[hsl(var(--primary))] border-[hsl(var(--primary))] text-white'
                        : 'border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <div className="flex justify-between mt-2 text-[10.5px] text-[hsl(var(--muted-foreground))]">
                <span>{item.low}</span>
                <span>{item.high}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 flex items-center gap-3">
          <button
            onClick={submit}
            disabled={busy || remaining > 0}
            className="rounded-lg bg-[hsl(var(--primary))] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
          >
            {busy ? 'Saving…' : saved ? 'Save again' : 'Done'}
          </button>
          {remaining > 0 && (
            <span className="text-xs text-[hsl(var(--muted-foreground))]">
              {remaining} left
            </span>
          )}
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin text-[hsl(var(--muted-foreground))]" />}
          {saved && remaining === 0 && !busy && (
            <span className="text-xs text-emerald-700 font-semibold">
              Saved — your facilitator will move on.
            </span>
          )}
        </div>
        {error && (
          <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
