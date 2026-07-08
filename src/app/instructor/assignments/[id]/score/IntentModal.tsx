'use client';

/**
 * SCORE v6 — New Intent flow (S3): Definition → Find questions → rating-
 * sorted list with in/out boundary pinning → overlap banner.
 *
 * "Find questions" creates the intent immediately (so ratings/pins persist),
 * then loops the rate route scoped to just this intent and loads the
 * rating-sorted list. Pinning an in/out verdict is the §1.6 boundary-example
 * mechanism: it changes the intent's prompt (and defHash), so the list offers
 * a scoped re-rate ("재분류 diff") to see the pins take effect.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { isIncludedRating, RATING_LEVELS, type RatingLevel } from '@/lib/score/intents';
import { AlertTriangle, Check, Loader2, Search, X } from 'lucide-react';

interface RatingRow {
  messageId: number;
  queryText: string;
  turnIndex: number;
  queryTimestamp: string;
  rating: RatingLevel | null;
  rationale: string | null;
  stale: boolean;
  pinned: 'in' | 'out' | null;
  prior: { kind: 'assigned'; intentId: number } | { kind: 'fallback' | 'boundary' | 'pending' };
}

interface RatingsPayload {
  intent: { id: number; title: string; definition: string };
  rows: RatingRow[];
  ratedCount: number;
  staleCount: number;
  includedCount: number;
  overlaps: { intentId: number; title: string; count: number }[];
  versionNo: number;
}

interface NewIntentModalProps {
  open: boolean;
  onClose: () => void;
  assignmentId: string;
  model: string;
  openaiConfigured: boolean;
  /** Optional seed (e.g. promoted from a Jelson tag browse). */
  seed?: { title?: string; definition?: string } | null;
}

const RATING_HEADER: Record<RatingLevel, string> = {
  clearly_in: 'Clearly in',
  probably_in: 'Probably in',
  unsure: 'Unsure — click in/out to pin the boundary',
  probably_out: 'Probably out',
  clearly_out: 'Clearly out',
};

export default function NewIntentModal({
  open,
  onClose,
  assignmentId,
  model,
  openaiConfigured,
  seed,
}: NewIntentModalProps) {
  const [title, setTitle] = useState('');
  const [definition, setDefinition] = useState('');
  const [rule, setRule] = useState('');
  const [intentId, setIntentId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ rated: number; total: number } | null>(null);
  const [data, setData] = useState<RatingsPayload | null>(null);
  const [pinsDirty, setPinsDirty] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [pinBusy, setPinBusy] = useState<number | null>(null);

  const mountedRef = useRef(true);
  // One controller per run; aborted whenever the dialog closes/reopens so an
  // in-flight rate loop can neither keep billing the LLM in the background
  // nor clobber the state of a later run (the modal may stay mounted).
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  // Reset per open (seed applies on open only); kill any orphaned run.
  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (open) {
      setTitle(seed?.title ?? '');
      setDefinition(seed?.definition ?? '');
      setRule('');
      setIntentId(null);
      setBusy(false);
      setError(null);
      setProgress(null);
      setData(null);
      setPinsDirty(false);
      setExpanded(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const live = (signal: AbortSignal) => mountedRef.current && !signal.aborted;

  async function fetchRatings(id: number, signal: AbortSignal) {
    const res = await fetch(`/api/instructor/assignments/${assignmentId}/score/intents/${id}/ratings`, { signal });
    if (!res.ok) throw new Error('Failed to load ratings.');
    const payload = (await res.json()) as RatingsPayload;
    if (live(signal)) setData(payload);
  }

  async function rateLoop(id: number, signal: AbortSignal) {
    setProgress({ rated: 0, total: 0 });
    while (true) {
      const res = await fetch(`/api/instructor/assignments/${assignmentId}/score/rate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intentIds: [id], limit: 40, model }),
        signal,
      });
      const d = await res.json().catch(() => ({}));
      if (!live(signal)) return;
      if (!res.ok) throw new Error(typeof d?.message === 'string' ? d.message : 'Rating failed.');
      setProgress({ rated: d.rated ?? 0, total: d.total ?? 0 });
      if ((d.remaining ?? 0) <= 0 || (d.processed ?? 0) === 0) break;
      if ((d.succeeded ?? 0) === 0) throw new Error('Rating stalled — LLM calls are failing. Check server logs.');
    }
  }

  async function findQuestions() {
    if (busy || !definition.trim()) return;
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;
    setBusy(true);
    setError(null);
    try {
      let id = intentId;
      if (id === null) {
        const res = await fetch(`/api/instructor/assignments/${assignmentId}/score/intents`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: title.trim() || undefined,
            definition: definition.trim(),
            rule: rule.trim() || undefined,
          }),
          signal,
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof d?.message === 'string' ? d.message : 'Failed to create the intent.');
        id = d.intent.id as number;
        if (live(signal)) setIntentId(id);
      } else {
        // Definition edited after a previous run → save, ratings go stale.
        const res = await fetch(`/api/instructor/assignments/${assignmentId}/score/intents/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: title.trim() || undefined,
            definition: definition.trim(),
            rule: rule.trim() ? rule.trim() : null,
          }),
          signal,
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(typeof d?.message === 'string' ? d.message : 'Failed to save the intent.');
        }
      }
      await rateLoop(id, signal);
      await fetchRatings(id, signal);
      if (live(signal)) setPinsDirty(false);
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return;
      if (live(signal)) setError((e as Error).message);
    } finally {
      if (live(signal)) {
        setBusy(false);
        setProgress(null);
      }
    }
  }

  async function togglePin(row: RatingRow, verdict: 'in' | 'out') {
    if (intentId === null || pinBusy !== null) return;
    setPinBusy(row.messageId);
    try {
      const res =
        row.pinned === verdict
          ? await fetch(
              `/api/instructor/assignments/${assignmentId}/score/intents/${intentId}/pins?messageId=${row.messageId}`,
              { method: 'DELETE' }
            )
          : await fetch(`/api/instructor/assignments/${assignmentId}/score/intents/${intentId}/pins`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ messageId: row.messageId, verdict }),
            });
      if (!res.ok) {
        // fetch resolves on 4xx/5xx — without this the UI would show a pin
        // (and offer a pointless re-rate) that the server never stored.
        const d = await res.json().catch(() => ({}));
        throw new Error(typeof d?.error === 'string' ? `Pin failed: ${d.error}` : 'Failed to update the pin.');
      }
      // Local update — pins change the prompt, so ratings are now stale.
      setData((prev) =>
        prev
          ? {
              ...prev,
              rows: prev.rows.map((r) =>
                r.messageId === row.messageId
                  ? { ...r, pinned: r.pinned === verdict ? null : verdict }
                  : r
              ),
            }
          : prev
      );
      setPinsDirty(true);
    } catch (e) {
      if (mountedRef.current) setError((e as Error).message);
    } finally {
      if (mountedRef.current) setPinBusy(null);
    }
  }

  const grouped = useMemo(() => {
    if (!data) return [];
    const buckets: { key: RatingLevel | 'unrated'; label: string; rows: RatingRow[] }[] = [
      ...RATING_LEVELS.map((lvl) => ({ key: lvl as RatingLevel | 'unrated', label: RATING_HEADER[lvl], rows: [] as RatingRow[] })),
      { key: 'unrated', label: 'Not rated', rows: [] },
    ];
    const byKey = new Map(buckets.map((b) => [b.key, b]));
    for (const r of data.rows) {
      byKey.get(r.rating ?? 'unrated')!.rows.push(r);
    }
    return buckets.filter((b) => b.rows.length > 0);
  }, [data]);

  const fromUnassigned = useMemo(
    () =>
      data
        ? data.rows.filter((r) => isIncludedRating(r.rating) && r.prior.kind === 'fallback').length
        : 0,
    [data]
  );

  const phase: 'define' | 'results' = data ? 'results' : 'define';

  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/40" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="w-full max-w-4xl max-h-[90vh] flex flex-col rounded-lg bg-[hsl(var(--card))] border border-[hsl(var(--border))] shadow-xl">
          <div className="px-4 py-3 border-b border-[hsl(var(--border))] flex items-center justify-between">
            <DialogTitle className="text-sm font-semibold">
              New Intent {phase === 'results' && data ? `— ${data.intent.title}` : ''}
            </DialogTitle>
            <button onClick={onClose} className="p-1 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            <div className="grid grid-cols-1 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-0">
              {/* LEFT — definition */}
              <div className="p-4 space-y-3 border-b md:border-b-0 md:border-r border-[hsl(var(--border))]">
                <label className="block text-xs">
                  <span className="font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">Title</span>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Short card label (optional)"
                    className="mt-1 w-full text-sm border border-[hsl(var(--border))] rounded px-2 py-1.5 bg-[hsl(var(--background))]"
                  />
                </label>
                <label className="block text-xs">
                  <span className="font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                    When a student… (definition)
                  </span>
                  <textarea
                    value={definition}
                    onChange={(e) => setDefinition(e.target.value)}
                    rows={4}
                    placeholder="e.g. asks the chatbot to write a thesis statement or conclusion for them"
                    className="mt-1 w-full text-sm border border-[hsl(var(--border))] rounded px-2 py-1.5 bg-[hsl(var(--background))]"
                  />
                </label>
                <label className="block text-xs">
                  <span className="font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                    Then respond… (rule — optional, can be added later)
                  </span>
                  <textarea
                    value={rule}
                    onChange={(e) => setRule(e.target.value)}
                    rows={4}
                    placeholder="Response guideline injected on top of the base prompt when this intent matches."
                    className="mt-1 w-full text-sm border border-[hsl(var(--border))] rounded px-2 py-1.5 bg-[hsl(var(--background))]"
                  />
                </label>

                <button
                  onClick={findQuestions}
                  disabled={busy || !definition.trim() || !openaiConfigured}
                  title={openaiConfigured ? undefined : 'OPENAI_API_KEY is not configured'}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] disabled:opacity-50"
                >
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                  {intentId === null ? 'Create & find questions' : 'Save & re-run'}
                </button>
                {busy && progress && (
                  <p className="text-[11px] text-[hsl(var(--muted-foreground))] tabular-nums">
                    Rating the log… {progress.rated}/{progress.total}
                  </p>
                )}
                {error && (
                  <p className="flex items-center gap-1 text-xs text-red-600">
                    <AlertTriangle className="w-3.5 h-3.5" /> {error}
                  </p>
                )}
                {intentId !== null && (
                  <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
                    The intent is saved — closing this dialog keeps it (archive from its edit menu if unwanted).
                  </p>
                )}
              </div>

              {/* RIGHT — matching questions */}
              <div className="min-h-[300px]">
                {!data ? (
                  <div className="h-full flex items-center justify-center p-8 text-center text-sm text-[hsl(var(--muted-foreground))]">
                    {busy
                      ? 'Rating every question in the log against this definition…'
                      : 'Define the intent, then find its questions across the log.'}
                  </div>
                ) : (
                  <div>
                    <div className="sticky top-0 z-10 bg-[hsl(var(--card))] border-b border-[hsl(var(--border))] px-3 py-2 space-y-1.5">
                      <p className="text-xs text-[hsl(var(--foreground))]">
                        <span className="font-semibold">{data.includedCount}</span> of {data.rows.length} in the log
                        {fromUnassigned > 0 && <> · <span className="font-semibold">{fromUnassigned}</span> from Unassigned</>}
                        {data.staleCount > 0 && (
                          <span className="text-amber-700"> · {data.staleCount} stale</span>
                        )}
                      </p>
                      {data.overlaps.length > 0 && (
                        <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800 flex items-start gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                          <span>
                            Overlaps:{' '}
                            {data.overlaps.map((o, i) => (
                              <span key={o.intentId}>
                                {i > 0 && ' · '}
                                <span className="font-medium">{o.title}</span> ({o.count})
                              </span>
                            ))}{' '}
                            — these land in the Needs Decision queue; ownership decisions arrive in the next phase.
                          </span>
                        </div>
                      )}
                      {pinsDirty && (
                        <button
                          onClick={findQuestions}
                          disabled={busy}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                        >
                          <Check className="w-3 h-3" /> Pins changed — re-rate to apply
                        </button>
                      )}
                    </div>

                    <div className="divide-y divide-[hsl(var(--border))]">
                      {grouped.map((bucket) => (
                        <div key={bucket.key}>
                          <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))] bg-[hsl(var(--muted))]/40">
                            {bucket.label} · {bucket.rows.length}
                          </div>
                          <ul className="divide-y divide-[hsl(var(--border))]/60">
                            {bucket.rows.map((r) => {
                              const clean = r.queryText.replace(/\s+/g, ' ').trim();
                              const isExpanded = expanded === r.messageId;
                              return (
                                <li key={r.messageId} className="px-3 py-2">
                                  <div className="flex items-start justify-between gap-2">
                                    <button
                                      onClick={() => setExpanded(isExpanded ? null : r.messageId)}
                                      className="text-left flex-1 min-w-0"
                                    >
                                      <p className={`text-xs text-[hsl(var(--foreground))] ${isExpanded ? 'whitespace-pre-wrap' : ''}`}>
                                        {isExpanded ? r.queryText : clean.length > 120 ? `${clean.slice(0, 120)}…` : clean}
                                      </p>
                                      {r.rating === 'unsure' && r.rationale && (
                                        <p className="mt-0.5 text-[11px] italic text-amber-700">{r.rationale}</p>
                                      )}
                                      <span className="mt-0.5 inline-block text-[10px] text-[hsl(var(--muted-foreground))]">
                                        {r.prior.kind === 'assigned'
                                          ? 'currently owned by another intent'
                                          : r.prior.kind === 'fallback'
                                            ? 'currently unassigned'
                                            : r.prior.kind === 'boundary'
                                              ? 'currently in an overlap'
                                              : ''}
                                        {r.stale && ' · stale rating'}
                                      </span>
                                    </button>
                                    <span className="flex items-center gap-1 shrink-0">
                                      <button
                                        onClick={() => togglePin(r, 'in')}
                                        disabled={pinBusy !== null}
                                        className={`px-1.5 py-0.5 rounded text-[11px] font-medium border ${
                                          r.pinned === 'in'
                                            ? 'bg-emerald-600 text-white border-emerald-600'
                                            : 'border-[hsl(var(--border))] text-emerald-700 hover:bg-emerald-50'
                                        }`}
                                        title="Pin: this question BELONGS to the intent"
                                      >
                                        in
                                      </button>
                                      <button
                                        onClick={() => togglePin(r, 'out')}
                                        disabled={pinBusy !== null}
                                        className={`px-1.5 py-0.5 rounded text-[11px] font-medium border ${
                                          r.pinned === 'out'
                                            ? 'bg-rose-600 text-white border-rose-600'
                                            : 'border-[hsl(var(--border))] text-rose-700 hover:bg-rose-50'
                                        }`}
                                        title="Pin: this question does NOT belong to the intent"
                                      >
                                        out
                                      </button>
                                    </span>
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="px-4 py-3 border-t border-[hsl(var(--border))] flex justify-end gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs font-medium rounded bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
            >
              {phase === 'results' ? 'Done' : 'Close'}
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
