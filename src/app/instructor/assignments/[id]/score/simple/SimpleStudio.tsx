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
 * Two verbs: Save and Restore. No Try, no Apply, no Deploy — the newest saved
 * version IS the configuration, so there is never a state that is saved but
 * not in effect for the intermediate verbs to name.
 *
 * The screen states facts and does not interpret them. A question that matches
 * the intent you have open but is answered by an earlier one says "applied:
 * that other one" in the same neutral chip every other row uses; it does not
 * get a warning colour, an icon, or a queue to be resolved. Finding the
 * problem, and deciding whether it is one, is the participant's work and is
 * what we are here to watch (§1-4).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, Pin, PinOff, Plus, Trash2 } from 'lucide-react';
import { ConversationThread } from '../conversation';
import { QuerySnippet } from '../materials';
import type { ScoreQueryRow } from '../IntentBoard';
import { logUi, useSurfaceLog } from '@/lib/study/ui-log';
import {
  documentOrder,
  moveSibling,
  removeSubtree,
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
  viewing: SimpleVersion | null;
  atTip: boolean;
  pinned: number[];
  owners: Record<string, Owner>;
  counts: Record<string, number>;
  judged: number;
  pending: number;
  /** The save's own follow-up work is still running on the server. */
  working: boolean;
  diff: { sid: number | null; entered: number[]; left: number[] }[] | null;
}

/** What the middle column is showing. */
type Selection = { kind: 'all' } | { kind: 'root' } | { kind: 'intent'; sid: number };

export default function SimpleStudio({
  assignmentId,
  rows,
  isNirvana,
  initialState,
  viewParam,
}: {
  assignmentId: string;
  rows: ScoreQueryRow[];
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
  const [creatingUnder, setCreatingUnder] = useState<number | null | undefined>(undefined);
  const [selectedMessageId, setSelectedMessageId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [judging, setJudging] = useState(false);
  const [diffFrom, setDiffFrom] = useState<number | null>(null);
  const [localVersionNo, setLocalVersionNo] = useState<number | null>(null);

  const rowById = useMemo(() => new Map(rows.map((r) => [r.messageId, r])), [rows]);
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
      if (!opts?.keepDraft) setDraft(next.snapshot);
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
            priorityMessageIds: [...state.pinned, ...rows.slice(0, 40).map((r) => r.messageId)],
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
  }, [api, arm, load, rows, state.pinned]);

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

  const save = useCallback(
    async (next: SimpleSnapshot, focusSid: number | null) => {
      setSaving(true);
      const previousVersion = state.versions[0]?.versionNo ?? null;
      try {
        const res = await fetch(api('save'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: next.prompt,
            rootRule: next.rootRule,
            intents: next.intents,
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

  /* --------------------------------------------------------------- */
  /* What the middle column lists                                     */
  /* --------------------------------------------------------------- */

  const ownerOf = useCallback(
    (messageId: number): Owner | null => state.owners[String(messageId)] ?? null,
    [state.owners]
  );

  const diffFor = useCallback(
    (sid: number | null) => state.diff?.find((d) => d.sid === sid) ?? null,
    [state.diff]
  );

  const listed = useMemo(() => {
    if (selection.kind === 'all' || arm === 'baseline') return rows;
    if (selection.kind === 'root') {
      return rows.filter((r) => ownerOf(r.messageId)?.sid === null);
    }
    // Everything this intent's own definition describes — including the
    // questions an earlier intent takes first. Hiding those would mean the
    // list answered "what does this definition catch" with a number that has
    // already been adjusted for something the participant cannot see.
    const sid = selection.sid;
    const left = new Set(diffFor(sid)?.left ?? []);
    return rows.filter((r) => {
      const owner = ownerOf(r.messageId);
      return owner?.sid === sid || owner?.matchedElsewhere.includes(sid) || left.has(r.messageId);
    });
  }, [arm, diffFor, ownerOf, rows, selection]);

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
      ? 'Everything else'
      : draft.intents.find((i) => i.sid === sid)?.title.trim() ||
        state.snapshot.intents.find((i) => i.sid === sid)?.title.trim() ||
        'Untitled';

  return (
    <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)_minmax(0,1.05fr)] gap-3">
      <ConfigColumn
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
        creatingUnder={creatingUnder}
        setCreatingUnder={setCreatingUnder}
        onSave={save}
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
        rows={listed}
        pinnedRows={pinnedRows}
        allCount={rows.length}
        selection={selection}
        selectedMessageId={selectedMessageId}
        onSelect={setSelectedMessageId}
        onTogglePin={togglePin}
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
        versions={state.versions}
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
  creatingUnder,
  setCreatingUnder,
  onSave,
  onRestore,
  onView,
  assignmentId,
}: {
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
  creatingUnder: number | null | undefined;
  setCreatingUnder: (v: number | null | undefined) => void;
  onSave: (next: SimpleSnapshot, focusSid: number | null) => Promise<void>;
  onRestore: (versionNo: number) => Promise<void>;
  onView: (versionNo: number | null) => void;
  assignmentId: string;
}) {
  const countOf = (sid: number | null) => state.counts[sid === null ? 'root' : String(sid)] ?? 0;

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
            onSave={() => onSave(draft, null)}
          />
        ) : (
          <Tree
            draft={draft}
            setDraft={setDraft}
            readOnly={readOnly}
            saving={saving}
            judging={judging}
            selection={selection}
            setSelection={setSelection}
            expanded={expanded}
            setExpanded={setExpanded}
            creatingUnder={creatingUnder}
            setCreatingUnder={setCreatingUnder}
            onSave={onSave}
            countOf={countOf}
            assignmentId={assignmentId}
          />
        )}
      </section>

      <VersionList
        versions={state.versions}
        viewingVersionNo={state.viewing?.versionNo ?? null}
        onView={onView}
      />
    </div>
  );
}

/** The baseline arm's whole configuration: one document, edited in place. */
function PromptEditor({
  draft,
  setDraft,
  readOnly,
  saving,
  onSave,
}: {
  draft: SimpleSnapshot;
  setDraft: (s: SimpleSnapshot) => void;
  readOnly: boolean;
  saving: boolean;
  onSave: () => void;
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
          onClick={onSave}
          disabled={saving}
          className="self-end inline-flex items-center gap-1.5 rounded-lg bg-[hsl(var(--primary))] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Save
        </button>
      )}
    </div>
  );
}

/** The score arm's configuration: one root, a tree under it, editors inline. */
function Tree({
  draft,
  setDraft,
  readOnly,
  saving,
  judging,
  selection,
  setSelection,
  expanded,
  setExpanded,
  creatingUnder,
  setCreatingUnder,
  onSave,
  countOf,
  assignmentId,
}: {
  draft: SimpleSnapshot;
  setDraft: (s: SimpleSnapshot) => void;
  readOnly: boolean;
  saving: boolean;
  judging: boolean;
  selection: Selection;
  setSelection: (s: Selection) => void;
  expanded: number | 'root' | null;
  setExpanded: (e: number | 'root' | null) => void;
  creatingUnder: number | null | undefined;
  setCreatingUnder: (v: number | null | undefined) => void;
  onSave: (next: SimpleSnapshot, focusSid: number | null) => Promise<void>;
  countOf: (sid: number | null) => number;
  assignmentId: string;
}) {
  const childrenOf = (parentSid: number | null) =>
    draft.intents.filter((i) => i.parentSid === parentSid);

  const patch = (sid: number, fields: Partial<SimpleIntent>) =>
    setDraft({
      ...draft,
      intents: draft.intents.map((i) => (i.sid === sid ? { ...i, ...fields } : i)),
    });

  const renderNode = (intent: SimpleIntent, depth: number) => {
    const open = expanded === intent.sid;
    const siblings = childrenOf(intent.parentSid);
    const at = siblings.findIndex((s) => s.sid === intent.sid);
    return (
      <li key={intent.sid}>
        <div
          className={`group flex items-center gap-1.5 pr-2 py-1 rounded-lg cursor-pointer ${
            selection.kind === 'intent' && selection.sid === intent.sid
              ? 'bg-[hsl(var(--primary))]/8'
              : 'hover:bg-[hsl(var(--muted))]'
          }`}
          style={{ paddingLeft: `${0.5 + depth * 0.9}rem` }}
          onClick={() => {
            setSelection({ kind: 'intent', sid: intent.sid });
            setExpanded(open ? null : intent.sid);
            setCreatingUnder(undefined);
            if (!open) logUi(assignmentId, 'intent_open', { sid: intent.sid });
          }}
        >
          {open ? (
            <ChevronDown className="w-3.5 h-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
          )}
          <span className="flex-1 truncate text-sm">{intent.title.trim() || 'Untitled'}</span>
          <span className="text-2xs tabular-nums text-[hsl(var(--muted-foreground))]">
            {countOf(intent.sid)}
          </span>
          {/* Order is meaning here: the first intent that matches a question
              answers it. So it is a control, not a preference. */}
          {!readOnly && (
            <span className="hidden group-hover:flex items-center gap-0.5">
              <OrderButton
                disabled={at <= 0}
                label="Answer earlier"
                glyph="↑"
                onClick={() =>
                  void onSave(
                    { ...draft, intents: moveSibling(draft.intents, intent.sid, -1) },
                    intent.sid
                  )
                }
              />
              <OrderButton
                disabled={at < 0 || at >= siblings.length - 1}
                label="Answer later"
                glyph="↓"
                onClick={() =>
                  void onSave(
                    { ...draft, intents: moveSibling(draft.intents, intent.sid, 1) },
                    intent.sid
                  )
                }
              />
            </span>
          )}
        </div>

        {open && (
          <div style={{ paddingLeft: `${1.4 + depth * 0.9}rem` }} className="pr-2 pb-2">
            <Accordion
              intent={intent}
              readOnly={readOnly}
              saving={saving}
              onChange={(fields) => patch(intent.sid, fields)}
              onSave={() => onSave(draft, intent.sid)}
              onDelete={() =>
                void onSave(
                  { ...draft, intents: removeSubtree(draft.intents, intent.sid) },
                  null
                ).then(() => setExpanded(null))
              }
              onNest={() => setCreatingUnder(intent.sid)}
              nestLabel={`Make one inside “${intent.title.trim() || 'Untitled'}”`}
            />
          </div>
        )}

        {creatingUnder === intent.sid && (
          <div style={{ paddingLeft: `${1.4 + depth * 0.9}rem` }} className="pr-2 pb-2">
            <NewIntent
              parentSid={intent.sid}
              parentTitle={intent.title.trim() || 'Untitled'}
              seedRule={intent.rule}
              draft={draft}
              onCancel={() => setCreatingUnder(undefined)}
              onCreate={(next, sidPlaceholder) => {
                setCreatingUnder(undefined);
                return onSave(next, sidPlaceholder);
              }}
            />
          </div>
        )}

        {childrenOf(intent.sid).length > 0 && (
          <ul>{childrenOf(intent.sid).map((child) => renderNode(child, depth + 1))}</ul>
        )}
      </li>
    );
  };

  return (
    <div className="p-2">
      {/* The root is the else branch: whatever no intent claims lands here. It
          is a rule with no "when", because its when is everything left over. */}
      <div
        className={`flex items-center gap-1.5 px-2 py-1 rounded-lg cursor-pointer ${
          selection.kind === 'root' ? 'bg-[hsl(var(--primary))]/8' : 'hover:bg-[hsl(var(--muted))]'
        }`}
        onClick={() => {
          setSelection({ kind: 'root' });
          setExpanded(expanded === 'root' ? null : 'root');
          setCreatingUnder(undefined);
        }}
      >
        {expanded === 'root' ? (
          <ChevronDown className="w-3.5 h-3.5 text-[hsl(var(--muted-foreground))]" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-[hsl(var(--muted-foreground))]" />
        )}
        <span className="flex-1 text-sm font-semibold">Everything else</span>
        <span className="text-2xs tabular-nums text-[hsl(var(--muted-foreground))]">
          {countOf(null)}
        </span>
        {judging && <Loader2 className="w-3 h-3 animate-spin text-[hsl(var(--muted-foreground))]" />}
      </div>

      {expanded === 'root' && (
        <div className="px-2 pb-2 pt-1">
          <label className="block text-2xs font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))] mb-1">
            Then
          </label>
          <textarea
            value={draft.rootRule}
            readOnly={readOnly}
            maxLength={STUDY_PROMPT_CHAR_LIMIT}
            onChange={(e) => setDraft({ ...draft, rootRule: e.target.value })}
            className="w-full min-h-[10rem] resize-y rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
          />
          {!readOnly && (
            <button
              onClick={() => void onSave(draft, null)}
              disabled={saving}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-[hsl(var(--primary))] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Save
            </button>
          )}
        </div>
      )}

      <ul className="mt-1">{childrenOf(null).map((intent) => renderNode(intent, 0))}</ul>

      {creatingUnder === null && (
        <div className="px-2 pt-1">
          <NewIntent
            parentSid={null}
            parentTitle="Everything else"
            seedRule={draft.rootRule}
            draft={draft}
            onCancel={() => setCreatingUnder(undefined)}
            onCreate={async (next, sid) => {
              // Closed on the way out, not on the way back: leaving the form
              // open after a save invites a second click that writes the same
              // intent again.
              setCreatingUnder(undefined);
              await onSave(next, sid);
            }}
          />
        </div>
      )}

      {!readOnly && creatingUnder !== null && (
        <button
          onClick={() => {
            setCreatingUnder(null);
            setExpanded(null);
          }}
          className="mt-1 w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg border border-dashed border-[hsl(var(--border))] text-sm text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
        >
          <Plus className="w-3.5 h-3.5" /> New intent
        </button>
      )}

      <p className="px-2 pt-2 text-2xs text-[hsl(var(--muted-foreground))] leading-relaxed">
        A question goes to the first intent that matches it, reading top to
        bottom and inside before outside. Anything left over gets the rule
        above.
      </p>
    </div>
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
 * One intent, opened: its two texts side by side, both editable, nothing else.
 *
 * When and Then are the whole model, and they are shown together because the
 * question a participant is actually asking — does this rule go with these
 * questions — cannot be answered by looking at either alone.
 */
function Accordion({
  intent,
  readOnly,
  saving,
  onChange,
  onSave,
  onDelete,
  onNest,
  nestLabel,
}: {
  intent: SimpleIntent;
  readOnly: boolean;
  saving: boolean;
  onChange: (fields: Partial<SimpleIntent>) => void;
  onSave: () => void;
  onDelete: () => void;
  onNest: () => void;
  nestLabel: string;
}) {
  return (
    <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-2.5 space-y-2">
      <input
        value={intent.title}
        readOnly={readOnly}
        maxLength={120}
        onChange={(e) => onChange({ title: e.target.value })}
        placeholder="Name it"
        className="w-full rounded border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-2 py-1 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
      />
      <div>
        <label className="block text-2xs font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))] mb-1">
          When a question…
        </label>
        <textarea
          value={intent.definition}
          readOnly={readOnly}
          maxLength={4000}
          onChange={(e) => onChange({ definition: e.target.value })}
          placeholder="asks for…"
          className="w-full min-h-[5rem] resize-y rounded border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
        />
      </div>
      <div>
        <label className="block text-2xs font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))] mb-1">
          Then
        </label>
        <textarea
          value={intent.rule}
          readOnly={readOnly}
          maxLength={STUDY_PROMPT_CHAR_LIMIT}
          onChange={(e) => onChange({ rule: e.target.value })}
          placeholder="What the chatbot should do with those questions."
          className="w-full min-h-[8rem] resize-y rounded border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
        />
      </div>
      {!readOnly && (
        <div className="flex items-center gap-2">
          <button
            onClick={onSave}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[hsl(var(--primary))] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Save
          </button>
          <button
            onClick={onNest}
            className="text-xs font-semibold px-2 py-1 rounded border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]"
          >
            {nestLabel}
          </button>
          <span className="flex-1" />
          <button
            onClick={onDelete}
            title="Delete this intent and anything inside it"
            className="p-1 rounded text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Writing a new intent: the left column turns into the form, and the rest of
 * the board stays where it is. There is no dialog, because the questions are
 * the material you write a definition from and a dialog would cover them.
 *
 * The rule starts as a copy of the enclosing rule — the one these questions
 * are getting today. A blank box would mean the first save silently takes a
 * chunk of the log to "no instructions at all", which is a change nobody
 * asked for. It is a copy, not an inheritance: editing it never reaches back.
 */
function NewIntent({
  parentSid,
  parentTitle,
  seedRule,
  draft,
  onCancel,
  onCreate,
}: {
  parentSid: number | null;
  parentTitle: string;
  seedRule: string;
  draft: SimpleSnapshot;
  onCancel: () => void;
  onCreate: (next: SimpleSnapshot, focusSid: number | null) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [definition, setDefinition] = useState('');
  const [rule, setRule] = useState(seedRule);
  const [busy, setBusy] = useState(false);

  return (
    <div className="rounded-lg border border-[hsl(var(--primary))]/40 bg-[hsl(var(--background))] p-2.5 space-y-2">
      <p className="text-2xs text-[hsl(var(--muted-foreground))]">
        Inside “{parentTitle}”. It will be tried before that one.
      </p>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        autoFocus
        maxLength={120}
        placeholder="Name it"
        className="w-full rounded border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-2 py-1 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
      />
      <div>
        <label className="block text-2xs font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))] mb-1">
          When a question…
        </label>
        <textarea
          value={definition}
          maxLength={4000}
          onChange={(e) => setDefinition(e.target.value)}
          placeholder="asks for…"
          className="w-full min-h-[5rem] resize-y rounded border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
        />
      </div>
      <div>
        <label className="block text-2xs font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))] mb-1">
          Then
        </label>
        <textarea
          value={rule}
          maxLength={STUDY_PROMPT_CHAR_LIMIT}
          onChange={(e) => setRule(e.target.value)}
          className="w-full min-h-[8rem] resize-y rounded border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
        />
      </div>
      <div className="flex items-center gap-2">
        <button
          disabled={busy || definition.trim().length === 0}
          onClick={async () => {
            setBusy(true);
            // A temporary negative id: the server swaps it for one that
            // outlives every later save, and rewrites any parent pointer to
            // it in the same pass.
            const next: SimpleSnapshot = {
              ...draft,
              intents: documentOrder([
                ...draft.intents,
                { sid: -Date.now(), title, definition, rule, parentSid },
              ]),
            };
            await onCreate(next, null);
            setBusy(false);
          }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[hsl(var(--primary))] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Save
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
    <section className="shrink-0 max-h-[13rem] overflow-y-auto rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
      <ul className="divide-y divide-[hsl(var(--border))]">
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
  selection,
  selectedMessageId,
  onSelect,
  onTogglePin,
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
  selection: Selection;
  selectedMessageId: number | null;
  onSelect: (id: number) => void;
  onTogglePin: (id: number) => void;
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

  const label =
    selection.kind === 'all' || arm === 'baseline'
      ? 'All questions'
      : selection.kind === 'root'
        ? 'Everything else'
        : titleOf(selection.sid);

  return (
    <section className="min-h-0 flex flex-col rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-hidden">
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-[hsl(var(--border))]">
        <span className="text-sm font-semibold truncate">{label}</span>
        <span className="text-2xs tabular-nums text-[hsl(var(--muted-foreground))]">
          {rows.length} of {allCount}
        </span>
        {judging && (
          <span className="flex items-center gap-1 text-2xs text-[hsl(var(--muted-foreground))]">
            <Loader2 className="w-3 h-3 animate-spin" /> working out where questions go
          </span>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {pinnedRows.length > 0 && (
          <div className="sticky top-0 z-10 bg-[hsl(var(--card))] border-b border-[hsl(var(--border))]">
            <p className="px-3 pt-1.5 text-2xs font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
              Kept here
            </p>
            <ul>
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
                />
              ))}
            </ul>
          </div>
        )}
        <ul>
          {rows.map((row) => (
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
              onSelect={onSelect}
              onTogglePin={onTogglePin}
            />
          ))}
          {rows.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-[hsl(var(--muted-foreground))]">
              No questions here yet.
            </li>
          )}
        </ul>
      </div>
    </section>
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
  onSelect,
  onTogglePin,
}: {
  row: ScoreQueryRow;
  selected: boolean;
  pinned: boolean;
  owner: Owner | null;
  titleOf: (sid: number | null) => string;
  showOwner: boolean;
  /** Whether this row moved in or out since the version being compared. */
  tone: 'entered' | 'left' | null;
  onSelect: (id: number) => void;
  onTogglePin: (id: number) => void;
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
            <span
              className={`text-2xs px-1.5 py-0.5 rounded ${
                // A plain statement of where the question goes. Grey when it is
                // somewhere other than what you have open — different, not
                // wrong; no warning colour, no icon (§5.4).
                owner.outcome === 'pending'
                  ? 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]'
                  : 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]'
              }`}
            >
              {owner.outcome === 'pending' ? 'working it out' : `applied: ${titleOf(owner.sid)}`}
            </span>
          )}
        </div>
        <div className="text-sm leading-snug">
          <QuerySnippet text={row.queryText} dissection={row.dissection} max={150} />
        </div>
      </div>
      <button
        title={pinned ? 'Stop keeping this one here' : 'Keep this one in view'}
        onClick={(e) => {
          e.stopPropagation();
          onTogglePin(row.messageId);
        }}
        className={`self-start p-1 rounded ${
          pinned
            ? 'text-[hsl(var(--foreground))]'
            : 'opacity-0 group-hover:opacity-100 text-[hsl(var(--muted-foreground))]'
        } hover:bg-[hsl(var(--background))]`}
      >
        {pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
      </button>
    </li>
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
  versions,
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
  versions: SimpleVersion[];
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
    state: 'streaming' | 'ready' | 'pending' | 'failed';
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
            rest of the board off the one being edited. */}
        {versions.length > 0 && (
          <select
            value={String(versionNo ?? '')}
            onChange={(e) => {
              const picked = e.target.value ? Number(e.target.value) : null;
              setLocalVersionNo(picked);
              onLocalVersionLog(picked);
            }}
            className="text-xs rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-1.5 py-1"
          >
            {versions.map((v) => (
              <option key={v.id} value={v.versionNo}>
                v{v.displayNo}
                {v.name ? ` · ${v.name}` : ''}
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
          expandMaterials
          overrideResponse={
            answer && answer.messageId === row.messageId && answer.state !== 'pending'
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
  state: 'streaming' | 'ready' | 'pending' | 'failed';
  owner: string | null;
}) {
  const text =
    state === 'pending'
      ? 'Working out which rule applies to this question.'
      : state === 'failed'
        ? 'This reply could not be worked out — pick the question again to retry.'
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
