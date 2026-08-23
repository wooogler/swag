'use client';

/**
 * The block test, in two passes over the same questions (BLOCK_TEST v3 §3, §4).
 *
 * PASS 1 predicts every question and shows no answers at all — four inputs, in
 * this order: how the chatbot SHOULD ideally answer (Q1), which part of the
 * configuration will handle it (Q2), how well they can anticipate the answer
 * (Q3), and whether they expect that answer to be educationally desirable (Q4).
 * PASS 2 walks the same questions again: the response, then the same
 * desirability sentence in the present tense (Q5), then whether the response
 * follows what they set up (Q6), and — only where one of those is negative —
 * the probe.
 *
 * Splitting the passes is the whole point (§3.1). Revealing per question let
 * the first answers teach the participant what this configuration does, and
 * they carried that into every prediction after it — worst of all into Q3,
 * which is a claim about their own foresight. The client does not decide this:
 * the server releases nothing until the last prediction lands (measure-store).
 *
 * NOTHING FROM PASS 1 IS PUT BACK ON SCREEN BEFORE THE JUDGEMENTS (§3.2). Q5
 * and Q4 are the same sentence in two tenses, so |Q4 − Q5| is the prediction
 * error — and showing Q4 first pulls Q5 towards it and shrinks that error for
 * procedural reasons. The recap and the Matched chip appear inside the probe
 * panel, which opens after both judgements are in.
 *
 * EVERY ANSWER IS A UI INPUT. The free text used to be spoken and written down
 * by the facilitator; the boxes are here, so the wording survives verbatim
 * against a question id and Pass 1 has no channel through which a hint about
 * the answer could leak. The facilitator watches and says nothing.
 *
 * Three columns, in the order the work is done: the question on the left in
 * the SAME chat component the students and the SCORE board use, the
 * configuration beside it and open the whole time, and this question's inputs
 * on the right. Read what was asked → look at what you wrote → answer.
 *
 * The configuration sits between the two on purpose. Every question here is a
 * comparison across that boundary — Q2 asks which part of it will handle the
 * question on its left, Q6 asks whether the response followed it — and the
 * thing being compared should not be at the far end of the screen from either
 * side. It stays open throughout because this measures whether an instructor
 * can READ their own setup and foresee what it does, not whether they
 * memorised it. ONE question at a time.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import ChatMessages, { type Message } from '@/components/chat/ChatMessages';
import { MaterialSegments } from '@/app/instructor/assignments/[id]/score/materials';
import PhaseAdvance from '@/components/study/PhaseAdvance';
import SnapshotConfigView, { type SnapshotConfig } from '@/components/study/SnapshotConfigView';
import type { MaterialKind, MaterialSpan } from '@/lib/score/intents';
import type { Pointing, PointedSpan, QuestionMaterials, TestItem } from '@/lib/study/measure-store';

type Pass = 'predict' | 'judge';

/**
 * The 6-point agreement scale, used by all four rated items (§3.3).
 *
 * Six and not five or seven: there is no neutral to hide in, and it halves
 * exactly at 3/4 — so "negative opens the probe" needs no ruling about what a
 * midpoint means, and the same fold serves both quadrants.
 */
const AGREE = [
  'Strongly disagree',
  'Disagree',
  'Somewhat disagree',
  'Somewhat agree',
  'Agree',
  'Strongly agree',
];
const SCALE = [1, 2, 3, 4, 5, 6];

/** fold: 1-3 negative, 4-6 positive. One rule, everywhere. */
const isNegative = (v: number | null) => v !== null && v <= 3;

/** What Pass 1 holds for the current question before Next is pressed. */
interface Draft {
  ideal: string;
  pointing: Pointing | null;
  confidence: number | null;
  expectDesirable: number | null;
}

const EMPTY_DRAFT: Draft = {
  ideal: '',
  pointing: null,
  confidence: null,
  expectDesirable: null,
};

function draftComplete(d: Draft): boolean {
  return (
    d.ideal.trim().length > 0 &&
    d.pointing !== null &&
    d.confidence !== null &&
    d.expectDesirable !== null
  );
}

/**
 * Per-step durations for one question, in ms from the moment it appeared.
 *
 * All four parts of a prediction land in ONE write (Next), so the stored
 * timestamps cannot separate them. Yet the steps ask for different things:
 * pointing is "read your configuration and find the part that governs this",
 * Q1 is "say what a good answer would be", the two ratings are judgements. How
 * long the POINTING takes — and how often it is changed before Next — is the
 * comprehension signal, and the one a screen recording can only give by
 * stopwatch. Pass 2 adds how often each judgement was revised, which is how
 * §10-5's "ratings drift up to dodge the probe" would show itself.
 *
 * Measured with performance.now(), so a client clock that is wrong or adjusts
 * mid-session cannot corrupt it.
 */
interface StepTiming {
  idealStart?: number;
  idealEnd?: number;
  pointFirst?: number;
  point?: number;
  pointChanges?: number;
  confidence?: number;
  expectDesirable?: number;
  submit?: number;
  reveal?: number;
  desirable?: number;
  follows?: number;
  desirableChanges?: number;
  followsChanges?: number;
  probeOpened?: number;
  probe?: number;
  repair?: number;
  probeChars?: number;
  repairChars?: number;
}

export default function BlockTest({
  config,
  items,
  phase,
  legacyLineBreaks = false,
}: {
  config: SnapshotConfig;
  items: TestItem[];
  phase: string;
  /**
   * Imported logs (NIRVANA) carry single-newline breaks that CommonMark
   * collapses. SCORE's viewer answers that by rendering the whole thread
   * verbatim, which cannot work here: this thread ends in a reply THIS app
   * just generated, and showing that one verbatim puts literal ## and ** in
   * front of the participant — in the one message the measurement is about.
   * So the breaks are repaired on the imported turns instead.
   */
  legacyLineBreaks?: boolean;
}) {
  const [state, setState] = useState(items);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);

  /** The one-time screen between the passes. */
  const [bridge, setBridge] = useState(false);
  /** Pass 2: has this question's answer been opened yet? */
  const [revealed, setRevealed] = useState(false);
  const [probe, setProbe] = useState('');
  const [repair, setRepair] = useState('');

  const predicted = state.filter((i) => i.pointing !== null).length;
  const judged = state.filter((i) => i.desirable !== null && i.follows !== null).length;
  const pass: Pass = predicted === state.length ? 'judge' : 'predict';

  /**
   * The one question in play.
   *
   * Pass 1 derives it — submitting the prediction IS Next, so the first
   * unpredicted question is always the right one. Pass 2 cannot: the judgement
   * is not the end of the question, and deriving from "first unjudged" moved
   * the screen on the instant a number was clicked, before the boxes that open
   * BECAUSE of that number could be answered. So Pass 2 holds a position and
   * only Next advances it, seeded from the first unjudged question so a reload
   * lands where they were.
   */
  const firstUnjudged = state.findIndex((i) => i.desirable === null || i.follows === null);
  const [reviewIndex, setReviewIndex] = useState<number | null>(null);
  const reviewAt = reviewIndex ?? (firstUnjudged === -1 ? state.length : firstUnjudged);
  // Pin it the moment Pass 2 opens. Left to derive it would keep tracking that
  // value, so clicking a rating would still slide the screen to the next
  // question before the boxes that number opens are answered.
  useEffect(() => {
    if (pass === 'judge' && reviewIndex === null) {
      setReviewIndex(firstUnjudged === -1 ? state.length : firstUnjudged);
    }
  }, [pass, reviewIndex, firstUnjudged, state.length]);
  const index = pass === 'predict' ? state.findIndex((i) => i.pointing === null) : reviewAt;
  const item = index >= 0 && index < state.length ? state[index] : undefined;
  const finished = pass === 'judge' && reviewAt >= state.length;

  /**
   * The block's one instruction (§4 block intro), shown before the first
   * question and never again. It fixes the standard Q4 and Q5 are answered
   * against: "educationally desirable" means desirable BY THEIR OWN teaching
   * standards, not by some standard the study is holding back.
   */
  const [intro, setIntro] = useState(() => items.every((i) => i.pointing === null));

  /**
   * The stopwatch for the question on screen. `shownAt` restarts whenever a
   * different item takes the card — including at the pass boundary, so Pass 2's
   * reveal and judgements are measured from the moment THAT card appeared
   * rather than from a prediction made minutes earlier.
   */
  const shownAt = useRef<number>(0);
  const timing = useRef<StepTiming>({});
  const since = () => Math.round(performance.now() - shownAt.current);
  const mark = (patch: StepTiming) => {
    timing.current = { ...timing.current, ...patch };
  };

  // A new question starts empty, and Pass 2 starts closed. Keyed on the item so
  // a reveal cannot carry over to the next one.
  const shownId = useRef<string | null>(null);
  useEffect(() => {
    const key = item ? `${pass}:${item.bankItemId}` : null;
    if (key && shownId.current !== key) {
      shownId.current = key;
      shownAt.current = performance.now();
      timing.current = {};
      setDraft(EMPTY_DRAFT);
      // A question already judged has already been revealed — a reload must
      // not hide the response someone is in the middle of writing about.
      setRevealed(item?.desirable != null);
      setProbe(item?.probe ?? '');
      setRepair(item?.repair ?? '');
    }
  }, [item, pass]);

  /** The stretches pointed at so far — baseline only, empty on anything else. */
  const spans = draft.pointing?.kind === 'span' ? draft.pointing.spans : [];

  /**
   * A finished drag IS a mark. No confirming step.
   *
   * It used to land in the card as a quotation with an "Add this part" button
   * under it, and that button was the only thing on screen saying a second
   * mark was possible — so whether the document could be marked twice was
   * discoverable only by having already marked it once. Marking on release
   * says it by doing it: the first drag leaves a mark, and a document with a
   * mark in it visibly still takes another.
   *
   * Merged rather than appended, because a participant refining a selection
   * ("no, from here") produces overlapping drags, and two marks that overlap
   * would tint the same words twice and export as two findings where there was
   * one. The browser selection is dropped straight after, so the blue of a
   * live drag does not sit on top of the yellow of the mark it just became.
   */
  const addSpan = (span: PointedSpan) => {
    patchDraftTimed({ pointing: { kind: 'span', spans: mergeSpans([...spans, span]) } });
    window.getSelection()?.removeAllRanges();
  };

  /** Take them all off. Pointing goes back to unanswered — an empty list is
   * not a different answer from never having pointed, and Next should shut. */
  const clearSpans = () => patchDraftTimed({ pointing: null });

  /**
   * Patch, not replace. Handing the card a whole new Draft made every control
   * read the draft from its own render, so two answers given inside one frame
   * had the second overwrite the first and Next stayed shut with no sign of why.
   */
  const patchDraft = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  /**
   * Time the parts of the draft as they are answered. Wrapping patchDraft keeps
   * the cards themselves free of instrumentation.
   */
  const patchDraftTimed = (patch: Partial<Draft>) => {
    const t = since();
    if (patch.ideal !== undefined) {
      if (timing.current.idealStart === undefined) mark({ idealStart: t });
      mark({ idealEnd: t });
    }
    if (patch.pointing !== undefined) {
      if (timing.current.pointFirst === undefined) mark({ pointFirst: t, pointChanges: 0 });
      else mark({ pointChanges: (timing.current.pointChanges ?? 0) + 1 });
      mark({ point: t });
    }
    // First answer only: a corrected number later is a second thought, and
    // overwriting the reaction time with it would lose both.
    if (patch.confidence !== undefined && timing.current.confidence === undefined) {
      mark({ confidence: t });
    }
    if (patch.expectDesirable !== undefined && timing.current.expectDesirable === undefined) {
      mark({ expectDesirable: t });
    }
    patchDraft(patch);
  };

  const post = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/study/session/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError('Could not save that — tell your facilitator.');
        return null;
      }
      return data as Record<string, unknown>;
    } catch {
      setError('Could not save that — tell your facilitator.');
      return null;
    } finally {
      setBusy(false);
    }
  };

  /** Pass 1 · Next — all four parts of the prediction go in one write. */
  const submitPrediction = async () => {
    if (!item || !draftComplete(draft)) return;
    mark({ submit: since() });
    const data = await post({
      action: 'predict',
      bankItemId: item.bankItemId,
      ideal: draft.ideal.trim(),
      pointing: draft.pointing,
      confidence: draft.confidence,
      expectDesirable: draft.expectDesirable,
      timing: timing.current,
    });
    if (!data) return;
    // The last prediction unlocks every answer at once and the server sends
    // them back with it — take that list whole rather than patching one item,
    // so the pass never flips before the responses are actually in hand.
    if (data.revealed && Array.isArray(data.items)) {
      setState(data.items as TestItem[]);
      setBridge(true);
      return;
    }
    setState((prev) =>
      prev.map((i) =>
        i.bankItemId === item.bankItemId
          ? {
              ...i,
              ideal: draft.ideal.trim(),
              pointing: draft.pointing,
              confidence: draft.confidence,
              expectDesirable: draft.expectDesirable,
            }
          : i
      )
    );
  };

  /**
   * Pass 2 · "Show the actual response". Recorded server-side as its own event
   * so the trail carries the moment the answer was opened — the prediction was
   * blind until here, and everything after it is not.
   */
  const reveal = () => {
    if (!item) return;
    mark({ reveal: since() });
    setRevealed(true);
    // Fire and forget: the response is already on the client, so waiting on
    // instrumentation would delay the one screen the measurement is about.
    void post({ action: 'reveal', bankItemId: item.bankItemId, atMs: timing.current.reveal });
  };

  /**
   * Pass 2 · one judgement, Q5 or Q6.
   *
   * Sent one at a time and merged server-side, so a revision to one cannot
   * blank the other. The reply carries the Matched chip when — and only when —
   * this answer is the one that opens the probe panel; the client is never
   * holding routing it is not showing.
   */
  const submitJudgement = async (field: 'desirable' | 'follows', value: number) => {
    if (!item) return;
    const t = since();
    if (field === 'desirable') {
      if (timing.current.desirable === undefined) mark({ desirable: t, desirableChanges: 0 });
      else mark({ desirableChanges: (timing.current.desirableChanges ?? 0) + 1 });
    } else {
      if (timing.current.follows === undefined) mark({ follows: t, followsChanges: 0 });
      else mark({ followsChanges: (timing.current.followsChanges ?? 0) + 1 });
    }
    const data = await post({
      action: 'judge',
      bankItemId: item.bankItemId,
      [field]: value,
      timing: timing.current,
    });
    if (!data) return;
    if (data.probeOpen && timing.current.probeOpened === undefined) {
      mark({ probeOpened: since() });
    }
    setState((prev) =>
      prev.map((i) =>
        i.bankItemId === item.bankItemId
          ? {
              ...i,
              desirable: (data.desirable as number | null) ?? i.desirable,
              follows: (data.follows as number | null) ?? i.follows,
              // Sticky: once it has been seen it cannot be unseen, so a
              // revised rating that closes the panel must not pretend otherwise.
              matched: (data.matched as TestItem['matched']) ?? i.matched,
            }
          : i
      )
    );
  };

  /**
   * Pass 2 · Next — save whatever the probe panel collected, then move on.
   *
   * Saved if the panel was EVER open on this question, not only if it is open
   * now. A participant who writes a probe and then revises the rating that
   * opened it would otherwise have the box vanish with their sentence in it,
   * unsaved and unrecoverable — and the revision is itself worth seeing beside
   * what they had written (§10-5).
   */
  const submitProbe = async () => {
    if (!item) return;
    const everOpened =
      timing.current.probeOpened !== undefined ||
      (item.desirable !== null &&
        item.follows !== null &&
        (isNegative(item.desirable) || isNegative(item.follows)));
    if (everOpened) {
      mark({
        probe: since(),
        probeChars: probe.trim().length,
        repairChars: repair.trim().length,
      });
      const data = await post({
        action: 'probe',
        bankItemId: item.bankItemId,
        probe,
        repair,
        timing: timing.current,
      });
      if (!data) return;
      setState((prev) =>
        prev.map((i) =>
          i.bankItemId === item.bankItemId
            ? { ...i, probe: probe.trim() || null, repair: repair.trim() || null }
            : i
        )
      );
    }
    setReviewIndex(reviewAt + 1);
  };

  const messages: Message[] = useMemo(() => {
    if (!item) return [];
    const turns: Message[] = item.context.map((t, i) => ({
      id: i,
      role: t.role,
      content: legacyLineBreaks && t.role === 'assistant' ? hardBreaks(t.content) : t.content,
    }));
    turns.push({ id: item.context.length, role: 'user', content: item.question });
    // Held back until they press "Show the actual response": the reveal is a
    // step they take, not something that appears while they are still reading.
    if (revealed && item.response !== null) {
      turns.push({ id: item.context.length + 1, role: 'assistant', content: item.response });
    }
    return turns;
  }, [item, legacyLineBreaks, revealed]);

  /**
   * The Material tags, as the board draws them.
   *
   * A participant spends the configuration block reading questions whose pasted
   * parts are tagged — assignment prompt, the student's own draft, a previous
   * reply. Showing the same question here as undifferentiated text asks them to
   * predict against something that does not look like what they configured
   * against, and hides the distinction their intents are most often written on:
   * whether the student supplied the substance or pasted the prompt in.
   *
   * Revealed rather than collapsed. A question has to be READ to be predicted
   * about, so the tags tint and label the text instead of standing in for it;
   * the show/hide control is there for the compact form.
   *
   * The tint carries its own inline label (`labelWhenOpen`), so there is no
   * colour key underneath: a legend for one or two runs of text that are
   * already named where they sit is a second thing to read for nothing.
   */
  const materialsById = useMemo(() => {
    const map = new Map<number, QuestionMaterials>();
    if (!item) return map;
    item.context.forEach((t, i) => {
      if (t.materials) map.set(i, t.materials);
    });
    if (item.questionMaterials) map.set(item.context.length, item.questionMaterials);
    return map;
  }, [item]);

  const renderUserContent = (m: Message) => {
    const found = typeof m.id === 'number' ? materialsById.get(m.id) : undefined;
    if (!found || found.materialKinds.length === 0) return null;
    return (
      <MaterialSegments
        text={m.content}
        dissection={{
          materialKinds: found.materialKinds as MaterialKind[],
          requests: found.requests,
          materials: found.materials as MaterialSpan[] | undefined,
        }}
        defaultOpen
        toggleAll
        labelWhenOpen
      />
    );
  };

  // Named, not described: the recap puts the intent's own title back on screen.
  const intentTitles = useMemo(
    () => new Map((config.intents ?? []).map((i) => [i.id, i.title])),
    [config.intents]
  );

  const pointingOpen = pass === 'predict' && !!item;
  /**
   * Baseline's half of "your pick and where the reply came from": SCORE gets
   * badges on rows, and a prompt has no rows — so what they highlighted is
   * marked again, in the document, in the purple of the revealed reply.
   *
   * AFTER BOTH JUDGEMENTS, whether or not a probe opens. §3.2 keeps every part
   * of the prediction off screen until Q5 and Q6 are in — a stretch of their
   * own prompt lit up while they are deciding whether the reply followed their
   * setup would decide it for them — but once both are answered there is
   * nothing left to anchor, and seeing where they had pointed is part of
   * reading what came back.
   */
  const recapSpans =
    pass === 'judge' &&
    item?.pointing?.kind === 'span' &&
    item.desirable !== null &&
    item.follows !== null
      ? item.pointing.spans
      : [];
  const done = pass === 'predict' ? predicted : judged;

  return (
    // data-product-scale: this one screen runs at the product's type size
    // rather than the study's larger one (globals.css) — three columns that
    // have to be read against each other need the width more than the size.
    <div data-product-scale className="h-screen flex flex-col bg-[hsl(var(--background))]">
      <header className="shrink-0 border-b border-[hsl(var(--border))] bg-[hsl(var(--card))]">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center gap-4">
          <h1 className="text-base font-semibold">Check your chatbot</h1>
          <span className="text-xs text-[hsl(var(--muted-foreground))]">
            {pass === 'predict'
              ? `First, what you expect — all ${state.length} questions.`
              : 'Now, what it actually said.'}
          </span>
          <div className="flex-1" />
          {/* The standard for "desirable" stays on screen for the whole block,
              not just on the intro card they pressed past. */}
          <span className="hidden xl:block text-2xs text-[hsl(var(--muted-foreground))]">
            No right answers — judge by your own teaching standards.
          </span>
          <div className="flex items-center gap-2">
            <div className="w-32 h-1.5 rounded bg-[hsl(var(--muted))] overflow-hidden">
              <div
                className="h-full bg-[hsl(var(--primary))] transition-all"
                style={{ width: `${(done / state.length) * 100}%` }}
              />
            </div>
            <span className="text-2xs tabular-nums text-[hsl(var(--muted-foreground))]">
              {done} / {state.length}
            </span>
          </div>
        </div>
      </header>

      {/* The studio's own frame — max-w-[1600px] and the same padding ramp
          (StudioShell). This screen is read straight after two blocks of it,
          and a participant should not feel the page get wider when the
          questions start. */}
      <main className="flex-1 min-h-0 max-w-[1600px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-4 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(17.5rem,22.5rem)_minmax(20.625rem,26.25rem)] gap-4">
        <section className="border border-[hsl(var(--border))] rounded-xl bg-[hsl(var(--card))] min-h-0 flex flex-col overflow-hidden">
          <div className="shrink-0 border-b border-[hsl(var(--border))] px-4 py-2.5">
            <span className="text-2xs font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
              {item ? `Question ${index + 1} of ${state.length}` : 'Done'}
            </span>
          </div>
          {/* Flex column, not a plain div: ChatMessages' root is
              `flex-1 overflow-y-auto` and owns the scroll, which only resolves
              against a flex parent with a definite height. As a block parent it
              grew to fit the thread instead, and the section's overflow-hidden
              clipped it — a long conversation simply could not be read. */}
          <div className="flex-1 min-h-0 flex flex-col">
            {item && (
              <ChatMessages
                // Remount per QUESTION only. It used to remount on reveal too,
                // which threw the thread away and rebuilt it scrolled to the
                // answer — so the question the answer is an answer to went off
                // the top of the pane at the exact moment it was needed.
                key={item.bankItemId}
                messages={messages}
                highlightedMessageId={revealed ? item.context.length + 1 : item.context.length}
                autoScrollToHighlight
                // Pass 1 aligns the question to the top; the reveal holds the
                // page still unless the answer runs off the bottom.
                highlightScroll={revealed ? 'if-needed' : 'align'}
                // Held still, the arrival needs saying: the new bubble blinks
                // twice as it lands.
                decorateMessage={
                  revealed
                    ? (m) =>
                        m.id === item.context.length + 1
                          ? { className: 'animate-reveal-flash rounded-2xl' }
                          : null
                    : undefined
                }
                // The thread opens ON the question, so what led to it is above
                // the fold. Left unsaid, the pane reads as "this is the whole
                // conversation", which is the one thing it is not — and a
                // prediction made without the turns that set the question up
                // is a prediction about a different question. The scrollbar
                // says so where the OS draws one; the count says so anywhere.
                persistentScrollbar
                showEarlierTurns
                enableCopy={false}
                renderUserContent={renderUserContent}
              />
            )}
          </div>
        </section>

        <aside className="border border-[hsl(var(--border))] rounded-xl bg-[hsl(var(--card))] overflow-hidden min-h-0">
          {/* Pointing happens IN the configuration, on the step that asks for
              it: an intent click in SCORE, a drag in Baseline. Disarmed at
              every other moment, so reading it cannot read as answering — and
              it stays readable all through Pass 2, because Q6 is answered by
              comparing the response against it. */}
          {/* Middle column: it is what both neighbours are compared against. */}
          <SnapshotConfigView
            config={config}
            // Null arrives on every click that collapses a selection; only a
            // real drag is an answer.
            onRulesSelection={
              pointingOpen && config.condition === 'baseline'
                ? (sel) => sel && addSpan(sel)
                : undefined
            }
            onClearHighlights={pointingOpen && spans.length > 0 ? clearSpans : undefined}
            // Pass 1 only: the marks are an answer being given, and leaving
            // them up through Pass 2 would put the participant's own pointing
            // back on screen beside the response — the anchoring §3.2 exists
            // to prevent.
            highlights={pointingOpen ? spans : recapSpans}
            highlightTone={pointingOpen ? 'active' : 'recap'}
            // Through the stopwatch, not around it: how long the pointing
            // took and how often it changed is the comprehension signal
            // (§6-7), and a pick that set the draft directly recorded neither.
            onIntentPick={
              pointingOpen && config.condition === 'score'
                ? (intentId) => patchDraftTimed({ pointing: { kind: 'intent', intentId } })
                : undefined
            }
            // Pass 1 marks the live draft; Pass 2 marks what they recorded,
            // so the row they chose stays labelled while they judge the answer
            // it produced.
            pickedIntentId={
              pass === 'predict'
                ? draft.pointing?.kind === 'intent'
                  ? draft.pointing.intentId
                  : null
                : item?.pointing?.kind === 'intent'
                  ? item.pointing.intentId
                  : null
            }
            onDefaultPick={
              pointingOpen && config.condition === 'score'
                ? () => patchDraftTimed({ pointing: { kind: 'none' } })
                : undefined
            }
            pickedDefault={
              pass === 'predict'
                ? draft.pointing?.kind === 'none'
                : item?.pointing?.kind === 'none'
            }
            // Released with the probe panel and never before it (§3.2): the
            // row that answered is the routing, and routing shown before the
            // judgements answers Q6 for them.
            answeredShown={!!item?.matched}
            answeredIntentId={item?.matched?.intentId ?? null}
          />
        </aside>

        <aside className="min-h-0 scrollbar-always pr-0.5 space-y-3">
          {finished ? (
            <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 text-center">
              <h2 className="text-lg font-semibold mb-1.5">All done</h2>
              <p className="text-sm text-[hsl(var(--muted-foreground))] mb-5">
                That is all the questions for this chatbot.
              </p>
              <PhaseAdvance from={phase} label="Continue" />
            </div>
          ) : item ? (
            <>
              <Steps total={state.length} index={index} pass={pass} />
              {pass === 'predict' ? (
                <PredictCard
                  condition={config.condition}
                  draft={draft}
                  pickedLabel={
                    draft.pointing?.kind === 'intent'
                      ? intentTitles.get(draft.pointing.intentId) ?? 'an intent'
                      : draft.pointing?.kind === 'none'
                        ? 'Uncategorized'
                        : null
                  }
                  busy={busy}
                  onChange={patchDraftTimed}
                  onNext={submitPrediction}
                />
              ) : (
                <JudgeCard
                  item={item}
                  condition={config.condition}
                  revealed={revealed}
                  probe={probe}
                  repair={repair}
                  busy={busy}
                  last={index === state.length - 1}
                  onReveal={reveal}
                  onProbe={setProbe}
                  onRepair={setRepair}
                  onJudge={submitJudgement}
                  onNext={submitProbe}
                />
              )}
            </>
          ) : null}

          {error && (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
              {error}
            </p>
          )}
          {busy && (
            <p className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
              <Loader2 className="w-3 h-3 animate-spin" /> Saving…
            </p>
          )}
        </aside>
      </main>

      {intro && <BlockIntro count={state.length} onClose={() => setIntro(false)} />}
      {bridge && <PassBridge count={state.length} onClose={() => setBridge(false)} />}
    </div>
  );
}

/** Where they are in the block — a position, not a scrollback to edit. */
function Steps({ total, index, pass }: { total: number; index: number; pass: Pass }) {
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          title={`Question ${i + 1}`}
          className={`h-1.5 flex-1 rounded-full ${
            i < index
              ? 'bg-[hsl(var(--primary))]'
              : i === index
                ? 'bg-[hsl(var(--primary))]/45'
                : 'bg-[hsl(var(--muted))]'
          }`}
        />
      ))}
      <span className="ml-1.5 text-2xs font-semibold text-[hsl(var(--muted-foreground))] tabular-nums">
        {pass === 'predict' ? 'predict' : 'review'} {index + 1}/{total}
      </span>
    </div>
  );
}

/**
 * The block's one instruction (§4 block intro).
 *
 * Two of the six questions ask whether a response is "educationally
 * desirable", and that phrase has an obvious wrong reading: desirable by
 * whose lights? Left unsaid, a participant answers against an imagined rubric
 * — the study's, their department's — and the D axis stops being theirs. It is
 * said once, plainly, before the first question.
 */
function BlockIntro({ count, onClose }: { count: number; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-6">
      <div className="w-full max-w-md rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-7 text-center shadow-xl">
        <h2 className="text-lg font-semibold mb-3">There are no right answers here</h2>
        <p className="text-base text-[hsl(var(--muted-foreground))] mb-3 leading-relaxed">
          Judge everything by your own teaching standards.
        </p>
        <p className="text-sm text-[hsl(var(--muted-foreground))] mb-6 leading-relaxed">
          You will go through {count} student questions twice: first saying what you expect, then
          seeing what your chatbot actually said.
        </p>
        <button
          onClick={onClose}
          className="rounded-lg bg-[hsl(var(--primary))] px-6 py-3 text-base font-semibold text-white"
        >
          Start
        </button>
      </div>
    </div>
  );
}

/**
 * The beat between the passes.
 *
 * Every answer becoming available at once, unannounced, would read as the
 * screen having broken. It is also where "now let's see what it actually says"
 * belongs, so the screen holds for it rather than running on.
 */
function PassBridge({ count, onClose }: { count: number; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-6">
      <div className="w-full max-w-md rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-7 text-center shadow-xl">
        <h2 className="text-lg font-semibold mb-2">That is all {count} predictions</h2>
        <p className="text-base text-[hsl(var(--muted-foreground))] mb-6 leading-relaxed">
          Now you will go back through the same questions and see what your chatbot actually
          said.
        </p>
        <button
          onClick={onClose}
          className="rounded-lg bg-[hsl(var(--primary))] px-6 py-3 text-base font-semibold text-white"
        >
          See the answers
        </button>
      </div>
    </div>
  );
}

/** The 6-point agreement scale as a control (§3.3). */
function Agree6({
  value,
  disabled,
  onPick,
}: {
  value: number | null;
  disabled?: boolean;
  onPick: (n: number) => void;
}) {
  return (
    <div>
      <div className="flex gap-1">
        {SCALE.map((n) => (
          <button
            key={n}
            onClick={() => onPick(n)}
            disabled={disabled}
            // The words, not just the number: a 6-point scale with bare
            // endpoints makes 3 and 4 look like "slightly less" and "slightly
            // more" of nothing, and those two are exactly where the fold is.
            title={AGREE[n - 1]}
            className={`flex-1 rounded-lg border py-2.5 text-sm font-semibold disabled:opacity-50 ${
              value === n
                ? 'bg-[hsl(var(--primary))] border-[hsl(var(--primary))] text-white'
                : 'border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]'
            }`}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="flex justify-between mt-1.5 text-2xs text-[hsl(var(--muted-foreground))]">
        <span>{AGREE[0]}</span>
        <span>{AGREE[AGREE.length - 1]}</span>
      </div>
    </div>
  );
}

/**
 * §4 Pass 1 — Q1 ideal, Q2 pointing, Q3 confidence, Q4 expected desirability.
 *
 * THE ORDER IS THE FUNNEL, AND Q1 IS FIRST ON PURPOSE. The configuration is on
 * screen the whole time, so a "what will it do" question asked after the
 * pointing gets answered by reading the rule back — which is what the pilot's
 * version measured. Q1 asks something the configuration cannot answer: what a
 * good reply WOULD be, by their standards. That has to be said before they go
 * looking at what they wrote, or Desire collapses into Expectation (§4 Q1).
 * Then: where will it come from → can I anticipate it → will it be any good.
 *
 * The order is the layout only; nothing is disabled. A participant who wants to
 * point first still can.
 *
 * Nothing is sent until Next, and Next needs all four. Holding them locally
 * means a participant can still change their mind while they think, which
 * costs nothing here: no answer has been shown, so a second thought is made
 * with exactly the information the first one had.
 */
function PredictCard({
  condition,
  draft,
  pickedLabel,
  busy,
  onChange,
  onNext,
}: {
  condition: 'score' | 'baseline';
  draft: Draft;
  /** SCORE: the name of what they picked, or null before they have. */
  pickedLabel: string | null;
  busy: boolean;
  onChange: (patch: Partial<Draft>) => void;
  onNext: () => void;
}) {
  const pointing = draft.pointing;
  const spans = pointing?.kind === 'span' ? pointing.spans : [];
  const choice = (on: boolean) =>
    `w-full rounded-lg border py-2.5 px-3 text-xs font-semibold disabled:opacity-50 ${
      on
        ? 'bg-[hsl(var(--primary))] border-[hsl(var(--primary))] text-white'
        : 'border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]'
    }`;

  return (
    <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 space-y-4">
      <div>
        <label className="block text-sm font-semibold mb-1.5" htmlFor="ideal">
          How should the chatbot <em>ideally</em> respond to this question? (a phrase is fine)
        </label>
        <textarea
          id="ideal"
          rows={3}
          value={draft.ideal}
          onChange={(e) => onChange({ ideal: e.target.value })}
          placeholder={'e.g., "point to the assignment criteria, don’t rewrite it"'}
          className="w-full rounded-lg border border-[hsl(var(--border))] px-3 py-2 text-sm leading-snug resize-none focus:outline-none focus:border-[hsl(var(--primary))]"
        />
      </div>

      <div className="border-t border-[hsl(var(--border))] pt-3">
        <p className="text-sm font-semibold mb-1">
          {condition === 'baseline'
            ? 'Which part of your prompt addresses this question?'
            : 'Which of your intents will handle this question?'}
        </p>
        {/* Named, not pointed at. The panel says "Your rules" or "Your setup"
            at its own top, and a direction in the copy is one layout change
            away from sending someone the wrong way. */}
        <p className="text-2xs text-[hsl(var(--muted-foreground))] mb-2">
          {condition === 'baseline'
            ? 'Drag across it in “Your rules” — mark as many places as you need.'
            : 'Click it in “Your setup” — including Uncategorized, if none of them do.'}
        </p>

        {/* The name, not "you have selected something". A confirmation that
            does not say WHAT was confirmed sends them back to the panel to
            check — and the panel is already showing it, so the card's job is
            to say the same word out loud. */}
        {condition === 'score' && pickedLabel && (
          <p className="mb-2 rounded-lg border border-[hsl(var(--primary))]/40 bg-[hsl(var(--primary))]/5 px-2.5 py-1.5 text-xs">
            <span className="text-[hsl(var(--muted-foreground))]">Picked: </span>
            <span className="font-semibold">{pickedLabel}</span>
          </p>
        )}

        {/* AS MANY AS THEY LIKE, and the document says so rather than this
            card: the marks are in the text, and the count and the Clear are in
            that panel's own header. What is left here is the same one-line
            confirmation SCORE gets from "Picked: …" — the card should be able
            to answer "have I answered this?" without the reader looking away
            from it. */}
        {condition === 'baseline' && spans.length > 0 && (
          <p className="mb-2 rounded-lg border border-[hsl(var(--primary))]/40 bg-[hsl(var(--primary))]/5 px-2.5 py-1.5 text-xs">
            <span className="text-[hsl(var(--muted-foreground))]">Marked: </span>
            <span className="font-semibold">
              {spans.length === 1 ? '1 part' : `${spans.length} parts`}
            </span>
            <span className="text-[hsl(var(--muted-foreground))]"> of &ldquo;Your rules&rdquo;</span>
          </p>
        )}

        {/* SCORE HAS NO "NONE" BUTTON. It used to read "None — it will fall to
            the default rule", and neither half of that sentence is a thing the
            participant has seen: the simple studio has no "default rule", it
            has a row called Uncategorized at the bottom of the list, which is
            where a question with no owner arrives. So the answer is that row,
            clicked where it lives — and a button describing it in other words
            would be a second name for it. Baseline keeps its button, because a
            prompt has no row to click for "nothing here addresses this". */}
        <div className="space-y-1.5">
          {condition === 'baseline' && (
            <button
              onClick={() => onChange({ pointing: { kind: 'nothing' } })}
              disabled={busy}
              className={choice(pointing?.kind === 'nothing')}
            >
              Nothing in particular
            </button>
          )}
          {/* Not a midpoint on a scale but its own answer: not knowing and
              being in two minds are different states, and how often this is
              pressed is itself the coverage-awareness measure (§4 Q2). */}
          <button
            onClick={() => onChange({ pointing: { kind: 'not_sure' } })}
            disabled={busy}
            className={choice(pointing?.kind === 'not_sure')}
          >
            I don&rsquo;t know
          </button>
        </div>
      </div>

      <div className="border-t border-[hsl(var(--border))] pt-3">
        <p className="text-sm font-semibold mb-2">
          I can anticipate how the chatbot will respond to this question.
        </p>
        <Agree6
          value={draft.confidence}
          disabled={busy}
          onPick={(n) => onChange({ confidence: n })}
        />
      </div>

      <div className="border-t border-[hsl(var(--border))] pt-3">
        <p className="text-sm font-semibold mb-2">
          The chatbot&rsquo;s response will be educationally desirable.
        </p>
        <Agree6
          value={draft.expectDesirable}
          disabled={busy}
          onPick={(n) => onChange({ expectDesirable: n })}
        />
      </div>

      <div>
        <button
          onClick={onNext}
          disabled={busy || !draftComplete(draft)}
          className="w-full rounded-lg bg-[hsl(var(--primary))] py-2.5 text-sm font-semibold text-white disabled:opacity-40"
        >
          Next
        </button>
        {!draftComplete(draft) && (
          <p className="mt-1.5 text-2xs text-center text-[hsl(var(--muted-foreground))]">
            Answer all four to continue.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * §4 Pass 2 — reveal, judge twice, and only then the probe.
 *
 * WHAT IS ON SCREEN WHEN. The response alone, then Q5, then Q6, then — if
 * either judgement is negative — the panel that carries the recap of their own
 * prediction, the Matched chip, the probe, and the repair. Q6 arrives after Q5
 * is answered rather than beside it, because §6-2 makes the order part of the
 * instrument and a card that shows both invites answering the easier one first.
 *
 * The recap is deliberately NOT at the top. It was, in v1-v3, and that put a
 * participant's own "this will be desirable: 5/6" in front of them moments
 * before asking whether it WAS — which drags Q5 towards Q4 and quietly shrinks
 * the |Q4 − Q5| error that RQ2 rests on. Here it appears where it is needed,
 * beside a probe that asks them to explain a prediction made six questions ago.
 */
function JudgeCard({
  item,
  condition,
  revealed,
  probe,
  repair,
  busy,
  last,
  onReveal,
  onProbe,
  onRepair,
  onJudge,
  onNext,
}: {
  item: TestItem;
  condition: 'score' | 'baseline';
  revealed: boolean;
  probe: string;
  repair: string;
  busy: boolean;
  last: boolean;
  onReveal: () => void;
  onProbe: (v: string) => void;
  onRepair: (v: string) => void;
  onJudge: (field: 'desirable' | 'follows', value: number) => void;
  onNext: () => void;
}) {
  const judged = item.desirable !== null && item.follows !== null;
  const probeOpen = judged && (isNegative(item.desirable) || isNegative(item.follows));

  return (
    <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 space-y-4">
      {!revealed ? (
        <button
          onClick={onReveal}
          className="w-full rounded-lg bg-[hsl(var(--primary))] py-2.5 text-sm font-semibold text-white"
        >
          Show the actual response
        </button>
      ) : (
        <>
          <div>
            <p className="text-sm font-semibold mb-2">
              The chatbot&rsquo;s response is educationally desirable.
            </p>
            <Agree6
              value={item.desirable}
              disabled={busy}
              onPick={(n) => onJudge('desirable', n)}
            />
          </div>

          {item.desirable !== null && (
            <div className="border-t border-[hsl(var(--border))] pt-3">
              <p className="text-sm font-semibold mb-2">
                The chatbot&rsquo;s response follows what I set up.
              </p>
              {/* Said out loud, because the reference point is the whole
                  measurement: Q6 is answered against the configuration on the
                  left, not against a memory of what they predicted. */}
              <p className="text-2xs text-[hsl(var(--muted-foreground))] mb-2">
                Compare it with &ldquo;Your setup&rdquo;.
              </p>
              <Agree6 value={item.follows} disabled={busy} onPick={(n) => onJudge('follows', n)} />
            </div>
          )}

          {probeOpen && (
            <ProbePanel
              item={item}
              condition={condition}
              probe={probe}
              repair={repair}
              onProbe={onProbe}
              onRepair={onRepair}
            />
          )}

          {judged && (
            <button
              onClick={onNext}
              disabled={busy}
              className="w-full rounded-lg bg-[hsl(var(--primary))] py-2.5 text-sm font-semibold text-white disabled:opacity-40"
            >
              {last ? 'Finish' : 'Next'}
            </button>
          )}
        </>
      )}
    </div>
  );
}

/**
 * §4 ③ — the recap, the Matched chip, the probe, and the repair.
 *
 * Opens at Q5 ≤ 3 OR Q6 ≤ 3, and everything in it arrives at once. The chip
 * is here and nowhere earlier for two reasons: before the judgements it
 * answers Q6 for them, and here it hands them a diagnosis to work from without
 * putting words in their mouth — the probe stays an open box, so "the
 * definition didn't catch it" is their sentence or nobody's (§7).
 */
function ProbePanel({
  item,
  condition,
  probe,
  repair,
  onProbe,
  onRepair,
}: {
  item: TestItem;
  condition: 'score' | 'baseline';
  probe: string;
  repair: string;
  onProbe: (v: string) => void;
  onRepair: (v: string) => void;
}) {
  return (
    <div className="border-t border-[hsl(var(--border))] pt-3 space-y-3">
      <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/50 px-3 py-2.5 space-y-2.5">
        <p className="text-2xs font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
          What you expected
        </p>

        {item.ideal && (
          <div>
            <p className="text-2xs font-semibold text-[hsl(var(--muted-foreground))] mb-1">
              How it should ideally respond
            </p>
            {/* The box they typed it in, locked. A quotation mark makes their
                own sentence read as something being cited back at them; the
                field makes it read as the answer they gave — same as the
                scales under it, which are the controls that took theirs. */}
            <p className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-sm leading-snug">
              {item.ideal}
            </p>
          </div>
        )}

        {/* WHERE IT WOULD COME FROM IS NOT REPEATED HERE. It is drawn on the
            configuration itself — the row they picked and the row that
            answered each carry a badge — because the answer to "did it go
            where I thought" is a place, and a place is best given as a place.
            This line only says where to look. */}
        <p className="text-2xs leading-snug text-[hsl(var(--muted-foreground))]">
          {condition === 'baseline'
            ? 'What you marked is back in “Your rules”, in the reply’s colour.'
            : 'Your pick — and where the reply came from — are marked in “Your setup”.'}
        </p>

        {item.confidence !== null && (
          <ScaleRecap
            caption="You could anticipate it"
            rows={[{ label: 'Then', value: item.confidence }]}
          />
        )}

        {/* THE PAIR, ON ONE GRID. Q4 and Q5 are the same sentence in two
            tenses, so the distance between them IS the prediction error — and
            two numbers in prose ("expected 4/6 · judged 3/6") make the reader
            do the subtraction. Stacked on the same six columns, the gap is the
            thing you see first. */}
        {item.expectDesirable !== null && item.desirable !== null && (
          <ScaleRecap
            caption="Educationally desirable"
            rows={[
              { label: 'Then', value: item.expectDesirable },
              { label: 'Now', value: item.desirable, now: true },
            ]}
          />
        )}
      </div>

      <div>
        <label className="block text-sm font-semibold mb-1.5" htmlFor="probe">
          {probeQuestion(item.desirable, item.follows)}
        </label>
        <textarea
          id="probe"
          rows={3}
          value={probe}
          onChange={(e) => onProbe(e.target.value)}
          // Kept cheap on purpose: if a negative rating reliably costs a
          // paragraph, ratings learn to drift above the fold (§10-5).
          placeholder="a few words are fine"
          className="w-full rounded-lg border border-[hsl(var(--border))] px-3 py-2 text-sm leading-snug resize-none focus:outline-none focus:border-[hsl(var(--primary))]"
        />
      </div>

      {/* F — only where the response was NOT desirable. Nothing needs fixing
          where it was, however far it strayed from the setup. */}
      {isNegative(item.desirable) && (
        <div>
          <label className="block text-sm font-semibold mb-1.5" htmlFor="repair">
            What would you change in your setup to fix this?
          </label>
          <textarea
            id="repair"
            rows={3}
            value={repair}
            onChange={(e) => onRepair(e.target.value)}
            placeholder="a few words are fine"
            className="w-full rounded-lg border border-[hsl(var(--border))] px-3 py-2 text-sm leading-snug resize-none focus:outline-none focus:border-[hsl(var(--primary))]"
          />
        </div>
      )}
    </div>
  );
}

/**
 * An answer already given, drawn on the control that took it.
 *
 * The recap used to be prose — "You could anticipate it: 3/6" — which asks the
 * reader to rebuild a scale in their head to know what 3 meant. Here it is the
 * scale, with their mark on it, unclickable. Two rows share one grid so a pair
 * of answers can be compared by looking rather than by subtracting.
 */
function ScaleRecap({
  caption,
  rows,
}: {
  caption: string;
  rows: { label: string; value: number; now?: boolean }[];
}) {
  return (
    <div>
      {/* No "2 steps apart". The rows are stacked on one grid precisely so the
          distance is seen rather than read, and a number beside them turns a
          glance back into arithmetic — a smaller version of the prose this
          replaced. */}
      <p className="text-2xs font-semibold text-[hsl(var(--muted-foreground))] mb-1">{caption}</p>
      <div className="space-y-1">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-2xs text-[hsl(var(--muted-foreground))]">
              {row.label}
            </span>
            <div className="flex-1 flex gap-1" aria-label={`${row.label}: ${row.value} of 6`}>
              {SCALE.map((n) => (
                <span
                  key={n}
                  className={`flex-1 rounded text-center text-2xs font-semibold leading-5 ${
                    row.value === n
                      ? row.now
                        ? 'bg-[hsl(var(--primary))] text-white'
                        : 'bg-[hsl(var(--primary))]/25 text-[hsl(var(--foreground))]'
                      : 'bg-[hsl(var(--muted))] text-transparent'
                  }`}
                >
                  {n}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The probe's wording, by the cell of the execution quadrant it lands in
 * (§4 P).
 *
 * Three cells, three questions, and the third is why this is not one box with
 * one label: where the response followed the setup and was still undesirable,
 * "what went wrong" is the wrong question — nothing went wrong mechanically,
 * the setup said what they meant it to say and they do not like the result.
 * Asking it that way is what makes C5 (a wrong model of one's own rule)
 * reportable at all.
 */
function probeQuestion(desirable: number | null, follows: number | null): string {
  const desirableBad = isNegative(desirable);
  const followsBad = isNegative(follows);
  if (followsBad && desirableBad) {
    return 'What happened here — what’s wrong, and where did it depart from your setup?';
  }
  if (followsBad) return 'How did this differ from what you set up?';
  return 'What’s wrong with this response?';
}

/*
 * `pointedLabel` used to live here, turning a pointing into a phrase for the
 * Pass 2 recap ("You expected Complete Text to handle it"). The recap does not
 * say it in words any more — the pick is a badge on the row itself, and the
 * highlighted stretches are marked back into the document — so there is
 * nothing left to phrase.
 */

/*
 * `clip` used to shorten a highlighted stretch for the card, which quoted
 * every mark back at the participant. The marks are in the document now and
 * the card carries a count, so nothing here quotes anything.
 */

/**
 * One list of stretches, in document order, with overlaps folded together.
 *
 * Two drags that touch are one place in the document, not two, and leaving
 * them separate would double-tint the words they share and count a single
 * pointing twice in the analysis.
 */
function mergeSpans(spans: PointedSpan[]): PointedSpan[] {
  return spans
    .slice()
    .sort((a, b) => a.start - b.start)
    .reduce<PointedSpan[]>((out, span) => {
      const last = out[out.length - 1];
      if (last && span.start <= last.end) {
        if (span.end > last.end) {
          // Extend, and re-quote from the longer of the two so the stored text
          // is what the merged range actually covers.
          last.text =
            span.start <= last.start ? span.text : last.text + span.text.slice(last.end - span.start);
          last.end = span.end;
        }
        return out;
      }
      out.push({ ...span });
      return out;
    }, []);
}

/**
 * Make an imported turn's single newlines survive markdown.
 *
 * CommonMark joins lines separated by one newline into a paragraph, which
 * turns a numbered list a chatbot wrote in 2025 into a wall of text. Two
 * trailing spaces are the markdown way to say "break here", so the breaks the
 * student actually saw are the breaks the participant sees.
 */
function hardBreaks(text: string): string {
  return text.replace(/([^\n])\n(?!\n)/g, '$1  \n');
}
