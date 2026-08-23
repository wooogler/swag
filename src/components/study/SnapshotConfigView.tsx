'use client';

import { useMemo, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';

/**
 * The participant's DEPLOYED configuration, read-only, for the block test.
 *
 * It must stay on screen while they predict: the measure is whether they can
 * read their own configuration and tell what it will do, not whether they
 * memorised it. So this renders the frozen deploy snapshot — not the live board
 * state, which may already have moved on — and shows the whole thing rather
 * than a summary.
 *
 * (The board's own deploy modal looks similar but reads live state through its
 * own fetch, so it cannot serve this purpose.)
 */

export interface SnapshotIntentView {
  id: number;
  title: string;
  definition: string;
  rule: string | null;
  kind: string;
  type: string | null;
  parentId: number | null;
  position: number | null;
}

export interface SnapshotConfig {
  condition: 'score' | 'baseline';
  versionLabel: string;
  /** SCORE only: the deployed tree. */
  intents?: SnapshotIntentView[];
  /** Baseline only: the deployed rules document. */
  rules?: string;
  /**
   * The simple version, whose tree has ONE root instead of one per query type.
   * Set on both arms of it so the panel and the picker skip the type sections
   * rather than drawing four empty ones.
   */
  flat?: boolean;
}

const TYPE_ORDER = ['planning', 'translating', 'reviewing', 'drafting'] as const;
export const TYPE_DOT: Record<string, string> = {
  planning: 'bg-blue-500',
  translating: 'bg-emerald-500',
  reviewing: 'bg-amber-500',
  drafting: 'bg-violet-500',
};
export const TYPE_LABEL: Record<string, string> = {
  planning: 'Planning',
  translating: 'Translating',
  reviewing: 'Reviewing',
  drafting: 'Drafting',
};

export interface PickerEntry {
  intent: SnapshotIntentView;
  depth: number;
  type: string;
  /** True on the first entry of each type — the caller draws the heading. */
  startsType: boolean;
}

/**
 * The panel's own reading order, flattened for a list that has to match it.
 *
 * The block test asks a participant to find, in a list, an intent they are
 * looking at in the panel beside it. Any difference between the two orders is
 * search work charged to a measurement — so both come from here rather than
 * from two hand-kept sortings that agree until someone edits one of them.
 */
export function pickerOrder(
  intents: SnapshotIntentView[] | undefined,
  flat = false
): PickerEntry[] {
  const authored = (intents ?? []).filter((i) => i.kind === 'intent');
  const out: PickerEntry[] = [];
  if (flat) {
    // One tree, one order — the same walk the panel draws, with no type to
    // group by.
    orderChain(authored).forEach((intent, i) => {
      out.push({ intent, depth: depthOf(intent, authored), type: 'all', startsType: i === 0 });
    });
    return out;
  }
  for (const type of TYPE_ORDER) {
    const mine = authored.filter((i) => i.type === type);
    orderChain(mine).forEach((intent, i) => {
      out.push({ intent, depth: depthOf(intent, mine), type, startsType: i === 0 });
    });
  }
  // A type we do not know about would otherwise vanish from the picker while
  // still routing questions; show it last rather than lose it.
  const known = new Set(out.map((e) => e.intent.id));
  for (const intent of authored) {
    if (!known.has(intent.id)) {
      out.push({ intent, depth: 0, type: intent.type ?? 'other', startsType: true });
    }
  }
  return out;
}

export interface RulesSelection {
  start: number;
  end: number;
  text: string;
}

export default function SnapshotConfigView({
  config,
  onRulesSelection,
  highlights = [],
  highlightTone = 'active',
  onClearHighlights,
  onIntentPick,
  pickedIntentId = null,
  onDefaultPick,
  pickedDefault = false,
  answeredShown = false,
  answeredIntentId = null,
}: {
  config: SnapshotConfig;
  /**
   * Baseline pointing: fires when a drag finishes inside the rules text.
   * Optional because this same view is read-only everywhere else — the block
   * test is the only screen that asks the document to be pointed at.
   */
  onRulesSelection?: (selection: RulesSelection | null) => void;
  /**
   * Baseline pointing, confirmed: the stretches already pointed at, marked in
   * the document itself. A quotation in the card beside it is a copy of the
   * answer; this is the answer where it lives, which is the only form in which
   * "and this bit too" is a readable thing to say.
   */
  highlights?: RulesSelection[];
  /**
   * Take them all off, from the header of the document they are in.
   *
   * The count and the undo belong where the marks are. In the card beside it
   * they were a description of something happening somewhere else — and the
   * card is already the column of questions, not the column of answers.
   */
  onClearHighlights?: () => void;
  /**
   * What the marks MEAN right now, which is not the same in both passes.
   *
   * 'active' — amber, the colour of a live drag: an answer being given.
   * 'recap'  — purple, the colour of the revealed reply: an answer already
   *            given, put back beside the thing it was a prediction about.
   *
   * Same marks, two readings, and the reader should not have to work out which
   * one they are looking at from the phase of the session they are in.
   */
  highlightTone?: 'active' | 'recap';
  /**
   * SCORE pointing: fires when an intent in the tree is clicked. Optional for
   * the same reason as the drag — this view is read-only everywhere else, and
   * the block test is the only screen that asks the tree to be pointed at.
   * 문항지 §3 Pass 1 asks for the pick to happen HERE, in the tree the
   * participant is reading, rather than in a copy of the list beside it.
   */
  onIntentPick?: (intentId: number) => void;
  pickedIntentId?: number | null;
  /**
   * SCORE pointing, the other end of it: the else-rule is a pick too.
   *
   * "None of my intents claim this" is an answer about the setup, and the
   * setup HAS a row for it — Uncategorized, drawn last because last is where
   * it is reached (SCORE_SIMPLE_DESIGN §132). Making it clickable is what lets
   * the question be answered entirely in the panel it is about, instead of in
   * a button beside it that has to describe the row in words.
   */
  onDefaultPick?: () => void;
  pickedDefault?: boolean;
  /**
   * Pass 2: which row ACTUALLY answered, marked in the setup itself.
   *
   * The routing used to be reported as a sentence in the card beside this
   * panel ("Matched: Provide Examples"), which asked the participant to hold a
   * name in their head and go find it. Here the two facts sit on the rows they
   * are about: the row they picked carries "You picked", the row that answered
   * carries "Answered this", and when those are the same row it carries both —
   * so agreement and disagreement are the same glance, not a comparison.
   *
   * `null` intentId with `answeredShown` means nothing claimed it, which is
   * Uncategorized — a row like any other.
   */
  answeredShown?: boolean;
  answeredIntentId?: number | null;
}) {
  /**
   * Which intents are open. Held here, so it survives the move from one
   * question to the next — a participant who opened three of them in Pass 1
   * does not reopen them six times, and does not arrive at Q6 with the rule
   * they need to compare against closed again.
   */
  const [openIds, setOpenIds] = useState<Set<number>>(new Set());
  // The defaults fold too. In the four-type build the SAME paragraph is the
  // rule under every one of them, so open they are the same text four times —
  // the single biggest block of repetition in the panel, and none of it is
  // what a participant is looking for when they are looking for an intent.
  const authoredIds = useMemo(
    () => (config.intents ?? []).map((i) => i.id),
    [config.intents]
  );
  const allOpen = authoredIds.length > 0 && authoredIds.every((id) => openIds.has(id));
  const toggle = (id: number) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () => setOpenIds(allOpen ? new Set() : new Set(authoredIds));
  const foldable = (config.intents ?? []).length > 1;
  const expandAll = foldable && (
    <button
      type="button"
      onClick={toggleAll}
      className="text-2xs font-semibold text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:underline"
    >
      {allOpen ? 'Collapse all' : 'Expand all'}
    </button>
  );

  if (config.condition === 'baseline') {
    return (
      <div className="flex flex-col h-full">
        <Header
          label="Your rules"
          right={
            highlights.length > 0 ? (
              // A KEY, not just a count. A colour on someone's own prompt says
              // nothing on its own — and in Pass 2 it appears without them
              // having just done anything, so "what is this?" is a real
              // question with no answer anywhere on the screen. The swatch is
              // the mark's own colour, so the line reads as a legend for what
              // is in the text beside it.
              <span className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className={`w-2.5 h-2.5 rounded-sm ${
                      highlightTone === 'recap'
                        ? 'bg-purple-200/70 dark:bg-purple-900/40'
                        : 'bg-amber-200'
                    }`}
                  />
                  <span
                    className={`text-2xs font-semibold ${
                      highlightTone === 'recap' ? 'text-purple-700 dark:text-purple-300' : 'text-amber-700'
                    }`}
                  >
                    {highlightTone === 'recap'
                      ? 'What you marked'
                      : highlights.length === 1
                        ? '1 part marked'
                        : `${highlights.length} parts marked`}
                  </span>
                </span>
                {onClearHighlights && (
                  <button
                    type="button"
                    onClick={onClearHighlights}
                    className="text-2xs font-semibold text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:underline"
                  >
                    Clear
                  </button>
                )}
              </span>
            ) : undefined
          }
        />
        <div className="flex-1 scrollbar-always px-4 py-3">
          {config.rules?.trim() ? (
            <RulesText
              rules={config.rules}
              onSelect={onRulesSelection}
              highlights={highlights}
              tone={highlightTone}
            />
          ) : (
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              No rules were written, so the chatbot answers with no instructions of yours.
            </p>
          )}
        </div>
      </div>
    );
  }

  const intents = config.intents ?? [];
  const roots = intents.filter((i) => i.kind === 'type_root');
  const authored = intents.filter((i) => i.kind === 'intent');

  if (config.flat) {
    const root = roots[0] ?? null;
    return (
      <div className="flex flex-col h-full">
        <Header label="Your setup" right={expandAll} />
        <div className="flex-1 scrollbar-always px-3 py-2 space-y-1.5">
          {orderChain(authored).map((intent) => (
            <IntentCard
              key={intent.id}
              intent={intent}
              depth={depthOf(intent, authored)}
              open={openIds.has(intent.id)}
              onToggle={() => toggle(intent.id)}
              onPick={onIntentPick}
              picked={pickedIntentId === intent.id}
              answered={answeredShown && answeredIntentId === intent.id}
            />
          ))}
          {root && (
            <DefaultCard
              label="Uncategorized"
              rule={root.rule}
              open={openIds.has(root.id)}
              onToggle={() => toggle(root.id)}
              onPick={onDefaultPick}
              picked={pickedDefault}
              answered={answeredShown && answeredIntentId === null}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <Header label="Your setup" right={expandAll} />
      <div className="flex-1 scrollbar-always px-3 py-2 space-y-4">
        {TYPE_ORDER.map((type) => {
          const root = roots.find((r) => r.type === type);
          const mine = authored.filter((i) => i.type === type);
          if (!root && mine.length === 0) return null;
          return (
            <section key={type}>
              <div className="flex items-center gap-2 px-1 pb-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${TYPE_DOT[type]}`} />
                <span className="text-2xs font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                  {TYPE_LABEL[type]}
                </span>
              </div>
              <div className="space-y-1.5">
                {/* Children before parents, mirroring the order the chatbot
                    checks them in — the tree IS the order of evaluation. */}
                {orderChain(mine).map((intent) => (
                  <IntentCard
                    key={intent.id}
                    intent={intent}
                    depth={depthOf(intent, mine)}
                    open={openIds.has(intent.id)}
                    onToggle={() => toggle(intent.id)}
                    onPick={onIntentPick}
                    picked={pickedIntentId === intent.id}
                    answered={answeredShown && answeredIntentId === intent.id}
                  />
                ))}
                {root && (
                  <DefaultCard
                    label={`Anything else in ${TYPE_LABEL[type]}`}
                    rule={root.rule}
                    open={openIds.has(root.id)}
                    onToggle={() => toggle(root.id)}
                    // The four-type build has one of these per type, and the
                    // answer they all record is the same "no intent of mine
                    // claimed it" — which is what the routing check compares
                    // against. Picking a particular type's default is more
                    // than the measure can use, and less than it needs.
                    onPick={onDefaultPick}
                    picked={pickedDefault}
                    answered={answeredShown && answeredIntentId === null}
                  />
                )}
              </div>
            </section>
          );
        })}
        {authored.length === 0 && (
          <p className="px-1 text-xs text-[hsl(var(--muted-foreground))]">
            You did not add any groups, so every question falls to the defaults above.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The rules document, and — when the block test asks for it — the drag that
 * points at part of it.
 *
 * Offsets are measured by collapsing a Range to the start of this element and
 * taking the length of what it then spans, rather than by trusting
 * anchorOffset: the text is one node today, but a selection that begins or ends
 * outside it would otherwise report a number against the wrong origin. A
 * selection that is not fully inside clears instead of guessing.
 */
function RulesText({
  rules,
  onSelect,
  highlights = [],
  tone = 'active',
}: {
  rules: string;
  onSelect?: (selection: RulesSelection | null) => void;
  highlights?: RulesSelection[];
  tone?: 'active' | 'recap';
}) {
  const ref = useRef<HTMLPreElement>(null);

  const report = () => {
    if (!onSelect) return;
    const el = ref.current;
    const sel = window.getSelection();
    if (!el || !sel || sel.rangeCount === 0 || sel.isCollapsed) return onSelect(null);
    const range = sel.getRangeAt(0);
    if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) {
      return onSelect(null);
    }
    const before = range.cloneRange();
    before.selectNodeContents(el);
    before.setEnd(range.startContainer, range.startOffset);
    const start = before.toString().length;
    const text = range.toString();
    if (!text.trim()) return onSelect(null);
    onSelect({ start, end: start + text.length, text });
  };

  return (
    <pre
      ref={ref}
      onMouseUp={onSelect ? report : undefined}
      onKeyUp={onSelect ? report : undefined}
      className={`whitespace-pre-wrap font-sans text-sm leading-relaxed text-[hsl(var(--foreground))] ${
        onSelect ? 'cursor-text selection:bg-amber-200' : ''
      }`}
    >
      {/* The marks are ELEMENTS inside the text, which the offset maths above
          survives on purpose: `before.toString()` counts characters, not
          nodes, so a document with three <mark>s in it reports the same
          offsets as the plain one did. */}
      {segments(rules, highlights).map((part, i) =>
        part.marked ? (
          <mark
            key={i}
            className={`rounded-sm text-[hsl(var(--foreground))] ${
              tone === 'recap'
                ? 'bg-purple-200/70 dark:bg-purple-900/40'
                : 'bg-amber-200'
            }`}
          >
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        )
      )}
    </pre>
  );
}

/**
 * Cut the document into marked and unmarked runs.
 *
 * Sorted and merged first: two highlights that touch or overlap are one run,
 * not two nested ones, so the mark cannot double-tint where they meet and the
 * offsets stay a simple walk. Out-of-range or empty spans are dropped rather
 * than clamped — a span that no longer fits the text is a span from a
 * different version of it.
 */
function segments(text: string, highlights: RulesSelection[]): { text: string; marked: boolean }[] {
  const ranges = highlights
    .filter((h) => h.start >= 0 && h.end > h.start && h.end <= text.length)
    .sort((a, b) => a.start - b.start)
    .reduce<{ start: number; end: number }[]>((acc, h) => {
      const last = acc[acc.length - 1];
      if (last && h.start <= last.end) last.end = Math.max(last.end, h.end);
      else acc.push({ start: h.start, end: h.end });
      return acc;
    }, []);
  if (ranges.length === 0) return [{ text, marked: false }];

  const out: { text: string; marked: boolean }[] = [];
  let at = 0;
  for (const r of ranges) {
    if (r.start > at) out.push({ text: text.slice(at, r.start), marked: false });
    out.push({ text: text.slice(r.start, r.end), marked: true });
    at = r.end;
  }
  if (at < text.length) out.push({ text: text.slice(at), marked: false });
  return out;
}

/**
 * No version number on it.
 *
 * `versionLabel` is still carried on the config — it is how a trail or a
 * console readout says WHICH configuration a block was measured against — but
 * it is not a thing to put in front of the participant. There is exactly one
 * configuration on this screen and no other to tell it apart from, so "v5"
 * answers no question they have; what it does do is put a count of their own
 * revisions on screen while they judge the result of them.
 */
function Header({ label, right }: { label: string; right?: React.ReactNode }) {
  return (
    <div className="px-4 py-2 bg-[hsl(var(--muted))]/60 border-b border-[hsl(var(--border))] flex items-center justify-between gap-2">
      <span className="text-2xs font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
        {label}
      </span>
      {right}
    </div>
  );
}

/**
 * One intent: its title always, the rest on request.
 *
 * COLLAPSED BY DEFAULT (08-22). Open, a setup of six intents is a column of
 * text taller than the screen, and finding the one that handles the question
 * beside it means scrolling past five that do not. The title is what the
 * participant wrote to name the thing, so it is what the list is made of.
 *
 * TWO TARGETS, AND THE BIG ONE IS THE ANSWER (08-22). The card is the pick —
 * all of it, wherever the pointer lands. The title row is the disclosure, and
 * the only part of the card that is not the pick. Picking used to BE the title
 * click, which made the answer a narrow strip of text to hit and left the rest
 * of the card inert; a question that asks "which of these" should let you
 * click the thing, not its label. Reading is still possible without answering,
 * because the row that opens it is carved out of the surface that answers.
 *
 * A pick still opens what it picked: choosing "which one handles this" while
 * its rule is closed is a claim about a title, and the question after next
 * asks whether the response followed that rule.
 */
function IntentCard({
  intent,
  depth,
  open,
  onToggle,
  onPick,
  picked = false,
  answered = false,
}: {
  intent: SnapshotIntentView;
  depth: number;
  open: boolean;
  onToggle: () => void;
  onPick?: (intentId: number) => void;
  picked?: boolean;
  answered?: boolean;
}) {
  const pick = () => {
    if (!onPick) return;
    onPick(intent.id);
    if (!open) onToggle();
  };

  return (
    <div
      // A div and not a button: the disclosure control lives inside it, and a
      // button inside a button is not renderable markup.
      role={onPick ? 'button' : undefined}
      tabIndex={onPick ? 0 : undefined}
      onClick={onPick ? pick : undefined}
      onKeyDown={
        onPick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                pick();
              }
            }
          : undefined
      }
      style={{ marginLeft: `${depth * 0.875}rem` }}
      className={`rounded-lg border ${
        picked
          ? 'border-[hsl(var(--primary))] ring-1 ring-[hsl(var(--primary))]/30 bg-[hsl(var(--primary))]/5'
          : `border-[hsl(var(--border))] bg-[hsl(var(--card))] ${
              onPick ? 'hover:border-[hsl(var(--primary))]/60 hover:bg-[hsl(var(--muted))]/40' : ''
            }`
      } ${onPick ? 'cursor-pointer' : ''}`}
    >
      <Disclosure open={open} onToggle={onToggle} label={intent.title}>
        <span className="text-sm font-semibold leading-snug">{intent.title}</span>
        <Marks picked={picked} answered={answered} />
      </Disclosure>
      {/* Below the row that toggles, so it belongs to the surface that picks:
          two lines of the definition, which is what actually decides whether
          this intent handles the question.

          The clamp is on its own element inside the padding, not on a padded
          one — `-webkit-line-clamp` renders the cut line INTO the padding box,
          so a padded clamp shows half a third line under the ellipsis. */}
      {!open && (
        <div className="px-3 pb-2 pl-8 -mt-1">
          <p className="text-2xs leading-snug text-[hsl(var(--muted-foreground))] line-clamp-2">
            {intent.definition}
          </p>
        </div>
      )}
      {open && (
        <div className="px-3 pb-2.5 pl-8 -mt-0.5 space-y-2">
          {/* THE TWO HALVES, LABELLED AS THEY WERE WRITTEN. The studio's own
              editor is two fields, "When a question…" and "Then", and that
              pair IS the model — which questions, and what to do with them.
              Run together as one paragraph with a bold "When" in front, the
              rule reads as a continuation of the definition, and the one
              sentence a participant most needs at Q6 ("does the response
              follow what I set up") is the one with no label on it. */}
          <Field label="When a question…">
            <p className="text-xs leading-snug text-[hsl(var(--foreground))]">
              {intent.definition}
            </p>
          </Field>
          <Field label="Then">
            <RuleText rule={intent.rule} />
          </Field>
        </div>
      )}
    </div>
  );
}

/**
 * The chevron and the name — the one strip of a card that opens it rather than
 * answering with it. Stops the click, so the surface underneath never sees it.
 */
function Disclosure({
  open,
  onToggle,
  label,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-expanded={open}
      aria-label={open ? `Hide what ${label} says` : `Read what ${label} says`}
      className="w-full flex items-start gap-1.5 pl-2 pr-3 py-2 text-left group"
    >
      <ChevronRight
        className={`w-3.5 h-3.5 mt-0.5 shrink-0 text-[hsl(var(--muted-foreground))] transition-transform group-hover:text-[hsl(var(--foreground))] ${
          open ? 'rotate-90' : ''
        }`}
      />
      <span className="flex-1 min-w-0">{children}</span>
    </button>
  );
}

/**
 * What answers when nothing else claims the question.
 *
 * SOLID, AND SHAPED LIKE AN INTENT (08-22). It used to be dashed, which reads
 * as a placeholder — something not filled in yet, or not available — at the
 * exact moment the participant is being asked to click it. It is neither: the
 * studio draws Uncategorized as an ordinary row of the same list, with the
 * same weight of name, and this panel is supposed to look like the setup they
 * spent twenty minutes in. The grey dot is the studio's own key for "claimed
 * by no intent", and it is the whole of the distinction it needs.
 */
function DefaultCard({
  label,
  rule,
  open,
  onToggle,
  onPick,
  picked = false,
  answered = false,
}: {
  label: string;
  rule: string | null;
  open: boolean;
  onToggle: () => void;
  onPick?: () => void;
  picked?: boolean;
  answered?: boolean;
}) {
  const pick = () => {
    if (!onPick) return;
    onPick();
    if (!open) onToggle();
  };

  return (
    <div
      role={onPick ? 'button' : undefined}
      tabIndex={onPick ? 0 : undefined}
      onClick={onPick ? pick : undefined}
      onKeyDown={
        onPick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                pick();
              }
            }
          : undefined
      }
      className={`rounded-lg border ${
        picked
          ? 'border-[hsl(var(--primary))] ring-1 ring-[hsl(var(--primary))]/30 bg-[hsl(var(--primary))]/5'
          : `border-[hsl(var(--border))] bg-[hsl(var(--card))] ${
              onPick ? 'hover:border-[hsl(var(--primary))]/60 hover:bg-[hsl(var(--muted))]/40' : ''
            }`
      } ${onPick ? 'cursor-pointer' : ''}`}
    >
      <Disclosure open={open} onToggle={onToggle} label={label}>
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--muted-foreground))]" />
          <span className="text-sm font-semibold leading-snug">{label}</span>
        </span>
        <Marks picked={picked} answered={answered} />
      </Disclosure>
      {open && (
        <div className="px-3 pb-2.5 pl-8 -mt-0.5">
          {/* No "When" on this one: its when is whatever is left, which is
              what the row's position in the list already says. */}
          <Field label="Then">
            <RuleText rule={rule} />
          </Field>
        </div>
      )}
    </div>
  );
}

/**
 * "You picked" and "The reply came from here", on the rows they are about.
 *
 * THE SECOND ONE IS PURPLE, AND THAT IS THE WHOLE POINT. "Answered this" left
 * the reader to work out what "this" was — the row? the question? — and named
 * no relationship to anything on screen. The reply is on screen: it is the
 * bubble ringed in purple in the pane to the left. Saying "the reply" and
 * saying it in the reply's own colour makes the badge a line drawn between two
 * visible things rather than a label to be interpreted.
 *
 * Neither badge is a verdict. Green-for-right and amber-for-wrong would grade
 * the participant at the moment they are being asked to explain themselves —
 * and agreement is already legible from position: two badges on one row means
 * they matched, two badges on two rows means they did not.
 */
function Marks({ picked, answered }: { picked?: boolean; answered?: boolean }) {
  if (!picked && !answered) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {picked && (
        <span className="inline-flex items-center rounded-full border border-[hsl(var(--primary))]/50 bg-[hsl(var(--primary))]/10 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-[hsl(var(--primary))]">
          You picked
        </span>
      )}
      {answered && (
        // The ring on the revealed reply is purple-500; this is the same ink.
        <span className="inline-flex items-center rounded-full border border-purple-400 bg-purple-50 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-700">
          The reply came from here
        </span>
      )}
    </span>
  );
}

/** A label over a text, in the type the studio's editor labels the same two
 * fields with — so the panel names them the way the participant met them. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-0.5 text-2xs font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
        {label}
      </p>
      {children}
    </div>
  );
}

function RuleText({ rule }: { rule: string | null }) {
  if (!rule?.trim()) {
    return (
      <p className="text-xs italic text-[hsl(var(--muted-foreground))]">
        No instructions — the chatbot answers however it normally would.
      </p>
    );
  }
  return (
    <pre className="whitespace-pre-wrap font-sans text-xs leading-snug text-[hsl(var(--foreground))]">
      {rule}
    </pre>
  );
}

/** Depth by ancestor walk, so nesting reads the way it did on the board. */
function depthOf(intent: SnapshotIntentView, all: SnapshotIntentView[]): number {
  let depth = 0;
  let current = intent;
  const seen = new Set<number>([current.id]);
  while (current.parentId != null) {
    const parent = all.find((i) => i.id === current.parentId);
    if (!parent || seen.has(parent.id)) break; // defensive: a broken tree still renders
    seen.add(parent.id);
    current = parent;
    depth += 1;
  }
  return Math.min(depth, 4);
}

/**
 * Post-order (children before their parent), siblings by (position ?? id) —
 * the chain-compilation order, so what a participant reads top to bottom is
 * the order their chatbot actually checks.
 */
function orderChain(intents: SnapshotIntentView[]): SnapshotIntentView[] {
  const byParent = new Map<number | null, SnapshotIntentView[]>();
  for (const intent of intents) {
    const key = intent.parentId ?? null;
    const list = byParent.get(key) ?? [];
    list.push(intent);
    byParent.set(key, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => (a.position ?? a.id) - (b.position ?? b.id) || a.id - b.id);
  }
  const out: SnapshotIntentView[] = [];
  const visit = (parentId: number | null, guard: number) => {
    if (guard > 8) return;
    for (const intent of byParent.get(parentId) ?? []) {
      visit(intent.id, guard + 1);
      out.push(intent);
    }
  };
  visit(null, 0);
  // Anything orphaned by a missing parent still gets shown.
  for (const intent of intents) if (!out.includes(intent)) out.push(intent);
  return out;
}
