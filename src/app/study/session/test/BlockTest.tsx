'use client';

/**
 * The block test, in two passes over the same eight questions (문항지 §3).
 *
 * PASS 1 predicts all eight — a point at the part of the configuration expected
 * to act, a written description, and a yes/no — and shows no answers at all.
 * PASS 2 walks the same eight again, revealing each answer, taking the 1-5
 * rating, and asking why wherever the prediction missed.
 *
 * Splitting the passes is the whole point. Revealing per question let the first
 * answers teach the participant what this configuration does, and they carried
 * that into every prediction after it — so the last questions measured someone
 * who had been shown worked examples and the first ones did not. Predictions
 * have to be made under the same information, so all of them come first. The
 * client does not decide this: the server releases nothing until the last
 * prediction lands (measure-store).
 *
 * EVERY ANSWER IS A UI INPUT (문항지 §3, 08-15). The description, "what's off"
 * and the probe used to be spoken and written down by the facilitator; they are
 * text boxes now, so the wording survives verbatim against a question id, Pass
 * 2 can replay the participant's own sentence rather than someone's summary of
 * it, and Pass 1 has no channel through which a hint about the answer could
 * leak. The facilitator watches and says nothing.
 *
 * Three columns: the configuration open on the left the whole time (this
 * measures whether an instructor can READ their own setup and foresee what it
 * does, not whether they memorised it), the conversation in the middle in the
 * SAME chat component the students and the SCORE board use, and this question's
 * inputs on the right. ONE question at a time — what has to survive the reveal
 * is the prediction for the question in front of them, which Pass 2 puts back
 * on screen, not a scrollback of the seven before it.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import ChatMessages, { type Message } from '@/components/chat/ChatMessages';
import { MaterialSegments, materialStyle } from '@/app/instructor/assignments/[id]/score/materials';
import PhaseAdvance from '@/components/study/PhaseAdvance';
import SnapshotConfigView, {
  type RulesSelection,
  type SnapshotConfig,
} from '@/components/study/SnapshotConfigView';
import { MATERIAL_LABELS, type MaterialKind, type MaterialSpan } from '@/lib/score/intents';
import type { Pointing, QuestionMaterials, TestItem } from '@/lib/study/measure-store';

type Pass = 'predict' | 'rate';

/** What Pass 1 holds for the current question before Next is pressed. */
interface Draft {
  expectation: string;
  guess: boolean | null;
  pointing: Pointing | null;
}

const EMPTY_DRAFT: Draft = { expectation: '', guess: null, pointing: null };

function draftComplete(d: Draft): boolean {
  return d.expectation.trim().length > 0 && d.guess !== null && d.pointing !== null;
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
  /** Baseline: the live drag, before it is confirmed into the draft. */
  const [selection, setSelection] = useState<RulesSelection | null>(null);
  /** The one-time screen between the passes. */
  const [bridge, setBridge] = useState(false);
  /** Pass 2: has this question's answer been opened yet? */
  const [revealed, setRevealed] = useState(false);
  const [whatsOff, setWhatsOff] = useState('');
  const [probe, setProbe] = useState('');

  const predicted = state.filter((i) => i.pointing !== null).length;
  const rated = state.filter((i) => i.rating !== null).length;
  const pass: Pass = predicted === state.length ? 'rate' : 'predict';

  /**
   * The one question in play.
   *
   * Pass 1 derives it — submitting the prediction IS Next, so the first
   * unpredicted question is always the right one. Pass 2 cannot: the rating is
   * not the end of the question, and deriving from "first unrated" moved the
   * screen on the instant a number was clicked, before the boxes that open
   * BECAUSE of that number could be answered. So Pass 2 holds a position and
   * only Next advances it, seeded from the first unrated question so a reload
   * lands where they were.
   */
  const firstUnrated = state.findIndex((i) => i.rating === null);
  const [reviewIndex, setReviewIndex] = useState<number | null>(null);
  const reviewAt = reviewIndex ?? (firstUnrated === -1 ? state.length : firstUnrated);
  // Pin it the moment Pass 2 opens. Left to derive from "first unrated" it
  // would keep tracking that value, so clicking a rating would still slide the
  // screen to the next question before the boxes that number opens are answered.
  useEffect(() => {
    if (pass === 'rate' && reviewIndex === null) {
      setReviewIndex(firstUnrated === -1 ? state.length : firstUnrated);
    }
  }, [pass, reviewIndex, firstUnrated, state.length]);
  const index = pass === 'predict' ? state.findIndex((i) => i.pointing === null) : reviewAt;
  const item = index >= 0 && index < state.length ? state[index] : undefined;
  const finished = pass === 'rate' && reviewAt >= state.length;

  // A new question starts empty, and Pass 2 starts closed. Keyed on the item so
  // a reveal cannot carry over to the next one.
  const shownId = useRef<number | null>(null);
  useEffect(() => {
    if (item && shownId.current !== item.bankItemId) {
      shownId.current = item.bankItemId;
      setDraft(EMPTY_DRAFT);
      setSelection(null);
      setRevealed(false);
      setWhatsOff('');
      setProbe('');
    }
  }, [item]);

  /**
   * Patch, not replace. Handing the card a whole new Draft made every control
   * read the draft from its own render, so two answers given inside one frame
   * — a fast Yes then Not sure — had the second overwrite the first and Next
   * stayed shut with no sign of why.
   */
  const patchDraft = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

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

  /** Pass 1 · Next — all three parts of the prediction go in one write. */
  const submitPrediction = async () => {
    if (!item || !draftComplete(draft)) return;
    const data = await post({
      action: 'predict',
      bankItemId: item.bankItemId,
      expectation: draft.expectation.trim(),
      guess: draft.guess,
      pointing: draft.pointing,
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
              expectation: draft.expectation.trim(),
              guess: draft.guess,
              pointing: draft.pointing,
            }
          : i
      )
    );
  };

  /** Pass 2 · the rating, carrying "what's off" when the rating opens it. */
  const submitRating = async (rating: number, off = whatsOff) => {
    if (!item) return;
    const data = await post({
      action: 'rating',
      bankItemId: item.bankItemId,
      rating,
      ...(rating <= 3 ? { whatsOff: off } : {}),
    });
    if (!data) return;
    setState((prev) =>
      prev.map((i) =>
        i.bankItemId === item.bankItemId
          ? {
              ...i,
              rating,
              whatsOff: rating <= 3 ? off.trim() || null : null,
              missed: !!data.missed,
            }
          : i
      )
    );
  };

  /** Pass 2 · Next — save the probe if there is one, then move on. */
  const submitProbe = async () => {
    if (!item) return;
    if (probe.trim() && item.missed) {
      const data = await post({ action: 'probe', bankItemId: item.bankItemId, probe });
      if (!data) return;
      setState((prev) =>
        prev.map((i) =>
          i.bankItemId === item.bankItemId ? { ...i, probe: probe.trim() } : i
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
    const kinds = [
      ...new Set(
        (found.materials?.length
          ? found.materials.map((r) => r.kind)
          : found.materialKinds) as MaterialKind[]
      ),
    ];
    return (
      <>
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
        {/* Revealed, the tint is the only thing marking a pasted run, and the
            kind is otherwise a tooltip — which nobody hovers with 50 seconds
            per question. This says the colours out loud, and only for the kinds
            actually in this message. */}
        {kinds.length > 0 && (
          <span className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10.5px] text-[hsl(var(--muted-foreground))]">
            <span className="font-semibold uppercase tracking-wide">Pasted in</span>
            {kinds.map((k) => (
              <span key={k} className="inline-flex items-center gap-1">
                <span className={`inline-block w-2.5 h-2.5 rounded-[2px] ${materialStyle(k).hl}`} />
                {MATERIAL_LABELS[k] ?? k}
              </span>
            ))}
          </span>
        )}
      </>
    );
  };

  // Named, not described: §3 ② puts the intent's own title back on screen.
  const intentTitles = useMemo(
    () => new Map((config.intents ?? []).map((i) => [i.id, i.title])),
    [config.intents]
  );

  const pointingOpen = pass === 'predict' && !!item;
  const done = pass === 'predict' ? predicted : rated;

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
                style={{ width: `${(done / state.length) * 100}%` }}
              />
            </div>
            <span className="text-[11px] tabular-nums text-[hsl(var(--muted-foreground))]">
              {done} / {state.length}
            </span>
          </div>
        </div>
      </header>

      <main className="flex-1 min-h-0 max-w-[1800px] w-full mx-auto px-6 py-4 grid grid-cols-1 lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)_minmax(330px,420px)] gap-4">
        <aside className="border border-[hsl(var(--border))] rounded-xl bg-[hsl(var(--card))] overflow-hidden min-h-0">
          {/* Pointing happens IN the configuration, on the step that asks for
              it: an intent click in SCORE, a drag in Baseline. Disarmed at
              every other moment, so reading it cannot read as answering. */}
          <SnapshotConfigView
            config={config}
            onRulesSelection={
              pointingOpen && config.condition === 'baseline' ? setSelection : undefined
            }
            onIntentPick={
              pointingOpen && config.condition === 'score'
                ? (intentId) => setDraft((d) => ({ ...d, pointing: { kind: 'intent', intentId } }))
                : undefined
            }
            pickedIntentId={draft.pointing?.kind === 'intent' ? draft.pointing.intentId : null}
          />
        </aside>

        <section className="border border-[hsl(var(--border))] rounded-xl bg-[hsl(var(--card))] min-h-0 flex flex-col overflow-hidden">
          <div className="shrink-0 border-b border-[hsl(var(--border))] px-4 py-2.5">
            <span className="text-[10.5px] font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
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
                // Remount per question AND per reveal: appending the answer is
                // a new thread to read, and the scroll should land on it.
                key={`${item.bankItemId}:${revealed}`}
                messages={messages}
                highlightedMessageId={revealed ? item.context.length + 1 : item.context.length}
                autoScrollToHighlight
                enableCopy={false}
                renderUserContent={renderUserContent}
              />
            )}
          </div>
        </section>

        <aside className="min-h-0 overflow-y-auto pr-0.5 space-y-3">
          {finished ? (
            <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 text-center">
              <h2 className="text-base font-semibold mb-1.5">All done</h2>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mb-5">
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
                  selection={selection}
                  busy={busy}
                  onChange={patchDraft}
                  onNext={submitPrediction}
                />
              ) : (
                <RateCard
                  item={item}
                  intentTitles={intentTitles}
                  revealed={revealed}
                  whatsOff={whatsOff}
                  probe={probe}
                  busy={busy}
                  last={index === state.length - 1}
                  onReveal={() => setRevealed(true)}
                  onWhatsOff={setWhatsOff}
                  onProbe={setProbe}
                  onRate={submitRating}
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

      {bridge && <PassBridge count={state.length} onClose={() => setBridge(false)} />}
    </div>
  );
}

/** Where they are in the eight — a position, not a scrollback to edit. */
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
      <span className="ml-1.5 text-[10px] font-semibold text-[hsl(var(--muted-foreground))] tabular-nums">
        {pass === 'predict' ? 'predict' : 'review'} {index + 1}/{total}
      </span>
    </div>
  );
}

/**
 * The beat between the passes.
 *
 * Eight answers becoming available at once, unannounced, would read as the
 * screen having broken. It is also where "now let's see what it actually says"
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

/**
 * 문항지 §3 Pass 1 — point, describe, guess, Next.
 *
 * POINTING COMES FIRST (08-18). It used to be last, and the pilot showed
 * participants reaching for it first anyway: they scrolled past the description
 * box, found the governing part of the configuration, and only then wrote what
 * they expected. That is the order the design's own mechanism runs in — the
 * claim under test is that an intent tree lets an instructor settle "which
 * intent does this fall under" locally instead of running the whole document in
 * their head (설계 v2 §3), so asking for the description first made them
 * predict with the mechanism switched off. Asking last also left the order to
 * the participant, and all three answers land in one write, so the trail could
 * not even say who had pointed first. The cost is that the description is now
 * cued by the pointing rather than free — written into 설계 v2 §2, where V3 is
 * defined.
 *
 * The order is the layout only; nothing is disabled. A participant who wants to
 * write first still can, and the point of the change is served by the order the
 * card reads in.
 *
 * Nothing is sent until Next, and Next needs all three. Holding them locally
 * means a participant can still change their mind while they think, which
 * costs nothing here: no answer has been shown, so a second thought is made
 * with exactly the information the first one had.
 */
function PredictCard({
  condition,
  draft,
  selection,
  busy,
  onChange,
  onNext,
}: {
  condition: 'score' | 'baseline';
  draft: Draft;
  selection: RulesSelection | null;
  busy: boolean;
  onChange: (patch: Partial<Draft>) => void;
  onNext: () => void;
}) {
  const pointing = draft.pointing;
  const choice = (on: boolean) =>
    `flex-1 rounded-lg border py-2 text-[11px] font-semibold disabled:opacity-50 ${
      on
        ? 'bg-[hsl(var(--primary))] border-[hsl(var(--primary))] text-white'
        : 'border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]'
    }`;

  return (
    <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 space-y-4">
      <div>
        <p className="text-[12.5px] font-semibold mb-1">
          {condition === 'baseline'
            ? 'Which part of your Rules document do you expect to shape the response — if any? Select it in the document.'
            : 'Which intent do you expect this question to fall under — if any?'}
        </p>
        <p className="text-[11px] text-[hsl(var(--muted-foreground))] mb-2">
          {condition === 'baseline'
            ? 'Drag across that part on the left.'
            : 'Click it in your setup on the left.'}
        </p>

        {condition === 'score' && pointing?.kind === 'intent' && (
          <p className="mb-2 rounded-lg border border-[hsl(var(--primary))]/40 bg-[hsl(var(--primary))]/5 px-2.5 py-1.5 text-[11.5px]">
            Selected in your setup on the left.
          </p>
        )}

        {condition === 'baseline' && (pointing?.kind === 'span' || selection) && (
          <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5">
            <p className="text-[11.5px] leading-relaxed text-amber-900">
              “{clip(pointing?.kind === 'span' ? pointing.text : selection?.text ?? '')}”
            </p>
            {pointing?.kind !== 'span' && selection && (
              <button
                onClick={() => onChange({ pointing: { kind: 'span', ...selection } })}
                disabled={busy}
                className="mt-1.5 w-full rounded bg-[hsl(var(--primary))] py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"
              >
                Use this selection
              </button>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={() =>
              onChange({ pointing: { kind: condition === 'baseline' ? 'nothing' : 'none' } })
            }
            disabled={busy}
            className={choice(pointing?.kind === 'nothing' || pointing?.kind === 'none')}
          >
            {condition === 'baseline' ? 'Nothing specific' : 'None of them'}
          </button>
          <button
            onClick={() => onChange({ pointing: { kind: 'not_sure' } })}
            disabled={busy}
            className={choice(pointing?.kind === 'not_sure')}
          >
            Not sure
          </button>
        </div>
      </div>

      <div className="border-t border-[hsl(var(--border))] pt-3">
        <label className="block text-[12.5px] font-semibold mb-1.5" htmlFor="expectation">
          In a phrase or a sentence — a few words are fine — how do you expect your chatbot to
          respond to this?
        </label>
        <textarea
          id="expectation"
          rows={3}
          value={draft.expectation}
          onChange={(e) => onChange({ expectation: e.target.value })}
          placeholder={'e.g., "won’t write it for them; asks what they’ve tried"'}
          className="w-full rounded-lg border border-[hsl(var(--border))] px-2.5 py-2 text-[12px] leading-snug resize-none focus:outline-none focus:border-[hsl(var(--primary))]"
        />
      </div>

      <div className="border-t border-[hsl(var(--border))] pt-3">
        <p className="text-[12.5px] font-semibold mb-2">
          Will your chatbot answer this the way you intend?
        </p>
        <div className="flex gap-2">
          {[true, false].map((yes) => (
            <button
              key={String(yes)}
              onClick={() => onChange({ guess: yes })}
              disabled={busy}
              className={choice(draft.guess === yes)}
            >
              {yes ? 'Yes' : 'No'}
            </button>
          ))}
        </div>
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
          <p className="mt-1.5 text-[10.5px] text-center text-[hsl(var(--muted-foreground))]">
            Answer all three to continue.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * 문항지 §3 Pass 2 — the prediction back on screen, then reveal, rate, explain.
 *
 * The recap is what makes two-pass affordable: the reveal is now minutes and
 * seven questions away from the prediction it is about, and ④ asks them to
 * explain that prediction. What they wrote is put in front of them verbatim
 * rather than summarised by anyone.
 */
function RateCard({
  item,
  intentTitles,
  revealed,
  whatsOff,
  probe,
  busy,
  last,
  onReveal,
  onWhatsOff,
  onProbe,
  onRate,
  onNext,
}: {
  item: TestItem;
  intentTitles: Map<number, string>;
  revealed: boolean;
  whatsOff: string;
  probe: string;
  busy: boolean;
  last: boolean;
  onReveal: () => void;
  onWhatsOff: (v: string) => void;
  onProbe: (v: string) => void;
  onRate: (rating: number, off?: string) => void;
  onNext: () => void;
}) {
  return (
    <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 space-y-4">
      <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/60 px-3 py-2.5">
        <p className="text-[9.5px] font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))] mb-1.5">
          Your prediction
        </p>
        {item.expectation && (
          <p className="text-[12px] leading-snug mb-1.5">“{item.expectation}”</p>
        )}
        <p className="text-[11.5px] leading-snug text-[hsl(var(--muted-foreground))]">
          You expected it to answer the way you intend:{' '}
          <span className="font-semibold text-[hsl(var(--foreground))]">
            {item.guess === null ? '—' : item.guess ? 'Yes' : 'No'}
          </span>
        </p>
        {item.pointing && (
          <p className="text-[11.5px] leading-snug text-[hsl(var(--muted-foreground))]">
            You pointed to:{' '}
            <span className="font-semibold text-[hsl(var(--foreground))]">
              {pointedLabel(item.pointing, intentTitles)}
            </span>
          </p>
        )}
      </div>

      {!revealed ? (
        <button
          onClick={onReveal}
          className="w-full rounded-lg bg-[hsl(var(--primary))] py-2.5 text-sm font-semibold text-white"
        >
          Show the actual response
        </button>
      ) : (
        <>
          <div className="border-t border-[hsl(var(--border))] pt-3">
            <p className="text-[12.5px] font-semibold mb-2">
              How well does this response match what you intended?
            </p>
            <div className="flex gap-1.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  onClick={() => onRate(n)}
                  disabled={busy}
                  className={`flex-1 rounded-lg border py-2 text-xs font-semibold disabled:opacity-50 ${
                    item.rating === n
                      ? 'bg-[hsl(var(--primary))] border-[hsl(var(--primary))] text-white'
                      : 'border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]'
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

          {item.rating !== null && item.rating <= 3 && (
            <div>
              <label className="block text-[12.5px] font-semibold mb-1.5" htmlFor="whats-off">
                What&rsquo;s off about it? (a few words)
              </label>
              <textarea
                id="whats-off"
                rows={2}
                value={whatsOff}
                onChange={(e) => onWhatsOff(e.target.value)}
                // Saved with the rating it belongs to, on the way out of the
                // box, so it cannot be left behind by pressing Next quickly.
                onBlur={() => item.rating !== null && onRate(item.rating, whatsOff)}
                className="w-full rounded-lg border border-[hsl(var(--border))] px-2.5 py-2 text-[12px] leading-snug resize-none focus:outline-none focus:border-[hsl(var(--primary))]"
              />
            </div>
          )}

          {/* Opens only where the prediction actually missed, and that verdict
              arrives with the rating — the routing half of it is something the
              participant never sees. Blank is a real answer. */}
          {item.missed === true && (
            <div>
              <label className="block text-[12.5px] font-semibold mb-1.5" htmlFor="probe">
                This turned out differently from what you expected — why do you think that is?
                (a sentence is fine)
              </label>
              <textarea
                id="probe"
                rows={3}
                value={probe}
                onChange={(e) => onProbe(e.target.value)}
                className="w-full rounded-lg border border-[hsl(var(--border))] px-2.5 py-2 text-[12px] leading-snug resize-none focus:outline-none focus:border-[hsl(var(--primary))]"
              />
            </div>
          )}

          {item.rating !== null && (
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
 * How a pointing reads back to the person who made it — a phrase, not the
 * button label, because it sits inside a sentence.
 */
function pointedLabel(pointing: Pointing, titles: Map<number, string>): string {
  switch (pointing.kind) {
    case 'intent':
      return titles.get(pointing.intentId) ?? 'an intent no longer in your setup';
    case 'none':
      return 'none of your intents';
    case 'nothing':
      return 'nothing in particular';
    case 'not_sure':
      return 'not sure where it would come from';
    case 'span':
      return `“${clip(pointing.text)}”`;
  }
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
