'use client';

/**
 * The REVIEW GATE for folding decisions into a definition.
 *
 * The fold is a lossy LLM rewrite, and it is the only route by which a decision
 * reaches the classifier — so nothing changes until the instructor has seen what
 * it produced. A modal rather than a panel because the decision deserves the
 * whole screen: the diff needs room, the result is meant to be edited, and the
 * panes behind it are showing ratings from the OLD definition anyway.
 *
 * What the rail reports is MEASURED, not claimed: the server rated each
 * corrected question against this candidate with the real classifier (see the
 * refine route). So a ✓ means the definition reproduces that decision by itself,
 * and a ✗ comes with the classifier's own words for why it did not — which is
 * the one thing that makes a second attempt better than a re-roll. Failures are
 * kept as pins by default, so the instructor can close this modal without
 * abandoning anything they decided.
 */
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Loader2, Pencil, RotateCcw, Trash2, X } from 'lucide-react';

/** What the real classifier answered about this question, reading the candidate
 * definition alone. Null when the check could not run at all. */
export interface FoldVerification {
  rating: string;
  rationale: string;
  pass: boolean;
}

export interface FoldCorrectionView {
  id: number;
  messageId: number;
  verdict: 'in' | 'out';
  queryText: string;
  reason: string | null;
  outcome: 'reflected' | 'already' | 'not_reflected';
  span: string | null;
  note: string | null;
  verified: FoldVerification | null;
}

export interface FoldProposalView {
  intentId: number;
  title: string;
  before: string;
  after: string;
  suggestedTitle: string | null;
  /** One or two sentences for the instructor. (The model's own step-by-step
   * analysis is a quality device and is deliberately not shown.) */
  summary: string;
  /** Measured: decisions reproduced / decisions checked, and how many candidates
   * it took to get there. Null when verification did not run. */
  verifiedPass: number | null;
  verifiedTotal: number | null;
  attempts: number;
  corrections: FoldCorrectionView[];
}

/** What the modal can draw BEFORE the fold returns: the teaching being folded
 * and the text it starts from. Both are already known locally, so the rail and
 * the Before pane are real content while only the result is pending. */
export interface FoldPendingView {
  title: string;
  before: string;
  corrections: {
    id: number;
    messageId: number;
    verdict: 'in' | 'out';
    queryText: string;
    reason: string | null;
  }[];
}

/** Circled digits for the rail↔diff mapping; falls back past ⑳. */
function mark(i: number): string {
  return i < 20 ? String.fromCharCode(0x2460 + i) : `(${i + 1})`;
}

/**
 * The proposed text with each reflected span underlined and numbered.
 * Spans were verified server-side to occur in this text, but the instructor may
 * have edited since — so a span that no longer occurs is simply not marked
 * rather than mis-highlighted.
 */
function MarkedDefinition({
  text,
  corrections,
}: {
  text: string;
  corrections: FoldCorrectionView[];
}) {
  const parts = useMemo(() => {
    const hits: { start: number; end: number; idx: number }[] = [];
    corrections.forEach((c, i) => {
      if (c.outcome !== 'reflected' || !c.span) return;
      const at = text.indexOf(c.span);
      if (at === -1) return;
      // Overlapping spans would nest badly; first claim wins.
      if (hits.some((h) => at < h.end && at + c.span!.length > h.start)) return;
      hits.push({ start: at, end: at + c.span.length, idx: i });
    });
    hits.sort((a, b) => a.start - b.start);
    const out: { text: string; idx: number | null }[] = [];
    let cursor = 0;
    for (const h of hits) {
      if (h.start > cursor) out.push({ text: text.slice(cursor, h.start), idx: null });
      out.push({ text: text.slice(h.start, h.end), idx: h.idx });
      cursor = h.end;
    }
    if (cursor < text.length) out.push({ text: text.slice(cursor), idx: null });
    return out;
  }, [text, corrections]);

  return (
    <p className="whitespace-pre-wrap text-sm leading-relaxed">
      {parts.map((p, i) =>
        p.idx === null ? (
          <span key={i}>{p.text}</span>
        ) : (
          <span
            key={i}
            className="rounded-[2px] bg-emerald-50 box-decoration-clone text-emerald-900 underline decoration-emerald-400 decoration-2 underline-offset-2"
          >
            {p.text}
            <span className="ml-0.5 align-super text-[10px] font-semibold text-emerald-700">
              {mark(p.idx)}
            </span>
          </span>
        )
      )}
    </p>
  );
}

/** The unmeasured fallback: the fold model's own report. Only shown when
 * verification could not run (no key, the question left the log) — otherwise the
 * measured verdict replaces it, because the two disagree often enough that
 * showing the claim beside the measurement would just be noise. */
function ClaimedChip({ c }: { c: FoldCorrectionView }) {
  if (c.outcome === 'reflected') {
    return <span className="text-[hsl(var(--muted-foreground))]">folded in (unchecked)</span>;
  }
  if (c.outcome === 'already') {
    return <span className="text-[hsl(var(--muted-foreground))]">already covered — no change needed</span>;
  }
  return <span className="text-amber-700">not folded in{c.note ? ` — ${c.note}` : ''}</span>;
}

/** The re-teach box: the reason, editable, with the classifier's reading of the
 * question sitting right above it — so the rewrite answers something. */
function ReteachBox({
  initial,
  busy,
  onSubmit,
  onCancel,
}: {
  initial: string;
  busy: boolean;
  onSubmit: (reason: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) onSubmit(text.trim());
      }}
      className="mt-1.5 space-y-1"
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        autoFocus
        placeholder="Say what separates this question from the ones on the other side…"
        className="w-full rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-1.5 py-1 text-[11px] leading-relaxed"
      />
      <div className="flex items-center gap-1.5">
        <button
          type="submit"
          disabled={busy || !text.trim()}
          className="inline-flex items-center gap-1 rounded bg-[hsl(var(--primary))] px-1.5 py-0.5 text-[11px] font-semibold text-[hsl(var(--primary-foreground))] disabled:opacity-50"
        >
          {busy && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
          Try again
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="px-1 py-0.5 text-[11px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function FoldReviewModal({
  proposals,
  pending,
  loading,
  busy,
  error,
  onApply,
  onReteach,
  onWithdraw,
  onCancel,
}: {
  /** Null while the fold is still running — `pending` carries the rest. */
  proposals: FoldProposalView[] | null;
  pending: FoldPendingView;
  loading: boolean;
  busy: boolean;
  error: string | null;
  /** The edited texts keyed by intent — the instructor's word is final — plus
   * the split the verification produced: which decisions the definition carries
   * (consume) and which it still owes (hold). */
  onApply: (edited: Record<number, string>, split: { consume: number[]; hold: number[] }) => void;
  /** Rewrite one decision's reason and fold again. The classifier's reading is
   * on screen, so this is a reply to it rather than another roll of the dice. */
  onReteach: (c: FoldCorrectionView, reason: string) => Promise<void>;
  /** Take the decision back — the instructor read the classifier and agreed. */
  onWithdraw: (c: FoldCorrectionView) => Promise<void>;
  onCancel: () => void;
}) {
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [editing, setEditing] = useState<Record<number, boolean>>({});
  /** Which failed decision has its reason box open. */
  const [reteaching, setReteaching] = useState<number | null>(null);
  /** Withdrawn here — already deleted server-side, struck through until the
   * modal closes so the change is visible where it was made. */
  const [withdrawn, setWithdrawn] = useState<Set<number>>(() => new Set());
  /** One retry offer per decision: if the rewritten reason did not land either,
   * pushing it again is not what the instructor needs. */
  const [retried, setRetried] = useState<Set<number>>(() => new Set());
  const [rowBusy, setRowBusy] = useState<number | null>(null);
  // Seed the editable drafts the moment the proposals land. Keyed by intent, so
  // a text the instructor already edited is never overwritten by a later render.
  useEffect(() => {
    if (!proposals) return;
    setDrafts((d) => {
      const next = { ...d };
      for (const p of proposals) if (next[p.intentId] === undefined) next[p.intentId] = p.after;
      return next;
    });
  }, [proposals]);

  const total = proposals
    ? proposals.reduce((n, p) => n + p.corrections.length, 0)
    : pending.corrections.length;
  // The primary intent is first; the rest are the narrowings a send-here forced.
  const also = (proposals ?? []).slice(1);
  const headTitle = proposals?.[0]?.title ?? pending.title;

  /**
   * Where each decision lands on Apply. A verified pass is CONSUMED — the
   * definition demonstrably says it, so the pin has nothing left to do. Anything
   * else is HELD: the decision stays and keeps overriding the judgment. That is
   * the default on purpose, so closing this modal without reading it cannot
   * silently discard something the instructor ruled on.
   *
   * Unverified corrections (the check could not run, or a legacy send-here
   * sibling) fall back to the fold's own report — it is all there is.
   */
  const split = useMemo(() => {
    const consume: number[] = [];
    const hold: number[] = [];
    for (const p of proposals ?? []) {
      for (const c of p.corrections) {
        if (withdrawn.has(c.id)) continue; // gone from the books entirely
        const ok = c.verified ? c.verified.pass : c.outcome !== 'not_reflected';
        (ok ? consume : hold).push(c.id);
      }
    }
    return { consume, hold };
  }, [proposals, withdrawn]);
  const heldCount = split.hold.length;
  /** Measured across the whole review — the headline number. */
  const measured = useMemo(() => {
    let pass = 0;
    let checked = 0;
    for (const p of proposals ?? []) {
      for (const c of p.corrections) {
        if (!c.verified || withdrawn.has(c.id)) continue;
        checked += 1;
        if (c.verified.pass) pass += 1;
      }
    }
    return { pass, checked };
  }, [proposals, withdrawn]);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4"
      onClick={() => !busy && onCancel()}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-3xl flex-col rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Review the updated definition"
      >
        <div className="flex shrink-0 items-baseline justify-between gap-3 border-b border-[hsl(var(--border))] px-4 py-3">
          <h2 className="text-sm font-semibold">
            Update definition{' '}
            <span className="font-normal text-xs text-[hsl(var(--muted-foreground))]">
              — {headTitle} · from your {total} decision{total === 1 ? '' : 's'}
              {!loading && measured.checked > 0 && (
                <>
                  {' · '}
                  <span
                    className={
                      measured.pass === measured.checked
                        ? 'font-medium text-emerald-700'
                        : 'font-medium text-amber-800'
                    }
                    title="Checked by rating each question against the proposed definition with the real classifier."
                  >
                    {measured.pass} of {measured.checked} reproduced
                  </span>
                </>
              )}
            </span>
          </h2>
          <button
            onClick={onCancel}
            disabled={busy}
            className="p-1 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {(
            proposals ?? [
              {
                intentId: -1,
                title: pending.title,
                before: pending.before,
                after: '',
                suggestedTitle: null,
                summary: '',
                verifiedPass: null,
                verifiedTotal: null,
                attempts: 0,
                corrections: pending.corrections.map((c) => ({
                  ...c,
                  outcome: 'already' as const,
                  span: null,
                  note: null,
                  verified: null,
                })),
              },
            ]
          ).map((p, pi) => (
            <div
              key={p.intentId}
              className={pi > 0 ? 'border-t-4 border-[hsl(var(--muted))]' : ''}
            >
              {pi > 0 && (
                <p className="bg-rose-50/60 px-4 py-1.5 text-xs font-semibold text-rose-700">
                  Also narrowed — “{p.title}” answers these questions first, so only changing ITS
                  definition can move them
                </p>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-[240px_minmax(0,1fr)]">
                {/* RAIL — the teaching, kept in view so the rewrite is auditable */}
                <div className="border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40 px-3 py-3 sm:border-b-0 sm:border-r">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                    Your decisions
                  </p>
                  <ul className="mt-2 space-y-2.5">
                    {p.corrections.map((c, i) => {
                      const gone = withdrawn.has(c.id);
                      const failed = !loading && !gone && c.verified && !c.verified.pass;
                      return (
                      <li key={c.id} className={`flex gap-1.5 text-xs ${gone ? 'opacity-50' : ''}`}>
                        <span
                          className={`mt-px shrink-0 font-semibold ${
                            c.verdict === 'in' ? 'text-emerald-700' : 'text-rose-700'
                          }`}
                        >
                          {mark(i)}
                        </span>
                        <span className="min-w-0">
                          <span className={gone ? 'line-through' : ''}>
                            <span
                              className={`font-medium ${
                                c.verdict === 'in' ? 'text-emerald-700' : 'text-rose-700'
                              }`}
                            >
                              {c.verdict}
                            </span>{' '}
                            <span className="text-[hsl(var(--foreground))]">
                              “{c.queryText.replace(/\s+/g, ' ').trim().slice(0, 90)}
                              {c.queryText.length > 90 ? '…' : ''}”
                            </span>
                          </span>
                          {c.reason && !gone && (
                            <span
                              className={`mt-0.5 block italic ${
                                c.verdict === 'in' ? 'text-emerald-700' : 'text-rose-700'
                              }`}
                            >
                              {c.verdict === 'in' ? 'why: ' : 'why not: '}
                              {c.reason}
                            </span>
                          )}
                          {gone && (
                            <span className="mt-0.5 block text-[11px] text-[hsl(var(--muted-foreground))]">
                              withdrawn — no longer a decision
                            </span>
                          )}
                          {!loading && !gone && (
                            <span className="mt-0.5 block text-[11px]">
                              {c.verified ? (
                                c.verified.pass ? (
                                  <span className="font-medium text-emerald-700">
                                    ✓ the definition says this by itself
                                  </span>
                                ) : (
                                  <span className="font-medium text-amber-800">
                                    ✗ the definition can’t say this yet
                                  </span>
                                )
                              ) : (
                                <ClaimedChip c={c} />
                              )}
                            </span>
                          )}
                          {/* The classifier's own words, and what can be done
                              about them. Without the reading, a retry is a
                              re-roll; with it, the instructor is answering
                              something specific. */}
                          {failed && c.verified && (
                            <span className="mt-1 block rounded border border-amber-200 bg-amber-50/60 px-1.5 py-1">
                              <span className="block text-[11px] leading-relaxed text-amber-900">
                                It read the question as{' '}
                                <span className="font-medium">
                                  {c.verified.rating.replace(/_/g, ' ')}
                                </span>
                                {c.verified.rationale ? `: “${c.verified.rationale}”` : '.'}
                              </span>
                              {reteaching === c.id ? (
                                <ReteachBox
                                  initial={c.reason ?? ''}
                                  busy={rowBusy === c.id}
                                  onCancel={() => setReteaching(null)}
                                  onSubmit={async (reason) => {
                                    setRowBusy(c.id);
                                    setRetried((s) => new Set(s).add(c.id));
                                    try {
                                      await onReteach(c, reason);
                                      setReteaching(null);
                                    } finally {
                                      setRowBusy(null);
                                    }
                                  }}
                                />
                              ) : (
                                <span className="mt-1 flex flex-wrap items-center gap-1.5">
                                  <span className="text-[11px] text-amber-900">
                                    📌 kept as a pin, so it still routes your way.
                                  </span>
                                  {!retried.has(c.id) && (
                                    <button
                                      onClick={() => setReteaching(c.id)}
                                      disabled={busy || rowBusy !== null}
                                      className="inline-flex items-center gap-1 rounded border border-amber-300 bg-[hsl(var(--card))] px-1.5 py-0.5 text-[11px] font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                                      title="Say it differently and fold again — the classifier's reading is above"
                                    >
                                      <RotateCcw className="h-2.5 w-2.5" /> Say it differently
                                    </button>
                                  )}
                                  <button
                                    onClick={async () => {
                                      setRowBusy(c.id);
                                      try {
                                        await onWithdraw(c);
                                        setWithdrawn((s) => new Set(s).add(c.id));
                                      } finally {
                                        setRowBusy(null);
                                      }
                                    }}
                                    disabled={busy || rowBusy !== null}
                                    className="inline-flex items-center gap-1 rounded border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-1.5 py-0.5 text-[11px] font-medium text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] disabled:opacity-50"
                                    title="The classifier is right and you are not — drop this decision"
                                  >
                                    <Trash2 className="h-2.5 w-2.5" /> Withdraw
                                  </button>
                                </span>
                              )}
                            </span>
                          )}
                        </span>
                      </li>
                      );
                    })}
                  </ul>
                </div>

                {/* RESULT — before, then the editable after */}
                <div className="px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                    Before
                  </p>
                  <p className="mt-1 border-l-2 border-[hsl(var(--border))] pl-2.5 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">
                    {p.before}
                  </p>

                  <div className="mt-3 flex items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                      After — review &amp; refine
                    </p>
                    <button
                      onClick={() => setEditing((e) => ({ ...e, [p.intentId]: !e[p.intentId] }))}
                      disabled={loading}
                      className="inline-flex items-center gap-1 rounded border border-[hsl(var(--border))] px-1.5 py-0.5 text-[11px] font-medium hover:bg-[hsl(var(--muted))] disabled:opacity-40"
                      title={
                        editing[p.intentId]
                          ? 'Back to the marked-up view'
                          : 'Edit the wording yourself — what you leave here is what gets saved'
                      }
                    >
                      {editing[p.intentId] ? (
                        <>
                          <Check className="h-3 w-3" /> Done editing
                        </>
                      ) : (
                        <>
                          <Pencil className="h-3 w-3" /> Edit the result
                        </>
                      )}
                    </button>
                  </div>

                  {loading ? (
                    // Only the RESULT is unknown — the corrections and the text
                    // being rewritten are already on screen, so the wait has
                    // context instead of being a blank modal.
                    <div
                      className="mt-1 rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 px-2.5 py-3"
                      aria-busy="true"
                    >
                      <p className="flex items-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))]">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Rewriting the definition so it carries your corrections by itself…
                      </p>
                      <div className="mt-2 space-y-1.5" aria-hidden="true">
                        <div className="h-2.5 w-full animate-pulse rounded bg-[hsl(var(--muted))]" />
                        <div className="h-2.5 w-11/12 animate-pulse rounded bg-[hsl(var(--muted))]" />
                        <div className="h-2.5 w-8/12 animate-pulse rounded bg-[hsl(var(--muted))]" />
                      </div>
                    </div>
                  ) : editing[p.intentId] ? (
                    <textarea
                      value={drafts[p.intentId] ?? ''}
                      onChange={(e) => setDrafts((d) => ({ ...d, [p.intentId]: e.target.value }))}
                      rows={6}
                      autoFocus
                      className="mt-1 w-full rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5 text-sm leading-relaxed"
                    />
                  ) : (
                    <div className="mt-1 rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 px-2.5 py-2">
                      <MarkedDefinition
                        text={drafts[p.intentId] ?? ''}
                        corrections={p.corrections}
                      />
                    </div>
                  )}

                  {/* One or two sentences in the instructor's terms. The model's
                      own numbered analysis is a device for making the rewrite
                      good, not something to read — showing it put a scratchpad
                      on screen. */}
                  {!loading && p.summary && (
                    <p className="mt-2 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">
                      <span className="font-medium text-[hsl(var(--foreground))]">What changed:</span>{' '}
                      {p.summary}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="shrink-0 border-t border-[hsl(var(--border))] px-4 py-3">
          {!loading && heldCount > 0 && (
            <p className="mb-2 flex items-start gap-1.5 text-xs text-amber-800">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
              {heldCount} decision{heldCount === 1 ? '' : 's'} the definition can’t make on its own
              {heldCount === 1 ? ' is' : ' are'} kept as pins — {heldCount === 1 ? 'it' : 'they'}{' '}
              still route your way, and every later update tries again.
            </p>
          )}
          {error && (
            <p className="mb-2 flex items-center gap-1.5 text-xs text-red-600">
              <AlertTriangle className="h-3.5 w-3.5" /> {error}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
              Applying replaces the definition{also.length > 0 ? 's' : ''}
              {split.consume.length > 0 &&
                `, retires the ${split.consume.length} decision${split.consume.length === 1 ? '' : 's'} it carries`}
              {heldCount > 0 && `, keeps ${heldCount} as pin${heldCount === 1 ? '' : 's'}`}, and
              re-rates the questions against it right away.
            </span>
            <span className="flex items-center gap-2">
              <button
                onClick={onCancel}
                disabled={busy}
                className="rounded px-2.5 py-1.5 text-xs font-medium text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] disabled:opacity-50"
              >
                {loading ? 'Cancel' : 'Discard proposal'}
              </button>
              <button
                onClick={() => onApply(drafts, split)}
                disabled={busy || loading || !proposals}
                className="inline-flex items-center gap-1.5 rounded bg-[hsl(var(--primary))] px-3 py-1.5 text-xs font-semibold text-[hsl(var(--primary-foreground))] disabled:opacity-50"
              >
                {busy && <Loader2 className="h-3 w-3 animate-spin" />}
                {loading
                  ? 'Preparing…'
                  : also.length > 0
                    ? 'Apply both definitions'
                    : 'Apply this definition'}
              </button>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
