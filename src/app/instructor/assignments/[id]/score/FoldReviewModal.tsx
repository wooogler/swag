'use client';

/**
 * The REVIEW GATE for folding corrections into a definition.
 *
 * The fold is a lossy LLM rewrite, and it is the only route by which a
 * correction reaches the classifier — so nothing changes until the instructor
 * has seen what it produced. A modal rather than a panel because the decision
 * deserves the whole screen: the diff needs room, the result is meant to be
 * edited, and the panes behind it are showing ratings from the OLD definition
 * anyway.
 *
 * The left rail keeps the teaching in view (each correction + its reason) and
 * numbers it, so "why does the definition now say this?" is answerable without
 * leaving. Each correction reports its own outcome — including "couldn't fold
 * this in", which the server verifies rather than takes on trust.
 */
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Loader2, Pencil, X } from 'lucide-react';

export interface FoldCorrectionView {
  id: number;
  verdict: 'in' | 'out';
  queryText: string;
  reason: string | null;
  outcome: 'reflected' | 'already' | 'not_reflected';
  span: string | null;
  note: string | null;
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
  corrections: FoldCorrectionView[];
}

/** What the modal can draw BEFORE the fold returns: the teaching being folded
 * and the text it starts from. Both are already known locally, so the rail and
 * the Before pane are real content while only the result is pending. */
export interface FoldPendingView {
  title: string;
  before: string;
  corrections: { id: number; verdict: 'in' | 'out'; queryText: string; reason: string | null }[];
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

function OutcomeChip({ c }: { c: FoldCorrectionView }) {
  if (c.outcome === 'reflected') {
    return <span className="text-emerald-700">reflected</span>;
  }
  if (c.outcome === 'already') {
    return <span className="text-[hsl(var(--muted-foreground))]">already covered — no change needed</span>;
  }
  return (
    <span className="text-amber-700">
      not folded in{c.note ? ` — ${c.note}` : ''}
    </span>
  );
}

export default function FoldReviewModal({
  proposals,
  pending,
  loading,
  busy,
  error,
  onApply,
  onCancel,
}: {
  /** Null while the fold is still running — `pending` carries the rest. */
  proposals: FoldProposalView[] | null;
  pending: FoldPendingView;
  loading: boolean;
  busy: boolean;
  error: string | null;
  /** The edited texts, keyed by intent — the instructor's word is final. */
  onApply: (edited: Record<number, string>) => void;
  onCancel: () => void;
}) {
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [editing, setEditing] = useState<Record<number, boolean>>({});
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
  const unfolded = (proposals ?? []).reduce(
    (n, p) => n + p.corrections.filter((c) => c.outcome === 'not_reflected').length,
    0
  );
  // The primary intent is first; the rest are the narrowings a send-here forced.
  const also = (proposals ?? []).slice(1);
  const headTitle = proposals?.[0]?.title ?? pending.title;

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
              — {headTitle} · from your {total} correction{total === 1 ? '' : 's'}
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
                corrections: pending.corrections.map((c) => ({
                  ...c,
                  outcome: 'already' as const,
                  span: null,
                  note: null,
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
                    Your corrections
                  </p>
                  <ul className="mt-2 space-y-2.5">
                    {p.corrections.map((c, i) => (
                      <li key={c.id} className="flex gap-1.5 text-xs">
                        <span
                          className={`mt-px shrink-0 font-semibold ${
                            c.verdict === 'in' ? 'text-emerald-700' : 'text-rose-700'
                          }`}
                        >
                          {mark(i)}
                        </span>
                        <span className="min-w-0">
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
                          {c.reason && (
                            <span
                              className={`mt-0.5 block italic ${
                                c.verdict === 'in' ? 'text-emerald-700' : 'text-rose-700'
                              }`}
                            >
                              {c.verdict === 'in' ? 'why: ' : 'why not: '}
                              {c.reason}
                            </span>
                          )}
                          {!loading && (
                            <span className="mt-0.5 block text-[11px]">
                              <OutcomeChip c={c} />
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
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
          {unfolded > 0 && (
            <p className="mb-2 flex items-start gap-1.5 text-xs text-amber-700">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
              {unfolded} correction{unfolded === 1 ? '' : 's'} could not be folded in. Applying
              anyway keeps {unfolded === 1 ? 'it' : 'them'} as {unfolded === 1 ? 'a marker' : 'markers'} — edit the
              wording above if you want {unfolded === 1 ? 'it' : 'them'} to hold.
            </p>
          )}
          {error && (
            <p className="mb-2 flex items-center gap-1.5 text-xs text-red-600">
              <AlertTriangle className="h-3.5 w-3.5" /> {error}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
              Applying replaces the definition{also.length > 0 ? 's' : ''}, clears{' '}
              {total === 1 ? 'the correction' : 'these corrections'} into markers, and re-rates on
              the next Apply.
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
                onClick={() => onApply(drafts)}
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
