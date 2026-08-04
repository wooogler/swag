'use client';

/**
 * The proposal-variant chooser: one feedback (or rewrite) now yields THREE
 * candidate rules — a minimal edit, a focused rework, and a full rewrite —
 * and this modal is where the instructor sees what each one actually changes
 * before anything is recorded.
 *
 * Per variant, side by side:
 *   · the rule as a word-diff against the rule the proposal revises (the
 *     complaint "the LLM barely changed anything" was really "I can't SEE
 *     what changed" — the diff answers it directly), full text a toggle away
 *   · the active question's response regenerated under that rule (draft
 *     preview, uncached), loading in parallel while the instructor reads
 *
 * Only the chosen variant becomes a version (the caller records it); Cancel
 * records nothing and keeps the feedback text for another try.
 */
import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Loader2, Sparkles, X } from 'lucide-react';
import type { ScoreQueryRow } from './IntentBoard';
import { ResponseBody } from './conversation';
import { QuerySnippet } from './materials';
import { RuleDiff } from './rule-diff';

export type ProposalStrength = 'minimal' | 'moderate' | 'aggressive';

export interface ProposalVariant {
  strength: ProposalStrength;
  revisedRule: string;
  title: string;
  note: string;
}

const STRENGTH_LABEL: Record<ProposalStrength, { name: string; hint: string }> = {
  minimal: { name: 'Minimal edit', hint: 'changes only what you asked for' },
  moderate: { name: 'Focused rework', hint: 'also reworks the part it touches' },
  aggressive: { name: 'Full rewrite', hint: 'rebuilds the rule around your input' },
};

interface ProposalPreviewModalProps {
  assignmentId: string;
  intentId: number;
  /** The rule these proposals revise — the diff's left side. */
  baseRule: string | null;
  variants: ProposalVariant[];
  /** The question the previews regenerate (the workbench's active tab). */
  row: ScoreQueryRow;
  /** The chosen variant is being recorded — freeze the buttons. */
  busy: boolean;
  onChoose: (variant: ProposalVariant, previewText: string | null) => void;
  onClose: () => void;
}

export default function ProposalPreviewModal({
  assignmentId,
  intentId,
  baseRule,
  variants,
  row,
  busy,
  onChoose,
  onClose,
}: ProposalPreviewModalProps) {
  const base = `/api/instructor/assignments/${assignmentId}/score`;
  // strength → generated response (null = failed; absent = loading).
  const [previews, setPreviews] = useState<Partial<Record<ProposalStrength, string | null>>>({});
  const [fullText, setFullText] = useState<Partial<Record<ProposalStrength, boolean>>>({});
  const [chosen, setChosen] = useState<ProposalStrength | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Generate each variant's response for the active question, in parallel.
  useEffect(() => {
    const controller = new AbortController();
    for (const v of variants) {
      void (async () => {
        try {
          const res = await fetch(`${base}/preview`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              intentId,
              messageIds: [row.messageId],
              draftRule: v.revisedRule,
            }),
            signal: controller.signal,
          });
          const data = await res.json().catch(() => ({}));
          if (controller.signal.aborted) return;
          if (!res.ok) throw new Error(typeof data?.message === 'string' ? data.message : 'Preview failed.');
          const text =
            (data.previews as { messageId: number; response: string | null }[]).find(
              (p) => p.messageId === row.messageId
            )?.response ?? null;
          setPreviews((prev) => ({ ...prev, [v.strength]: text }));
        } catch (e) {
          if ((e as Error)?.name === 'AbortError' || controller.signal.aborted) return;
          setError((e as Error).message);
          setPreviews((prev) => ({ ...prev, [v.strength]: null }));
        }
      })();
    }
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Literal class names — Tailwind only generates classes it can see.
  const cols =
    variants.length >= 3
      ? 'grid-cols-1 lg:grid-cols-3'
      : variants.length === 2
        ? 'grid-cols-1 lg:grid-cols-2'
        : 'grid-cols-1';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-7xl h-[90vh] flex flex-col rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 flex items-center justify-between gap-3 px-5 py-3 border-b border-[hsl(var(--border))]">
          <div className="min-w-0">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-[hsl(var(--foreground))]">
              <Sparkles className="w-4 h-4 text-[hsl(var(--primary))]" /> Pick how far the revision goes
            </h3>
            <p className="mt-0.5 truncate text-xs text-[hsl(var(--muted-foreground))]">
              Previewing on{' '}
              <span className="font-mono">
                {row.participantToken || '—'}
                {row.turnNumber > 0 ? ` · T${row.turnNumber}` : ''}
              </span>
              {' · '}
              <QuerySnippet text={row.queryText} dissection={row.dissection} max={80} />
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {error && (
              <span className="flex items-center gap-1 text-xs text-red-600">
                <AlertTriangle className="w-3.5 h-3.5" /> {error}
              </span>
            )}
            <button
              onClick={onClose}
              disabled={busy}
              className="p-1.5 rounded hover:bg-[hsl(var(--muted))] disabled:opacity-40"
              aria-label="Close without applying"
              title="Close — nothing is recorded, your feedback stays in the box"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className={`flex-1 min-h-0 grid ${cols} gap-3 p-3 overflow-y-auto lg:overflow-y-hidden`}>
          {variants.map((v) => {
            const label = STRENGTH_LABEL[v.strength];
            const loaded = v.strength in previews;
            const text = previews[v.strength] ?? null;
            const showFull = fullText[v.strength] ?? false;
            const isChosen = chosen === v.strength;
            return (
              <div
                key={v.strength}
                className="flex flex-col min-h-[420px] lg:min-h-0 rounded-lg border border-[hsl(var(--border))] overflow-hidden"
              >
                <div className="shrink-0 px-3 py-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40">
                  <p className="flex items-baseline gap-1.5 flex-wrap">
                    <span className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--foreground))]">
                      {label.name}
                    </span>
                    <span className="text-[11px] text-[hsl(var(--muted-foreground))]">{label.hint}</span>
                  </p>
                  {(v.title || v.note) && (
                    <p className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">
                      {v.title && <span className="font-medium text-[hsl(var(--foreground))]">{v.title}</span>}
                      {v.title && v.note ? ' — ' : ''}
                      {v.note}
                    </p>
                  )}
                </div>

                <div className="flex-1 min-h-0 flex flex-col overflow-y-auto">
                  {/* THE RULE — what this variant changes, as a diff. */}
                  <div className="shrink-0 border-b border-[hsl(var(--border))]">
                    <div className="flex items-center justify-between px-3 pt-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                        Rule changes
                      </p>
                      <button
                        onClick={() => setFullText((prev) => ({ ...prev, [v.strength]: !showFull }))}
                        className="text-[10px] font-medium text-[hsl(var(--primary))] hover:underline"
                      >
                        {showFull ? 'Show diff' : 'Show full text'}
                      </button>
                    </div>
                    <div className="max-h-56 overflow-y-auto px-3 py-2">
                      {showFull ? (
                        <p className="whitespace-pre-wrap text-xs leading-relaxed">{v.revisedRule}</p>
                      ) : (
                        <RuleDiff before={baseRule} after={v.revisedRule} />
                      )}
                    </div>
                  </div>

                  {/* THE EFFECT — the active question regenerated under it. */}
                  <div className="flex-1 px-3 py-2">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                      Response under this rule
                    </p>
                    {!loaded ? (
                      <p className="flex items-center gap-2 py-3 text-xs text-[hsl(var(--muted-foreground))]">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating…
                      </p>
                    ) : text ? (
                      <ResponseBody text={text} raw={false} />
                    ) : (
                      <p className="text-xs italic text-[hsl(var(--muted-foreground))]">
                        Generation failed — choosing this variant will retry it.
                      </p>
                    )}
                  </div>
                </div>

                <div className="shrink-0 border-t border-[hsl(var(--border))] px-3 py-2">
                  <button
                    onClick={() => {
                      setChosen(v.strength);
                      onChoose(v, text);
                    }}
                    disabled={busy}
                    className="w-full inline-flex items-center justify-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] disabled:opacity-50"
                    title="Record this variant as the next step (the live rule changes only when you Apply)"
                  >
                    {busy && isChosen ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Check className="w-3.5 h-3.5" />
                    )}
                    Use this rule
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
