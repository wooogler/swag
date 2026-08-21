'use client';

/**
 * The per-block workload questionnaire — five TLX subscales on one page.
 *
 * One page rather than one-at-a-time: this is a minute of the session, and
 * paging five questions would spend it on clicks. Nothing here names the two
 * conditions; a participant is answering about "setting up the chatbot", the
 * same phrasing in either block.
 *
 * THE ANCHOR LABELS ARE NOT DECORATION. Performance runs Perfect → Failure
 * while the other four run Very low → Very high, which is what leaves all five
 * pointing the same way and spares the analysis a reverse-scored item. A
 * participant who cannot see the ends of that scale has no way to know it
 * turned around, so the labels sit under every row and the facilitator says
 * "note the labels" on the way in (design §6.1).
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
        <h1 className="text-xl font-semibold mb-1">A few quick questions</h1>
        {/* Design §6.4, which does the job the bare TLX stem cannot: it names
            the task and fixes its boundaries. "The task" has no referent in
            this session — a participant asked how demanding "the task" was
            would pick their own, and five people would rate five different
            things on the same scale. */}
        <p className="text-base text-[hsl(var(--muted-foreground))] mb-8 leading-relaxed">
          Before we check it — five quick questions about{' '}
          <span className="font-semibold text-[hsl(var(--foreground))]">
            setting up the chatbot
          </span>{' '}
          in the round you just finished: from when you started looking through the student
          conversations to when you deployed.
        </p>

        <div className="space-y-5">
          {items.map((item, index) => (
            <div
              key={item.key}
              className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5"
            >
              {item.label && (
                <p className="text-2xs font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))] mb-1.5">
                  {item.label}
                </p>
              )}
              <p className={`text-base leading-relaxed ${item.note ? 'mb-1.5' : 'mb-4'}`}>
                <span className="text-[hsl(var(--muted-foreground))] mr-2">{index + 1}.</span>
                {item.text}
              </p>
              {/* Above the buttons, not below them: it is a condition on how to
                  answer, and one read after answering is one read too late. */}
              {item.note && (
                <p className="mb-4 text-sm leading-snug text-[hsl(var(--muted-foreground))]">
                  {item.note}
                </p>
              )}
              <div className="flex gap-1.5">
                {scale.map((n) => (
                  <button
                    key={n}
                    onClick={() => setAnswers((prev) => ({ ...prev, [item.key]: n }))}
                    className={`flex-1 rounded-lg border py-3 text-base font-semibold ${
                      answers[item.key] === n
                        ? 'bg-[hsl(var(--primary))] border-[hsl(var(--primary))] text-white'
                        : 'border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <div className="flex justify-between mt-2 text-xs text-[hsl(var(--muted-foreground))]">
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
            className={`rounded-lg px-6 py-3 text-base font-semibold disabled:opacity-40 ${
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
              // True now in a way it was not before: this hand-off is where the
              // frozen answers are awaited, and the minute just spent here is
              // the minute the batch had to run in.
              waitLabel="Getting the check questions ready — your chatbot is answering them now."
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
