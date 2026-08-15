'use client';

/**
 * The block test, in two passes over the same eight questions (design v2 §5).
 *
 * PASS 1 predicts all eight — the yes/no, then the point at the part of the
 * configuration expected to act — and shows no answers at all. PASS 2 walks the
 * same eight again, revealing each answer and taking the 1-5 rating.
 *
 * Splitting the passes is the whole point. Revealing per question let the first
 * answers teach the participant what this configuration does, and they carried
 * that into every prediction after it — so the last questions measured someone
 * who had been shown worked examples and the first ones did not. Predictions
 * have to be made under the same information, so all of them come first. The
 * client does not decide this: the server releases nothing until the last
 * prediction lands (measure-store).
 *
 * Three columns, which is the other half of the same idea. The configuration
 * stays open on the left the whole time — this measures whether an instructor
 * can READ their own setup and foresee what it does, not whether they memorised
 * it, so hiding it would measure recall instead. The conversation sits in the
 * middle in the SAME chat component the students and the SCORE board use, so
 * the thing being predicted about looks like what it is. The questions stack on
 * the right with the answered ones still legible, so a participant can see what
 * they already said instead of holding eight predictions in their head.
 *
 * The spoken halves of the step (describe the expected answer, and the probe
 * afterwards) are the facilitator's, from the questionnaire; this screen holds
 * only what has to be recorded.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2, Lock } from 'lucide-react';
import ChatMessages, { type Message } from '@/components/chat/ChatMessages';
import PhaseAdvance from '@/components/study/PhaseAdvance';
import SnapshotConfigView, {
  pickerOrder,
  TYPE_DOT,
  TYPE_LABEL,
  type PickerEntry,
  type RulesSelection,
  type SnapshotConfig,
} from '@/components/study/SnapshotConfigView';
import type { Pointing, TestItem } from '@/lib/study/measure-store';

type Pass = 'predict' | 'rate';

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
   * just generated, and showing that one verbatim puts literal `##` and `**`
   * in front of the participant — in the one message the measurement is about.
   * So the breaks are repaired on the imported turns instead and everything
   * renders as markdown.
   */
  legacyLineBreaks?: boolean;
}) {
  const [state, setState] = useState(items);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Baseline: the live drag, before it is confirmed as the answer. */
  const [selection, setSelection] = useState<RulesSelection | null>(null);
  /** The one-time beat between the passes, so the reveal is announced. */
  const [bridge, setBridge] = useState(false);

  const predicted = state.filter((i) => i.guess !== null && i.pointing !== null).length;
  const rated = state.filter((i) => i.rating !== null).length;
  const pass: Pass = predicted === state.length ? 'rate' : 'predict';

  /** The only answerable question. -1 once this pass is done. */
  const cursor =
    pass === 'predict'
      ? state.findIndex((i) => i.guess === null || i.pointing === null)
      : state.findIndex((i) => i.rating === null);

  const [index, setIndex] = useState(() => Math.max(0, cursor));
  const item = state[index];
  const finished = rated === state.length;

  // Follow the cursor, but never yank the view off a question the participant
  // opened themselves — only when the cursor actually moves on.
  const lastCursor = useRef(cursor);
  useEffect(() => {
    if (cursor !== lastCursor.current) {
      lastCursor.current = cursor;
      if (cursor >= 0) setIndex(cursor);
    }
  }, [cursor]);

  const pointable = useMemo(() => pickerOrder(config.intents), [config.intents]);
  const titleById = useMemo(
    () => new Map(pointable.map((e) => [e.intent.id, e.intent.title])),
    [pointable]
  );

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

  const submitGuess = async (guess: boolean) => {
    const data = await post({ action: 'guess', bankItemId: item.bankItemId, guess });
    if (!data) return;
    setState((prev) => prev.map((i) => (i.bankItemId === item.bankItemId ? { ...i, guess } : i)));
  };

  const submitPointing = async (pointing: Pointing) => {
    const data = await post({ action: 'pointing', bankItemId: item.bankItemId, pointing });
    if (!data) return;
    setSelection(null);
    // The last prediction unlocks every answer at once, and the server sends
    // them back with it — take that list whole rather than patching one item,
    // so the pass never flips before the responses are actually in hand.
    if (data.revealed && Array.isArray(data.items)) {
      setState(data.items as TestItem[]);
      setIndex(0);
      setBridge(true);
      return;
    }
    setState((prev) =>
      prev.map((i) => (i.bankItemId === item.bankItemId ? { ...i, pointing } : i))
    );
  };

  const submitRating = async (rating: number) => {
    const data = await post({ action: 'rating', bankItemId: item.bankItemId, rating });
    if (!data) return;
    setState((prev) => prev.map((i) => (i.bankItemId === item.bankItemId ? { ...i, rating } : i)));
  };

  const messages: Message[] = useMemo(() => {
    if (!item) return [];
    const turns: Message[] = item.context.map((t, i) => ({
      id: i,
      role: t.role,
      content: legacyLineBreaks && t.role === 'assistant' ? hardBreaks(t.content) : t.content,
    }));
    turns.push({ id: item.context.length, role: 'user', content: item.question });
    if (item.response !== null) {
      turns.push({ id: item.context.length + 1, role: 'assistant', content: item.response });
    }
    return turns;
  }, [item, legacyLineBreaks]);

  // Baseline points by dragging, and only on the step that asks for it — an
  // idle text selection at any other moment must not read as an answer.
  const armDrag =
    config.condition === 'baseline' &&
    pass === 'predict' &&
    index === cursor &&
    item?.guess !== null &&
    item?.pointing === null;

  return (
    <div className="h-screen flex flex-col bg-[hsl(var(--background))]">
      <header className="shrink-0 border-b border-[hsl(var(--border))] bg-[hsl(var(--card))]">
        <div className="max-w-[1800px] mx-auto px-6 py-3 flex items-center gap-4">
          <h1 className="text-sm font-semibold">Check your chatbot</h1>
          <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
            {pass === 'predict'
              ? 'First, what you expect — all eight questions.'
              : 'Now, what it actually said.'}
          </span>
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <div className="w-32 h-1.5 rounded bg-[hsl(var(--muted))] overflow-hidden">
              <div
                className="h-full bg-[hsl(var(--primary))] transition-all"
                style={{
                  width: `${((pass === 'predict' ? predicted : rated) / state.length) * 100}%`,
                }}
              />
            </div>
            <span className="text-[11px] tabular-nums text-[hsl(var(--muted-foreground))]">
              {pass === 'predict' ? predicted : rated} / {state.length}
            </span>
          </div>
        </div>
      </header>

      <main className="flex-1 min-h-0 max-w-[1800px] w-full mx-auto px-6 py-4 grid grid-cols-1 lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)_minmax(320px,400px)] gap-4">
        <aside className="border border-[hsl(var(--border))] rounded-xl bg-[hsl(var(--card))] overflow-hidden min-h-0">
          <SnapshotConfigView config={config} onRulesSelection={armDrag ? setSelection : undefined} />
        </aside>

        <section className="border border-[hsl(var(--border))] rounded-xl bg-[hsl(var(--card))] min-h-0 flex flex-col overflow-hidden">
          <div className="shrink-0 border-b border-[hsl(var(--border))] px-4 py-2.5 flex items-center gap-2">
            <span className="text-[10.5px] font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
              Question {index + 1} of {state.length}
            </span>
            {item?.response !== null && item !== undefined && (
              <span className="text-[10.5px] font-semibold text-emerald-700">· answered</span>
            )}
          </div>
          {/* Flex column, not a plain div: ChatMessages' root is
              `flex-1 overflow-y-auto` and owns the scroll, which only resolves
              against a flex parent with a definite height. As a block parent it
              grew to fit the thread instead, and the section's overflow-hidden
              clipped it — a long conversation simply could not be read. */}
          <div className="flex-1 min-h-0 flex flex-col">
            {item && (
              <ChatMessages
                // Remount per question: this is a different conversation, not
                // an update to the current one, and the scroll must restart.
                key={item.bankItemId}
                messages={messages}
                highlightedMessageId={item.context.length}
                autoScrollToHighlight
                enableCopy={false}
              />
            )}
          </div>
        </section>

        <aside className="min-h-0 overflow-y-auto pr-0.5 space-y-2.5">
          {finished ? (
            <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 text-center">
              <h2 className="text-base font-semibold mb-1.5">All done</h2>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mb-5">
                That is all the questions for this chatbot.
              </p>
              <PhaseAdvance from={phase} label="Continue" />
            </div>
          ) : (
            state.map((it, i) => (
              <ItemCard
                key={it.bankItemId}
                item={it}
                number={i + 1}
                pass={pass}
                status={i === cursor ? 'active' : i < cursor || cursor === -1 ? 'answered' : 'locked'}
                open={i === index}
                busy={busy}
                condition={config.condition}
                pointable={pointable}
                titleById={titleById}
                selection={selection}
                onOpen={() => setIndex(i)}
                onGuess={submitGuess}
                onPointing={submitPointing}
                onRate={submitRating}
              />
            ))
          )}
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

      {bridge && <PassBridge count={state.length} onClose={() => setBridge(false)} />}
    </div>
  );
}

/**
 * The beat between the passes.
 *
 * Eight answers appearing at once, unannounced, would read as the screen having
 * broken. It is also where the facilitator's "let's see what it actually says"
 * belongs, so the screen holds for it rather than running on.
 */
function PassBridge({ count, onClose }: { count: number; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-6">
      <div className="w-full max-w-md rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-7 text-center shadow-xl">
        <h2 className="text-base font-semibold mb-2">That is all {count} predictions</h2>
        <p className="text-sm text-[hsl(var(--muted-foreground))] mb-6 leading-relaxed">
          Now you will go back through the same questions and see what your chatbot actually
          said.
        </p>
        <button
          onClick={onClose}
          className="rounded-lg bg-[hsl(var(--primary))] px-6 py-2.5 text-sm font-semibold text-white"
        >
          See the answers
        </button>
      </div>
    </div>
  );
}

type ItemStatus = 'active' | 'answered' | 'locked';

/**
 * One question in the rail.
 *
 * An answered card keeps its controls on screen and disabled rather than
 * collapsing to a tick: the participant is asked, later, why a prediction
 * missed, and "what did I say?" should not be part of the question.
 */
function ItemCard({
  item,
  number,
  pass,
  status,
  open,
  busy,
  condition,
  pointable,
  titleById,
  selection,
  onOpen,
  onGuess,
  onPointing,
  onRate,
}: {
  item: TestItem;
  number: number;
  pass: Pass;
  status: ItemStatus;
  open: boolean;
  busy: boolean;
  condition: 'score' | 'baseline';
  pointable: PickerEntry[];
  titleById: Map<number, string>;
  selection: RulesSelection | null;
  onOpen: () => void;
  onGuess: (guess: boolean) => void;
  onPointing: (pointing: Pointing) => void;
  onRate: (rating: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (status === 'active') ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [status]);

  if (status === 'locked') {
    return (
      <div className="rounded-xl border border-dashed border-[hsl(var(--border))] px-3.5 py-2.5 flex items-center gap-2 opacity-55">
        <Lock className="w-3 h-3 text-[hsl(var(--muted-foreground))]" />
        <span className="text-[11px] font-semibold text-[hsl(var(--muted-foreground))]">
          Question {number}
        </span>
      </div>
    );
  }

  const live = status === 'active';
  const complete = pass === 'predict' ? item.pointing !== null : item.rating !== null;

  return (
    <div
      ref={ref}
      className={`rounded-xl border bg-[hsl(var(--card))] ${
        open
          ? 'border-[hsl(var(--primary))]/40 ring-1 ring-[hsl(var(--primary))]/20'
          : 'border-[hsl(var(--border))]'
      }`}
    >
      <button
        onClick={onOpen}
        className="w-full text-left px-3.5 py-2.5 flex items-center gap-2 hover:bg-[hsl(var(--muted))]/50 rounded-t-xl"
      >
        <span className="text-[11px] font-semibold">Question {number}</span>
        {complete && <Check className="w-3 h-3 text-emerald-600" />}
        <span className="flex-1" />
        {!open && (
          <span className="text-[10px] text-[hsl(var(--muted-foreground))]">view</span>
        )}
      </button>

      <div className="px-3.5 pb-3.5 space-y-3">
        {pass === 'predict' ? (
          <>
            <GuessRow
              value={item.guess}
              live={live && item.guess === null}
              busy={busy}
              onGuess={onGuess}
            />
            {item.guess !== null && (
              <PointingRow
                condition={condition}
                pointing={item.pointing}
                live={live && item.pointing === null}
                busy={busy}
                pointable={pointable}
                titleById={titleById}
                selection={selection}
                onSubmit={onPointing}
              />
            )}
          </>
        ) : (
          <>
            <Recap guess={item.guess} pointing={item.pointing} titleById={titleById} />
            <RatingRow value={item.rating} live={live} busy={busy} onRate={onRate} />
          </>
        )}
      </div>
    </div>
  );
}

/** 문항지 §3 ① — the yes/no half of the prediction. */
function GuessRow({
  value,
  live,
  busy,
  onGuess,
}: {
  value: boolean | null;
  live: boolean;
  busy: boolean;
  onGuess: (guess: boolean) => void;
}) {
  return (
    <div>
      <p className={`text-[12.5px] font-semibold mb-2 ${live ? '' : 'opacity-60'}`}>
        Will your chatbot answer this the way you intend?
      </p>
      <div className="flex gap-2">
        {[true, false].map((yes) => (
          <button
            key={String(yes)}
            onClick={() => onGuess(yes)}
            disabled={!live || busy}
            className={`flex-1 rounded-lg border py-2 text-xs font-semibold disabled:cursor-default ${
              value === yes
                ? 'bg-[hsl(var(--primary))] border-[hsl(var(--primary))] text-white'
                : `border-[hsl(var(--border))] ${live ? 'hover:bg-[hsl(var(--muted))]' : 'opacity-45'}`
            }`}
          >
            {yes ? 'Yes' : 'No'}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * 문항지 §3 ① — the pointing half, in each condition's own vocabulary.
 *
 * SCORE points at an intent, which is a thing with an id — so the answer is
 * objectively scorable against the routing record afterwards. Baseline has no
 * such handle: the whole document answers everything, so it points by
 * highlighting, and the analysis codes the pattern rather than marking it
 * right. "Not sure" is a real answer in both and is offered as one.
 *
 * The intent list is in the panel's own order, headings and nesting included
 * (pickerOrder), because a participant reads it while looking at that panel —
 * any difference between the two is search work charged to the measurement.
 */
function PointingRow({
  condition,
  pointing,
  live,
  busy,
  pointable,
  titleById,
  selection,
  onSubmit,
}: {
  condition: 'score' | 'baseline';
  pointing: Pointing | null;
  live: boolean;
  busy: boolean;
  pointable: PickerEntry[];
  titleById: Map<number, string>;
  selection: RulesSelection | null;
  onSubmit: (pointing: Pointing) => void;
}) {
  const question =
    condition === 'baseline'
      ? 'Which part of your Rules document do you expect to shape the response — if any?'
      : 'Which intent do you expect this question to fall under — if any?';
  const secondary = (on: boolean) =>
    `flex-1 rounded-lg border border-[hsl(var(--border))] py-2 text-[11px] font-semibold disabled:cursor-default ${
      on
        ? 'bg-[hsl(var(--primary))] border-[hsl(var(--primary))] text-white'
        : live
          ? 'hover:bg-[hsl(var(--muted))]'
          : 'opacity-45'
    }`;

  return (
    <div className="border-t border-[hsl(var(--border))] pt-3">
      <p className={`text-[12.5px] font-semibold mb-2 ${live ? '' : 'opacity-60'}`}>{question}</p>

      {condition === 'baseline' ? (
        <>
          {live && (
            <p className="text-[11px] text-[hsl(var(--muted-foreground))] mb-2">
              Drag across that part on the left to highlight it, then confirm.
            </p>
          )}
          {pointing?.kind === 'span' ? (
            <p className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11.5px] leading-relaxed text-amber-900">
              “{clip(pointing.text)}”
            </p>
          ) : (
            live &&
            selection && (
              <p className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11.5px] leading-relaxed text-amber-900">
                “{clip(selection.text)}”
              </p>
            )
          )}
          {live && (
            <button
              onClick={() => selection && onSubmit({ kind: 'span', ...selection })}
              disabled={busy || !selection}
              className="w-full rounded-lg bg-[hsl(var(--primary))] py-2.5 text-xs font-semibold text-white disabled:opacity-40 mb-2"
            >
              {selection ? 'Confirm highlight' : 'Highlight a part on the left'}
            </button>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => onSubmit({ kind: 'nothing' })}
              disabled={!live || busy}
              className={secondary(pointing?.kind === 'nothing')}
            >
              Nothing specific
            </button>
            <button
              onClick={() => onSubmit({ kind: 'not_sure' })}
              disabled={!live || busy}
              className={secondary(pointing?.kind === 'not_sure')}
            >
              Not sure
            </button>
          </div>
        </>
      ) : (
        <>
          {/* Answered and not the chosen one: drop it, so a settled card stays
              short enough that the next question is still on screen. */}
          <div className="space-y-1 mb-2">
            {pointable
              .filter(
                (e) =>
                  live || (pointing?.kind === 'intent' && pointing.intentId === e.intent.id)
              )
              .map((e) => (
                <div key={e.intent.id}>
                  {live && e.startsType && (
                    <div className="flex items-center gap-1.5 px-1 pt-1.5 pb-1">
                      <span className={`w-1.5 h-1.5 rounded-full ${TYPE_DOT[e.type] ?? 'bg-slate-400'}`} />
                      <span className="text-[9.5px] font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                        {TYPE_LABEL[e.type] ?? e.type}
                      </span>
                    </div>
                  )}
                  <button
                    onClick={() => onSubmit({ kind: 'intent', intentId: e.intent.id })}
                    disabled={!live || busy}
                    style={{ marginLeft: live ? e.depth * 10 : 0 }}
                    className={`w-full text-left rounded-lg border px-2.5 py-1.5 disabled:cursor-default ${
                      pointing?.kind === 'intent' && pointing.intentId === e.intent.id
                        ? 'bg-[hsl(var(--primary))] border-[hsl(var(--primary))] text-white'
                        : `border-[hsl(var(--border))] ${live ? 'hover:bg-[hsl(var(--muted))]' : 'opacity-45'}`
                    }`}
                  >
                    <span className="text-[11px] font-semibold block">{e.intent.title}</span>
                    {/* Three lines, not one: real definitions average 250
                        characters and a single clipped line matches nothing a
                        participant can see in the panel. No `block` here — it
                        would win the cascade over the -webkit-box the clamp
                        needs, and the clamp would silently do nothing. */}
                    <span className="text-[10.5px] leading-snug opacity-75 line-clamp-3">
                      {e.intent.definition}
                    </span>
                  </button>
                </div>
              ))}
            {pointable.length === 0 && live && (
              <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
                You did not add any groups, so there is nothing for it to fall under.
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => onSubmit({ kind: 'none' })}
              disabled={!live || busy}
              className={secondary(pointing?.kind === 'none')}
            >
              None of them
            </button>
            <button
              onClick={() => onSubmit({ kind: 'not_sure' })}
              disabled={!live || busy}
              className={secondary(pointing?.kind === 'not_sure')}
            >
              Not sure
            </button>
          </div>
        </>
      )}

      {/* An answered SCORE card shows the title even when the list is gone. */}
      {!live && pointing?.kind === 'intent' && !titleById.has(pointing.intentId) && (
        <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
          Pointed at an intent that is no longer in your setup.
        </p>
      )}
    </div>
  );
}

/**
 * 문항지 §3 Pass 2 ② — the participant's own prediction, put back on screen.
 *
 * Pass 2 opens with the facilitator saying "here's what you expected: {guess}
 * — and you pointed to {pointing}", and the probe at ④ asks them to explain a
 * prediction they made minutes and seven questions ago. Two-pass buys clean
 * measurement by moving the reveal away from the prediction, and this is what
 * pays the cost back: the recall it needs is on the screen, not in their head.
 *
 * A record, not the controls again. The Pass 1 question reads in the future
 * tense and its buttons invite an answer; by Pass 2 the answer is fixed and
 * what matters is reading it at a glance off a shared screen.
 */
function Recap({
  guess,
  pointing,
  titleById,
}: {
  guess: boolean | null;
  pointing: Pointing | null;
  titleById: Map<number, string>;
}) {
  if (guess === null && pointing === null) return null;
  return (
    <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/60 px-3 py-2">
      <p className="text-[9.5px] font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))] mb-1">
        You expected
      </p>
      <p className="text-[12px] leading-snug">
        {guess === null ? '—' : guess ? 'Yes' : 'No'}
        {pointing && (
          <>
            <span className="text-[hsl(var(--muted-foreground))]">
              {' \u00b7 '}
              {pointing.kind === 'not_sure' ? '' : 'pointed to '}
            </span>
            <span className="font-semibold">{pointedLabel(pointing, titleById)}</span>
          </>
        )}
      </p>
    </div>
  );
}

/**
 * How a pointing reads back to the person who made it.
 *
 * Phrased as a sentence, not echoed as the button label: the facilitator says
 * this line out loud at Pass 2 ②, and "pointed to Not sure" is not a sentence.
 */
function pointedLabel(pointing: Pointing, titleById: Map<number, string>): string {
  switch (pointing.kind) {
    case 'intent':
      return titleById.get(pointing.intentId) ?? 'an intent no longer in your setup';
    case 'none':
      return 'none of your intents';
    case 'nothing':
      return 'nothing in particular';
    case 'not_sure':
      return 'not sure where it would come from';
    case 'span':
      return `\u201C${clip(pointing.text)}\u201D`;
  }
}

/** 문항지 §3 ③ — the 1-5 fit rating, taken only after the answer is on screen. */
function RatingRow({
  value,
  live,
  busy,
  onRate,
}: {
  value: number | null;
  live: boolean;
  busy: boolean;
  onRate: (rating: number) => void;
}) {
  return (
    <div className="border-t border-[hsl(var(--border))] pt-3">
      <p className={`text-[12.5px] font-semibold mb-2 ${live ? '' : 'opacity-60'}`}>
        How well does this response match what you intended?
      </p>
      <div className="flex gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            onClick={() => onRate(n)}
            disabled={!live || busy}
            className={`flex-1 rounded-lg border py-2 text-xs font-semibold disabled:cursor-default ${
              value === n
                ? 'bg-[hsl(var(--primary))] border-[hsl(var(--primary))] text-white'
                : `border-[hsl(var(--border))] ${live ? 'hover:bg-[hsl(var(--muted))]' : 'opacity-45'}`
            }`}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="flex justify-between mt-1.5 text-[9.5px] text-[hsl(var(--muted-foreground))]">
        <span>Not at all what I intended</span>
        <span>Exactly what I intended</span>
      </div>
    </div>
  );
}

function clip(text: string): string {
  return text.length > 240 ? `${text.slice(0, 240)}…` : text;
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
