'use client';

/**
 * The end-of-session comparison (design §6.5), four pages and two bookends.
 *
 * SIDE BY SIDE, NOT TWICE. Both versions are rated on the same row at the same
 * moment. Rating them one after the other is what the per-block questionnaire
 * used to do, and the first rating then had nothing to be a rating relative to
 * — this is the arrangement that gives both of them one scale.
 *
 * The left column is whichever version came first for THIS participant. Never
 * pin a condition to a side: whatever advantage the left column enjoys would
 * then land on the same arm every time (§13 invariant 8).
 *
 * PAGES, WITH BACK. Twenty-two ratings, five comparisons and two boxes at the
 * eighty-fifth minute of a session; one scrolling wall of them is how a tired
 * participant starts straight-lining. Each page saves on the way out, so going
 * back shows what they actually said rather than an empty grid.
 *
 * The board links in the column headers are this app's version of "your two
 * setups are still open — feel free to look". They are the cheapest patch on
 * the weakest joint in the design, which is that this asks someone to rate
 * something they last touched forty minutes ago.
 */

import { useMemo, useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import PhaseAdvance from '@/components/study/PhaseAdvance';
import {
  AGREE_HIGH,
  AGREE_LOW,
  COMPARE_ITEMS,
  CONTEXT_ITEMS,
  EXPERIENCE_ITEMS,
  FINAL_SCALE_MAX,
  FINAL_SCALE_MIN,
  OPEN_ITEM_KEY,
  type FinalColumn,
  type VersionRatedItem,
} from '@/lib/study/final-survey';
import type { FinalAnswer } from '@/lib/study/final-survey-store';

type Step = 'intro' | 'experience' | 'context' | 'compare' | 'open' | 'done';
const STEPS: Step[] = ['intro', 'experience', 'context', 'compare', 'open', 'done'];

/** Ratings keyed `ITEM:condition` (condition empty for the comparisons). */
type Ratings = Record<string, number>;
type Texts = Record<string, string>;

const ratingKey = (item: string, condition?: string) => `${item}:${condition ?? ''}`;

export default function FinalSurvey({
  columns,
  initial,
  phase,
}: {
  columns: FinalColumn[];
  initial: FinalAnswer[];
  phase: string;
}) {
  const [step, setStep] = useState<Step>('intro');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [ratings, setRatings] = useState<Ratings>(() => {
    const seed: Ratings = {};
    for (const a of initial) {
      if (a.value !== null) seed[ratingKey(a.itemKey, a.condition ?? undefined)] = a.value;
    }
    return seed;
  });
  const [texts, setTexts] = useState<Texts>(() => {
    const seed: Texts = {};
    for (const a of initial) {
      if (a.text) seed[ratingKey(a.itemKey, a.condition ?? undefined)] = a.text;
    }
    return seed;
  });

  const scale = Array.from(
    { length: FINAL_SCALE_MAX - FINAL_SCALE_MIN + 1 },
    (_, i) => FINAL_SCALE_MIN + i
  );

  const setRating = (item: string, condition: string | undefined, value: number) =>
    setRatings((prev) => ({ ...prev, [ratingKey(item, condition)]: value }));

  const missingOn = (s: Step): number => {
    if (s === 'experience' || s === 'context') {
      const items = s === 'experience' ? EXPERIENCE_ITEMS : CONTEXT_ITEMS;
      return items.reduce(
        (n, item) =>
          n + columns.filter((c) => ratings[ratingKey(item.key, c.condition)] === undefined).length,
        0
      );
    }
    if (s === 'compare') {
      return COMPARE_ITEMS.filter((i) => ratings[ratingKey(i.key)] === undefined).length;
    }
    return 0;
  };

  /** What this page would save — collected here so Next is one request. */
  const pageAnswers = (s: Step) => {
    if (s === 'experience' || s === 'context') {
      const items = s === 'experience' ? EXPERIENCE_ITEMS : CONTEXT_ITEMS;
      return items.flatMap((item) =>
        columns
          .map((c) => ({
            itemKey: item.key,
            condition: c.condition,
            value: ratings[ratingKey(item.key, c.condition)],
          }))
          .filter((a) => a.value !== undefined)
      );
    }
    if (s === 'compare') {
      return COMPARE_ITEMS.map((i) => ({ itemKey: i.key, value: ratings[ratingKey(i.key)] })).filter(
        (a) => a.value !== undefined
      );
    }
    if (s === 'open') {
      return columns
        .map((c) => ({
          itemKey: OPEN_ITEM_KEY,
          condition: c.condition,
          text: texts[ratingKey(OPEN_ITEM_KEY, c.condition)] ?? '',
        }))
        .filter((a) => a.text.trim().length > 0);
    }
    return [];
  };

  const go = async (to: Step, save: Step | null) => {
    setError(null);
    if (save) {
      const answers = pageAnswers(save);
      if (answers.length > 0) {
        setBusy(true);
        try {
          const res = await fetch('/api/study/session/final', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ answers }),
          });
          if (!res.ok) {
            setError('Could not save that — tell your facilitator.');
            return;
          }
        } catch {
          setError('Could not save that — tell your facilitator.');
          return;
        } finally {
          setBusy(false);
        }
      }
    }
    setStep(to);
    window.scrollTo({ top: 0 });
  };

  const index = STEPS.indexOf(step);
  const progress = useMemo(() => Math.round((index / (STEPS.length - 1)) * 100), [index]);

  return (
    <div className="min-h-screen bg-[hsl(var(--background))] py-10 px-6">
      <div className="max-w-3xl mx-auto">
        {/* Five minutes is short enough that seeing the end matters more than
            the bar costs. */}
        {step !== 'intro' && (
          <div className="mb-6 h-1 rounded bg-[hsl(var(--muted))] overflow-hidden">
            <div
              className="h-full bg-[hsl(var(--primary))] transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}

        {step === 'intro' && (
          <Card>
            <h1 className="text-lg font-semibold mb-3">Almost done — thank you</h1>
            <p className="text-sm text-[hsl(var(--muted-foreground))] leading-relaxed mb-3">
              You used two versions of the tool today, {columns.map((c) => c.name).join(' and ')}. In
              this last questionnaire we ask you to rate them separately, side by side. There are no
              right answers, and critical ratings are just as useful to us as positive ones.
            </p>
            <p className="text-sm text-[hsl(var(--muted-foreground))] leading-relaxed mb-6">
              Both of your setups are still here — you can open either one from the column headings
              and look around while you answer.
            </p>
            <button onClick={() => void go('experience', null)} className={primaryButton}>
              Start
            </button>
          </Card>
        )}

        {(step === 'experience' || step === 'context') && (
          <Card>
            <h1 className="text-lg font-semibold mb-1">
              {step === 'experience' ? 'Rating the two versions' : 'A few last ratings'}
            </h1>
            <p className="text-sm text-[hsl(var(--muted-foreground))] mb-6">
              {step === 'experience'
                ? `For each statement, please rate ${columns.map((c) => c.name).join(' and ')} separately.`
                : 'A few last ratings, in the same way.'}
            </p>
            <div className="space-y-4">
              {(step === 'experience' ? EXPERIENCE_ITEMS : CONTEXT_ITEMS).map((item, i) => (
                <RatedRow
                  key={item.key}
                  item={item}
                  number={i + 1}
                  columns={columns}
                  scale={scale}
                  ratings={ratings}
                  onRate={setRating}
                />
              ))}
            </div>
            <Nav
              busy={busy}
              missing={missingOn(step)}
              onBack={() => void go(step === 'experience' ? 'intro' : 'experience', null)}
              onNext={() => void go(step === 'experience' ? 'context' : 'compare', step)}
            />
          </Card>
        )}

        {step === 'compare' && (
          <Card>
            <h1 className="text-lg font-semibold mb-1">Comparing them directly</h1>
            <p className="text-sm text-[hsl(var(--muted-foreground))] mb-6">
              Now comparing {columns[0]?.name} and {columns[1]?.name} directly. Which one made it
              easier to…
            </p>
            <div className="space-y-4">
              {COMPARE_ITEMS.map((item, i) => (
                <div
                  key={item.key}
                  className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4"
                >
                  <p className="text-sm mb-3">
                    <span className="text-[hsl(var(--muted-foreground))] mr-2">{i + 1}.</span>…
                    {item.text}
                  </p>
                  <div className="flex gap-1.5">
                    {scale.map((n) => (
                      <button
                        key={n}
                        onClick={() => setRating(item.key, undefined, n)}
                        className={choiceClass(ratings[ratingKey(item.key)] === n)}
                      >
                        {n === 4 ? '=' : n}
                      </button>
                    ))}
                  </div>
                  {/* Repeated on every row rather than once at the top. The
                      only way this item fails is a participant answering it
                      backwards, and a heading they scrolled past is exactly
                      how that happens. */}
                  <div className="flex justify-between mt-2 text-[10.5px] text-[hsl(var(--muted-foreground))]">
                    <span>Much easier with {columns[0]?.name}</span>
                    <span>No difference</span>
                    <span>Much easier with {columns[1]?.name}</span>
                  </div>
                </div>
              ))}
            </div>
            <Nav
              busy={busy}
              missing={missingOn('compare')}
              onBack={() => void go('context', null)}
              onNext={() => void go('open', 'compare')}
            />
          </Card>
        )}

        {step === 'open' && (
          <Card>
            <h1 className="text-lg font-semibold mb-1">In your own words</h1>
            <p className="text-sm text-[hsl(var(--muted-foreground))] mb-6">
              Two short questions, and then we are done. Neither is required.
            </p>
            <div className="space-y-5">
              {columns.map((c) => (
                <div key={c.condition}>
                  <label
                    className="block text-sm mb-2"
                    htmlFor={`ft-${c.condition}`}
                  >
                    In a sentence or two: for <span className="font-semibold">{c.name}</span>, what
                    helped you most, and what got in your way most?
                  </label>
                  <textarea
                    id={`ft-${c.condition}`}
                    rows={4}
                    value={texts[ratingKey(OPEN_ITEM_KEY, c.condition)] ?? ''}
                    onChange={(e) =>
                      setTexts((prev) => ({
                        ...prev,
                        [ratingKey(OPEN_ITEM_KEY, c.condition)]: e.target.value,
                      }))
                    }
                    className="w-full rounded-lg border border-[hsl(var(--border))] px-3 py-2 text-sm leading-relaxed resize-none focus:outline-none focus:border-[hsl(var(--primary))]"
                  />
                </div>
              ))}
            </div>
            <Nav
              busy={busy}
              missing={0}
              onBack={() => void go('compare', null)}
              onNext={() => void go('done', 'open')}
              nextLabel="Finish"
            />
          </Card>
        )}

        {step === 'done' && (
          <Card>
            <h1 className="text-lg font-semibold mb-2">Thank you</h1>
            <p className="text-sm text-[hsl(var(--muted-foreground))] mb-6 leading-relaxed">
              That is the last of the questions. Your facilitator will take it from here.
            </p>
            <PhaseAdvance from={phase} label="Continue" />
          </Card>
        )}

        {error && (
          <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

const primaryButton =
  'rounded-lg bg-[hsl(var(--primary))] px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-40';

function choiceClass(on: boolean): string {
  return `flex-1 rounded-lg border py-2 text-sm font-semibold ${
    on
      ? 'bg-[hsl(var(--primary))] border-[hsl(var(--primary))] text-white'
      : 'border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]'
  }`;
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-7">
      {children}
    </div>
  );
}

/** One statement, rated once per version, on one row. */
function RatedRow({
  item,
  number,
  columns,
  scale,
  ratings,
  onRate,
}: {
  item: VersionRatedItem;
  number: number;
  columns: FinalColumn[];
  scale: number[];
  ratings: Ratings;
  onRate: (item: string, condition: string | undefined, value: number) => void;
}) {
  return (
    <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
      <p className="text-sm mb-3">
        <span className="text-[hsl(var(--muted-foreground))] mr-2">{number}.</span>
        {item.text}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {columns.map((c) => (
          <div key={c.condition}>
            <div className="flex items-baseline gap-2 mb-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wide">{c.name}</span>
              {c.cloneAssignmentId && (
                <a
                  href={`/instructor/assignments/${c.cloneAssignmentId}/score`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 text-[10.5px] text-[hsl(var(--muted-foreground))] hover:underline"
                >
                  open <ExternalLink className="w-2.5 h-2.5" />
                </a>
              )}
            </div>
            <div className="flex gap-1">
              {scale.map((n) => (
                <button
                  key={n}
                  onClick={() => onRate(item.key, c.condition, n)}
                  className={choiceClass(ratings[ratingKey(item.key, c.condition)] === n)}
                >
                  {n}
                </button>
              ))}
            </div>
            <div className="flex justify-between mt-1 text-[10px] text-[hsl(var(--muted-foreground))]">
              <span>{AGREE_LOW}</span>
              <span>{AGREE_HIGH}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Nav({
  busy,
  missing,
  onBack,
  onNext,
  nextLabel = 'Next',
}: {
  busy: boolean;
  missing: number;
  onBack: () => void;
  onNext: () => void;
  nextLabel?: string;
}) {
  return (
    <div className="mt-7 flex items-center gap-3">
      <button
        onClick={onBack}
        disabled={busy}
        className="rounded-lg border border-[hsl(var(--border))] px-4 py-2.5 text-sm font-semibold hover:bg-[hsl(var(--muted))] disabled:opacity-40"
      >
        Back
      </button>
      <button onClick={onNext} disabled={busy || missing > 0} className={primaryButton}>
        {nextLabel}
      </button>
      {busy && <Loader2 className="w-3.5 h-3.5 animate-spin text-[hsl(var(--muted-foreground))]" />}
      {missing > 0 && (
        <span className="text-xs text-[hsl(var(--muted-foreground))]">{missing} left</span>
      )}
    </div>
  );
}
