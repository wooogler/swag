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
 *
 * ONE BUTTON, AND IT IS CONTINUE. This screen used to ask for two clicks —
 * Save, and then a Continue that only appeared once Save had gone through.
 * Questionnaires do not have Save buttons; nobody arrives expecting one, and a
 * participant who answers five questions and looks for the way forward should
 * find the way forward. The two clicks were protecting something real, though:
 * Continue starts the next block and cannot be taken back, so it must not be
 * the same press that records an answer.
 *
 * Continue does all three jobs in the order that keeps that protection:
 *   1. CHECK — an unanswered question stops the click and says which one. The
 *      alternative, a disabled button, is worse: it withholds the press and
 *      says nothing about what is missing, so the participant hunts.
 *   2. SAVE — before the confirmation, not after, so answers are on record
 *      even if they step back to change one and never press again.
 *   3. CONFIRM — the beat the old Save/Continue split was really providing:
 *      one last look before a door closes behind them.
 */

import { useState } from 'react';
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
  const [error, setError] = useState<string | null>(null);
  /**
   * Whether the gaps are being pointed at.
   *
   * False until Continue is pressed, so a participant working down the page in
   * order is never told off for questions they have not reached yet. Which
   * rows are marked is derived from `answers`, so a gap un-marks itself the
   * moment it is filled rather than on the next press.
   */
  const [checking, setChecking] = useState(false);

  const missing = items.filter((i) => answers[i.key] === undefined);
  const scale = Array.from({ length: max - min + 1 }, (_, i) => min + i);

  const save = async (): Promise<boolean> => {
    try {
      const res = await fetch('/api/study/session/survey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers }),
      });
      if (!res.ok) {
        setError('Could not save that — message the researcher on the Zoom call.');
        return false;
      }
      return true;
    } catch {
      setError('Could not save that — message the researcher on the Zoom call.');
      return false;
    }
  };

  /** Continue's first two jobs: check, then save. False stops the click. */
  const checkThenSave = async (): Promise<boolean> => {
    setError(null);
    if (missing.length > 0) {
      setChecking(true);
      // Take them to the first gap rather than leaving a count to be
      // reconciled against five questions by eye.
      scrollToRow(missing[0].key);
      return false;
    }
    setChecking(false);
    return save();
  };

  return (
    // pb-40: the confirmation opens below Continue and is absolutely
    // positioned, so it cannot push the page taller — without the room it
    // would open past the bottom of the document.
    <div className="min-h-screen bg-[hsl(var(--background))] pt-10 pb-40 px-6">
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
          {items.map((item, index) => {
            const unanswered = checking && answers[item.key] === undefined;
            return (
            <div
              key={item.key}
              id={rowId(item.key)}
              className={`rounded-xl border bg-[hsl(var(--card))] p-5 ${
                unanswered
                  ? 'border-amber-400 ring-2 ring-amber-200'
                  : 'border-[hsl(var(--border))]'
              }`}
            >
              <div className="flex items-baseline justify-between gap-3 mb-1.5">
                {item.label && (
                  <p className="text-2xs font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                    {item.label}
                  </p>
                )}
                {unanswered && (
                  <p className="text-2xs font-bold uppercase tracking-wide text-amber-700">
                    Not answered yet
                  </p>
                )}
              </div>
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
            );
          })}
        </div>

        <div className="mt-8 pt-6 border-t border-[hsl(var(--border))]">
          <PhaseAdvance
            from={phase}
            label="Continue"
            waits
            // True now in a way it was not before: this hand-off is where the
            // frozen answers are awaited, and the minute just spent here is
            // the minute the batch had to run in.
            waitLabel="Getting the check questions ready — your chatbot is answering them now."
            guard={checkThenSave}
            confirm="Your answers are saved. Once you continue you will not be able to change them."
            confirmLabel="Yes, continue"
            // Hug the button: the confirmation is positioned against this
            // element's centre, and a full-width one would open the question
            // in the middle of the page instead of under what was pressed.
            className="w-fit"
          />
          {checking && missing.length > 0 && (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
              {missing.length === 1
                ? 'One question still needs an answer — it is marked above.'
                : `${missing.length} questions still need an answer — they are marked above.`}
            </p>
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

/** One row's anchor, so "which one is missing" has somewhere to point. */
function rowId(key: string): string {
  return `survey-item-${key}`;
}

/**
 * Bring a row into view — NEXT frame, not this one.
 *
 * Clicking a button focuses it, and the browser scrolls a newly focused
 * element into view on its own. Scrolling straight from the click handler puts
 * the two in a race that the browser wins, so the smooth scroll starts and is
 * immediately undone: the participant is told two questions are missing and
 * left looking at the button that told them. A frame later, focus has settled
 * and the scroll sticks.
 */
function scrollToRow(key: string) {
  requestAnimationFrame(() => {
    document.getElementById(rowId(key))?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}
