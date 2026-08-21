'use client';

/**
 * The simple version's board — one page, three columns, and nothing else.
 *
 * Left is the configuration and its history, middle is every question, right
 * is the conversation. There is no workbench to open, no creation dialog, no
 * search, no filter, no sort. Everything is written and checked without the
 * screen changing, because the loop this version exists to make cheap is
 * "change one line, look at what it did" and every navigation charged to that
 * loop is charged to every repetition of it (docs/SCORE_SIMPLE_DESIGN.md §1).
 *
 * Three verbs, and they are three because the loop needs two speeds.
 *
 *   APPLY is the fast one, next to whatever is being edited. It takes effect —
 *   the routing re-settles, the answers regenerate — and adds nothing to the
 *   history, so trying six wordings costs six clicks and leaves one line.
 *
 *   SAVE marks the point. It is what the history lists, what a restore returns
 *   to, and what the study measures. Nothing is measured that was not saved,
 *   which is why the board says so plainly once the two have drifted apart and
 *   why a block cannot end while they have.
 *
 *   REVERT throws away the applies since the last save. Trying things has to
 *   be as cheap to undo as it was to do.
 *
 * Save and Revert sit with the history rather than in an editor, because both
 * act on the whole configuration and a button inside one intent that quietly
 * committed the other five would be lying about its scope. No Deploy: a save
 * is the whole of publishing here.
 *
 * The configuration is a flat list in the order it is tried, and an intent is
 * usually started FROM a question: the row's + opens the form directly above
 * whichever intent owns that question now, and pins the question so it stays
 * on screen. Position is therefore a promise the board can keep on its own —
 * whatever the new words turn out to describe, they are read first. Whether
 * they describe that question is a verdict, and the board waits for it rather
 * than arranging for the answer it advertised.
 *
 * The screen states facts and does not interpret them. A question that matches
 * the intent you have open but is answered by an earlier one says "applied:
 * that other one" in the same neutral chip every other row uses; it does not
 * get a warning colour, an icon, or a queue to be resolved. Finding the
 * problem, and deciding whether it is one, is the participant's work and is
 * what we are here to watch (§1-4).
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { ConversationThread } from '../conversation';
import { QuerySnippet } from '../materials';
import type { ScoreQueryRow } from '../IntentBoard';
import StarterPicker from './StarterPicker';
import RulePicker, { type RuleSource } from './RulePicker';
import IntentHistory, { type IntentVersion } from './IntentHistory';
import { intentColor } from './colors';
import { logUi, useSurfaceLog } from '@/lib/study/ui-log';
import {
  insertBefore,
  moveIntent,
  removeIntent,
  unsavedNote,
  type SimpleIntent,
  type SimpleSnapshot,
} from '@/lib/study/simple/chain';
import type { SimpleVersion } from '@/lib/study/simple/store';
import { STUDY_PROMPT_CHAR_LIMIT } from '@/lib/study/config';

interface Owner {
  sid: number | null;
  outcome: 'intent' | 'root' | 'pending';
  matchedElsewhere: number[];
}

interface StatePayload {
  arm: 'score' | 'baseline';
  snapshot: SimpleSnapshot;
  versions: SimpleVersion[];
  /** Every version, newest first — what the conversation can be read under. */
  moments: SimpleVersion[];
  viewing: SimpleVersion | null;
  atTip: boolean;
  pinned: number[];
  owners: Record<string, Owner>;
  counts: Record<string, number>;
  judged: number;
  pending: number;
  /** The newest SAVE — what the study measures. Null if they never saved. */
  savedVersionNo: number | null;
  /** Something took effect that the newest save does not carry. */
  dirty: boolean;
  /** Which intents differ from the last save (0 = everything else). */
  unsavedSids: number[];
  /** sid → that intent's own history, newest first ('0' = everything else). */
  intentVersions: Record<string, IntentVersion[]>;
  /** The write's own follow-up work is still running on the server. */
  working: boolean;
  diff: { sid: number | null; entered: number[]; left: number[] }[] | null;
}

/**
 * The draft, with any title the server filled in while it was open.
 *
 * Returns the same object when there is nothing to take, so a poll that
 * changed nothing does not re-render the column it is polling for.
 */
function withFilledTitles(draft: SimpleSnapshot, server: SimpleSnapshot): SimpleSnapshot {
  const fromServer = new Map(server.intents.map((i) => [i.sid, i.title]));
  let changed = false;
  const intents = draft.intents.map((intent) => {
    if (intent.title.trim().length > 0) return intent;
    const title = (fromServer.get(intent.sid) ?? '').trim();
    if (title.length === 0) return intent;
    changed = true;
    return { ...intent, title };
  });
  return changed ? { ...draft, intents } : draft;
}

/** What the middle column is showing. */
type Selection = { kind: 'all' } | { kind: 'root' } | { kind: 'intent'; sid: number };

/** An intent being written, and where it will land. */
interface Creating {
  /** Tried before this one; null = last, just above the uncategorized rule. */
  beforeSid: number | null;
  /** What the rule box starts as — the rule those questions get today. */
  seedRule: string;
  /** The question it was started from, when it was started from one. */
  fromMessageId: number | null;
  fromQuestion: string | null;
}

export default function SimpleStudio({
  assignmentId,
  rows,
  reviewSet,
  isNirvana,
  initialState,
  viewParam,
}: {
  assignmentId: string;
  /** The whole log — kept whole so a conversation can be read in full. */
  rows: ScoreQueryRow[];
  /** The curated questions, or null when this assignment has no curated set.
   * A study master carries the earlier turns of each thread as well, and those
   * are context to read, not material to organize. */
  reviewSet: number[] | null;
  isNirvana: boolean;
  initialState: StatePayload;
  /** Set only when a researcher opened this with ?view= on an assignment that
   * is not a clone. It tells the routes which arm the preview is; on a real
   * clone the clone decides and this is ignored. */
  viewParam?: string | null;
}) {
  const [state, setState] = useState<StatePayload>(initialState);
  const [draft, setDraft] = useState<SimpleSnapshot>(initialState.snapshot);
  const [selection, setSelection] = useState<Selection>({ kind: 'all' });
  const [expanded, setExpanded] = useState<number | 'root' | null>(null);
  const [creating, setCreating] = useState<Creating | null>(null);
  const [query, setQuery] = useState('');
  const [selectedMessageId, setSelectedMessageId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [judging, setJudging] = useState(false);
  const [diffFrom, setDiffFrom] = useState<number | null>(null);
  const [localVersionNo, setLocalVersionNo] = useState<number | null>(null);

  const rowById = useMemo(() => new Map(rows.map((r) => [r.messageId, r])), [rows]);
  // What the board is ABOUT. Every list, count and pin works off this; only
  // the viewer reads `rows`.
  const material = useMemo(() => {
    if (!reviewSet) return rows;
    const ids = new Set(reviewSet);
    return rows.filter((r) => ids.has(r.messageId));
  }, [reviewSet, rows]);
  const arm = state.arm;
  const readOnly = !state.atTip;
  const api = useCallback(
    (path: string, query = '') => {
      const params = new URLSearchParams(query);
      if (viewParam) params.set('view', viewParam);
      const qs = params.toString();
      return `/api/instructor/assignments/${assignmentId}/score/simple/${path}${qs ? `?${qs}` : ''}`;
    },
    [assignmentId, viewParam]
  );

  /* --------------------------------------------------------------- */
  /* Loading state                                                    */
  /* --------------------------------------------------------------- */

  const load = useCallback(
    async (opts?: { versionNo?: number | null; diffFrom?: number | null; keepDraft?: boolean }) => {
      const params = new URLSearchParams();
      const versionNo = opts?.versionNo === undefined ? state.viewing?.versionNo ?? null : opts.versionNo;
      if (versionNo != null) params.set('versionNo', String(versionNo));
      const df = opts?.diffFrom === undefined ? diffFrom : opts.diffFrom;
      if (df != null) params.set('diffFrom', String(df));
      const res = await fetch(api('state', params.toString()));
      if (!res.ok) return null;
      const next: StatePayload = await res.json();
      setState(next);
      // `keepDraft` exists so a poll cannot overwrite what someone is in the
      // middle of typing — but a title generated after the write lands in the
      // server's copy and nowhere else, and the tree reads the draft. Filling
      // only the blanks is the whole of the exception: a box being typed into
      // is not blank, so nothing anyone wrote can be lost this way.
      if (opts?.keepDraft) setDraft((d) => withFilledTitles(d, next.snapshot));
      else setDraft(next.snapshot);
      return next;
    },
    [api, diffFrom, state.viewing?.versionNo]
  );

  /* --------------------------------------------------------------- */
  /* Judging: the counts fill in while they read                      */
  /* --------------------------------------------------------------- */

  const judgeRef = useRef(false);
  const runJudge = useCallback(async () => {
    if (judgeRef.current || arm !== 'score') return;
    judgeRef.current = true;
    setJudging(true);
    try {
      for (let round = 0; round < 40; round += 1) {
        const res = await fetch(api('judge'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // What is on screen first, so the list being read fills in before
            // the tail of the log does.
          body: JSON.stringify({
            priorityMessageIds: [...state.pinned, ...material.slice(0, 40).map((r) => r.messageId)],
          }),
        });
        if (!res.ok) break;
        const progress = await res.json();
        await load({ keepDraft: true });
        if (progress.remaining === 0 || progress.ratedThisBatch === 0) break;
      }
    } finally {
      judgeRef.current = false;
      setJudging(false);
    }
  }, [api, arm, load, material, state.pinned]);

  // Anything unjudged gets judged, without being asked for — a "Run" button
  // here would be handing the participant the machine to operate.
  //
  // Unless the save that caused it is already doing the same work, in which
  // case this waits and re-reads. Two passes over the same questions would
  // each find the cache empty and each pay for every verdict.
  useEffect(() => {
    if (state.pending === 0 || !state.atTip) return;
    if (!state.working) {
      void runJudge();
      return;
    }
    const timer = setTimeout(() => void load({ keepDraft: true }), 1200);
    return () => clearTimeout(timer);
  }, [state.pending, state.atTip, state.working, runJudge, load]);

  /* --------------------------------------------------------------- */
  /* Saving                                                           */
  /* --------------------------------------------------------------- */

  const write = useCallback(
    async (
      next: SimpleSnapshot,
      focusSid: number | null,
      kind: 'apply' | 'save',
      /** The question a brand-new intent was carved out of. Rides along with
       * the write that creates it and is written once, server-side, beside
       * the snapshot rather than in it. */
      seed?: { sid: number; messageId: number } | null
    ) => {
      setSaving(true);
      const previousVersion = state.versions[0]?.versionNo ?? null;
      try {
        const res = await fetch(api('save'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind,
            prompt: next.prompt,
            rootRule: next.rootRule,
            intents: seed
              ? next.intents.map((i) =>
                  i.sid === seed.sid ? { ...i, seedMessageId: seed.messageId } : i
                )
              : next.intents,
            focusSid,
            recentMessageIds: selectedMessageId ? [selectedMessageId] : [],
          }),
        });
        if (!res.ok) return;
        // Against the version that WAS current, so the list shows what this
        // save moved — the only comparison a participant did not have to ask
        // for and the only one they can act on.
        setDiffFrom(previousVersion);
        setLocalVersionNo(null);
        await load({ versionNo: null, diffFrom: previousVersion });
      } finally {
        setSaving(false);
      }
    },
    [api, load, selectedMessageId, state.versions]
  );

  /** Take effect. The verb every editor carries. */
  const apply = useCallback(
    (
      next: SimpleSnapshot,
      focusSid: number | null,
      seed?: { sid: number; messageId: number } | null
    ) => write(next, focusSid, 'apply', seed),
    [write]
  );

  /**
   * Mark what is in effect as a version. The verb the study reads.
   *
   * Commits the applied state, not the editors' contents — otherwise Save
   * would quietly apply whatever was half-typed and Apply would become the
   * step you could skip.
   */
  const saveVersion = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch(api('commit'), { method: 'POST' });
      if (!res.ok) return;
      await load({ versionNo: null });
    } finally {
      setSaving(false);
    }
  }, [api, load]);

  /** Throw away the applies since the last save. */
  const revert = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch(api('revert'), { method: 'POST' });
      if (!res.ok) return;
      setDiffFrom(null);
      setLocalVersionNo(null);
      await load({ versionNo: null, diffFrom: null });
    } finally {
      setSaving(false);
    }
  }, [api, load]);

  const restore = useCallback(
    async (versionNo: number) => {
      await fetch(api('restore'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versionNo }),
      });
      setDiffFrom(null);
      setLocalVersionNo(null);
      await load({ versionNo: null, diffFrom: null });
    },
    [api, load]
  );

  /* --------------------------------------------------------------- */
  /* Pins                                                             */
  /* --------------------------------------------------------------- */

  const togglePin = useCallback(
    async (messageId: number) => {
      const pinned = state.pinned.includes(messageId);
      setState((s) => ({
        ...s,
        pinned: pinned ? s.pinned.filter((m) => m !== messageId) : [messageId, ...s.pinned],
      }));
      await fetch(pinned ? api('pins', `messageId=${messageId}`) : api('pins'), {
        method: pinned ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: pinned ? undefined : JSON.stringify({ messageId }),
      });
    },
    [api, state.pinned]
  );

  const ownerOf = useCallback(
    (messageId: number): Owner | null => state.owners[String(messageId)] ?? null,
    [state.owners]
  );

  /**
   * Start an intent from one question.
   *
   * Three things happen at once and they are three parts of one promise. The
   * question is PINNED, so it survives every later Apply and every change of
   * selection — and since a shelf row carries the same owner chip as any other
   * row, the pin is also the answer to "did my wording catch it". The form
   * opens directly ABOVE whatever owns that question now, so the new words are
   * read first. And the rule box starts as a copy of the rule that question is
   * getting today, so applying before the rule is rewritten changes nothing.
   *
   * What does NOT happen is the question being put in. No verdict is
   * overridden: if the words do not describe it, the chip does not move, and
   * that is a fact to act on rather than a fault to be corrected (§1-4). It is
   * also what keeps the board and the deployed chatbot saying the same thing,
   * since the deployed one has only the words.
   */
  const startIntentFrom = useCallback(
    (messageId: number) => {
      const owner = ownerOf(messageId);
      const beforeSid = owner?.outcome === 'intent' ? owner.sid : null;
      const seedRule =
        (beforeSid == null
          ? draft.rootRule
          : draft.intents.find((i) => i.sid === beforeSid)?.rule) ?? draft.rootRule;
      if (!state.pinned.includes(messageId)) void togglePin(messageId);
      setSelectedMessageId(messageId);
      setExpanded(null);
      setCreating({
        beforeSid,
        seedRule,
        fromMessageId: messageId,
        fromQuestion: rowById.get(messageId)?.queryText ?? null,
      });
      logUi(assignmentId, 'simple_intent_from_query', { messageId, beforeSid });
    },
    [assignmentId, draft.intents, draft.rootRule, ownerOf, rowById, state.pinned, togglePin]
  );

  /* --------------------------------------------------------------- */
  /* What the middle column lists                                     */
  /* --------------------------------------------------------------- */

  /**
   * The order the open intent's questions are listed in, and the examples the
   * order was worked out from.
   *
   * Asked for once per intent rather than folded into the poll: the poll runs
   * every second while judging, and the answer here is worked out from a few
   * hundred embedding vectors. Absent, late or failed, the list keeps the
   * order it already had.
   */
  const [ranked, setRanked] = useState<{ sid: number; order: number[]; examples: string[] } | null>(
    null
  );
  useEffect(() => {
    if (arm !== 'score' || selection.kind !== 'intent') {
      setRanked(null);
      return;
    }
    const sid = selection.sid;
    let cancelled = false;
    (async () => {
      const res = await fetch(
        api('rank', `sid=${sid}${state.viewing && !state.atTip ? `&versionNo=${state.viewing.versionNo}` : ''}`)
      );
      if (!res.ok || cancelled) return;
      const body = await res.json();
      if (!cancelled) {
        setRanked({ sid, order: body.order ?? [], examples: body.examples ?? [] });
      }
    })();
    return () => {
      cancelled = true;
    };
    // `judged` moves as verdicts land, and the list they order changes with it.
  }, [api, arm, selection, state.atTip, state.viewing, state.judged]);

  const diffFor = useCallback(
    (sid: number | null) => state.diff?.find((d) => d.sid === sid) ?? null,
    [state.diff]
  );

  const listed = useMemo(() => {
    if (selection.kind === 'all' || arm === 'baseline') return material;
    if (selection.kind === 'root') {
      return material.filter((r) => ownerOf(r.messageId)?.sid === null);
    }
    // Everything this intent's own definition describes — including the
    // questions an earlier intent takes first. Hiding those would mean the
    // list answered "what does this definition catch" with a number that has
    // already been adjusted for something the participant cannot see.
    const sid = selection.sid;
    const left = new Set(diffFor(sid)?.left ?? []);
    const mine = material.filter((r) => {
      const owner = ownerOf(r.messageId);
      return owner?.sid === sid || owner?.matchedElsewhere.includes(sid) || left.has(r.messageId);
    });
    // Most typical first. The first row a participant reads is what tells them
    // whether the classifier can be trusted, so it should be the least
    // arguable member of the category rather than whichever student happened
    // to ask first. Anything the ranking does not name keeps its place after
    // the ones it does — a partial answer reorders what it knows and leaves
    // the rest alone.
    if (ranked?.sid !== sid || ranked.order.length === 0) return mine;
    const at = new Map(ranked.order.map((id, i) => [id, i]));
    return [...mine].sort(
      (a, b) =>
        (at.get(a.messageId) ?? Number.MAX_SAFE_INTEGER) -
        (at.get(b.messageId) ?? Number.MAX_SAFE_INTEGER)
    );
  }, [arm, diffFor, material, ownerOf, ranked, selection]);

  /**
   * Whatever the middle column is showing, narrowed to the student's own
   * words.
   *
   * It searches WITHIN the current selection rather than across the log,
   * because that is what the header above it says it is showing and a box
   * that silently changed the subject would be worse than no box. The empty
   * state says how many the rest of the log holds, so "none here" cannot be
   * read as "none anywhere".
   *
   * Only the question. Not the reply, which is generated and would make the
   * results move when a rule changed; and not the intent titles, which are
   * the participant's own labels and are searchable by eye in a list of six.
   */
  const searched = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return listed;
    return listed.filter((r) => r.queryText.toLowerCase().includes(needle));
  }, [listed, query]);

  const elsewhereCount = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return 0;
    const here = new Set(searched.map((r) => r.messageId));
    return material.filter(
      (r) => !here.has(r.messageId) && r.queryText.toLowerCase().includes(needle)
    ).length;
  }, [material, query, searched]);

  // Logged once the typing settles, not per keystroke: what the analysis wants
  // is which words someone went looking for, and "g", "gr", "gra" is not that.
  useEffect(() => {
    const needle = query.trim();
    if (needle.length < 2) return;
    const timer = setTimeout(() => {
      logUi(assignmentId, 'simple_search', { term: needle.slice(0, 60) });
    }, 900);
    return () => clearTimeout(timer);
  }, [assignmentId, query]);

  const pinnedRows = useMemo(
    () => state.pinned.map((id) => rowById.get(id)).filter((r): r is ScoreQueryRow => !!r),
    [rowById, state.pinned]
  );

  const selectedRow = selectedMessageId ? rowById.get(selectedMessageId) ?? null : null;

  /* --------------------------------------------------------------- */
  /* Reading                                                          */
  /* --------------------------------------------------------------- */

  useSurfaceLog(
    assignmentId,
    'scope_view',
    'scope_leave',
    selection.kind === 'intent' ? `simple:intent:${selection.sid}` : `simple:${selection.kind}`
  );
  useSurfaceLog(assignmentId, 'query_open', 'query_close', selectedMessageId);

  const title = (sid: number | null) =>
    sid == null
      ? 'Uncategorized'
      : draft.intents.find((i) => i.sid === sid)?.title.trim() ||
        state.snapshot.intents.find((i) => i.sid === sid)?.title.trim() ||
        'Untitled';

  return (
    <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)_minmax(0,1.05fr)] gap-3">
      <ConfigColumn
        api={api}
        arm={arm}
        draft={draft}
        setDraft={setDraft}
        state={state}
        readOnly={readOnly}
        saving={saving}
        judging={judging}
        selection={selection}
        setSelection={setSelection}
        expanded={expanded}
        setExpanded={setExpanded}
        creating={creating}
        setCreating={setCreating}
        rankedExamples={ranked}
        onApply={apply}
        onSaveVersion={saveVersion}
        onRevert={revert}
        onRestore={restore}
        onView={(versionNo) => {
          setLocalVersionNo(null);
          void load({ versionNo, diffFrom: null });
          setDiffFrom(null);
          // Looking back at an older version changes nothing and would
          // otherwise leave no trace at all.
          logUi(assignmentId, 'simple_version_view', { versionNo });
        }}
        assignmentId={assignmentId}
      />

      <QuestionColumn
        rows={searched}
        pinnedRows={pinnedRows}
        allCount={material.length}
        query={query}
        setQuery={setQuery}
        elsewhereCount={elsewhereCount}
        selection={selection}
        selectedMessageId={selectedMessageId}
        onSelect={setSelectedMessageId}
        onTogglePin={togglePin}
        onCreateIntent={readOnly || arm === 'baseline' ? null : startIntentFrom}
        pinned={state.pinned}
        ownerOf={ownerOf}
        titleOf={title}
        diff={diffFor(selection.kind === 'intent' ? selection.sid : selection.kind === 'root' ? null : null)}
        arm={arm}
        judging={judging}
      />

      <ViewerColumn
        api={api}
        rows={rows}
        row={selectedRow}
        isNirvana={isNirvana}
        moments={state.moments}
        viewingVersionNo={state.viewing?.versionNo ?? null}
        localVersionNo={localVersionNo}
        setLocalVersionNo={setLocalVersionNo}
        onLocalVersionLog={(versionNo) =>
          logUi(assignmentId, 'simple_local_version_view', {
            versionNo,
            messageId: selectedMessageId,
          })
        }
        titleOf={title}
      />
    </div>
  );
}

/* =================================================================== */
/* Left: the configuration                                             */
/* =================================================================== */

function ConfigColumn({
  api,
  arm,
  draft,
  setDraft,
  state,
  readOnly,
  saving,
  judging,
  selection,
  setSelection,
  expanded,
  setExpanded,
  creating,
  setCreating,
  rankedExamples,
  onApply,
  onSaveVersion,
  onRevert,
  onRestore,
  onView,
  assignmentId,
}: {
  api: (path: string, query?: string) => string;
  arm: 'score' | 'baseline';
  draft: SimpleSnapshot;
  setDraft: (s: SimpleSnapshot) => void;
  state: StatePayload;
  readOnly: boolean;
  saving: boolean;
  judging: boolean;
  selection: Selection;
  setSelection: (s: Selection) => void;
  expanded: number | 'root' | null;
  setExpanded: (e: number | 'root' | null) => void;
  creating: Creating | null;
  setCreating: (c: Creating | null) => void;
  rankedExamples: { sid: number; examples: string[] } | null;
  onApply: (
    next: SimpleSnapshot,
    focusSid: number | null,
    seed?: { sid: number; messageId: number } | null
  ) => Promise<void>;
  onSaveVersion: () => Promise<void>;
  onRevert: () => Promise<void>;
  onRestore: (versionNo: number) => Promise<void>;
  onView: (versionNo: number | null) => void;
  assignmentId: string;
}) {
  const countOf = (sid: number | null) => state.counts[sid === null ? 'root' : String(sid)] ?? 0;
  const unsaved = new Set(state.unsavedSids);

  return (
    <div className="min-h-0 flex flex-col gap-3">
      <section className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
        {readOnly && (
          <div className="sticky top-0 z-10 px-3 py-2 bg-[hsl(var(--muted))] border-b border-[hsl(var(--border))] flex items-center justify-between gap-2">
            <span className="text-xs text-[hsl(var(--muted-foreground))]">
              Looking at v{state.viewing?.displayNo}. Editing happens on the latest one.
            </span>
            <div className="flex gap-1.5">
              <button
                onClick={() => state.viewing && void onRestore(state.viewing.versionNo)}
                className="text-xs font-semibold px-2 py-1 rounded border border-[hsl(var(--border))] bg-[hsl(var(--card))] hover:bg-[hsl(var(--background))]"
              >
                Restore this version
              </button>
              <button
                onClick={() => onView(null)}
                className="text-xs font-semibold px-2 py-1 rounded border border-[hsl(var(--border))] bg-[hsl(var(--card))] hover:bg-[hsl(var(--background))]"
              >
                Latest
              </button>
            </div>
          </div>
        )}

        {arm === 'baseline' ? (
          <PromptEditor
            draft={draft}
            setDraft={setDraft}
            readOnly={readOnly}
            saving={saving}
            onApply={() => onApply(draft, null)}
          />
        ) : (
          <Tree
            api={api}
            intentVersions={state.intentVersions}
            unsaved={unsaved}
            draft={draft}
            setDraft={setDraft}
            readOnly={readOnly}
            saving={saving}
            judging={judging}
            selection={selection}
            setSelection={setSelection}
            expanded={expanded}
            setExpanded={setExpanded}
            creating={creating}
            setCreating={setCreating}
            onApply={onApply}
            onSaveVersion={onSaveVersion}
            onRevert={onRevert}
            dirty={state.dirty}
            savedVersionNo={state.savedVersionNo}
            countOf={countOf}
            rankedExamples={rankedExamples}
            assignmentId={assignmentId}
          />
        )}
      </section>

      {/* Save sits beside Apply and Revert sits with the history, inside
          whichever editor is open — the two verbs act where the thing they act
          on is being edited. This is what is left for the moments no editor is
          open: a deletion, or an apply whose card has since been closed. It is
          the same act reached from the one place it is still reachable from,
          not a second copy of it. */}
      {(arm === 'baseline' || expanded === null) && (
      <SaveBar
        dirty={state.dirty}
        hasSave={state.savedVersionNo != null}
        note={unsavedNote(state)}
        readOnly={readOnly}
        saving={saving}
        onSaveVersion={onSaveVersion}
        onRevert={onRevert}
      />
      )}
      {arm === 'baseline' && (
        <VersionList
          versions={state.versions}
          viewingVersionNo={state.viewing?.versionNo ?? null}
          onView={onView}
        />
      )}
    </div>
  );
}

/** The baseline arm's whole configuration: one document, edited in place. */
function PromptEditor({
  draft,
  setDraft,
  readOnly,
  saving,
  onApply,
}: {
  draft: SimpleSnapshot;
  setDraft: (s: SimpleSnapshot) => void;
  readOnly: boolean;
  saving: boolean;
  onApply: () => void;
}) {
  return (
    <div className="p-3 flex flex-col gap-2 h-full">
      <div className="flex items-baseline justify-between">
        <span className="text-2xs font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
          Rules
        </span>
        <span className="text-2xs tabular-nums text-[hsl(var(--muted-foreground))]">
          {draft.prompt.length} / {STUDY_PROMPT_CHAR_LIMIT}
        </span>
      </div>
      <textarea
        value={draft.prompt}
        readOnly={readOnly}
        maxLength={STUDY_PROMPT_CHAR_LIMIT}
        onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
        placeholder="What the chatbot should do, in your own words."
        className="flex-1 min-h-[24rem] w-full resize-none rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-3 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))] disabled:opacity-60"
      />
      {!readOnly && (
        <button
          onClick={onApply}
          disabled={saving}
          title="Put this into effect and see what it answers"
          className="self-end inline-flex items-center gap-1.5 rounded-lg bg-[hsl(var(--primary))] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Apply
        </button>
      )}
    </div>
  );
}

/** The score arm's configuration: one root, a tree under it, editors inline. */
/**
 * The configuration: the intents in the order they are tried, and the rule for
 * whatever none of them claim.
 *
 * Flat, and the order is the whole of the structure — a question goes to the
 * first intent whose words describe it, reading downwards. Intents used to
 * nest, and nesting only ever meant "tried before its parent, and only within
 * what its parent caught": the first half is what a position in a list already
 * says, and the second half was an AND between two texts that were judged
 * apart and never appeared together, so a definition's own words did not say
 * what it caught.
 *
 * The uncategorized rule is drawn last because that is where it is reached. It
 * used to be drawn first, directly above a sentence explaining that the list
 * reads downwards, so the picture contradicted the caption.
 */
function Tree({
  api,
  intentVersions,
  unsaved,
  draft,
  setDraft,
  readOnly,
  saving,
  judging,
  selection,
  setSelection,
  expanded,
  setExpanded,
  creating,
  setCreating,
  onApply,
  onSaveVersion,
  onRevert,
  dirty,
  savedVersionNo,
  countOf,
  rankedExamples,
  assignmentId,
}: {
  api: (path: string, query?: string) => string;
  /** sid → that intent's own history, newest first. */
  intentVersions: Record<string, IntentVersion[]>;
  /** Intents that differ from the last save (0 = the uncategorized rule). */
  unsaved: Set<number>;
  draft: SimpleSnapshot;
  setDraft: (s: SimpleSnapshot) => void;
  readOnly: boolean;
  saving: boolean;
  judging: boolean;
  selection: Selection;
  setSelection: (s: Selection) => void;
  expanded: number | 'root' | null;
  setExpanded: (e: number | 'root' | null) => void;
  creating: Creating | null;
  setCreating: (c: Creating | null) => void;
  onApply: (
    next: SimpleSnapshot,
    focusSid: number | null,
    seed?: { sid: number; messageId: number } | null
  ) => Promise<void>;
  onSaveVersion: () => Promise<void>;
  onRevert: () => Promise<void>;
  /** Something is in effect that the newest save does not carry. */
  dirty: boolean;
  savedVersionNo: number | null;
  countOf: (sid: number | null) => number;
  /** The hypothetical questions the open intent's order was worked out from. */
  rankedExamples: { sid: number; examples: string[] } | null;
  assignmentId: string;
}) {
  /**
   * The rules written elsewhere in this configuration, for the reuse picker.
   *
   * `except` keeps a rule from offering itself back — the root when editing
   * the root, an intent when editing that intent.
   */
  const ruleSources = (except: number | 'root' | null): RuleSource[] => [
    ...(except === 'root'
      ? []
      : [
          {
            key: 'root',
            title: 'Uncategorized',
            rule: draft.rootRule,
            count: countOf(null),
          },
        ]),
    ...draft.intents
      .filter((i) => i.sid !== except)
      .map((i) => ({
        key: String(i.sid),
        title: i.title.trim() || 'Untitled',
        rule: i.rule,
        count: countOf(i.sid),
      })),
  ];

  /** Which title is open for editing. One at a time, like the editors. */
  const [renaming, setRenaming] = useState<number | null>(null);

  const patch = (sid: number, fields: Partial<SimpleIntent>) =>
    setDraft({
      ...draft,
      intents: draft.intents.map((i) => (i.sid === sid ? { ...i, ...fields } : i)),
    });

  /* The form is rendered at the position the intent will occupy, so where it
     goes needs no explaining beyond the one line naming what it is tried
     before. */
  const form = (beforeTitle: string) =>
    creating && !readOnly ? (
      <div className="pb-2">
        <NewIntent
          api={api}
          ruleSources={ruleSources(null)}
          creating={creating}
          beforeTitle={beforeTitle}
          draft={draft}
          onCancel={() => setCreating(null)}
          onCreate={(next, sid, seed) => {
            // Closed on the way out, not on the way back: leaving the form
            // open after a save invites a second click that writes the same
            // intent again.
            setCreating(null);
            return onApply(next, sid, seed);
          }}
        />
      </div>
    ) : null;

  const renderIntent = (intent: SimpleIntent, at: number) => {
    const open = expanded === intent.sid;
    return (
      <li key={intent.sid}>
        <div
          className={`group flex items-center gap-1.5 pl-2 pr-2 py-1 rounded-lg cursor-pointer ${
            selection.kind === 'intent' && selection.sid === intent.sid
              ? 'bg-[hsl(var(--primary))]/8'
              : 'hover:bg-[hsl(var(--muted))]'
          }`}
          onClick={() => {
            setSelection({ kind: 'intent', sid: intent.sid });
            setExpanded(open ? null : intent.sid);
            setCreating(null);
            if (!open) logUi(assignmentId, 'intent_open', { sid: intent.sid });
          }}
        >
          {open ? (
            <ChevronDown className="w-3.5 h-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
          )}
          {/* The same dot the question rows carry, so a colour seen in the
              list can be found here without reading anything. */}
          <span
            aria-hidden
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ backgroundColor: intentColor(intent.sid) }}
          />
          {/* One title, in the one place it is already shown — the editor used
              to carry a second box with the same words in it. It reads as text
              until asked for: a box standing open says "fill me in" about the
              one thing here that names itself. */}
          {renaming === intent.sid && !readOnly ? (
            <input
              value={intent.title}
              maxLength={120}
              autoFocus
              placeholder="Name it"
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => patch(intent.sid, { title: e.target.value })}
              onBlur={() => setRenaming(null)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === 'Escape') setRenaming(null);
                e.stopPropagation();
              }}
              className="min-w-0 flex-1 rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-1.5 py-0.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
            />
          ) : (
            // Directly after the words it acts on, and holding its place
            // whether or not it is showing, so the title does not resize under
            // the pointer. It used to sit past the flex spacer, an inch away
            // and touching the count, which made it look like a control for
            // the number.
            <span className="min-w-0 flex items-center">
              <span className="truncate text-sm">{intent.title.trim() || 'Untitled'}</span>
              {!readOnly && (
                <button
                  title="Rename"
                  onClick={(e) => {
                    e.stopPropagation();
                    setRenaming(intent.sid);
                  }}
                  className="shrink-0 ml-1 p-0.5 rounded opacity-0 group-hover:opacity-100 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--background))]"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              )}
            </span>
          )}
          <span className="flex-1" />
          {/* Which one, not just whether. Plain and unstyled: this is a fact
              about what the next step will read, not a fault to fix. */}
          {unsaved.has(intent.sid) && (
            <span className="shrink-0 text-2xs text-[hsl(var(--muted-foreground))]">unsaved</span>
          )}
          {/* Order is meaning here: the first intent that matches a question
              answers it. So it is a control, not a preference.

              It reserves its width instead of appearing into the row, and it
              sits INSIDE the count rather than outside it: the count is the
              one thing on this row worth comparing down the column, so it
              stays pinned to the same edge whether or not the pointer is
              here. What gives way is the empty space after the title. */}
          {!readOnly && (
            <span className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
              <OrderButton
                disabled={at <= 0}
                label="Answer earlier"
                glyph="↑"
                onClick={() =>
                  void onApply(
                    { ...draft, intents: moveIntent(draft.intents, intent.sid, -1) },
                    intent.sid
                  )
                }
              />
              <OrderButton
                disabled={at >= draft.intents.length - 1}
                label="Answer later"
                glyph="↓"
                onClick={() =>
                  void onApply(
                    { ...draft, intents: moveIntent(draft.intents, intent.sid, 1) },
                    intent.sid
                  )
                }
              />
            </span>
          )}
          <Count value={countOf(intent.sid)} />
        </div>

        {open && (
          <div
            className="ml-[1.05rem] pl-2.5 pr-2 pb-3 pt-1 border-l"
            style={{
              // Tinted by the row rather than painted in its colour: at full
              // strength a 2px bar competed with everything it was there to
              // organise.
              borderColor: `color-mix(in srgb, ${intentColor(intent.sid)} 30%, transparent)`,
            }}
          >
            <Accordion
              api={api}
              examples={rankedExamples?.sid === intent.sid ? rankedExamples.examples : []}
              assignmentId={assignmentId}
              ruleSources={ruleSources(intent.sid)}
              versions={intentVersions[String(intent.sid)] ?? []}
              intent={intent}
              readOnly={readOnly}
              saving={saving}
              dirty={dirty}
              savedVersionNo={savedVersionNo}
              onSaveVersion={onSaveVersion}
              onRevert={onRevert}
              onChange={(fields) => patch(intent.sid, fields)}
              onApply={() => onApply(draft, intent.sid)}
              onDelete={() =>
                void onApply(
                  { ...draft, intents: removeIntent(draft.intents, intent.sid) },
                  null
                ).then(() => setExpanded(null))
              }
            />
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="p-2">
      <ul>
        {draft.intents.map((intent, at) => (
          <Fragment key={intent.sid}>
            {creating?.beforeSid === intent.sid && (
              <li className="ml-[1.05rem] pl-2.5 pr-2">
                {form(intent.title.trim() || 'Untitled')}
              </li>
            )}
            {renderIntent(intent, at)}
          </Fragment>
        ))}
      </ul>

      {/* Last place in the order, which is also where the button that adds one
          from nothing sits — so the button is standing where its intent will
          be. Asking `creating?.beforeSid == null` would be true when nothing
          is being created at all, and the button would never appear. */}
      {creating ? (
        creating.beforeSid == null && (
          <div className="my-1.5 ml-[1.05rem] pl-2.5 pr-2">{form('Uncategorized')}</div>
        )
      ) : (
        !readOnly && (
          // The same row as the intents it sits among, because it is the place
          // one of them will go. It used to be a dashed pill at a different
          // width, height and indent — which read as a control attached to the
          // list rather than a position in it, and read quietly enough to be
          // missed. The plus takes the chevron's place and the ring takes the
          // colour dot's, so the words line up with every title above it.
          <button
            onClick={() => {
              setCreating({
                beforeSid: null,
                seedRule: draft.rootRule,
                fromMessageId: null,
                fromQuestion: null,
              });
              setExpanded(null);
            }}
            /* The same box as an intent row — same width, same left edge, so
               its words line up with every title above — but dashed and
               without a fill, so neither the row nor its hover can be taken
               for one of them. The border is paid for out of the padding, so
               the height still matches. Set apart from both neighbours,
               because it is a different kind of thing standing between two
               lists of the same kind. */
            className="my-1.5 w-full flex items-center gap-1.5 pl-2 pr-2 py-[3px] rounded-lg border border-dashed border-[hsl(var(--border))] text-left text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
          >
            <Plus className="w-3.5 h-3.5 shrink-0" />
            <span
              aria-hidden
              className="w-1.5 h-1.5 rounded-full shrink-0 border border-current opacity-60"
            />
            <span className="flex-1 text-sm">New intent</span>
          </button>
        )
      )}

      {/* Last, because it is last: whatever no intent above claimed lands
          here. It is a rule with no "when", because its when is what is
          left. */}
      <div
        className={`flex items-center gap-1.5 px-2 py-1 rounded-lg cursor-pointer ${
          selection.kind === 'root' ? 'bg-[hsl(var(--primary))]/8' : 'hover:bg-[hsl(var(--muted))]'
        }`}
        onClick={() => {
          setSelection({ kind: 'root' });
          setExpanded(expanded === 'root' ? null : 'root');
          setCreating(null);
        }}
      >
        {expanded === 'root' ? (
          <ChevronDown className="w-3.5 h-3.5 text-[hsl(var(--muted-foreground))]" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-[hsl(var(--muted-foreground))]" />
        )}
        {/* Grey, and the same grey the list uses for a question no intent
            claimed — so the key is complete: every dot in the list has a row
            here to match it to. */}
        <span
          aria-hidden
          className="w-1.5 h-1.5 rounded-full shrink-0 bg-[hsl(var(--muted-foreground))]"
        />
        <span className="flex-1 text-sm font-semibold">Uncategorized</span>
        {unsaved.has(0) && (
          <span className="shrink-0 text-2xs text-[hsl(var(--muted-foreground))]">unsaved</span>
        )}
        {judging && <Loader2 className="w-3 h-3 animate-spin text-[hsl(var(--muted-foreground))]" />}
        <Count value={countOf(null)} />
      </div>

      {expanded === 'root' && (
        <div className="ml-[1.05rem] pl-2.5 pr-2 pb-3 pt-1 border-l border-[hsl(var(--border))] space-y-3">
          <Field
            label="Then"
            control={
              !readOnly && (
                <RulePicker
                  sources={ruleSources('root')}
                  onPick={(rule) => setDraft({ ...draft, rootRule: rule })}
                />
              )
            }
          >
            <textarea
              value={draft.rootRule}
              readOnly={readOnly}
              maxLength={STUDY_PROMPT_CHAR_LIMIT}
              onChange={(e) => setDraft({ ...draft, rootRule: e.target.value })}
              className={FIELD_BOX + ' min-h-[9rem]'}
            />
          </Field>
          {!readOnly && (
            <div className="flex items-center gap-2">
              <ApplyButton saving={saving} onClick={() => void onApply(draft, null)} />
              {dirty && (
                <button
                  onClick={() => void onSaveVersion()}
                  disabled={saving}
                  title="Keep the whole configuration as a version you can come back to"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[hsl(var(--border))] px-3 py-1.5 text-sm font-semibold hover:bg-[hsl(var(--muted))] disabled:opacity-50"
                >
                  Save
                </button>
              )}
            </div>
          )}
          <IntentHistory
            versions={intentVersions['0'] ?? []}
            currentDefinition=""
            currentRule={draft.rootRule}
            savedVersionNo={savedVersionNo}
            disabled={readOnly}
            onPick={(v) => setDraft({ ...draft, rootRule: v.rule })}
            onRevert={!readOnly && dirty && savedVersionNo != null ? () => void onRevert() : null}
          />
        </div>
      )}
    </div>
  );
}

/**
 * How many questions this rule answers.
 *
 * The number the list is read for, so it holds one column: a fixed slot at the
 * right edge, right-aligned, in figures that are all the same width. It used
 * to be set in the smallest muted type available and to slide left whenever
 * the order controls appeared under the pointer, which is the one moment
 * someone is looking at it.
 */
function Count({ value }: { value: number }) {
  return (
    <span className="shrink-0 min-w-[1.6rem] text-right text-xs font-semibold tabular-nums">
      {value}
    </span>
  );
}

function OrderButton({
  disabled,
  label,
  glyph,
  onClick,
}: {
  disabled: boolean;
  label: string;
  glyph: string;
  onClick: () => void;
}) {
  return (
    <button
      title={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="w-5 h-5 rounded text-xs leading-none text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--background))] disabled:opacity-25"
    >
      {glyph}
    </button>
  );
}

/**
 * One intent, opened: its two texts, both editable, and nothing around them.
 *
 * When and Then are the whole model, and they are shown together because the
 * question a participant is actually asking — does this rule go with these
 * questions — cannot be answered by looking at either alone.
 *
 * No frame. It used to sit in a bordered card, which drew a rectangle inside a
 * rectangle inside the column and filled it with `--card` over `--background`
 * — two tokens with the same value in both themes, so the border was the only
 * thing it contributed. The rule at the end of the list never had one either,
 * so the two editors did not match. What ties this to its row now is a line in
 * the row's own colour, which is the same colour its questions carry in the
 * list, so it identifies as well as connects.
 *
 * The title is not here. It is on the row above, where it was already being
 * shown, and it became editable there rather than being repeated in a box.
 */
function Accordion({
  api,
  examples,
  assignmentId,
  ruleSources,
  versions,
  intent,
  readOnly,
  saving,
  dirty,
  savedVersionNo,
  onChange,
  onApply,
  onSaveVersion,
  onRevert,
  onDelete,
}: {
  api: (path: string, query?: string) => string;
  /** The hypothetical questions this intent's order was worked out from —
   * empty when it was carved out of a real one, which needs no invention. */
  examples: string[];
  assignmentId: string;
  /** Rules written elsewhere in this configuration, for the reuse picker. */
  ruleSources: RuleSource[];
  /** This intent's own history, newest first. */
  versions: IntentVersion[];
  intent: SimpleIntent;
  readOnly: boolean;
  saving: boolean;
  /** Something is in effect that the newest save does not carry. */
  dirty: boolean;
  savedVersionNo: number | null;
  onChange: (fields: Partial<SimpleIntent>) => void;
  onApply: () => void;
  onSaveVersion: () => Promise<void>;
  onRevert: () => Promise<void>;
  onDelete: () => void;
}) {
  return (
    <div className="space-y-3">
      <Field
        label="When a question…"
        control={
          /* Replaces the definition; leaves a name they chose alone. */
          <StarterPicker
            api={api}
            disabled={readOnly}
            onPick={(starter) =>
              onChange({
                definition: starter.definition,
                ...(intent.title.trim() ? {} : { title: starter.title }),
              })
            }
          />
        }
      >
        <textarea
          value={intent.definition}
          readOnly={readOnly}
          maxLength={4000}
          onChange={(e) => onChange({ definition: e.target.value })}
          placeholder="asks for…"
          className={FIELD_BOX + ' min-h-[4.5rem]'}
        />
        <ExampleFold examples={examples} assignmentId={assignmentId} sid={intent.sid} />
      </Field>
      <Field
        label="Then"
        control={
          !readOnly && <RulePicker sources={ruleSources} onPick={(rule) => onChange({ rule })} />
        }
      >
        <textarea
          value={intent.rule}
          readOnly={readOnly}
          maxLength={STUDY_PROMPT_CHAR_LIMIT}
          onChange={(e) => onChange({ rule: e.target.value })}
          placeholder="What the chatbot should do with those questions."
          className={FIELD_BOX + ' min-h-[7rem]'}
        />
      </Field>
      {!readOnly && (
        <div className="flex items-center gap-2">
          <ApplyButton saving={saving} onClick={onApply} />
          {/* Next to the verb it follows. It still writes the WHOLE
              configuration — a version is the whole of it — which is why it
              says so on the way in and why the tree marks every intent the
              save will carry. */}
          {dirty && (
            <button
              onClick={() => void onSaveVersion()}
              disabled={saving}
              title="Keep the whole configuration as a version you can come back to"
              className="inline-flex items-center gap-1.5 rounded-lg border border-[hsl(var(--border))] px-3 py-1.5 text-sm font-semibold hover:bg-[hsl(var(--muted))] disabled:opacity-50"
            >
              Save
            </button>
          )}
          <span className="flex-1" />
          <button
            onClick={onDelete}
            title="Delete this intent"
            className="p-1 rounded text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {/* Under the buttons: this intent's own history, laid out rather than
          hidden behind a number. */}
      <IntentHistory
        versions={versions}
        currentDefinition={intent.definition}
        currentRule={intent.rule}
        savedVersionNo={savedVersionNo}
        disabled={readOnly}
        onPick={(v) => onChange({ definition: v.definition, rule: v.rule })}
        onRevert={!readOnly && dirty && savedVersionNo != null ? () => void onRevert() : null}
      />
    </div>
  );
}

/**
 * The invented questions this intent's list was ordered by, folded away.
 *
 * The list has to be ordered by SOMETHING, and a definition compared against
 * real questions ranks badly — a description and an instance sit in different
 * places — so a small model writes a few questions the description covers and
 * the ordering measures distance from those. Saying so is better than an
 * unexplained order.
 *
 * Folded, and one click from open, because that is the whole difference
 * between an explanation and a writing aid. A list of "questions your
 * description covers" sitting open beside the box is read as a draft to
 * converge on, and converging on machine-written text is the loop this
 * version exists without (§2). Opening it is logged, so the analysis can tell
 * a participant who leaned on it from one who never looked.
 *
 * Absent entirely when the intent was carved out of a real question — that
 * question is the anchor, and it is on the screen already.
 */
function ExampleFold({
  examples,
  assignmentId,
  sid,
}: {
  examples: string[];
  assignmentId: string;
  sid: number;
}) {
  const [open, setOpen] = useState(false);
  if (examples.length === 0) return null;
  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => {
          if (!open) logUi(assignmentId, 'simple_examples_open', { sid });
          setOpen((v) => !v);
        }}
        className="flex items-center gap-1 text-2xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        What this is being compared against
      </button>
      {open && (
        <div className="mt-1 rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-2 py-1.5">
          <p className="text-2xs leading-relaxed text-[hsl(var(--muted-foreground))]">
            Made-up questions your description covers. The list above is ordered by how close each
            real question is to these. They are not part of the configuration.
          </p>
          <ul className="mt-1 space-y-0.5">
            {examples.map((example, i) => (
              <li key={i} className="text-2xs leading-relaxed">
                {example}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Every text box in this column, so they cannot drift apart one at a time. */
const FIELD_BOX =
  'w-full resize-y rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] ' +
  'p-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]';

/** A labelled box, with whatever picker belongs to it on the same line. */
function Field({
  label,
  control,
  children,
}: {
  label: string;
  control?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1 min-h-[1.25rem]">
        <label className="text-2xs font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
          {label}
        </label>
        {control}
      </div>
      {children}
    </div>
  );
}

function ApplyButton({ saving, onClick }: { saving: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={saving}
      title="Put this into effect and see what it answers"
      className="inline-flex items-center gap-1.5 rounded-lg bg-[hsl(var(--primary))] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
    >
      {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
      Apply
    </button>
  );
}

/**
 * Writing a new intent: the left column turns into the form, at the position
 * the intent will occupy, and the rest of the board stays where it is. There
 * is no dialog, because the questions are the material you write a definition
 * from and a dialog would cover them.
 *
 * There is no name field. Naming a category before you have finished
 * describing it is being asked twice for the same thing, so the description is
 * the only thing to write: a starter set brings its own name, and anything
 * else is handed one afterwards, from the words that were actually written
 * (lib/study/simple/titles.ts). The pencil on the row renames it.
 *
 * When it was started from a question, that question is quoted here and kept
 * in the shelf above the list. The quote is context, not a constraint: nothing
 * arranges for it to end up in this intent. The one thing the form can promise
 * without asking anybody is position — this intent is read before the one that
 * has the question now — and that is the only thing the line at the top
 * claims.
 *
 * The rule starts as a copy of the rule those questions are getting today. A
 * blank box would mean the first Apply silently takes a chunk of the log to
 * "no instructions at all", which is a change nobody asked for. It is a copy,
 * not an inheritance: editing it never reaches back.
 */
function NewIntent({
  api,
  ruleSources,
  creating,
  beforeTitle,
  draft,
  onCancel,
  onCreate,
}: {
  api: (path: string, query?: string) => string;
  ruleSources: RuleSource[];
  creating: Creating;
  /** What this one will be tried before. */
  beforeTitle: string;
  draft: SimpleSnapshot;
  onCancel: () => void;
  onCreate: (
    next: SimpleSnapshot,
    focusSid: number | null,
    seed?: { sid: number; messageId: number } | null
  ) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [definition, setDefinition] = useState('');
  const [rule, setRule] = useState(creating.seedRule);
  const [busy, setBusy] = useState(false);

  return (
    <div className="rounded-lg border border-[hsl(var(--primary))]/40 bg-[hsl(var(--background))] p-2.5 space-y-3">
      <p className="text-2xs text-[hsl(var(--muted-foreground))]">
        Read before “{beforeTitle}”.
      </p>
      {creating.fromQuestion && (
        // Kept short and quoted: it is the question that prompted this, sitting
        // where it can be read while the definition is written. It is also
        // pinned above the list, which is where its answer to "did this catch
        // it" shows up.
        <p className="rounded border-l-2 border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-2 py-1 text-2xs leading-relaxed text-[hsl(var(--muted-foreground))]">
          Started from: “{creating.fromQuestion.trim().slice(0, 140)}
          {creating.fromQuestion.trim().length > 140 ? '…' : ''}”
        </p>
      )}
      <Field
        label="When a question…"
        control={
          <StarterPicker
            api={api}
            forMessageId={creating.fromMessageId}
            onPick={(starter) => {
              setDefinition(starter.definition);
              if (!title.trim()) setTitle(starter.title);
            }}
          />
        }
      >
        <textarea
          value={definition}
          autoFocus
          maxLength={4000}
          onChange={(e) => setDefinition(e.target.value)}
          placeholder="asks for…"
          className={FIELD_BOX + ' min-h-[4.5rem]'}
        />
      </Field>
      <Field label="Then" control={<RulePicker sources={ruleSources} onPick={setRule} />}>
        <textarea
          value={rule}
          maxLength={STUDY_PROMPT_CHAR_LIMIT}
          onChange={(e) => setRule(e.target.value)}
          className={FIELD_BOX + ' min-h-[7rem]'}
        />
      </Field>
      <div className="flex items-center gap-2">
        <button
          disabled={busy || definition.trim().length === 0}
          onClick={async () => {
            setBusy(true);
            // A temporary negative id: the server swaps it for one that
            // outlives every later save. Position is decided here and nowhere
            // else — the array the board sends IS the order.
            const tempSid = -Date.now();
            const next: SimpleSnapshot = {
              ...draft,
              intents: insertBefore(
                draft.intents,
                { sid: tempSid, title, definition, rule },
                creating.beforeSid
              ),
            };
            await onCreate(
              next,
              null,
              creating.fromMessageId ? { sid: tempSid, messageId: creating.fromMessageId } : null
            );
            setBusy(false);
          }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[hsl(var(--primary))] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Add
        </button>
        <button
          onClick={onCancel}
          className="text-xs font-semibold px-2 py-1 rounded border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * Every save, newest first.
 *
 * Clicking one shows the whole board as it was then — the questions answered
 * by that configuration, not just its text. Restoring makes it current again
 * and the versions after it leave the list.
 */
/**
 * The two verbs that act on the whole configuration, and they only appear when
 * there is something for them to act on.
 *
 * It used to state the saved/unsaved fact as a standing sentence, which read as
 * furniture — the answer was "everything is saved" almost always, and a line
 * that is almost always the same stops being read. The tree says WHICH intents
 * are unsaved now, which is both more useful and self-explaining, so this is
 * left with the one job the rows cannot do: the buttons, and the sentence for
 * the case where the change was a deletion and there is no row to mark.
 */
function SaveBar({
  dirty,
  hasSave,
  note,
  readOnly,
  saving,
  onSaveVersion,
  onRevert,
}: {
  dirty: boolean;
  hasSave: boolean;
  note: 'saved' | 'changes' | 'deletion';
  readOnly: boolean;
  saving: boolean;
  onSaveVersion: () => Promise<void>;
  onRevert: () => Promise<void>;
}) {
  // Absent when there is nothing to save: a Save that can only ever be greyed
  // out is a question the reader has to answer for themselves.
  if (readOnly || !dirty) return null;
  return (
    <section className="shrink-0 flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2">
      <span className="flex-1 text-2xs leading-snug text-[hsl(var(--muted-foreground))]">
        {note === 'deletion' ? 'A deletion is not saved yet.' : 'Not saved yet.'}
      </span>
      {/* Absent, not disabled, before the first save: there is nowhere to
          revert TO, and a greyed button is still an invitation to work out
          why it will not do anything. */}
      {hasSave && (
        <button
          onClick={() => void onRevert()}
          disabled={saving}
          title="Go back to the last saved version, dropping what you applied since"
          className="shrink-0 rounded border border-[hsl(var(--border))] px-2 py-0.5 text-2xs font-semibold hover:bg-[hsl(var(--muted))] disabled:opacity-40"
        >
          Revert
        </button>
      )}
      <button
        onClick={() => void onSaveVersion()}
        disabled={saving}
        title="Keep this as a version you can come back to"
        className="shrink-0 inline-flex items-center gap-1 rounded bg-[hsl(var(--primary))] px-2.5 py-0.5 text-2xs font-semibold text-white disabled:opacity-40"
      >
        {saving && <Loader2 className="w-3 h-3 animate-spin" />}
        Save
      </button>
    </section>
  );
}

/** The document's history — the baseline arm only, where it is also the
 * configuration's. */
function VersionList({
  versions,
  viewingVersionNo,
  onView,
}: {
  versions: SimpleVersion[];
  viewingVersionNo: number | null;
  onView: (versionNo: number | null) => void;
}) {
  if (versions.length === 0) {
    return (
      <section className="shrink-0 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2">
        <p className="text-2xs text-[hsl(var(--muted-foreground))]">
          Saved versions will appear here.
        </p>
      </section>
    );
  }
  return (
    <section className="shrink-0 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
      <ul className="max-h-[11rem] overflow-y-auto divide-y divide-[hsl(var(--border))]">
        {versions.map((v) => (
          <li key={v.id}>
            <button
              onClick={() => onView(v.versionNo)}
              className={`w-full text-left px-3 py-1.5 hover:bg-[hsl(var(--muted))] ${
                viewingVersionNo === v.versionNo ? 'bg-[hsl(var(--primary))]/8' : ''
              }`}
            >
              <span className="flex items-baseline gap-2">
                <span className="text-2xs font-bold tabular-nums text-[hsl(var(--muted-foreground))]">
                  v{v.displayNo}
                </span>
                <span className="flex-1 truncate text-xs font-medium">
                  {/* Until the name arrives — and forever, if it never does. */}
                  {v.name ?? new Date(v.createdAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </span>
              {v.summary && (
                <span className="block truncate text-2xs text-[hsl(var(--muted-foreground))]">
                  {v.summary}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* =================================================================== */
/* Middle: the questions                                               */
/* =================================================================== */

function QuestionColumn({
  rows,
  pinnedRows,
  allCount,
  query,
  setQuery,
  elsewhereCount,
  selection,
  selectedMessageId,
  onSelect,
  onTogglePin,
  onCreateIntent,
  pinned,
  ownerOf,
  titleOf,
  diff,
  arm,
  judging,
}: {
  rows: ScoreQueryRow[];
  pinnedRows: ScoreQueryRow[];
  allCount: number;
  query: string;
  setQuery: (q: string) => void;
  /** Matches this search has, outside whatever is selected. */
  elsewhereCount: number;
  selection: Selection;
  selectedMessageId: number | null;
  onSelect: (id: number) => void;
  onTogglePin: (id: number) => void;
  /** Null where there is nothing to carve out of — the one-document arm, or
   * an older version being read. */
  onCreateIntent: ((id: number) => void) | null;
  pinned: number[];
  ownerOf: (id: number) => Owner | null;
  titleOf: (sid: number | null) => string;
  diff: { sid: number | null; entered: number[]; left: number[] } | null;
  arm: 'score' | 'baseline';
  judging: boolean;
}) {
  const entered = useMemo(() => new Set(diff?.entered ?? []), [diff]);
  const left = useMemo(() => new Set(diff?.left ?? []), [diff]);
  const pinnedSet = useMemo(() => new Set(pinned), [pinned]);

  // A kept question lives in the shelf above and nowhere else. It used to
  // appear in both, which read as the list having lost its place — the same
  // question twice, a few rows apart, with no way to tell which one was the
  // "real" row.
  const listed = useMemo(
    () => rows.filter((r) => !pinnedSet.has(r.messageId)),
    [pinnedSet, rows]
  );
  const liftedOut = rows.length - listed.length;

  const label =
    selection.kind === 'all' || arm === 'baseline'
      ? 'All questions'
      : selection.kind === 'root'
        ? 'Uncategorized'
        : titleOf(selection.sid);

  return (
    <div className="min-h-0 flex flex-col gap-3">
      {/* Its own box, above the list rather than inside it.
          Keeping a question is not a way of sorting the list — it is taking
          the question OUT of the list so that selecting an intent, switching
          versions or scrolling cannot lose it. A shelf sitting in the list's
          own frame read as the top of the list, which is the one thing it is
          not. */}
      {pinnedRows.length > 0 && (
        <section className="shrink-0 max-h-[13rem] flex flex-col rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-hidden">
          <div className="shrink-0 flex items-baseline gap-2 px-3 py-2 border-b border-[hsl(var(--border))]">
            <span className="text-sm font-semibold">Kept in view</span>
            <span className="text-2xs tabular-nums text-[hsl(var(--muted-foreground))]">
              {pinnedRows.length}
            </span>
            <span className="flex-1" />
            <span className="text-2xs text-[hsl(var(--muted-foreground))]">
              Stays here whatever you have selected
            </span>
          </div>
          <ul className="flex-1 min-h-0 overflow-y-auto">
            {pinnedRows.map((row) => (
              <QuestionRow
                key={`pin-${row.messageId}`}
                row={row}
                selected={selectedMessageId === row.messageId}
                pinned
                owner={ownerOf(row.messageId)}
                titleOf={titleOf}
                showOwner={arm === 'score'}
                tone={null}
                onSelect={onSelect}
                onTogglePin={onTogglePin}
                onCreateIntent={onCreateIntent}
              />
            ))}
          </ul>
        </section>
      )}

      <section className="flex-1 min-h-0 flex flex-col rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-hidden">
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-[hsl(var(--border))]">
        <span className="text-sm font-semibold truncate">{label}</span>
        <span className="text-2xs tabular-nums text-[hsl(var(--muted-foreground))]">
          {rows.length} of {allCount}
        </span>
        {/* Says where the missing rows went, so the number above and the rows
            below cannot look like they disagree. */}
        {liftedOut > 0 && (
          <span className="text-2xs text-[hsl(var(--muted-foreground))]">
            · {liftedOut} kept above
          </span>
        )}
        {judging && (
          <span className="flex items-center gap-1 text-2xs text-[hsl(var(--muted-foreground))]">
            <Loader2 className="w-3 h-3 animate-spin" /> working out where questions go
          </span>
        )}
        <span className="flex-1" />
        {/* An ordinary search box, over the students' own words. Everything
            else on this board is about what the configuration does; this is
            the one control for finding a question you remember. */}
        <label className="shrink-0 relative flex items-center">
          <Search className="pointer-events-none absolute left-1.5 w-3 h-3 text-[hsl(var(--muted-foreground))]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQuery('');
              e.stopPropagation();
            }}
            placeholder="Search questions"
            className="w-40 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] py-1 pl-6 pr-6 text-xs focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
          />
          {query.length > 0 && (
            <button
              type="button"
              aria-label="Clear the search"
              onClick={() => setQuery('')}
              className="absolute right-1 p-0.5 rounded text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </label>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <ul>
          {listed.map((row) => (
            <QuestionRow
              key={row.messageId}
              row={row}
              selected={selectedMessageId === row.messageId}
              pinned={pinnedSet.has(row.messageId)}
              owner={ownerOf(row.messageId)}
              titleOf={titleOf}
              showOwner={arm === 'score'}
              tone={
                entered.has(row.messageId) ? 'entered' : left.has(row.messageId) ? 'left' : null
              }
              highlight={query}
              onSelect={onSelect}
              onTogglePin={onTogglePin}
              onCreateIntent={onCreateIntent}
            />
          ))}
          {listed.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-[hsl(var(--muted-foreground))]">
              {query.trim().length > 0 ? (
                <>
                  {`No question here contains “${query.trim()}”.`}
                  {/* Says where they are, so "none here" cannot be read as
                      "none anywhere" — the box searches what the header above
                      it says it is showing. */}
                  {elsewhereCount > 0 && (
                    <span className="block mt-1 text-2xs">
                      {elsewhereCount === 1
                        ? '1 elsewhere in the log.'
                        : `${elsewhereCount} elsewhere in the log.`}
                    </span>
                  )}
                </>
              ) : rows.length === 0 ? (
                'No questions here yet.'
              ) : (
                'Every question here is kept above.'
              )}
            </li>
          )}
        </ul>
      </div>
      </section>
    </div>
  );
}

function QuestionRow({
  row,
  selected,
  pinned,
  owner,
  titleOf,
  showOwner,
  tone,
  highlight,
  onSelect,
  onTogglePin,
  onCreateIntent,
}: {
  row: ScoreQueryRow;
  selected: boolean;
  pinned: boolean;
  owner: Owner | null;
  titleOf: (sid: number | null) => string;
  showOwner: boolean;
  /** Whether this row moved in or out since the version being compared. */
  tone: 'entered' | 'left' | null;
  /** The search term, marked wherever it appears in the student's words. */
  highlight?: string;
  onSelect: (id: number) => void;
  onTogglePin: (id: number) => void;
  onCreateIntent: ((id: number) => void) | null;
}) {
  return (
    <li
      onClick={() => onSelect(row.messageId)}
      className={`group flex gap-2 px-3 py-2 border-b border-[hsl(var(--border))] cursor-pointer ${
        selected ? 'bg-[hsl(var(--primary))]/8' : 'hover:bg-[hsl(var(--muted))]'
      } ${
        // Green for what moved in, red for what moved out, and nothing else
        // read into either.
        tone === 'entered'
          ? 'border-l-2 border-l-emerald-400'
          : tone === 'left'
            ? 'border-l-2 border-l-rose-400 opacity-60'
            : ''
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-2xs font-mono text-[hsl(var(--muted-foreground))]">
            {row.participantToken} · {row.turnNumber}
          </span>
          {showOwner && owner && (
            // Where the question goes, stated and not interpreted (§5.4). The
            // chip itself stays grey: the row already carries tinted chips for
            // pasted material, and a second tinted chip on the same line would
            // be two colour languages an inch apart. The dot does the colour,
            // which also keeps it quiet enough to repeat sixty times.
            <span className="inline-flex items-center gap-1 rounded bg-[hsl(var(--muted))] px-1.5 py-0.5 text-2xs text-[hsl(var(--muted-foreground))]">
              {owner.outcome !== 'pending' && (
                <span
                  aria-hidden
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{
                    // Grey for the else branch: "nothing claimed this" is a
                    // different kind of answer from "I put it here", and the
                    // difference is worth seeing down a column.
                    backgroundColor:
                      owner.sid == null ? 'hsl(var(--muted-foreground))' : intentColor(owner.sid),
                  }}
                />
              )}
              {owner.outcome === 'pending' ? 'working it out' : titleOf(owner.sid)}
            </span>
          )}
        </div>
        <div className="text-sm leading-snug">
          <QuerySnippet
            text={row.queryText}
            dissection={row.dissection}
            max={150}
            highlight={highlight}
          />
        </div>
      </div>
      <div className="self-start flex items-center">
        {/* Reading a question and deciding it belongs somewhere else is the
            move this board is built around, so it starts here, on the question,
            rather than over in the configuration. The label names what the new
            intent will be read before, because that is the part of the outcome
            that is settled before anything is written. */}
        {onCreateIntent && (
          <IconButton
            label={`Start an intent — read before “${titleOf(owner?.sid ?? null)}”`}
            onClick={() => onCreateIntent(row.messageId)}
            className="opacity-0 group-hover:opacity-100 text-[hsl(var(--muted-foreground))]"
          >
            <Plus className="w-3.5 h-3.5" />
          </IconButton>
        )}
        <IconButton
          label={pinned ? 'Stop keeping this one here' : 'Keep this one in view'}
          onClick={() => onTogglePin(row.messageId)}
          className={
            pinned
              ? 'text-[hsl(var(--foreground))]'
              : 'opacity-0 group-hover:opacity-100 text-[hsl(var(--muted-foreground))]'
          }
        >
          {pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
        </IconButton>
      </div>
    </li>
  );
}

/**
 * How long ago, in the units the intent histories use.
 *
 * The same wording on purpose: an intent's history says "4m ago" beside the
 * wording it is offering to put back, and this says "4m ago" beside the answer
 * that wording produced. Matching them by eye is the whole point of listing
 * moments here at all.
 */
function momentAgo(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

/**
 * An icon with its meaning attached.
 *
 * Two icons on a question row, both of them verbs nobody has met before: one
 * carves an intent out of the question, the other keeps it on screen. A `+` on
 * its own does not say either. The browser's own tooltip does, eventually, in
 * whatever style the operating system prefers — long enough after the pointer
 * lands that the answer arrives after the guess.
 *
 * So the label is part of the button. It opens LEFTWARDS, over the question
 * text rather than out of the list, because the list scrolls and anything
 * reaching past its right edge is clipped; and it is positioned rather than
 * laid out, so sixty rows do not reflow as the pointer travels down them.
 */
function IconButton({
  label,
  onClick,
  className = '',
  children,
}: {
  label: string;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span className="relative group/icon flex">
      <button
        aria-label={label}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        className={`p-1 rounded hover:bg-[hsl(var(--background))] ${className}`}
      >
        {children}
      </button>
      <span className="pointer-events-none absolute right-full top-1/2 -translate-y-1/2 mr-1 hidden group-hover/icon:block z-10 whitespace-nowrap rounded-md bg-[hsl(var(--foreground))] px-2 py-1 text-2xs font-medium text-[hsl(var(--background))] shadow-lg">
        {label}
      </span>
    </span>
  );
}

/* =================================================================== */
/* Right: the conversation                                             */
/* =================================================================== */

function ViewerColumn({
  api,
  rows,
  row,
  isNirvana,
  moments,
  viewingVersionNo,
  localVersionNo,
  setLocalVersionNo,
  onLocalVersionLog,
  titleOf,
}: {
  api: (path: string, query?: string) => string;
  rows: ScoreQueryRow[];
  row: ScoreQueryRow | null;
  isNirvana: boolean;
  /** Every version, newest first. */
  moments: SimpleVersion[];
  viewingVersionNo: number | null;
  localVersionNo: number | null;
  setLocalVersionNo: (v: number | null) => void;
  onLocalVersionLog: (versionNo: number | null) => void;
  titleOf: (sid: number | null) => string;
}) {
  const [answer, setAnswer] = useState<{
    messageId: number;
    versionNo: number | null;
    text: string;
    state: 'streaming' | 'ready' | 'pending' | 'failed' | 'original';
    owner: string | null;
  } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const versionNo = localVersionNo ?? viewingVersionNo;

  useEffect(() => {
    if (!row) {
      setAnswer(null);
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const messageId = row.messageId;

    (async () => {
      setAnswer({ messageId, versionNo, text: '', state: 'streaming', owner: null });
      try {
        const res = await fetch(api('respond'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messageId, versionNo }),
          signal: controller.signal,
        });
        if (!res.ok) {
          setAnswer({ messageId, versionNo, text: '', state: 'failed', owner: null });
          return;
        }
        if (res.headers.get('content-type')?.includes('application/json')) {
          const data = await res.json();
          if (data.status === 'pending') {
            setAnswer({ messageId, versionNo, text: '', state: 'pending', owner: null });
            return;
          }
          // The rule here is still the assignment's own prompt, which is what
          // produced the reply already on screen. Leaving it alone is both the
          // true answer and the fast one.
          if (data.status === 'original') {
            setAnswer({
              messageId,
              versionNo,
              text: '',
              state: 'original',
              owner: data.sid == null ? null : titleOf(data.sid),
            });
            return;
          }
          setAnswer({
            messageId,
            versionNo,
            text: data.response ?? '',
            state: 'ready',
            owner: data.sid == null ? null : titleOf(data.sid),
          });
          return;
        }
        // A miss: show it arriving rather than making them wait in silence.
        const ownerHeader = res.headers.get('X-Simple-Owner');
        const owner = ownerHeader && ownerHeader !== 'root' ? titleOf(Number(ownerHeader)) : null;
        const reader = res.body?.getReader();
        if (!reader) return;
        const decoder = new TextDecoder();
        let text = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          text += decoder.decode(value, { stream: true });
          setAnswer({ messageId, versionNo, text, state: 'streaming', owner });
        }
        setAnswer({ messageId, versionNo, text, state: 'ready', owner });
      } catch (error) {
        if ((error as Error)?.name === 'AbortError') return;
        setAnswer({ messageId, versionNo, text: '', state: 'failed', owner: null });
      }
    })();

    return () => controller.abort();
  }, [api, row, versionNo, titleOf]);

  if (!row) {
    return (
      <section className="min-h-0 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] flex items-center justify-center">
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Pick a question to see the conversation.
        </p>
      </section>
    );
  }

  return (
    <section className="min-h-0 flex flex-col rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-hidden">
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-[hsl(var(--border))]">
        <span className="text-sm font-semibold">Conversation</span>
        <span className="flex-1" />
        {/* One conversation, under a different version — without moving the
            rest of the board off the one being edited.

            EVERY version, not only the saves. The timeline on the left is a
            list of places to go back to, and only a save is one of those; this
            is a list of moments to look at, and an apply is as much a moment
            as a save. Listing only saves meant an intent's own history could
            point at a wording this could not show — you were reading v2 and
            being offered v1.

            No "v N" here either, for the same reason: on this screen that
            number means the intent's own version, and two numberings under one
            name is what sent someone looking for v2 in the first place. What
            identifies a moment is when it was and what it was called. */}
        {moments.length > 0 && (
          <select
            value={String(versionNo ?? moments[0]?.versionNo ?? '')}
            onChange={(e) => {
              const picked = e.target.value ? Number(e.target.value) : null;
              setLocalVersionNo(picked === moments[0]?.versionNo ? null : picked);
              onLocalVersionLog(picked);
            }}
            className="text-xs rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-1.5 py-1"
          >
            {moments.map((v, i) => (
              <option key={v.id} value={v.versionNo}>
                {i === 0 ? 'now' : momentAgo(v.createdAt)}
                {v.name ? ` · ${v.name}` : v.kind === 'save' ? ' · saved' : ''}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        <ConversationThread
          rows={rows}
          current={row}
          isNirvana={isNirvana}
          // Pasted material stays folded here, unlike every other reading view
          // in the app. Those are for reading what the student wrote; this
          // column exists to show what the configuration ANSWERS, and a draft
          // essay pasted into the question is often longer than the screen, so
          // opening them by default put the reply below the fold — the one
          // thing this column is for. Every bubble keeps its own show control.
          overrideResponse={
            answer &&
            answer.messageId === row.messageId &&
            answer.state !== 'pending' &&
            answer.state !== 'original'
              ? { messageId: row.messageId, text: answer.text || ' ', raw: false }
              : null
          }
          responseSlot={
            <AnswerNote
              state={answer?.messageId === row.messageId ? answer.state : 'streaming'}
              owner={answer?.messageId === row.messageId ? answer.owner : null}
            />
          }
        />
      </div>
    </section>
  );
}

/**
 * The one line under a regenerated reply.
 *
 * It says which rule produced it and that it is one exchange, and stops there.
 * Not a disclaimer about accuracy — the reply IS what the configuration does —
 * but a statement of what was actually run, since a reply generated from a
 * summary of the thread is not the same object as the reply the student got.
 */
function AnswerNote({
  state,
  owner,
}: {
  state: 'streaming' | 'ready' | 'pending' | 'failed' | 'original';
  owner: string | null;
}) {
  const text =
    state === 'pending'
      ? 'Working out which rule applies to this question.'
      : state === 'failed'
        ? 'This reply could not be worked out — pick the question again to retry.'
        : // Says which reply this is, so an unchanged rule does not read as a
          // rule that did nothing. It is the one the student actually got.
          state === 'original'
          ? 'The reply this student got. Nothing here has been changed yet.'
          : state === 'streaming'
            ? `Answering under ${owner ? `“${owner}”` : 'your rules'} now.`
            : `Answered under ${owner ? `“${owner}”` : 'your rules'}, as a single exchange.`;
  return (
    <p className="mt-1 flex items-center gap-1.5 text-2xs text-[hsl(var(--muted-foreground))]">
      {state === 'streaming' && <Loader2 className="w-3 h-3 animate-spin" />}
      {text}
    </p>
  );
}
