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
 * WHY IT IS STILL DULL, AND WHERE IT STOPS BEING. Elapsed, not remaining;
 * whole minutes, never seconds; no alarm, no motion, no icon; and it keeps
 * counting past the budget rather than stopping. A ticking red countdown is a
 * stressor, and this study MEASURES stress — the block survey asks about
 * mental demand and frustration — so a timer that pushed those numbers would
 * contaminate one of its own outcomes. It would also be likely to push the two
 * arms differently: SCORE's loop is front-loaded (write an intent, apply it,
 * read the judgments, refine), so urgency there is spent out of the rating loop
 * that IS the mechanism under test, while the baseline's write-then-test cycle
 * has less to skip.
 *
 * It did not change colour at all until 08-24. It does now, at the warning and
 * at the budget, because the two cues those numbers used to have are both gone:
 * the facilitator's spoken warning at twenty, and a facilitator in the room at
 * twenty-five. Someone alone in a breakout room has this readout and nothing
 * else. So the colour is the smallest thing that can carry the same fact — the
 * TEXT changes hue, the box does not; no fill, no border change, no bold, no
 * transition, and it never moves. It is a number that has gone amber, not an
 * alarm. Both arms get the identical component in the identical place, so
 * whatever pressure it adds is added equally (§13 invariant 1).
 *
 * What it still refuses to do: say how long is LEFT, and stop. Both are
 * invariant 5, and both are what turns a readout into a countdown.
 *
 * Nothing is enforced, and since the study went to parallel breakout rooms
 * this readout is the ONLY thing that tells a participant where they are in
 * the block — the facilitator's twenty-minute verbal warning had nobody left
 * to say it. That raises what it carries without changing what it may do:
 * still elapsed, still whole minutes, still one muted colour past the
 * budget. Turning it into the warning it replaced would make it the
 * countdown the design forbids (§13 invariant 5) and push the very stress
 * numbers the block survey measures.
 *
 * Set a step up from the header it sits in: the board is out of the study's
 * root scale (globals.css), and a readout nobody can read at a glance is not a
 * readout.
 */
import { useEffect, useState } from 'react';

/** Whole minutes since `startedAt`, floored, never negative. */
function minutesSince(startedAtMs: number): number {
  return Math.max(0, Math.floor((Date.now() - startedAtMs) / 60_000));
}

export default function WorkElapsed({
  startedAt,
  budgetMinutes,
  warnMinutes,
}: {
  /** ISO timestamp of the clock event that began this block. */
  startedAt: string;
  budgetMinutes: number;
  /** When the readout goes amber — the spoken warning's old number. */
  warnMinutes: number;
}) {
  // The server rendered this from whatever the clock said when the board was
  // built, which is the phase advance — the briefing's Start has not happened
  // yet at that point and is what actually zeroes the block. It announces
  // itself when it does (AssignmentBriefing), and this is the only way to hear
  // it: the two are siblings of a server component, so no prop can carry it.
  // Without this the participant's readout counts the briefing and the
  // console's does not, and the whole point of one clock is that there is one.
  const [zero, setZero] = useState(startedAt);
  useEffect(() => setZero(startedAt), [startedAt]);
  useEffect(() => {
    const onStarted = (e: Event) => {
      const at = (e as CustomEvent).detail?.startedAt;
      if (typeof at === 'string') setZero(at);
    };
    window.addEventListener('study:work-started', onStarted);
    return () => window.removeEventListener('study:work-started', onStarted);
  }, []);

  const startedAtMs = new Date(zero).getTime();
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

  // Text colour only, and only two steps. `warnMinutes` is the same number the
  // facilitator used to speak at and the same one the console's chip turns on,
  // so the participant and the researcher are looking at one threshold.
  const tone =
    minutes >= budgetMinutes
      ? 'text-rose-700'
      : minutes >= warnMinutes
        ? 'text-amber-700'
        : 'text-[hsl(var(--muted-foreground))]';

  return (
    <span
      // Not a live region: this must not be announced on every change, and that
      // holds after the colour change too — the whole point is that it is there
      // when looked at rather than that it interrupts. A screen reader gets the
      // same fact from the title.
      title={`This part of the session is about ${budgetMinutes} minutes. Nothing stops on its own.`}
      className={`shrink-0 select-none rounded border border-[hsl(var(--border))] px-2.5 py-1.5 text-xs tabular-nums ${tone}`}
    >
      {minutes} / {budgetMinutes} min
    </span>
  );
}
