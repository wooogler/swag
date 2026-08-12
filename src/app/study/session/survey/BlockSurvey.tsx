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
import PhaseAdvance from '@/components/study/PhaseAdvance';
import type { SurveyItem } from '@/lib/study/survey-items';

export default function BlockSurvey({
  items,
  min,
  max,
  initial,
  phase,
}: {
  items: SurveyItem[];
  min: number;
  max: number;
  initial: Record<string, number>;
  phase: string;
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
        <h1 className="text-lg font-semibold mb-1">A few questions</h1>
        {/* The questionnaire's own instruction (문항지 §4), which names WHICH
            version is being rated — the participant uses two today. */}
        <p className="text-sm text-[hsl(var(--muted-foreground))] mb-8">
          Thinking about the version you just used, please rate your agreement with each
          statement.
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

        {/* Saving and moving on stay separate clicks: moving on is what starts
            the next block, and an answer changed after a mis-click should not
            need the session unwound to fix. */}
        <div className="mt-8 flex items-center gap-3">
          <button
            onClick={submit}
            disabled={busy || remaining > 0}
            className={`rounded-lg px-5 py-2.5 text-sm font-semibold disabled:opacity-40 ${
              saved
                ? 'border border-[hsl(var(--border))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]'
                : 'bg-[hsl(var(--primary))] text-white'
            }`}
          >
            {busy ? 'Saving…' : saved ? 'Save again' : 'Save answers'}
          </button>
          {remaining > 0 && (
            <span className="text-xs text-[hsl(var(--muted-foreground))]">
              {remaining} left
            </span>
          )}
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin text-[hsl(var(--muted-foreground))]" />}
          {saved && remaining === 0 && !busy && (
            <span className="text-xs text-emerald-700 font-semibold">Saved</span>
          )}
        </div>

        {saved && remaining === 0 && (
          <div className="mt-6 pt-5 border-t border-[hsl(var(--border))]">
            <PhaseAdvance
              from={phase}
              label="Continue"
              waits
              waitLabel="Getting the last part ready — your chatbot is answering a few more questions."
            />
          </div>
        )}
        {error && (
          <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
