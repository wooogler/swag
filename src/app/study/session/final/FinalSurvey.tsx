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
 * NO LINKS BACK TO THE BOARDS (08-22). Each column header used to carry an
 * "open ↗" to that version's workspace, sixteen of them down the page, and the
 * intro told the participant to use them. They did not work: the board's phase
 * gate allows only the clone the CURRENT phase is about, and `final_survey`
 * allows none — every one of those links bounced to the session screen in a
 * new tab.
 *
 * And the gate is right, which is why they are gone rather than fixed.
 * Reopening a finished block's board lets someone edit a configuration the
 * measurements are already frozen against; the score page calls that silent
 * data corruption and redirects rather than warning. A recall aid that
 * contradicts the invariant it is a recall aid for is not a recall aid. What
 * remains is the honest form: they rate what they remember, and the paper says
 * so.
 */

import { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
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

/** One statement's anchor, so an unanswered one has somewhere to point. */
const rowId = (item: string) => `final-item-${item}`;

/**
 * Bring a statement into view — NEXT frame, not this one.
 *
 * Clicking Next focuses it, and the browser scrolls a newly focused element
 * into view on its own; scrolling straight from the handler loses that race
 * and leaves the participant staring at the button that just told them
 * something was missing. Same reason, same fix, as the workload questionnaire.
 */
function scrollToRow(item: string) {
  requestAnimationFrame(() => {
    document.getElementById(rowId(item))?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

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
  /**
   * Whether Next has been pressed on a page with gaps in it.
   *
   * Next stays live either way — this is the same choice the workload
   * questionnaire makes (BlockSurvey): a disabled button withholds the press
   * and says nothing about which of eight statements was missed, and on this
   * page half of them are two ratings wide. Pressing marks the gaps and goes
   * to the first one. Cleared on every page turn, so a fresh page is never
   * already scolding.
   */
  const [checking, setChecking] = useState(false);

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

  /** The first thing on this page with no answer, for the scroll. */
  const firstGap = (s: Step): string | null => {
    if (s === 'experience' || s === 'context') {
      const items = s === 'experience' ? EXPERIENCE_ITEMS : CONTEXT_ITEMS;
      return (
        items.find((i) => columns.some((c) => ratings[ratingKey(i.key, c.condition)] === undefined))
          ?.key ?? null
      );
    }
    if (s === 'compare') {
      return COMPARE_ITEMS.find((i) => ratings[ratingKey(i.key)] === undefined)?.key ?? null;
    }
    return null;
  };

  const go = async (to: Step, save: Step | null) => {
    setError(null);
    // Forward moves are the ones with something to check; Back never is, and
    // it is `save` that tells them apart — going back saves nothing.
    if (save && missingOn(save) > 0) {
      setChecking(true);
      const gap = firstGap(save);
      if (gap) scrollToRow(gap);
      return;
    }
    setChecking(false);
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
    setChecking(false);
    window.scrollTo({ top: 0 });
  };

  const index = STEPS.indexOf(step);
  const progress = useMemo(() => Math.round((index / (STEPS.length - 1)) * 100), [index]);
  /**
   * The rating pages are wider than the prose ones.
   *
   * Two seven-point scales have to fit side by side without either of them
   * crushing to a row of forty-pixel squares — at 3xl they did, and the two
   * versions ran together into one strip. The prose pages stay narrow, because
   * a 900px paragraph is its own reading problem.
   */
  const grid = step === 'experience' || step === 'context' || step === 'compare';

  return (
    <div className="min-h-screen bg-[hsl(var(--background))] py-10 px-6">
      <div className={`${grid ? 'max-w-5xl' : 'max-w-3xl'} mx-auto`}>
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
            <h1 className="text-xl font-semibold mb-3">Almost done — thank you</h1>
            <p className="text-base text-[hsl(var(--muted-foreground))] leading-relaxed mb-3">
              You used two versions of the tool today, {columns.map((c) => c.name).join(' and ')}. In
              this last questionnaire we ask you to rate them separately, side by side. There are no
              right answers, and critical ratings are just as useful to us as positive ones.
            </p>
            <button onClick={() => void go('experience', null)} className={primaryButton}>
              Start
            </button>
          </Card>
        )}

        {(step === 'experience' || step === 'context') && (
          // No outer card on the rating pages. A card holding cards holding
          // panels is three nested boxes, and the innermost one — the version
          // being rated — is the one that has to stand out.
          <div>
            <h1 className="text-xl font-semibold mb-1">
              {step === 'experience' ? 'Rating the two versions' : 'A few last ratings'}
            </h1>
            <p className="text-sm text-[hsl(var(--muted-foreground))] mb-6">
              {step === 'experience'
                ? `For each statement, please rate ${columns.map((c) => c.name).join(' and ')} separately.`
                : 'A few last ratings, in the same way.'}
            </p>
            <div className="space-y-5">
              {(step === 'experience' ? EXPERIENCE_ITEMS : CONTEXT_ITEMS).map((item, i) => (
                <RatedRow
                  key={item.key}
                  item={item}
                  number={i + 1}
                  columns={columns}
                  scale={scale}
                  ratings={ratings}
                  checking={checking}
                  onRate={setRating}
                />
              ))}
            </div>
            <Nav
              busy={busy}
              missing={checking ? missingOn(step) : 0}
              onBack={() => void go(step === 'experience' ? 'intro' : 'experience', null)}
              onNext={() => void go(step === 'experience' ? 'context' : 'compare', step)}
            />
          </div>
        )}

        {step === 'compare' && (
          <div>
            <h1 className="text-xl font-semibold mb-1">Comparing them directly</h1>
            <p className="text-sm text-[hsl(var(--muted-foreground))] mb-6">
              Now comparing {columns[0]?.name} and {columns[1]?.name} directly. Which one made it
              easier to…
            </p>
            <div className="space-y-5">
              {COMPARE_ITEMS.map((item, i) => {
                const unanswered = checking && ratings[ratingKey(item.key)] === undefined;
                return (
                <div
                  key={item.key}
                  id={rowId(item.key)}
                  className={`rounded-xl border bg-[hsl(var(--card))] px-5 py-4 ${
                    unanswered ? 'border-amber-400 ring-2 ring-amber-200' : 'border-[hsl(var(--border))]'
                  }`}
                >
                  <p className="text-base leading-relaxed mb-4">
                    <span className="text-[hsl(var(--muted-foreground))] tabular-nums mr-2">
                      {i + 1}.
                    </span>
                    …{item.text}
                  </p>
                  {/* One scale, so it gets the panel the paired page gives each
                      version — the row still reads as a thing being answered
                      rather than as buttons loose on a card. */}
                  <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 px-3.5 pt-3 pb-3">
                    <div className="flex gap-1.5">
                      {scale.map((n) => (
                        <button
                          key={n}
                          onClick={() => setRating(item.key, undefined, n)}
                          aria-label={
                            n === 4
                              ? 'No difference'
                              : `${n} — towards ${
                                  n < 4 ? columns[0]?.name ?? 'the first' : columns[1]?.name ?? 'the second'
                                }`
                          }
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
                    <div className="flex justify-between mt-2 text-2xs text-[hsl(var(--muted-foreground))]">
                      <span>
                        Much easier with{' '}
                        <span className="font-semibold text-[hsl(var(--foreground))]">
                          {columns[0]?.name}
                        </span>
                      </span>
                      <span>No difference</span>
                      <span>
                        Much easier with{' '}
                        <span className="font-semibold text-[hsl(var(--foreground))]">
                          {columns[1]?.name}
                        </span>
                      </span>
                    </div>
                  </div>
                </div>
                );
              })}
            </div>
            <Nav
              busy={busy}
              missing={checking ? missingOn('compare') : 0}
              onBack={() => void go('context', null)}
              onNext={() => void go('open', 'compare')}
            />
          </div>
        )}

        {step === 'open' && (
          <Card>
            <h1 className="text-xl font-semibold mb-1">In your own words</h1>
            <p className="text-sm text-[hsl(var(--muted-foreground))] mb-6">
              Two short questions, and then we are done. Neither is required.
            </p>
            <div className="space-y-5">
              {columns.map((c) => (
                <div key={c.condition}>
                  <label
                    className="block text-base leading-relaxed mb-2"
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
                    className="w-full rounded-lg border border-[hsl(var(--border))] px-3 py-2.5 text-base leading-relaxed resize-none focus:outline-none focus:border-[hsl(var(--primary))]"
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
            <h1 className="text-xl font-semibold mb-2">Thank you</h1>
            <p className="text-base text-[hsl(var(--muted-foreground))] mb-6 leading-relaxed">
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
  'rounded-lg bg-[hsl(var(--primary))] px-6 py-3 text-base font-semibold text-white disabled:opacity-40';

function choiceClass(on: boolean): string {
  return `flex-1 rounded-lg border py-2.5 text-base font-semibold ${
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

/**
 * One statement, rated once per version, on one row.
 *
 * THE TWO VERSIONS HAVE TO LOOK LIKE TWO VERSIONS. Side by side with a hairline
 * between them, fourteen buttons in a row read as one long scale, and the
 * answer to "which of these did I just click" stops being obvious at exactly
 * the moment the participant is tired. Each version gets its own panel, its own
 * name, its own endpoints and a gutter wide enough to be a boundary rather than
 * a gap.
 *
 * The panels are IDENTICAL — same tint, same border, same order of controls.
 * Anything that distinguished one column visually would be a thumb on the
 * scale, and the column order is already the participant's own (§13 invariant
 * 8), so a tint tied to a side would land on a different arm each session and
 * be worse than useless.
 */
function RatedRow({
  item,
  number,
  columns,
  scale,
  ratings,
  checking,
  onRate,
}: {
  item: VersionRatedItem;
  number: number;
  columns: FinalColumn[];
  scale: number[];
  ratings: Ratings;
  /** Next has been pressed with gaps on this page — show them. */
  checking: boolean;
  onRate: (item: string, condition: string | undefined, value: number) => void;
}) {
  const gap = checking && columns.some((c) => ratings[ratingKey(item.key, c.condition)] === undefined);
  return (
    <div
      id={rowId(item.key)}
      className={`rounded-xl border bg-[hsl(var(--card))] px-5 py-4 ${
        gap ? 'border-amber-300' : 'border-[hsl(var(--border))]'
      }`}
    >
      <p className="text-base leading-relaxed mb-4">
        <span className="text-[hsl(var(--muted-foreground))] tabular-nums mr-2">{number}.</span>
        {item.text}
      </p>
      <div className="grid gap-4 sm:grid-cols-2 sm:gap-7">
        {columns.map((c) => {
          const value = ratings[ratingKey(item.key, c.condition)];
          return (
            <div
              key={c.condition}
              className={`rounded-lg border px-3.5 pt-2.5 pb-3 ${
                checking && value === undefined
                  ? 'border-amber-300 bg-amber-50/60'
                  : 'border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30'
              }`}
            >
              <div className="mb-2">
                <span className="inline-flex items-center rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-2 py-0.5 text-2xs font-bold uppercase tracking-wide">
                  {c.name}
                </span>
              </div>
              <div className="flex gap-1.5">
                {scale.map((n) => (
                  <button
                    key={n}
                    onClick={() => onRate(item.key, c.condition, n)}
                    aria-label={`${c.name}: ${n}`}
                    className={choiceClass(value === n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <div className="flex justify-between mt-1.5 text-2xs text-[hsl(var(--muted-foreground))]">
                <span>{AGREE_LOW}</span>
                <span>{AGREE_HIGH}</span>
              </div>
            </div>
          );
        })}
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
        className="rounded-lg border border-[hsl(var(--border))] px-5 py-3 text-base font-semibold hover:bg-[hsl(var(--muted))] disabled:opacity-40"
      >
        Back
      </button>
      {/* Live even with gaps: pressing it is how the gaps get pointed at. */}
      <button onClick={onNext} disabled={busy} className={primaryButton}>
        {nextLabel}
      </button>
      {busy && <Loader2 className="w-3.5 h-3.5 animate-spin text-[hsl(var(--muted-foreground))]" />}
      {missing > 0 && (
        <span className="text-xs font-semibold text-amber-800">
          {missing === 1
            ? 'One rating is still missing — it is marked above.'
            : `${missing} ratings are still missing — they are marked above.`}
        </span>
      )}
    </div>
  );
}
