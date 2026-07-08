'use client';

/**
 * SCORE v6 — the shared Intent modal (S3), used for BOTH creating and editing
 * an intent: Definition → Find questions → rating-sorted list with in/out
 * boundary pinning → overlap banner. The body is identical either way; only the
 * header/footer differ (edit mode preloads the intent's ratings on open and
 * exposes Archive).
 *
 * "Find questions" (create) / "Save & re-run" (edit) persists the intent, loops
 * the rate route scoped to just this intent, and loads the rating-sorted list.
 * Pinning an in/out verdict is the §1.6 boundary-example mechanism: it changes
 * the intent's prompt (and defHash), so the list offers a scoped re-rate
 * ("재분류 diff") to see the pins take effect.
 */
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import {
  selectPromptPins,
  type MaterialKind,
  type RatingLevel,
} from '@/lib/score/intents';
import { buildIntentSystemPrompt, MAX_PINS_IN_PROMPT } from '@/lib/score/intent-prompts';
import { buildQueryContent } from '@/lib/score/prompts';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Eye,
  Loader2,
  RotateCcw,
  Save as SaveIcon,
  Search,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import { runShardedRate } from './rate-runner';
import { MaterialSegments, QuerySnippet } from './materials';
import type { IntentSummary } from './IntentBoard';
import {
  suggestJelson,
  jelsonToIntent,
  type JelsonSuggestion,
} from '@/lib/score/jelson-suggest';

interface RatingRow {
  messageId: number;
  queryText: string;
  /** The previous student question — context shown in the expand view. */
  prevQueryText: string | null;
  turnIndex: number;
  queryTimestamp: string;
  rating: RatingLevel | null;
  rationale: string | null;
  stale: boolean;
  pinned: 'in' | 'out' | null;
  prior: { kind: 'assigned'; intentId: number } | { kind: 'fallback' | 'boundary' | 'pending' };
  /** Title of the intent currently owning this question (assigned only). */
  priorTitle: string | null;
  /** Message split into Material vs Request(s), for the expand view. */
  dissection: { materialKinds: MaterialKind[]; requests: string[] } | null;
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

interface IntentVersion {
  versionNo: number;
  /** This intent's OWN version number (v1, v2, …), not the global config no. */
  intentVersion: number;
  createdAt: string;
  action: string;
  detail: string | null;
  title: string | null;
  definition: string | null;
  included: number;
  excluded: number;
  stats: { included: number; excluded: number; inCount: number } | null;
}

/** Instructor-facing labels for the version-history actions. */
const ACTION_LABELS: Record<string, string> = {
  create_intent: 'created',
  update_intent: 'updated',
  archive_intent: 'archived',
  restore_intent: 'restored',
  add_pin: 'labeled',
  remove_pin: 'label removed',
  add_link: 'link added',
  remove_link: 'link removed',
  ownership_pins: 'ownership decided',
  revert: 'reverted',
};

interface IntentModalProps {
  open: boolean;
  onClose: () => void;
  assignmentId: string;
  model: string;
  openaiConfigured: boolean;
  /** Total questions in the log — sizes the parallel rate fan-out. */
  totalQuestions: number;
  /** Edit mode: the existing intent to open. Omit/null for create mode. */
  intent?: IntentSummary | null;
  /** Create mode: optional seed (e.g. promoted from an Uncovered starter set). */
  seed?: { title?: string; definition?: string } | null;
  /** Jelson taxonomy subtypes for the create-mode definition suggestions. */
  jelsonSuggestions?: JelsonSuggestion[];
  /** Prepared starter-set templates (pre-rated via "Run all") — picking a
   * matching suggestion adopts one and loads its stored ratings instantly. */
  templates?: { id: number; title: string; definition: string }[];
}

export default function IntentModal({
  open,
  onClose,
  assignmentId,
  model,
  openaiConfigured,
  totalQuestions,
  intent,
  seed,
  jelsonSuggestions,
  templates,
}: IntentModalProps) {
  const isEdit = !!intent;
  const [title, setTitle] = useState('');
  // Whether the instructor typed the title themselves this session — if not,
  // every Save auto-generates it from the definition (git-commit style).
  const [titleDirty, setTitleDirty] = useState(false);
  const [definition, setDefinition] = useState('');
  // Create-mode taxonomy suggestions: hidden once a suggestion is picked, until
  // the instructor edits the definition again.
  const [suggestDismissed, setSuggestDismissed] = useState(false);
  // Labels changed since the last Apply — the shown ratings no longer reflect
  // the prompt the pins produce, so Save (commit) is gated until re-Apply.
  const [pinsDirty, setPinsDirty] = useState(false);
  const [intentId, setIntentId] = useState<number | null>(null);
  // Create-mode discovery state. `adopted` = intentId points at a shared library
  // template (picked suggestion) — editing forks instead of mutating it.
  // `draftIdRef` = an UNSAVED draft created by Apply this session; it is not a
  // registered intent (is_template stays true) and is purged if the modal
  // closes without Save.
  const [adopted, setAdopted] = useState(false);
  const draftIdRef = useRef<number | null>(null);
  // "Prompt preview" overlay: the exact classifier input for this intent.
  const [promptPreviewOpen, setPromptPreviewOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refining, setRefining] = useState(false);
  // The refine model's step-by-step audit, shown under the proposed definition.
  const [refineReasoning, setRefineReasoning] = useState<string | null>(null);
  const [versions, setVersions] = useState<IntentVersion[] | null>(null);
  // Version CHECKOUT: clicking a history entry loads that version's full state
  // (title/definition/pins/ratings — instant, from the hash-keyed rating store).
  // Apply rolls back to it; "Back to latest" returns to the live spec.
  const [checkout, setCheckout] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ rated: number; total: number } | null>(null);
  const [data, setData] = useState<RatingsPayload | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  // What is persisted server-side — Apply skips the save round trip when clean.
  const savedRef = useRef<{ title: string; definition: string }>({ title: '', definition: '' });

  // Create-mode only: fuzzy-match what they've typed against the Jelson taxonomy.
  const jelsonMatches = useMemo(() => {
    if (isEdit || !jelsonSuggestions?.length) return [];
    return suggestJelson(definition, jelsonSuggestions, 5);
  }, [isEdit, jelsonSuggestions, definition]);

  // Discard the unsaved discovery draft (fire-and-forget purge). Called when
  // switching suggestions or closing without Save — an unsaved draft must not
  // linger as a hidden intent.
  function discardDraft() {
    const draftId = draftIdRef.current;
    if (draftId === null) return;
    draftIdRef.current = null;
    fetch(`/api/instructor/assignments/${assignmentId}/score/intents/${draftId}?mode=purge`, {
      method: 'DELETE',
      keepalive: true,
    }).catch(() => {});
  }

  // Close = leave discovery: an unsaved draft is discarded (no Save → not
  // registered, per the version-history contract).
  function handleClose() {
    discardDraft();
    onClose();
  }

  // Pick a suggestion → the applied result appears IMMEDIATELY. A prepared
  // template (pre-rated via "Run all") is adopted and its stored ratings load
  // instantly; otherwise a discovery draft is created and rated on the spot.
  // Either way nothing is registered as an intent until Save.
  function applySuggestion(s: JelsonSuggestion) {
    const seeded = jelsonToIntent(s);
    setDefinition(seeded.definition);
    setTitle(seeded.title);
    setTitleDirty(true);
    setSuggestDismissed(true);
    discardDraft(); // switching picks — drop the previous unsaved draft
    const tpl = templates?.find((t) => t.definition.trim() === seeded.definition.trim());
    if (tpl) {
      setAdopted(true);
      setIntentId(tpl.id);
      setTitle(tpl.title);
      setDefinition(tpl.definition);
      savedRef.current = { title: tpl.title, definition: tpl.definition };
      setPinsDirty(false);
      setError(null);
      const controller = new AbortController();
      abortRef.current?.abort();
      abortRef.current = controller;
      fetchRatings(tpl.id, controller.signal).catch((e) => {
        if ((e as Error)?.name !== 'AbortError' && live(controller.signal)) {
          setError((e as Error).message);
        }
      });
      loadVersions(tpl.id);
    } else {
      // Not prepared — detach from any adopted template and auto-apply: create
      // a draft and rate the log right away (results appear without extra clicks).
      abortRef.current?.abort();
      abortRef.current = null;
      setAdopted(false);
      setIntentId(null);
      setData(null);
      setVersions(null);
      savedRef.current = { title: '', definition: '' };
      setPinsDirty(false);
      apply({ ...seeded, createNew: true });
    }
  }

  // Show only questions where the instructor's pin disagrees with the model's
  // rating (pinned out on an in-leaning rating, or pinned in on an out-leaning).
  // Resizable vertical split (desktop): the Clearly-in pane's flex-grow share
  // out of 10; the boundary pane takes the rest. Default 4 : 6.
  const [topGrow, setTopGrow] = useState(4);
  const splitRef = useRef<HTMLDivElement>(null);
  // Collapse state for the LEFT boundary-example lists.
  const [incOpen, setIncOpen] = useState(true);
  const [excOpen, setExcOpen] = useState(true);
  // Similarity sort: float the queries most similar to a selected "anchor" (by
  // request-embedding cosine) so near-duplicate boundary cases cluster together.
  // Pin-based similarity sort (decision propagation): sort every question toward
  // the in/out pin side it most resembles.
  const [querySearch, setQuerySearch] = useState('');
  const [inSort, setInSort] = useState<'newest' | 'oldest'>('newest');
  const [ndSort, setNdSort] = useState<'pins' | 'newest' | 'oldest'>('pins');
  const [similarScores, setSimilarScores] = useState<Record<number, number> | null>(null);
  const [similarBusy, setSimilarBusy] = useState(false);

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

  // Reset per open (seed/intent apply on open only); kill any orphaned run.
  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (!open) return;
    setBusy(false);
    setSaving(false);
    setRefining(false);
    setRefineReasoning(null);
    setVersions(null);
    setCheckout(null);
    setPinsDirty(false);
    setAdopted(false);
    setPromptPreviewOpen(false);
    draftIdRef.current = null;
    setTitleDirty(false);
    setSuggestDismissed(false);
    setError(null);
    setProgress(null);
    setData(null);
    setExpanded(null);
    setQuerySearch('');
    setInSort('newest');
    setNdSort('pins');
    setSimilarScores(null);
    setIncOpen(true);
    setExcOpen(true);
    if (intent) {
      // Edit mode: preload the intent's fields and its current ratings/pins so
      // the same body opens straight into the matched-questions view.
      setTitle(intent.title);
      setDefinition(intent.definition);
      setIntentId(intent.id);
      savedRef.current = { title: intent.title, definition: intent.definition };
      const controller = new AbortController();
      abortRef.current = controller;
      fetchRatings(intent.id, controller.signal).catch((e) => {
        if ((e as Error)?.name !== 'AbortError' && live(controller.signal)) {
          setError((e as Error).message);
        }
      });
      loadVersions(intent.id);
    } else {
      setTitle(seed?.title ?? '');
      setDefinition(seed?.definition ?? '');
      if (seed?.title) setTitleDirty(true);
      setIntentId(null);
      savedRef.current = { title: '', definition: '' };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, intent?.id]);

  const live = (signal: AbortSignal) => mountedRef.current && !signal.aborted;

  async function fetchRatings(id: number, signal: AbortSignal, versionNo?: number) {
    const res = await fetch(
      `/api/instructor/assignments/${assignmentId}/score/intents/${id}/ratings${
        versionNo !== undefined ? `?versionNo=${versionNo}` : ''
      }`,
      { signal }
    );
    if (!res.ok) throw new Error('Failed to load ratings.');
    const payload = (await res.json()) as RatingsPayload;
    if (live(signal)) setData(payload);
    return payload;
  }

  async function rateLoop(id: number, signal: AbortSignal) {
    // total is fixed to the whole log so the bar fills smoothly (the shard
    // aggregate would otherwise climb as shards report their partition sizes).
    setProgress({ rated: 0, total: totalQuestions });
    // Fan the log out into parallel shards so a new intent applies to every
    // question in ~one wave instead of a sequential 40-at-a-time crawl.
    await runShardedRate({
      assignmentId,
      model,
      intentIds: [id],
      estimatedTotal: totalQuestions,
      signal,
      isLive: () => live(signal),
      onProgress: (p) => {
        if (live(signal)) setProgress({ rated: Math.min(p.rated, totalQuestions), total: totalQuestions });
      },
    });
  }

  /** Apply = persist the spec silently (draft on create), then rate the whole
   * log against it and load the matched-question view. `specOverride` lets a
   * suggestion pick auto-apply with values not yet committed to state. */
  async function apply(specOverride?: { title: string; definition: string; createNew?: boolean }) {
    if (busy || saving || !(specOverride?.definition ?? definition).trim()) return;
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;
    setBusy(true);
    setError(null);
    try {
      const id = await persist(signal, false, specOverride);
      if (id === null || !live(signal)) return;
      await rateLoop(id, signal);
      await fetchRatings(id, signal);
      if (live(signal)) {
        setPinsDirty(false); // shown ratings now reflect the pins
        setCheckout(null); // a rollback-apply lands back on the (new) live spec
      }
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

  const specDirty = () =>
    intentId === null ||
    title.trim() !== savedRef.current.title ||
    definition.trim() !== savedRef.current.definition;

  /** Create or update the intent spec. Registration model:
   *  - Apply (force=false) persists SILENTLY as a discovery draft — a create
   *    lands as is_template=true with no version entry, so nothing is
   *    registered on the board yet.
   *  - Save (force=true) is the registration: flips is_template off and records
   *    the version (v1 = created).
   *  - Applying edits over an ADOPTED library template forks a new draft
   *    instead of mutating the shared template.
   *  Returns the intent id. */
  async function persist(
    signal?: AbortSignal,
    force = false,
    specOverride?: { title: string; definition: string; createNew?: boolean }
  ): Promise<number | null> {
    // Checkout-rollback must always PATCH (pins need restoring) even when the
    // definition happens to match the live one.
    if (!force && !specOverride && checkout === null && intentId !== null && !specDirty()) {
      return intentId;
    }
    const titleText = (specOverride?.title ?? title).trim();
    const defText = (specOverride?.definition ?? definition).trim();
    const autoTitle = specOverride ? !titleText : !titleDirty || !title.trim();
    const stats = {
      included: pinnedIn.length,
      excluded: pinnedOut.length,
      inCount: inThisIntent.length,
    };
    // Fork: Apply over an adopted library template with edits → new draft.
    const fork = !force && adopted && intentId !== null && specDirty();
    const isCreate = !!specOverride?.createNew || intentId === null || fork;
    const payload = {
      title: autoTitle ? undefined : titleText,
      definition: defText,
      autoTitle,
      // Only an explicit Save leaves a version entry; Apply persists silently.
      recordVersion: force,
      stats,
      // Creates start as unregistered drafts; Save activates (registers).
      ...(isCreate ? { isTemplate: true } : force ? { isTemplate: false } : {}),
      // Rollback: restore the checked-out version's pin set alongside the spec.
      ...(checkout !== null && !isCreate ? { pinsFromVersion: checkout } : {}),
    };
    const res = await fetch(
      isCreate
        ? `/api/instructor/assignments/${assignmentId}/score/intents`
        : `/api/instructor/assignments/${assignmentId}/score/intents/${intentId}`,
      {
        method: isCreate ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal,
      }
    );
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(typeof d?.message === 'string' ? d.message : 'Failed to save the intent.');
    }
    const saved = d.intent as { id: number; title: string; definition: string };
    if (mountedRef.current) {
      setIntentId(saved.id);
      setTitle(saved.title); // reflect the auto-generated title
      setTitleDirty(false);
      savedRef.current = { title: saved.title, definition: saved.definition };
      if (isCreate) {
        setAdopted(false);
        draftIdRef.current = saved.id; // unsaved draft — purged if closed without Save
      }
      if (force) draftIdRef.current = null; // saved → registered, keep it
      loadVersions(saved.id);
    }
    return saved.id;
  }

  // Save = REGISTER: commit the applied state (definition + pins) as a version;
  // a draft/template becomes a live intent on the board. Gated until applied.
  async function save() {
    if (saving || busy || !definition.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await persist(undefined, true);
    } catch (e) {
      if (mountedRef.current) setError((e as Error).message);
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }

  /** Rewrite the definition FROM the labeled examples (strong model). The
   * result is a DRAFT put into the fields — review, then Save or Apply. */
  async function refineFromLabels() {
    if (refining || busy || intentId === null) return;
    setRefining(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/instructor/assignments/${assignmentId}/score/intents/${intentId}/refine`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ definition: definition.trim() }),
        }
      );
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof d?.message === 'string' ? d.message : 'Failed to update the definition.');
      }
      if (mountedRef.current) {
        setDefinition(d.definition);
        if (!titleDirty && typeof d.title === 'string' && d.title) setTitle(d.title);
        setRefineReasoning(typeof d.reasoning === 'string' ? d.reasoning : null);
      }
    } catch (e) {
      if (mountedRef.current) setError((e as Error).message);
    } finally {
      if (mountedRef.current) setRefining(false);
    }
  }

  async function loadVersions(id: number) {
    try {
      const res = await fetch(`/api/instructor/assignments/${assignmentId}/score/intents/${id}/versions`);
      const d = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(d?.versions) && mountedRef.current) setVersions(d.versions);
    } catch {
      /* history strip is best-effort */
    }
  }

  // CHECKOUT a version: load its full state — title/definition from the
  // snapshot, its pin set, and the rating rows stored for that exact spec
  // (instant; zero LLM). Read-only until Apply rolls back to it.
  async function openVersion(versionNo: number) {
    if (intentId === null || busy || saving) return;
    setCheckout(versionNo);
    setError(null);
    setRefineReasoning(null);
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    try {
      const payload = await fetchRatings(intentId, controller.signal, versionNo);
      if (live(controller.signal)) {
        setTitle(payload.intent.title);
        setDefinition(payload.intent.definition);
        setTitleDirty(true);
      }
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError' && live(controller.signal)) {
        setError((e as Error).message);
        setCheckout(null);
      }
    }
  }

  // Back to latest: leave the checkout and restore the live spec + ratings.
  async function backToLatest() {
    if (intentId === null) return;
    setCheckout(null);
    setTitle(savedRef.current.title);
    setDefinition(savedRef.current.definition);
    setError(null);
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    try {
      await fetchRatings(intentId, controller.signal);
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError' && live(controller.signal)) {
        setError((e as Error).message);
      }
    }
  }

  // Optimistic: flip the pin immediately (no spinner/disable), fire the write,
  // and revert only if the server rejects it. Pins are boundary examples that
  // refine WHICH questions this intent captures on the next re-rate.
  async function togglePin(row: RatingRow, verdict: 'in' | 'out') {
    // Checkout is a read-only view of a past version — pins mutate the LIVE
    // spec, so labeling is disabled until Apply (rollback) or Back to latest.
    if (intentId === null || checkout !== null) return;
    const next = row.pinned === verdict ? null : verdict;
    const setPinned = (pinned: 'in' | 'out' | null) =>
      setData((prev) =>
        prev
          ? { ...prev, rows: prev.rows.map((r) => (r.messageId === row.messageId ? { ...r, pinned } : r)) }
          : prev
      );
    setPinned(next);
    setPinsDirty(true); // ratings no longer reflect the pins → re-Apply before Save
    setSimilarScores(null); // pins changed → pin-sort scores are stale, refetch
    try {
      const res =
        next === null
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
        const d = await res.json().catch(() => ({}));
        throw new Error(typeof d?.error === 'string' ? `Pin failed: ${d.error}` : 'Failed to update the pin.');
      }
    } catch (e) {
      if (mountedRef.current) {
        setPinned(row.pinned); // revert the optimistic flip
        setError((e as Error).message);
      }
    }
  }

  // Drag the divider between the two panes (desktop) to resize the split.
  function startResize(e: ReactMouseEvent) {
    e.preventDefault();
    const el = splitRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const onMove = (ev: MouseEvent) => {
      const frac = (ev.clientY - rect.top) / rect.height;
      setTopGrow(Math.min(8.5, Math.max(1.5, frac * 10)));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
    };
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // Edit mode only: archive (soft-delete) the intent; its questions fall back
  // to Base-only. Recorded as a version, so it's reversible.
  async function archive() {
    if (!intent) return;
    if (
      !window.confirm(
        `Archive "${intent.title}"? Its questions fall back to Base-only. This is recorded and reversible.`
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/instructor/assignments/${assignmentId}/score/intents/${intent.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Archive failed.');
      onClose();
    } catch (e) {
      if (mountedRef.current) {
        setError((e as Error).message);
        setBusy(false);
      }
    }
  }

  // Two instructor-facing buckets — the 4 internal rating levels stay hidden:
  //  · IN THIS INTENT = auto-captured (clearly_in) OR pinned in (the filter result).
  //  · NEEDS DECISION = the model-uncertain, still-undecided questions.
  // Pinned-out and confident-out questions fall away (hidden as "not this intent").
  // RIGHT = the model's read of the log: auto-captured (clearly_in, unpinned) +
  // the uncertain to label. The instructor's in/out PINS live on the LEFT with
  // the spec — they are the Included/Excluded EXAMPLES injected into the prompt.
  const inThisIntent = useMemo(
    () => (data ? data.rows.filter((r) => r.pinned == null && r.rating === 'clearly_in') : []),
    [data]
  );
  const needsDecision = useMemo(
    () =>
      data
        ? data.rows.filter(
            (r) => r.pinned == null && r.rating !== 'clearly_in' && r.rating !== 'clearly_out'
          )
        : [],
    [data]
  );
  const pinnedIn = useMemo(() => (data ? data.rows.filter((r) => r.pinned === 'in') : []), [data]);
  const pinnedOut = useMemo(() => (data ? data.rows.filter((r) => r.pinned === 'out') : []), [data]);

  // Rebuild the EXACT classifier input from the current draft (intent-prompts
  // is client-safe by design — preview = runtime, §1.9). The user message is a
  // per-question template, shown with placeholders.
  const promptPreview = useMemo(() => {
    if (!promptPreviewOpen) return null;
    const pins = selectPromptPins([
      ...pinnedIn.map((r) => ({ verdict: 'in' as const, text: r.queryText })),
      ...pinnedOut.map((r) => ({ verdict: 'out' as const, text: r.queryText })),
    ]);
    return {
      system: buildIntentSystemPrompt(
        [{ id: intentId ?? 0, definition: definition.trim() || '<definition>', pins }],
        true
      ),
      user: buildQueryContent(
        '<the student question being rated>',
        '<the previous student message, when present>',
        '<the chatbot reply the student was responding to, when present>'
      ),
    };
  }, [promptPreviewOpen, pinnedIn, pinnedOut, definition, intentId]);
  const ndProbablyIn = needsDecision.filter((r) => r.rating === 'probably_in').length;
  const ndProbablyOut = needsDecision.filter(
    (r) => r.rating === 'probably_out' || r.rating === 'unsure'
  ).length;

  // Pin-propagation score map (max cosine to IN pins − to OUT pins) for the
  // "By your pins" sort. Empty {} on failure so it doesn't refetch forever.
  async function fetchPins() {
    if (intentId === null || similarBusy) return;
    setSimilarBusy(true);
    try {
      const res = await fetch(
        `/api/instructor/assignments/${assignmentId}/score/intents/${intentId}/similar?mode=pins`
      );
      const d = await res.json().catch(() => ({}));
      if (mountedRef.current) setSimilarScores(res.ok && d?.scores ? d.scores : {});
    } catch {
      if (mountedRef.current) setSimilarScores({});
    } finally {
      if (mountedRef.current) setSimilarBusy(false);
    }
  }
  // Load pin scores lazily when a list is sorted "By your pins"; invalidated to
  // null on every pin change so the order reflects the latest pins.
  useEffect(() => {
    if (ndSort === 'pins' && data && intentId != null && similarScores === null && !similarBusy) {
      fetchPins();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ndSort, data, intentId, similarScores]);

  // Filter by the search box, then sort one list by the chosen mode.
  const sortRows = (rows: RatingRow[], mode: 'pins' | 'newest' | 'oldest'): RatingRow[] => {
    const q = querySearch.trim().toLowerCase();
    const filtered = q ? rows.filter((r) => r.queryText.toLowerCase().includes(q)) : rows;
    if (mode === 'pins') {
      if (!similarScores) return filtered;
      return [...filtered].sort(
        (a, b) => (similarScores[b.messageId] ?? -1) - (similarScores[a.messageId] ?? -1)
      );
    }
    const dir = mode === 'newest' ? -1 : 1;
    return [...filtered].sort((a, b) => dir * a.queryTimestamp.localeCompare(b.queryTimestamp));
  };

  // One question row — query text (click to expand) + the model's short
  // rationale (shown for EVERY level, not just the old unsure) + its current
  // prior-assignment status + in/out pins. Reused by both panes.
  const renderRow = (r: RatingRow) => {
    const clean = r.queryText.replace(/\s+/g, ' ').trim();
    // Only the PREVIOUS student question is shown as context — the chatbot reply
    // is verbose and omitted; the rating still uses it server-side.
    const hasContext = !!r.prevQueryText?.trim();
    // Expandable only when there's actually more to show: truncated text, the
    // previous question, or a Material/Request split.
    const truncatable = clean.length > 120;
    const expandable = truncatable || hasContext || (r.dissection?.materialKinds.length ?? 0) > 0;
    const isExpanded = expanded === r.messageId && expandable;
    // Only show the prior owner (assigned to ANOTHER intent) — unassigned shows
    // nothing. Boundary = clearly-in for several intents at once.
    const priorLabel =
      r.prior.kind === 'assigned'
        ? `currently in “${r.priorTitle ?? 'another intent'}”`
        : r.prior.kind === 'boundary'
          ? 'in an overlap — decide ownership'
          : '';
    // On the RIGHT, only "Needs decision" rows (uncertain, unpinned) get in/out
    // buttons — pinning moves them to the LEFT example lists. "In this intent"
    // (clearly-in auto) is settled → no buttons. Checkout is read-only.
    const inNeedsDecision =
      r.pinned == null && r.rating !== 'clearly_in' && r.rating !== 'clearly_out';
    const showIn = inNeedsDecision && checkout === null;
    const showOut = inNeedsDecision && checkout === null;
    // The model's lean, shown as a small chip in Needs-decision so the rationale
    // reads in context (the 4 levels stay out of the section structure itself).
    const lean =
      r.rating === 'probably_in'
        ? { label: 'probably in', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
        : r.rating === 'probably_out'
          ? { label: 'probably out', cls: 'bg-rose-50 text-rose-700 border-rose-200' }
          : r.rating === 'unsure'
            ? { label: 'unsure', cls: 'bg-amber-50 text-amber-700 border-amber-200' }
            : { label: 'not rated', cls: 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] border-[hsl(var(--border))]' };
    return (
      <li key={r.messageId} className="px-3 py-2">
        <div className="flex items-start justify-between gap-2">
          <button
            onClick={() => expandable && setExpanded(isExpanded ? null : r.messageId)}
            className={`group text-left flex-1 min-w-0 ${expandable ? '' : 'cursor-default'}`}
          >
            {isExpanded ? (
              <div className="text-xs text-[hsl(var(--foreground))] whitespace-pre-wrap leading-relaxed">
                {/* The PREVIOUS student question, for context — a rating that
                    looks odd on the target query alone often reads correctly
                    once you see what came just before it. */}
                {hasContext && (
                  <div className="mb-2 rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40 p-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))] mb-0.5">
                      Previous question
                    </p>
                    <p className="max-h-24 overflow-y-auto text-[11px] text-[hsl(var(--muted-foreground))]">
                      {r.prevQueryText?.trim()}
                    </p>
                  </div>
                )}
                {hasContext && (
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))] mb-0.5">
                    This question (rated)
                  </p>
                )}
                {/* Pasted Material collapses into per-kind tags (click to reveal
                    verbatim, same color highlight) — shared with the board. */}
                <MaterialSegments text={r.queryText} dissection={r.dissection} compact />
                <span className="mt-1 flex items-center gap-0.5 text-[10px] font-medium text-[hsl(var(--primary))]">
                  <ChevronUp className="w-3 h-3" /> collapse
                </span>
              </div>
            ) : (
              <p className="text-xs text-[hsl(var(--foreground))]">
                {/* Same tagged preview as the board's question list — Material
                    shows as a static tag even before expanding. */}
                <QuerySnippet text={r.queryText} dissection={r.dissection} max={120} />
                {expandable && (
                  <span className="ml-1 inline-flex items-center gap-0.5 align-baseline text-[10px] font-medium text-[hsl(var(--primary))] group-hover:underline">
                    <ChevronDown className="w-3 h-3" /> expand
                  </span>
                )}
              </p>
            )}
            {inNeedsDecision && (
              <p className="mt-1 flex flex-wrap items-baseline gap-1.5 text-[11px] text-[hsl(var(--muted-foreground))]">
                <span className={`shrink-0 rounded border px-1 py-0.5 text-[10px] font-medium ${lean.cls}`}>
                  {lean.label}
                </span>
                {r.rationale && <span className="italic">{r.rationale}</span>}
              </p>
            )}
            {(priorLabel || r.stale) && (
              <span className="mt-0.5 block text-[10px] text-[hsl(var(--muted-foreground))]">
                {priorLabel}
                {r.stale ? `${priorLabel ? ' · ' : ''}stale rating` : ''}
              </span>
            )}
          </button>
          <span className="flex items-center gap-1 shrink-0">
            {showIn && (
              <button
                onClick={() => togglePin(r, 'in')}
                className={`px-1.5 py-0.5 rounded text-[11px] font-medium border ${
                  r.pinned === 'in'
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'border-[hsl(var(--border))] text-emerald-700 hover:bg-emerald-50'
                }`}
                title="Pin: this question BELONGS to the intent"
              >
                in
              </button>
            )}
            {showOut && (
              <button
                onClick={() => togglePin(r, 'out')}
                className={`px-1.5 py-0.5 rounded text-[11px] font-medium border ${
                  r.pinned === 'out'
                    ? 'bg-rose-600 text-white border-rose-600'
                    : 'border-[hsl(var(--border))] text-rose-700 hover:bg-rose-50'
                }`}
                title="Pin: this question does NOT belong to the intent"
              >
                out
              </button>
            )}
          </span>
        </div>
      </li>
    );
  };

  const phase: 'define' | 'results' = data ? 'results' : 'define';

  return (
    <Dialog open={open} onClose={handleClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/40" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="w-full max-w-5xl h-[88vh] flex flex-col overflow-hidden rounded-lg bg-[hsl(var(--card))] border border-[hsl(var(--border))] shadow-xl">
          <div className="px-4 py-3 border-b border-[hsl(var(--border))] flex items-center justify-between">
            <DialogTitle className="text-sm font-semibold">
              {isEdit ? 'Edit intent' : 'New Intent'}
              {title.trim() ? ` — ${title.trim()}` : ''}
            </DialogTitle>
            <button onClick={handleClose} className="p-1 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Independent-scroll columns. The height chain is carried by flex-grow
              (flex-1 + min-h-0), NOT h-full: the panel uses max-h (not a fixed
              height), so percentage heights are treated as indefinite, but a
              flex-1 item DOES get a definite bounded height (same mechanism as
              the original single-scroll body). Mobile stacks and scrolls whole. */}
          <div className="flex-1 min-h-0 flex flex-col overflow-y-auto md:overflow-hidden">
            <div className="flex flex-col md:flex-row gap-0 flex-1 min-h-0">
              {/* LEFT — definition (fixed; scrolls on its own if tall) */}
              <div className="p-4 space-y-3 border-b md:border-b-0 md:border-r border-[hsl(var(--border))] md:w-2/5 md:shrink-0 min-h-0 md:overflow-y-auto">
                <label className="block text-xs">
                  <span className="font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                    Title <span className="font-normal normal-case">(auto-named on save unless you type one)</span>
                  </span>
                  <input
                    value={title}
                    onChange={(e) => {
                      setTitle(e.target.value);
                      setTitleDirty(true);
                    }}
                    placeholder="Auto-generated from the definition"
                    className="mt-1 w-full text-sm border border-[hsl(var(--border))] rounded px-2 py-1.5 bg-[hsl(var(--background))]"
                  />
                </label>
                <label className="block text-xs">
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                      When a student… (definition)
                    </span>
                    <button
                      onClick={(e) => {
                        e.preventDefault(); // keep the label from focusing the textarea
                        setPromptPreviewOpen(true);
                      }}
                      className="inline-flex items-center gap-1 shrink-0 px-1.5 py-0.5 rounded border border-[hsl(var(--border))] text-[10px] font-medium normal-case text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]"
                      title="See the exact prompt the classifier receives for this intent"
                    >
                      <Eye className="w-3 h-3" /> Prompt preview
                    </button>
                  </span>
                  <textarea
                    value={definition}
                    onChange={(e) => {
                      setDefinition(e.target.value);
                      setSuggestDismissed(false);
                    }}
                    rows={4}
                    placeholder="e.g. asks the chatbot to write a thesis statement or conclusion for them"
                    className="mt-1 w-full text-sm border border-[hsl(var(--border))] rounded px-2 py-1.5 bg-[hsl(var(--background))]"
                  />
                </label>

                {/* Create mode: taxonomy suggestions fuzzy-matched as they type. */}
                {!isEdit && !suggestDismissed && jelsonMatches.length > 0 && (
                  <div className="rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30">
                    <div className="flex items-center justify-between px-2 py-1 text-[11px] text-[hsl(var(--muted-foreground))]">
                      <span className="inline-flex items-center gap-1 font-medium">
                        <Wand2 className="w-3 h-3" /> Suggested starter sets
                      </span>
                      <button
                        onClick={() => setSuggestDismissed(true)}
                        className="p-0.5 hover:text-[hsl(var(--foreground))]"
                        title="Dismiss suggestions"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                    <ul className="pb-1">
                      {jelsonMatches.map(({ suggestion }) => {
                        const prepared = !!templates?.some(
                          (t) => t.definition.trim() === jelsonToIntent(suggestion).definition.trim()
                        );
                        return (
                          <li key={suggestion.code}>
                            <div className="flex items-center gap-1 pr-2 hover:bg-[hsl(var(--muted))]">
                              <button
                                onClick={() => applySuggestion(suggestion)}
                                className="flex-1 min-w-0 text-left px-2 py-1.5 flex items-start gap-2"
                                title={`${suggestion.code} · ${suggestion.description}${prepared ? ' — prepared, results load instantly' : ''}`}
                              >
                                <span className="mt-0.5 shrink-0 rounded bg-[hsl(var(--background))] border border-[hsl(var(--border))] px-1 text-[10px] font-mono text-[hsl(var(--muted-foreground))]">
                                  {suggestion.typeLabel}
                                </span>
                                <span className="min-w-0">
                                  <span className="flex items-center gap-1.5 text-xs font-medium">
                                    <span className="truncate">{suggestion.label}</span>
                                    {prepared && (
                                      <span
                                        className="shrink-0 w-1.5 h-1.5 rounded-full bg-emerald-500"
                                        title="Prepared — results load instantly"
                                      />
                                    )}
                                  </span>
                                  <span className="block text-[11px] text-[hsl(var(--muted-foreground))] line-clamp-1">
                                    {suggestion.description}
                                  </span>
                                </span>
                              </button>
                              <button
                                onClick={() => applySuggestion(suggestion)}
                                disabled={busy || saving}
                                title={
                                  prepared
                                    ? 'Apply — its questions appear immediately (already rated)'
                                    : 'Apply — rate the log against this set and show its questions'
                                }
                                className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-[hsl(var(--primary))] text-[10px] font-medium text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/10 disabled:opacity-50"
                              >
                                <Search className="w-3 h-3" /> Apply
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                    <p className="px-2 pb-1 text-[10px] text-[hsl(var(--muted-foreground))]">
                      Apply a set — its matching questions appear immediately (green dot = pre-rated, no
                      model call).
                    </p>
                  </div>
                )}
                {refineReasoning && (
                  <details className="text-[11px] text-[hsl(var(--muted-foreground))] rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 px-2 py-1.5">
                    <summary className="cursor-pointer font-medium text-[hsl(var(--foreground))]">
                      Definition proposed from your labels — review, then Save or Apply
                    </summary>
                    <p className="mt-1 whitespace-pre-wrap">{refineReasoning}</p>
                  </details>
                )}

                {/* Labeled by you — the questions you reviewed and marked in/out.
                    These ARE the Included/Excluded examples injected into the
                    rating prompt, so they live here with the spec. Collapsible;
                    remove with ×. */}
                {data && (
                  <div className="space-y-2 border-t border-[hsl(var(--border))] pt-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                      Labeled by you{' '}
                      <span className="font-normal normal-case">
                        — questions you reviewed &amp; marked, injected into the prompt
                      </span>
                    </p>
                    {(
                      [
                        { key: 'in' as const, label: 'Included', rows: pinnedIn, open: incOpen, setOpen: setIncOpen, head: 'text-emerald-700 bg-emerald-50/60 hover:bg-emerald-50' },
                        { key: 'out' as const, label: 'Excluded', rows: pinnedOut, open: excOpen, setOpen: setExcOpen, head: 'text-rose-700 bg-rose-50/60 hover:bg-rose-50' },
                      ]
                    ).map((g) => (
                      <div key={g.key} className="rounded border border-[hsl(var(--border))] overflow-hidden">
                        <button
                          onClick={() => g.setOpen((v) => !v)}
                          className={`w-full flex items-center justify-between px-2 py-1 text-[11px] font-medium ${g.head}`}
                        >
                          <span>
                            {g.label} · {g.rows.length}
                          </span>
                          {g.open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>
                        {g.open &&
                          (g.rows.length > 0 ? (
                            <ul className="max-h-40 overflow-y-auto divide-y divide-[hsl(var(--border))]/60 border-t border-[hsl(var(--border))]">
                              {g.rows.map((r) => (
                                <li key={r.messageId} className="flex items-start gap-1.5 px-2 py-1.5 text-[11px]">
                                  <span className="min-w-0 flex-1 text-[hsl(var(--foreground))]">
                                    {(() => {
                                      const c = r.queryText.replace(/\s+/g, ' ').trim();
                                      return c.length > 120 ? `${c.slice(0, 120)}…` : c;
                                    })()}
                                  </span>
                                  <button
                                    onClick={() => togglePin(r, g.key)}
                                    title="Remove this example"
                                    className="shrink-0 text-[hsl(var(--muted-foreground))] hover:text-red-600"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="px-2 py-1.5 text-[11px] text-[hsl(var(--muted-foreground))] border-t border-[hsl(var(--border))]">
                              None yet — pin questions on the right.
                            </p>
                          ))}
                      </div>
                    ))}
                  </div>
                )}

                {/* actions — Apply (rate silently, nothing registered) · Save
                    (register: version + live intent) · Update from labels */}
                <div className="space-y-2 border-t border-[hsl(var(--border))] pt-3">
                  {(() => {
                    // "Applied" = the shown ratings exactly reflect the current
                    // definition + labels. Apply is pointless then; Save is the
                    // next step. Anything dirty flips the two.
                    const applied =
                      !!data && !specDirty() && !pinsDirty && (data?.staleCount ?? 0) === 0;
                    return (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={save}
                          disabled={saving || busy || !definition.trim() || !applied}
                          title={
                            !data
                              ? 'Apply first — Save registers the applied result as a version'
                              : specDirty()
                                ? 'Definition changed — Apply it before saving'
                                : pinsDirty || (data?.staleCount ?? 0) > 0
                                  ? 'Labels changed — Apply to re-rate, then Save'
                                  : isEdit || draftIdRef.current === null
                                    ? 'Save a version of the applied state (definition + your in/out labels)'
                                    : 'Register this intent — record v1 with the applied state'
                          }
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-[hsl(var(--border))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] disabled:opacity-50"
                        >
                          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <SaveIcon className="w-3.5 h-3.5" />}
                          Save
                        </button>
                        <button
                          onClick={() => apply()}
                          disabled={busy || saving || !definition.trim() || !openaiConfigured || applied}
                          title={
                            !openaiConfigured
                              ? 'OPENAI_API_KEY is not configured'
                              : applied
                                ? 'Up to date — change the definition or labels to re-apply'
                                : 'Rate every question in the log against this definition (nothing is registered until Save)'
                          }
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] disabled:opacity-50"
                        >
                          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                          Apply
                        </button>
                    <button
                      onClick={refineFromLabels}
                      disabled={
                        refining || busy || saving || intentId === null ||
                        pinnedIn.length + pinnedOut.length === 0 || !openaiConfigured
                      }
                      title={
                        intentId === null || pinnedIn.length + pinnedOut.length === 0
                          ? 'Label at least one question in/out first'
                          : 'Rewrite the definition so it carries your labels by itself (stronger model; result is a draft to review)'
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-[hsl(var(--primary))]/50 text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/10 disabled:opacity-50 disabled:border-[hsl(var(--border))] disabled:text-[hsl(var(--muted-foreground))]"
                    >
                      {refining ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                      Update from labels
                    </button>
                      </div>
                    );
                  })()}
                  {busy && progress && (
                    <div className="flex items-center gap-2 text-[11px] text-[hsl(var(--muted-foreground))]">
                      <span className="shrink-0">Rating the log</span>
                      <div className="flex-1 h-1.5 rounded bg-[hsl(var(--muted))] overflow-hidden">
                        <div
                          className="h-full bg-[hsl(var(--primary))] transition-all"
                          style={{
                            width: `${progress.total ? Math.round((progress.rated / progress.total) * 100) : 0}%`,
                          }}
                        />
                      </div>
                      <span className="shrink-0 tabular-nums">
                        {progress.rated}/{progress.total}
                      </span>
                    </div>
                  )}
                  {error && (
                    <p className="flex items-center gap-1 text-xs text-red-600">
                      <AlertTriangle className="w-3.5 h-3.5" /> {error}
                    </p>
                  )}
                </div>

                {/* History — one line per saved version of THIS intent. Clicking
                    a version CHECKS IT OUT (title/definition/labels/ratings load
                    instantly from the stored state); Apply rolls back to it;
                    "Back to latest" returns to the live spec. */}
                {versions && versions.length > 0 && (
                  <div className="space-y-1.5 border-t border-[hsl(var(--border))] pt-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                        History
                        {checkout !== null && (
                          <span className="ml-1.5 normal-case font-normal text-amber-700">
                            viewing v
                            {versions.find((x) => x.versionNo === checkout)?.intentVersion ?? '?'} —
                            Apply to roll back
                          </span>
                        )}
                      </p>
                      <button
                        onClick={backToLatest}
                        disabled={checkout === null || busy || saving}
                        title={
                          checkout !== null
                            ? 'Return to the latest (live) version'
                            : 'Click a version below to view it; this returns you to the latest'
                        }
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-[hsl(var(--primary))] text-[10px] font-medium text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/10 disabled:opacity-40 disabled:border-[hsl(var(--border))] disabled:text-[hsl(var(--muted-foreground))]"
                      >
                        <RotateCcw className="w-3 h-3" /> Back to latest
                      </button>
                    </div>
                    <ul className="space-y-1.5">
                      {versions.map((v) => {
                        const active = v.versionNo === checkout;
                        return (
                          <li key={v.versionNo}>
                            <button
                              onClick={() => (active ? backToLatest() : openVersion(v.versionNo))}
                              disabled={busy || saving}
                              title="View this version — its definition, labels, and results load instantly"
                              className={`w-full text-left rounded border px-2 py-1.5 text-[11px] ${
                                active
                                  ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5'
                                  : 'border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/40'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2 text-[hsl(var(--muted-foreground))]">
                                <span className="font-mono" title={`config v${v.versionNo}`}>
                                  v{v.intentVersion}
                                </span>
                                <span className="truncate">
                                  {ACTION_LABELS[v.action] ?? v.action.replace(/_/g, ' ')}
                                  {v.action === 'add_pin' && v.detail ? ` ${v.detail}` : ''}
                                </span>
                                <span className="shrink-0">
                                  {new Date(v.createdAt).toLocaleString(undefined, {
                                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                                  })}
                                </span>
                              </div>
                              {v.definition && (
                                <p className="mt-0.5 text-[hsl(var(--foreground))]" title={v.definition}>
                                  {v.title ? <span className="font-medium">{v.title} — </span> : null}
                                  {v.definition.length > 90 ? `${v.definition.slice(0, 90)}…` : v.definition}
                                </p>
                              )}
                              <p className="mt-0.5 text-[hsl(var(--muted-foreground))]">
                                <span className="text-emerald-700">included {v.included}</span>
                                {' · '}
                                <span className="text-rose-700">excluded {v.excluded}</span>
                                {v.stats ? ` · in this intent ${v.stats.inCount}` : ''}
                              </p>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>

              {/* RIGHT — matching questions. Two stacked panes on desktop: TOP =
                  Clearly in; BOTTOM = tabbed boundary (Probably in/out · Clearly
                  out) — every question shows the model's short rationale. Panes
                  scroll independently via flex-grow; mobile stacks into the body
                  scroll. ('unsure' is dropped — the model never emits it.) */}
              <div className="min-h-[300px] md:min-h-0 md:flex-1 flex flex-col md:overflow-hidden">
                {!data ? (
                  <div className="flex-1 flex items-center justify-center p-8 text-center text-sm text-[hsl(var(--muted-foreground))]">
                    {busy
                      ? 'Rating every question in the log against this definition…'
                      : isEdit
                        ? 'Loading this intent’s questions…'
                        : 'Define the intent, then Apply to rate the log against it.'}
                  </div>
                ) : (
                  <>
                    {/* header — query search + overlaps. The 4 internal rating
                        levels are hidden; they map to the two lists below. */}
                    <div className="shrink-0 bg-[hsl(var(--card))] border-b border-[hsl(var(--border))] px-3 py-2 space-y-1.5">
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[hsl(var(--muted-foreground))]" />
                        <input
                          value={querySearch}
                          onChange={(e) => setQuerySearch(e.target.value)}
                          placeholder="Search query text…"
                          className="w-full pl-7 pr-7 py-1 text-xs border border-[hsl(var(--border))] rounded bg-[hsl(var(--background))] text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
                        />
                        {querySearch && (
                          <button
                            onClick={() => setQuerySearch('')}
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                            aria-label="Clear search"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
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
                            — questions matched by both intents; decide ownership from the intent board.
                          </span>
                        </div>
                      )}
                    </div>

                    {/* resizable split: TOP = In this intent, BOTTOM = Needs decision */}
                    <div ref={splitRef} className="md:flex-1 md:min-h-0 md:flex md:flex-col">
                      {/* TOP pane — In this intent (captured: clearly-in + pinned-in) */}
                      <div
                        style={{ flexGrow: topGrow }}
                        className="md:basis-0 md:min-h-0 md:overflow-y-auto border-b border-[hsl(var(--border))]"
                      >
                        <div className="sticky top-0 z-10 px-3 py-1.5 bg-[hsl(var(--muted))]/60 border-b border-[hsl(var(--border))] flex items-center justify-between gap-2">
                          <span className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                            In this intent · {inThisIntent.length}
                          </span>
                          <select
                            value={inSort}
                            onChange={(e) => setInSort(e.target.value as typeof inSort)}
                            title="Sort"
                            className="text-[10px] border border-[hsl(var(--border))] rounded px-1 py-0.5 bg-[hsl(var(--background))] text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
                          >
                            <option value="newest">Newest</option>
                            <option value="oldest">Oldest</option>
                          </select>
                        </div>
                        {(() => {
                          const rows = sortRows(inThisIntent, inSort);
                          return rows.length > 0 ? (
                            <ul className="divide-y divide-[hsl(var(--border))]/60">{rows.map(renderRow)}</ul>
                          ) : (
                            <p className="p-4 text-xs text-[hsl(var(--muted-foreground))]">
                              {querySearch ? 'No matching question.' : 'Nothing captured yet — decide the questions below.'}
                            </p>
                          );
                        })()}
                      </div>

                      {/* draggable divider (desktop only) */}
                      <div
                        onMouseDown={startResize}
                        className="hidden md:flex shrink-0 h-2 cursor-row-resize items-center justify-center bg-[hsl(var(--muted))] hover:bg-[hsl(var(--primary))]/30 border-y border-[hsl(var(--border))]"
                        title="Drag to resize"
                      >
                        <div className="w-8 h-0.5 rounded bg-[hsl(var(--border))]" />
                      </div>

                      {/* BOTTOM pane — Needs decision (model-uncertain; label in/out) */}
                      <div style={{ flexGrow: 10 - topGrow }} className="md:basis-0 md:min-h-0 flex flex-col">
                        <div className="shrink-0 px-3 py-1.5 bg-[hsl(var(--muted))]/40 border-b border-[hsl(var(--border))] flex items-center justify-between gap-2">
                          <span className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))] flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span>Needs decision · {needsDecision.length}</span>
                            {needsDecision.length > 0 && (
                              <span className="font-normal normal-case">
                                <span className="text-emerald-700">probably in {ndProbablyIn}</span>
                                {' · '}
                                <span className="text-rose-700">probably out {ndProbablyOut}</span>
                              </span>
                            )}
                          </span>
                          <span className="flex items-center gap-1 shrink-0">
                            {similarBusy && ndSort === 'pins' && (
                              <Loader2 className="w-3 h-3 animate-spin text-[hsl(var(--muted-foreground))]" />
                            )}
                            <select
                              value={ndSort}
                              onChange={(e) => setNdSort(e.target.value as typeof ndSort)}
                              title="Sort"
                              className="text-[10px] border border-[hsl(var(--border))] rounded px-1 py-0.5 bg-[hsl(var(--background))] text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))] normal-case font-normal"
                            >
                              <option value="pins">By your pins</option>
                              <option value="newest">Newest</option>
                              <option value="oldest">Oldest</option>
                            </select>
                          </span>
                        </div>
                        <div className="md:flex-1 md:min-h-0 md:overflow-y-auto">
                          {(() => {
                            const rows = sortRows(needsDecision, ndSort);
                            return rows.length > 0 ? (
                              <ul className="divide-y divide-[hsl(var(--border))]/60">{rows.map(renderRow)}</ul>
                            ) : (
                              <p className="p-4 text-xs text-[hsl(var(--muted-foreground))]">
                                {querySearch ? 'No matching question.' : 'Nothing to decide — every question is settled.'}
                              </p>
                            );
                          })()}
                        </div>
                      </div>
                    </div>

                  </>
                )}
              </div>
            </div>
          </div>

          <div className="px-4 py-3 border-t border-[hsl(var(--border))] flex items-center justify-between gap-2">
            {isEdit ? (
              <button
                onClick={archive}
                disabled={busy}
                className="inline-flex items-center gap-1 text-xs text-red-600 hover:underline disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" /> Archive intent
              </button>
            ) : (
              <span />
            )}
            <button
              onClick={handleClose}
              className="px-3 py-1.5 text-xs font-medium rounded bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
            >
              {phase === 'results' ? 'Done' : 'Close'}
            </button>
          </div>

          {/* PROMPT PREVIEW — the exact classifier input for this intent. */}
          {promptPreviewOpen && promptPreview && (
            <div
              className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
              onClick={() => setPromptPreviewOpen(false)}
            >
              <div
                className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-lg bg-[hsl(var(--background))] border border-[hsl(var(--border))] shadow-xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="shrink-0 px-4 py-3 border-b border-[hsl(var(--border))] flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold flex items-center gap-1.5">
                    <Eye className="w-4 h-4" /> Prompt preview — what the classifier receives
                  </h2>
                  <button
                    onClick={() => setPromptPreviewOpen(false)}
                    className="p-1 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                    aria-label="Close"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3 text-xs">
                  <section>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                      System prompt — shared by every question in a run (prompt-cached)
                    </p>
                    <pre className="whitespace-pre-wrap rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 p-2.5 font-mono text-[11px] leading-relaxed">
                      {promptPreview.system}
                    </pre>
                  </section>
                  <section>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                      User message — one per question (placeholders shown)
                    </p>
                    <pre className="whitespace-pre-wrap rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 p-2.5 font-mono text-[11px] leading-relaxed">
                      {promptPreview.user}
                    </pre>
                  </section>
                  <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
                    A rating run sends one call per question: this system prompt (also covering the other
                    stale intents in the same run) + that question&apos;s user message. Included/Excluded
                    examples carry your {MAX_PINS_IN_PROMPT} most recent labels — the order here is
                    approximate. The model answers in JSON: a ≤10-word rationale, then a rating, per intent.
                  </p>
                </div>
              </div>
            </div>
          )}
        </DialogPanel>
      </div>
    </Dialog>
  );
}
