'use client';

/**
 * SCORE v6 — the inline intent workbench (replaces the old IntentModal dialog).
 *
 * Editing or creating an intent transforms the BOARD ITSELF: the board's
 * 3-column grid is swapped for this one, keeping the same shape —
 *   LEFT   the spec: title · definition · labeled examples · actions · history
 *   MIDDLE "In this intent" — what the definition captures (clearly-in + pins)
 *   RIGHT  "Needs decision" — the model-uncertain questions to label in/out
 * Clicking a question in either list opens its FULL conversation in place of
 * that list (the board viewer's theater-style thread, shared component), so a
 * labeling call that needs the chatbot's reply never leaves the workbench.
 *
 * The Apply/Save lifecycle is unchanged from the modal:
 *  - "Apply" persists the spec silently (create → unregistered draft), rates
 *    the whole log against just this intent, and loads the two lists.
 *  - Pinning in/out changes the prompt (and defHash) → re-Apply gates Save.
 *  - "Save" registers: the draft becomes a live intent + a version entry.
 *  - Leaving without Save purges the draft (unmount + beforeunload).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type MaterialKind,
  type RatingLevel,
  type ScoreQueryType,
} from '@/lib/score/intents';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  GitCompareArrows,
  Loader2,
  Minimize2,
  Pencil,
  RotateCcw,
  Save as SaveIcon,
  Search,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import { runShardedRate } from './rate-runner';
import { DefinitionEditor, QueryTextButton, WorkbenchTopBar } from './workbench-shared';
import { ConversationThread } from './conversation';
import type { IntentSummary, ScoreQueryRow } from './IntentBoard';

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
  /** Instructor's reason this example is OUT (out pins only) — shown in the
   * Excluded list and injected into the rating prompt. Null otherwise. */
  reason: string | null;
  /** Position among this intent's pins in PROMPT order (0 = first listed), null
   * when unpinned. Optimistic local pins use negative ranks so a just-pinned
   * example leads, exactly as the server's newest-first order would place it. */
  pinRank: number | null;
  /** An EARLIER node in this intent's chain that takes the question first
   * (v7 first-match routing) — null when nothing shadows it. */
  shadowedBy: number | null;
  shadowedByTitle: string | null;
  /** Message split into Material vs Request(s), for the expand view. */
  dissection: { materialKinds: MaterialKind[]; requests: string[] } | null;
}

// The two pin-driven orders both rank by the same embedding score (max cosine
// to the IN pins − max cosine to the OUT pins), just in opposite directions.
// The lean tabs already split in from out, so no signed cross-lean measure is
// needed — each tab just picks a direction.
type NdSort = 'in-like' | 'out-like' | 'newest' | 'oldest';

/** Prompt order: the server's pin index, with optimistic (negative) pins first. */
function byPinRank(a: RatingRow, b: RatingRow): number {
  return (a.pinRank ?? Number.MAX_SAFE_INTEGER) - (b.pinRank ?? Number.MAX_SAFE_INTEGER);
}

interface RatingsPayload {
  intent: { id: number; title: string; definition: string };
  rows: RatingRow[];
  ratedCount: number;
  staleCount: number;
  includedCount: number;
  /** Earlier chain nodes intercepting questions this intent matches. */
  shadowedBy: { intentId: number; title: string; count: number }[];
  versionNo: number;
}

interface IntentVersion {
  versionNo: number;
  /** This intent's OWN major version number (v1, v2, …), not the global config no. */
  intentVersion: number;
  /** Minor entry (an Apply / a label) — folded into the accordion under its
   * preceding major; numbered {major}.{minorNo}. */
  minor: boolean;
  minorNo: number | null;
  createdAt: string;
  action: string;
  detail: string | null;
  title: string | null;
  definition: string | null;
  included: number;
  excluded: number;
  /** The labeled questions in effect at this version — the Apply entry's tooltip. */
  labeled: { verdict: 'in' | 'out'; text: string }[];
  stats: { included: number; excluded: number; inCount: number } | null;
}

/** Instructor-facing labels for the version-history actions (majors). */
const ACTION_LABELS: Record<string, string> = {
  create_intent: 'created',
  update_intent: 'saved',
  archive_intent: 'archived',
  restore_intent: 'restored',
  add_pin: 'labeled',
  remove_pin: 'label removed',
  add_link: 'link added',
  remove_link: 'link removed',
  ownership_pins: 'ownership decided',
  revert: 'reverted',
};

/** "v2" for majors, "v2.3" for minors (v0.x = applies before the first save). */
function versionLabel(v: IntentVersion): string {
  return v.minor ? `v${v.intentVersion}.${v.minorNo}` : `v${v.intentVersion}`;
}

/** What the entry DID, in one word — minors that persisted a spec are applies. */
function versionAction(v: IntentVersion): string {
  if (v.minor && (v.action === 'update_intent' || v.action === 'create_intent')) return 'applied';
  return ACTION_LABELS[v.action] ?? v.action.replace(/_/g, ' ');
}

/** The labeled questions at this version, one per line — the count's hover tooltip. */
function labeledTooltip(v: IntentVersion): string | undefined {
  if (!v.labeled?.length) return undefined;
  return v.labeled
    .map((l) => `${l.verdict === 'in' ? 'in  · ' : 'out · '}${l.text.replace(/\s+/g, ' ').trim().slice(0, 80)}`)
    .join('\n');
}

/** The free-text "Other" row of the out-reason picker. Keeps its own input
 * state so typing doesn't re-render the whole workbench; submit pins out with
 * the typed reason. */
function OutReasonOther({ onSubmit }: { onSubmit: (v: string) => void }) {
  const [v, setV] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (v.trim()) onSubmit(v);
      }}
      className="flex items-center gap-1 pt-0.5"
    >
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder="Other reason…"
        className="min-w-0 flex-1 rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[hsl(var(--ring))]"
      />
      <button
        type="submit"
        disabled={!v.trim()}
        className="shrink-0 px-2 py-1 rounded text-xs font-medium bg-rose-600 text-white disabled:opacity-40"
      >
        Out
      </button>
    </form>
  );
}

/** Compact relative time ("10 minutes ago") — the exact stamp goes in a tooltip. */
export function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export type WorkbenchMode =
  | { kind: 'edit'; intent: IntentSummary }
  | {
      kind: 'create';
      /** `type`/`parentIntentId` are the v7 placement — where the new set lands
       * in its type's tree, decided by where creation was invoked from. */
      seed?: {
        title?: string;
        definition?: string;
        /** A prepared starter set whose ratings are copied instead of re-run. */
        fromTemplateId?: number;
        type?: ScoreQueryType;
        parentIntentId?: number | null;
      } | null;
    };

interface IntentWorkbenchProps {
  assignmentId: string;
  model: string;
  openaiConfigured: boolean;
  /** The whole log — sizes the rate fan-out and backs the conversation view. */
  rows: ScoreQueryRow[];
  isNirvana: boolean;
  mode: WorkbenchMode;
  /** Leave the workbench (unsaved drafts are purged) — board refreshes. */
  onExit: () => void;
  /** Jump to editing ANOTHER intent (the overlap chips' shortcut): the parent
   * swaps `editIntent`, re-keying this workbench onto the target. Absent in
   * create/prompt-holder mounts, where the amber chip stays a static tag. */
  onEditIntent?: (intentId: number) => void;
}

export default function IntentWorkbench({
  assignmentId,
  model,
  openaiConfigured,
  rows,
  isNirvana,
  mode,
  onExit,
  onEditIntent,
}: IntentWorkbenchProps) {
  const isEdit = mode.kind === 'edit';
  const intent = isEdit ? mode.intent : null;
  const seed = mode.kind === 'create' ? mode.seed ?? null : null;
  const totalQuestions = rows.length;

  const [title, setTitle] = useState(intent?.title ?? seed?.title ?? '');
  // Whether the instructor typed the title themselves this session — if not,
  // every Save auto-generates it from the definition (git-commit style).
  const [titleDirty, setTitleDirty] = useState(!!seed?.title);
  const [definition, setDefinition] = useState(intent?.definition ?? seed?.definition ?? '');
  // "Out" reason picker: opened under the clicked out button, it offers three
  // LLM-suggested reasons (why this message isn't the intent) + a free-text
  // "Other", then pins out with the chosen reason. `anchor` positions it fixed
  // so it escapes the column's scroll clip. null = closed.
  const [outPicker, setOutPicker] = useState<{
    messageId: number;
    anchor: { left: number; top: number; bottom: number; width: number };
    loading: boolean;
    reasons: string[];
    error: string | null;
  } | null>(null);
  // Labels changed since the last Apply — the shown ratings no longer reflect
  // the prompt the pins produce, so Save (commit) is gated until re-Apply.
  const [pinsDirty, setPinsDirty] = useState(false);
  const [intentId, setIntentId] = useState<number | null>(intent?.id ?? null);
  // Create-mode discovery state. `draftIdRef` = an UNSAVED draft created this
  // session (by Apply, or by cloning a picked library template); it is not a
  // registered intent (is_template stays true) and is purged if the workbench
  // is left without Save. Library templates themselves are never mutated here.
  const draftIdRef = useRef<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refining, setRefining] = useState(false);
  const [retiring, setRetiring] = useState(false);
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
  // Conversation view: a clicked question's full thread REPLACES its own list
  // (same theater-style component as the board viewer) until Exit.
  const [convo, setConvo] = useState<{ messageId: number; pane: 'in' | 'nd' } | null>(null);
  // Rows whose TRUNCATED query is expanded in place (the inline link — reading
  // a long question must not require opening its whole conversation).
  const [expandedIds, setExpandedIds] = useState<Set<number>>(() => new Set());
  // Membership DIFF baseline: which saved version the "In this intent" set is
  // compared against. 'latest' (default) tracks the most recent save — so the
  // panes always show what entered/left since you last committed; picking a
  // version's "diff" control in History re-anchors the comparison there.
  const [diffSel, setDiffSel] = useState<'latest' | number>('latest');
  const [baseline, setBaseline] = useState<{
    versionNo: number;
    inSet: Set<number>;
    /** Where each message stood at the base: effectively in, effectively out
     * (pinned out / clearly_out), or undecided ('nd' — also unrated). */
    buckets: Map<number, 'in' | 'nd' | 'out'>;
  } | null>(null);
  const [newOpen, setNewOpen] = useState(true);
  const [leftOpen, setLeftOpen] = useState(true);
  // What is persisted server-side — Apply skips the save round trip when clean.
  const savedRef = useRef<{ title: string; definition: string }>(
    intent
      ? { title: intent.title, definition: intent.definition }
      : { title: '', definition: '' }
  );

  // Board rows by messageId — the conversation view joins through this.
  const rowByMessage = useMemo(() => new Map(rows.map((r) => [r.messageId, r])), [rows]);

  // Discard the unsaved discovery draft (fire-and-forget purge). Called when
  // switching suggestions or leaving without Save — an unsaved draft must not
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

  // Leave = exit discovery: an unsaved draft is discarded (no Save → not
  // registered, per the version-history contract).
  function exit() {
    discardDraft();
    onExit();
  }

  // Clone a prepared library template into an UNSAVED draft: spec + rating
  // rows copied server-side (same definition + no pins ⇒ same defHash, so the
  // copied ratings are already fresh). The draft behaves exactly like an
  // Apply-created one — pins attach to it, Save registers it, leaving without
  // Save purges it — while the template stays in the library untouched.
  //
  // Driven by the chooser: it decides that the seed's definition still matches
  // a template and passes the id through, so the questions are already there
  // when the workbench opens instead of costing a rating pass.
  async function adoptTemplate(templateId: number) {
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
    setData(null);
    setVersions(null);
    setPinsDirty(false);
    try {
      const res = await fetch(`/api/instructor/assignments/${assignmentId}/score/intents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromTemplateId: templateId,
          isTemplate: true, // unregistered draft until Save
          recordVersion: false,
          autoTitle: false,
          // The PLACEMENT of the scope this was created from. Library templates
          // are deliberately type-less (they are rated whole-log for the
          // baseline's searches), so without this the adopted set would be born
          // untyped — in no chain and invisible on the board until something
          // restated its placement.
          ...(seed?.type ? { type: seed.type, parentIntentId: seed.parentIntentId ?? null } : {}),
        }),
        signal: controller.signal,
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof d?.message === 'string' ? d.message : 'Failed to load the starter set.'
        );
      }
      const saved = d.intent as { id: number; title: string; definition: string };
      if (!live(controller.signal)) return;
      draftIdRef.current = saved.id; // unsaved draft — purged if left without Save
      setIntentId(saved.id);
      setTitle(saved.title);
      setDefinition(saved.definition);
      savedRef.current = { title: saved.title, definition: saved.definition };
      await fetchRatings(saved.id, controller.signal);
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError' && live(controller.signal)) {
        setError((e as Error).message);
      }
    } finally {
      if (live(controller.signal)) setBusy(false);
    }
  }

  // A seed carrying a template id is a starter set the chooser found already
  // rated — adopt it straight away, so its questions are on screen when the
  // workbench opens. Mount-only, like the title/definition seeds: `seed` is a
  // mount-time value and the parent re-keys this component per target.
  useEffect(() => {
    if (seed?.fromTemplateId) void adoptTemplate(seed.fromTemplateId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Collapse state for the LEFT boundary-example lists.
  const [incOpen, setIncOpen] = useState(true);
  const [excOpen, setExcOpen] = useState(true);
  // Per-pane query search + sorts. Both pin-driven orders rank by the embedding
  // score (max cosine to the IN pins − max cosine to the OUT pins); 'in-like'
  // puts the highest scores first, 'out-like' the lowest.
  const [inSearch, setInSearch] = useState('');
  const [ndSearch, setNdSearch] = useState('');
  // "In this intent" holds captures that all lean in, so its useful default is
  // out-like first — the members that look like they don't belong.
  const [inSort, setInSort] = useState<NdSort>('out-like');
  // Needs-decision lean tab: the probably-in or the probably-out side.
  // Everything without a clear in-lean (probably_out, legacy unsure, not
  // rated) lands on the out side so no row is ever hidden.
  const [ndFilter, setNdFilter] = useState<'in' | 'out'>('in');
  // One sort per lean tab, so each remembers its own order. Each defaults to the
  // "surprising" side — the probably-in questions that look OUT-like, and the
  // probably-out questions that look IN-like: the rows most likely mislabeled.
  const [ndSortIn, setNdSortIn] = useState<NdSort>('out-like');
  const [ndSortOut, setNdSortOut] = useState<NdSort>('in-like');
  const ndSort = ndFilter === 'in' ? ndSortIn : ndSortOut;
  const setNdSort = ndFilter === 'in' ? setNdSortIn : setNdSortOut;
  const [similarScores, setSimilarScores] = useState<Record<number, number> | null>(null);
  const [similarBusy, setSimilarBusy] = useState(false);

  // Descending counter feeding optimistic pinRank (-1, -2, …): a just-pinned
  // example must lead the prompt order the way the server's newest-first does.
  const optimisticPinRankRef = useRef(0);

  const mountedRef = useRef(true);
  // One controller per run; aborted on unmount so an in-flight rate loop can
  // neither keep billing the LLM in the background nor clobber a later run.
  const abortRef = useRef<AbortController | null>(null);

  // Mount: edit mode preloads the intent's ratings/pins and history so the
  // workbench opens straight into the matched-questions view. (The parent
  // keys this component per mode, so mount ≡ the modal's open-reset.)
  useEffect(() => {
    mountedRef.current = true;
    if (intent) {
      const controller = new AbortController();
      abortRef.current = controller;
      fetchRatings(intent.id, controller.signal).catch((e) => {
        if ((e as Error)?.name !== 'AbortError' && live(controller.signal)) {
          setError((e as Error).message);
        }
      });
      loadVersions(intent.id);
    }
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      // Leaving the workbench by ANY route (Back, board navigation, unmount)
      // discards an unsaved draft. No-op when nothing was drafted or after Save.
      discardDraft();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Browser-level leave (reload, tab close, external nav) — same purge, via
  // keepalive fetch so it survives the unload.
  useEffect(() => {
    const purge = () => discardDraft();
    window.addEventListener('beforeunload', purge);
    return () => window.removeEventListener('beforeunload', purge);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      // LIVE FILL — refresh the panes while the shards rate, so "In this
      // intent" / "Needs decision" accumulate in place instead of landing all
      // at once when the bar completes. Each shard batch commits its rows
      // immediately, so a periodic refetch simply picks them up; a failed tick
      // is dropped (the next one, or the final fetch below, catches up).
      let ratingDone = false;
      const livePoll = (async () => {
        try {
          await fetchRatings(id, signal); // first paint: current (possibly stale) rows
        } catch {
          /* best-effort */
        }
        while (!ratingDone && live(signal)) {
          await new Promise((r) => setTimeout(r, 2000));
          if (ratingDone || !live(signal)) break;
          try {
            await fetchRatings(id, signal);
          } catch {
            /* transient — retry next tick */
          }
        }
      })();
      try {
        await rateLoop(id, signal);
      } finally {
        ratingDone = true;
      }
      await livePoll;
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
   *    registered on the board yet. (A draft cloned from a library template
   *    behaves identically — the shared template itself is never mutated.)
   *  - Save (force=true) is the registration: flips is_template off and records
   *    the version (v1 = created).
   *  Returns the intent id. */
  async function persist(
    signal?: AbortSignal,
    force = false,
    specOverride?: { title: string; definition: string; createNew?: boolean },
    opts?: { silent?: boolean }
  ): Promise<number | null> {
    // Every Apply persists (and records a minor version), even when only the
    // labels changed and the definition matches the live one: since labels
    // stopped self-versioning, Apply is what snapshots the current label set
    // into History. The Apply button is disabled once `applied` is true, so a
    // true no-op (definition AND labels clean) never reaches here — no
    // redundant versions. A `silent` persist (Retire labels) still records none.
    const titleText = (specOverride?.title ?? title).trim();
    const defText = (specOverride?.definition ?? definition).trim();
    const autoTitle = specOverride ? !titleText : !titleDirty || !title.trim();
    const stats = {
      included: pinnedIn.length,
      excluded: pinnedOut.length,
      inCount: inThisIntent.length,
    };
    const isCreate = !!specOverride?.createNew || intentId === null;
    const payload = {
      title: autoTitle ? undefined : titleText,
      definition: defText,
      autoTitle,
      // Save records a MAJOR version; Apply records a MINOR one — an Apply costs
      // an LLM re-rate, so it must be revertible from History too. `silent`
      // persists the spec with NO version (used by Retire labels, which folds the
      // just-refined definition in before dropping the labels).
      ...(opts?.silent ? { recordVersion: false } : { recordVersion: true, ...(force ? {} : { minorVersion: true }) }),
      stats,
      // Creates start as unregistered drafts; Save activates (registers).
      // A create also carries its PLACEMENT: the scope it was invoked from is
      // its parent, and its rule is seeded from that scope (v7 §3.2/§3.5).
      ...(isCreate
        ? {
            isTemplate: true,
            ...(seed?.type ? { type: seed.type, parentIntentId: seed.parentIntentId ?? null } : {}),
          }
        : force
          ? {
              isTemplate: false,
              // Save also (re)states the placement: a draft that reached here
              // without one — e.g. adopted from a type-less library template —
              // would otherwise register into no chain at all.
              ...(seed?.type ? { type: seed.type, parentIntentId: seed.parentIntentId ?? null } : {}),
            }
          : {}),
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
        draftIdRef.current = saved.id; // unsaved draft — purged if left without Save
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

  /**
   * Retire every label of this intent, once refineFromLabels has folded them
   * into the definition. That is the whole point of the refine: the boundary
   * knowledge is meant to live in the definition TEXT, not ride along forever as
   * examples. With the labels gone the next Apply re-rates the log against the
   * definition standing alone — if the same questions come back, it absorbed
   * them; if they don't, the definition still needs work.
   *
   * A dirty definition (e.g. just-refined by Update from labels) is persisted
   * FIRST — silently, no version — so retiring the labels keeps the new
   * definition instead of leaving the old one behind.
   */
  async function retireLabels() {
    if (intentId === null || retiring || busy || saving || checkout !== null) return;
    if (pinCount === 0) return;
    if (
      !window.confirm(
        `Retire all ${pinCount} label(s)?\n\nThe definition keeps what it learned from them. ` +
          `The next Apply re-rates the log against the definition alone.`
      )
    ) {
      return;
    }
    setRetiring(true);
    setError(null);
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    try {
      // Fold the current (possibly just-refined) definition into the live intent
      // before dropping its labels — silent, so no version is recorded here.
      if (specDirty()) {
        const id = await persist(controller.signal, false, undefined, { silent: true });
        if (id === null || !live(controller.signal)) return;
      }
      const res = await fetch(
        `/api/instructor/assignments/${assignmentId}/score/intents/${intentId}/pins?all=1`,
        { method: 'DELETE', signal: controller.signal }
      );
      if (!res.ok) throw new Error('Failed to retire the labels.');
      await fetchRatings(intentId, controller.signal);
      if (live(controller.signal)) {
        setPinsDirty(true); // shown ratings still carry the retired pins → re-Apply
        setSimilarScores(null); // no pins left → the pin-driven sorts are moot
        setRefineReasoning(null);
      }
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError' && live(controller.signal)) {
        setError((e as Error).message);
      }
    } finally {
      if (mountedRef.current) setRetiring(false);
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

  // HARD REVERT (git-reset style): make the checked-out version the live spec
  // and DELETE every later step of this intent — the timeline rewinds instead
  // of stacking yet another entry. Confirmed in the UI; stored ratings for the
  // restored spec re-attach instantly.
  async function revertToCheckout() {
    if (intentId === null || checkout === null || busy || saving) return;
    const target = versions?.find((x) => x.versionNo === checkout);
    const laterCount = versions?.filter((x) => x.versionNo > checkout).length ?? 0;
    const label = target ? versionLabel(target) : `v${checkout}`;
    if (
      !window.confirm(
        `Revert to ${label}?\n\nThis makes ${label} the live version and permanently deletes the ${laterCount} later step(s) — including any Save among them. This cannot be undone.`
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    try {
      const res = await fetch(
        `/api/instructor/assignments/${assignmentId}/score/intents/${intentId}/revert`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ versionNo: checkout }),
          signal: controller.signal,
        }
      );
      if (!res.ok) throw new Error('Failed to revert.');
      if (!live(controller.signal)) return;
      setCheckout(null);
      setDiffSel('latest'); // the old base may be among the deleted steps
      setPinsDirty(false);
      const payload = await fetchRatings(intentId, controller.signal);
      if (live(controller.signal)) {
        setTitle(payload.intent.title);
        setDefinition(payload.intent.definition);
        setTitleDirty(false);
        savedRef.current = { title: payload.intent.title, definition: payload.intent.definition };
      }
      loadVersions(intentId);
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError' && live(controller.signal)) {
        setError((e as Error).message);
      }
    } finally {
      if (mountedRef.current) setBusy(false);
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
  async function togglePin(
    row: RatingRow,
    verdict: 'in' | 'out',
    reason?: string,
    /** v7: also clear the earlier sets that would answer this question first,
     * so an IN pin actually routes it here (§3.6). */
    routeHere?: boolean
  ) {
    // Checkout is a read-only view of a past version — pins mutate the LIVE
    // spec, so labeling is disabled until Apply (rollback) or Back to latest.
    if (intentId === null || checkout !== null) return;
    const next = row.pinned === verdict ? null : verdict;
    // The server refreshes createdAt on every (re-)pin, so a new pin leads the
    // prompt. Mirror that locally with a descending negative rank until the
    // next fetch supplies the real indices — otherwise the preview would show
    // this example last, or drop it, right after you added it.
    const nextRank = next === null ? null : --optimisticPinRankRef.current;
    // A reason only rides an OUT pin; clear it when pinning in or unpinning.
    const nextReason = next === 'out' ? reason?.trim() || null : null;
    const setPinned = (pinned: 'in' | 'out' | null, pinRank: number | null, rsn: string | null) =>
      setData((prev) =>
        prev
          ? {
              ...prev,
              rows: prev.rows.map((pr) =>
                pr.messageId === row.messageId ? { ...pr, pinned, pinRank, reason: rsn } : pr
              ),
            }
          : prev
      );
    setPinned(next, nextRank, nextReason);
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
              body: JSON.stringify({
                messageId: row.messageId,
                verdict,
                ...(nextReason ? { reason: nextReason } : {}),
                ...(routeHere ? { routeHere: true } : {}),
              }),
            });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(typeof d?.error === 'string' ? `Pin failed: ${d.error}` : 'Failed to update the pin.');
      }
      // "Send it here" also wrote out-pins on the earlier sets, which changes
      // THEIR specs — reload so the shadowing tags reflect the new order.
      if (routeHere) await fetchRatings(intentId, new AbortController().signal);
      // Labeling no longer records a version — the label set is captured on the
      // next Apply, so there is nothing to refresh in the history here.
    } catch (e) {
      if (mountedRef.current) {
        setPinned(row.pinned, row.pinRank, row.reason); // revert the optimistic flip
        setError((e as Error).message);
      }
    }
  }

  // Open the out-reason picker under the clicked button and fetch three
  // LLM-suggested reasons in the background. NOTHING is pinned until the
  // instructor picks or writes one (pickOutReason) — closing cancels the out.
  async function openOutPicker(row: RatingRow, btn: DOMRect) {
    if (intentId === null || checkout !== null) return;
    setOutPicker({
      messageId: row.messageId,
      anchor: { left: btn.left, top: btn.top, bottom: btn.bottom, width: btn.width },
      loading: true,
      reasons: [],
      error: null,
    });
    try {
      const res = await fetch(
        `/api/instructor/assignments/${assignmentId}/score/intents/${intentId}/exclusion-reasons`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messageId: row.messageId, ...(row.rationale ? { rationale: row.rationale } : {}) }),
        }
      );
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof d?.message === 'string' ? d.message : 'Could not suggest reasons.');
      const reasons = Array.isArray(d.reasons)
        ? d.reasons.filter((r: unknown): r is string => typeof r === 'string')
        : [];
      setOutPicker((p) => (p && p.messageId === row.messageId ? { ...p, loading: false, reasons } : p));
    } catch (e) {
      setOutPicker((p) =>
        p && p.messageId === row.messageId ? { ...p, loading: false, error: (e as Error).message } : p
      );
    }
  }

  // Commit the out pin with the chosen/typed reason (blank = out, no reason).
  function pickOutReason(reason: string) {
    if (!outPicker) return;
    const row = data?.rows.find((r) => r.messageId === outPicker.messageId);
    setOutPicker(null);
    if (row) togglePin(row, 'out', reason.trim() || undefined);
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
      onExit();
    } catch (e) {
      if (mountedRef.current) {
        setError((e as Error).message);
        setBusy(false);
      }
    }
  }

  // Two instructor-facing buckets — the 4 internal rating levels stay hidden:
  //  · IN THIS INTENT = the EFFECTIVE membership: pinned in, or clearly_in with
  //    no pin (pin overrides rating, §1.6). Pinning a row therefore never makes
  //    it vanish from here — its button just reads active (toggle to undo).
  //  · NEEDS DECISION = the model-uncertain, still-undecided (unpinned) questions.
  // Pinned-out and confident-out questions fall away (hidden as "not this
  // intent") — unless the diff base had them in, in which case the Left strip
  // keeps them visible. The instructor's pins ALSO appear on the LEFT with the
  // spec — that list is the ledger of Included/Excluded EXAMPLES injected into
  // the prompt.
  const inThisIntent = useMemo(
    () =>
      data
        ? data.rows.filter(
            (r) => r.pinned === 'in' || (r.pinned == null && r.rating === 'clearly_in')
          )
        : [],
    [data]
  );
  const needsDecision = useMemo(
    () =>
      data
        ? data.rows.filter(
            (r) =>
              r.pinned == null &&
              r.rating !== 'clearly_in' &&
              r.rating !== 'clearly_out' &&
              // During the live fill, not-yet-rated rows stay out — the pane
              // ACCUMULATES results rather than starting full and thinning.
              (r.rating !== null || !busy)
          )
        : [],
    [data, busy]
  );
  // Pinned rows in PROMPT order, not in data.rows order. data.rows arrives
  // sorted by rating strength, so slicing it hands the preview a different — and
  // systematically weaker-rated — pin set than the classifier sees: a boundary
  // example an instructor just labeled rates probably_*, so it sorts last there
  // while the server, ordering by pin recency, lists it first.
  const pinnedIn = useMemo(
    () => (data ? data.rows.filter((r) => r.pinned === 'in').sort(byPinRank) : []),
    [data]
  );
  const pinnedOut = useMemo(
    () => (data ? data.rows.filter((r) => r.pinned === 'out').sort(byPinRank) : []),
    [data]
  );
  const pinCount = pinnedIn.length + pinnedOut.length;

  // ---- Membership diff vs the baseline version --------------------------
  // "In the intent" for diff purposes = the EFFECTIVE membership: pinned in, or
  // clearly_in with no pin (pin overrides rating, §1.6) — so pinning a capture
  // in doesn't read as it "leaving", and pinning one out reads as a real exit.
  const effectiveIn = (rowsIn: { messageId: number; rating: RatingLevel | null; pinned: 'in' | 'out' | null }[]) =>
    new Set(
      rowsIn
        .filter((r) => r.pinned === 'in' || (r.pinned == null && r.rating === 'clearly_in'))
        .map((r) => r.messageId)
    );
  const effectiveInNow = useMemo(() => (data ? effectiveIn(data.rows) : new Set<number>()), [data]);

  // The version the diff is anchored to: the latest SAVE (major) by default —
  // an Apply records a minor entry, and diffing against the apply you just ran
  // would always read empty — or the one picked via "diff" in History.
  // Baseline membership loads from the same hash-keyed version store the
  // checkout uses (instant, zero LLM).
  const diffBaseNo =
    diffSel === 'latest' ? versions?.find((v) => !v.minor)?.versionNo ?? null : diffSel;
  useEffect(() => {
    if (diffBaseNo == null || intentId == null) {
      setBaseline(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/instructor/assignments/${assignmentId}/score/intents/${intentId}/ratings?versionNo=${diffBaseNo}`
        );
        const d = (await res.json().catch(() => null)) as RatingsPayload | null;
        if (!res.ok || !d || cancelled || !mountedRef.current) return;
        const buckets = new Map<number, 'in' | 'nd' | 'out'>();
        for (const r of d.rows) {
          buckets.set(
            r.messageId,
            r.pinned === 'in' || (r.pinned == null && r.rating === 'clearly_in')
              ? 'in'
              : r.pinned === 'out' || r.rating === 'clearly_out'
                ? 'out'
                : 'nd'
          );
        }
        setBaseline({ versionNo: diffBaseNo, inSet: effectiveIn(d.rows), buckets });
      } catch {
        if (!cancelled && mountedRef.current) setBaseline(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diffBaseNo, intentId, assignmentId]);

  // Entered/left since the baseline. `newlyIn` marks rows in the current lists;
  // `leftRows` no longer qualify for "In this intent", so they get their own
  // strip (their CURRENT rating row still exists — relabel from there).
  const newlyIn = useMemo(
    () =>
      baseline ? new Set([...effectiveInNow].filter((id) => !baseline.inSet.has(id))) : null,
    [baseline, effectiveInNow]
  );
  const leftRows = useMemo(
    () =>
      baseline && data
        ? data.rows.filter((r) => baseline.inSet.has(r.messageId) && !effectiveInNow.has(r.messageId))
        : [],
    [baseline, data, effectiveInNow]
  );
  // New arrivals grouped into their own strip at the top of "In this intent"
  // (mirrors the Left strip); the main list below shows the rest.
  const newInRows = useMemo(
    () => (newlyIn ? inThisIntent.filter((r) => newlyIn.has(r.messageId)) : []),
    [inThisIntent, newlyIn]
  );
  const diffBaseLabel = useMemo(() => {
    if (!baseline) return null;
    const v = versions?.find((x) => x.versionNo === baseline.versionNo);
    return v ? versionLabel(v) : `v${baseline.versionNo}`;
  }, [baseline, versions]);

  // History accordion: each MAJOR (Save/create/…) owns the minors that came
  // after it (the applies/labels building toward the next save). Minors before
  // the first save (v0.x drafting) form a trailing group of their own.
  const versionGroups = useMemo(() => {
    if (!versions) return [];
    const groups: { key: string; major: IntentVersion | null; minors: IntentVersion[] }[] = [];
    let pending: IntentVersion[] = [];
    for (const v of versions) {
      if (v.minor) {
        pending.push(v);
      } else {
        groups.push({ key: `v${v.versionNo}`, major: v, minors: pending });
        pending = [];
      }
    }
    if (pending.length > 0) groups.push({ key: 'draft', major: null, minors: pending });
    return groups;
  }, [versions]);
  // Which accordion groups the user has explicitly toggled; the NEWEST group
  // defaults open (its minors are the work since the last save).
  const [groupToggles, setGroupToggles] = useState<Record<string, boolean>>({});

  const ndProbablyIn = needsDecision.filter((r) => r.rating === 'probably_in').length;
  const ndProbablyOut = needsDecision.length - ndProbablyIn;
  // The rows the active lean tab shows (sorting/search apply on top of this).
  // The two tabs PARTITION the list — out = everything that isn't probably_in.
  const ndFiltered = useMemo(
    () =>
      needsDecision.filter((r) =>
        ndFilter === 'in' ? r.rating === 'probably_in' : r.rating !== 'probably_in'
      ),
    [needsDecision, ndFilter]
  );

  // Pin-propagation score map (max cosine to IN pins − to OUT pins), feeding both
  // pin-driven sorts. Empty {} on failure so it doesn't refetch forever.
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
  // Load pin scores lazily when a pin-driven sort is active in EITHER pane;
  // invalidated to null on every pin change so the order reflects the latest pins.
  const isPinSort = (m: NdSort) => m === 'in-like' || m === 'out-like';
  const pinSorted = isPinSort(ndSort) || isPinSort(inSort);
  useEffect(() => {
    if (pinSorted && data && intentId != null && similarScores === null && !similarBusy) {
      fetchPins();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinSorted, data, intentId, similarScores]);

  // Overlapping captures (another intent also owns the question, or it sits in
  // a boundary) float to the top of "In this intent" — they are the pending
  // ownership decisions. Stable within each partition.
  const isShadowedRow = (r: RatingRow) => r.shadowedBy !== null;
  const overlapsFirst = (list: RatingRow[]) => [
    ...list.filter(isShadowedRow),
    ...list.filter((r) => !isShadowedRow(r)),
  ];

  // Filter by the pane's search box, then sort by the chosen mode. The pin sorts
  // hold the incoming order until the scores land (null = still fetching), and
  // park rows with no embedding at the bottom — they can't sit on the in↔out axis.
  const sortRows = (rowsIn: RatingRow[], mode2: NdSort, search: string): RatingRow[] => {
    const q = search.trim().toLowerCase();
    const filtered = q ? rowsIn.filter((r) => r.queryText.toLowerCase().includes(q)) : rowsIn;
    if (mode2 === 'in-like' || mode2 === 'out-like') {
      if (!similarScores) return filtered;
      const scoreOf = (r: RatingRow) => similarScores[r.messageId];
      const scored = filtered.filter((r) => typeof scoreOf(r) === 'number');
      const unscored = filtered.filter((r) => typeof scoreOf(r) !== 'number');
      const dir = mode2 === 'out-like' ? 1 : -1; // out-like: lowest first; in-like: highest first
      scored.sort((a, b) => dir * (scoreOf(a) - scoreOf(b)));
      return [...scored, ...unscored];
    }
    const dir = mode2 === 'newest' ? -1 : 1;
    return [...filtered].sort((a, b) => dir * a.queryTimestamp.localeCompare(b.queryTimestamp));
  };

  // One history entry — row click = checkout (view that version instantly);
  // the small "diff" control anchors the membership comparison instead (no
  // nested buttons — the row is a clickable div). `compact` renders the
  // one-line MINOR variant used inside the accordion.
  const versionEntry = (v: IntentVersion, compact: boolean) => {
    const active = v.versionNo === checkout;
    // The newest entry IS the live spec — clicking it returns to live (no
    // read-only checkout of a state you are already on), and it reads as
    // "current" whenever nothing is checked out.
    const isNewest = versions?.[0]?.versionNo === v.versionNo;
    const highlighted = active || (checkout === null && isNewest);
    const isDiffBase = v.versionNo === diffBaseNo;
    const activate = () => {
      if (busy || saving) return;
      if (active || isNewest) backToLatest();
      else openVersion(v.versionNo);
    };
    const diffButton = (
      <button
        onClick={(e) => {
          e.stopPropagation();
          // Re-anchor the diff here; clicking the active base returns to the
          // default (latest save).
          setDiffSel(isDiffBase ? 'latest' : v.versionNo);
        }}
        title={
          isDiffBase
            ? diffSel === 'latest'
              ? 'Current diff base (the latest version — the default)'
              : 'Diff base — click to compare against the latest version again'
            : 'Show diff — compare the current "In this intent" set against this version'
        }
        className={`inline-flex items-center gap-0.5 rounded border px-1 py-0.5 text-xs font-medium ${
          isDiffBase
            ? 'border-sky-300 bg-sky-100 text-sky-800'
            : 'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]'
        }`}
      >
        <GitCompareArrows className="w-3 h-3" /> diff
      </button>
    );
    const absoluteTime = new Date(v.createdAt).toLocaleString();
    return (
      <div
        key={v.versionNo}
        role="button"
        tabIndex={0}
        onClick={activate}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          activate();
        }}
        title={
          isNewest
            ? 'The live version — click to return to it'
            : compact
              ? `${v.definition ?? ''}\n\n${absoluteTime} — click to view this state`
              : 'View this version — its definition, labels, and results load instantly'
        }
        className={`w-full cursor-pointer text-left rounded border text-xs ${
          compact ? 'px-2 py-1' : 'px-2 py-1.5'
        } ${
          highlighted
            ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5'
            : 'border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/40'
        } ${busy || saving ? 'opacity-50 pointer-events-none' : ''}`}
      >
        <div className="flex items-center justify-between gap-2 text-[hsl(var(--muted-foreground))]">
          <span className="shrink-0 font-mono" title={`config v${v.versionNo}`}>
            {versionLabel(v)}
            {isNewest && checkout === null && (
              <span className="ml-1 rounded bg-[hsl(var(--primary))]/10 px-1 py-px font-sans text-[11px] font-semibold text-[hsl(var(--primary))]">
                current
              </span>
            )}
          </span>
          <span className="min-w-0 flex-1 truncate">{versionAction(v)}</span>
          <span className="shrink-0 flex items-center gap-1.5">
            <span title={absoluteTime}>{timeAgo(v.createdAt)}</span>
            {diffButton}
          </span>
        </div>
        {compact && v.detail && (
          // What the step actually did — full text, wrapping (a truncated
          // "label removed “that concl…" is impossible to act on).
          <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-[hsl(var(--muted-foreground))]">
            {v.detail}
          </p>
        )}
        {/* An Apply's label summary: just the count, with the labeled questions
            on hover (they no longer clutter the history as one entry each). */}
        {compact && v.included + v.excluded > 0 && (
          <p className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]" title={labeledTooltip(v)}>
            {v.included + v.excluded} label{v.included + v.excluded === 1 ? '' : 's'} ·{' '}
            <span className="text-emerald-700">{v.included} in</span>
            {' · '}
            <span className="text-rose-700">{v.excluded} out</span>
          </p>
        )}
        {!compact && (
          <>
            {v.definition && (
              <p className="mt-0.5 text-[hsl(var(--foreground))]" title={v.definition}>
                {v.title ? <span className="font-medium">{v.title} — </span> : null}
                {v.definition.length > 90 ? `${v.definition.slice(0, 90)}…` : v.definition}
              </p>
            )}
            <p className="mt-0.5 text-[hsl(var(--muted-foreground))]" title={labeledTooltip(v)}>
              <span className="text-emerald-700">included {v.included}</span>
              {' · '}
              <span className="text-rose-700">excluded {v.excluded}</span>
              {v.stats ? ` · in this intent ${v.stats.inCount}` : ''}
            </p>
          </>
        )}
      </div>
    );
  };

  // One question row — query text (click to open its full conversation in this
  // pane) + the model's short rationale + its current prior-assignment status +
  // in/out pins. Reused by both panes: "In this intent" rows get the buttons
  // too (pin in = confirm as an example; pin out = overrule the model).
  const renderRow = (r: RatingRow, pane: 'in' | 'nd') => {
    // Buttons stay visible on PINNED rows too (active state, click to undo) —
    // a label never strips a row of its controls, only membership moves it.
    const showButtons = checkout === null;
    // Needs-decision drift chip: only rows whose standing CHANGED since the
    // diff base get one, stating the base-version verdict outright ("clearly
    // in/out · v1") — 'was in/out' read too close to the probably-in/out tabs.
    // Colors follow the verdict (in = emerald, out = rose), same as the pin
    // buttons; the drop/rise direction is implied by the row sitting here now.
    const baseBucket = pane === 'nd' ? baseline?.buckets.get(r.messageId) : undefined;
    const drift =
      baseBucket === 'in'
        ? {
            label: `clearly in · ${diffBaseLabel}`,
            cls: 'border-emerald-200 bg-emerald-50 text-emerald-700',
            title: `Clearly in this intent at ${diffBaseLabel} — dropped to undecided since`,
          }
        : baseBucket === 'out'
          ? {
              label: `clearly out · ${diffBaseLabel}`,
              cls: 'border-rose-200 bg-rose-50 text-rose-700',
              title: `Clearly out of this intent at ${diffBaseLabel} — rose to undecided since`,
            }
          : null;
    // SHADOWED = an earlier node in this intent's chain takes the question
    // first, so this intent never actually gets it. In this intent → a visible
    // amber tag (these rows also sort to the top); Needs decision keeps the
    // quieter text note. The chip is a shortcut into the intercepting intent.
    const overlapChip: { intentId: number | null; label: string; title: string } | null =
      pane === 'in' && r.shadowedBy !== null
        ? {
            intentId: r.shadowedBy,
            label: `taken by · ${r.shadowedByTitle ?? 'an earlier intent'}`,
            title: onEditIntent
              ? `“${r.shadowedByTitle ?? 'An earlier intent'}” comes first in this type and takes this question — click to edit it, or move this intent ahead of it`
              : `“${r.shadowedByTitle ?? 'An earlier intent'}” comes first in this type and takes this question`,
          }
        : null;
    const priorLabel =
      pane === 'nd' && r.shadowedBy !== null
        ? `taken first by “${r.shadowedByTitle ?? 'an earlier intent'}”`
        : '';
    return (
      <li key={r.messageId} className="group relative px-3 py-2 hover:bg-[hsl(var(--muted))]/40">
        <div className="flex items-start gap-2">
          <QueryTextButton
            queryText={r.queryText}
            dissection={r.dissection}
            expanded={expandedIds.has(r.messageId)}
            onToggleExpand={() =>
              setExpandedIds((prev) => {
                const next = new Set(prev);
                if (next.has(r.messageId)) next.delete(r.messageId);
                else next.add(r.messageId);
                return next;
              })
            }
            onOpen={() => setConvo({ messageId: r.messageId, pane })}
          >
            {(r.rationale || drift || overlapChip) && (
              <p className="mt-1 flex flex-wrap items-baseline gap-1.5 text-xs text-[hsl(var(--muted-foreground))]">
                {overlapChip &&
                  (overlapChip.intentId != null && onEditIntent ? (
                    // Shortcut INTO the overlapping intent's editor. role=button
                    // span (+ stopPropagation), NOT a <button> — this lives inside
                    // QueryTextButton, which is itself a <button>.
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditIntent(overlapChip.intentId!);
                      }}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter' && e.key !== ' ') return;
                        e.preventDefault();
                        e.stopPropagation();
                        onEditIntent(overlapChip.intentId!);
                      }}
                      title={overlapChip.title}
                      className="group/chip shrink-0 inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-1 py-0.5 text-xs font-medium text-amber-700 hover:bg-amber-100 hover:border-amber-300"
                    >
                      {overlapChip.label}
                      <Pencil className="w-2.5 h-2.5 opacity-0 group-hover/chip:opacity-100" />
                    </span>
                  ) : (
                    <span
                      className="shrink-0 rounded border border-amber-200 bg-amber-50 px-1 py-0.5 text-xs font-medium text-amber-700"
                      title={overlapChip.title}
                    >
                      {overlapChip.label}
                    </span>
                  ))}
                {drift && (
                  <span
                    className={`shrink-0 rounded border px-1 py-0.5 text-xs font-medium ${drift.cls}`}
                    title={drift.title}
                  >
                    {drift.label}
                  </span>
                )}
                {r.rationale && <span className="italic">{r.rationale}</span>}
              </p>
            )}
            {(priorLabel || r.stale) && (
              <span className="mt-0.5 block text-xs text-[hsl(var(--muted-foreground))]">
                {priorLabel}
                {r.stale ? `${priorLabel ? ' · ' : ''}stale rating` : ''}
              </span>
            )}
          </QueryTextButton>
        </div>
        {/* in/out sit in a hover overlay so the list stays uncluttered and the
            row never reflows when they appear. A pinned row keeps them shown so
            its verdict is always visible; so does an open reason picker. */}
        {showButtons && (
          <span
            className={`absolute right-2 top-1.5 z-10 flex items-center gap-1 rounded-md bg-[hsl(var(--card))] px-1 py-0.5 shadow-sm ring-1 ring-[hsl(var(--border))] transition-opacity focus-within:opacity-100 group-hover:opacity-100 ${
              r.pinned || outPicker?.messageId === r.messageId ? 'opacity-100' : 'opacity-0'
            }`}
          >
            {pinButtons(r)}
          </span>
        )}
      </li>
    );
  };

  // The in/out pin pair — shared by list rows and the conversation header so a
  // decision that needed the chatbot's reply is made without leaving the thread.
  // A render HELPER (not a nested component) so React doesn't see a fresh
  // component type each render and remount the buttons.
  const pinButtons = (row: RatingRow) => (
    <>
        <button
          onClick={() => togglePin(row, 'in')}
          className={`px-1.5 py-0.5 rounded text-xs font-medium border ${
            row.pinned === 'in'
              ? 'bg-emerald-600 text-white border-emerald-600'
              : 'border-[hsl(var(--border))] text-emerald-700 hover:bg-emerald-50'
          }`}
          title={
            row.shadowedBy !== null
              ? `Label: this question BELONGS to this intent. It will still be answered by “${row.shadowedByTitle ?? 'an earlier intent'}”, which comes first — use “send here” to change that.`
              : 'Label: this question BELONGS to this intent'
          }
        >
          in
        </button>
        {/* A label fixes the JUDGMENT, never the order — so when an earlier set
            answers this question, offer the one action that actually moves it. */}
        {row.shadowedBy !== null && (
          <button
            onClick={() => togglePin(row, 'in', undefined, true)}
            className="px-1.5 py-0.5 rounded text-xs font-medium border border-emerald-300 text-emerald-700 hover:bg-emerald-50"
            title={`Answer this question here instead of in “${row.shadowedByTitle ?? 'the earlier intent'}” — labels it in here and out of every set that currently comes first.`}
          >
            send here
          </button>
        )}
        <button
          onClick={(e) =>
            row.pinned === 'out'
              ? togglePin(row, 'out') // already out → unpin
              : openOutPicker(row, e.currentTarget.getBoundingClientRect()) // pick a reason first
          }
          className={`px-1.5 py-0.5 rounded text-xs font-medium border ${
            row.pinned === 'out' || outPicker?.messageId === row.messageId
              ? 'bg-rose-600 text-white border-rose-600'
              : 'border-[hsl(var(--border))] text-rose-700 hover:bg-rose-50'
          }`}
          title="Label: this question does NOT belong to this intent — pick a reason"
        >
          out
        </button>
      </>
  );

  // Conversation view for one pane: the clicked question's full thread, with
  // Exit + (Needs-decision pane) the same in/out buttons as the row — the
  // pinned state reads live from `data`, so labeling from here is identical.
  function renderConvo(pane: 'in' | 'nd') {
    if (!convo || convo.pane !== pane) return null;
    const boardRow = rowByMessage.get(convo.messageId) ?? null;
    const ratingRow = data?.rows.find((r) => r.messageId === convo.messageId) ?? null;
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="shrink-0 px-3 py-1.5 bg-[hsl(var(--muted))]/40 border-b border-[hsl(var(--border))] flex items-center justify-between gap-2">
          <button
            onClick={() => setConvo(null)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[hsl(var(--border))] text-xs font-medium text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]"
            title="Back to the list"
          >
            <Minimize2 className="w-3.5 h-3.5" /> Exit conversation
          </button>
          {ratingRow && checkout === null && (
            <span className="flex items-center gap-1 shrink-0">
              <span className="mr-1 text-xs text-[hsl(var(--muted-foreground))]">
                label this question:
              </span>
              {pinButtons(ratingRow)}
            </span>
          )}
        </div>
        {boardRow ? (
          // ChatMessages owns the scroll (flex-1 overflow-y-auto), so the
          // thread scrolls inside the pane under the sticky Exit header.
          <ConversationThread rows={rows} current={boardRow} isNirvana={isNirvana} />
        ) : (
          <p className="p-4 text-sm text-[hsl(var(--muted-foreground))]">
            The conversation for this question is not available.
          </p>
        )}
      </div>
    );
  }

  const applied = !!data && !specDirty() && !pinsDirty && (data?.staleCount ?? 0) === 0;

  return (
    <div className="flex flex-col gap-2 flex-1 min-h-0">
      {/* TOP BAR — leave the workbench; unsaved drafts are discarded. */}
      <WorkbenchTopBar
        title={`${isEdit ? 'Edit intent' : 'New Intent'}${title.trim() ? ` — ${title.trim()}` : ''}`}
        note={draftIdRef.current !== null ? 'unsaved draft — Save to register it on the board' : undefined}
        onBack={exit}
        backTitle={
          draftIdRef.current !== null
            ? 'Back to the board — the unsaved draft is discarded'
            : 'Back to the board'
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[380px_minmax(0,1fr)_minmax(0,1fr)] gap-4 flex-1 min-h-0">
        {/* LEFT — the spec: definition, labeled examples, actions, history */}
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-y-auto">
          <div className="p-4 space-y-3">
            <label className="block text-sm">
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
            <DefinitionEditor
              value={definition}
              onChange={setDefinition}
              placeholder="e.g. asks the chatbot to write a thesis statement or conclusion for them"
            />

            {refineReasoning && (
              <div className="rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30">
                <details className="text-xs text-[hsl(var(--muted-foreground))] px-2 py-1.5">
                  <summary className="cursor-pointer font-medium text-[hsl(var(--foreground))]">
                    Definition proposed from your labels — review, then Save or Apply
                  </summary>
                  <p className="mt-1 whitespace-pre-wrap">{refineReasoning}</p>
                </details>
                {/* Close the loop: the definition now carries the labels, so
                    the labels can go. Retiring them re-rates against the
                    definition ALONE — the only real test that it absorbed them.
                    A just-refined (unsaved) definition is folded in first. */}
                {pinCount > 0 && checkout === null && (
                  <div className="flex items-center justify-between gap-2 border-t border-[hsl(var(--border))] px-2 py-1.5">
                    <p className="text-xs text-[hsl(var(--muted-foreground))]">
                      {specDirty()
                        ? `Retire the ${pinCount} label(s) — the proposed definition is saved first.`
                        : `The definition carries these ${pinCount} label(s) now — retire them to test it alone.`}
                    </p>
                    <button
                      onClick={retireLabels}
                      disabled={retiring || busy || saving}
                      title="Drop the labels; the next Apply re-rates the log against the definition alone (the proposed definition is saved first)"
                      className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-[hsl(var(--border))] text-xs font-medium text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] disabled:opacity-50"
                    >
                      {retiring ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
                      Retire labels
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Labeled by you — the questions you reviewed and marked in/out.
                These ARE the Included/Excluded examples injected into the
                rating prompt, so they live here with the spec. Collapsible;
                remove with ×. */}
            {data && (
              <div className="space-y-2 border-t border-[hsl(var(--border))] pt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                  Labeled by you{' '}
                  <span className="font-normal normal-case">
                    — questions you reviewed &amp; marked, used when matching new questions
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
                      className={`w-full flex items-center justify-between px-2 py-1 text-xs font-medium ${g.head}`}
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
                            <li key={r.messageId} className="flex items-start gap-1.5 px-2 py-1.5 text-xs">
                              <span className="min-w-0 flex-1">
                                <span className="block text-[hsl(var(--foreground))]">
                                  {(() => {
                                    const c = r.queryText.replace(/\s+/g, ' ').trim();
                                    return c.length > 120 ? `${c.slice(0, 120)}…` : c;
                                  })()}
                                </span>
                                {/* The out-reason, injected into the rating prompt. */}
                                {g.key === 'out' && r.reason && (
                                  <span className="mt-0.5 block text-xs italic text-rose-700">
                                    why not: {r.reason}
                                  </span>
                                )}
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
                        <p className="px-2 py-1.5 text-xs text-[hsl(var(--muted-foreground))] border-t border-[hsl(var(--border))]">
                          None yet — pin questions in “Needs decision”.
                        </p>
                      ))}
                  </div>
                ))}
              </div>
            )}

            {/* actions — Apply (rate silently, nothing registered) · Save
                (register: version + live intent) · Update from labels */}
            <div className="space-y-2 border-t border-[hsl(var(--border))] pt-3">
              {/* "Applied" = the shown ratings exactly reflect the current
                  definition + labels. Apply is pointless then; Save is the
                  next step. Anything dirty flips the two. */}
              <div className="flex items-center gap-1.5">
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
                  className="inline-flex items-center gap-1.5 px-2 py-1.5 rounded text-sm font-medium border border-[hsl(var(--border))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] disabled:opacity-50"
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
                  className="inline-flex items-center gap-1.5 px-2 py-1.5 rounded text-sm font-medium bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] disabled:opacity-50"
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
                  className="inline-flex items-center gap-1.5 px-2 py-1.5 rounded text-sm font-medium border border-[hsl(var(--primary))]/50 text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/10 disabled:opacity-50 disabled:border-[hsl(var(--border))] disabled:text-[hsl(var(--muted-foreground))]"
                >
                  {refining ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                  Update from labels
                </button>
              </div>
              {busy && progress && (
                <div className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
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
                <p className="flex items-center gap-1 text-sm text-red-600">
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
                  <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                    History
                    {checkout !== null && (
                      <span className="ml-1.5 normal-case font-normal text-amber-700">
                        viewing{' '}
                        {(() => {
                          const v = versions.find((x) => x.versionNo === checkout);
                          return v ? versionLabel(v) : `v${checkout}`;
                        })()}
                      </span>
                    )}
                  </p>
                  {checkout !== null && (
                    // Hard revert — the checked-out version becomes live, later
                    // steps are deleted (confirmed). Going back WITHOUT changes
                    // is just clicking the newest entry below.
                    <button
                      onClick={revertToCheckout}
                      disabled={busy || saving}
                      title="Make this version the live one and delete the later steps (asks first)"
                      className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[hsl(var(--primary))] text-xs font-medium text-[hsl(var(--primary-foreground))] disabled:opacity-40"
                    >
                      <RotateCcw className="w-3 h-3" /> Revert to{' '}
                      {(() => {
                        const v = versions.find((x) => x.versionNo === checkout);
                        return v ? versionLabel(v) : `v${checkout}`;
                      })()}
                    </button>
                  )}
                </div>
                <ul className="space-y-1.5">
                  {versionGroups.map((g, gi) => {
                    const open = groupToggles[g.key] ?? gi === 0;
                    // Minors display OLDEST-FIRST inside the group so v2.1,
                    // v2.2, … read as the progression on top of v2.
                    const minorsAsc = [...g.minors].reverse();
                    return (
                      <li key={g.key} className="space-y-1">
                        {g.major ? (
                          versionEntry(g.major, false)
                        ) : (
                          <p className="px-1 text-xs font-medium text-[hsl(var(--muted-foreground))]">
                            Draft steps — not saved yet
                          </p>
                        )}
                        {g.minors.length > 0 && (
                          <div className="ml-3 border-l border-[hsl(var(--border))] pl-2 space-y-1">
                            <button
                              onClick={() => setGroupToggles((t) => ({ ...t, [g.key]: !open }))}
                              className="inline-flex items-center gap-1 text-xs font-medium text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                              title="Applies and label changes on top of this version"
                            >
                              {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                              {g.minors.length} step{g.minors.length === 1 ? '' : 's'}
                              {g.major ? ` since ${versionLabel(g.major)}` : ''}
                            </button>
                            {open && minorsAsc.map((v) => versionEntry(v, true))}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* Archive — edit mode only; soft-delete, recorded and reversible. */}
            {isEdit && (
              <div className="border-t border-[hsl(var(--border))] pt-3">
                <button
                  onClick={archive}
                  disabled={busy}
                  className="inline-flex items-center gap-1 text-sm text-red-600 hover:underline disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Archive intent
                </button>
              </div>
            )}
          </div>
        </div>

        {/* MIDDLE — In this intent (captured: clearly-in; pins live on the left) */}
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] flex flex-col overflow-hidden min-h-[300px] lg:min-h-0">
          {!data ? (
            <div className="flex-1 flex items-center justify-center p-8 text-center text-sm text-[hsl(var(--muted-foreground))]">
              {busy
                ? 'Rating every question in the log against this definition…'
                : isEdit
                  ? 'Loading this intent’s questions…'
                  : 'Define the intent, then Apply to rate the log against it.'}
            </div>
          ) : (
            renderConvo('in') ?? (
              <>
                <div className="shrink-0 bg-[hsl(var(--card))] border-b border-[hsl(var(--border))]">
                  <div className="px-3 py-1.5 bg-[hsl(var(--muted))]/60 border-b border-[hsl(var(--border))] flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-emerald-700 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span>In this intent · {inThisIntent.length}</span>
                      {baseline && (
                        <span
                          className="font-normal normal-case text-[hsl(var(--muted-foreground))]"
                          title={`Membership change compared to ${diffBaseLabel} (the diff base — pick another in History)`}
                        >
                          <span className={newlyIn && newlyIn.size > 0 ? 'text-emerald-700 font-medium' : ''}>
                            +{newlyIn?.size ?? 0}
                          </span>
                          {' · '}
                          <span className={leftRows.length > 0 ? 'text-rose-700 font-medium' : ''}>
                            −{leftRows.length}
                          </span>{' '}
                          compared to {diffBaseLabel}
                        </span>
                      )}
                    </span>
                    <span className="flex items-center gap-1 shrink-0">
                      {similarBusy && isPinSort(inSort) && (
                        <Loader2 className="w-3 h-3 animate-spin text-[hsl(var(--muted-foreground))]" />
                      )}
                      <select
                        value={inSort}
                        onChange={(e) => setInSort(e.target.value as NdSort)}
                        title={
                          inSort === 'out-like'
                            ? 'Sort — captures that look OUT-like next to your pins come first (double-check these)'
                            : inSort === 'in-like'
                              ? 'Sort — captures closest to your IN pins come first'
                              : 'Sort'
                        }
                        className="text-xs border border-[hsl(var(--border))] rounded px-1 py-0.5 bg-[hsl(var(--background))] text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
                      >
                        <option value="out-like">Most out-like first</option>
                        <option value="in-like">Most in-like first</option>
                        <option value="newest">Newest</option>
                        <option value="oldest">Oldest</option>
                      </select>
                    </span>
                  </div>
                  <div className="px-3 py-1.5 space-y-1.5">
                    <PaneSearch value={inSearch} onChange={setInSearch} />
                    {data.shadowedBy.length > 0 && (
                      <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800 flex items-start gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                        <span>
                          Taken first by:{' '}
                          {data.shadowedBy.map((o, i) => (
                            <span key={o.intentId}>
                              {i > 0 && ' · '}
                              <span className="font-medium">{o.title}</span> ({o.count})
                            </span>
                          ))}{' '}
                          — those intents come earlier in this type, so they answer these questions
                          instead. Narrow them, or move this intent ahead of them.
                        </span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto">
                  {/* NEW SINCE BASE — captures that entered since the diff base,
                      grouped at the top (mirrors the Left strip below). */}
                  {newInRows.length > 0 && (
                    <div className="border-b border-emerald-200 bg-emerald-50/40">
                      <button
                        onClick={() => setNewOpen((v) => !v)}
                        className="w-full flex items-center justify-between px-3 py-1.5 text-xs font-semibold text-emerald-700"
                        title={`Not in this intent at ${diffBaseLabel} — entered since; expand to review`}
                      >
                        <span>
                          New in this intent · {newInRows.length}
                          <span className="font-normal"> (compared to {diffBaseLabel})</span>
                        </span>
                        {newOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>
                      {newOpen && (
                        <ul className="divide-y divide-emerald-200/60 border-t border-emerald-200/60">
                          {overlapsFirst(newInRows).map((r) => renderRow(r, 'in'))}
                        </ul>
                      )}
                    </div>
                  )}
                  {/* LEFT SINCE BASE — questions that were in the intent at the
                      diff base but no longer qualify. Their CURRENT rating row
                      renders, so they can be pinned straight back in. */}
                  {leftRows.length > 0 && (
                    <div className="border-b border-rose-200 bg-rose-50/40">
                      <button
                        onClick={() => setLeftOpen((v) => !v)}
                        className="w-full flex items-center justify-between px-3 py-1.5 text-xs font-semibold text-rose-700"
                        title={`In this intent at ${diffBaseLabel}, not anymore — expand to review`}
                      >
                        <span>
                          Left this intent · {leftRows.length}
                          <span className="font-normal"> (compared to {diffBaseLabel})</span>
                        </span>
                        {leftOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>
                      {leftOpen && (
                        <ul className="divide-y divide-rose-200/60 border-t border-rose-200/60">
                          {leftRows.map((r) => renderRow(r, 'in'))}
                        </ul>
                      )}
                    </div>
                  )}
                  {(() => {
                    // New arrivals live in their strip above — the main list
                    // shows the rest of the captures.
                    const rest = newlyIn
                      ? inThisIntent.filter((r) => !newlyIn.has(r.messageId))
                      : inThisIntent;
                    const sorted = overlapsFirst(sortRows(rest, inSort, inSearch));
                    return sorted.length > 0 ? (
                      <ul className="divide-y divide-[hsl(var(--border))]/60">
                        {sorted.map((r) => renderRow(r, 'in'))}
                      </ul>
                    ) : (
                      <p className="p-4 text-sm text-[hsl(var(--muted-foreground))]">
                        {inSearch
                          ? 'No matching question.'
                          : busy
                            ? 'Rating the log — captured questions appear here as they land…'
                            : newInRows.length > 0
                              ? 'Every capture is new since the base — see the strip above.'
                              : 'Nothing captured yet — decide the questions on the right.'}
                      </p>
                    );
                  })()}
                </div>
              </>
            )
          )}
        </div>

        {/* RIGHT — Needs decision (model-uncertain; label in/out) */}
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] flex flex-col overflow-hidden min-h-[300px] lg:min-h-0">
          {!data ? (
            <div className="flex-1 flex items-center justify-center p-8 text-center text-sm text-[hsl(var(--muted-foreground))]">
              <span className="max-w-[26ch]">
                The model-uncertain questions appear here for you to label in/out.
              </span>
            </div>
          ) : (
            renderConvo('nd') ?? (
              <>
                <div className="shrink-0 bg-[hsl(var(--card))] border-b border-[hsl(var(--border))]">
                  <div className="px-3 py-1.5 bg-[hsl(var(--muted))]/40 border-b border-[hsl(var(--border))] flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                      Needs decision · {needsDecision.length}
                    </span>
                    <span className="flex items-center gap-1 shrink-0">
                      {similarBusy && pinSorted && (
                        <Loader2 className="w-3 h-3 animate-spin text-[hsl(var(--muted-foreground))]" />
                      )}
                      <select
                        value={ndSort}
                        onChange={(e) => setNdSort(e.target.value as NdSort)}
                        title={
                          ndSort === 'in-like'
                            ? 'Sort — closest to your IN pins first, closest to your OUT pins last'
                            : ndSort === 'out-like'
                              ? 'Sort — closest to your OUT pins first, closest to your IN pins last'
                              : 'Sort'
                        }
                        className="text-xs border border-[hsl(var(--border))] rounded px-1 py-0.5 bg-[hsl(var(--background))] text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))] normal-case font-normal"
                      >
                        <option value="in-like">Most in-like first</option>
                        <option value="out-like">Most out-like first</option>
                        <option value="newest">Newest</option>
                        <option value="oldest">Oldest</option>
                      </select>
                    </span>
                  </div>
                  <div className="px-3 py-1.5 flex items-center gap-2">
                    {/* Lean tabs — the two sides partition the list, so the
                        row chips repeating the lean are unnecessary. */}
                    <span className="flex items-center rounded border border-[hsl(var(--border))] overflow-hidden shrink-0">
                      {(
                        [
                          { key: 'in' as const, label: `probably in ${ndProbablyIn}`, on: 'bg-emerald-100 text-emerald-800', off: 'text-emerald-700' },
                          { key: 'out' as const, label: `probably out ${ndProbablyOut}`, on: 'bg-rose-100 text-rose-800', off: 'text-rose-700' },
                        ]
                      ).map((t, i) => (
                        <button
                          key={t.key}
                          onClick={() => setNdFilter(t.key)}
                          className={`px-2 py-1 text-xs font-medium whitespace-nowrap ${
                            i > 0 ? 'border-l border-[hsl(var(--border))]' : ''
                          } ${ndFilter === t.key ? t.on : `${t.off} hover:bg-[hsl(var(--muted))]/50`}`}
                          title={
                            t.key === 'in'
                              ? 'The questions the model leans IN on'
                              : 'The questions the model leans OUT on (plus the rare unrated ones)'
                          }
                        >
                          {t.label}
                        </button>
                      ))}
                    </span>
                    <div className="flex-1 min-w-0">
                      <PaneSearch value={ndSearch} onChange={setNdSearch} />
                    </div>
                  </div>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto">
                  {(() => {
                    const sorted = sortRows(ndFiltered, ndSort, ndSearch);
                    return sorted.length > 0 ? (
                      <ul className="divide-y divide-[hsl(var(--border))]/60">
                        {sorted.map((r) => renderRow(r, 'nd'))}
                      </ul>
                    ) : (
                      <p className="p-4 text-sm text-[hsl(var(--muted-foreground))]">
                        {ndSearch
                          ? 'No matching question.'
                          : busy
                            ? 'Rating the log — uncertain questions appear here as they land…'
                            : needsDecision.length > 0
                              ? 'No question on this side — switch tabs.'
                              : 'Nothing to decide — every question is settled.'}
                      </p>
                    );
                  })()}
                </div>
              </>
            )
          )}
        </div>
      </div>

      {/* OUT-REASON PICKER — opens under the clicked "out" button: three
          LLM-suggested reasons + a free-text "Other". Fixed-positioned so it
          escapes the column's scroll clip; the backdrop cancels the out. */}
      {outPicker &&
        (() => {
          const PW = 280;
          const M = 8; // viewport margin
          const a = outPicker.anchor;
          const left = Math.max(M, Math.min(a.left, window.innerWidth - PW - M));
          // Flip ABOVE the button when there isn't room below and there's more
          // above; either way, cap the height to the space on that side (with
          // internal scroll) so the picker is NEVER clipped by the viewport.
          const roomBelow = window.innerHeight - a.bottom - M;
          const roomAbove = a.top - M;
          const flipUp = roomBelow < 220 && roomAbove > roomBelow;
          const maxHeight = Math.max(140, (flipUp ? roomAbove : roomBelow) - 4);
          const pos = flipUp
            ? { left, bottom: window.innerHeight - a.top + 4, width: PW, maxHeight }
            : { left, top: a.bottom + 4, width: PW, maxHeight };
          return (
            <>
              <div className="fixed inset-0 z-[59]" onClick={() => setOutPicker(null)} />
              <div
                className="fixed z-[60] overflow-y-auto rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-lg p-2 space-y-1.5"
                style={pos}
              >
                <div className="flex items-center justify-between px-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-rose-700">
                    Why is this out?
                  </span>
                  <button
                    onClick={() => setOutPicker(null)}
                    className="p-0.5 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                    aria-label="Cancel"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                {outPicker.loading ? (
                  <p className="flex items-center gap-1.5 px-1 py-1 text-xs text-[hsl(var(--muted-foreground))]">
                    <Loader2 className="w-3 h-3 animate-spin" /> Suggesting reasons…
                  </p>
                ) : outPicker.reasons.length > 0 ? (
                  outPicker.reasons.map((rsn, i) => (
                    <button
                      key={i}
                      onClick={() => pickOutReason(rsn)}
                      className="w-full text-left px-2 py-1.5 rounded text-xs text-[hsl(var(--foreground))] border border-[hsl(var(--border))] hover:bg-rose-50 hover:border-rose-200"
                    >
                      {rsn}
                    </button>
                  ))
                ) : (
                  <p className="px-1 text-xs text-[hsl(var(--muted-foreground))]">
                    {outPicker.error ?? 'No suggestions — type your own below.'}
                  </p>
                )}
                <OutReasonOther onSubmit={pickOutReason} />
                <button
                  onClick={() => pickOutReason('')}
                  className="w-full text-center px-2 py-0.5 text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                >
                  Exclude without a reason
                </button>
              </div>
            </>
          );
        })()}
    </div>
  );
}

/** The per-pane query search box. */
function PaneSearch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[hsl(var(--muted-foreground))]" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search query text…"
        className="w-full pl-7 pr-7 py-1 text-sm border border-[hsl(var(--border))] rounded bg-[hsl(var(--background))] text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
      />
      {value && (
        <button
          onClick={() => onChange('')}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
          aria-label="Clear search"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
