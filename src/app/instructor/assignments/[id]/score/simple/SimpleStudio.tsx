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
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Loader2,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Redo2,
  Search,
  Sparkles,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { ConversationThread } from '../conversation';
import { QuerySnippet } from '../materials';
import type { ScoreQueryRow } from '../IntentBoard';
import StarterPicker from './StarterPicker';
import RulePicker, { type RuleSource } from './RulePicker';
import IntentHistory, { type IntentVersion } from './IntentHistory';
import QuestionCount, { questionsThat } from './QuestionCount';
import { intentColor } from './colors';
import { logUi, useSurfaceLog } from '@/lib/study/ui-log';
import {
  askedVersionNo,
  describeStep,
  insertBefore,
  moveIntent,
  removeIntent,
  ruleForOwner,
  type SimpleIntent,
  type SimpleSnapshot,
} from '@/lib/study/simple/chain';
import type { SimpleVersion } from '@/lib/study/simple/store';
import type { IntentExample } from '@/lib/study/simple/anchors';
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
  /** The newest SAVE. Null if they never saved. */
  savedVersionNo: number | null;
  /** What they deployed — the setup they stand behind, and what the study
   * measures. Null until they have deployed once. */
  deployedVersionNo: number | null;
  /** Something took effect that the newest save does not carry. */
  dirty: boolean;
  /** Which intents differ from the last save (0 = everything else). */
  unsavedSids: number[];
  /** sid → that intent's own history, newest first ('0' = everything else). */
  intentVersions: Record<string, IntentVersion[]>;
  /** sid → what its wording catches right now, for the row that is applied
   * and not saved and so has no stored version to carry the number. */
  matchesNow: Record<string, number | null>;
  /** The write's own follow-up work is still running on the server. */
  working: boolean;
}

/**
 * Whether the boxes hold anything the board is not already answering with.
 *
 * What Apply is for, and therefore what its being enabled should mean. It
 * compares the draft with the snapshot IN EFFECT, which is a different
 * question from the one the tree's "unsaved" marks answer — those compare what
 * is in effect with the last save.
 */
function sameSnapshot(a: SimpleSnapshot, b: SimpleSnapshot): boolean {
  if (a.arm === 'baseline') return a.prompt === b.prompt;
  if (a.rootRule !== b.rootRule || a.intents.length !== b.intents.length) return false;
  return a.intents.every((intent, i) => {
    const other = b.intents[i];
    return (
      !!other &&
      other.sid === intent.sid &&
      other.title === intent.title &&
      other.definition === intent.definition &&
      other.rule === intent.rule
    );
  });
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
type Selection = { kind: 'root' } | { kind: 'intent'; sid: number };

/** An intent being written, and where it will land. */
interface Creating {
  /** Tried before this one; null = last, just above the uncategorized rule. */
  beforeSid: number | null;
  /** What the rule box starts as — the rule those questions get today. */
  seedRule: string;
  /** The question it was started from, when it was started from one. */
  fromMessageId: number | null;
  /** That question's own row, so the form can draw it the way the list does.
   * The raw text and the list's rendering of it are far enough apart — tags
   * for pasted material, a token, a turn — that quoting one beside the other
   * read as two different questions. */
  fromRow: ScoreQueryRow | null;
}

export default function SimpleStudio({
  assignmentId,
  rows,
  reviewSet,
  isNirvana,
  initialState,
  seedPrompt,
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
  /** The assignment's own prompt — what an untouched configuration is. */
  seedPrompt: string;
  /** Set only when a researcher opened this with ?view= on an assignment that
   * is not a clone. It tells the routes which arm the preview is; on a real
   * clone the clone decides and this is ignored. */
  viewParam?: string | null;
}) {
  const [state, setState] = useState<StatePayload>(initialState);
  const [draft, setDraft] = useState<SimpleSnapshot>(initialState.snapshot);
  // Uncategorized, not "everything". Everything was the state the board
  // opened in and the one place the tree offers no way back to — a default
  // nobody could return to. On a board with no intents the two show the same
  // sixty questions anyway.
  const [selection, setSelection] = useState<Selection>({ kind: 'root' });
  const [creating, setCreating] = useState<Creating | null>(null);
  const [query, setQuery] = useState('');
  const [selectedMessageId, setSelectedMessageId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [judging, setJudging] = useState(false);
  /**
   * What the open conversation's reply is being read under.
   *
   * `null` follows whatever the board is on. A number pins this one reply to a
   * version without moving the board off the one being edited. `'original'`
   * asks for the reply the student was actually given — a different question
   * from any version, and the only one no configuration can answer.
   */
  const [localVersionNo, setLocalVersionNo] = useState<number | 'original' | null>(null);

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
    async (opts?: { versionNo?: number | null; keepDraft?: boolean }) => {
      const params = new URLSearchParams();
      const versionNo = opts?.versionNo === undefined ? state.viewing?.versionNo ?? null : opts.versionNo;
      if (versionNo != null) params.set('versionNo', String(versionNo));
      const res = await fetch(api('state', params.toString()));
      if (!res.ok) return null;
      const next: StatePayload = await res.json();
      setState(next);
      // The header's Deploy button is a sibling from the server render, so it
      // cannot see client-side writes — without this, a participant who never
      // reloads (i.e. every participant) saves v1 and finds Deploy still
      // disabled. Every path that changes what Deploy should say funnels
      // through here, so this one dispatch keeps it honest.
      window.dispatchEvent(
        new CustomEvent('simple-studio:state', {
          detail: {
            currentVersionNo: next.versions[0]?.versionNo ?? null,
            dirty: next.dirty,
            deployedVersionNo: next.deployedVersionNo,
          },
        })
      );
      // `keepDraft` exists so a poll cannot overwrite what someone is in the
      // middle of typing — but a title generated after the write lands in the
      // server's copy and nowhere else, and the tree reads the draft. Filling
      // only the blanks is the whole of the exception: a box being typed into
      // is not blank, so nothing anyone wrote can be lost this way.
      if (opts?.keepDraft) setDraft((d) => withFilledTitles(d, next.snapshot));
      else setDraft(next.snapshot);
      return next;
    },
    [api, state.viewing?.versionNo]
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

  /**
   * Names arrive after the write that earns them, and nothing else goes back
   * for them.
   *
   * Naming is best-effort and runs behind the response — a second or three
   * with the smallest model there is. The board only reloads while it is
   * judging, so whether a name was ever seen came down to whether it landed
   * before the judging loop's last pass: the same apply showed "v2 · Refined
   * Complete Text intent" on one run and a bare "v2" on the next. A row you
   * are deciding whether to keep is exactly where that line is worth reading,
   * so this asks again, a few times, and stops.
   */
  const [nameTries, setNameTries] = useState(0);
  useEffect(() => {
    const unnamed =
      (state.dirty && state.moments[0] != null && !state.moments[0].name) ||
      Object.values(state.intentVersions).some((rows) => rows.some((row) => !row.name));
    if (!unnamed || nameTries >= 8) return;
    const timer = setTimeout(() => {
      setNameTries((n) => n + 1);
      void load({ keepDraft: true });
    }, 2500);
    return () => clearTimeout(timer);
  }, [state.dirty, state.moments, state.intentVersions, nameTries, load]);

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
    ): Promise<{ created?: number[] } | null> => {
      // A new write earns new names; start listening for them again.
      setNameTries(0);
      setSaving(true);
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
        if (!res.ok) return null;
        const body = (await res.json()) as { created?: number[] };
        setLocalVersionNo(null);
        await load({ versionNo: null });
        return body;
      } finally {
        setSaving(false);
      }
      return null;
    },
    [api, load, selectedMessageId]
  );

  /** Take effect. The verb every editor carries. */
  /**
   * Undo and redo over what has been APPLIED this sitting.
   *
   * Session-local on purpose, exactly as a word processor's is: it undoes the
   * editing being done now, while the durable way back is the history, whose
   * saved versions survive a reload. It costs nothing to walk — every wording
   * that was applied has its verdicts stored under its own text hash, so
   * arriving back at one re-attaches them with no model call.
   *
   * Undoing APPLIES the earlier configuration rather than rewinding to its
   * row. The newest row is the configuration here, and quietly making an older
   * row newest would leave the trail saying something that did not happen. So
   * an undo is a write like any other, and the history records it as one.
   */
  const [past, setPast] = useState<SimpleSnapshot[]>([]);
  const [future, setFuture] = useState<SimpleSnapshot[]>([]);
  const walkingRef = useRef(false);

  const apply = useCallback(
    async (
      next: SimpleSnapshot,
      focusSid: number | null,
      seed?: { sid: number; messageId: number } | null,
      /** Writing an intent into existence is a decision, not a try: it keeps,
       * so the card opens on a v1 instead of a history of nothing. Editing one
       * afterwards is an apply like everything else. */
      kind: 'apply' | 'save' = 'apply'
    ) => {
      // The state being left, captured before the write replaces it. A step
      // taken BY undo or redo is not itself an undo step.
      if (!walkingRef.current) {
        const from = state.snapshot;
        setPast((p) => [...p.slice(-24), from]);
        setFuture([]);
      }
      return write(next, focusSid, kind, seed);
    },
    [state.snapshot, write]
  );

  const walk = useCallback(
    async (to: SimpleSnapshot, keep: SimpleSnapshot, which: 'undo' | 'redo') => {
      walkingRef.current = true;
      try {
        if (which === 'undo') {
          setPast((p) => p.slice(0, -1));
          setFuture((f) => [...f, keep]);
        } else {
          setFuture((f) => f.slice(0, -1));
          setPast((p) => [...p, keep]);
        }
        await write(to, null, 'apply');
        logUi(assignmentId, `simple_${which}`, {});
      } finally {
        walkingRef.current = false;
      }
    },
    [assignmentId, write]
  );

  /** Something is written that has not taken effect. */
  const draftChanged = useMemo(
    () => !sameSnapshot(draft, state.snapshot),
    [draft, state.snapshot]
  );

  const canUndo = past.length > 0 && !saving && state.atTip;
  const canRedo = future.length > 0 && !saving && state.atTip;
  /* Where the step lands, not merely that there is one. Read from the
     snapshot it would apply, so it is the same fact the board will show a
     second later rather than a note somebody has to keep in sync. */
  /* The visible word first either way: an accessible name that replaces the
     label on the button rather than extending it leaves the two saying
     different things. */
  const undoLabel = canUndo
    ? `Undo (⌘Z) — ${describeStep(state.snapshot, past[past.length - 1])}`
    : 'Undo (⌘Z) — nothing to step back to';
  const redoLabel = canRedo
    ? `Redo (⇧⌘Z) — ${describeStep(state.snapshot, future[future.length - 1])}`
    : 'Redo (⇧⌘Z) — nothing to step forward to';
  const undo = useCallback(() => {
    if (!canUndo) return;
    void walk(past[past.length - 1], state.snapshot, 'undo');
  }, [canUndo, past, state.snapshot, walk]);
  const redo = useCallback(() => {
    if (!canRedo) return;
    void walk(future[future.length - 1], state.snapshot, 'redo');
  }, [canRedo, future, state.snapshot, walk]);

  // The shortcuts everyone already has in their fingers, minus the ones that
  // belong to whatever box the cursor is in.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')) return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [redo, undo]);

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
  /**
   * Go back to a saved version and drop what came after it.
   *
   * One verb for what used to look like two. Dropping what is applied and not
   * saved IS going back one version, so there is nothing to tell apart — only
   * how far back, and that is which row the reader is sitting on.
   *
   * The newest save needs nothing hidden: the only thing in its way is the
   * working row, which was never a version and is deleted rather than kept.
   * Going further back hides the saves in between instead — an attempt someone
   * abandoned is the trace the study is about, and it survives in the trail
   * even after it leaves their timeline.
   *
   * The undo stack goes with it. Its steps point at states that are no longer
   * in the timeline, and stepping back into one would quietly rebuild what was
   * just thrown away on purpose.
   */
  const revert = useCallback(
    async (configVersionNo: number | null) => {
      setSaving(true);
      try {
        const res =
          configVersionNo == null
            ? await fetch(api('revert'), { method: 'POST' })
            : await fetch(api('restore'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ versionNo: configVersionNo }),
              });
        if (!res.ok) return;
        setLocalVersionNo(null);
        setPast([]);
        setFuture([]);
        await load({ versionNo: null });
      } finally {
        setSaving(false);
      }
    },
    [api, load]
  );

  /**
   * Make the version being read the newest one again.
   *
   * Everything after it leaves the timeline — hidden, not deleted, so the
   * trail keeps the attempt even after their own list stops showing it. The
   * undo stack goes too: its steps point at states that are no longer in the
   * timeline, and walking back into one would rebuild what was just dropped.
   */
  const restore = useCallback(
    async (versionNo: number) => {
      await fetch(api('restore'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versionNo }),
      });
      setLocalVersionNo(null);
      setPast([]);
      setFuture([]);
      await load({ versionNo: null });
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
   * The questions the pile a new intent is read before is holding today.
   *
   * Putting one above another is done to intercept it — to take, first, some
   * of what that one is taking now — so the number the starter sets show is
   * how much of THAT pile each would take. Counted over everything the new
   * intent could reach it was mostly the uncategorized heap, which says
   * nothing about the split being considered.
   *
   * It can still take from further down, and the line on the form says so.
   * That is a consequence of being read first, not the reason for writing it.
   *
   * Ownership as resolved, so the ceiling here is exactly the number on the
   * row: an unjudged question is nobody's yet and is counted nowhere.
   */
  const takeableFrom = useCallback(
    (beforeSid: number | null): number[] => {
      if (arm !== 'score') return [];
      return material
        .filter((row) => {
          const owner = ownerOf(row.messageId);
          return owner?.outcome !== 'pending' && (owner?.sid ?? null) === beforeSid;
        })
        .map((row) => row.messageId);
    },
    [arm, material, ownerOf]
  );

  /**
   * Start an intent from one question.
   *
   * The question becomes the new intent's first EXAMPLE, which is what the
   * intent's own list is then ordered by — so "did my wording catch it" is
   * answered at the top of that list, beside the ownership chip, rather than
   * in a shelf that follows you to every other intent. It used to be pinned
   * instead, and a pin is a global bookmark: the question a participant
   * carved intent A out of stayed on screen while they worked on B.
   *
   * The form opens directly ABOVE whatever owns that question now, so the new
   * words are read first. And the rule box starts as a copy of the rule that
   * question is getting today, so applying before the rule is rewritten
   * changes nothing.
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
      setSelectedMessageId(messageId);
      setCreating({
        beforeSid,
        seedRule,
        fromMessageId: messageId,
        fromRow: rowById.get(messageId) ?? null,
      });
      // Look at the set this is being carved out of, not at whatever was open
      // when the question was clicked.
      setSelection(beforeSid == null ? { kind: 'root' } : { kind: 'intent', sid: beforeSid });
      logUi(assignmentId, 'simple_intent_from_query', { messageId, beforeSid });
    },
    [assignmentId, draft.intents, draft.rootRule, ownerOf, rowById]
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
  const [ranked, setRanked] = useState<{
    sid: number;
    order: number[];
    examples: IntentExample[];
  } | null>(null);
  /** Which end of the order is being read. Resets with the selection, because
   * it is a way of looking at one intent rather than a setting. */
  const [furthest, setFurthest] = useState(false);
  const [rankNonce, setRankNonce] = useState(0);
  useEffect(() => setFurthest(false), [selection]);
  useEffect(() => {
    if (arm !== 'score' || selection.kind !== 'intent') {
      setRanked(null);
      return;
    }
    const sid = selection.sid;
    let cancelled = false;
    (async () => {
      const res = await fetch(
        api(
          'rank',
          `sid=${sid}${furthest ? '&order=furthest' : ''}${
            state.viewing && !state.atTip ? `&versionNo=${state.viewing.versionNo}` : ''
          }`
        )
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
  }, [api, arm, furthest, rankNonce, selection, state.atTip, state.viewing, state.judged]);

  /**
   * Add, drop or rewrite the examples an intent stands for.
   *
   * None of this writes a configuration: an example changes the ORDER of the
   * list and nothing else, which is why adding one leaves the row's ownership
   * chip saying wherever the question actually went.
   */
  const editExamples = useCallback(
    async (init: RequestInit, query = '') => {
      const res = await fetch(api('examples', query), init);
      if (!res.ok) return;
      const body = await res.json();
      setRanked((r) => (r ? { ...r, examples: body.examples ?? [] } : r));
      setRankNonce((n) => n + 1);
    },
    [api]
  );

  const listed = useMemo(() => {
    if (arm === 'baseline') return material;
    if (selection.kind === 'root') {
      return material.filter((r) => ownerOf(r.messageId)?.sid === null);
    }
    // Everything this intent's own definition describes — including the
    // questions an earlier intent takes first. Hiding those would mean the
    // list answered "what does this definition catch" with a number that has
    // already been adjusted for something the participant cannot see.
    const sid = selection.sid;
    const mine = material.filter((r) => {
      const owner = ownerOf(r.messageId);
      return owner?.sid === sid || owner?.matchedElsewhere.includes(sid);
    });
    // Most typical first. The first row a participant reads is what tells them
    // whether the classifier can be trusted, so it should be the least
    // arguable member of the category rather than whichever student happened
    // to ask first. Anything the ranking does not name keeps its place after
    // the ones it does — a partial answer reorders what it knows and leaves
    // the rest alone.
    if (ranked?.sid !== sid || ranked.order.length === 0) return mine;
    // An example is shown above the list, so showing it again inside would be
    // the same question twice a few rows apart.
    const shown = new Set(
      ranked.examples.map((e) => e.messageId).filter((m): m is number => m != null)
    );
    const rest = mine.filter((r) => !shown.has(r.messageId));
    const at = new Map(ranked.order.map((id, i) => [id, i]));
    return [...rest].sort(
      (a, b) =>
        (at.get(a.messageId) ?? Number.MAX_SAFE_INTEGER) -
        (at.get(b.messageId) ?? Number.MAX_SAFE_INTEGER)
    );
  }, [arm, material, ownerOf, ranked, selection]);

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

  /**
   * The examples this intent stands for, as rows.
   *
   * A question from the log becomes the row it already is — same snippet, same
   * ownership chip — so an example that went somewhere else says so from
   * inside the list it was added to. A written one has no row and is rendered
   * as its text.
   */
  const exampleRows = useMemo(
    () =>
      selection.kind === 'intent' && ranked?.sid === selection.sid
        ? ranked.examples.map((e) => ({
            id: e.id,
            text: e.text,
            row: e.messageId != null ? rowById.get(e.messageId) ?? null : null,
          }))
        : [],
    [ranked, rowById, selection]
  );

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
        creating={creating}
        setCreating={setCreating}
        draftChanged={draftChanged}
        takeableFrom={takeableFrom}
        onUndo={canUndo ? undo : null}
        onRedo={canRedo ? redo : null}
        undoLabel={undoLabel}
        redoLabel={redoLabel}
        onApply={apply}
        onSaveVersion={saveVersion}
        onRevert={revert}
        onRestore={restore}
        onView={(versionNo) => {
          setLocalVersionNo(null);
          void load({ versionNo });
          // Looking back at an older version changes nothing and would
          // otherwise leave no trace at all.
          logUi(assignmentId, 'simple_version_view', { versionNo });
        }}
        assignmentId={assignmentId}
      />

      <QuestionColumn
        rows={searched}
        pinnedRows={pinnedRows}
        exampleRows={exampleRows}
        onDropExample={
          readOnly || selection.kind !== 'intent'
            ? null
            : (exampleId) =>
                void editExamples(
                  { method: 'DELETE' },
                  `sid=${selection.sid}&id=${exampleId}`
                )
        }
        onEditExample={
          readOnly || selection.kind !== 'intent'
            ? null
            : (exampleId, text) =>
                void editExamples({
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ sid: selection.sid, id: exampleId, text }),
                })
        }
        onRegenerateExamples={
          readOnly || selection.kind !== 'intent'
            ? null
            : () =>
                editExamples({
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ sid: selection.sid, regenerate: true }),
                })
        }
        onAddExample={
          readOnly || selection.kind !== 'intent'
            ? null
            : (messageId) =>
                void editExamples({
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ sid: selection.sid, messageId }),
                })
        }
        furthest={furthest}
        onFlipOrder={
          selection.kind !== 'intent'
            ? null
            : () => {
                setFurthest((v) => {
                  if (!v) logUi(assignmentId, 'simple_order_furthest', { sid: selection.sid });
                  return !v;
                });
              }
        }
        allCount={material.length}
        query={query}
        setQuery={setQuery}
        elsewhereCount={elsewhereCount}
        selection={selection}
        definition={
          selection.kind === 'intent'
            ? draft.intents.find((i) => i.sid === selection.sid)?.definition ?? ''
            : ''
        }
        selectedMessageId={selectedMessageId}
        onSelect={setSelectedMessageId}
        onTogglePin={togglePin}
        onCreateIntent={readOnly || arm === 'baseline' ? null : startIntentFrom}
        pinned={state.pinned}
        ownerOf={ownerOf}
        titleOf={title}
        arm={arm}
        judging={judging}
      />

      <ViewerColumn
        api={api}
        rows={rows}
        row={selectedRow}
        isNirvana={isNirvana}
        // Everything needed to know, without asking, whether this question is
        // answered by the assignment's own prompt.
        snapshot={state.snapshot}
        owners={state.owners}
        seedPrompt={seedPrompt}
        atTip={state.atTip}
        intentVersions={state.intentVersions}
        unsavedSids={state.unsavedSids}
        viewingVersionNo={state.viewing?.versionNo ?? null}
        localVersionNo={localVersionNo}
        setLocalVersionNo={setLocalVersionNo}
        onLocalVersionLog={(versionNo) =>
          logUi(assignmentId, 'simple_local_version_view', {
            versionNo,
            messageId: selectedMessageId,
          })
        }
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
  creating,
  setCreating,
  draftChanged,
  takeableFrom,
  onUndo,
  onRedo,
  undoLabel,
  redoLabel,
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
  creating: Creating | null;
  setCreating: (c: Creating | null) => void;
  /** Something is written that has not taken effect. */
  draftChanged: boolean;
  /** The questions an intent read before this row could take. */
  takeableFrom: (beforeSid: number | null) => number[];
  /** Null when there is nothing to step back to, or forward to. */
  onUndo: (() => void) | null;
  onRedo: (() => void) | null;
  /** What each step will do, for the control that offers it. */
  undoLabel: string;
  redoLabel: string;
  onApply: (
    next: SimpleSnapshot,
    focusSid: number | null,
    seed?: { sid: number; messageId: number } | null,
    kind?: 'apply' | 'save'
  ) => Promise<{ created?: number[] } | null>;
  onSaveVersion: () => Promise<void>;
  onRevert: (configVersionNo: number | null) => Promise<void>;
  onRestore: (versionNo: number) => Promise<void>;
  onView: (versionNo: number | null) => void;
  assignmentId: string;
}) {
  const countOf = (sid: number | null) => state.counts[sid === null ? 'root' : String(sid)] ?? 0;
  const unsaved = new Set(state.unsavedSids);

  return (
    <div className="min-h-0 flex flex-col gap-3">
      <section className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
        {/* The steps belong to the COLUMN, not to whichever card is open.
            They used to sit on the Apply row inside a card, which read as
            "step this intent" — and after a delete the open card is the
            uncategorized one, so an undo offered there looked like it would
            do something to the uncategorized rule and instead brought back an
            intent. What they step is the whole configuration: creations,
            deletions and order have no card to live on, and a card's own
            history is the version list inside it. */}
        {/* The column says what it is, like the two beside it. "Setup" is the
            participant's own word for this: the task they were read says
            "adjust the setup so that it responds the way you want", and a
            column labelled anything else would be a second name for the thing
            they were asked to change. One word in both arms, because the shell
            is identical in both and only what is INSIDE this column differs. */}
        <div className="sticky top-0 z-10 flex items-center gap-2 px-3 py-2 bg-[hsl(var(--card))] border-b border-[hsl(var(--border))]">
          <span className="text-sm font-semibold">Setup</span>
          <span className="flex-1" />
          {!readOnly && (
            <>
              <StepButton label={undoLabel} onClick={onUndo}>
                <Undo2 className="w-3.5 h-3.5" />
                Undo
              </StepButton>
              <StepButton label={redoLabel} onClick={onRedo}>
                <Redo2 className="w-3.5 h-3.5" />
                Redo
              </StepButton>
            </>
          )}
        </div>
        {readOnly && (
          <div className="sticky top-9 z-10 px-3 py-2 bg-[hsl(var(--muted))] border-b border-[hsl(var(--border))] flex items-center justify-between gap-2">
            <span className="text-xs text-[hsl(var(--muted-foreground))]">
              {state.viewing?.versionNo === 0
                ? 'Looking at this chatbot as it was delivered. Editing happens on the latest one.'
                : `Looking at setup ${state.viewing?.displayNo}. Editing happens on the latest one.`}
            </span>
            {/* The two things to do about it are beside the list that put the
                board here — this row only has to say where "here" is. */}
          </div>
        )}

        {arm === 'baseline' ? (
          <PromptEditor
            draft={draft}
            setDraft={setDraft}
            readOnly={readOnly}
            saving={saving}
            dirty={state.dirty}
            draftChanged={draftChanged}
            onApply={() => onApply(draft, null)}
            onSaveVersion={onSaveVersion}
            versions={state.intentVersions['0'] ?? []}
            pending={
              state.unsavedSids.includes(0)
                ? { name: state.dirty ? state.moments[0]?.name ?? null : null, matches: null }
                : null
            }
            onView={onView}
            viewingVersionNo={state.viewing && !state.atTip ? state.viewing.versionNo : null}
            viewingLabel={state.viewing?.displayNo ?? null}
            onRestore={() => state.viewing && void onRestore(state.viewing.versionNo)}
          />
        ) : (
          <Tree
            api={api}
            intentVersions={state.intentVersions}
            unsaved={unsaved}
            applied={state.snapshot}
            matchesNow={state.matchesNow ?? {}}
            takeableFrom={takeableFrom}
            pendingName={state.dirty ? state.moments[0]?.name ?? null : null}
            draft={draft}
            setDraft={setDraft}
            readOnly={readOnly}
            saving={saving}
            judging={judging}
            selection={selection}
            setSelection={setSelection}
            creating={creating}
            setCreating={setCreating}
            onApply={onApply}
            onSaveVersion={onSaveVersion}
            onRevert={onRevert}
            dirty={state.dirty}
            savedVersionNo={state.savedVersionNo}
            countOf={countOf}
            draftChanged={draftChanged}
            onView={onView}
            viewingVersionNo={state.viewing && !state.atTip ? state.viewing.versionNo : null}
            viewingLabel={state.viewing?.displayNo ?? null}
            onRestore={() => state.viewing && void onRestore(state.viewing.versionNo)}
            assignmentId={assignmentId}
          />
        )}
      </section>

    </div>
  );
}

/** The baseline arm's whole configuration: one document, edited in place. */
function PromptEditor({
  draft,
  setDraft,
  readOnly,
  saving,
  dirty,
  draftChanged,
  onApply,
  onSaveVersion,
  versions,
  pending,
  onView,
  viewingVersionNo,
  viewingLabel,
  onRestore,
}: {
  draft: SimpleSnapshot;
  setDraft: (s: SimpleSnapshot) => void;
  readOnly: boolean;
  saving: boolean;
  dirty: boolean;
  draftChanged: boolean;
  onApply: () => void;
  onSaveVersion: () => Promise<void>;
  /** This document's own history — sid 0, the same row the other arm's
   * else-rule uses, so both arms read their past the same way. */
  versions: IntentVersion[];
  pending: { name: string | null; matches: number | null } | null;
  onView: (configVersionNo: number | null) => void;
  viewingVersionNo: number | null;
  viewingLabel: number | null;
  onRestore: () => void;
}) {
  return (
    <div className="p-3 flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className="text-2xs font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
          Rules
        </span>
        <span className="text-2xs tabular-nums text-[hsl(var(--muted-foreground))]">
          {draft.prompt.length} / {STUDY_PROMPT_CHAR_LIMIT}
        </span>
      </div>
      {/* The same box as the other arm's, sized the same way: as tall as what
          is written in it. It is a whole document rather than one rule, so it
          has no ceiling — it grows and the column scrolls, instead of a fixed
          window that scrolled inside a column that also scrolled and left the
          buttons under it half off the screen. */}
      <AutoTextarea
        value={draft.prompt}
        readOnly={readOnly}
        maxLength={STUDY_PROMPT_CHAR_LIMIT}
        onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
        placeholder="What the chatbot should do, in your own words."
        minLines={12}
        maxLines={FIELD_DOC_MAX_LINES}
      />
      {/* The same row as the intent arm's, because the two arms differ in what
          a configuration IS and not in what you do with one. */}
      {!readOnly && (
        <div className="flex items-center gap-2">
          <ApplyButton saving={saving} disabled={!draftChanged} onClick={onApply} />
          {/* The same rule as the other arm's: Save keeps what is IN EFFECT,
              so edits sitting in the box have to be applied first. The two
              arms differ in what a configuration IS, not in what you do with
              one — and a Save that quietly published unapplied text here
              would make Apply the step you could skip on one side only. */}
          <Why
            reason={
              saving
                ? 'Waiting for the last change to land'
                : draftChanged
                  ? 'Apply these edits first — Save keeps what is in effect'
                  : dirty
                    ? 'Keep this as a version you can come back to'
                    : 'Nothing has changed since the last save'
            }
          >
            <button
              onClick={() => void onSaveVersion()}
              disabled={saving || !dirty || draftChanged}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[hsl(var(--border))] px-3 py-1.5 text-sm font-semibold hover:bg-[hsl(var(--muted))] disabled:opacity-40 disabled:hover:bg-transparent"
            >
              Save
            </button>
          </Why>
        </div>
      )}
      <IntentHistory
        delivered
        versions={versions}
        pending={pending}
        onView={onView}
        viewingVersionNo={viewingVersionNo}
        viewingLabel={viewingLabel}
        onRestore={onRestore}
      />
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
  matchesNow,
  takeableFrom,
  pendingName,
  draft,
  setDraft,
  readOnly,
  saving,
  judging,
  selection,
  setSelection,
  creating,
  setCreating,
  onApply,
  onSaveVersion,
  onRevert,
  dirty,
  savedVersionNo,
  countOf,
  draftChanged,
  onView,
  viewingVersionNo,
  viewingLabel,
  onRestore,
  assignmentId,
}: {
  api: (path: string, query?: string) => string;
  /** sid → that intent's own history, newest first. */
  intentVersions: Record<string, IntentVersion[]>;
  /** Intents that differ from the last save (0 = the uncategorized rule). */
  unsaved: Set<number>;
  /** The name of the moment in effect, for the row that is holding it. */
  pendingName: string | null;
  /** What is in EFFECT — which is not what is in the boxes while something is
   * typed and not applied. The history's pending row is about the first. */
  applied: SimpleSnapshot;
  /** sid → what its wording catches right now. */
  matchesNow: Record<string, number | null>;
  /** The questions an intent read before this row could take. */
  takeableFrom: (beforeSid: number | null) => number[];
  draft: SimpleSnapshot;
  setDraft: (s: SimpleSnapshot) => void;
  readOnly: boolean;
  saving: boolean;
  judging: boolean;
  selection: Selection;
  setSelection: (s: Selection) => void;
  creating: Creating | null;
  setCreating: (c: Creating | null) => void;
  onApply: (
    next: SimpleSnapshot,
    focusSid: number | null,
    seed?: { sid: number; messageId: number } | null,
    kind?: 'apply' | 'save'
  ) => Promise<{ created?: number[] } | null>;
  onSaveVersion: () => Promise<void>;
  onRevert: (configVersionNo: number | null) => Promise<void>;
  /** Something is in effect that the newest save does not carry. */
  dirty: boolean;
  savedVersionNo: number | null;
  countOf: (sid: number | null) => number;
  /** Show the whole board as it was in a version, or the newest when null. */
  onView: (configVersionNo: number | null) => void;
  /** Which version the board is showing, or null when it is on the newest. */
  viewingVersionNo: number | null;
  /** What that version is called. */
  viewingLabel: number | null;
  /** Make the version on screen the newest one again. */
  onRestore: () => void;
  /** The hypothetical questions the open intent's order was worked out from. */
  /** Something is written that has not taken effect. */
  draftChanged: boolean;
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

  /**
   * The wording a card has applied and not saved.
   *
   * Read straight off what is in effect: reading an old row no longer replaces
   * it, so there is nothing to hold on to. Holding it was a whole apparatus —
   * set on apply, gap-filled on reload, cleared on save and revert, with the
   * model's name copied across before it could go stale — and every line of
   * that existed to survive a press that has stopped doing the damage.
   */
  const pendingFor = (sid: number) =>
    unsaved.has(sid)
      ? {
          name: pendingName,
          // Only the board's own position can answer this. Reading an older
          // version, the counts on screen are that version's.
          matches:
            viewingVersionNo != null || sid === 0 ? null : matchesNow[String(sid)] ?? null,
        }
      : null;

  /** Which title is open for editing. One at a time, like the editors. */
  const [renaming, setRenaming] = useState<number | null>(null);

  const patch = (sid: number, fields: Partial<SimpleIntent>) =>
    setDraft({
      ...draft,
      intents: draft.intents.map((i) => (i.sid === sid ? { ...i, ...fields } : i)),
    });

  /**
   * The questions a new intent at this position could take, counted as the
   * two piles they are actually sitting in on screen.
   *
   * Everything from the row it is read before, downwards, is still unclaimed
   * when its turn comes — but one total spanning several rows matches no
   * number anybody can see. So: the row it is named after, and the rest below
   * it as one figure. The intents ABOVE are tried first and keep what they
   * have, which is the other half of the same fact and the reason neither
   * number is the whole log.
   */
  const countsFrom = (beforeSid: number | null) => {
    const at = beforeSid == null ? -1 : draft.intents.findIndex((i) => i.sid === beforeSid);
    if (at < 0) return { here: countOf(null), below: 0 };
    return {
      here: countOf(beforeSid),
      below:
        draft.intents.slice(at + 1).reduce((sum, i) => sum + countOf(i.sid), 0) + countOf(null),
    };
  };

  /* The form is rendered at the position the intent will occupy — at the LIST's
     own left edge, not inside the indent an open intent's editor uses. Indented
     it sat under the row above and read as more settings for that intent, which
     is the one thing it is not: it is a sibling being written. */
  const form = (beforeSid: number | null, beforeTitle: string) =>
    creating && !readOnly ? (
      <div className="pb-2">
        <NewIntent
          api={api}
          ruleSources={ruleSources(null)}
          creating={creating}
          beforeTitle={beforeTitle}
          takeable={countsFrom(beforeSid)}
          within={takeableFrom(beforeSid)}
          draft={draft}
          onCancel={() => setCreating(null)}
          onCreate={async (next, sid, seed) => {
            // Held open until the write comes back, and locked while it is
            // out. It used to close on the way IN — so pressing Add emptied
            // the column and left nothing at all on screen for the seconds the
            // write takes. The second click that would write the same intent
            // twice is stopped by disabling the form, not by removing it.
            // Kept, not merely applied: an intent coming into existence is
            // the decision the verb Save is for, and it is what gives the card
            // a v1 to open on instead of a history of nothing.
            const written = await onApply(next, sid, seed, 'save');
            setCreating(null);
            // Land on what was just made. The board only learns the real id
            // here — the form sent a temporary negative one — and the next
            // thing anyone wants is the list of what those words caught.
            const made = written?.created?.[0];
            if (made != null) setSelection({ kind: 'intent', sid: made });
            return null;
          }}
        />
      </div>
    ) : null;

  const renderIntent = (intent: SimpleIntent, at: number) => {
    // Selecting an intent IS opening it. There was a separate expanded state
    // and a click toggled it, so choosing the thing you wanted to look at
    // could shut it — and the second click, the one that meant "yes, this
    // one", was the one that closed it.
    //
    // Except while one is being written: two editors open at once, one of them
    // for something that does not exist yet, is a column with two answers to
    // "what am I editing".
    const open = !creating && selection.kind === 'intent' && selection.sid === intent.sid;
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
            setCreating(null);
            if (!open) logUi(assignmentId, 'intent_open', { sid: intent.sid });
          }}
        >
          {/* No chevron. Selecting a row IS opening it — there is no closed
              state to go back to — so an arrow that looks like a fold was an
              invitation to try to fold it, and the try does nothing. What is
              open is said by the row being lit and the editor being under it.
              The dot moves into the slot the arrow held, so every title still
              starts at one place. */}
          <span aria-hidden className="w-3.5 shrink-0 flex justify-center">
            {/* The same dot the question rows carry, so a colour seen in the
                list can be found here without reading anything. */}
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: intentColor(intent.sid) }}
            />
          </span>
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
          {/* Which one, not just whether. A fact about what the next step will
              read, not a fault to fix — and not shown while an older version
              is on screen, where nothing is unsaved and the chip would be
              reading the difference between two versions instead. */}
          {!readOnly && unsaved.has(intent.sid) && (
            <span
              title="Applied, and not in what the next step will read. Deploy keeps it."
              className="shrink-0 rounded-full bg-[hsl(var(--primary))]/15 px-1.5 py-0.5 text-2xs font-semibold text-[hsl(var(--primary))]"
            >
              unsaved
            </span>
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
          <QuestionCount
            value={countOf(intent.sid)}
            title={questionsThat(countOf(intent.sid), 'goes here', 'go here')}
            strong
          />
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
              ruleSources={ruleSources(intent.sid)}
              versions={intentVersions[String(intent.sid)] ?? []}
                onView={onView}
              viewingVersionNo={viewingVersionNo}
              viewingLabel={viewingLabel}
              onRestore={onRestore}
              intent={intent}
              within={takeableFrom(intent.sid)}
              pending={pendingFor(intent.sid)}
              readOnly={readOnly}
              saving={saving}
              dirty={dirty}
              savedVersionNo={savedVersionNo}
              onSaveVersion={onSaveVersion}
              onRevert={onRevert}
              draftChanged={draftChanged}
              onChange={(fields) => patch(intent.sid, fields)}
              onApply={() => onApply(draft, intent.sid)}
              onDelete={async () => {
                await onApply(
                  { ...draft, intents: removeIntent(draft.intents, intent.sid) },
                  null
                );
                // Its row is gone, so the selection that pointed at it has to
                // land somewhere that still exists.
                setSelection({ kind: 'root' });
              }}
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
              <li className="pt-1.5">{form(intent.sid, intent.title.trim() || 'Untitled')}</li>
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
          <div className="my-1.5">{form(null, 'Uncategorized')}</div>
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
                fromRow: null,
              });
              // And put the pile it carves from on the screen: the middle
              // column lists whatever is selected, so leaving the selection on
              // some other intent meant writing a description for questions
              // while looking at a different set of them.
              setSelection({ kind: 'root' });
            }}
            /* The same box as an intent row — same width, same left edge, so
               its words line up with every title above — but dashed and
               without a fill, so neither the row nor its hover can be taken
               for one of them. The border is paid for out of the padding, so
               the height still matches. Set apart from both neighbours,
               because it is a different kind of thing standing between two
               lists of the same kind. */
            className="my-1.5 w-full flex items-center gap-1.5 pl-[calc(0.5rem-1px)] pr-[calc(0.5rem-1px)] py-[3px] rounded-lg border border-dashed border-[hsl(var(--border))] text-left text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
          >
            {/* In the slot the rows put their dot in, for the same reason:
                one place every title starts. It is the only glyph left that
                is not a dot, which is the whole of what it has to say. */}
            <Plus className="w-3.5 h-3.5 shrink-0" />
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
          setCreating(null);
        }}
      >
        <span aria-hidden className="w-3.5 shrink-0 flex justify-center">
          {/* Grey, and the same grey the list uses for a question no intent
              claimed — so the key is complete: every dot in the list has a row
              here to match it to. */}
          <span className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--muted-foreground))]" />
        </span>
        <span className="flex-1 text-sm font-semibold">Uncategorized</span>
        {!readOnly && unsaved.has(0) && (
          <span
              title="Applied, and not in what the next step will read. Deploy keeps it."
              className="shrink-0 rounded-full bg-[hsl(var(--primary))]/15 px-1.5 py-0.5 text-2xs font-semibold text-[hsl(var(--primary))]"
            >
              unsaved
            </span>
        )}
        {judging && <Loader2 className="w-3 h-3 animate-spin text-[hsl(var(--muted-foreground))]" />}
        <QuestionCount
          value={countOf(null)}
          title={questionsThat(countOf(null), 'is claimed by no intent', 'are claimed by no intent')}
          strong
        />
      </div>

      {!creating && selection.kind === 'root' && (
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
            <AutoTextarea
              value={draft.rootRule}
              readOnly={readOnly}
              maxLength={STUDY_PROMPT_CHAR_LIMIT}
              onChange={(e) => setDraft({ ...draft, rootRule: e.target.value })}
            />
          </Field>
          {!readOnly && (
            <div className="flex items-center gap-2">
              <ApplyButton
                saving={saving}
                disabled={!draftChanged}
                onClick={() => void onApply(draft, null)}
              />
              <Why
                reason={
                  saving
                    ? 'Waiting for the last change to land'
                    : draftChanged
                      ? 'Apply these edits first — Save keeps what is in effect'
                      : dirty
                        ? 'Keep the whole configuration as a version you can come back to'
                        : 'Nothing has changed since the last save'
                }
              >
                <button
                  onClick={() => void onSaveVersion()}
                  disabled={saving || !dirty || draftChanged}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[hsl(var(--border))] px-3 py-1.5 text-sm font-semibold hover:bg-[hsl(var(--muted))] disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  Save
                </button>
              </Why>
            </div>
          )}
          <IntentHistory
            delivered
            versions={intentVersions['0'] ?? []}
            pending={pendingFor(0)}
            onView={onView}
            viewingVersionNo={viewingVersionNo}
            viewingLabel={viewingLabel}
            onRestore={onRestore}
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
  ruleSources,
  versions,
  onView,
  viewingVersionNo,
  viewingLabel,
  onRestore,
  intent,
  within,
  pending,
  readOnly,
  saving,
  dirty,
  onChange,
  onApply,
  onSaveVersion,
  draftChanged,
  onDelete,
}: {
  api: (path: string, query?: string) => string;
  /** Rules written elsewhere in this configuration, for the reuse picker. */
  ruleSources: RuleSource[];
  /** This intent's own history, newest first. */
  versions: IntentVersion[];
  /** Show the whole board as it was in a version, or the newest when null. */
  onView: (configVersionNo: number | null) => void;
  /** Which version the board is showing, or null when it is on the newest. */
  viewingVersionNo: number | null;
  /** What that version is called. */
  viewingLabel: number | null;
  /** Make the version on screen the newest one again. */
  onRestore: () => void;
  /** The questions this intent could take, for counting starter sets over. */
  within: number[];
  /** Applied and not saved, for the row the next Save will write. */
  pending: { name: string | null; matches: number | null } | null;
  intent: SimpleIntent;
  readOnly: boolean;
  saving: boolean;
  /** Something is in effect that the newest save does not carry. */
  dirty: boolean;
  savedVersionNo: number | null;
  onChange: (fields: Partial<SimpleIntent>) => void;
  onApply: () => void;
  onSaveVersion: () => Promise<void>;
  onRevert: (configVersionNo: number | null) => Promise<void>;
  /** Something is written that has not taken effect. */
  draftChanged: boolean;
  onDelete: () => Promise<void>;
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
            /* An intent already in the list can only take what is at its own
               position and below, same as one being written there. */
            within={within}
            onPick={(starter) =>
              onChange({
                definition: starter.definition,
                ...(intent.title.trim() ? {} : { title: starter.title }),
              })
            }
          />
        }
      >
        <AutoTextarea
          value={intent.definition}
          readOnly={readOnly}
          maxLength={4000}
          onChange={(e) => onChange({ definition: e.target.value })}
          placeholder="asks for…"
        />
      </Field>
      <Field
        label="Then"
        control={
          !readOnly && <RulePicker sources={ruleSources} onPick={(rule) => onChange({ rule })} />
        }
      >
        <AutoTextarea
          value={intent.rule}
          readOnly={readOnly}
          maxLength={STUDY_PROMPT_CHAR_LIMIT}
          onChange={(e) => onChange({ rule: e.target.value })}
          placeholder="What the chatbot should do with those questions."
        />
      </Field>
      {!readOnly && (
        <div className="flex items-center gap-2">
          {/* All three stay put and go dim, rather than coming and going. A row
              of controls that changes shape as you type moves the one you were
              reaching for; and a dimmed Apply says "there is nothing to apply"
              where an absent one says nothing at all. */}
          <ApplyButton saving={saving} disabled={!draftChanged} onClick={onApply} />
          {/* It writes the WHOLE configuration — a version is the whole of it —
              which is why it says so on the way in and why the tree marks every
              intent the save will carry. */}
          <Why
            reason={
              saving
                ? 'Waiting for the last change to land'
                : draftChanged
                  ? 'Apply these edits first — Save keeps what is in effect'
                  : dirty
                    ? 'Keep the whole configuration as a version you can come back to'
                    : 'Nothing has changed since the last save'
            }
          >
            <button
              onClick={() => void onSaveVersion()}
              /* Save keeps what is IN EFFECT, not what is in the boxes, so
                 with unapplied edits sitting there it would keep something
                 other than what is on screen. Apply, look at what it did,
                 then decide whether to keep it. */
              disabled={saving || !dirty || draftChanged}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[hsl(var(--border))] px-3 py-1.5 text-sm font-semibold hover:bg-[hsl(var(--muted))] disabled:opacity-40 disabled:hover:bg-transparent"
            >
              Save
            </button>
          </Why>
          <span className="flex-1" />
          <DeleteIntent onDelete={onDelete} />
        </div>
      )}
      {/* Under the buttons: this intent's own history, laid out rather than
          hidden behind a number. */}
      <IntentHistory
        versions={versions}
        pending={pending}
        onView={onView}
        viewingVersionNo={viewingVersionNo}
        viewingLabel={viewingLabel}
        onRestore={onRestore}
      />
    </div>
  );
}

/**
 * Every text box in this column, so they cannot drift apart one at a time.
 *
 * px-2 with py-1, which is even although the numbers are not. `leading-relaxed`
 * puts half its extra leading above the first line and half below the last —
 * about 4px at this size — so the padding has to be that much smaller to leave
 * the same gap the sides do. Equal numbers leave the text sitting visibly low
 * in its box; the gap that matters is the one to the ink, and it is 8px on all
 * four sides.
 */
const FIELD_BOX =
  'w-full resize-none rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] ' +
  'px-2 py-1 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]';

/** Two lines to start, ten before it stops growing and starts scrolling. */
const FIELD_MIN_LINES = 2;
const FIELD_MAX_LINES = 10;
/**
 * The same idea for the box that is a whole document, with more room before
 * the ceiling. Uncapped it pushed everything under it — the buttons, the
 * history — off the bottom of a long document, which is exactly the reach a
 * ceiling exists to keep.
 */
const FIELD_DOC_MAX_LINES = 20;

// useLayoutEffect measures, so it has to run before the paint — but it does
// not exist on the server, and this file is rendered there too.
const useMeasure = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * A box the size of what is written in it.
 *
 * A fixed height is wrong in both directions at once: a one-line rule sat in
 * six lines of empty box, and a long definition scrolled inside a window a
 * third of its length while the empty box below it waited its turn. This is
 * two lines when there is nothing and grows to ten, after which it scrolls —
 * ten lines is already most of the column, and a box that can eat the page
 * takes the buttons under it off the screen.
 *
 * Measured from the computed style rather than from constants, so it follows
 * the type scale instead of having to be kept in step with it by hand.
 */
function AutoTextarea({
  className = '',
  minLines = FIELD_MIN_LINES,
  maxLines = FIELD_MAX_LINES,
  ...props
}: React.ComponentPropsWithoutRef<'textarea'> & {
  minLines?: number;
  /** Infinity for a box that is a whole document: it grows and the column
   * around it scrolls, rather than scrolling inside a window of its own. */
  maxLines?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useMeasure(() => {
    const el = ref.current;
    if (!el) return;
    const style = getComputedStyle(el);
    const line = parseFloat(style.lineHeight) || 20;
    const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    const frame = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + border;
    // Let it collapse first, or it can only ever grow.
    el.style.height = 'auto';
    const wanted = el.scrollHeight + border;
    const height = Math.min(
      Math.max(wanted, line * minLines + frame),
      line * maxLines + frame
    );
    el.style.height = `${height}px`;
    el.style.overflowY = wanted > height ? 'auto' : 'hidden';
  }, [props.value, minLines, maxLines]);
  return <textarea ref={ref} className={`${FIELD_BOX} ${className}`.trim()} {...props} />;
}

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

/**
 * Deleting an intent, asked twice.
 *
 * It throws away a definition, a rule, the examples chosen for it and its
 * whole history, and it was one click on an icon sitting beside two ordinary
 * verbs. The second press is the whole safeguard, and it is inline rather than
 * a dialog because this board does not open dialogs (§2) — the row it replaces
 * is the row it is about.
 *
 * Its own spinner, too. The delete goes out as an apply, so the shared saving
 * flag used to spin the APPLY button while the trash can was what got pressed:
 * a control reporting on an act nobody asked it to do.
 */
function DeleteIntent({ onDelete }: { onDelete: () => Promise<void> }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!asking) {
    return (
      <button
        onClick={() => setAsking(true)}
        title="Delete this intent"
        aria-label="Delete this intent"
        className="p-1 rounded text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    );
  }
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-2xs text-[hsl(var(--muted-foreground))]">Delete this intent?</span>
      <button
        onClick={async () => {
          setBusy(true);
          try {
            await onDelete();
          } finally {
            setBusy(false);
            setAsking(false);
          }
        }}
        disabled={busy}
        className="inline-flex items-center gap-1 rounded border border-[hsl(var(--border))] px-2 py-0.5 text-2xs font-semibold text-rose-600 hover:bg-[hsl(var(--muted))] disabled:opacity-50 dark:text-rose-400"
      >
        {busy && <Loader2 className="w-3 h-3 animate-spin" />}
        Delete
      </button>
      <button
        onClick={() => setAsking(false)}
        disabled={busy}
        className="rounded px-1.5 py-0.5 text-2xs font-semibold text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
      >
        Cancel
      </button>
    </span>
  );
}

function StepButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: (() => void) | null;
  children: React.ReactNode;
}) {
  // Dim rather than absent: a control that vanishes when there is nothing to
  // do takes its neighbour's position with it, and says nothing about why.
  return (
    <button
      onClick={onClick ?? undefined}
      disabled={!onClick}
      title={label}
      aria-label={label}
      className="inline-flex items-center gap-1 h-5 px-1.5 rounded-lg text-2xs font-semibold text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[hsl(var(--muted-foreground))]"
    >
      {children}
    </button>
  );
}

/**
 * Apply, and a spinner that belongs to the press.
 *
 * It used to turn while ANY write was in flight, because they all share one
 * saving flag — so deleting an intent, which goes out as an apply, spun the
 * Apply button while the trash can was what got pressed. A control should
 * report on what it was asked to do and nothing else. It still greys out for
 * every write, which is right: two at once is not a thing to allow.
 */
/**
 * Why a button will not do anything, on the button that will not do it.
 *
 * A disabled control receives no pointer events, so its own `title` never
 * opens — every reason these two carried had been written and never shown.
 * The reason hangs on a wrapper instead, which is not disabled, so it reads
 * the same whether the button is live or dim.
 */
function Why({ reason, children }: { reason: string; children: React.ReactNode }) {
  return (
    <span title={reason} className="inline-flex">
      {children}
    </span>
  );
}

function ApplyButton({
  saving,
  disabled,
  onClick,
}: {
  saving: boolean;
  /** Nothing written that is not already in effect. */
  disabled: boolean;
  onClick: () => void | Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Why
      reason={
        saving
          ? 'Waiting for the last change to land'
          : disabled
            ? 'Nothing written here that is not already in effect'
            : 'Put this into effect and see what it answers'
      }
    >
      <button
        onClick={async () => {
          setBusy(true);
          try {
            await onClick();
          } finally {
            setBusy(false);
          }
        }}
        disabled={saving || disabled}
        className="inline-flex items-center gap-1.5 rounded-lg bg-[hsl(var(--primary))] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
      >
        {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        Apply
      </button>
    </Why>
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
  takeable,
  within,
  draft,
  onCancel,
  onCreate,
}: {
  api: (path: string, query?: string) => string;
  ruleSources: RuleSource[];
  creating: Creating;
  /** What this one will be tried before. */
  beforeTitle: string;
  /** What is still unclaimed by the time its turn comes: the row it is named
   * after, and everything under that row as one figure. */
  takeable: { here: number; below: number };
  /** The questions it could take, for counting the starter sets over. */
  within: number[];
  draft: SimpleSnapshot;
  onCancel: () => void;
  onCreate: (
    next: SimpleSnapshot,
    focusSid: number | null,
    seed?: { sid: number; messageId: number } | null,
    kind?: 'apply' | 'save'
  ) => Promise<{ created?: number[] } | null>;
}) {
  const [title, setTitle] = useState('');
  const [definition, setDefinition] = useState('');
  const [rule, setRule] = useState(creating.seedRule);
  const [busy, setBusy] = useState(false);

  return (
    <div className="rounded-lg border border-[hsl(var(--primary))]/40 bg-[hsl(var(--background))] p-2.5 space-y-3">
      {/* A title line in the shape of the rows above it, so the card reads as
          one of them being written rather than as a panel hanging off the
          intent above. */}
      <div className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="w-1.5 h-1.5 rounded-full shrink-0 border border-[hsl(var(--primary))]"
        />
        <span className="flex-1 text-sm font-semibold">New intent</span>
      </div>
      {/* Where its questions come from. Position was the only thing the line
          used to state — true, and useless to somebody who has not worked out
          what being read first does. The consequence is the fact worth
          stating: these are the questions still unclaimed at its turn, and the
          intents above keep everything they already have. */}
      <p className="text-2xs leading-snug text-[hsl(var(--muted-foreground))]">
        Read before “{beforeTitle}”, so any of its{' '}
        <span className="font-semibold text-[hsl(var(--foreground))]">
          {takeable.here} question{takeable.here === 1 ? '' : 's'}
        </span>{' '}
        can come here
        {takeable.below > 0 ? `, and anything below it this also describes` : ''}. Nothing
        above it moves.
      </p>
      {creating.fromRow && (
        // The question that prompted this, drawn the way the list draws it —
        // same token, same turn, same tags for pasted material — so it reads
        // as the row it is rather than as a quotation of something else.
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-2 py-1.5">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-2xs font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
              Started from
            </span>
            <span className="text-2xs font-mono text-[hsl(var(--muted-foreground))]">
              {creating.fromRow.participantToken} · {creating.fromRow.turnNumber}
            </span>
          </div>
          <div className="text-sm leading-snug">
            <QuerySnippet
              text={creating.fromRow.queryText}
              dissection={creating.fromRow.dissection}
              max={150}
            />
          </div>
        </div>
      )}
      <Field
        label="When a question…"
        control={
          <StarterPicker
            api={api}
            disabled={busy}
            forMessageId={creating.fromMessageId}
            within={within}
            onPick={(starter) => {
              setDefinition(starter.definition);
              if (!title.trim()) setTitle(starter.title);
            }}
          />
        }
      >
        <AutoTextarea
          value={definition}
          autoFocus
          readOnly={busy}
          maxLength={4000}
          onChange={(e) => setDefinition(e.target.value)}
          placeholder="asks for…"
          className={busy ? 'opacity-60' : ''}
        />
      </Field>
      <Field
        label="Then"
        control={!busy && <RulePicker sources={ruleSources} onPick={setRule} />}
      >
        <AutoTextarea
          value={rule}
          readOnly={busy}
          maxLength={STUDY_PROMPT_CHAR_LIMIT}
          onChange={(e) => setRule(e.target.value)}
          className={busy ? 'opacity-60' : ''}
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
          {busy ? 'Adding…' : 'Add'}
        </button>
        <button
          onClick={onCancel}
          disabled={busy}
          className="text-xs font-semibold px-2 py-1 rounded border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] disabled:opacity-40 disabled:hover:bg-transparent"
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

/* =================================================================== */
/* Middle: the questions                                               */
/* =================================================================== */

/**
 * Write the examples, and say so while it is happening.
 *
 * Three invented questions is a model call — a couple of seconds — and until
 * it came back the list sat there unchanged, which reads as a button that did
 * nothing and invites a second press. The spinner belongs to this press, like
 * Apply's does, rather than to a flag shared with every other write.
 */
/** What the server writes when it is asked for a set — mirrors EXAMPLE_COUNT
 * in lib/study/simple/anchors.ts, where the number and the reasons for it are. */
const EXAMPLES_WANTED = 3;

/**
 * One invented example, which can be rewritten.
 *
 * The set is what the list below is ordered against, so a wording somebody
 * disagrees with is worth a correction rather than a delete and a regenerate:
 * the model's guess at what the category sounds like is a starting point, and
 * the participant is the one who knows.
 */
function WrittenExample({
  text,
  onEdit,
  onDrop,
}: {
  text: string;
  onEdit: ((text: string) => void) | null;
  onDrop: (() => void) | null;
}) {
  const [draft, setDraft] = useState(text);
  const [editing, setEditing] = useState(false);
  // The row is not editing, so it follows whatever the set says.
  if (!editing && draft !== text) setDraft(text);

  const keep = () => {
    setEditing(false);
    const next = draft.trim();
    if (next.length > 0 && next !== text) onEdit?.(next);
    else setDraft(text);
  };

  return (
    <li className="group flex gap-2 px-3 py-2 border-b border-[hsl(var(--border))]">
      {editing ? (
        <textarea
          autoFocus
          value={draft}
          rows={2}
          maxLength={500}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={keep}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setDraft(text);
              setEditing(false);
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              keep();
            }
            e.stopPropagation();
          }}
          className="flex-1 min-w-0 resize-none rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1 text-sm leading-snug focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
        />
      ) : (
        <button
          type="button"
          disabled={!onEdit}
          onClick={() => setEditing(true)}
          title={onEdit ? 'Rewrite this example' : undefined}
          className="flex-1 min-w-0 text-left text-sm leading-snug text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] disabled:hover:text-[hsl(var(--muted-foreground))]"
        >
          {text}
        </button>
      )}
      {onDrop && !editing && (
        <button
          aria-label="Drop this example"
          title="Drop this example"
          onClick={onDrop}
          className="self-start p-1 rounded opacity-0 group-hover:opacity-100 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--background))]"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </li>
  );
}

function GenerateExamples({ full, onClick }: { full: boolean; onClick: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      onClick={async () => {
        setBusy(true);
        try {
          await onClick();
        } finally {
          setBusy(false);
        }
      }}
      disabled={busy}
      title="Write examples from the description. Any written ones here are replaced; questions you added are kept."
      className="shrink-0 inline-flex h-5 items-center gap-1 rounded border border-[hsl(var(--border))] px-1.5 text-2xs font-semibold leading-none hover:bg-[hsl(var(--muted))] disabled:opacity-60 disabled:hover:bg-transparent"
    >
      {busy && <Loader2 className="w-3 h-3 animate-spin" />}
      {busy ? 'Writing…' : full ? 'Update examples' : 'Generate examples'}
    </button>
  );
}

function QuestionColumn({
  rows,
  pinnedRows,
  exampleRows,
  onDropExample,
  onEditExample,
  onRegenerateExamples,
  onAddExample,
  furthest,
  onFlipOrder,
  allCount,
  definition,
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
  arm,
  judging,
}: {
  rows: ScoreQueryRow[];
  pinnedRows: ScoreQueryRow[];
  /** What the open intent stands for: questions from the log, or written
   * ones with no row of their own. */
  exampleRows: { id: number; text: string | null; row: ScoreQueryRow | null }[];
  onDropExample: ((exampleId: number) => void) | null;
  /** Rewrite one of the written ones. Null where nothing may be changed. */
  onEditExample: ((exampleId: number, text: string) => void) | null;
  /** Awaited, so the button can say it is working: writing three examples is
   * a model call, and it took seconds with nothing on screen to show for it. */
  onRegenerateExamples: (() => Promise<void>) | null;
  onAddExample: ((messageId: number) => void) | null;
  /** Reading the list from the far end rather than the near one. */
  furthest: boolean;
  onFlipOrder: (() => void) | null;
  allCount: number;
  /** The open intent's own words — what this list is a list OF. */
  definition: string;
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
  arm: 'score' | 'baseline';
  judging: boolean;
}) {
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
    arm === 'baseline'
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
                onSelect={onSelect}
                onTogglePin={onTogglePin}
                onCreateIntent={onCreateIntent}
                onAddExample={null}
              />
            ))}
          </ul>
        </section>
      )}

      {/* What this intent stands for, above the list it puts in order.
          A question from the log keeps its ownership chip here, so an example
          that went somewhere else says so from inside the set it was added to
          — adding one changes the ORDER of the list and nothing else; the
          words are what decide where a question goes. */}
      {exampleRows.length > 0 && (
        <section className="shrink-0 max-h-[13rem] flex flex-col rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-hidden">
          {/* items-center, and the same padding as the headers beside it: on
              a baseline the descenders of the controls hang below the heading
              and push the row a pixel taller than the two columns it sits
              between. */}
          <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-[hsl(var(--border))]">
            <span className="text-sm font-semibold">Examples</span>
            <span className="text-2xs tabular-nums text-[hsl(var(--muted-foreground))]">
              {exampleRows.length}
            </span>
            <span className="flex-1" />
            {/* Beside the thing it sorts BY, which is what let the caption go: a
                control offering closest and furthest, sitting in the Examples
                header, says "the list is ordered by these" without a sentence
                saying it. Two choices with the current one filled, because a lone
                phrase cannot say whether it is describing the order or offering
                it. */}
              {onFlipOrder && exampleRows.length > 0 && (
                /* h-5, like every other control that sits in a header row:
                   the text these hold is smaller than a heading but their
                   padding and borders are not, and two pixels of that made
                   this box taller than the two columns beside it. */
                <span className="shrink-0 inline-flex h-5 items-center overflow-hidden rounded border border-[hsl(var(--border))]">
                  {(
                    [
                      ['Closest first', false],
                      ['Furthest first', true],
                    ] as const
                  ).map(([label, wantsFurthest]) => (
                    <button
                      key={label}
                      onClick={() => {
                        if (wantsFurthest !== furthest) onFlipOrder();
                      }}
                      aria-pressed={furthest === wantsFurthest}
                      title={
                        wantsFurthest
                          ? 'Order the list by what is least like these — where the next intent usually comes from'
                          : 'Order the list by what is closest to these'
                      }
                      className={`h-full px-1.5 text-2xs font-semibold leading-none ${
                        furthest === wantsFurthest
                          ? 'bg-[hsl(var(--foreground))] text-[hsl(var(--background))]'
                          : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </span>
              )}
            {onRegenerateExamples && (
              // The press does two different things and should say which. With
              // room left it writes into the gap; with the set full every
              // written one is replaced. "Rewrite" was wrong for the first
              // case and "Generate" is wrong for the second.
              <GenerateExamples
                full={exampleRows.length >= EXAMPLES_WANTED}
                onClick={onRegenerateExamples}
              />
            )}
          </div>
          <ul className="flex-1 min-h-0 overflow-y-auto">
            {exampleRows.map((example) =>
              example.row ? (
                <QuestionRow
                  key={`ex-${example.id}`}
                  row={example.row}
                  selected={selectedMessageId === example.row.messageId}
                  pinned={pinnedSet.has(example.row.messageId)}
                  owner={ownerOf(example.row.messageId)}
                  titleOf={titleOf}
                  showOwner={arm === 'score'}
                  onSelect={onSelect}
                  onTogglePin={onTogglePin}
                  onCreateIntent={null}
                  onDropExample={onDropExample ? () => onDropExample(example.id) : null}
                />
              ) : (
                <WrittenExample
                  key={`ex-${example.id}`}
                  text={example.text ?? ''}
                  onEdit={onEditExample ? (text) => onEditExample(example.id, text) : null}
                  onDrop={onDropExample ? () => onDropExample(example.id) : null}
                />
              )
            )}
          </ul>
        </section>
      )}

      <section className="flex-1 min-h-0 flex flex-col rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-hidden">
      <div className="shrink-0 px-3 py-2 border-b border-[hsl(var(--border))]">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold truncate">{label}</span>
        <span className="shrink-0 whitespace-nowrap text-2xs tabular-nums text-[hsl(var(--muted-foreground))]">
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
        {/* The same fact from the other end. Nearest-first answers "is this
            working"; furthest-first answers "what did my words catch that is
            least like what I meant" — and the row it lands on has the button
            to make an intent out of it. */}
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
      {/* The words this list is a list OF, under the name of the thing they
          define. They live in the card on the left, which is the wrong place
          to read them from while looking at what they caught — the question is
          always "do these words describe these questions", and it cannot be
          asked with the two halves in different columns. */}
      {definition.trim().length > 0 && (
        <p
          title={definition}
          className="mt-1 line-clamp-2 text-2xs leading-relaxed text-[hsl(var(--muted-foreground))]"
        >
          {definition}
        </p>
      )}
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
              highlight={query}
              onSelect={onSelect}
              onTogglePin={onTogglePin}
              onCreateIntent={onCreateIntent}
              onAddExample={onAddExample ? () => onAddExample(row.messageId) : null}
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
  highlight,
  onSelect,
  onTogglePin,
  onCreateIntent,
  onAddExample = null,
  onDropExample = null,
}: {
  row: ScoreQueryRow;
  selected: boolean;
  pinned: boolean;
  owner: Owner | null;
  titleOf: (sid: number | null) => string;
  showOwner: boolean;
  /** The search term, marked wherever it appears in the student's words. */
  highlight?: string;
  onSelect: (id: number) => void;
  onTogglePin: (id: number) => void;
  onCreateIntent: ((id: number) => void) | null;
  /** Offered while an intent is open: make this one of the questions its
   * list is ordered by. It does not put the question in the intent. */
  onAddExample?: (() => void) | null;
  /** Set on the example rows themselves. */
  onDropExample?: (() => void) | null;
}) {
  return (
    <li
      onClick={() => onSelect(row.messageId)}
      className={`group flex gap-2 px-3 py-2 border-b border-[hsl(var(--border))] cursor-pointer ${
        selected ? 'bg-[hsl(var(--primary))]/8' : 'hover:bg-[hsl(var(--muted))]'
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-2xs font-mono text-[hsl(var(--muted-foreground))]">
            {row.participantToken} · {row.turnNumber}
          </span>
          {showOwner && owner && (
            // Where the question goes, stated and not interpreted (§5.4), and
            // unboxed: the row already carries tinted chips for pasted
            // material, so a second filled chip on the same line was two
            // colour languages an inch apart. The dot does the colour, which
            // also keeps it quiet enough to repeat sixty times.
            <OwnerMark
              sid={owner.sid}
              title={titleOf(owner.sid)}
              pending={owner.outcome === 'pending'}
            />
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
        {onDropExample && (
          <IconButton
            label="Drop this example"
            onClick={onDropExample}
            className="opacity-0 group-hover:opacity-100 text-[hsl(var(--muted-foreground))]"
          >
            <X className="w-3.5 h-3.5" />
          </IconButton>
        )}
        {onAddExample && (
          <IconButton
            label="Use as an example — it orders the list, it does not move the question"
            onClick={onAddExample}
            className="opacity-0 group-hover:opacity-100 text-[hsl(var(--muted-foreground))]"
          >
            <Sparkles className="w-3.5 h-3.5" />
          </IconButton>
        )}
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
 * Where a question goes, said as quietly as a fact can be said.
 *
 * A dot in the intent's colour and its name, at the smallest size on the
 * board. It used to be a filled chip in the list and a sentence — "answered by
 * X" — over the reply, which made the same small fact look like two different
 * announcements, and the sentence competed with the reply it was labelling.
 * Grey for the else branch, because "nothing claimed this" is a different kind
 * of answer from "I put it here".
 */
function OwnerMark({
  sid,
  title,
  pending = false,
}: {
  sid: number | null;
  title: string;
  pending?: boolean;
}) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1 text-2xs text-[hsl(var(--muted-foreground))]">
      {!pending && (
        <span
          aria-hidden
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{
            backgroundColor: sid == null ? 'hsl(var(--muted-foreground))' : intentColor(sid),
          }}
        />
      )}
      <span className="truncate">{pending ? 'working it out' : title}</span>
    </span>
  );
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
  snapshot,
  owners,
  seedPrompt,
  atTip,
  intentVersions,
  unsavedSids,
  viewingVersionNo,
  localVersionNo,
  setLocalVersionNo,
  onLocalVersionLog,
}: {
  api: (path: string, query?: string) => string;
  rows: ScoreQueryRow[];
  row: ScoreQueryRow | null;
  isNirvana: boolean;
  /** The configuration in force, and who answers what under it. Together with
   * the assignment's own prompt they settle the commonest case on this screen
   * without a round trip: a rule nobody has changed. */
  snapshot: SimpleSnapshot;
  owners: Record<string, Owner>;
  seedPrompt: string;
  atTip: boolean;
  /** sid → that intent's own history, newest first ('0' = the else-rule). */
  intentVersions: Record<string, IntentVersion[]>;
  /** Which intents have a wording applied and not saved. */
  unsavedSids: number[];
  viewingVersionNo: number | null;
  localVersionNo: number | 'original' | null;
  setLocalVersionNo: (v: number | 'original' | null) => void;
  onLocalVersionLog: (versionNo: number | null) => void;
}) {
  const [answer, setAnswer] = useState<{
    messageId: number;
    versionNo: number | null;
    text: string;
    state: 'idle' | 'streaming' | 'ready' | 'pending' | 'failed' | 'original';
    /**
     * WHICH intent answered, not what it is called.
     *
     * The name used to be resolved here, which put `titleOf` in this effect's
     * dependencies — and `titleOf` reads the draft, so it was a new function on
     * every keystroke. Typing in a rule box re-ran this effect, aborted the
     * reply and fetched it again, letter by letter: a spinner that never
     * settled, and a model call per keystroke on a cache miss. The id is
     * stable; the name is looked up where it is drawn.
     */
    ownerSid: number | null;
  } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // "As delivered" is not a version, so it resolves to no version at all and
  // short-circuits the round trip: the reply it asks for is already below.
  const asDelivered = localVersionNo === 'original';
  /** A wording chosen off the answering intent's own list, by row id. */
  const pickedVersionId = typeof localVersionNo === 'number' ? localVersionNo : null;
  const versionNo = askedVersionNo({
    pick: pickedVersionId != null ? null : localVersionNo,
    atTip,
    viewingVersionNo,
  });

  /**
   * The rule this reply came out of.
   *
   * Read separately from the reply because a rule runs to thousands of
   * characters — too much for a response header, and the streaming path has
   * nowhere else to carry it. Asking for it on its own also means there is one
   * place the screen learns the rule from, rather than one for a cache hit and
   * another for a miss.
   */
  /**
   * The rule that applies here, worked out locally when it can be.
   *
   * At the tip the board already holds both halves — which intent owns this
   * question, and what that intent's rule says — so asking the server is
   * asking it something it has just been told. Older versions are a different
   * snapshot and still have to be fetched.
   *
   * Null means "not known without asking", not "no rule".
   */
  const knownRule = useMemo(() => {
    if (!row || !atTip || versionNo != null || pickedVersionId != null) return null;
    const owner = owners[String(row.messageId)];
    if (snapshot.arm === 'score' && (!owner || owner.outcome === 'pending')) return null;
    return ruleForOwner(snapshot, snapshot.arm === 'score' ? owner?.sid ?? null : null);
  }, [atTip, owners, pickedVersionId, row, snapshot, versionNo]);

  /**
   * Whether the answer here IS the delivered one.
   *
   * A rule still identical to the assignment's own prompt produces the reply
   * already on the screen, and the server says so — but saying so costs a
   * round trip, and during it the bar had nothing to show and blinked out.
   * Untouched is the state every block opens in, so that was every question
   * anyone clicked on their first pass.
   */
  const knownOriginal = knownRule != null && knownRule === seedPrompt;

  /** Who answers this one, from the answer when it is this one's and from the
   * board's own ownership map before that. */
  const ownerSidNow =
    answer?.messageId === row?.messageId
      ? answer?.ownerSid ?? null
      : row && snapshot.arm === 'score'
        ? owners[String(row.messageId)]?.sid ?? null
        : null;

  /**
   * What the reply below is doing, decided at RENDER rather than by the effect.
   *
   * The effect runs after the paint, so on the frame a new question arrives —
   * or a new rule is applied to this one — the answer still belongs to the old
   * state and every "is this generated?" test came out false. For one paint the
   * thread therefore showed the DELIVERED reply, and then swapped it for the
   * one the rule produced. Two answers in a row, the first of them wrong, on
   * every click: exactly the flicker this reads ahead to avoid.
   *
   * `original` is the one case that can be settled without asking, and it is
   * settled here too — a rule still equal to the assignment's own prompt
   * produces the reply already on the screen, so that one must NOT wait.
   */
  const reply: 'original' | 'working' | 'shown' | 'failed' =
    answer && row && answer.messageId === row.messageId
      ? answer.state === 'original'
        ? 'original'
        : answer.state === 'failed'
          ? 'failed'
          : answer.text.length > 0
            ? 'shown'
            : 'working'
      : knownOriginal
        ? 'original'
        : 'working';

  const [rule, setRule] = useState<string | null>(null);
  useEffect(() => {
    if (!row) {
      setRule(null);
      return;
    }
    if (knownRule != null) {
      setRule(knownRule);
      return;
    }
    let cancelled = false;
    (async () => {
      const res = await fetch(
        api(
          'respond',
          `messageId=${row.messageId}${versionNo != null ? `&versionNo=${versionNo}` : ''}${
            pickedVersionId != null ? `&intentVersionId=${pickedVersionId}` : ''
          }`
        )
      );
      if (!res.ok || cancelled) return;
      const body = await res.json();
      if (!cancelled) setRule(typeof body.rule === 'string' ? body.rule : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [api, knownRule, pickedVersionId, row, versionNo]);

  useEffect(() => {
    if (!row) {
      setAnswer(null);
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const messageId = row.messageId;

    if (asDelivered || knownOriginal) {
      // Nothing to ask for and nothing to wait through: the reply this asks
      // about is already in the thread below.
      setAnswer({
        messageId,
        versionNo,
        text: '',
        state: 'original',
        ownerSid:
          snapshot.arm === 'score' ? owners[String(messageId)]?.sid ?? null : null,
      });
      return;
    }

    (async () => {
      // Working, from the moment the request goes out. Getting here at all
      // means a generation is coming — the untouched-rule case never reaches
      // it — so the honest thing to show is that it is being worked out.
      //
      // Two things it must NOT show meanwhile. Not the delivered reply: that
      // is a different answer, and letting it stand for a second before the
      // new one lands makes the screen say the rule did nothing and then
      // change its mind. Not an empty bubble either, which on the rows that
      // never had a delivered reply read as "No reply was delivered for this
      // question". The text it already had is kept when there is one; the bar
      // above says it is working either way.
      setAnswer((prev) => ({
        messageId,
        versionNo,
        text: prev?.messageId === messageId ? prev.text : '',
        state: 'streaming',
        ownerSid: prev?.messageId === messageId ? prev.ownerSid : null,
      }));
      try {
        const res = await fetch(api('respond'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messageId, versionNo, intentVersionId: pickedVersionId }),
          signal: controller.signal,
        });
        if (!res.ok) {
          setAnswer({ messageId, versionNo, text: '', state: 'failed', ownerSid: null });
          return;
        }
        if (res.headers.get('content-type')?.includes('application/json')) {
          const data = await res.json();
          if (data.status === 'pending') {
            setAnswer({ messageId, versionNo, text: '', state: 'pending', ownerSid: null });
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
              ownerSid: data.sid ?? null,
            });
            return;
          }
          setAnswer({
            messageId,
            versionNo,
            text: data.response ?? '',
            state: 'ready',
            ownerSid: data.sid ?? null,
          });
          return;
        }
        // A miss, and only now: the headers are in, the body is a stream, and
        // there is a real wait to report.
        const ownerHeader = res.headers.get('X-Simple-Owner');
        const ownerSid = ownerHeader && ownerHeader !== 'root' ? Number(ownerHeader) : null;
        const reader = res.body?.getReader();
        if (!reader) return;
        const decoder = new TextDecoder();
        let text = '';
        // Cleared at the FIRST token, not before it: until then the previous
        // answer is the truest thing there is to show.
        let started = false;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          text += decoder.decode(value, { stream: true });
          started = true;
          setAnswer({ messageId, versionNo, text, state: 'streaming', ownerSid });
        }
        setAnswer({ messageId, versionNo, text, state: started ? 'ready' : 'failed', ownerSid });
      } catch (error) {
        if ((error as Error)?.name === 'AbortError') return;
        setAnswer({ messageId, versionNo, text: '', state: 'failed', ownerSid: null });
      }
    })();

    return () => controller.abort();
  }, [api, asDelivered, knownOriginal, owners, pickedVersionId, row, snapshot.arm, versionNo]);

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
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        <ConversationThread
          /* One colour for the question, the reply and the row in the list:
             whatever answers it. */
          accent={
            snapshot.arm === 'score' && ownerSidNow != null ? intentColor(ownerSidNow) : null
          }
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
            // An absent override means the delivered reply, so the working
            // state has to be an override too — with `loading`, which holds
            // the reply's place and shows it being written.
            reply === 'original' || reply === 'failed'
              ? null
              : {
                  messageId: row.messageId,
                  text: answer?.messageId === row.messageId ? answer.text : '',
                  raw: false,
                  loading: reply === 'working',
                }
          }
          responseSlot={
            // On the reply, not in the column header. A rule applies to ONE
            // turn — the question that was selected — and a control at the top
            // of the column read as a setting over the whole conversation. The
            // full version puts the same picker on the same reply, for the
            // same reason.
            <ReplyVersionBar
              /* The wordings THIS intent has had. A whole configuration is a
                 different count and lives on the left; what a reader wants
                 here is "what did this rule say before". */
              versions={intentVersions[String(ownerSidNow ?? 0)] ?? []}
              unsaved={unsavedSids.includes(ownerSidNow ?? 0)}
              pick={localVersionNo}
              /* What is known at RENDER beats what an effect is about to set.
                 The effect runs after the paint, so on the frame a new
                 question arrives the answer still belongs to the old one and
                 the bar drew nothing — a blink on every click, for a state the
                 board could already work out. */
              state={
                answer?.messageId === row.messageId
                  ? answer.state
                  : knownOriginal
                    ? 'original'
                    : 'streaming'
              }
              rule={knownRule ?? (answer?.messageId === row.messageId ? rule : null)}
              onPick={(next) => {
                setLocalVersionNo(next);
                onLocalVersionLog(typeof next === 'number' ? next : null);
              }}
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
/**
 * What this one reply is, and what else it could be — on the reply itself.
 *
 * It replaced a note beside the reply and a picker in the column header, which
 * between them made one claim in two places and put the control over one turn
 * where it read as a setting over the whole conversation. A rule applies to the
 * question that was selected; the turns around it are context, delivered as
 * they were. The full version puts the same picker in the same place.
 *
 * WHAT IT OFFERS IS THIS INTENT'S OWN WORDINGS — v1, v2, the same numbers its
 * card carries. The whole configuration is counted too, but that count is the
 * left column's business; the question here is "what did this rule say
 * before", and answering it with a configuration number made the reader map
 * one onto the other in their head.
 *
 * What is applied on top of the newest save has no number, because an apply is
 * not a version — it reads "Now (unsaved)", which is what the tree and the card
 * say about it too.
 *
 * "Original (as delivered)" is not a version and is offered as its own answer:
 * it is the reply the student was actually given, which no configuration can
 * produce and which is the only fixed point to compare the rest against.
 */
function ReplyVersionBar({
  versions,
  unsaved,
  pick,
  state,
  rule,
  onPick,
}: {
  /** This intent's own history, newest first. */
  versions: IntentVersion[];
  /** Its wording is applied and not saved, which is a thing to look at too. */
  unsaved: boolean;
  /** What was chosen here: one of those rows by id, the delivered reply, or
   * nothing — which means whatever is in effect. */
  pick: number | 'original' | null;
  state: 'idle' | 'streaming' | 'ready' | 'pending' | 'failed' | 'original';
  /** The rule this reply came out of — the one for the version above. */
  rule: string | null;
  onPick: (next: number | 'original' | null) => void;
}) {
  // Nothing to report yet: the reply below is still the delivered one and the
  // question of which version it is under has no answer.
  if (state === 'idle') return null;
  if (state === 'pending') {
    return (
      <p className="mb-1 flex items-center gap-1.5 text-2xs text-[hsl(var(--muted-foreground))]">
        <Loader2 className="w-3 h-3 animate-spin" />
        Working out which rule applies to this question.
      </p>
    );
  }
  if (state === 'failed') {
    return (
      <p className="mb-1 text-2xs text-[hsl(var(--muted-foreground))]">
        This reply could not be worked out — pick the question again to retry.
      </p>
    );
  }

  const asDelivered = state === 'original';
  /**
   * What the box says it is showing.
   *
   * A reply that came from no configuration must not be labelled with one.
   * The newest version was standing in as the value whenever nothing had been
   * picked, so an untouched question read "This reply is v1" — a claim that
   * v1 produced it, when what produced it was the assignment's own prompt
   * months ago. Only a version somebody CHOSE keeps its number here.
   */
  const value =
    pick === 'original' || (pick == null && asDelivered)
      ? 'original'
      : pick != null
        ? String(pick)
        : // Nothing chosen: what is in effect, which is the unsaved wording
          // when there is one and otherwise the newest saved.
          unsaved
          ? 'now'
          : String(versions[0]?.id ?? 'now');

  /**
   * And when there is nothing else this reply could be, no box at all.
   *
   * The list is the delivered reply plus one entry per moment, so with a
   * single moment the choice is between the delivered reply and a version
   * that is producing exactly it — one answer wearing two labels. A second
   * moment is where a real comparison begins, because an older one may have
   * caught this question when the newest does not.
   */
  const nothingToCompare = asDelivered && pick == null && versions.length <= 1 && !unsaved;
  if (nothingToCompare) {
    return (
      <p className="mb-1 text-2xs text-[hsl(var(--muted-foreground))]">
        This reply is the one that was delivered.
      </p>
    );
  }
  return (
    /* w-full, because the column it sits in lays its children out from the
       start edge: without it this block is as wide as its widest line, and a
       short rule left the box stopping halfway across the reply it explains. */
    <div className="mb-1 w-full">
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-2xs text-[hsl(var(--muted-foreground))]">
      {state === 'streaming' && <Loader2 className="w-3 h-3 shrink-0 animate-spin" />}
      <span>
        {state === 'streaming'
          ? 'Working out this reply under'
          : asDelivered
            ? 'This reply is'
            : 'This reply is under'}
      </span>
      <select
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          if (next === 'original') return onPick('original');
          // "now" and the newest saved row both mean "whatever is in effect",
          // which is the state that needs no version named for it.
          if (next === 'now') return onPick(null);
          const id = Number(next);
          onPick(!unsaved && id === versions[0]?.id ? null : id);
        }}
        className="rounded border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-1.5 py-0.5 text-2xs font-medium text-[hsl(var(--foreground))]"
      >
        {/* A save is "v3 · what it did"; what is applied on top of it has no
            number because it is not a version. The name is what someone is
            scanning for — the number only says where it sits. */}
        {unsaved && <option value="now">Now (unsaved)</option>}
        {versions.map((v) => (
          <option key={v.id} value={v.id}>
            v{v.versionNo}
            {v.name ? ` · ${v.name}` : ''}
          </option>
        ))}
        {/* Last, because it is the oldest thing here — older than v1, since it
            is what the chatbot said before any of this was written. It used to
            head the list as the "not a version" option, which put the oldest
            answer above the newest and then ran back down through the rest. */}
        <option value="original">Original (as delivered)</option>
      </select>
    </div>
    {/* The rule itself, under the version it belongs to. Two lines by default
        because a rule runs long and the reply is the thing being read; the
        whole of it is one click away. Changing the version above changes this
        with it — that is what a version IS here. */}
    {rule != null && rule.trim().length > 0 && <RuleUnderReply rule={rule} />}
    </div>
  );
}

function RuleUnderReply({ rule }: { rule: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button
      type="button"
      onClick={() => setOpen((v) => !v)}
      title={open ? 'Show less' : 'Show the whole rule'}
      /* Opaque, and its own colour. Muted grey on muted grey is a box you can
         see and text you cannot: sitting on the wash that marks a rewritten
         reply it lost what little contrast it had, and this is the sentence
         that explains the reply under it. */
      className="mt-1 block w-full rounded border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-2 py-1 text-left"
    >
      <span
        className={`block whitespace-pre-wrap text-xs leading-relaxed text-[hsl(var(--foreground))] ${
          open ? '' : 'line-clamp-2'
        }`}
      >
        {rule}
      </span>
    </button>
  );
}
