'use client';

/**
 * How long this configure block has been running — "12 / 25 min", in the studio
 * header, for the participant's eyes.
 *
 * WHY IT EXISTS. The block has a 25-minute budget and the participant was never
 * told so; the first they heard of it was the facilitator's warning at twenty.
 * That matters more than it sounds, because what a participant chooses to cover
 * in the time IS the primary measure for RQ1 (design v2 §5: "무엇을 몇 개나 보고
 * 고칠지는 전적으로 참가자의 자유이며, 그 자체가 측정값이다"). A choice made
 * without knowing there is a budget is not a free choice, it is an uninformed
 * one, and the two are indistinguishable in the data afterwards. Someone who
 * spent twenty minutes perfecting one Planning intent may have chosen depth —
 * or may simply have been ambushed by a deadline nobody mentioned.
 *
 * WHY IT IS DELIBERATELY DULL. Elapsed, not remaining; whole minutes, never
 * seconds; one muted colour that never escalates; no alarm at the end; and it
 * keeps counting past 25 rather than stopping or turning red. A ticking red
 * countdown is a stressor, and this study MEASURES stress — the block survey
 * asks about mental demand and frustration — so a timer that pushed those
 * numbers would be contaminating one of its own outcomes. It would also be
 * likely to push the two arms differently: SCORE's loop is front-loaded (write
 * an intent, apply it, read the judgments, refine), so urgency there is spent
 * out of the rating loop that IS the mechanism under test, while the baseline's
 * write-then-test cycle has less to skip. The goal is only that someone can
 * glance up and know where they are.
 *
 * Nothing is enforced. The facilitator still runs the clock (v2 delta plan §8).
 */
import { useEffect, useState } from 'react';

/** Whole minutes since `startedAt`, floored, never negative. */
function minutesSince(startedAtMs: number): number {
  return Math.max(0, Math.floor((Date.now() - startedAtMs) / 60_000));
}

export default function WorkElapsed({
  startedAt,
  budgetMinutes,
}: {
  /** ISO timestamp of the phase_advance that began this block. */
  startedAt: string;
  budgetMinutes: number;
}) {
  const startedAtMs = new Date(startedAt).getTime();
  // Starts at null so the server-rendered HTML and the first client render
  // agree — the number depends on the current time, which the two do not share.
  const [minutes, setMinutes] = useState<number | null>(null);

  useEffect(() => {
    if (!Number.isFinite(startedAtMs)) return;
    setMinutes(minutesSince(startedAtMs));
    // Tick on the minute BOUNDARY rather than every 60s from mount, so the
    // reading changes when the minute actually turns. A plain 60s interval
    // drifts by however long the page took to open, which is enough for the
    // participant's number and the facilitator's console chip to disagree by
    // one — and the whole point is that they are the same clock.
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const msIntoMinute = (Date.now() - startedAtMs) % 60_000;
      timer = setTimeout(() => {
        setMinutes(minutesSince(startedAtMs));
        schedule();
      }, 60_000 - msIntoMinute + 250);
    };
    schedule();
    return () => clearTimeout(timer);
  }, [startedAtMs]);

  if (minutes === null) return null;

  return (
    <span
      // Not a live region: this must not be announced on every change. It is
      // reference, available when looked at, and a screen reader interrupting
      // the work every minute would be the loud timer this is not.
      title={`This part of the session is about ${budgetMinutes} minutes. Your facilitator keeps the time — nothing stops on its own.`}
      className="shrink-0 select-none rounded border border-[hsl(var(--border))] px-2 py-1 text-[11px] tabular-nums text-[hsl(var(--muted-foreground))]"
    >
      {minutes} / {budgetMinutes} min
    </span>
  );
}
