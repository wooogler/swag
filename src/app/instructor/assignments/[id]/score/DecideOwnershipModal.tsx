'use client';

/**
 * SCORE v6 — Decide Ownership (S4, §1.7/§2.4).
 *
 * The instructor decides an overlap NOT by comparing definition texts but by
 * comparing what the chatbot would actually answer: for a few boundary
 * questions, Rule A's response and Rule B's response side by side.
 *
 *  · choices converge on one side → declare the Exception Link
 *    ("loser except winner") — definitions untouched, deterministic from
 *    then on, one click to undo (delete the link).
 *  · choices split → each decision is saved as a CONTRAST PAIR (pin 'in' on
 *    the chosen intent, 'out' on the other), refining both boundaries.
 *  · "neither is right" → seed a C-intent that owns the overlap itself.
 *
 * Previews are single-turn regenerations under Base + Rule with the live
 * chatbot model (indicative, §4.6 — stated in the footer).
 */
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { AlertTriangle, Link2, Loader2, Pin, Sparkles, X } from 'lucide-react';
import type { IntentSummary } from './IntentBoard';

interface Comparison {
  messageId: number;
  queryText: string;
  a: string | null;
  b: string | null;
}

interface DecideOwnershipModalProps {
  assignmentId: string;
  intentA: IntentSummary;
  intentB: IntentSummary;
  /** Questions currently in this boundary (Needs Decision entry). */
  messageIds: number[];
  onClose: (changed: boolean) => void;
  /** "Neither is right" → parent opens New Intent seeded as a C-intent. */
  onCreateNew: () => void;
}

/** How many overlap questions one session compares (§7.6 잠정 3-5). */
const COMPARE_COUNT = 4;

type Choice = 'a' | 'b' | 'neither';

export default function DecideOwnershipModal({
  assignmentId,
  intentA,
  intentB,
  messageIds,
  onClose,
  onCreateNew,
}: DecideOwnershipModalProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [comparisons, setComparisons] = useState<Comparison[]>([]);
  const [choices, setChoices] = useState<Map<number, Choice>>(new Map());
  const [committing, setCommitting] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  const sampled = useRef(messageIds.slice(0, COMPARE_COUNT)).current;

  // Conditionally mounted by the parent → cleanup genuinely runs on close.
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/instructor/assignments/${assignmentId}/score/compare`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ intentAId: intentA.id, intentBId: intentB.id, messageIds: sampled }),
          signal: controller.signal,
        });
        const data = await res.json().catch(() => ({}));
        if (controller.signal.aborted) return;
        if (!res.ok) {
          throw new Error(typeof data?.message === 'string' ? data.message : 'Failed to generate the comparison.');
        }
        setComparisons(data.comparisons ?? []);
        if ((data.failed ?? 0) > 0) {
          setError(`${data.failed} preview generation(s) failed — you can still decide from the rest.`);
        }
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return;
        setError((e as Error).message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const decided = [...choices.values()];
  const nA = decided.filter((c) => c === 'a').length;
  const nB = decided.filter((c) => c === 'b').length;
  const nNeither = decided.filter((c) => c === 'neither').length;
  const converged: 'a' | 'b' | null =
    nNeither === 0 && nA > 0 && nB === 0 ? 'a' : nNeither === 0 && nB > 0 && nA === 0 ? 'b' : null;

  async function commit(payload: object) {
    if (committing) return;
    setCommitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/instructor/assignments/${assignmentId}/score/ownership`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(typeof d?.message === 'string' ? d.message : 'Failed to save the decision.');
      }
      onClose(true);
    } catch (e) {
      setError((e as Error).message);
      setCommitting(false);
    }
  }

  const declareLink = (winner: 'a' | 'b') =>
    commit({ action: 'link', intentAId: intentA.id, intentBId: intentB.id, winner });

  const savePins = () =>
    commit({
      action: 'pins',
      intentAId: intentA.id,
      intentBId: intentB.id,
      decisions: [...choices.entries()]
        .filter(([, c]) => c === 'a' || c === 'b')
        .map(([messageId, c]) => ({ messageId, choice: c as 'a' | 'b' })),
    });

  const winnerOf = (w: 'a' | 'b') => (w === 'a' ? intentA : intentB);
  const loserOf = (w: 'a' | 'b') => (w === 'a' ? intentB : intentA);

  return (
    <Dialog open onClose={() => onClose(false)} className="relative z-50">
      <div className="fixed inset-0 bg-black/40" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="w-full max-w-5xl max-h-[92vh] flex flex-col rounded-lg bg-[hsl(var(--card))] border border-[hsl(var(--border))] shadow-xl">
          <div className="px-4 py-3 border-b border-[hsl(var(--border))] flex items-center justify-between gap-2">
            <DialogTitle className="text-sm font-semibold truncate">
              Decide ownership — {intentA.title} ↔ {intentB.title}
            </DialogTitle>
            <button onClick={() => onClose(false)} className="p-1 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              Both intents claim these questions. Pick which intent&apos;s <span className="font-medium">response</span> is
              right for each — not which definition sounds closer.
              {messageIds.length > sampled.length && (
                <> Showing {sampled.length} of {messageIds.length} overlap questions.</>
              )}
              {(!intentA.rule || !intentB.rule) && (
                <span className="text-amber-700">
                  {' '}
                  {!intentA.rule && `"${intentA.title}" has no rule yet — its side shows the unchanged response.`}{' '}
                  {!intentB.rule && `"${intentB.title}" has no rule yet — its side shows the unchanged response.`}
                </span>
              )}
            </p>

            {loading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-[hsl(var(--muted-foreground))]">
                <Loader2 className="w-4 h-4 animate-spin" /> Generating both responses for each question…
              </div>
            ) : (
              comparisons.map((c) => {
                const choice = choices.get(c.messageId);
                const clean = c.queryText.replace(/\s+/g, ' ').trim();
                const isExpanded = expanded === c.messageId;
                // No preview on either side → a choice would be blind (the
                // whole point is deciding by RESPONSES, §1.7) — disable.
                const comparable = c.a !== null && c.b !== null;
                return (
                  <div key={c.messageId} className="rounded-lg border border-[hsl(var(--border))] overflow-hidden">
                    <button
                      onClick={() => setExpanded(isExpanded ? null : c.messageId)}
                      className="w-full text-left px-3 py-2 bg-[hsl(var(--muted))]/40 border-b border-[hsl(var(--border))]"
                    >
                      <span className={`block text-xs text-[hsl(var(--foreground))] ${isExpanded ? 'whitespace-pre-wrap' : ''}`}>
                        <span className="font-semibold text-[hsl(var(--muted-foreground))]">Q&nbsp;</span>
                        {isExpanded ? c.queryText : clean.length > 180 ? `${clean.slice(0, 180)}…` : clean}
                      </span>
                    </button>
                    <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[hsl(var(--border))]">
                      {([
                        ['a', intentA, c.a],
                        ['b', intentB, c.b],
                      ] as const).map(([side, intent, text]) => (
                        <div key={side} className={`p-3 ${choice === side ? 'bg-emerald-50/60' : ''}`}>
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))] mb-1.5">
                            {intent.title}
                          </p>
                          {text ? (
                            <div className="prose prose-sm max-w-none dark:prose-invert text-[13px] max-h-56 overflow-y-auto">
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
                            </div>
                          ) : (
                            <p className="text-xs italic text-[hsl(var(--muted-foreground))]">Preview failed to generate.</p>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="px-3 py-2 border-t border-[hsl(var(--border))] flex flex-wrap gap-1.5">
                      {([
                        ['a', `${intentA.title} is right`],
                        ['b', `${intentB.title} is right`],
                        ['neither', 'Neither → new intent'],
                      ] as const).map(([value, label]) => (
                        <button
                          key={value}
                          disabled={!comparable}
                          title={comparable ? undefined : 'Preview generation failed — no blind decisions'}
                          onClick={() =>
                            setChoices((prev) => {
                              const next = new Map(prev);
                              if (next.get(c.messageId) === value) next.delete(c.messageId);
                              else next.set(c.messageId, value);
                              return next;
                            })
                          }
                          className={`px-2 py-1 rounded text-[11px] font-medium border disabled:opacity-40 disabled:cursor-not-allowed ${
                            choice === value
                              ? value === 'neither'
                                ? 'bg-violet-600 text-white border-violet-600'
                                : 'bg-emerald-600 text-white border-emerald-600'
                              : 'border-[hsl(var(--border))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })
            )}

            {error && (
              <p className="flex items-center gap-1 text-xs text-red-600">
                <AlertTriangle className="w-3.5 h-3.5" /> {error}
              </p>
            )}
          </div>

          <div className="px-4 py-3 border-t border-[hsl(var(--border))] space-y-2">
            {/* Commit actions appear as the choice pattern emerges. */}
            <div className="flex flex-wrap items-center gap-2">
              {converged && (
                <button
                  onClick={() => declareLink(converged)}
                  disabled={committing}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] disabled:opacity-50"
                  title="Declared as a tie-breaker — definitions stay untouched; remove it to undo"
                >
                  <Link2 className="w-3.5 h-3.5" />
                  Tie-breaker: {winnerOf(converged).title} <span className="font-bold">wins over</span>{' '}
                  {loserOf(converged).title}
                </button>
              )}
              {/* Pins are ALWAYS committable once any A/B decision exists —
                  primary when the choices split (or mixed with "neither"),
                  secondary alternative when they converged but the instructor
                  prefers question-level pins over a pair-wide link. */}
              {nA + nB > 0 && (
                <button
                  onClick={savePins}
                  disabled={committing}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium disabled:opacity-50 ${
                    converged
                      ? 'border border-[hsl(var(--border))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]'
                      : 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]'
                  }`}
                  title="Each decision is pinned 'in' on the chosen intent and 'out' on the other — the pins teach the boundary"
                >
                  <Pin className="w-3.5 h-3.5" />
                  {converged ? `Pin ${nA + nB} question${nA + nB > 1 ? 's' : ''} instead` : `Save ${nA + nB} contrast pin pair${nA + nB > 1 ? 's' : ''}`}
                </button>
              )}
              {nNeither > 0 && (
                <button
                  onClick={() => {
                    if (
                      nA + nB > 0 &&
                      !window.confirm(
                        `You have ${nA + nB} A/B decision(s) not saved as pins — discard them and create a new intent?`
                      )
                    ) {
                      return;
                    }
                    onCreateNew();
                  }}
                  disabled={committing}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-violet-300 text-violet-700 hover:bg-violet-50 disabled:opacity-50"
                  title="The overlap deserves its own response — create a C-intent that owns it"
                >
                  <Sparkles className="w-3.5 h-3.5" /> Create a new intent for this overlap
                </button>
              )}
              {decided.length === 0 && !loading && (
                <span className="text-xs text-[hsl(var(--muted-foreground))]">Pick a side for at least one question.</span>
              )}
              <div className="flex-1" />
              <button
                onClick={() => onClose(false)}
                className="px-3 py-1.5 text-xs rounded border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]"
              >
                Cancel
              </button>
            </div>
            <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
              {converged
                ? `The link resolves every current and future overlap between these two intents deterministically${
                    messageIds.length > sampled.length ? `, including the ${messageIds.length - sampled.length} not shown` : ''
                  }. Removing the link restores today's behavior.`
                : 'Previews are single-turn regenerations with the live chatbot model — indicative, not a guarantee.'}
            </p>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
