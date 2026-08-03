'use client';

/**
 * SCORE v7 — the New Intent chooser. EVERY intent is created through here.
 *
 * A blank create form does not tell an instructor what a good intent looks
 * like, so creation always opens on a chooser instead: candidates drafted from
 * the question in view, the taxonomy's starter sets for this query type, and —
 * still one click away — a blank one. Picking is only a seed; the workbench
 * that follows is where the intent is actually built.
 *
 * Two things the layout is answering:
 *
 *  - WHERE it lands. In the left column the "+ New intent" button says that by
 *    its indentation; once a modal covers the tree that is gone, so the scope
 *    line at the top is the first thing in the dialog and is present in every
 *    entry path (the anchor question is not — it may be absent).
 *
 *  - HOW LONG it takes. A starter set whose definition still matches a prepared
 *    template clones with its ratings copied server-side: zero LLM calls, so
 *    its questions are there the moment the workbench opens. That is a property
 *    of the DEFINITION TEXT, not of the row it came from — edit the wording and
 *    the match is gone — so it is computed off the live draft and shown next to
 *    Create, which is where the wait would otherwise happen.
 */
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, Loader2, Plus, RefreshCw, Sparkles, X, Zap } from 'lucide-react';
import type { ScoreQueryType } from '@/lib/score/intents';
import {
  LEGACY_TYPE_TO_QUERY_TYPE,
  jelsonToIntent,
  suggestJelson,
  type JelsonSuggestion,
} from '@/lib/score/jelson-suggest';
import type { ScoreQueryRow } from './IntentBoard';
import { MaterialSegments } from './materials';

/** How many starter sets ride above the fold. The rest are one click away — a
 * query type has 4–8 subtypes, so "show all" is never a long list. */
const STARTER_SHORTLIST = 3;

const ALTITUDE_LABELS = ['Specific', 'Broader category', 'Reframed'];

/** One thing the instructor can start from. `seed` is the starting text; what
 * they create is whatever they edit it into. */
interface Option {
  key: string;
  group: 'ai' | 'starter' | 'scratch';
  /** Small tag under the row — the altitude, the taxonomy code, or nothing. */
  tag: string | null;
  label: string;
  seed: { title: string; definition: string };
  /** Already a live intent in this assignment — shown, but not creatable. */
  taken?: boolean;
}

interface NewIntentModalProps {
  assignmentId: string;
  /** Where the new set lands. Known in every entry path — this is what the
   * modal shows in place of the create button's position in the tree. */
  scope: { type: ScoreQueryType; parentIntentId: number | null };
  /** The question in view when they asked, if any. Anchors the AI proposals
   * and ranks the starter sets. */
  anchorRow: ScoreQueryRow | null;
  /** The set the new one is carved out of — `scope.parentIntentId` resolved.
   * Null when the type's own rule is what answers the scope today. */
  currentIntent: { id: number; title: string } | null;
  /** The taxonomy, built once by the page. */
  jelsonSuggestions: JelsonSuggestion[];
  /** Prepared starter templates: a definition match clones with zero LLM calls. */
  templates: { id: number; title: string; definition: string }[];
  /** Definitions already live in this assignment (trimmed) — those starters are
   * shown, but not offered a second time. */
  liveDefinitions: Set<string>;
  openaiConfigured: boolean;
  typeLabel: string;
  onCancel: () => void;
  onPick: (seed: { title: string; definition: string; fromTemplateId?: number }) => void;
}

export default function NewIntentModal({
  assignmentId,
  scope,
  anchorRow,
  currentIntent,
  jelsonSuggestions,
  templates,
  liveDefinitions,
  openaiConfigured,
  typeLabel,
  onCancel,
  onPick,
}: NewIntentModalProps) {
  // --- Starter sets: instant, no round-trip --------------------------------
  // Ranked against the question in view when there is one; taxonomy order
  // otherwise. Ranking can return fewer than the shortlist (suggestJelson has a
  // relevance floor and returns [] for an unmatched query), so the remainder
  // pads from the top of the type — this group must never be empty, or the
  // chooser has nothing to show while the LLM proposals are still in flight.
  const starters = useMemo(() => {
    const scoped = jelsonSuggestions.filter(
      (j) => LEGACY_TYPE_TO_QUERY_TYPE[j.typeKey] === scope.type
    );
    const ranked = anchorRow
      ? suggestJelson(anchorRow.queryText, scoped, STARTER_SHORTLIST).map((m) => m.suggestion)
      : [];
    const seen = new Set(ranked.map((s) => s.code));
    // Padding never uses something already live — recommending a set that
    // exists is just a duplicate. A RANKED one is different: the question in
    // view matched it, so "that set already exists" is the most useful thing
    // the shortlist can say, and it stays (struck out, not creatable).
    const fresh = scoped.filter(
      (s) => !seen.has(s.code) && !liveDefinitions.has(jelsonToIntent(s).definition.trim())
    );
    const shortlist = [...ranked, ...fresh].slice(0, STARTER_SHORTLIST);
    const shortlisted = new Set(shortlist.map((s) => s.code));
    return { shortlist, overflow: scoped.filter((s) => !shortlisted.has(s.code)) };
  }, [jelsonSuggestions, scope.type, anchorRow, liveDefinitions]);

  const [showAllStarters, setShowAllStarters] = useState(false);

  // --- AI proposals: one LLM call, only with a question to anchor them ------
  const [suggestions, setSuggestions] = useState<{ title: string; definition: string }[] | null>(
    null
  );
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0); // bump to re-propose
  const wantsAi = !!anchorRow && openaiConfigured;

  useEffect(() => {
    if (!wantsAi || !anchorRow) return;
    const controller = new AbortController();
    setSuggestions(null);
    setSuggestError(null);
    void (async () => {
      try {
        const res = await fetch(
          `/api/instructor/assignments/${assignmentId}/score/intent-suggestions`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messageId: anchorRow.messageId,
              ...(currentIntent ? { currentIntentId: currentIntent.id } : {}),
              scopeType: scope.type,
            }),
            signal: controller.signal,
          }
        );
        const d = await res.json().catch(() => ({}));
        if (controller.signal.aborted) return;
        if (!res.ok) {
          throw new Error(typeof d?.message === 'string' ? d.message : 'Failed to propose intents.');
        }
        // The route promises 1–3 candidates, not exactly 3.
        setSuggestions((d.suggestions as { title: string; definition: string }[]).slice(0, 3));
      } catch (e) {
        if ((e as Error)?.name !== 'AbortError' && !controller.signal.aborted) {
          setSuggestError((e as Error).message);
        }
      }
    })();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, wantsAi]);

  // --- The one list --------------------------------------------------------
  const options = useMemo((): Option[] => {
    const list: Option[] = [];
    (suggestions ?? []).forEach((s, i) => {
      list.push({
        key: `ai-${i}`,
        group: 'ai',
        tag: ALTITUDE_LABELS[i] ?? `Option ${i + 1}`,
        label: s.title || 'Untitled proposal',
        seed: { title: s.title, definition: s.definition },
      });
    });
    const asOption = (s: JelsonSuggestion): Option => {
      const seed = jelsonToIntent(s);
      return {
        key: `starter-${s.code}`,
        group: 'starter',
        tag: s.code,
        label: s.label,
        seed,
        taken: liveDefinitions.has(seed.definition.trim()),
      };
    };
    starters.shortlist.forEach((s) => list.push(asOption(s)));
    if (showAllStarters) starters.overflow.forEach((s) => list.push(asOption(s)));
    list.push({
      key: 'scratch',
      group: 'scratch',
      tag: null,
      label: 'Start from scratch',
      seed: { title: '', definition: '' },
    });
    return list;
  }, [suggestions, starters, showAllStarters, liveDefinitions]);

  // Until something is picked, the selection FOLLOWS the list: a starter set at
  // first, then the top proposal the moment it arrives. Derived rather than set
  // from an effect, so the right pane is never briefly empty.
  const [pickedKey, setPickedKey] = useState<string | null>(null);
  const selected = useMemo(() => {
    const picked = pickedKey ? options.find((o) => o.key === pickedKey) : null;
    return picked ?? options.find((o) => !o.taken && o.group !== 'scratch') ?? null;
  }, [pickedKey, options]);
  const selectedKey = selected?.key ?? null;

  // Edits are kept per candidate, so switching between two to compare them does
  // not throw away what was typed into either.
  const [edits, setEdits] = useState<Record<string, { title: string; definition: string }>>({});
  const draft = selected ? edits[selected.key] ?? selected.seed : null;
  const editDraft = (patch: Partial<{ title: string; definition: string }>) => {
    if (!selected) return;
    setEdits((prev) => ({
      ...prev,
      [selected.key]: { ...(prev[selected.key] ?? selected.seed), ...patch },
    }));
  };

  // Prepared-ness follows the TEXT: type a definition by hand that matches a
  // template and the clone is just as free; change a starter's wording by one
  // character and it is not.
  const matchedTemplate = useMemo(() => {
    const def = draft?.definition.trim();
    if (!def) return null;
    return templates.find((t) => t.definition.trim() === def) ?? null;
  }, [draft?.definition, templates]);

  const creatable = !!draft && draft.definition.trim().length > 0 && !selected?.taken;

  const [queryOpen, setQueryOpen] = useState(false);

  function pick(o: Option) {
    if (o.taken) return;
    setPickedKey(o.key);
  }

  const groupOf = (group: Option['group']) => options.filter((o) => o.group === group);
  const starterRows = groupOf('starter');

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-3xl max-h-[88vh] flex flex-col rounded-lg bg-[hsl(var(--background))] border border-[hsl(var(--border))] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* WHERE IT LANDS — the promise the tree's indentation used to make. */}
        <div className="shrink-0 px-4 py-3 border-b border-[hsl(var(--border))] flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold flex items-center gap-1.5">
              <Plus className="w-4 h-4 shrink-0" /> New intent
            </h2>
            <p className="text-xs text-[hsl(var(--muted-foreground))] truncate">
              {currentIntent ? (
                <>
                  Inside{' '}
                  <span className="font-medium text-[hsl(var(--foreground))]">
                    “{currentIntent.title}”
                  </span>{' '}
                  · {typeLabel}
                </>
              ) : (
                <>Top level of {typeLabel}</>
              )}
            </p>
          </div>
          <button
            onClick={onCancel}
            className="p-1 shrink-0 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 flex">
          {/* LEFT — every way to start, in one scannable list. */}
          <div className="w-60 shrink-0 overflow-y-auto border-r border-[hsl(var(--border))] py-2">
            {wantsAi && (
              <Group label="From this question">
                {suggestError ? (
                  <div className="px-3 py-2 space-y-1.5">
                    <p className="flex items-start gap-1.5 text-[11px] text-red-600">
                      <AlertTriangle className="w-3 h-3 mt-px shrink-0" /> {suggestError}
                    </p>
                    <button
                      onClick={() => setNonce((n) => n + 1)}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-[hsl(var(--border))] text-[11px] font-medium hover:bg-[hsl(var(--muted))]"
                    >
                      <RefreshCw className="w-3 h-3" /> Retry
                    </button>
                  </div>
                ) : suggestions === null ? (
                  // The starter sets below are already usable — this group
                  // filling in must never be something to wait for.
                  <div className="px-3 py-1.5 space-y-2">
                    {[0, 1, 2].map((i) => (
                      <div
                        key={i}
                        className="h-3 rounded bg-[hsl(var(--muted))] animate-pulse"
                        style={{ width: `${80 - i * 12}%` }}
                      />
                    ))}
                    <p className="flex items-center gap-1.5 pt-0.5 text-[10px] text-[hsl(var(--muted-foreground))]">
                      <Loader2 className="w-3 h-3 animate-spin" /> Drafting candidates…
                    </p>
                  </div>
                ) : (
                  groupOf('ai').map((o) => (
                    <OptionRow
                      key={o.key}
                      option={o}
                      active={o.key === selectedKey}
                      edited={!!edits[o.key]}
                      onClick={() => pick(o)}
                    />
                  ))
                )}
              </Group>
            )}

            <Group label={`Starter sets · ${typeLabel}`}>
              {starterRows.map((o) => (
                <OptionRow
                  key={o.key}
                  option={o}
                  active={o.key === selectedKey}
                  edited={!!edits[o.key]}
                  onClick={() => pick(o)}
                />
              ))}
              {starters.overflow.length > 0 && (
                <button
                  onClick={() => setShowAllStarters((v) => !v)}
                  className="w-full text-left px-3 py-1 text-[11px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                >
                  {showAllStarters
                    ? 'Show fewer'
                    : `Show all ${starters.overflow.length + starterRows.length}`}
                </button>
              )}
            </Group>

            <div className="mt-1 pt-1 border-t border-[hsl(var(--border))]">
              {groupOf('scratch').map((o) => (
                <OptionRow
                  key={o.key}
                  option={o}
                  active={o.key === selectedKey}
                  edited={!!edits[o.key]}
                  onClick={() => pick(o)}
                />
              ))}
            </div>
          </div>

          {/* RIGHT — the candidate itself, editable whichever list it came from. */}
          <div className="flex-1 min-w-0 overflow-y-auto px-4 py-3 space-y-3">
            {!draft ? (
              <p className="py-8 text-center text-xs text-[hsl(var(--muted-foreground))]">
                Pick something to start from.
              </p>
            ) : (
              <>
                <label className="block space-y-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                    Title
                  </span>
                  <input
                    value={draft.title}
                    onChange={(e) => editDraft({ title: e.target.value })}
                    placeholder="Auto-named on save if empty"
                    className="w-full rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-[hsl(var(--primary))]"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                    When a question…
                  </span>
                  <textarea
                    value={draft.definition}
                    onChange={(e) => editDraft({ definition: e.target.value })}
                    rows={8}
                    placeholder="e.g. asks the chatbot to write a thesis statement or conclusion for them"
                    className="w-full resize-y rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5 text-xs leading-relaxed focus:outline-none focus:ring-1 focus:ring-[hsl(var(--primary))]"
                  />
                </label>
                {selected?.taken && (
                  <p className="flex items-start gap-1.5 text-[11px] text-amber-700">
                    <AlertTriangle className="w-3 h-3 mt-px shrink-0" /> This starter set is already
                    a live intent. Edit the definition to make it a different one.
                  </p>
                )}
              </>
            )}
          </div>
        </div>

        <div className="shrink-0 border-t border-[hsl(var(--border))]">
          {/* The anchor question, on tap. Reference material while editing the
              definition — not the subject of the dialog. */}
          {anchorRow && queryOpen && (
            <p className="px-4 pt-3 text-xs whitespace-pre-wrap max-h-32 overflow-y-auto leading-relaxed">
              <MaterialSegments text={anchorRow.queryText} dissection={anchorRow.dissection} />
            </p>
          )}
          <div className="px-4 py-3 flex items-center gap-3">
            {anchorRow ? (
              <button
                onClick={() => setQueryOpen((v) => !v)}
                className="min-w-0 flex-1 text-left text-[11px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] truncate"
                title="Show the question this was opened from"
              >
                {queryOpen ? '▾' : '▸'} {anchorRow.queryText}
              </button>
            ) : (
              <span className="flex-1" />
            )}
            {matchedTemplate && creatable && (
              <span
                className="shrink-0 inline-flex items-center gap-1 text-[11px] text-emerald-700"
                title="This definition is already rated across the log — the clone copies those ratings, so no rating pass is needed."
              >
                <Zap className="w-3 h-3" /> questions appear immediately
              </span>
            )}
            <button
              onClick={onCancel}
              className="shrink-0 px-3 py-1.5 rounded border border-[hsl(var(--border))] text-xs font-medium hover:bg-[hsl(var(--muted))]"
            >
              Cancel
            </button>
            <button
              onClick={() =>
                draft &&
                onPick({
                  title: draft.title.trim(),
                  definition: draft.definition.trim(),
                  ...(matchedTemplate ? { fromTemplateId: matchedTemplate.id } : {}),
                })
              }
              disabled={!creatable}
              title="Open the workbench seeded with this candidate"
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-[hsl(var(--primary))] text-xs font-medium text-[hsl(var(--primary-foreground))] disabled:opacity-50"
            >
              Create intent <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-1">
      <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
        {label}
      </p>
      {children}
    </div>
  );
}

function OptionRow({
  option,
  active,
  edited,
  onClick,
}: {
  option: Option;
  active: boolean;
  edited: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={option.taken}
      title={option.taken ? 'Already a live intent in this assignment' : option.seed.definition}
      className={`w-full text-left px-3 py-1.5 flex items-start gap-1.5 ${
        active
          ? 'bg-[hsl(var(--primary))]/10 border-l-2 border-[hsl(var(--primary))] pl-[10px]'
          : option.taken
            ? 'opacity-45'
            : 'hover:bg-[hsl(var(--muted))]/50'
      }`}
    >
      {option.group === 'ai' && (
        <Sparkles className="w-3 h-3 mt-0.5 shrink-0 text-violet-500" aria-hidden />
      )}
      {option.group === 'scratch' && <Plus className="w-3 h-3 mt-0.5 shrink-0" aria-hidden />}
      <span className="min-w-0 flex-1">
        <span className={`block text-xs truncate ${active ? 'font-medium' : ''}`}>
          {option.label}
        </span>
        {option.tag && (
          <span className="block text-[10px] text-[hsl(var(--muted-foreground))]">
            {option.tag}
            {edited && ' · edited'}
          </span>
        )}
      </span>
    </button>
  );
}
