'use client';

/**
 * SCORE v6 — Revise modal (S2, §1.10/§2.2): Before | Intent&Rule + actions | After.
 *
 * Three GUI actions produce a DRAFT rule, always reviewed as a diff before
 * anything applies (제안 → diff 검토 → 승인):
 *  ① direct edit — type the rule yourself,
 *  ② feedback — say what's wrong; the agent folds it into a revised rule,
 *  ③ rewrite — edit the response to what you wanted; the agent infers the
 *    generalizable rule change.
 *
 * The anchor's "before" is the response the student was ACTUALLY served
 * (row.responseText), shown verbatim — the instructor's feedback refers to
 * that exact text. With a draft in hand its "after" regenerates, and the
 * edge-case sweep (§1.10: farthest-by-meaning, boundary, recent — ranked by
 * response delta once generated) checks where the change might break. Broken
 * cases take feedback that folds into the SAME draft — the rule hardens
 * incrementally before one Apply commits it (immediate + version record).
 *
 * "After"/sweep previews are single-turn regenerations under Base + Rule with
 * the live chatbot model — indicative, not a guarantee (§4.6).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { AlertTriangle, Check, ChevronDown, ChevronRight, Loader2, Pencil, Plus, Sparkles, Wand2, X } from 'lucide-react';
import type { IntentSummary, ScoreQueryRow } from './IntentBoard';
import { MaterialSegments } from './materials';

interface ReviseModalProps {
  assignmentId: string;
  row: ScoreQueryRow; // anchor question (assigned to `intent`)
  intent: IntentSummary;
  /** Always-applied base prompt — surfaced here so "no rule → base prompt only"
   * is verifiable and the "on top of everything above" rule framing is legible. */
  basePrompt: string;
  /** NIRVANA import → render the delivered response as raw text (its
   * single-newline line breaks would be collapsed by markdown). */
  isNirvana: boolean;
  onClose: (changed: boolean) => void;
  /** "이 요청이 이 Intent에 안 맞나요?" → New Intent flow seeded from the anchor. */
  onCreateInstead: () => void;
}

interface Draft {
  rule: string | null;
  source: 'direct' | 'feedback' | 'rewrite';
  note?: string;
}

interface EdgeCase {
  messageId: number;
  queryText: string;
  reason: 'farthest' | 'boundary' | 'recent';
  before: string | null;
  after: string | null;
  feedback: string;
  folding: boolean;
}

/* ---- word-level diff (LCS) — rules are ≤~200 words, O(n·m) is nothing ---- */
type DiffPart = { type: 'same' | 'del' | 'ins'; text: string };

function wordDiff(oldText: string, newText: string): DiffPart[] {
  const a = oldText.split(/\s+/).filter(Boolean);
  const b = newText.split(/\s+/).filter(Boolean);
  const m = a.length;
  const n = b.length;
  // Rules are capped server-side (~1.5k words), but guard the quadratic DP
  // anyway — beyond this, show a plain old/new replacement instead of a diff.
  if (m * n > 4_000_000) {
    return [
      ...(oldText ? [{ type: 'del' as const, text: oldText }] : []),
      ...(newText ? [{ type: 'ins' as const, text: newText }] : []),
    ];
  }
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const parts: DiffPart[] = [];
  const push = (type: DiffPart['type'], text: string) => {
    const last = parts[parts.length - 1];
    if (last && last.type === type) last.text += ` ${text}`;
    else parts.push({ type, text });
  };
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      push('same', a[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push('del', a[i]);
      i++;
    } else {
      push('ins', b[j]);
      j++;
    }
  }
  while (i < m) push('del', a[i++]);
  while (j < n) push('ins', b[j++]);
  return parts;
}

/** Rough response delta for ranking sweep results (client-side ③변화 크기). */
function responseDelta(before: string | null, after: string | null): number {
  if (before === null || after === null) return 0;
  const setOf = (t: string) => new Set(t.toLowerCase().split(/\s+/).filter(Boolean));
  const A = setOf(before);
  const B = setOf(after);
  let common = 0;
  for (const w of A) if (B.has(w)) common += 1;
  const union = A.size + B.size - common;
  return union === 0 ? 0 : 1 - common / union;
}

function Markdown({ text, raw = false }: { text: string; raw?: boolean }) {
  // raw = render verbatim (NIRVANA's raw-text replies, whose single newlines
  // markdown would collapse); otherwise render as markdown.
  if (raw) {
    return <p className="whitespace-pre-wrap break-words text-[13px] text-[hsl(var(--foreground))]">{text}</p>;
  }
  return (
    <div className="prose prose-sm max-w-none dark:prose-invert text-[13px]">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}

const REASON_LABEL: Record<EdgeCase['reason'], string> = {
  farthest: 'most different request',
  boundary: 'barely in',
  recent: 'most recent',
};

export default function ReviseModal({
  assignmentId,
  row,
  intent,
  basePrompt,
  isNirvana,
  onClose,
  onCreateInstead,
}: ReviseModalProps) {
  const base = `/api/instructor/assignments/${assignmentId}/score`;
  const [basePromptOpen, setBasePromptOpen] = useState(false);

  // Original response = the reply the student ACTUALLY received (recorded at
  // deploy time), shown verbatim — NOT a fresh regeneration. Regenerating here
  // produced a different answer than the one the instructor was looking at; the
  // feedback/rewrite refers to THIS exact text, so it's also what we hand the
  // agent as `currentResponse` when inferring the rule change.
  const originalResponse = row.responseText?.trim() ? row.responseText : null;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [updatedPreview, setUpdatedPreview] = useState<string | null>(null);
  const [updatedLoading, setUpdatedLoading] = useState(false);

  const [ruleEditorOpen, setRuleEditorOpen] = useState(false);
  const [ruleEditorText, setRuleEditorText] = useState(intent.rule ?? '');
  const [feedback, setFeedback] = useState('');
  const [rewriteOpen, setRewriteOpen] = useState(false);
  const [rewriteText, setRewriteText] = useState('');
  const [proposing, setProposing] = useState(false);

  const [edgeCases, setEdgeCases] = useState<EdgeCase[] | null>(null);
  const [sweeping, setSweeping] = useState(false);
  const [expandedCase, setExpandedCase] = useState<number | null>(null);

  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Conditionally mounted by the parent → the abort genuinely fires on close.
  const abortRef = useRef<AbortController>(new AbortController());
  useEffect(() => {
    const controller = abortRef.current;
    return () => controller.abort();
  }, []);
  const signal = () => abortRef.current.signal;
  const live = () => !abortRef.current.signal.aborted;
  // Draft generation counter — every adopted draft bumps it, and every async
  // producer (updated preview, sweep) captures it at start and discards its
  // results if a newer draft superseded it mid-flight. Without this, a slow
  // preview/sweep started under draft A lands under draft B's diff.
  const draftGenRef = useRef(0);

  async function fetchPreviews(messageIds: number[], draftRule?: string | null) {
    const res = await fetch(`${base}/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intentId: intent.id,
        messageIds,
        ...(draftRule !== undefined ? { draftRule } : {}),
      }),
      signal: signal(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(typeof data?.message === 'string' ? data.message : 'Preview generation failed.');
    }
    return new Map<number, string | null>(
      (data.previews as { messageId: number; response: string | null }[]).map((p) => [p.messageId, p.response])
    );
  }

  // A new draft invalidates the After column and the sweep results.
  async function adoptDraft(next: Draft) {
    const gen = ++draftGenRef.current;
    const fresh = () => live() && gen === draftGenRef.current;
    setError(null); // a new draft supersedes any stale operation error
    setDraft(next);
    setEdgeCases(null);
    setUpdatedPreview(null);
    setUpdatedLoading(true);
    try {
      const m = await fetchPreviews([row.messageId], next.rule);
      if (fresh()) setUpdatedPreview(m.get(row.messageId) ?? null);
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError' && fresh()) setError((e as Error).message);
    } finally {
      if (fresh()) setUpdatedLoading(false);
    }
  }

  async function propose(
    payload: object,
    // Which affordance produced the payload — only ITS input resets on
    // success (a sweep fold-in must not wipe unsent center-column feedback).
    origin?: 'feedback' | 'rewrite'
  ): Promise<void> {
    setProposing(true);
    setError(null);
    try {
      const res = await fetch(`${base}/intents/${intent.id}/propose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: signal(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data?.message === 'string' ? data.message : 'Proposal failed.');
      }
      if (live()) {
        await adoptDraft({
          rule: data.revisedRule as string,
          source: (data.mode as 'feedback' | 'rewrite') ?? 'feedback',
          note: (data.note as string) || undefined,
        });
        if (origin === 'feedback') setFeedback('');
        if (origin === 'rewrite') setRewriteOpen(false);
      }
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError' && live()) setError((e as Error).message);
    } finally {
      if (live()) {
        setProposing(false);
        // A failed fold-in must not leave its case flagged busy forever
        // (adoptDraft nulls the list on success, so this is a no-op there).
        setEdgeCases((prev) => (prev ? prev.map((c) => (c.folding ? { ...c, folding: false } : c)) : prev));
      }
    }
  }

  async function runSweep() {
    if (!draft || sweeping) return;
    // Sweep results are only valid for the draft they were generated under.
    const gen = draftGenRef.current;
    const fresh = () => live() && gen === draftGenRef.current;
    setSweeping(true);
    setError(null);
    try {
      const res = await fetch(`${base}/intents/${intent.id}/edgecases?anchor=${row.messageId}`, {
        signal: signal(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error('Edge-case lookup failed.');
      const cases = (data.cases ?? []) as { messageId: number; queryText: string; reason: EdgeCase['reason'] }[];
      if (cases.length === 0) {
        if (fresh()) setEdgeCases([]);
        return;
      }
      const ids = cases.map((c) => c.messageId);
      const [beforeMap, afterMap] = await Promise.all([
        fetchPreviews(ids),
        fetchPreviews(ids, draft.rule),
      ]);
      if (!fresh()) return;
      const enriched: EdgeCase[] = cases
        .map((c) => ({
          ...c,
          before: beforeMap.get(c.messageId) ?? null,
          after: afterMap.get(c.messageId) ?? null,
          feedback: '',
          folding: false,
        }))
        // ③변화 크기 — biggest response change first.
        .sort((x, y) => responseDelta(y.before, y.after) - responseDelta(x.before, x.after));
      setEdgeCases(enriched);
      setExpandedCase(enriched[0]?.messageId ?? null);
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError' && live()) setError((e as Error).message);
    } finally {
      if (live()) setSweeping(false);
    }
  }

  /** Sweep hardening loop: fold a broken case's feedback into the DRAFT. */
  async function foldCaseFeedback(ec: EdgeCase) {
    if (!draft || !ec.feedback.trim()) return;
    setEdgeCases((prev) =>
      prev?.map((c) => (c.messageId === ec.messageId ? { ...c, folding: true } : c)) ?? null
    );
    await propose({
      mode: 'feedback',
      messageId: ec.messageId,
      feedback: ec.feedback.trim(),
      currentResponse: ec.after ?? undefined,
      draftRule: draft.rule,
    });
  }

  async function applyDraft() {
    if (!draft || applying) return;
    setApplying(true);
    setError(null);
    try {
      const res = await fetch(`${base}/intents/${intent.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rule: draft.rule,
          provenance: { via: draft.source, anchorMessageId: row.messageId },
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(typeof d?.message === 'string' ? d.message : 'Apply failed.');
      }
      onClose(true);
    } catch (e) {
      setError((e as Error).message);
      setApplying(false);
    }
  }

  const savedRule = intent.rule ?? '';
  const diff = useMemo(
    () => (draft ? wordDiff(savedRule, draft.rule ?? '') : null),
    [draft, savedRule]
  );
  const draftDirty = draft !== null && (draft.rule ?? '') !== savedRule;

  return (
    <Dialog open onClose={() => onClose(false)} className="relative z-50">
      <div className="fixed inset-0 bg-black/40" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="w-full max-w-5xl h-[88vh] flex flex-col overflow-hidden rounded-lg bg-[hsl(var(--card))] border border-[hsl(var(--border))] shadow-xl">
          <div className="px-4 py-3 border-b border-[hsl(var(--border))] flex items-center justify-between gap-2">
            <DialogTitle className="text-sm font-semibold truncate">
              Revise — {intent.title}
            </DialogTitle>
            <button onClick={() => onClose(false)} className="p-1 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            <div className="grid grid-cols-1 lg:grid-cols-3 divide-y lg:divide-y-0 lg:divide-x divide-[hsl(var(--border))]">
              {/* LEFT — anchor + Original Response */}
              <div className="p-4 space-y-3">
                <div>
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))] mb-1">
                    Student question
                  </h3>
                  <p className="text-xs whitespace-pre-wrap rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 p-2 max-h-40 overflow-y-auto">
                    <MaterialSegments text={row.queryText} dissection={row.dissection} compact />
                  </p>
                </div>
                <div>
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))] mb-1">
                    Original response <span className="font-normal normal-case">(as delivered)</span>
                  </h3>
                  {!originalResponse ? (
                    <p className="text-xs italic text-[hsl(var(--muted-foreground))]">
                      No chatbot response was recorded for this question.
                    </p>
                  ) : rewriteOpen ? (
                    // EDIT mode — the markdown view is replaced in place by the
                    // editable response; the agent infers the rule from the edit.
                    <div className="space-y-1.5">
                      <textarea
                        value={rewriteText}
                        onChange={(e) => setRewriteText(e.target.value)}
                        rows={12}
                        className="w-full text-xs border border-[hsl(var(--border))] rounded px-2 py-1.5 bg-[hsl(var(--background))]"
                      />
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setRewriteOpen(false)}
                          className="px-2.5 py-1 rounded text-[11px] font-medium border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() =>
                            propose(
                              {
                                mode: 'rewrite',
                                messageId: row.messageId,
                                editedResponse: rewriteText.trim(),
                                currentResponse: originalResponse ?? undefined,
                                ...(draft ? { draftRule: draft.rule } : {}),
                              },
                              'rewrite'
                            )
                          }
                          disabled={proposing || sweeping || !rewriteText.trim()}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] disabled:opacity-50"
                        >
                          {proposing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                          Propose rule from my rewrite
                        </button>
                      </div>
                    </div>
                  ) : (
                    // VIEW mode — rendered markdown, with a visible Rewrite button.
                    <>
                      <div className="rounded border border-[hsl(var(--border))] p-2 max-h-72 overflow-y-auto">
                        <Markdown text={originalResponse} raw={isNirvana} />
                      </div>
                      <button
                        onClick={() => {
                          setRewriteText(originalResponse);
                          setRewriteOpen(true);
                        }}
                        className="mt-1.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]"
                        title="Rewrite the response the way you want it — the agent infers the rule change"
                      >
                        <Pencil className="w-3 h-3" /> Rewrite this response instead
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* CENTER — Intent & Rule + actions */}
              <div className="p-4 space-y-3">
                <div className="rounded border border-[hsl(var(--border))] p-2.5 space-y-1.5">
                  {/* Base prompt — always applied beneath the rule; kept above
                      When/Then so what every reply is generated against is
                      verifiable. Collapsed by default. */}
                  <div className="pb-1.5 border-b border-[hsl(var(--border))]">
                    <button
                      onClick={() => setBasePromptOpen((v) => !v)}
                      className="w-full flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                    >
                      <ChevronRight className={`w-3 h-3 transition-transform ${basePromptOpen ? 'rotate-90' : ''}`} />
                      Base prompt <span className="font-normal normal-case">(always applied)</span>
                    </button>
                    {basePromptOpen && (
                      <div className="mt-1 space-y-1">
                        {basePrompt.trim() ? (
                          <p className="text-[11px] text-[hsl(var(--muted-foreground))] whitespace-pre-wrap max-h-40 overflow-y-auto rounded bg-[hsl(var(--muted))]/30 p-1.5">
                            {basePrompt}
                          </p>
                        ) : (
                          <p className="text-[11px] italic text-[hsl(var(--muted-foreground))]">
                            Empty — with no rule, the chatbot answers with no system prompt at all.
                          </p>
                        )}
                        <p className="text-[10px] italic text-[hsl(var(--muted-foreground))]">
                          Managed in assignment settings — not edited in the SCORE loop.
                        </p>
                      </div>
                    )}
                  </div>
                  <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
                    <span className="font-semibold uppercase tracking-wide">When</span> {intent.definition}
                  </p>
                  <div className="text-[11px] text-[hsl(var(--muted-foreground))]">
                    <span className="font-semibold uppercase tracking-wide">Then</span>{' '}
                    {savedRule ? (
                      <span className="whitespace-pre-wrap">{savedRule}</span>
                    ) : (
                      <span className="italic">No rule yet — base prompt applies.</span>
                    )}
                    {!ruleEditorOpen && (
                      <button
                        onClick={() => {
                          setRuleEditorText(draft ? draft.rule ?? '' : savedRule);
                          setRuleEditorOpen(true);
                        }}
                        className="ml-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-[hsl(var(--border))] text-[10px] font-medium text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] align-middle"
                        title="Edit the rule text directly"
                      >
                        <Pencil className="w-2.5 h-2.5" /> Edit rule
                      </button>
                    )}
                  </div>
                </div>

                {ruleEditorOpen && (
                  <div className="space-y-1.5">
                    <textarea
                      value={ruleEditorText}
                      onChange={(e) => setRuleEditorText(e.target.value)}
                      rows={6}
                      placeholder="Empty = no rule (base prompt only)."
                      className="w-full text-xs border border-[hsl(var(--border))] rounded px-2 py-1.5 bg-[hsl(var(--background))]"
                    />
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => setRuleEditorOpen(false)}
                        className="px-2.5 py-1 rounded text-[11px] font-medium border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => {
                          setRuleEditorOpen(false);
                          void adoptDraft({ rule: ruleEditorText.trim() || null, source: 'direct' });
                        }}
                        disabled={proposing || sweeping}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] disabled:opacity-50"
                      >
                        <Check className="w-3 h-3" /> Use this rule
                      </button>
                    </div>
                  </div>
                )}

                {/* Main affordance — feedback → agent proposal */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                    What&apos;s wrong with this response?
                  </label>
                  <textarea
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    rows={3}
                    placeholder='e.g. "Too long", "Don&apos;t hand over the answer — ask them first"'
                    className="w-full text-xs border border-[hsl(var(--border))] rounded px-2 py-1.5 bg-[hsl(var(--background))]"
                  />
                  <div className="flex items-center justify-between gap-2">
                    {/* Escape hatch — this request doesn't belong to this intent;
                        carve out a new one seeded from it. */}
                    <button
                      onClick={onCreateInstead}
                      title={`This isn't really "${intent.title}" — create a new intent seeded from this question`}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium border border-violet-300 text-violet-700 hover:bg-violet-50"
                    >
                      <Plus className="w-3 h-3" /> New intent instead
                    </button>
                    <button
                      onClick={() =>
                        propose(
                          {
                            mode: 'feedback',
                            messageId: row.messageId,
                            feedback: feedback.trim(),
                            currentResponse: originalResponse ?? undefined,
                            ...(draft ? { draftRule: draft.rule } : {}),
                          },
                          'feedback'
                        )
                      }
                      disabled={proposing || sweeping || !feedback.trim()}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] disabled:opacity-50"
                    >
                      {proposing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                      Propose revision
                    </button>
                  </div>
                </div>

                {/* Draft diff — the review artifact every action funnels into */}
                {draft && diff && (
                  <div className="rounded border border-[hsl(var(--border))] p-2.5 space-y-1.5 bg-[hsl(var(--muted))]/20">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                      Proposed rule{' '}
                      <span className="font-normal normal-case">
                        (via {draft.source === 'direct' ? 'direct edit' : draft.source})
                      </span>
                    </p>
                    <p className="text-xs leading-relaxed">
                      {diff.map((p, i) =>
                        p.type === 'same' ? (
                          <span key={i}>{p.text} </span>
                        ) : p.type === 'del' ? (
                          <del key={i} className="bg-rose-50 text-rose-700 rounded-[2px] px-0.5 mr-1">
                            {p.text}
                          </del>
                        ) : (
                          <ins key={i} className="bg-emerald-50 text-emerald-800 no-underline rounded-[2px] px-0.5 mr-1">
                            {p.text}
                          </ins>
                        )
                      )}
                      {(draft.rule ?? '') === '' && <span className="italic">(no rule — base prompt only)</span>}
                    </p>
                    {draft.note && (
                      <p className="text-[11px] italic text-[hsl(var(--muted-foreground))]">{draft.note}</p>
                    )}
                  </div>
                )}
              </div>

              {/* RIGHT — Updated Response + edge-case sweep */}
              <div className="p-4 space-y-3">
                <div>
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))] mb-1">
                    Updated response <span className="font-normal normal-case">(proposed rule)</span>
                  </h3>
                  {!draft ? (
                    <p className="text-xs text-[hsl(var(--muted-foreground))] py-6">
                      Make an edit or propose a revision to see the before/after.
                    </p>
                  ) : updatedLoading ? (
                    <p className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))] py-6">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating under the proposed rule…
                    </p>
                  ) : updatedPreview ? (
                    <div className="rounded border border-emerald-200 bg-emerald-50/30 p-2 max-h-72 overflow-y-auto">
                      <Markdown text={updatedPreview} />
                    </div>
                  ) : (
                    <p className="text-xs italic text-[hsl(var(--muted-foreground))]">Preview failed to generate.</p>
                  )}
                </div>

                {draft && !updatedLoading && (
                  <div className="space-y-2">
                    <button
                      onClick={runSweep}
                      disabled={sweeping}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] disabled:opacity-50"
                      title="Preview the change on this intent's edge cases — most-different, barely-in, most-recent"
                    >
                      {sweeping ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                      Check edge cases
                    </button>

                    {edgeCases !== null && edgeCases.length === 0 && (
                      <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
                        No other questions in this intent yet.
                      </p>
                    )}
                    {edgeCases?.map((ec) => {
                      const open = expandedCase === ec.messageId;
                      const clean = ec.queryText.replace(/\s+/g, ' ').trim();
                      return (
                        <div key={ec.messageId} className="rounded border border-[hsl(var(--border))]">
                          <button
                            onClick={() => setExpandedCase(open ? null : ec.messageId)}
                            className="w-full text-left px-2 py-1.5 flex items-center gap-1.5"
                          >
                            {open ? (
                              <ChevronDown className="w-3 h-3 shrink-0 text-[hsl(var(--muted-foreground))]" />
                            ) : (
                              <ChevronRight className="w-3 h-3 shrink-0 text-[hsl(var(--muted-foreground))]" />
                            )}
                            <span className="text-[11px] truncate flex-1">
                              {clean.length > 70 ? `${clean.slice(0, 70)}…` : clean}
                            </span>
                            <span className="shrink-0 text-[10px] px-1 py-0.5 rounded bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]">
                              {REASON_LABEL[ec.reason]}
                            </span>
                          </button>
                          {open && (
                            <div className="border-t border-[hsl(var(--border))] p-2 space-y-2">
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <p className="text-[10px] font-semibold uppercase text-[hsl(var(--muted-foreground))] mb-0.5">Before</p>
                                  <div className="max-h-40 overflow-y-auto rounded bg-[hsl(var(--muted))]/30 p-1.5">
                                    {ec.before ? <Markdown text={ec.before} /> : <p className="text-[11px] italic">failed</p>}
                                  </div>
                                </div>
                                <div>
                                  <p className="text-[10px] font-semibold uppercase text-[hsl(var(--muted-foreground))] mb-0.5">After</p>
                                  <div className="max-h-40 overflow-y-auto rounded bg-emerald-50/40 p-1.5">
                                    {ec.after ? <Markdown text={ec.after} /> : <p className="text-[11px] italic">failed</p>}
                                  </div>
                                </div>
                              </div>
                              <div className="flex gap-1.5">
                                <input
                                  value={ec.feedback}
                                  onChange={(e) =>
                                    setEdgeCases(
                                      (prev) =>
                                        prev?.map((c) =>
                                          c.messageId === ec.messageId ? { ...c, feedback: e.target.value } : c
                                        ) ?? null
                                    )
                                  }
                                  placeholder="Broken here? Say what's wrong — folds into the draft."
                                  className="flex-1 text-[11px] border border-[hsl(var(--border))] rounded px-2 py-1 bg-[hsl(var(--background))]"
                                />
                                <button
                                  onClick={() => foldCaseFeedback(ec)}
                                  disabled={proposing || !ec.feedback.trim()}
                                  className="shrink-0 px-2 py-1 rounded text-[11px] font-medium border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] disabled:opacity-50"
                                >
                                  {ec.folding && proposing ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Fold in'}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="px-4 py-3 border-t border-[hsl(var(--border))] flex items-center gap-2">
            {error && (
              <span className="flex items-center gap-1 text-xs text-red-600">
                <AlertTriangle className="w-3.5 h-3.5" /> {error}
              </span>
            )}
            <span className="flex-1 text-[10px] text-[hsl(var(--muted-foreground))]">
              Previews are single-turn regenerations with the live chatbot model — indicative, not a guarantee.
            </span>
            <button
              onClick={() => onClose(false)}
              className="px-3 py-1.5 text-xs rounded border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]"
            >
              Cancel
            </button>
            <button
              onClick={applyDraft}
              disabled={!draftDirty || applying || proposing}
              className="px-3 py-1.5 text-xs font-medium rounded bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] disabled:opacity-50"
              title="Applies immediately and records a new config version"
            >
              {applying ? 'Applying…' : 'Apply changes'}
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
