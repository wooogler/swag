'use client';

/**
 * SCORE v6 — "make this a NEW intent" modal (rule workbench escape hatch).
 *
 * When a question the instructor is revising turns out not to belong to the
 * intent, this modal proposes THREE intent candidates seeded from that
 * question (specific / category / reframed — see the intent-suggestions
 * route). Every field is editable in place; picking one hands the seed to the
 * New Intent workbench.
 */
import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, Loader2, Plus, RefreshCw, X } from 'lucide-react';
import type { ScoreQueryType } from '@/lib/score/intents';
import type { ScoreQueryRow } from './IntentBoard';
import { MaterialSegments } from './materials';

interface Suggestion {
  title: string;
  definition: string;
}

const ALTITUDE_LABELS = ['Specific', 'Broader category', 'Reframed'];

interface NewIntentSuggestModalProps {
  assignmentId: string;
  /** The question that doesn't fit — becomes the seed's anchor. */
  row: ScoreQueryRow;
  /** The scope the new set is carved out of: the intent that answers this
   * question today, or null when its type's own rule does. */
  currentIntent: { id: number; title: string } | null;
  /** Query type of the anchor question — the type the new set will live in. */
  scopeType?: ScoreQueryType | null;
  onCancel: () => void;
  onPick: (seed: { title: string; definition: string }) => void;
}

export default function NewIntentSuggestModal({
  assignmentId,
  row,
  currentIntent,
  scopeType,
  onCancel,
  onPick,
}: NewIntentSuggestModalProps) {
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0); // bump to re-propose

  useEffect(() => {
    const controller = new AbortController();
    setSuggestions(null);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(`/api/instructor/assignments/${assignmentId}/score/intent-suggestions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messageId: row.messageId,
            ...(currentIntent ? { currentIntentId: currentIntent.id } : {}),
            ...(scopeType ? { scopeType } : {}),
          }),
          signal: controller.signal,
        });
        const d = await res.json().catch(() => ({}));
        if (controller.signal.aborted) return;
        if (!res.ok) {
          throw new Error(typeof d?.message === 'string' ? d.message : 'Failed to propose intents.');
        }
        setSuggestions((d.suggestions as Suggestion[]).slice(0, 3));
        setSelected(0);
      } catch (e) {
        if ((e as Error)?.name !== 'AbortError' && !controller.signal.aborted) {
          setError((e as Error).message);
        }
      }
    })();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);

  const editSuggestion = (i: number, patch: Partial<Suggestion>) => {
    setSuggestions((prev) => (prev ? prev.map((s, j) => (j === i ? { ...s, ...patch } : s)) : prev));
    setSelected(i); // editing a card selects it
  };

  const picked = suggestions?.[selected] ?? null;
  const pickable = !!picked && picked.definition.trim().length > 0;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-2xl max-h-[88vh] flex flex-col rounded-lg bg-[hsl(var(--background))] border border-[hsl(var(--border))] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 px-4 py-3 border-b border-[hsl(var(--border))] flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold flex items-center gap-1.5">
            <Plus className="w-4 h-4" /> New intent from this question
          </h2>
          <button
            onClick={onCancel}
            className="p-1 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3">
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            {currentIntent ? (
              <>
                This question doesn&apos;t really fit{' '}
                <span className="font-medium text-[hsl(var(--foreground))]">
                  “{currentIntent.title}”
                </span>{' '}
                — give it an intent of its own.
              </>
            ) : (
              <>
                No intent answers this question yet — its type&apos;s own rule does. Give it one.
              </>
            )}{' '}
            Pick one of the proposals below (everything is editable), and it becomes the seed of the
            New Intent workbench.
          </p>
          <p className="text-xs whitespace-pre-wrap rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 p-2 max-h-28 overflow-y-auto leading-relaxed">
            <MaterialSegments text={row.queryText} dissection={row.dissection} />
          </p>

          {error ? (
            <div className="flex items-center gap-2 text-xs text-red-600">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {error}
              <button
                onClick={() => setNonce((n) => n + 1)}
                className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded border border-[hsl(var(--border))] text-[11px] font-medium text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]"
              >
                <RefreshCw className="w-3 h-3" /> Retry
              </button>
            </div>
          ) : suggestions === null ? (
            <p className="flex items-center gap-2 py-6 text-xs text-[hsl(var(--muted-foreground))]">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Proposing three intents for this question…
            </p>
          ) : (
            <div className="space-y-2">
              {suggestions.map((s, i) => {
                const active = i === selected;
                return (
                  <div
                    key={i}
                    onClick={() => setSelected(i)}
                    className={`rounded-lg border p-2.5 space-y-1.5 cursor-pointer ${
                      active
                        ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5'
                        : 'border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/30'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`shrink-0 w-3 h-3 rounded-full border ${
                          active
                            ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))]'
                            : 'border-[hsl(var(--border))]'
                        }`}
                      />
                      <span className="shrink-0 rounded bg-[hsl(var(--muted))] px-1.5 py-0.5 text-[10px] font-medium text-[hsl(var(--muted-foreground))]">
                        {ALTITUDE_LABELS[i] ?? `Option ${i + 1}`}
                      </span>
                      <input
                        value={s.title}
                        onChange={(e) => editSuggestion(i, { title: e.target.value })}
                        placeholder="Title (auto-named on save if empty)"
                        className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs font-medium focus:border-[hsl(var(--border))] focus:bg-[hsl(var(--background))] focus:outline-none"
                      />
                    </div>
                    <textarea
                      value={s.definition}
                      onChange={(e) => editSuggestion(i, { definition: e.target.value })}
                      rows={3}
                      className="w-full resize-y rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5 text-xs leading-relaxed"
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="shrink-0 px-4 py-3 border-t border-[hsl(var(--border))] flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded border border-[hsl(var(--border))] text-xs font-medium hover:bg-[hsl(var(--muted))]"
          >
            Cancel
          </button>
          <button
            onClick={() => picked && onPick({ title: picked.title.trim(), definition: picked.definition.trim() })}
            disabled={!pickable}
            title="Open the New Intent workbench seeded with this candidate"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-[hsl(var(--primary))] text-xs font-medium text-[hsl(var(--primary-foreground))] disabled:opacity-50"
          >
            Create intent <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
