'use client';

/**
 * SCORE v6 — the inline intent workbench (replaces the old IntentModal dialog).
 *
 * Editing or creating an intent transforms the BOARD ITSELF: the board's
 * 3-column grid is swapped for this one, keeping the same shape —
 *   LEFT   the spec: title · definition · labeled examples · actions · history
 *   MIDDLE "In this intent" — what the definition captures, labeled OUT
 *   RIGHT  "Needs decision" — the probably-in questions, labeled IN
 * The two panes push the boundary from opposite sides, one verdict each: this
 * workbench is where an intent's border is settled, and a pane that offered
 * both verdicts asked a two-way question on every row when only one way moves
 * that border. (An already-pinned row still shows its own pill — see
 * pinButtons — because withdrawing a label must stay possible.)
 * Clicking a question in either list opens its FULL conversation in place of
 * that list (the board viewer's theater-style thread, shared component), so a
 * labeling call that needs the chatbot's reply never leaves the workbench.
 *
 * The Apply/Save lifecycle (one vocabulary with the rule workbench: Apply
 * iterates, Save commits the next version):
 *  - "Apply" persists the spec (a create's FIRST apply registers it as v1),
 *    rates the scope against just this intent, and loads the two lists.
 *  - Pinning in/out changes the prompt (and defHash) → re-Apply gates Save.
 *  - "Save" (in History) records the applied state as the next MAJOR version —
 *    the board's "When vN" advances on it. It is disabled until there is
 *    something to record: with no Apply since the last Save, saving again
 *    would write a second version identical to the first.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
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
  RotateCcw,
  Save as SaveIcon,
  Search,
  Wand2,
  X,
} from 'lucide-react';
import { runShardedRate } from './rate-runner';
import { DefinitionEditor, PaneSearch, QueryTextButton, WorkbenchTopBar } from './workbench-shared';
import type { Dissection } from './materials';
import FoldReviewModal, { type FoldProposalView } from './FoldReviewModal';
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
  /** A PENDING correction — the instructor overruled the judge here and the
   * definition has not absorbed it yet. Null when there is none. */
  pinned: 'in' | 'out' | null;
  /** The pending correction's row id (what the fold consumes). */
  correctionId: number | null;
  /** A correction already folded in, kept as a display-only marker. */
  marker: { verdict: 'in' | 'out'; versionNo: number | null } | null;
  /** Why the instructor overruled the judge — asked only when the correction
   * disagreed with the rating. The fold's main fuel. Null otherwise. */
  reason: string | null;
  /** An EARLIER node in this intent's chain that takes the question first
   * (v7 first-match routing) — null when nothing shadows it. Not displayed:
   * both panes use it to drop the question entirely (see `reaches`). */
  shadowedBy: number | null;
  /** Message split into Material vs Request(s), for the expand view. */
  dissection: Dissection | null;
}

/**
 * Does this question REACH this intent at all? Under first-match it does not
 * when an earlier node in the chain already claims it.
 *
 * Both panes filter on this, because neither can act on a question that never
 * arrives: listing one in "In this intent" overstates what the intent answers,
 * and labelling one in "Needs decision" teaches a definition about a question it
 * will never judge — the label lands, the fold absorbs it, and the row still
 * goes to the intent that comes first. (That is what "send here" existed to work
 * around; it left this workbench with it.) Interception belongs to the board,
 * which can see the whole chain and offers the fixes — reorder, narrow the
 * earlier set — that neither of these two lists can perform.
 */
const reaches = (r: { shadowedBy: number | null }) => r.shadowedBy === null;

/** Membership, in one place — so the lists and the diff's +N/−N can never
 * disagree about what counts as being in this intent. */
const isMember = (r: { rating: RatingLevel | null; shadowedBy: number | null }) =>
  r.rating === 'clearly_in' && reaches(r);

// The two pin-driven orders both rank by the same embedding score (max cosine
// to the IN pins − max cosine to the OUT pins), just in opposite directions.
// The lean tabs already split in from out, so no signed cross-lean measure is
// needed — each tab just picks a direction.
type NdSort = 'in-like' | 'out-like' | 'newest' | 'oldest';

interface RatingsPayload {
  intent: { id: number; title: string; definition: string };
  rows: RatingRow[];
  ratedCount: number;
  staleCount: number;
  includedCount: number;
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
  update_intent: 'saved', // the live-making step — one verb across both benches
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
  /** Every turn of the threads the rows belong to. Lists narrow to the review
   * set; a conversation must still be readable in full. Defaults to rows. */
  contextRows?: ScoreQueryRow[];

  isNirvana: boolean;
  mode: WorkbenchMode;
  /** The enclosing intents of this workbench's placement, nearest first —
   * empty for a top-level intent. A nested intent can only ever answer what
   * its enclosing intents answer, so the panes, the Apply bar, and the first
   * rating pass all scope to the queries those ancestors currently claim. */
  scopeAncestorIds: number[];
  /** The nearest enclosing intent's title, for the scope note. */
  scopeLabel: string | null;
  /** Leave the workbench — board refreshes. Carries the id of the intent
   * being left (null when there is none: a create that was never Applied, an
   * archive) so the board can flag it after the refresh lands — the refresh
   * takes seconds and the board gives no other sign that the just-made intent
   * actually arrived. */
  onExit: (savedIntentId?: number | null) => void;
}

export default function IntentWorkbench({
  assignmentId,
  model,
  openaiConfigured,
  rows,
  contextRows,
  isNirvana,
  mode,
  scopeAncestorIds,
  scopeLabel,
  onExit,
}: IntentWorkbenchProps) {
  const isEdit = mode.kind === 'edit';
  const intent = isEdit ? mode.intent : null;
  const seed = mode.kind === 'create' ? mode.seed ?? null : null;
  const totalQuestions = rows.length;

  const [title, setTitle] = useState(intent?.title ?? seed?.title ?? '');
  // An intent with NO title yet is auto-named from the definition (git-commit
  // style) on save; one that already has a name keeps it, always — the name
  // only ever changes through the instructor, see titleSuggestion.
  // A name generated from the refined definition and OFFERED, never taken:
  // silently renaming an intent while its owner fine-tunes the definition reads
  // as "this became a different intent".
  const [titleSuggestion, setTitleSuggestion] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [definition, setDefinition] = useState(intent?.definition ?? seed?.definition ?? '');
  /**
   * The WHY picker — opened only when a correction contradicts the rating,
   * which is exactly when the reason carries information. Agreeing with the
   * classifier is a vote and stays one click; overruling it is teaching, and
   * teaching needs a reason the fold can turn into a principle.
   * `anchor` positions it fixed so it escapes the column's scroll clip.
   */
  const [reasonPicker, setReasonPicker] = useState<{
    messageId: number;
    verdict: 'in' | 'out';
    anchor: { left: number; top: number; bottom: number; width: number };
    loading: boolean;
    reasons: string[];
    error: string | null;
  } | null>(null);
  // Labels changed since the last Apply — the shown ratings no longer reflect
  // the prompt the pins produce, so Save (commit) is gated until re-Apply.
  const [intentId, setIntentId] = useState<number | null>(intent?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refining, setRefining] = useState(false);
  // The review gate. `foldOpen` is the modal; `foldProposals` is null until the
  // fold returns, which is what puts the loading state inside the review.
  const [foldOpen, setFoldOpen] = useState(false);
  const [foldProposals, setFoldProposals] = useState<FoldProposalView[] | null>(null);
  const [foldBusy, setFoldBusy] = useState(false);
  const [foldError, setFoldError] = useState<string | null>(null);
  // The refine model's step-by-step audit, shown under the proposed definition.
  const [versions, setVersions] = useState<IntentVersion[] | null>(null);
  // Version CHECKOUT: clicking a history entry loads that version's full state
  // (title/definition/pins/ratings — instant, from the hash-keyed rating store).
  // Revert rolls back to it; "Back to latest" returns to the live spec.
  const [checkout, setCheckout] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ rated: number; total: number } | null>(null);
  const [data, setData] = useState<RatingsPayload | null>(null);
  // Conversation view: a clicked question's full thread COVERS its own list
  // (same theater-style component as the board viewer) until Exit. It is a
  // LAYER, not a replacement — labeling questions is a pass down a long list,
  // and unmounting the list on every open would drop the reader back at the top.
  const [convo, setConvo] = useState<{ messageId: number; pane: 'in' | 'nd' } | null>(null);
  // The last question opened in each pane, kept AFTER Exit so the row you came
  // back from is marked — otherwise a 200-row list gives no clue where you were.
  const [lastOpened, setLastOpened] = useState<{ in: number | null; nd: number | null }>({
    in: null,
    nd: null,
  });
  // The marked row's element per pane, so Exit can bring it back into view when
  // it has moved (labeling it from the conversation view re-sorts the list).
  const markedRowRef = useRef<{ in: HTMLLIElement | null; nd: HTMLLIElement | null }>({
    in: null,
    nd: null,
  });
  const openConvo = (messageId: number, pane: 'in' | 'nd') => {
    setConvo({ messageId, pane });
    setLastOpened((prev) => ({ ...prev, [pane]: messageId }));
  };
  const exitConvo = (pane: 'in' | 'nd') => {
    setConvo(null);
    // Next frame: the list is displayed again, so it can be measured/scrolled.
    // 'nearest' is a no-op while the row is already on screen, which is the
    // common case now that the scroll position survives.
    requestAnimationFrame(() => markedRowRef.current[pane]?.scrollIntoView({ block: 'nearest' }));
  };
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
  // Bumped when a rating pass finishes, to RE-READ the baseline snapshot. The
  // base is version-scoped but its ratings are hash-scoped: a base whose spec
  // still matches the live one (the just-created v1, before any edit) gains
  // rows as the pass lands, and a snapshot fetched mid-pass would otherwise
  // freeze the intent's whole membership as "entered since v1".
  const [baselineNonce, setBaselineNonce] = useState(0);
  // What is persisted server-side — Apply skips the save round trip when clean.
  const savedRef = useRef<{ title: string; definition: string }>(
    intent
      ? { title: intent.title, definition: intent.definition }
      : { title: '', definition: '' }
  );

  // Board rows by messageId — the conversation view joins through this.
  const rowByMessage = useMemo(() => new Map(rows.map((r) => [r.messageId, r])), [rows]);

  /**
   * The queries this workbench is actually ABOUT: the intent's type, narrowed
   * to what every enclosing intent currently CLAIMS — its rating, the same rule
   * routing uses. A nested intent can never answer a query its parent doesn't,
   * so questions outside this scope are noise in the panes and dead weight in
   * the visible Apply pass. Null = no scoping (a type-less legacy intent rates
   * the whole log, as before).
   *
   * A pending correction on an ANCESTOR does not widen or narrow this: until
   * that correction is folded into the ancestor's definition, the ancestor
   * still claims exactly what it claimed before.
   */
  const scopeSet = useMemo((): Set<number> | null => {
    const type = mode.kind === 'edit' ? mode.intent.type : seed?.type ?? null;
    if (!type) return null;
    const claimed = (r: (typeof rows)[number], intentId: number): boolean =>
      r.intentRatings[intentId]?.rating === 'clearly_in';
    const ids = new Set<number>();
    for (const r of rows) {
      if (r.queryType !== type) continue;
      if (scopeAncestorIds.every((aid) => claimed(r, aid))) ids.add(r.messageId);
    }
    return ids;
  }, [rows, scopeAncestorIds, mode, seed]);

  // Leave the workbench. A create that was never Applied has no row to point
  // at (intentId null); everything else is registered and survives.
  function exit() {
    onExit(intentId);
  }

  /**
   * What leaving RIGHT NOW would actually destroy — the guard dialog names it,
   * so this must be precise. Pins persist the moment they are clicked, an
   * Apply persists the spec (a create is even registered by it), so only one
   * state is at risk: definition/title text that differs from the last
   * persisted spec (typed but not yet Applied) — client-only, gone on unmount.
   * A checkout is a read-only view of a past version — its fields deviate from
   * the live spec by design, so it never counts as loss.
   */
  const leaveLoss = (): 'edits' | null => {
    if (checkout !== null) return null;
    if (specDirty() && (title.trim() || definition.trim())) return 'edits';
    return null;
  };
  // Confirm-before-leave: the deferred navigation (Board exit, or the overlap
  // chip's jump into another intent) runs only when the instructor chooses to
  // leave. Null = no dialog.
  const [leavePrompt, setLeavePrompt] = useState<{ action: () => void } | null>(null);
  function guardLeave(action: () => void) {
    if (leaveLoss()) setLeavePrompt({ action });
    else action();
  }
  // Mirror for the beforeunload listener (registered once, must read fresh).
  const leaveLossRef = useRef(leaveLoss);
  leaveLossRef.current = leaveLoss;

  // Clone a prepared library template into a REGISTERED intent (v1): spec +
  // rating rows copied server-side (same definition + no pins ⇒ same defHash,
  // so the copied ratings are already fresh), while the template stays in the
  // library untouched.
  //
  // Driven by the chooser: it decides that the seed's definition still matches
  // a template and passes the id through, so the questions are already there
  // when the workbench opens instead of costing a rating pass.
  //
  // The title travels separately. The chooser matches templates on the
  // DEFINITION alone, so a set can be adopted under a name the instructor
  // typed; without passing it the server would fall back to the template's own
  // title and the rename would be silently thrown away.
  async function adoptTemplate(templateId: number, title?: string) {
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
    setData(null);
    setVersions(null);
    try {
      const res = await fetch(`/api/instructor/assignments/${assignmentId}/score/intents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromTemplateId: templateId,
          ...(title?.trim() ? { title: title.trim() } : {}),
          // Registered on adoption (v1, action create_intent) — picking a
          // starter from the chooser IS the decision to have this intent.
          isTemplate: false,
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
          typeof d?.message === 'string' ? d.message : 'Failed to load the starter intent.'
        );
      }
      const saved = d.intent as { id: number; title: string; definition: string };
      if (!live(controller.signal)) return;
      setIntentId(saved.id);
      setTitle(saved.title);
      setDefinition(saved.definition);
      savedRef.current = { title: saved.title, definition: saved.definition };
      loadVersions(saved.id); // v1 is on the books — show it
      await fetchRatings(saved.id, controller.signal);
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError' && live(controller.signal)) {
        setError((e as Error).message);
      }
    } finally {
      if (live(controller.signal)) setBusy(false);
    }
  }

  // The chooser's Create is the decision — so the workbench opens ALREADY
  // working on it, never on a form waiting for a first click:
  //  · a starter the chooser found prepared is adopted (its ratings are copied,
  //    so its questions are on screen immediately);
  //  · any other seeded candidate is Applied right away, which registers it as
  //    v1 and starts the rating pass.
  // Mount-only: `seed` is a mount-time value and the parent re-keys this
  // component per target.
  useEffect(() => {
    if (seed?.fromTemplateId) {
      void adoptTemplate(seed.fromTemplateId, seed.title);
    } else if (seed?.definition?.trim()) {
      // Pass the seed explicitly: state is set from it in the same commit, so
      // reading `definition` here would still see the initial value.
      void apply({ title: seed.title?.trim() ?? '', definition: seed.definition.trim() });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Per-pane query search + sorts. Both pin-driven orders rank by the embedding
  // score (max cosine to the IN pins − max cosine to the OUT pins); 'in-like'
  // puts the highest scores first, 'out-like' the lowest.
  const [inSearch, setInSearch] = useState('');
  const [ndSearch, setNdSearch] = useState('');
  // "In this intent" holds captures that all lean in, so its useful default is
  // out-like first — the members that look like they don't belong.
  const [inSort, setInSort] = useState<NdSort>('out-like');
  // Needs decision holds the probably-in questions only, so its useful default
  // is the surprising side: the ones that look OUT-like next to the pins.
  const [ndSort, setNdSort] = useState<NdSort>('out-like');
  const [similarScores, setSimilarScores] = useState<Record<number, number> | null>(null);
  const [similarBusy, setSimilarBusy] = useState(false);

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
      bgAbortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Browser-level leave (reload, tab close, external nav): the native confirm
  // when leaving would lose unapplied edits. Nothing to purge any more — every
  // applied state is a registered intent.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (leaveLossRef.current()) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
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
    // The VISIBLE pass: only the queries in scope (what the panes show). The
    // bar's total is fixed up front so it fills smoothly (the shard aggregate
    // would otherwise climb as shards report their partition sizes).
    const scopedIds = scopeSet ? [...scopeSet] : null;
    const total = scopedIds ? scopedIds.length : totalQuestions;
    setProgress({ rated: 0, total });
    if (scopedIds !== null && scopedIds.length === 0) return; // nothing in scope
    // Fan the work out into parallel shards so it applies in ~one wave instead
    // of a sequential 40-at-a-time crawl.
    await runShardedRate({
      assignmentId,
      model,
      intentIds: [id],
      ...(scopedIds ? { messageIds: scopedIds } : {}),
      estimatedTotal: total,
      signal,
      isLive: () => live(signal),
      onProgress: (p) => {
        if (live(signal)) setProgress({ rated: Math.min(p.rated, total), total });
      },
    });
  }

  // The background sweep: everything OUTSIDE the scope — out-of-scope queries
  // of the type (they feed the board's ↗ outside-count diagnostic) and the
  // untyped remainder. Deliberately invisible: no busy state, no bar, errors
  // to the console only — the instructor's work does not depend on it.
  const bgAbortRef = useRef<AbortController | null>(null);
  function sweepRestInBackground(id: number) {
    bgAbortRef.current?.abort();
    const controller = new AbortController();
    bgAbortRef.current = controller;
    const { signal } = controller;
    void (async () => {
      try {
        await runShardedRate({
          assignmentId,
          model,
          intentIds: [id],
          estimatedTotal: totalQuestions,
          signal,
          isLive: () => mountedRef.current && !signal.aborted,
          onProgress: () => {},
        });
        // Refresh silently so the stale/outside numbers catch up. The scoped
        // panes render the same rows either way.
        if (mountedRef.current && !signal.aborted) {
          await fetchRatings(id, signal);
          setBaselineNonce((n) => n + 1);
        }
      } catch (e) {
        if ((e as Error)?.name !== 'AbortError') {
          console.error('SCORE background sweep failed:', e);
        }
      }
    })();
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
        setCheckout(null); // a rollback-apply lands back on the (new) live spec
        setBaselineNonce((n) => n + 1); // the base's own rows may have landed too
        // Visible scope is done — the rest of the log rates quietly behind it.
        if (scopeSet) sweepRestInBackground(id);
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
    // Auto-naming applies ONLY to an intent that has no name yet (a fresh
    // draft). Once it has one, a changed definition produces a SUGGESTION the
    // instructor can take or ignore — an Apply is fine-tuning, and a rename
    // behind their back makes it look like a new intent was created.
    const autoTitle = !titleText;
    const stats = {
      included: pinnedIn.length,
      excluded: pinnedOut.length,
      inCount: inThisIntent.length,
    };
    const isCreate = !!specOverride?.createNew || intentId === null;
    // Only worth asking for on an EXISTING named intent whose definition moved:
    // a create just took the instructor's own words, and an unchanged definition
    // would only regenerate the name it already has.
    const suggestTitle =
      !isCreate && !!titleText && defText !== savedRef.current.definition.trim();
    const payload = {
      title: autoTitle ? undefined : titleText,
      definition: defText,
      autoTitle,
      ...(suggestTitle ? { suggestTitle: true } : {}),
      // Save records a MAJOR version; Apply records a MINOR one — an Apply costs
      // an LLM re-rate, so it must be revertible from History too. The FIRST
      // persist of a create is a major regardless: creating an intent is the
      // decision to have it, so its opening state IS v1 (never a v0.x draft).
      // `silent` persists the spec with NO version (used by Retire labels,
      // which folds the just-refined definition in before dropping the labels).
      ...(opts?.silent
        ? { recordVersion: false }
        : { recordVersion: true, ...(force || isCreate ? {} : { minorVersion: true }) }),
      stats,
      // A create is registered on arrival — the chooser was the moment of
      // intent, not Save. It carries its PLACEMENT: the scope it was invoked
      // from is its parent, and its rule is seeded from that scope (§3.2/§3.5).
      ...(isCreate
        ? {
            isTemplate: false,
            ...(seed?.type ? { type: seed.type, parentIntentId: seed.parentIntentId ?? null } : {}),
          }
        : force
          ? {
              isTemplate: false,
              // Save also (re)states the placement: an intent adopted from a
              // type-less library template would otherwise sit in no chain.
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
      setTitle(saved.title); // a no-op unless the server auto-named an untitled draft
      const offered = typeof d.titleSuggestion === 'string' ? d.titleSuggestion.trim() : '';
      setTitleSuggestion(offered && offered !== saved.title ? offered : null);
      savedRef.current = { title: saved.title, definition: saved.definition };
      loadVersions(saved.id);
    }
    return saved.id;
  }

  /** Take the offered name. A title has no bearing on ratings, so this is a
   * plain rename: no re-rate, and no version entry — History stays a record of
   * what changed the intent's BEHAVIOR. */
  async function acceptTitleSuggestion() {
    const next = titleSuggestion?.trim();
    if (!next || intentId === null) return;
    setRenaming(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/instructor/assignments/${assignmentId}/score/intents/${intentId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: next, recordVersion: false }),
        }
      );
      if (!res.ok) throw new Error('Failed to rename the intent.');
      if (!mountedRef.current) return;
      setTitle(next);
      // savedRef too, or the workbench would read the rename as an unapplied
      // edit and re-enable Apply for a change that needs no re-rating.
      savedRef.current = { ...savedRef.current, title: next };
      setTitleSuggestion(null);
      // The board re-reads the intent on exit (onExit → router.refresh), so the
      // new name reaches the chain there without another round trip here.
    } catch (e) {
      if (mountedRef.current) setError((e as Error).message);
    } finally {
      if (mountedRef.current) setRenaming(false);
    }
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

  /**
   * Ask the fold model to rewrite the definition from the pending corrections,
   * and open the REVIEW MODAL with the result.
   *
   * Nothing is written here. The fold is a lossy rewrite and it is the only
   * route by which a correction reaches the classifier, so the instructor sees
   * (and may edit) what it produced before anything changes.
   */
  async function openFoldReview() {
    if (refining || busy || saving || intentId === null || checkout !== null) return;
    // Open on what we already know — the corrections and the text being
    // rewritten — so the wait happens inside the review, with context, instead
    // of behind a button that looks stuck. The fold runs a high-effort model
    // over the whole definition; tens of seconds is normal.
    setFoldOpen(true);
    setFoldProposals(null);
    setRefining(true);
    setError(null);
    setFoldError(null);
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
      const proposals = Array.isArray(d?.proposals) ? (d.proposals as FoldProposalView[]) : [];
      if (proposals.length === 0) throw new Error('The model returned no proposal. Try again.');
      if (mountedRef.current) setFoldProposals(proposals);
    } catch (e) {
      // The error belongs INSIDE the modal now — that is where the instructor
      // is looking, and closing it would throw away the context they need.
      if (mountedRef.current) setFoldError((e as Error).message);
    } finally {
      if (mountedRef.current) setRefining(false);
    }
  }

  /**
   * Commit the reviewed fold: write the definition(s) the instructor left in
   * the modal and consume the corrections they absorbed, atomically. The
   * corrections become markers; the new definition makes every rating stale, so
   * the next Apply re-rates against it — which is the only real test that the
   * fold held.
   */
  async function applyFold(edited: Record<number, string>) {
    if (!foldProposals || intentId === null) return;
    setFoldBusy(true);
    setFoldError(null);
    try {
      const applies = foldProposals.map((p) => ({
        intentId: p.intentId,
        definition: (edited[p.intentId] ?? p.after).trim(),
        ...(p.intentId === intentId && p.suggestedTitle && !title.trim()
          ? { title: p.suggestedTitle }
          : {}),
      }));
      const correctionIds = foldProposals.flatMap((p) => p.corrections.map((c) => c.id));
      const res = await fetch(
        `/api/instructor/assignments/${assignmentId}/score/intents/${intentId}/fold`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ applies, correctionIds }),
        }
      );
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof d?.message === 'string' ? d.message : 'Failed to apply the definition.');
      }
      if (!mountedRef.current) return;
      const mine = applies.find((a) => a.intentId === intentId);
      if (mine) {
        setDefinition(mine.definition);
        // The definition IS saved — mirror it into savedRef so the workbench
        // does not read the fold as an unapplied edit and demand a re-Apply of
        // text it just wrote.
        savedRef.current = { ...savedRef.current, definition: mine.definition };
        if (mine.title) setTitle(mine.title);
      }
      setFoldProposals(null);
      setFoldOpen(false);
      // The corrections are gone and the ratings now belong to an older
      // definition: reload rows (markers, cleared pills) and history.
      await fetchRatings(intentId, new AbortController().signal);
      loadVersions(intentId);
      setSimilarScores(null);
      setBaselineNonce((n) => n + 1);
    } catch (e) {
      if (mountedRef.current) setFoldError((e as Error).message);
    } finally {
      if (mountedRef.current) setFoldBusy(false);
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
  // (instant; zero LLM). Read-only until Revert rolls back to it.
  async function openVersion(versionNo: number) {
    if (intentId === null || busy || saving) return;
    setCheckout(versionNo);
    setError(null);
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    try {
      const payload = await fetchRatings(intentId, controller.signal, versionNo);
      if (live(controller.signal)) {
        setTitle(payload.intent.title);
        setDefinition(payload.intent.definition);
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
      const payload = await fetchRatings(intentId, controller.signal);
      if (live(controller.signal)) {
        setTitle(payload.intent.title);
        setDefinition(payload.intent.definition);
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

  /**
   * Record (or withdraw) a CORRECTION on one question.
   *
   * Optimistic: flip immediately, fire the write, revert only on rejection. A
   * correction does not move the row — it changes nothing for students until
   * "Update definition" folds it in — so the pill going active IS the feedback.
   */
  async function togglePin(row: RatingRow, verdict: 'in' | 'out', reason?: string) {
    // Checkout is a read-only view of a past version.
    if (intentId === null || checkout !== null) return;
    const next = row.pinned === verdict ? null : verdict;
    const nextReason = next === null ? null : reason?.trim() || null;
    const setPinned = (pinned: 'in' | 'out' | null, rsn: string | null) =>
      setData((prev) =>
        prev
          ? {
              ...prev,
              rows: prev.rows.map((pr) =>
                pr.messageId === row.messageId ? { ...pr, pinned, reason: rsn } : pr
              ),
            }
          : prev
      );
    setPinned(next, nextReason);
    setSimilarScores(null); // the correction set changed → pin-sort scores stale
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
              }),
            });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(
          typeof d?.error === 'string' ? `Correction failed: ${d.error}` : 'Failed to record the correction.'
        );
      }
      // Refetch to pick up the server's correction ids — the fold consumes them.
      await fetchRatings(intentId, new AbortController().signal);
    } catch (e) {
      if (mountedRef.current) {
        setPinned(row.pinned, row.reason); // revert the optimistic flip
        setError((e as Error).message);
      }
    }
  }

  // Open the out-reason picker under the clicked button and fetch three
  // LLM-suggested reasons in the background. NOTHING is pinned until the
  // instructor picks or writes one (pickOutReason) — closing cancels the out.
  /** True when this correction overrules the classifier — the only case worth
   * a reason. An 'in' on anything but clearly_in, an 'out' on anything but
   * clearly_out. (Stated as disagreement, not list position, so a row reached
   * from search or the conversation view is judged the same way.) */
  function disagrees(row: RatingRow, verdict: 'in' | 'out'): boolean {
    if (row.rating === null) return false; // unrated — nothing to overrule yet
    return verdict === 'in' ? row.rating !== 'clearly_in' : row.rating !== 'clearly_out';
  }

  async function openReasonPicker(row: RatingRow, verdict: 'in' | 'out', btn: DOMRect) {
    if (intentId === null || checkout !== null) return;
    setReasonPicker({
      messageId: row.messageId,
      verdict,
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
          body: JSON.stringify({
            messageId: row.messageId,
            verdict,
            ...(row.rationale ? { rationale: row.rationale } : {}),
          }),
        }
      );
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof d?.message === 'string' ? d.message : 'Could not suggest reasons.');
      const reasons = Array.isArray(d.reasons)
        ? d.reasons.filter((r: unknown): r is string => typeof r === 'string')
        : [];
      setReasonPicker((p) => (p && p.messageId === row.messageId ? { ...p, loading: false, reasons } : p));
    } catch (e) {
      setReasonPicker((p) =>
        p && p.messageId === row.messageId ? { ...p, loading: false, error: (e as Error).message } : p
      );
    }
  }

  /** Commit the correction with the chosen/typed reason (blank = no reason). */
  function pickReason(reason: string) {
    if (!reasonPicker) return;
    const row = data?.rows.find((r) => r.messageId === reasonPicker.messageId);
    const verdict = reasonPicker.verdict;
    setReasonPicker(null);
    if (row) togglePin(row, verdict, reason.trim() || undefined);
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
  // The panes show the SCOPE's rows only — out-of-scope ratings still exist
  // (the background sweep writes them; the board's ↗ outside-count reads them)
  // but browsing them here would drown the queries this intent can actually
  // answer. Pins are exempt: an example is part of the spec wherever it lives.
  const scopedRows = useMemo(
    () =>
      data
        ? scopeSet
          ? data.rows.filter((r) => scopeSet.has(r.messageId) || r.pinned !== null || r.marker !== null)
          : data.rows
        : [],
    [data, scopeSet]
  );
  const scopedStaleCount = useMemo(() => scopedRows.filter((r) => r.stale).length, [scopedRows]);

  // Both panes read the JUDGMENT. A correction deliberately does NOT move its
  // row: until the definition absorbs it nothing has changed for students, and
  // a row that jumped on click would claim otherwise. The row stays put with
  // its pill lit — "taught, not yet learned" — and moves for real after the
  // update re-rates it. That is the loop made visible.
  const inThisIntent = useMemo(() => scopedRows.filter(isMember), [scopedRows]);
  // Needs decision is the probably-IN side alone. Making an intent is settling
  // where its boundary runs, and the questions that test a boundary are the ones
  // just inside it; probably-out (and the legacy unsure/unrated rows) are a
  // longer list that mostly restates what the definition already excludes. They
  // return by widening the definition, which is the move that actually claims
  // them — not by labelling one at a time.
  const needsDecision = useMemo(
    () => scopedRows.filter((r) => r.rating === 'probably_in' && reaches(r)),
    [scopedRows]
  );
  /** Pending corrections — what "Update definition" will fold in. */
  const pinnedIn = useMemo(() => (data ? data.rows.filter((r) => r.pinned === 'in') : []), [data]);
  const pinnedOut = useMemo(() => (data ? data.rows.filter((r) => r.pinned === 'out') : []), [data]);
  const pinCount = pinnedIn.length + pinnedOut.length;
  /**
   * A folded correction the re-rating did NOT reproduce — the fold did not
   * hold. Surfaced as a count so a failed teaching cannot pass unnoticed.
   *
   * STALE ratings are excluded, and that exclusion is the whole point: right
   * after a fold the stored ratings still belong to the definition the fold
   * replaced, so judging a marker against them would flag every correction as
   * failed at the exact moment it succeeded. A marker is only testable once the
   * re-Apply has rated the question against the definition it produced.
   */
  const conflictRows = useMemo(
    () =>
      scopedRows.filter(
        (r) =>
          r.marker !== null &&
          r.pinned === null &&
          r.rating !== null &&
          !r.stale &&
          (r.marker.verdict === 'in') !== (r.rating === 'clearly_in')
      ),
    [scopedRows]
  );

  // ---- Membership diff vs the baseline version --------------------------
  // Membership is the JUDGMENT — what the deployed chatbot would do. A pending
  // correction is not membership: it is a request for the definition to change,
  // and counting it here would report an intent as already fixed while students
  // still get the old routing.
  const effectiveIn = (
    rowsIn: { messageId: number; rating: RatingLevel | null; shadowedBy: number | null }[]
  ) => new Set(rowsIn.filter(isMember).map((r) => r.messageId));
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
        // A base with nothing judged yet — the v1 an intent is BORN with, read
        // before its first pass lands — cannot say what "entered since". It
        // would report the entire membership as new, which is the intent's
        // birth, not a change. No base until it has judgments of its own.
        if (!d.rows.some((r) => r.rating !== null)) {
          setBaseline(null);
          return;
        }
        const buckets = new Map<number, 'in' | 'nd' | 'out'>();
        for (const r of d.rows) {
          buckets.set(
            r.messageId,
            r.rating === 'clearly_in' ? 'in' : r.rating === 'clearly_out' ? 'out' : 'nd'
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
  }, [diffBaseNo, intentId, assignmentId, baselineNonce]);

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
        className={`items-center gap-0.5 rounded border px-1 py-0.5 text-xs font-medium ${
          isDiffBase
            ? 'inline-flex border-sky-300 bg-sky-100 text-sky-800'
            : 'hidden group-hover:inline-flex border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]'
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
            : `${v.title ? `${v.title} — ` : ''}${v.definition ?? ''}\n${[
                `included ${v.included}`,
                `excluded ${v.excluded}`,
                v.stats ? `in this intent ${v.stats.inCount}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}\n\n${absoluteTime} — click to view this state (loads instantly)`
        }
        className={`group w-full cursor-pointer text-left rounded border text-xs ${
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
        {/* Majors are ONE line — the definition and label counts live in the
            row tooltip. Version-shy instructors read "v2 · saved · 2h ago",
            nothing more. */}
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
    // in/out · v1"). Colors follow the verdict (in = emerald, out = rose), same
    // as the pin buttons; the drop/rise direction is implied by the row sitting
    // here now.
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
    // The row whose conversation you last opened in THIS pane, marked so a
    // return from the thread lands somewhere recognizable.
    const marked = lastOpened[pane] === r.messageId;
    return (
      <li
        key={r.messageId}
        ref={marked ? (el) => { markedRowRef.current[pane] = el; } : undefined}
        title={marked ? 'The conversation you last opened' : undefined}
        className={`group relative px-3 py-2 border-l-2 ${
          marked
            ? 'border-l-[hsl(var(--ring))] bg-[hsl(var(--muted))]/60'
            : 'border-l-transparent hover:bg-[hsl(var(--muted))]/40'
        }`}
      >
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
            onOpen={() => openConvo(r.messageId, pane)}
          >
            {/* The instructor's own reason for overruling the judge here. */}
            {r.pinned && r.reason && (
              <p
                className={`mt-1 text-xs italic ${
                  r.pinned === 'in' ? 'text-emerald-700' : 'text-rose-700'
                }`}
              >
                {r.pinned === 'in' ? 'why: ' : 'why not: '}
                {r.reason}
              </p>
            )}
            {/* A PENDING correction states plainly that nothing has changed
                yet — the row has not moved, and this says why. */}
            {r.pinned && (
              <p className="mt-1 text-xs font-medium text-[hsl(var(--primary))]">
                marked {r.pinned} — waiting for the definition update
              </p>
            )}
            {/* MARKER — a correction already folded in. Quiet when the rating
                agrees (it is just "I reviewed this"); loud when it does not,
                because that is a teaching that did not hold. */}
            {!r.pinned && r.marker && (() => {
              const at = r.marker.versionNo ? ` · v${r.marker.versionNo}` : '';
              // Only a FRESH rating can test a marker — see conflictRows.
              const testable = r.rating !== null && !r.stale;
              const held = (r.marker.verdict === 'in') === (r.rating === 'clearly_in');
              return testable && !held ? (
                <p className="mt-1 text-xs font-medium text-amber-700">
                  ⚠ you marked this {r.marker.verdict}
                  {at} — the updated definition does not agree
                </p>
              ) : (
                <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
                  ✓ you marked this {r.marker.verdict}
                  {at}
                  {!testable ? ' — re-apply to check it held' : ''}
                </p>
              );
            })()}
            {(r.rationale || drift) && (
              <p className="mt-1 flex flex-wrap items-baseline gap-1.5 text-xs text-[hsl(var(--muted-foreground))]">
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
            {r.stale && (
              <span className="mt-0.5 block text-xs text-[hsl(var(--muted-foreground))]">
                stale rating
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
              r.pinned || reasonPicker?.messageId === r.messageId ? 'opacity-100' : 'opacity-0'
            }`}
          >
            {pinButtons(r, pane)}
          </span>
        )}
      </li>
    );
  };

  // The pin buttons — shared by list rows and the conversation header so a
  // decision that needed the chatbot's reply is made without leaving the thread.
  // A render HELPER (not a nested component) so React doesn't see a fresh
  // component type each render and remount the buttons.
  //
  // ONE verdict per pane, in the direction that pane exists to settle: "In this
  // intent" is the list you carve members OUT of, "Needs decision" the list you
  // pull members IN from. Offering both everywhere made every row a two-way
  // question when only one way moves the boundary. The opposite verdict still
  // renders when it is already pinned — that pill is the only way to withdraw
  // the label, and a label with no undo is a trap.
  const pinButtons = (row: RatingRow, pane: 'in' | 'nd') => {
    const showIn = pane === 'nd' || row.pinned === 'in';
    const showOut = pane === 'in' || row.pinned === 'out';
    return (
      <>
        {showIn && (
          <button
            onClick={(e) =>
              row.pinned === 'in'
                ? togglePin(row, 'in') // already corrected → withdraw
                : disagrees(row, 'in')
                  ? openReasonPicker(row, 'in', e.currentTarget.getBoundingClientRect())
                  : togglePin(row, 'in') // agrees with the rating → one click
            }
            className={`px-1.5 py-0.5 rounded text-xs font-medium border ${
              row.pinned === 'in' || (reasonPicker?.messageId === row.messageId && reasonPicker.verdict === 'in')
                ? 'bg-emerald-600 text-white border-emerald-600'
                : 'border-[hsl(var(--border))] text-emerald-700 hover:bg-emerald-50'
            }`}
            title={
              disagrees(row, 'in')
                ? 'This question BELONGS here — you’ll be asked why, since the classifier disagrees'
                : 'This question BELONGS here'
            }
          >
            in
          </button>
        )}
        {showOut && (
          <button
            onClick={(e) =>
              row.pinned === 'out'
                ? togglePin(row, 'out') // already corrected → withdraw
                : disagrees(row, 'out')
                  ? openReasonPicker(row, 'out', e.currentTarget.getBoundingClientRect())
                  : togglePin(row, 'out') // agrees with the rating → one click
            }
            className={`px-1.5 py-0.5 rounded text-xs font-medium border ${
              row.pinned === 'out' || (reasonPicker?.messageId === row.messageId && reasonPicker.verdict === 'out')
                ? 'bg-rose-600 text-white border-rose-600'
                : 'border-[hsl(var(--border))] text-rose-700 hover:bg-rose-50'
            }`}
            title={
              disagrees(row, 'out')
                ? 'This question does NOT belong here — you’ll be asked why, since the classifier disagrees'
                : 'This question does NOT belong here'
            }
          >
            out
          </button>
        )}
      </>
    );
  };

  // Conversation view for one pane: the clicked question's full thread, with
  // Exit + the same pin button as the row — the pinned state reads live from
  // `data`, so labeling from here is identical.
  function renderConvo(pane: 'in' | 'nd') {
    if (!convo || convo.pane !== pane) return null;
    const boardRow = rowByMessage.get(convo.messageId) ?? null;
    const ratingRow = data?.rows.find((r) => r.messageId === convo.messageId) ?? null;
    return (
      // Covers the pane instead of replacing it: the list underneath keeps its
      // layout box, so its scroll position is simply still there on Exit.
      // z-20 clears the row hover strip (z-10), which a row still holding focus
      // — the very row just clicked open — would otherwise paint over this.
      <div className="absolute inset-0 z-20 flex flex-col bg-[hsl(var(--card))]">
        <div className="shrink-0 px-3 py-1.5 bg-[hsl(var(--muted))]/40 border-b border-[hsl(var(--border))] flex items-center justify-between gap-2">
          <button
            onClick={() => exitConvo(pane)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[hsl(var(--border))] text-xs font-medium text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]"
            title="Back to the list — it keeps the place you left it"
          >
            <Minimize2 className="w-3.5 h-3.5" /> Exit conversation
          </button>
          {ratingRow && checkout === null && (
            <span className="flex items-center gap-1 shrink-0">
              <span className="mr-1 text-xs text-[hsl(var(--muted-foreground))]">
                label this question:
              </span>
              {pinButtons(ratingRow, pane)}
            </span>
          )}
        </div>
        {boardRow ? (
          // ChatMessages owns the scroll (flex-1 overflow-y-auto), so the
          // thread scrolls inside the pane under the sticky Exit header.
          <ConversationThread rows={contextRows ?? rows} current={boardRow} isNirvana={isNirvana} expandMaterials />
        ) : (
          <p className="p-4 text-sm text-[hsl(var(--muted-foreground))]">
            The conversation for this question is not available.
          </p>
        )}
      </div>
    );
  }

  // "Applied" is judged on the VISIBLE scope: the background sweep may still
  // be filling out-of-scope rows, and that must not hold Save hostage.
  const applied = !!data && !specDirty() && scopedStaleCount === 0;
  // …and being up to date is not by itself a reason to save. `applied` is true
  // precisely when everything is current, which left Save enabled forever: it
  // stayed lit after a save and would write a second MAJOR identical to the
  // one just written. What Save commits is the work sitting on top of the last
  // one, so the question is whether the newest entry is still a minor — every
  // real change routes through an Apply, and an Apply records one. Same test
  // as the rule workbench's `dirty`.
  const savePending = versions?.[0]?.minor === true;

  return (
    <div className="flex flex-col gap-2 flex-1 min-h-0">
      {/* TOP BAR — leave the workbench. */}
      <WorkbenchTopBar
        title={`${isEdit ? 'Edit intent' : 'New Intent'}${title.trim() ? ` — ${title.trim()}` : ''}`}
        onBack={() => guardLeave(exit)}
        backTitle="Back to the board"
      />

      <div className="grid grid-cols-1 lg:grid-cols-[380px_minmax(0,1fr)_minmax(0,1fr)] gap-4 flex-1 min-h-0">
        {/* LEFT — the spec: definition, labeled examples, actions, history */}
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-y-auto">
          <div className="p-4 space-y-3">
            <label className="block text-sm cursor-text">
              <span className="font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                Title
              </span>
              <input
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setTitleSuggestion(null); // their own words win over the offer
                }}
                placeholder="Auto-generated from the definition"
                className="mt-1 w-full text-sm border border-[hsl(var(--border))] rounded px-2 py-1.5 bg-[hsl(var(--background))]"
              />
            </label>
            {titleSuggestion && (
              // Offered after an Apply that changed the definition. Nothing has
              // been renamed at this point — this is the only way the name moves.
              <div className="rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40 px-2 py-1.5 text-xs">
                <p className="text-[hsl(var(--muted-foreground))]">
                  The refined definition suggests a name:
                </p>
                <p className="mt-0.5 font-medium text-[hsl(var(--foreground))]">“{titleSuggestion}”</p>
                <div className="mt-1.5 flex items-center gap-2">
                  <button
                    onClick={acceptTitleSuggestion}
                    disabled={renaming}
                    className="px-2 py-0.5 rounded border border-[hsl(var(--border))] bg-[hsl(var(--card))] font-medium hover:bg-[hsl(var(--muted))] disabled:opacity-50"
                    title="Rename this intent to the suggestion"
                  >
                    {renaming ? 'Renaming…' : 'Rename'}
                  </button>
                  <button
                    onClick={() => setTitleSuggestion(null)}
                    className="px-2 py-0.5 rounded text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                    title="Keep the current name"
                  >
                    Keep “{title}”
                  </button>
                </div>
              </div>
            )}
            <DefinitionEditor
              value={definition}
              onChange={setDefinition}
              placeholder="e.g. asks the chatbot to write a thesis statement or conclusion for them"
              // Apply belongs to the definition — it re-rates the log against
              // THIS text — so it sits on its header, small and right-aligned,
              // instead of taking a row of the column. Disabled while the shown
              // ratings already reflect the text (`applied`) — i.e. whenever
              // "When a student…" hasn't changed and nothing is stale, there is
              // nothing to apply. (A changed TITLE alone also enables it: Apply
              // is the rename's persistence path — the tooltip says so.)
              action={
                <button
                  onClick={() => apply()}
                  disabled={busy || saving || !definition.trim() || !openaiConfigured || applied}
                  title={
                    !openaiConfigured
                      ? 'OPENAI_API_KEY is not configured'
                      : applied
                        ? 'Up to date — the definition is unchanged and nothing needs re-rating'
                        : definition.trim() === savedRef.current.definition && scopedStaleCount === 0 && !!data
                          ? 'Keep the new name — the definition is unchanged, nothing re-rates'
                          : isEdit
                            ? // In edit mode Apply IS persistent (a minor version) — saying
                              // otherwise is what made leaving-after-Apply feel like loss.
                              'Rate every question against this definition — the change is kept (revertible from History)'
                            : 'Rate every question against this definition (nothing is registered until Save)'
                  }
                  className="inline-flex items-center gap-1 rounded bg-[hsl(var(--primary))] px-2 py-0.5 text-[11px] font-semibold text-[hsl(var(--primary-foreground))] disabled:opacity-40"
                >
                  {busy ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Search className="h-3 w-3" />
                  )}
                  Apply
                </button>
              }
            />

            {/* CORRECTIONS WAITING — what the next update will fold in. The
                rows themselves stay in the panes; this is the summary and the
                trigger, so "what have I taught, and has it landed?" is one
                place. Corrections do not accumulate: an update consumes them. */}
            {pinCount > 0 && checkout === null && (
              <div className="rounded border border-[hsl(var(--primary))]/40 bg-[hsl(var(--primary))]/5 px-2.5 py-2">
                <p className="text-xs font-semibold text-[hsl(var(--foreground))]">
                  Corrections waiting · {pinCount}
                  <span className="ml-1 font-normal text-[hsl(var(--muted-foreground))]">
                    — folded into the definition on update, then cleared
                  </span>
                </p>
                <ul className="mt-1.5 space-y-1">
                  {[...pinnedIn, ...pinnedOut].slice(0, 6).map((r) => (
                    <li key={r.messageId} className="text-xs leading-snug">
                      <span
                        className={`font-semibold ${
                          r.pinned === 'in' ? 'text-emerald-700' : 'text-rose-700'
                        }`}
                      >
                        {r.pinned}
                      </span>{' '}
                      <span className="text-[hsl(var(--foreground))]">
                        {r.queryText.replace(/\s+/g, ' ').trim().slice(0, 70)}
                        {r.queryText.length > 70 ? '…' : ''}
                      </span>
                      {r.reason && (
                        <span
                          className={`block italic ${
                            r.pinned === 'in' ? 'text-emerald-700' : 'text-rose-700'
                          }`}
                        >
                          {r.pinned === 'in' ? 'why: ' : 'why not: '}
                          {r.reason}
                        </span>
                      )}
                    </li>
                  ))}
                  {pinCount > 6 && (
                    <li className="text-xs text-[hsl(var(--muted-foreground))]">
                      + {pinCount - 6} more
                    </li>
                  )}
                </ul>
                <button
                  onClick={openFoldReview}
                  disabled={refining || busy || saving || !openaiConfigured}
                  title={
                    !openaiConfigured
                      ? 'OPENAI_API_KEY is not configured'
                      : 'Rewrite the definition so it carries these corrections by itself — you review the result before anything changes'
                  }
                  className="mt-2 inline-flex items-center gap-1.5 rounded bg-[hsl(var(--primary))] px-2 py-1 text-xs font-semibold text-[hsl(var(--primary-foreground))] disabled:opacity-50"
                >
                  {refining ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Wand2 className="h-3 w-3" />
                  )}
                  Update definition · {pinCount} correction{pinCount === 1 ? '' : 's'}
                </button>
              </div>
            )}

            {/* Progress and errors only — every action now lives where its
                subject is: Apply on the definition header, Update definition on
                the corrections card, Save in the History header. Renders
                nothing at all when there is nothing to report, so the column
                does not carry an empty bordered block. */}
            {(busy || error) && (
            <div className="space-y-2 border-t border-[hsl(var(--border))] pt-3">
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
            )}

            {/* History — one line per saved version of THIS intent. Clicking
                a version CHECKS IT OUT (title/definition/labels/ratings load
                instantly from the stored state); Revert rolls back to it;
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
                  {checkout !== null ? (
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
                  ) : (
                    // Save lives WHERE ITS RESULT APPEARS: clicking it adds
                    // the next entry right below this button. Same verb as the
                    // rule workbench's live-committing Save.
                    <button
                      onClick={save}
                      disabled={saving || busy || !definition.trim() || !applied || !savePending}
                      title={
                        !data
                          ? 'Apply first — Save records the applied state as a version'
                          : specDirty()
                            ? 'Definition changed — Apply it first'
                            : scopedStaleCount > 0
                              ? 'Ratings are stale — Apply to re-rate first'
                              : !savePending
                                ? 'Nothing new to save — the latest version already holds this state'
                                : "Record this state as the next version — the board's When version advances"
                      }
                      className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[hsl(var(--primary))] text-xs font-semibold text-[hsl(var(--primary-foreground))] disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <SaveIcon className="w-3 h-3" />}
                      Save
                    </button>
                  )}
                </div>
                <p className="text-xs text-[hsl(var(--muted-foreground))]">
                  Every applied version is a snapshot you can click to revisit.
                </p>
                <ul className="space-y-1.5">
                  {versionGroups.map((g) => {
                    // Collapsed by default — the applies/labels between saves
                    // are detail; the saves are the story.
                    const open = groupToggles[g.key] ?? false;
                    // Minors display OLDEST-FIRST inside the group so v2.1,
                    // v2.2, … read as the progression on top of v2.
                    const minorsAsc = [...g.minors].reverse();
                    return (
                      <li key={g.key} className="space-y-1">
                        {g.major ? (
                          versionEntry(g.major, false)
                        ) : (
                          <p className="px-1 text-xs font-medium text-[hsl(var(--muted-foreground))]">
                            Draft steps — before the first Save
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
          </div>
        </div>

        {/* MIDDLE — In this intent (captured: clearly-in; pins live on the left) */}
        <div className="relative rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] flex flex-col overflow-hidden min-h-[300px] lg:min-h-0">
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
              {renderConvo('in')}
              <div className="flex-1 min-h-0 flex flex-col">
                <div className="shrink-0 bg-[hsl(var(--card))] border-b border-[hsl(var(--border))]">
                  <div className="px-3 py-1.5 bg-[hsl(var(--muted))]/60 border-b border-[hsl(var(--border))] flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-emerald-700 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span>In this intent · {inThisIntent.length}</span>
                      {conflictRows.length > 0 && (
                        <span
                          className="rounded border border-amber-300 bg-amber-50 px-1 py-0.5 font-normal normal-case text-amber-800"
                          title={
                            'Questions you corrected whose folded definition no longer agrees. ' +
                            'The teaching did not hold — correct them again, or edit the definition directly.'
                          }
                        >
                          ⚠ {conflictRows.length} disagree{conflictRows.length === 1 ? 's' : ''} with your marks
                        </span>
                      )}
                      {scopeLabel && (
                        <span
                          className="font-normal normal-case text-[hsl(var(--muted-foreground))]"
                          title={`Only questions “${scopeLabel}” currently answers are shown and rated here — a nested intent can never answer a question its enclosing intent doesn't. The rest of the log rates in the background for the board's diagnostics.`}
                        >
                          within “{scopeLabel}”
                        </span>
                      )}
                      {baseline && ((newlyIn?.size ?? 0) > 0 || leftRows.length > 0) && (
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
                  <div className="px-3 py-1.5">
                    <PaneSearch value={inSearch} onChange={setInSearch} />
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
                          {newInRows.map((r) => renderRow(r, 'in'))}
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
                    const rest = inThisIntent.filter((r) => !newlyIn?.has(r.messageId));
                    const sorted = sortRows(rest, inSort, inSearch);
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
              </div>
            </>
          )}
        </div>

        {/* RIGHT — Needs decision (model-uncertain; label in/out) */}
        <div className="relative rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] flex flex-col overflow-hidden min-h-[300px] lg:min-h-0">
          {!data ? (
            <div className="flex-1 flex items-center justify-center p-8 text-center text-sm text-[hsl(var(--muted-foreground))]">
              <span className="max-w-[26ch]">
                The questions the model nearly captured appear here — pull the ones that
                belong in.
              </span>
            </div>
          ) : (
            <>
              {renderConvo('nd')}
              <div className="flex-1 min-h-0 flex flex-col">
                <div className="shrink-0 bg-[hsl(var(--card))] border-b border-[hsl(var(--border))]">
                  <div className="px-3 py-1.5 bg-[hsl(var(--muted))]/40 border-b border-[hsl(var(--border))] flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                      Needs decision · {needsDecision.length}
                      {scopeLabel && (
                        <span
                          className="font-normal normal-case"
                          title={`Only questions “${scopeLabel}” currently answers are shown here.`}
                        >
                          {' '}
                          within “{scopeLabel}”
                        </span>
                      )}
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
                  <div className="px-3 py-1.5">
                    <PaneSearch value={ndSearch} onChange={setNdSearch} />
                  </div>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto">
                  {(() => {
                    const sorted = sortRows(needsDecision, ndSort, ndSearch);
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
                            : 'Nothing to decide — every question is settled.'}
                      </p>
                    );
                  })()}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* WHY PICKER — opens under the clicked in/out button when the
          correction overrules the classifier: three LLM-suggested reasons + a
          free-text "Other". Fixed-positioned so it escapes the column's scroll
          clip; the backdrop cancels the correction. */}
      {reasonPicker &&
        (() => {
          const PW = 280;
          const M = 8; // viewport margin
          const a = reasonPicker.anchor;
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
              <div className="fixed inset-0 z-[59]" onClick={() => setReasonPicker(null)} />
              <div
                className="fixed z-[60] overflow-y-auto rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-lg p-2 space-y-1.5"
                style={pos}
              >
                <div className="flex items-center justify-between px-1">
                  <span
                    className={`text-xs font-semibold uppercase tracking-wide ${
                      reasonPicker.verdict === 'in' ? 'text-emerald-700' : 'text-rose-700'
                    }`}
                  >
                    {reasonPicker.verdict === 'in' ? 'Why does this belong?' : 'Why is this out?'}
                  </span>
                  <button
                    onClick={() => setReasonPicker(null)}
                    className="p-0.5 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                    aria-label="Cancel"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <p className="px-1 text-[11px] text-[hsl(var(--muted-foreground))]">
                  Becomes a rule in the definition — state the principle, not this one question.
                </p>
                {reasonPicker.loading ? (
                  <p className="flex items-center gap-1.5 px-1 py-1 text-xs text-[hsl(var(--muted-foreground))]">
                    <Loader2 className="w-3 h-3 animate-spin" /> Suggesting reasons…
                  </p>
                ) : reasonPicker.reasons.length > 0 ? (
                  reasonPicker.reasons.map((rsn, i) => (
                    <button
                      key={i}
                      onClick={() => pickReason(rsn)}
                      className={`w-full text-left px-2 py-1.5 rounded text-xs text-[hsl(var(--foreground))] border border-[hsl(var(--border))] ${
                        reasonPicker.verdict === 'in'
                          ? 'hover:bg-emerald-50 hover:border-emerald-200'
                          : 'hover:bg-rose-50 hover:border-rose-200'
                      }`}
                    >
                      {rsn}
                    </button>
                  ))
                ) : (
                  <p className="px-1 text-xs text-[hsl(var(--muted-foreground))]">
                    {reasonPicker.error ?? 'No suggestions — type your own below.'}
                  </p>
                )}
                <OutReasonOther onSubmit={pickReason} />
                <button
                  onClick={() => pickReason('')}
                  className="w-full text-center px-2 py-0.5 text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                >
                  {reasonPicker.verdict === 'in' ? 'Include' : 'Exclude'} without a reason
                </button>
              </div>
            </>
          );
        })()}

      {/* REVIEW GATE — the fold's result, before anything is written. */}
      {foldOpen && (
        <FoldReviewModal
          proposals={foldProposals}
          loading={refining}
          pending={{
            title: title.trim() || 'this intent',
            before: definition.trim(),
            corrections: [...pinnedIn, ...pinnedOut].map((r) => ({
              id: r.correctionId ?? r.messageId,
              verdict: (r.pinned ?? 'in') as 'in' | 'out',
              queryText: r.queryText,
              reason: r.reason,
            })),
          }}
          busy={foldBusy}
          error={foldError}
          onApply={applyFold}
          onCancel={() => {
            if (foldBusy) return;
            // Closing drops the PROPOSAL only. The corrections stay pending, so
            // the instructor can label more, edit the definition by hand, or
            // simply try again — nothing they taught is lost by saying no.
            setFoldOpen(false);
            setFoldProposals(null);
            setFoldError(null);
          }}
        />
      )}

      {/* LEAVE GUARD — the only state leaving can destroy is text typed but
          not yet Applied (pins persist on click; an Apply persists the spec,
          and a create is registered by its first Apply). */}
      {leavePrompt &&
        (() => {
          if (!leaveLoss()) return null; // resolved meanwhile
          const leave = () => {
            const go = leavePrompt.action;
            setLeavePrompt(null);
            go();
          };
          return (
            <div
              className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 p-4"
              onClick={() => setLeavePrompt(null)}
            >
              <div
                className="w-full max-w-sm rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-xl"
                onClick={(e) => e.stopPropagation()}
              >
                <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">Untried edits</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">
                  {intentId !== null
                    ? 'The edited definition hasn’t been tried — leaving discards it. Everything you tried is kept.'
                    : 'The typed definition hasn’t been tried — leaving discards it, and no intent is created.'}
                </p>
                <div className="mt-3 flex items-center justify-end gap-2">
                  <button
                    onClick={() => setLeavePrompt(null)}
                    className="px-2.5 py-1.5 rounded border border-[hsl(var(--border))] text-xs font-medium text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]"
                  >
                    Keep working
                  </button>
                  <button
                    onClick={leave}
                    className="px-2.5 py-1.5 rounded border border-rose-300 text-xs font-medium text-rose-700 hover:bg-rose-50"
                  >
                    Discard edits
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
    </div>
  );
}

/** The per-pane query search box. */
