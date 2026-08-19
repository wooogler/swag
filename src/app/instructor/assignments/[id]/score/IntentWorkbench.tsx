'use client';

/**
 * SCORE v6 — the inline intent workbench (replaces the old IntentModal dialog).
 *
 * Editing or creating an intent transforms the BOARD ITSELF: the board's
 * 3-column grid is swapped for this one, keeping the same shape —
 *   LEFT   the spec: title · definition · labeled examples · actions · history
 *   MIDDLE "In this intent" — what the definition captures, labeled OUT
 *   RIGHT  "Potential questions in this intent" — the probably-in ones, labeled IN
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
import { useSurfaceLog } from '@/lib/study/ui-log';
import {
  type RatingLevel,
  type ScoreQueryType,
} from '@/lib/score/intents';
import {
  AlertTriangle,
  GitCompareArrows,
  Loader2,
  Minimize2,
  Plus,
  Redo2,
  RotateCcw,
  Save as SaveIcon,
  Search,
  Undo2,
  Wand2,
  X,
} from 'lucide-react';
import { runShardedRate } from './rate-runner';
import { DefinitionEditor, PaneSearch, QueryTextButton, WorkbenchTopBar } from './workbench-shared';
import type { Dissection } from './materials';
import FoldReviewModal, {
  type FoldCorrectionView,
  type FoldProposalView,
} from './FoldReviewModal';
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
  /** The verdict of any standing decision on this question — null when none. */
  pinned: 'in' | 'out' | null;
  /**
   * The instructor's standing ruling on this question, or null.
   *
   * One object where there used to be three fields in three states, because
   * there is one thing to know and one bit that matters: `holds`. True — the
   * definition says this by itself. False — it has drifted off, and until it
   * catches up this decision is what routes the question. Null — nothing fresh
   * to check against yet.
   */
  decision: {
    id: number | null;
    verdict: 'in' | 'out';
    reason: string | null;
    /** 'pending' — no fold has taken it in. 'taught' — at least one has. */
    status: 'pending' | 'taught';
    taughtAtVersion: number | null;
    /** >1 means the definition keeps losing it: a question that may want an
     * intent of its own rather than a wider version of this one. */
    taughtCount: number;
    holds: boolean | null;
  } | null;
  /** Why the instructor ruled that way — asked only when it disagreed with the
   * rating. The fold's main fuel. Null otherwise. */
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
 * and labelling one in "Potential questions" teaches a definition about a question it
 * will never judge — the label lands, the fold absorbs it, and the row still
 * goes to the intent that comes first. (That is what "send here" existed to work
 * around; it left this workbench with it.) Interception belongs to the board,
 * which can see the whole chain and offers the fixes — reorder, narrow the
 * earlier set — that neither of these two lists can perform.
 */
const reaches = (r: { shadowedBy: number | null }) => r.shadowedBy === null;

/**
 * Membership, in one place — so the lists and the diff's +N/−N can never
 * disagree about what counts as being in this intent.
 *
 * A decision the definition does NOT hold wins over the rating, because that is
 * what actually happens: the system routes by the instructor's call until the
 * text can say it. Showing the rating there would tell them the opposite of
 * what a student gets.
 */
const isMember = (r: {
  rating: RatingLevel | null;
  shadowedBy: number | null;
  decision?: { verdict: 'in' | 'out'; holds: boolean | null } | null;
}) =>
  (r.decision && r.decision.holds === false
    ? r.decision.verdict === 'in'
    : r.rating === 'clearly_in') && reaches(r);

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
  /** Minor entry. Applies no longer write one; what remains is older data and
   * the row the fold records to date its markers. History filters them out. */
  minor: boolean;
  minorNo: number | null;
  createdAt: string;
  action: string;
  detail: string | null;
  title: string | null;
  definition: string | null;
  included: number;
  excluded: number;
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

/** "v2" for majors, "v2.3" for the minors older data still carries. */
function versionLabel(v: IntentVersion): string {
  return v.minor ? `v${v.intentVersion}.${v.minorNo}` : `v${v.intentVersion}`;
}

/** What the entry DID, in one word. */
function versionAction(v: IntentVersion): string {
  return ACTION_LABELS[v.action] ?? v.action.replace(/_/g, ' ');
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
  /** Make a NEW intent out of the questions ruled out of this one. Absent in a
   * create (nothing has been ruled out of an intent that does not exist yet)
   * and on a type-less legacy intent, which has no placement to sit beside. */
  onSpinOff?: (queries: { text: string; reason: string | null }[]) => void;
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
  onSpinOff,
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
  /**
   * How long the fold review stays open, and what it was carrying.
   *
   * The modal is the safeguard between a model rewriting the definition and
   * that rewrite becoming the classifier's boundary — so whether it was READ
   * is a finding in itself, and nothing else records it: accepting a proposal
   * two seconds after it lands and accepting it after ninety produce the same
   * config version. The key changes when the proposal arrives, so waiting for
   * the model and reading its answer are two spans, not one.
   */
  useSurfaceLog(
    assignmentId,
    'fold_open',
    'fold_close',
    foldOpen ? (foldProposals ? `proposed:${intentId}` : `waiting:${intentId}`) : null,
    {
      intentId,
      // Set once the proposal is on screen — the earlier span is the model
      // still running, which is not reading time.
      proposals: foldProposals?.length ?? null,
    }
  );
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
  // The two sides of the diff on their own, over the workbench. The list itself
  // already carries the change in colour; this is for reading it as a change.
  const [diffOpen, setDiffOpen] = useState(false);
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

  /**
   * Leave the workbench — and if this was a NEW intent nobody saved, take it
   * with us.
   *
   * A create is applied before it is saved, so it has a row (the ratings need
   * an id to hang on) but no version. That row is a draft: Save is what makes
   * the intent, and backing out has to mean it was never made — otherwise the
   * board fills with half-built sets from every abandoned attempt. The delete
   * is the same purge the board's own delete uses, so the ratings go too.
   */
  async function exit() {
    if (discardOnExit()) {
      const id = intentId;
      onExit(null); // leave first — the board should not wait on a cleanup
      try {
        await fetch(
          `/api/instructor/assignments/${assignmentId}/score/intents/${id}?mode=purge`,
          { method: 'DELETE' }
        );
      } catch {
        /* best-effort: a stray draft is visible and deletable on the board */
      }
      return;
    }
    onExit(intentId);
  }

  /** A created-but-never-saved intent: applied (so it exists and is rated) with
   * nothing recorded. `versions` must have loaded, or a slow history fetch
   * would read as "never saved" and delete a real intent. */
  const discardOnExit = () =>
    !isEdit && intentId !== null && versions !== null && !versions.some((v) => !v.minor);

  /**
   * What leaving RIGHT NOW would actually destroy — the guard dialog names it,
   * so this must be precise. Pins persist the moment they are clicked and an
   * Apply persists the spec, so two states are at risk: a new intent that was
   * never saved (the whole thing goes), and definition/title text that differs
   * from the last persisted spec (typed but not yet Applied — client-only,
   * gone on unmount). A checkout is a read-only view of a past version — its
   * fields deviate from the live spec by design, so it never counts as loss.
   */
  const leaveLoss = (): 'edits' | 'intent' | null => {
    if (checkout !== null) return null;
    if (discardOnExit()) return 'intent';
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
          // A DRAFT, like any other create — adopting a starter is still only
          // the decision to try one, and it lands in the same "applied, not
          // saved" state so Save means the same thing whichever way you got
          // here. (The library template it was cloned from is untouched.)
          isTemplate: true,
          // …and no version either: Save is what records v1, here as anywhere.
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
  // The potential-questions pane holds the probably-in questions only, so its
  // useful default is the surprising side: the ones that look OUT-like next to
  // the pins.
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

  /** Apply = persist the spec, then rate the log against it and load the
   * matched-question view. `specOverride` lets a suggestion pick auto-apply
   * with values not yet committed to state. */
  async function apply(specOverride?: { title: string; definition: string; createNew?: boolean }) {
    if (busy || saving || !(specOverride?.definition ?? definition).trim()) return;
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;
    setBusy(true);
    setError(null);
    // What undo comes back to — read BEFORE persist overwrites it.
    const before = { ...savedRef.current };
    try {
      const id = await persist(signal, false, specOverride);
      if (id === null || !live(signal)) return;
      // A definition that actually moved is an undo step. The first Apply of a
      // create moves from nothing, which is not a state to return to.
      if (before.definition.trim() && before.definition !== savedRef.current.definition) {
        setPast((p) => [...p, before]);
        setFuture([]);
      }
      // LIVE FILL — refresh the panes while the shards rate, so "In this
      // intent" / "Potential questions" accumulate in place instead of landing all
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


  /**
   * Undo/redo over the APPLIED definitions of this session.
   *
   * Costs nothing to walk: every spec that was applied has its ratings stored
   * under its own hash, so returning to one re-attaches them instantly with no
   * LLM call — the same store version checkout reads. The stack is session-local
   * on purpose, exactly as a word processor's is: it undoes the editing you are
   * doing now, while the durable way back to an earlier state is History, whose
   * saved versions survive a reload.
   *
   * Definition and title only. Labels are the other axis — they persist on click
   * and are consumed by the fold — and rolling one back silently under an undo
   * meant for text would be a different promise than the one the button makes.
   */
  const [past, setPast] = useState<{ title: string; definition: string }[]>([]);
  const [future, setFuture] = useState<{ title: string; definition: string }[]>([]);

  /** Put an already-applied spec back in force: persist it (no version, no
   * rename offer) and re-read its stored ratings. */
  async function restoreSpec(spec: { title: string; definition: string }) {
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
    try {
      setTitle(spec.title);
      setDefinition(spec.definition);
      setCheckout(null); // the working draft is what you are back on
      const id = await persist(controller.signal, false, spec, { silent: true });
      if (id === null || !live(controller.signal)) return;
      await fetchRatings(id, controller.signal);
      if (live(controller.signal)) {
        setSimilarScores(null);
        setBaselineNonce((n) => n + 1);
      }
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError' && live(controller.signal)) {
        setError((e as Error).message);
      }
    } finally {
      if (live(controller.signal)) setBusy(false);
    }
  }

  const canUndo = past.length > 0 && !busy && !saving && checkout === null;
  const canRedo = future.length > 0 && !busy && !saving && checkout === null;

  async function undo() {
    if (!canUndo) return;
    const target = past[past.length - 1];
    setPast((p) => p.slice(0, -1));
    setFuture((f) => [...f, { ...savedRef.current }]);
    await restoreSpec(target);
  }

  async function redo() {
    if (!canRedo) return;
    const target = future[future.length - 1];
    setFuture((f) => f.slice(0, -1));
    setPast((p) => [...p, { ...savedRef.current }]);
    await restoreSpec(target);
  }

  const specDirty = () =>
    intentId === null ||
    title.trim() !== savedRef.current.title ||
    definition.trim() !== savedRef.current.definition;

  /** Create or update the intent spec. Returns the intent id.
   *
   * Both Apply and Save persist the text; what separates them is the RECORD.
   * Apply writes the working draft — the spec is stored, so it survives a
   * reload and the ratings key to it, but History gains nothing. Save records
   * the version. This is the word processor's model, and the reason for it is
   * that the two questions differ: "does this definition capture the right
   * questions?" is asked many times per version, and a History with an entry
   * per attempt buried the versions that were actually decided among them.
   * The FIRST persist of a create is a major regardless — creating an intent is
   * the decision to have it, so its opening state IS v1. */
  async function persist(
    signal?: AbortSignal,
    force = false,
    specOverride?: { title: string; definition: string; createNew?: boolean },
    opts?: { silent?: boolean }
  ): Promise<number | null> {
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
    // would only regenerate the name it already has. A `silent` restore is
    // exempt — undo returns to a definition that was already named once, and
    // charging it an LLM call to re-offer that name would be absurd.
    const suggestTitle =
      !isCreate && !opts?.silent && !!titleText && defText !== savedRef.current.definition.trim();
    const payload = {
      title: autoTitle ? undefined : titleText,
      definition: defText,
      autoTitle,
      ...(suggestTitle ? { suggestTitle: true } : {}),
      // ONLY a Save is a version — including the first one. A create used to
      // record v1 on its opening Apply, which left the instructor looking at a
      // result they liked and a Save button that was already greyed out: the
      // version existed, but nothing on screen said so, and the rhythm the rest
      // of the workbench teaches (Apply to try, Save to keep) had an exception
      // at exactly the moment it was being learned.
      recordVersion: !opts?.silent && force,
      stats,
      // A create lands as a DRAFT (is_template), which is what keeps "not saved"
      // honest: the row has to exist for the ratings to hang on it, but until
      // Save it is off the board, out of every type's chain, and — the part that
      // matters — not something a student's question can be routed to. Save
      // flips it, and that flip is what the server reads as the intent's
      // creation. It carries its PLACEMENT either way: the scope it was invoked
      // from is its parent, and its rule is seeded from that scope (§3.2/§3.5).
      ...(isCreate
        ? {
            isTemplate: true,
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
   * Commit the reviewed fold: write the definition(s) the instructor left in the
   * modal, retire the decisions the verification showed it carries, and hold the
   * rest — atomically. The new definition makes every rating stale, so the next
   * Apply re-rates against it, and that pass is what can let a held decision go.
   */
  async function applyFold(
    edited: Record<number, string>,
    split: { consume: number[]; hold: number[] },
    renames: Record<number, string> = {}
  ) {
    if (!foldProposals || intentId === null) return;
    setFoldBusy(true);
    setFoldError(null);
    try {
      const applies = foldProposals.map((p) => ({
        intentId: p.intentId,
        definition: (edited[p.intentId] ?? p.after).trim(),
        // An explicit tick in the review wins; otherwise the old rule stands
        // (auto-title only an intent that has no name of its own yet).
        ...(renames[p.intentId]
          ? { title: renames[p.intentId] }
          : p.intentId === intentId && p.suggestedTitle && !title.trim()
            ? { title: p.suggestedTitle }
            : {}),
      }));
      const res = await fetch(
        `/api/instructor/assignments/${assignmentId}/score/intents/${intentId}/fold`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // EVERY decision this fold was given, not just the ones the new text
          // reproduces. Nothing is consumed any more, so there is no "kept
          // back" list: a decision the definition cannot say yet is still a
          // decision the fold took in, and it stays in the ledger either way.
          body: JSON.stringify({
            applies,
            correctionIds: [...split.consume, ...split.hold],
          }),
        }
      );
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof d?.message === 'string' ? d.message : 'Failed to apply the definition.');
      }
      if (!mountedRef.current) return;
      const mine = applies.find((a) => a.intentId === intentId);
      if (mine) {
        // The fold is the largest edit the definition ever takes, so it is the
        // one most worth being able to walk back from — and it has to record
        // the step ITSELF: the re-rate below runs from a savedRef this function
        // has already moved forward, so by the time apply() looks for a change
        // there is none to see. Without this the undo button sat there empty
        // after the very edit it exists for. (The text comes back; the
        // decisions the fold consumed stay consumed — undo walks definitions,
        // not the teaching ledger.)
        const beforeFold = { ...savedRef.current };
        setDefinition(mine.definition);
        // The definition IS saved — mirror it into savedRef so the workbench
        // does not read the fold as an unapplied edit and demand a re-Apply of
        // text it just wrote.
        savedRef.current = { ...savedRef.current, definition: mine.definition };
        if (mine.title) setTitle(mine.title);
        if (beforeFold.definition.trim() && beforeFold.definition !== mine.definition) {
          setPast((p) => [...p, beforeFold]);
          setFuture([]);
        }
      }
      setFoldProposals(null);
      setFoldOpen(false);
      // The corrections are gone and the ratings now belong to an older
      // definition: reload rows (markers, cleared pills) and history.
      await fetchRatings(intentId, new AbortController().signal);
      loadVersions(intentId);
      setSimilarScores(null);
      setBaselineNonce((n) => n + 1);
      // …then re-rate, without being asked. A fold exists to change which
      // questions the definition captures, and the ONLY thing that shows
      // whether it did — whether the teaching held — is the pass against the
      // new text. Leaving that behind a button asked the instructor to press
      // Apply on a decision they had already made, and until they did, every
      // number on screen described the definition the fold had just replaced.
      // Passed explicitly: `definition` state has not flushed yet.
      if (mine) {
        void apply({ title: mine.title ?? title.trim(), definition: mine.definition });
      }
    } catch (e) {
      if (mountedRef.current) setFoldError((e as Error).message);
    } finally {
      if (mountedRef.current) setFoldBusy(false);
    }
  }

  /**
   * Re-teach one decision from inside the review: replace its reason and fold
   * again. Costs another fold, which is why it is offered once per decision —
   * but it is the one retry that is not a re-roll, because the instructor is
   * answering the classifier's stated reading rather than guessing.
   */
  async function reteachCorrection(c: FoldCorrectionView, reason: string) {
    if (intentId === null) return;
    setFoldError(null);
    try {
      const res = await fetch(
        `/api/instructor/assignments/${assignmentId}/score/intents/${intentId}/pins`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // Typed in the review modal, in answer to the classifier's stated
          // reading — always the instructor's own words, never a suggestion.
          body: JSON.stringify({
            messageId: c.messageId,
            verdict: c.verdict,
            reason,
            reasonSource: { kind: 'custom' },
          }),
        }
      );
      if (!res.ok) throw new Error('Could not save the new reason.');
      await fetchRatings(intentId, new AbortController().signal);
    } catch (e) {
      if (mountedRef.current) setFoldError((e as Error).message);
      return;
    }
    // Fold again from the rewritten reason. openFoldReview owns the loading
    // state, so the modal shows its own wait rather than freezing.
    await openFoldReview();
  }

  /** Take a decision back — the instructor read the classifier's reading and
   * decided it was right. Withdrawing here deletes the correction outright; the
   * modal keeps it struck through so the change is visible where it was made. */
  async function withdrawCorrection(c: FoldCorrectionView) {
    if (intentId === null) return;
    setFoldError(null);
    try {
      const res = await fetch(
        `/api/instructor/assignments/${assignmentId}/score/intents/${intentId}/pins?messageId=${c.messageId}`,
        { method: 'DELETE' }
      );
      if (!res.ok) throw new Error('Could not withdraw that decision.');
      await fetchRatings(intentId, new AbortController().signal);
    } catch (e) {
      if (mountedRef.current) setFoldError((e as Error).message);
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
    // Counted over what History SHOWS. The revert deletes the minor rows after
    // this point too, but they are not versions anyone was shown, so naming
    // them in the count would only make the number unrecognizable.
    const laterCount = majors.filter((x) => x.versionNo > checkout).length;
    const label = target ? versionLabel(target) : `v${checkout}`;
    if (
      !window.confirm(
        `Revert to ${label}?\n\nThis makes ${label} the live version and permanently deletes the ${laterCount} version(s) saved after it, along with any unsaved work. This cannot be undone.`
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
  async function togglePin(
    row: RatingRow,
    verdict: 'in' | 'out',
    reason?: string,
    /** Where the reason text came from — see the route's `reasonSource`. */
    reasonSource?: { kind: 'suggested' | 'edited' | 'custom'; index?: number }
  ) {
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
                ...(nextReason && reasonSource ? { reasonSource } : {}),
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

  /**
   * Commit the correction with the chosen/typed reason (blank = no reason).
   *
   * Also settles where the words came from. A suggestion clicked as offered,
   * one clicked and then edited, and one typed from scratch all arrive here as
   * the same string, and only this moment can still tell them apart — which is
   * why it is recorded rather than reconstructed later by matching text.
   */
  function pickReason(reason: string) {
    if (!reasonPicker) return;
    const row = data?.rows.find((r) => r.messageId === reasonPicker.messageId);
    const verdict = reasonPicker.verdict;
    const text = reason.trim();
    const offered = reasonPicker.reasons;
    const exact = offered.findIndex((r) => r.trim() === text);
    const source =
      text.length === 0
        ? undefined
        : exact >= 0
          ? ({ kind: 'suggested', index: exact } as const)
          : ({ kind: 'custom' } as const);
    setReasonPicker(null);
    if (row) togglePin(row, verdict, text || undefined, source);
  }

  // Two instructor-facing buckets — the 4 internal rating levels stay hidden:
  //  · IN THIS INTENT = the EFFECTIVE membership: pinned in, or clearly_in with
  //    no pin (pin overrides rating, §1.6). Pinning a row therefore never makes
  //    it vanish from here — its button just reads active (toggle to undo).
  //  · POTENTIAL QUESTIONS = the model-uncertain, still-undecided (unpinned) ones.
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
          ? data.rows.filter((r) => scopeSet.has(r.messageId) || r.decision !== null)
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
  // The potential list is the probably-IN side alone. Making an intent is settling
  // where its boundary runs, and the questions that test a boundary are the ones
  // just inside it; probably-out (and the legacy unsure/unrated rows) are a
  // longer list that mostly restates what the definition already excludes. They
  // return by widening the definition, which is the move that actually claims
  // them — not by labelling one at a time.
  const needsDecision = useMemo(
    () => scopedRows.filter((r) => r.rating === 'probably_in' && reaches(r)),
    [scopedRows]
  );
  /**
   * THE LEDGER — every question this instructor has ruled on, in one list.
   *
   * It used to be three lists (waiting · held · absorbed), which is three names
   * for one thing plus the answer to one question. The question is `holds`, and
   * it is the only thing the instructor has to read: a decision the definition
   * cannot say is one to re-explain, move somewhere else, or withdraw, and a
   * decision it can say needs nothing.
   */
  const decisions = useMemo(
    () => (data ? data.rows.filter((r) => r.decision !== null) : []),
    [data]
  );
  /** Ruled on, and the definition has drifted off it — the list that acts. */
  const brokenDecisions = useMemo(
    () => decisions.filter((r) => r.decision?.holds === false),
    [decisions]
  );
  /** Ruled on since the last fold. What "Update definition" is here to teach. */
  const newDecisions = useMemo(
    () => decisions.filter((r) => r.decision?.status === 'pending'),
    [decisions]
  );
  /** Reading order for the ledger: what needs something, first. */
  const rank = (r: RatingRow) =>
    r.decision?.holds === false ? 0 : r.decision?.holds === null ? 1 : 2;
  const holdingCount = useMemo(
    () => decisions.filter((r) => r.decision?.holds === true).length,
    [decisions]
  );
  const pinnedIn = useMemo(() => decisions.filter((r) => r.pinned === 'in'), [decisions]);
  const pinnedOut = useMemo(() => decisions.filter((r) => r.pinned === 'out'), [decisions]);
  /** Every question ruled OUT of this intent. What the spin-off is offered on:
   * they have left this intent but not the scope around it, so they still need
   * an intent to answer them. */
  const outDecisions = pinnedOut;
  // ---- Membership diff vs the baseline version --------------------------
  // Membership is the JUDGMENT — what the deployed chatbot would do. A pending
  // correction is not membership: it is a request for the definition to change,
  // and counting it here would report an intent as already fixed while students
  // still get the old routing.
  const effectiveIn = (rowsIn: RatingRow[]) =>
    new Set(rowsIn.filter(isMember).map((r) => r.messageId));
  const effectiveInNow = useMemo(() => (data ? effectiveIn(data.rows) : new Set<number>()), [data]);

  // The version the diff is anchored to: the latest SAVE by default — so the
  // panes always answer "what has changed since I last recorded this?" — or the
  // one picked via "diff" in History. Baseline membership loads from the same
  // hash-keyed version store the checkout uses (instant, zero LLM).
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

  // Entered/left since the baseline. Both are rendered INTO the list rather
  // than into strips above it — see `diffRows`.
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
  const leftSet = useMemo(() => new Set(leftRows.map((r) => r.messageId)), [leftRows]);
  /** Which verdict a row can newly take: the pane's direction, except that a
   * question which has LEFT the intent can only be pulled back in — it is
   * already out, so an out button there would be a no-op, and this row is the
   * only place it can be reached at all. */
  const pinDirection = (r: RatingRow, pane: 'in' | 'nd'): 'in' | 'out' =>
    pane === 'nd' || leftSet.has(r.messageId) ? 'in' : 'out';
  /**
   * "In this intent" as a DIFF: the members, plus the questions that left,
   * sorted together by whatever order the pane is in.
   *
   * The two used to be collapsible strips pinned above the list, which put the
   * changes where they could be read but not where they happened — a question
   * that dropped out appeared at the top, far from the neighbours that explain
   * why. Merging them and colouring in place is the git-diff reading: the list
   * is the set, and the additions and removals sit in it.
   */
  const diffRows = useMemo(
    () => (leftRows.length > 0 ? [...inThisIntent, ...leftRows] : inThisIntent),
    [inThisIntent, leftRows]
  );
  const diffBaseLabel = useMemo(() => {
    if (!baseline) return null;
    const v = versions?.find((x) => x.versionNo === baseline.versionNo);
    return v ? versionLabel(v) : `v${baseline.versionNo}`;
  }, [baseline, versions]);

  // History is the SAVED versions, one line each. Minor rows still exist in
  // older data (and the fold writes one to date its markers), but they were
  // never the story — they were the attempts between the versions — and reading
  // them meant expanding an accordion over every save.
  const majors = useMemo(() => (versions ?? []).filter((v) => !v.minor), [versions]);

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
  const versionEntry = (v: IntentVersion) => {
    const active = v.versionNo === checkout;
    // The newest version is the live spec ONLY while there is no unsaved work —
    // otherwise the draft row above holds "current", and this becomes an
    // ordinary checkout of the last thing that was recorded.
    const isLive = latestMajor?.versionNo === v.versionNo && !savePending;
    const highlighted = active || (checkout === null && isLive);
    const isDiffBase = v.versionNo === diffBaseNo;
    const activate = () => {
      if (busy || saving) return;
      if (active || isLive) backToLatest();
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
          isLive
            ? 'The live version — click to return to it'
            : `${v.title ? `${v.title} — ` : ''}${v.definition ?? ''}\n${[
                `included ${v.included}`,
                `excluded ${v.excluded}`,
                v.stats ? `in this intent ${v.stats.inCount}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}\n\n${absoluteTime} — click to view this state (loads instantly)`
        }
        className={`group w-full cursor-pointer text-left rounded border px-2 py-1.5 text-xs ${
          highlighted
            ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5'
            : 'border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/40'
        } ${busy || saving ? 'opacity-50 pointer-events-none' : ''}`}
      >
        {/* ONE line — the definition and label counts live in the row tooltip.
            Version-shy instructors read "v2 · saved · 2h ago", nothing more. */}
        <div className="flex items-center justify-between gap-2 text-[hsl(var(--muted-foreground))]">
          <span className="shrink-0 font-mono" title={`config v${v.versionNo}`}>
            {versionLabel(v)}
            {isLive && checkout === null && (
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
      </div>
    );
  };

  // One question row — query text (click to open its full conversation in this
  // pane) + the model's short rationale + its pin button. `diff` colours the
  // row against the base version: 'new' entered since it, 'left' is gone from
  // the intent and rendered in place of where it used to sit.
  const renderRow = (r: RatingRow, pane: 'in' | 'nd', diff?: 'new' | 'left') => {
    // Buttons stay visible on PINNED rows too (active state, click to undo) —
    // a label never strips a row of its controls, only membership moves it.
    const showButtons = checkout === null;
    // Potential-questions drift chip: only rows whose standing CHANGED since the
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
    // The marked row wins the border: it is where you are, and a diff colour
    // that overrode it would lose the place you came back to.
    const rail = marked
      ? 'border-l-[hsl(var(--ring))] bg-[hsl(var(--muted))]/60'
      : diff === 'new'
        ? 'border-l-emerald-400 bg-emerald-50/50 hover:bg-emerald-50'
        : diff === 'left'
          ? 'border-l-rose-400 bg-rose-50/50 hover:bg-rose-50'
          : 'border-l-transparent hover:bg-[hsl(var(--muted))]/40';
    return (
      <li
        key={r.messageId}
        ref={marked ? (el) => { markedRowRef.current[pane] = el; } : undefined}
        title={
          marked
            ? 'The conversation you last opened'
            : diff === 'new'
              ? `Not in this intent at ${diffBaseLabel} — it has entered since`
              : diff === 'left'
                ? `In this intent at ${diffBaseLabel} — it has left since`
                : undefined
        }
        className={`group relative px-3 py-2 border-l-2 ${rail}`}
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
            {/* WHERE THE DECISION STANDS — one line, one bit.
                There were three sentences here, in three vocabularies
                (waiting · held · you marked this), for what is really a single
                question: does the definition say this by itself? */}
            {r.decision && (
              <p
                className={`mt-1 text-xs font-medium ${
                  r.decision.holds === false
                    ? 'text-amber-700'
                    : r.decision.holds === true
                      ? 'text-[hsl(var(--muted-foreground))]'
                      : 'text-[hsl(var(--primary))]'
                }`}
              >
                you: {r.decision.verdict}{' '}
                {r.decision.holds === false ? (
                  <>
                    ✕ · the definition says {r.decision.verdict === 'in' ? 'out' : 'in'} — yours
                    routes it meanwhile
                  </>
                ) : r.decision.holds === true ? (
                  <>✓</>
                ) : r.decision.status === 'pending' ? (
                  <>· not folded in yet</>
                ) : (
                  <>· re-apply to check it held</>
                )}
                {r.decision.taughtCount > 1 && (
                  <span
                    className="ml-1 font-normal text-[hsl(var(--muted-foreground))]"
                    title="How many folds have had to take this decision in. More than one means the definition keeps losing it — this question may want an intent of its own."
                  >
                    · taught {r.decision.taughtCount}×
                  </span>
                )}
              </p>
            )}
            {/* The classifier's own reading — SHOWN WHERE IT IS ACTIONABLE.
                On an undecided question it is the evidence for ruling either
                way; on a decision the definition has drifted off it is the
                evidence for how to re-explain, and the reason the amber line
                above is not simply "wrong". Everywhere else it is the machine
                agreeing with a settled question, so it waits behind a toggle
                rather than adding a line to every row. */}
            {(r.rationale || drift) &&
              (!r.decision || r.decision.holds === false ? (
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
              ) : (
                <details className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
                  <summary className="cursor-pointer list-none hover:text-[hsl(var(--foreground))]">
                    ▸ why
                  </summary>
                  <p className="mt-0.5 flex flex-wrap items-baseline gap-1.5">
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
                </details>
              ))}
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
            {pinButtons(r, pinDirection(r, pane))}
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
  // ONE verdict per row, in the direction that settles the boundary there: "In
  // this intent" is the list you carve members OUT of, "Potential questions" the one
  // you pull members IN from. Offering both everywhere made every row a two-way
  // question when only one way moves the boundary. The opposite verdict still
  // renders when it is already pinned — that pill is the only way to withdraw
  // the label, and a label with no undo is a trap.
  const pinButtons = (row: RatingRow, dir: 'in' | 'out') => {
    const showIn = dir === 'in' || row.pinned === 'in';
    const showOut = dir === 'out' || row.pinned === 'out';
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
              {pinButtons(ratingRow, pinDirection(ratingRow, pane))}
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
  /** The last version anyone recorded — what Save is asked to move past. */
  const latestMajor = versions?.find((v) => !v.minor) ?? null;
  // …and being up to date is not by itself a reason to save. `applied` is true
  // precisely when everything is current, which on its own left Save enabled
  // forever, writing a second version identical to the first. So the question
  // is the word processor's: does the working draft differ from what is
  // recorded? Title is left out — a rename is applied without a version of its
  // own (acceptTitleSuggestion), so comparing it would light Save for a change
  // that is already saved.
  //
  // A new intent has nothing recorded at all, so everything about it is
  // unsaved: Save is what brings it into being, and it is lit from the first
  // Apply onwards.
  const savePending =
    versions !== null &&
    (latestMajor === null
      ? savedRef.current.definition.trim().length > 0
      : (latestMajor.definition ?? '').trim() !== savedRef.current.definition.trim());

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
                <span className="flex items-center gap-0.5">
                {/* Undo/redo walk the definitions applied this session. Free —
                    each one's ratings are already stored under its own hash —
                    so stepping back is instant and costs no LLM call. */}
                <button
                  onClick={() => void undo()}
                  disabled={!canUndo}
                  title={
                    canUndo
                      ? `Undo — back to the definition applied before this one (instant; ${past.length} step${past.length === 1 ? '' : 's'} back)`
                      : 'Nothing to undo — this is the first definition applied in this session'
                  }
                  aria-label="Undo"
                  className="rounded p-1 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <Undo2 className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => void redo()}
                  disabled={!canRedo}
                  title={canRedo ? 'Redo — forward again (instant)' : 'Nothing to redo'}
                  aria-label="Redo"
                  className="rounded p-1 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <Redo2 className="h-3.5 w-3.5" />
                </button>
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
                            ? // Apply IS persistent — saying otherwise is what made
                              // leaving-after-Apply feel like loss. It is just not a
                              // version yet, which is what Save is for.
                              'Rate every question against this definition — kept as the working draft, until Save records it as a version'
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
                </span>
              }
            />

            {/* THE LEDGER — every question this instructor has ruled on, and
                the one thing worth reading about each: does the definition say
                it by itself?

                This was three blocks (waiting · held · absorbed), which named
                one thing three ways and put the answer nowhere. The counter is
                the point: a definition rewritten for one question re-judges
                every question, so decisions already settled come back the other
                way, and until now nothing counted them. */}
            {decisions.length > 0 && checkout === null && (
              <div className="rounded border border-[hsl(var(--primary))]/40 bg-[hsl(var(--primary))]/5 px-2.5 py-2">
                <p className="flex items-baseline justify-between gap-2 text-xs font-semibold text-[hsl(var(--foreground))]">
                  <span>Your decisions · {decisions.length}</span>
                  <span className="font-normal">
                    <span className="text-[hsl(var(--muted-foreground))]">{holdingCount} hold</span>
                    {brokenDecisions.length > 0 && (
                      <span className="ml-1.5 font-semibold text-amber-700">
                        {brokenDecisions.length} don’t
                      </span>
                    )}
                  </span>
                </p>
                <ul className="mt-1.5 space-y-1">
                  {/* The ones that need something first. */}
                  {[...decisions]
                    .sort((a, b) => rank(a) - rank(b))
                    .slice(0, 6)
                    .map((r) => (
                      <li key={r.messageId} className="text-xs leading-snug">
                        <span
                          className={`font-semibold ${
                            r.pinned === 'in' ? 'text-emerald-700' : 'text-rose-700'
                          }`}
                        >
                          {r.pinned}
                        </span>{' '}
                        <span className="text-[hsl(var(--foreground))]">
                          {r.queryText.replace(/\s+/g, ' ').trim().slice(0, 60)}
                          {r.queryText.length > 60 ? '…' : ''}
                        </span>{' '}
                        <span
                          className={
                            r.decision?.holds === false
                              ? 'font-semibold text-amber-700'
                              : 'text-[hsl(var(--muted-foreground))]'
                          }
                          title={
                            r.decision?.holds === false
                              ? 'The definition does not reproduce this. Yours routes the question meanwhile.'
                              : r.decision?.holds === true
                                ? 'The definition says this by itself.'
                                : 'Not checked yet — apply the definition.'
                          }
                        >
                          {r.decision?.holds === false
                            ? '✕'
                            : r.decision?.holds === true
                              ? '✓'
                              : '…'}
                        </span>
                        {(r.decision?.taughtCount ?? 0) > 1 && (
                          <span className="ml-1 text-[hsl(var(--muted-foreground))]">
                            taught {r.decision?.taughtCount}×
                          </span>
                        )}
                      </li>
                    ))}
                  {decisions.length > 6 && (
                    <li className="text-xs text-[hsl(var(--muted-foreground))]">
                      + {decisions.length - 6} more
                    </li>
                  )}
                </ul>
                <button
                  onClick={openFoldReview}
                  disabled={refining || busy || saving || !openaiConfigured}
                  title={
                    !openaiConfigured
                      ? 'OPENAI_API_KEY is not configured'
                      : 'Rewrite the definition from ALL of these decisions — the result is checked against the classifier, and you review it before anything changes'
                  }
                  className="mt-2 inline-flex items-center gap-1.5 rounded bg-[hsl(var(--primary))] px-2 py-1 text-xs font-semibold text-[hsl(var(--primary-foreground))] disabled:opacity-50"
                >
                  {refining ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Wand2 className="h-3 w-3" />
                  )}
                  Update definition
                  {newDecisions.length > 0 && ` · ${newDecisions.length} to teach`}
                </button>
                {/* Ruling questions out is also finding a pile with no home.
                    The button is HERE, on that pile, because that is what
                    decides where the new intent lands: these questions left
                    this intent but stayed inside whatever encloses it, so the
                    only place they can be answered is beside it. */}
                {onSpinOff && outDecisions.length > 0 && (
                  <button
                    onClick={() =>
                      guardLeave(() =>
                        onSpinOff(
                          outDecisions.map((r) => ({ text: r.queryText, reason: r.reason }))
                        )
                      )
                    }
                    disabled={busy || saving || refining}
                    title={`Draft a new intent for the ${outDecisions.length} question${
                      outDecisions.length === 1 ? '' : 's'
                    } you ruled out — it lands beside this one, where they can actually be answered`}
                    className="mt-1.5 inline-flex items-center gap-1 rounded border border-dashed border-[hsl(var(--primary))]/60 px-2 py-1 text-xs font-medium text-[hsl(var(--primary))] hover:border-solid hover:bg-[hsl(var(--primary))]/10 disabled:opacity-50"
                  >
                    <Plus className="h-3 w-3" />
                    New intent from {outDecisions.length} ruled out
                  </button>
                )}
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
            {/* Save lives in this header, so the block has to be here for a
                new intent too — which has no versions yet, and is exactly the
                state Save exists to leave. */}
            {(majors.length > 0 || savePending) && (
              <div className="space-y-1.5 border-t border-[hsl(var(--border))] pt-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                    History
                    {checkout !== null && (
                      <span className="ml-1.5 normal-case font-normal text-amber-700">
                        viewing{' '}
                        {(() => {
                          const v = majors.find((x) => x.versionNo === checkout);
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
                        const v = majors.find((x) => x.versionNo === checkout);
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
                                : latestMajor === null
                                  ? 'Create this intent — it goes on the board, and this state becomes v1'
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
                  {latestMajor === null
                    ? 'This intent is not on the board yet — Save creates it, and leaving discards it.'
                    : 'Every saved version is a snapshot you can click to revisit.'}
                </p>
                <ul className="space-y-1.5">
                  {/* The working draft — applied but not recorded. It sits
                      where the next version will, so Save reads as "write this
                      down" rather than "do something to the list". */}
                  {savePending && (
                    <li>
                      <div
                        {...(checkout !== null
                          ? {
                              role: 'button',
                              tabIndex: 0,
                              onClick: backToLatest,
                              onKeyDown: (e: React.KeyboardEvent) => {
                                if (e.key !== 'Enter' && e.key !== ' ') return;
                                e.preventDefault();
                                void backToLatest();
                              },
                            }
                          : {})}
                        className={`rounded border border-dashed px-2 py-1.5 text-xs ${
                          checkout === null
                            ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5'
                            : 'cursor-pointer border-[hsl(var(--border))] opacity-70 hover:opacity-100 hover:bg-[hsl(var(--muted))]/40'
                        }`}
                        title={
                          checkout !== null
                            ? 'Your unsaved work — click to come back to it'
                            : latestMajor === null
                              ? 'Applied, but not saved — this intent does not exist on the board until you Save it.'
                              : 'The definition you have applied but not saved. It is the live spec either way; Save records it as the next version.'
                        }
                      >
                        <div className="flex items-center justify-between gap-2 text-[hsl(var(--muted-foreground))]">
                          <span className="shrink-0 font-mono">
                            —
                            {checkout === null && (
                              <span className="ml-1 rounded bg-[hsl(var(--primary))]/10 px-1 py-px font-sans text-[11px] font-semibold text-[hsl(var(--primary))]">
                                current
                              </span>
                            )}
                          </span>
                          <span className="min-w-0 flex-1 truncate">working — not saved yet</span>
                        </div>
                      </div>
                    </li>
                  )}
                  {majors.map((v) => (
                    <li key={v.versionNo}>{versionEntry(v)}</li>
                  ))}
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
                      {brokenDecisions.length > 0 && (
                        <span
                          className="rounded border border-amber-300 bg-amber-50 px-1 py-0.5 font-normal normal-case text-amber-800"
                          title={
                            'Decisions the definition does not reproduce. Yours route those questions meanwhile — re-explain, move them to their own intent, or withdraw.'
                          }
                        >
                          ⚠ {brokenDecisions.length} not in the definition
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
                        // The counts are already readable in the list below (the
                        // coloured rows); this opens the two sides on their own,
                        // for when the question is "what changed" rather than
                        // "what is in here".
                        <button
                          onClick={() => setDiffOpen(true)}
                          className="inline-flex items-center gap-1 rounded border border-[hsl(var(--border))] px-1 py-0.5 font-normal normal-case text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
                          title={`Show what entered and left since ${diffBaseLabel}, side by side (the diff base — pick another in History)`}
                        >
                          <GitCompareArrows className="w-3 h-3" />
                          <span className={newlyIn && newlyIn.size > 0 ? 'text-emerald-700 font-medium' : ''}>
                            +{newlyIn?.size ?? 0}
                          </span>
                          <span className={leftRows.length > 0 ? 'text-rose-700 font-medium' : ''}>
                            −{leftRows.length}
                          </span>
                          <span>vs {diffBaseLabel}</span>
                        </button>
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
                  {(() => {
                    // Members and departures in ONE sorted list, coloured in
                    // place — the diff is read where the questions sit, not in
                    // a strip above them.
                    const sorted = sortRows(diffRows, inSort, inSearch);
                    return sorted.length > 0 ? (
                      <ul className="divide-y divide-[hsl(var(--border))]/60">
                        {sorted.map((r) =>
                          renderRow(
                            r,
                            'in',
                            leftSet.has(r.messageId)
                              ? 'left'
                              : newlyIn?.has(r.messageId)
                                ? 'new'
                                : undefined
                          )
                        )}
                      </ul>
                    ) : (
                      <p className="p-4 text-sm text-[hsl(var(--muted-foreground))]">
                        {inSearch
                          ? 'No matching question.'
                          : busy
                            ? 'Rating the log — captured questions appear here as they land…'
                            : 'Nothing captured yet — pull in the potential questions on the right.'}
                      </p>
                    );
                  })()}
                </div>
              </div>
            </>
          )}
        </div>

        {/* RIGHT — Potential questions (model-uncertain; pulled IN one at a time) */}
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
                      Potential questions in this intent · {needsDecision.length}
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
                            : 'No potential questions — every question is settled.'}
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
            // EVERY decision — the fold reads the whole ledger, so the waiting
            // view must list the whole ledger or it would show fewer than the
            // fold is about to work on.
            corrections: decisions.map((r) => ({
              id: r.decision?.id ?? r.messageId,
              messageId: r.messageId,
              verdict: (r.pinned ?? 'in') as 'in' | 'out',
              queryText: r.queryText,
              reason: r.reason,
              standing: r.decision?.status === 'taught',
              taughtCount: r.decision?.taughtCount ?? 0,
            })),
          }}
          busy={foldBusy}
          error={foldError}
          onApply={applyFold}
          onReteach={reteachCorrection}
          onWithdraw={withdrawCorrection}
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

      {/* MEMBERSHIP DIFF — entered and left since the base version, each side
          on its own. Read-only: the labelling happens in the list underneath,
          where these same rows sit coloured. */}
      {diffOpen && baseline && (
        <div
          className="fixed inset-0 z-[65] flex items-center justify-center bg-black/30 p-4"
          onClick={() => setDiffOpen(false)}
        >
          <div
            className="flex max-h-[80vh] w-full max-w-4xl flex-col rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[hsl(var(--border))] px-4 py-2.5">
              <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">
                What changed since {diffBaseLabel}
                <span className="ml-2 font-normal text-xs text-[hsl(var(--muted-foreground))]">
                  in “{title.trim() || 'this intent'}” · compare against another version from History
                </span>
              </h3>
              <button
                onClick={() => setDiffOpen(false)}
                className="rounded p-1 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid min-h-0 flex-1 grid-cols-1 gap-px overflow-hidden bg-[hsl(var(--border))] md:grid-cols-2">
              {(
                [
                  {
                    key: 'left' as const,
                    rows: leftRows,
                    head: `Left this intent · ${leftRows.length}`,
                    tone: 'text-rose-700',
                    note: `In this intent at ${diffBaseLabel}, not any more`,
                  },
                  {
                    key: 'new' as const,
                    rows: newlyIn ? inThisIntent.filter((r) => newlyIn.has(r.messageId)) : [],
                    head: `New in this intent · ${newlyIn?.size ?? 0}`,
                    tone: 'text-emerald-700',
                    note: `Not in this intent at ${diffBaseLabel}; it has entered since`,
                  },
                ]
              ).map((side) => (
                <div key={side.key} className="flex min-h-0 flex-col bg-[hsl(var(--card))]">
                  <div className="shrink-0 border-b border-[hsl(var(--border))] px-3 py-1.5">
                    <p className={`text-xs font-semibold uppercase tracking-wide ${side.tone}`}>
                      {side.head}
                    </p>
                    <p className="text-xs text-[hsl(var(--muted-foreground))]">{side.note}</p>
                  </div>
                  <ul className="min-h-0 flex-1 divide-y divide-[hsl(var(--border))]/60 overflow-y-auto">
                    {side.rows.map((r) => (
                      <li key={r.messageId} className="px-3 py-2">
                        <p className="whitespace-pre-wrap break-words text-sm text-[hsl(var(--foreground))]">
                          {r.queryText.replace(/\s+/g, ' ').trim()}
                        </p>
                        {r.rationale && (
                          <p className="mt-1 text-xs italic text-[hsl(var(--muted-foreground))]">
                            {r.rationale}
                          </p>
                        )}
                      </li>
                    ))}
                    {side.rows.length === 0 && (
                      <li className="px-3 py-4 text-sm text-[hsl(var(--muted-foreground))]">
                        Nothing on this side.
                      </li>
                    )}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
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
                <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">
                  {leaveLoss() === 'intent' ? 'This intent isn’t saved' : 'Untried edits'}
                </h3>
                <p className="mt-1.5 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">
                  {leaveLoss() === 'intent'
                    ? 'You applied it, but never saved it — leaving discards the whole intent, along with the questions it gathered. Save it first to put it on the board.'
                    : intentId !== null
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
                    {leaveLoss() === 'intent' ? 'Discard this intent' : 'Discard edits'}
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
