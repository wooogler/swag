'use client';

/**
 * Set curation — the whole tool, one screen.
 *
 * Browsing axis is the classification the system already has: the 4 query types
 * (score_query_types) and, nested under them, the starter subtypes with their
 * judge grades (● clearly_in / ◐ probably_in). Nothing is labelled by hand here;
 * the researcher reads and ASSIGNS — every question lands in review, block-test,
 * or nothing, and the sets are exclusive by construction.
 *
 * Layout, chips and row markup are the studio board's, so a researcher who
 * knows the board can already read this screen.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader2,
  Lock,
  Unlock,
  RefreshCw,
  Settings,
  ClipboardList,
  Plus,
  Scale,
  Trash2,
  X,
  Hammer,
  PlayCircle,
  Check,
} from 'lucide-react';
// Types only — erased at compile, so the build module's server-side imports
// never follow it into the client bundle.
import type { BankBuildResult, MasterBuildResult } from '@/lib/study/build';
import type { ScoreQueryRow } from '@/app/instructor/assignments/[id]/score/IntentBoard';
import { ConversationThread } from '@/app/instructor/assignments/[id]/score/conversation';
import { PaneSearch, QueryTextButton } from '@/app/instructor/assignments/[id]/score/workbench-shared';
import { sortQueryRows, type QuerySortMode } from '@/app/instructor/assignments/[id]/score/query-list';
import StudioShell from '@/app/instructor/assignments/[id]/score/StudioShell';
import AdminNav from '@/components/study/AdminNav';
import { QUERY_TYPE_LABELS, SCORE_QUERY_TYPES, type ScoreQueryType } from '@/lib/score/intents';
import { TYPE_DEFINITIONS } from '@/lib/score/type-prompts';
import { SET_TARGET_LIMITS, type CurationSetKind, type SetTargets } from '@/lib/study/config';
import {
  SURVEY_SCALE_CHOICES,
  SURVEY_SCALE_MIN,
  type SurveyItem,
} from '@/lib/study/survey-items';
import type {
  CurationState,
  CurationSubtype,
  CurationViolation,
  QuestionGrade,
} from '@/lib/study/curation';

/* ── atoms (the board's, copied because they are module-private there) ── */

const TYPE_DOT: Record<ScoreQueryType, string> = {
  planning: 'bg-blue-500',
  translating: 'bg-emerald-500',
  reviewing: 'bg-amber-500',
  drafting: 'bg-violet-500',
};

const SET_LABELS: Record<CurationSetKind, string> = {
  review: 'Review set',
  test: 'Block test',
};

function Badge({ children, tone = 'plain' }: { children: React.ReactNode; tone?: 'plain' | 'warn' | 'ok' }) {
  const cls =
    tone === 'warn'
      ? 'bg-amber-50 text-amber-700 border-amber-200'
      : tone === 'ok'
        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
        : 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] border-[hsl(var(--border))]';
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border tabular-nums ${cls}`}>
      {children}
    </span>
  );
}

function Chip({
  children,
  tone = 'plain',
}: {
  children: React.ReactNode;
  tone?: 'plain' | 'ok' | 'warn' | 'bad' | 'violet';
}) {
  const map = {
    plain: 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] border-[hsl(var(--border))]',
    ok: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    warn: 'bg-amber-50 text-amber-700 border-amber-200',
    bad: 'bg-rose-50 text-rose-700 border-rose-200',
    violet: 'bg-violet-50 text-violet-700 border-violet-200',
  } as const;
  return (
    <span className={`inline-flex items-center gap-1 text-[10.5px] font-semibold px-1.5 py-0.5 rounded border ${map[tone]}`}>
      {children}
    </span>
  );
}

/**
 * Empty a set, or one type's slot in it. Two clicks, never one.
 *
 * What it discards is hand-assigned reading — the only thing on this screen
 * that no amount of re-running gets back — so the first click just arms the
 * button and names the count, and the second does it. Hidden entirely at zero
 * (nothing to empty) and while locked (nothing may change).
 *
 * Visibility is driven by state, not group-hover. The first version passed the
 * variant in as a prop (`reveal="group-hover/card:opacity-100"`) and Tailwind's
 * scanner never saw the candidate there, so the rule was never generated and
 * the icon could not appear at all — a class name only exists if it is written
 * somewhere the scanner reads. Tracking hover here also keeps the card's icon
 * and a row's icon independent, which nested unnamed groups cannot do.
 */
function ClearButton({
  n,
  armed,
  visible,
  onArm,
  onConfirm,
  disabled,
  what,
}: {
  n: number;
  armed: boolean;
  visible: boolean;
  onArm: () => void;
  onConfirm: () => void;
  disabled: boolean;
  what: string;
}) {
  if (n === 0) return <span className="w-4 shrink-0" aria-hidden />;
  if (armed) {
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          onConfirm();
        }}
        disabled={disabled}
        title={`Remove all ${n} from ${what}`}
        className="shrink-0 text-[10px] font-bold px-1 rounded bg-rose-600 text-white disabled:opacity-50"
      >
        {n}?
      </button>
    );
  }
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onArm();
      }}
      disabled={disabled}
      title={`Empty ${what} (${n})`}
      className={`w-4 shrink-0 flex items-center justify-center transition-opacity text-[hsl(var(--muted-foreground))] hover:text-rose-600 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <Trash2 className="w-3 h-3" />
    </button>
  );
}

/* ── clarity sort (admin only) ── */

/**
 * How cleanly a question belongs to the subtype being browsed.
 *
 * Curating is a judgement per question, and the cheap ones are where the
 * classifier is not arguing with itself: this subtype claims the question and
 * nothing else does. The expensive ones are where four subtypes all claim it
 * and the curator has to work out which reading wins. Sorting by that puts the
 * quick calls first, so a timed pass spends its minutes where they are needed.
 *
 * Ranked in two tiers, not one number. Browsing a subtype means looking for
 * questions that ARE it, so a clear claim by the selected subtype outranks a
 * hesitant one OUTRIGHT — no amount of quiet from the rivals promotes a
 * probably_in above a clearly_in. Within a tier the rivals decide, and a rival
 * that only probably claims the question is not really arguing, so it costs
 * half of one that clearly does.
 */
const RIVAL_WEIGHT: Record<string, number> = { clearly_in: 1, probably_in: 0.5 };

interface ClarityRank {
  /** 1 = the selected subtype clearly claims it, 0 = only probably. */
  tier: number;
  /** What the other subtypes take off it — lower is cleaner. */
  contested: number;
}

function clarityRank(
  matches: Record<number, string> | undefined,
  intentId: number
): ClarityRank | null {
  const own = matches?.[intentId];
  if (own === undefined) return null; // not in this subtype at all
  let contested = 0;
  for (const [id, grade] of Object.entries(matches ?? {})) {
    if (Number(id) === intentId) continue;
    contested += RIVAL_WEIGHT[grade] ?? 0;
  }
  return { tier: own === 'clearly_in' ? 1 : 0, contested };
}

/* ── selection model ── */

type Selection =
  /** `type` narrows the set to one type's slot — what the progress card's rows
   *  open. Absent means the whole set. */
  | { kind: 'set'; setKind: CurationSetKind; type?: ScoreQueryType }
  | { kind: 'unassigned' }
  | { kind: 'type'; type: ScoreQueryType }
  | { kind: 'subtype'; intentId: number };

export default function CurationBoard({
  rows,
  initialState,
  initialViolations,
  datasets,
  targets: initialTargets,
  actor,
  isNirvana,
}: {
  rows: ScoreQueryRow[];
  initialState: CurationState;
  initialViolations: CurationViolation[];
  datasets: { key: string; label: string }[];
  targets: SetTargets;
  actor: string;
  isNirvana: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState(initialState);
  const [violations, setViolations] = useState(initialViolations);
  const [targets, setTargets] = useState<SetTargets>(initialTargets);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [surveyOpen, setSurveyOpen] = useState(false);
  const [reRateOpen, setReRateOpen] = useState(false);
  const [selection, setSelection] = useState<Selection>({ kind: 'type', type: 'planning' });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  // The board's own mode, on top of the shared ones. Kept local because it
  // only means anything against a selected subtype, which the instructor
  // board has no notion of.
  const [sort, setSort] = useState<QuerySortMode | 'clarity'>('clarity');
  // Certainty filter. Assembling a set that follows the log's natural
  // certain/boundary mix (design §4) means being able to go looking for each
  // kind, not just for the ambiguous ones.
  const [gradeFilter, setGradeFilter] = useState<'all' | QuestionGrade>('all');
  /** Which clear button is armed, as `${setKind}:${type|'all'}`. Emptying a
   * slot throws away hand-assigned reading — the one thing here that cannot be
   * recomputed — so the first click only arms, and the second is the act. */
  const [armedClear, setArmedClear] = useState<string | null>(null);
  /** Which clear icon is revealed. Two independent keys rather than one, so a
   * row's icon and its card's icon do not fight over the same slot when the
   * pointer is inside both. */
  const [hoverCard, setHoverCard] = useState<CurationSetKind | null>(null);
  const [hoverRow, setHoverRow] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [buildReport, setBuildReport] = useState<BuildResponse | null>(null);

  const locked = !!state.meta.lockedAt;
  const rowById = useMemo(() => new Map(rows.map((r) => [r.messageId, r])), [rows]);
  const questionById = useMemo(
    () => new Map(state.questions.map((q) => [q.messageId, q])),
    [state.questions]
  );
  const memberByMessage = useMemo(
    () => new Map(state.members.map((m) => [m.messageId, m])),
    [state.members]
  );
  const subtypeById = useMemo(
    () => new Map(state.subtypes.map((s) => [s.intentId, s])),
    [state.subtypes]
  );

  /** Set counts per (kind, type) — what the strip and the tree watch. */
  const setCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of state.members) {
      const type = questionById.get(m.messageId)?.queryType ?? m.queryType;
      counts.set(m.setKind, (counts.get(m.setKind) ?? 0) + 1);
      if (type) counts.set(`${m.setKind}:${type}`, (counts.get(`${m.setKind}:${type}`) ?? 0) + 1);
      // Boundary questions per set: the design asks each set to follow the
      // log's natural certain/boundary mix, and that is far easier to hit while
      // assigning than to repair at the end.
      const grade = questionById.get(m.messageId)?.grade ?? m.grade;
      if (grade === 'boundary') {
        counts.set(`${m.setKind}:boundary`, (counts.get(`${m.setKind}:boundary`) ?? 0) + 1);
        if (type) {
          counts.set(
            `${m.setKind}:${type}:boundary`,
            (counts.get(`${m.setKind}:${type}:boundary`) ?? 0) + 1
          );
        }
      }
    }
    return counts;
  }, [state.members, questionById]);

  /**
   * Per subtype, how many of its questions are already in each set —
   * [review, block test].
   *
   * Counted over every subtype a question matches, not the single label frozen
   * on the member row: a question that two subtypes claim is spoken for on both
   * of their rows, which is what the tree is being read to decide. So these
   * columns sum to more than the sets contain, on purpose.
   */
  const assignedBySubtype = useMemo(() => {
    const slot: Record<CurationSetKind, 0 | 1> = { review: 0, test: 1 };
    const tally = new Map<number, [number, number]>();
    for (const m of state.members) {
      const q = questionById.get(m.messageId);
      if (!q) continue;
      const i = slot[m.setKind];
      if (i === undefined) continue;
      for (const intentId of Object.keys(q.matches)) {
        const id = Number(intentId);
        const cur = tally.get(id) ?? ([0, 0] as [number, number]);
        cur[i] += 1;
        tally.set(id, cur);
      }
    }
    return tally;
  }, [state.members, questionById]);

  /**
   * The subtype mix already sitting in one (set, type) slot — what a hover
   * answers. Read live from the judge's verdicts rather than the snapshot on
   * the member row, so it reflects every subtype a question matches, not just
   * the one frozen as its label.
   */
  const subtypeMixFor = useCallback(
    (kind: CurationSetKind, type: ScoreQueryType): [string, number][] => {
      const tally = new Map<string, number>();
      for (const m of state.members) {
        if (m.setKind !== kind) continue;
        const q = questionById.get(m.messageId);
        if ((q?.queryType ?? m.queryType) !== type) continue;
        const titles = Object.entries(q?.matches ?? {})
          .filter(([id, grade]) => grade === 'clearly_in' && subtypeById.has(Number(id)))
          .map(([id]) => subtypeById.get(Number(id))!.title);
        if (titles.length === 0) titles.push('(no subtype claims it)');
        for (const t of titles) tally.set(t, (tally.get(t) ?? 0) + 1);
      }
      return [...tally].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    },
    [state.members, questionById, subtypeById]
  );

  /**
   * What isolating a set of subtypes would cost, before committing to it.
   *
   * Isolation is whole-STUDENT: one question clearly in a demo subtype takes
   * that student's entire log out of circulation. So the number that predicts
   * the damage is the student count, not the subtype's own question count —
   * "Shorten / Trim" is 7 questions and removes 49.
   *
   * Computed here rather than server-side because the board already holds every
   * question with its matches and its participant token; the whole thing is one
   * pass over ~500 rows, and a per-checkbox round trip would make picking feel
   * like committing.
   */
  const { subtypes: allSubtypes, members: allMembers } = state;
  // Material AND isolated: pricing a demo selection means asking what it WOULD
  // cost, and a student already isolated has to price at what un-isolating them
  // would give back.
  const allQuestions = useMemo(
    () => [...state.questions, ...state.isolated],
    [state.questions, state.isolated]
  );
  const demoCost = useMemo(() => {
    const memberIds = new Set(allMembers.map((m) => m.messageId));
    const byToken = new Map<string, typeof allQuestions>();
    for (const q of allQuestions) {
      const list = byToken.get(q.participantToken) ?? [];
      list.push(q);
      byToken.set(q.participantToken, list);
    }
    // Titles, not intent ids: the same subtype title can sit under more than
    // one type, and isolation is declared by title.
    const idsByTitle = new Map<string, number[]>();
    for (const s of allSubtypes) {
      idsByTitle.set(s.title, [...(idsByTitle.get(s.title) ?? []), s.intentId]);
    }

    const costOf = (titles: string[]) => {
      const ids = new Set(titles.flatMap((t) => idsByTitle.get(t) ?? []));
      const tokens = new Set<string>();
      let own = 0;
      for (const q of allQuestions) {
        for (const [id, grade] of Object.entries(q.matches)) {
          if (grade === 'clearly_in' && ids.has(Number(id))) {
            tokens.add(q.participantToken);
            own += 1;
            break;
          }
        }
      }
      let questions = 0;
      let inSet = 0;
      for (const token of tokens) {
        for (const q of byToken.get(token) ?? []) {
          questions += 1;
          if (memberIds.has(q.messageId)) inSet += 1;
        }
      }
      return { students: tokens.size, own, questions, inSet };
    };

    const perTitle = new Map<string, ReturnType<typeof costOf>>();
    for (const title of idsByTitle.keys()) perTitle.set(title, costOf([title]));

    /** Same shape for students named outright — every question is "own". */
    const costOfTokens = (tokens: string[]) => {
      let questions = 0;
      let inSet = 0;
      for (const token of tokens) {
        for (const q of byToken.get(token) ?? []) {
          questions += 1;
          if (memberIds.has(q.messageId)) inSet += 1;
        }
      }
      return { students: tokens.length, own: questions, questions, inSet };
    };
    const perToken = new Map<string, ReturnType<typeof costOfTokens>>();
    for (const token of byToken.keys()) perToken.set(token, costOfTokens([token]));

    return { costOf, perTitle, costOfTokens, perToken };
  }, [allQuestions, allSubtypes, allMembers]);

  /** How many of a set's questions SHOULD be boundary, at the natural ratio. */
  const boundaryTargetFor = useCallback(
    (kind: CurationSetKind) =>
      Math.round(state.naturalBoundaryRatio * targets[kind] * SCORE_QUERY_TYPES.length),
    [state.naturalBoundaryRatio, targets]
  );

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/study/admin/curation/state?ds=${state.dataset.key}`);
    if (!res.ok) return;
    const data = await res.json();
    setState(data.state);
    setViolations(data.violations);
    if (data.targets) setTargets(data.targets);
  }, [state.dataset.key]);

  /** Assign / clear. Optimistic so the click feels instant; the refetch is what
   * makes the counts and violations authoritative. */
  const assign = useCallback(
    async (messageId: number, setKind: CurationSetKind | null) => {
      if (locked) {
        setError('These sets are confirmed — unlock before editing.');
        return;
      }
      setError(null);
      const q = questionById.get(messageId);
      setState((prev) => ({
        ...prev,
        members:
          setKind === null
            ? prev.members.filter((m) => m.messageId !== messageId)
            : [
                ...prev.members.filter((m) => m.messageId !== messageId),
                {
                  messageId,
                  setKind,
                  queryType: q?.queryType ?? null,
                  subtype: null,
                  grade: q?.grade ?? null,
                  position: null,
                },
              ],
      }));

      const res = await fetch('/api/study/admin/curation/member', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ datasetKey: state.dataset.key, messageId, setKind }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.message ?? 'Could not assign.');
      }
      await refresh();
    },
    [locked, questionById, state.dataset.key, refresh]
  );

  const runClear = useCallback(
    async (kind: CurationSetKind, type: ScoreQueryType | null) => {
      setBusy('clear');
      setError(null);
      const res = await fetch('/api/study/admin/curation/clear', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ datasetKey: state.dataset.key, setKind: kind, queryType: type }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.message ?? 'Could not clear.');
      }
      setArmedClear(null);
      await refresh();
      setBusy(null);
    },
    [state.dataset.key, refresh]
  );

  const runClassify = useCallback(async () => {
    setBusy('classify');
    setError(null);
    const res = await fetch('/api/study/admin/curation/classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ datasetKey: state.dataset.key }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(
        data.error === 'openai_not_configured'
          ? 'OPENAI_API_KEY is not configured.'
          : 'Refresh failed.'
      );
    }
    await refresh();
    setBusy(null);
  }, [state.dataset.key, refresh]);

  /**
   * Confirmed sets → the material a participant actually meets. Two steps in
   * one click (reduced masters, then the question bank) because neither is
   * useful alone, and a preview first because both replace what is there.
   */
  const runBuild = useCallback(
    async (apply: boolean) => {
      setBusy(apply ? 'build' : 'build-preview');
      setError(null);
      setBuildReport(null);
      try {
        const res = await fetch('/api/study/admin/curation/build', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apply }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.message ?? 'Build failed.');
          return;
        }
        setBuildReport(data);
        if (apply) await refresh();
      } finally {
        setBusy(null);
      }
    },
    [refresh]
  );

  const toggleLock = useCallback(async () => {
    setBusy('lock');
    setError(null);
    const res = await fetch('/api/study/admin/curation/lock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ datasetKey: state.dataset.key, locked: !locked }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if (data.error === 'validation_failed') {
        setViolations(data.violations ?? []);
        setError('Validation failed — clear the items below.');
      } else {
        setError('Could not change the lock.');
      }
    }
    await refresh();
    setBusy(null);
  }, [locked, state.dataset.key, refresh]);

  const setDemo = useCallback(
    async (titles: string[]) => {
      setBusy('demo');
      setError(null);
      const res = await fetch('/api/study/admin/curation/demo-subtype', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ datasetKey: state.dataset.key, demoSubtypes: titles }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.message ?? 'Could not set the demo subtypes.');
      }
      await refresh();
      setBusy(null);
    },
    [state.dataset.key, refresh]
  );

  const setDemoStudents = useCallback(
    async (tokens: string[]) => {
      setBusy('demo');
      setError(null);
      const res = await fetch('/api/study/admin/curation/demo-participants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ datasetKey: state.dataset.key, demoParticipants: tokens }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.message ?? 'Could not set the isolated students.');
      }
      await refresh();
      setBusy(null);
    },
    [state.dataset.key, refresh]
  );

  /**
   * Open the demo: the participant's own session, straight into the studio, on
   * a workspace holding only the isolated subtypes' conversations. Navigating
   * rather than fetching, so the browser lands there with the participant's
   * session cookie in place.
   *
   * Leaving the demo is a visit to /study/admin — nothing is added to the demo
   * itself, because anything added would be in the recording.
   */
  const runDemo = useCallback(
    async (condition: 'score' | 'baseline') => {
      setBusy(`demo:${condition}`);
      setError(null);
      try {
        const res = await fetch('/api/study/admin/curation/demo/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ datasetKey: state.dataset.key, condition }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.message ?? 'Could not start the demo.');
          setBusy(null);
          return;
        }
        window.location.assign(data.url);
      } catch {
        setError('Could not start the demo.');
        setBusy(null);
      }
    },
    [state.dataset.key]
  );

  /* ── which questions the middle column shows ── */
  const visible = useMemo(() => {
    let ids: number[];
    if (selection.kind === 'set') {
      // Live type, not the member's frozen snapshot — the same rule the card's
      // counts use, so a row of "15" opens fifteen questions.
      ids = state.members
        .filter(
          (m) =>
            m.setKind === selection.setKind &&
            (!selection.type ||
              (questionById.get(m.messageId)?.queryType ?? m.queryType) === selection.type)
        )
        .map((m) => m.messageId);
    } else if (selection.kind === 'unassigned') {
      ids = state.questions.filter((q) => !memberByMessage.has(q.messageId)).map((q) => q.messageId);
    } else if (selection.kind === 'type') {
      ids = state.questions.filter((q) => q.queryType === selection.type).map((q) => q.messageId);
    } else {
      ids = state.questions
        .filter((q) => q.matches[selection.intentId] !== undefined)
        .map((q) => q.messageId);
    }
    let list = ids.map((id) => rowById.get(id)).filter((r): r is ScoreQueryRow => !!r);
    if (gradeFilter !== 'all') {
      list = list.filter((r) => questionById.get(r.messageId)?.grade === gradeFilter);
    }
    if (search.trim()) {
      const needle = search.trim().toLowerCase();
      list = list.filter((r) => r.queryText.toLowerCase().includes(needle));
    }
    if (sort === 'clarity') {
      // Only a subtype selection gives this a subject; anywhere else it falls
      // back rather than silently ordering by nothing.
      if (selection.kind !== 'subtype') return sortQueryRows(list, 'participant-asc');
      const intentId = selection.intentId;
      return list.slice().sort((a, b) => {
        const qa = questionById.get(a.messageId);
        const qb = questionById.get(b.messageId);
        const ra = clarityRank(qa?.matches, intentId);
        const rb = clarityRank(qb?.matches, intentId);
        // Anything the subtype does not claim sinks; it should not be in the
        // list at all, but ordering it rather than throwing keeps the sort
        // total if the filter ever widens.
        if (!ra || !rb) return (rb ? 1 : 0) - (ra ? 1 : 0);
        if (ra.tier !== rb.tier) return rb.tier - ra.tier;
        if (ra.contested !== rb.contested) return ra.contested - rb.contested;
        // Same tier, same contest → the shorter read wins: a question with
        // less conversation in front of it is faster to judge.
        return (qa?.turnIndex ?? 0) - (qb?.turnIndex ?? 0) || a.messageId - b.messageId;
      });
    }
    return sortQueryRows(list, sort);
  }, [selection, state.members, state.questions, memberByMessage, rowById, gradeFilter, search, sort, questionById]);

  const selectedRow = selectedId !== null ? rowById.get(selectedId) ?? null : null;

  const subtypesByType = useMemo(() => {
    const map = new Map<ScoreQueryType, CurationSubtype[]>();
    for (const t of SCORE_QUERY_TYPES) map.set(t, []);
    for (const s of state.subtypes) if (s.type) map.get(s.type)!.push(s);
    for (const list of map.values()) list.sort((a, b) => b.clearlyIn - a.clearlyIn);
    return map;
  }, [state.subtypes]);

  // Counts and the per-set notes live in the cards; anything else (demo
  // isolation, unclassified questions) still needs saying out loud.
  const otherViolations = violations.filter(
    (v) => v.code !== 'count' && v.code !== 'boundary_ratio'
  );

  const header = (
    <div className="flex items-center gap-3">
      <h1 className="text-sm font-semibold">Study Settings</h1>
      <AdminNav current="curation" />
      <div className="flex-1" />
      <div className="flex border border-[hsl(var(--border))] rounded-lg overflow-hidden text-xs font-semibold">
        {datasets.map((d) => (
          <button
            key={d.key}
            onClick={() => router.push(`/study/admin/curation?ds=${d.key}`)}
            className={`px-3 py-1.5 ${
              d.key === state.dataset.key
                ? 'bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]'
                : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]'
            }`}
          >
            {d.key === state.dataset.key ? `${d.label} · ${state.questions.length}` : d.label}
          </button>
        ))}
      </div>
      <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
        researcher <span className="font-semibold text-[hsl(var(--foreground))]">{actor}</span>
      </span>
    </div>
  );

  return (
    <StudioShell header={header}>
      {/* ── strip: set totals, demo isolation, classification, lock ── */}
      <div className="flex items-center gap-2 flex-wrap px-1 pb-2 border-b border-[hsl(var(--border))] mb-3">
        {/* Not disabled by the lock: confirmed sets only forbid a change that
            would isolate a question already in a set, which the server checks
            and reports. */}
        <DemoSubtypePicker
          subtypes={state.subtypes}
          selected={state.meta.demoSubtypes}
          disabled={busy !== null}
          onChange={setDemo}
          costOf={demoCost.costOf}
          perTitle={demoCost.perTitle}
        />
        <DemoStudentPicker
          tokens={state.participantTokens}
          selected={state.meta.demoParticipants}
          disabled={busy !== null}
          onChange={setDemoStudents}
          costOf={demoCost.costOfTokens}
          perToken={demoCost.perToken}
        />
        {(state.meta.demoSubtypes.length > 0 || state.meta.demoParticipants.length > 0) && (
          <>
            {/* Counted from the isolated questions themselves, not summed from
                the two pickers: a named student may also have asked a demo
                subtype, and adding the rows would double them. */}
            <Chip tone="violet">
              {new Set(state.isolated.map((q) => q.participantToken)).size} students ·{' '}
              {state.isolated.length} questions isolated
            </Chip>
            {/* Whole-student isolation almost always overlaps a dataset curated
                before the demo was reserved. Harmless for a dev preview or a
                talk; disqualifying for a video shown to participants — so it is
                stated rather than blocked. */}
            {state.demoSetOverlap > 0 && (
              <Chip tone="warn">{state.demoSetOverlap} also in a set</Chip>
            )}
            {/* The demo runs as a participant, on a workspace built from just
                these conversations — the same screens a participant gets, so
                it doubles as the dev preview and the recording set-up. */}
            <button
              onClick={() => runDemo('score')}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-1 rounded border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] disabled:opacity-50"
              title="Open the SCORE studio for these subtypes, as the participant sees it"
            >
              {busy === 'demo:score' ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <PlayCircle className="w-3 h-3" />
              )}
              Run demo · SCORE
            </button>
            <button
              onClick={() => runDemo('baseline')}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-1 rounded border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] disabled:opacity-50"
              title="Open the baseline studio for these subtypes, as the participant sees it"
            >
              {busy === 'demo:baseline' ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <PlayCircle className="w-3 h-3" />
              )}
              Run demo · Baseline
            </button>
          </>
        )}
        <div className="flex-1" />
        <button
          onClick={runClassify}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] disabled:opacity-50"
        >
          {busy === 'classify' ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          Refresh classification
          <Badge tone={state.missingTypeCount > 0 ? 'warn' : 'plain'}>{state.missingTypeCount} missing</Badge>
        </button>
        <button
          onClick={() => setReRateOpen(true)}
          disabled={busy !== null}
          title="Re-judge the starter subtypes under the current harness"
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] disabled:opacity-50"
        >
          <Scale className="w-3 h-3" />
          Re-rate subtypes
        </button>
        <button
          onClick={() => setSurveyOpen(true)}
          disabled={busy !== null}
          title="Edit the per-block questionnaire"
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] disabled:opacity-50"
        >
          <ClipboardList className="w-3 h-3" />
          Survey
        </button>
        <button
          onClick={() => setSettingsOpen(true)}
          disabled={busy !== null}
          title="Set sizes"
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] disabled:opacity-50"
        >
          <Settings className="w-3 h-3" />
          Set sizes
        </button>
        <button
          onClick={toggleLock}
          disabled={busy !== null}
          className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded border disabled:opacity-50 ${
            locked
              ? 'border-violet-300 bg-violet-50 text-violet-700'
              : 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-white'
          }`}
        >
          {busy === 'lock' ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : locked ? (
            <Unlock className="w-3 h-3" />
          ) : (
            <Lock className="w-3 h-3" />
          )}
          {locked ? 'Unlock' : 'Confirm · lock'}
        </button>
      </div>

      {/* Progress, one card per set. The per-type counts ARE the blocking
          checks, so they are shown as the work rather than as a list of
          errors — a count list of twelve had to be truncated, which hid the
          one violation that was not a count. */}
      <div className="mb-3 grid grid-cols-1 lg:grid-cols-2 gap-2">
        {(Object.keys(SET_LABELS) as CurationSetKind[]).map((kind) => {
          const have = setCounts.get(kind) ?? 0;
          const want = targets[kind] * SCORE_QUERY_TYPES.length;
          const boundaryHave = setCounts.get(`${kind}:boundary`) ?? 0;
          const boundaryWant = boundaryTargetFor(kind);
          const complete = have === want;
          // Violations that belong to this set rather than to a type count.
          const setNotes = violations.filter(
            (v) => v.code === 'boundary_ratio' && v.message.startsWith(kind)
          );
          return (
            <div
              key={kind}
              onMouseEnter={() => setHoverCard(kind)}
              onMouseLeave={() => {
                setHoverCard((c) => (c === kind ? null : c));
                setArmedClear((a) => (a?.startsWith(`${kind}:`) ? null : a));
              }}
              className={`rounded-lg border px-3 py-2 ${
                complete
                  ? 'border-emerald-200 bg-emerald-50/40'
                  : 'border-[hsl(var(--border))] bg-[hsl(var(--card))]'
              }`}
            >
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-[11px] font-bold uppercase tracking-wide">
                  {SET_LABELS[kind]}
                </span>
                <span
                  className={`text-[11px] font-semibold tabular-nums ${
                    complete ? 'text-emerald-700' : 'text-amber-700'
                  }`}
                >
                  {have}/{want}
                </span>
                <span
                  className="text-[10.5px] tabular-nums text-[hsl(var(--muted-foreground))]"
                  title={`${boundaryHave} boundary question(s) — the log's natural ratio (${(state.naturalBoundaryRatio * 100).toFixed(0)}%) implies ${boundaryWant}`}
                >
                  ◐ {boundaryHave}/{boundaryWant}
                </span>
                {/* A set's own note rides on its header line rather than adding
                    a row: the panel is read at a glance, above the work. */}
                {setNotes.map((v, i) => (
                  <span
                    key={i}
                    className={`ml-auto truncate text-[10px] font-semibold ${
                      v.severity === 'error' ? 'text-rose-700' : 'text-amber-700'
                    }`}
                    title={v.message}
                  >
                    {v.severity === 'error' ? '✗' : '⚠'} {v.message}
                  </span>
                ))}
                {!locked && (
                  <span className={setNotes.length ? '' : 'ml-auto'}>
                    <ClearButton
                      n={have}
                      armed={armedClear === `${kind}:all`}
                      visible={hoverCard === kind}
                      onArm={() => setArmedClear(`${kind}:all`)}
                      onConfirm={() => runClear(kind, null)}
                      disabled={busy !== null}
                      what={SET_LABELS[kind]}
                    />
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-x-4">
                {SCORE_QUERY_TYPES.map((type) => {
                  const n = setCounts.get(`${kind}:${type}`) ?? 0;
                  const nBoundary = setCounts.get(`${kind}:${type}:boundary`) ?? 0;
                  const target = targets[kind];
                  const mix = subtypeMixFor(kind, type);
                  // A div rather than a button: the clear control lives inside
                  // it and buttons cannot nest. That control stops propagation,
                  // so emptying a slot never also navigates into it.
                  return (
                    <div
                      key={type}
                      role="button"
                      tabIndex={0}
                      onMouseEnter={() => setHoverRow(`${kind}:${type}`)}
                      onMouseLeave={() => setHoverRow((r) => (r === `${kind}:${type}` ? null : r))}
                      onClick={() => setSelection({ kind: 'set', setKind: kind, type })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelection({ kind: 'set', setKind: kind, type });
                        }
                      }}
                      className={`flex items-center gap-1.5 text-[10.5px] leading-5 -mx-1 px-1 rounded cursor-pointer ${
                        selection.kind === 'set' &&
                        selection.setKind === kind &&
                        selection.type === type
                          ? 'bg-[hsl(var(--muted))]'
                          : 'hover:bg-[hsl(var(--muted))]/60'
                      }`}
                      title={
                        mix.length > 0
                          ? `${QUERY_TYPE_LABELS[type]} — subtypes in this slot\n` +
                            mix.map(([t, c]) => `  ${t} ${c}`).join('\n')
                          : `${QUERY_TYPE_LABELS[type]} — nothing yet`
                      }
                    >
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${TYPE_DOT[type]}`} />
                      <span className="truncate text-[hsl(var(--muted-foreground))]">
                        {QUERY_TYPE_LABELS[type]}
                      </span>
                      <span
                        className={`ml-auto tabular-nums font-semibold ${
                          n === target ? 'text-emerald-700' : 'text-[hsl(var(--muted-foreground))]'
                        }`}
                      >
                        {n}/{target}
                      </span>
                      <span className="tabular-nums text-amber-600 w-6 text-right">
                        ◐{nBoundary}
                      </span>
                      {!locked && (
                        <ClearButton
                          n={n}
                          armed={armedClear === `${kind}:${type}`}
                          visible={hoverRow === `${kind}:${type}`}
                          onArm={() => setArmedClear(`${kind}:${type}`)}
                          onConfirm={() => runClear(kind, type)}
                          disabled={busy !== null}
                          what={`${SET_LABELS[kind]} · ${QUERY_TYPE_LABELS[type]}`}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {(error || locked || otherViolations.length > 0) && (
        <div className="mb-3 space-y-1.5">
          {locked && (
            <div className="rounded-lg border border-violet-200 bg-violet-50/60 px-4 py-2.5">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-xs font-semibold text-violet-800">
                  🔒 Confirmed · {new Date(state.meta.lockedAt!).toLocaleString()} ·{' '}
                  {state.meta.lockedBy}
                </span>
                <div className="flex-1" />
                {/* Preview first: both halves REPLACE what is there, and the
                    refusals (clones still holding the old master, answers
                    already recorded against the bank) are worth reading before
                    the click that acts rather than after it. */}
                <button
                  onClick={() => runBuild(false)}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1.5 rounded border border-violet-300 bg-[hsl(var(--card))] px-2.5 py-1 text-[11px] font-semibold text-violet-800 hover:bg-[hsl(var(--muted))] disabled:opacity-50"
                >
                  {busy === 'build-preview' && <Loader2 className="w-3 h-3 animate-spin" />}
                  Preview build
                </button>
                {/* The app's primary-button vocabulary, not a new violet stop:
                    utilities that appear nowhere else in the codebase do not
                    survive this project's Tailwind build, and a bg that never
                    ships leaves white text on a white banner. */}
                <button
                  onClick={() => runBuild(true)}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1.5 rounded bg-[hsl(var(--primary))] px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
                >
                  {busy === 'build' ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Hammer className="w-3 h-3" />
                  )}
                  Build study material
                </button>
              </div>
              <p className="mt-1 text-[10.5px] text-violet-800">
                Builds the reduced study masters and freezes the block-test question bank.
                Both datasets must be confirmed for the bank.
              </p>
              {buildReport && <BuildReport report={buildReport} />}
            </div>
          )}
          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-700">
              {error}
            </div>
          )}
          {otherViolations.map((v, i) => (
            <div
              key={i}
              className={`rounded-lg border px-4 py-2 text-[11px] font-semibold ${
                v.severity === 'error'
                  ? 'border-rose-200 bg-rose-50 text-rose-700'
                  : 'border-amber-200 bg-amber-50 text-amber-700'
              }`}
            >
              {v.message}
            </div>
          ))}
        </div>
      )}

      {/* ── the board ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)_minmax(0,1.12fr)] gap-4 flex-1 min-h-0">
        {/* LEFT: sets + classification tree */}
        <div className="border border-[hsl(var(--border))] rounded-lg bg-[hsl(var(--card))] flex flex-col overflow-hidden min-h-[300px]">
          <div className="px-3 py-1.5 bg-[hsl(var(--muted))]/60 border-b border-[hsl(var(--border))]">
            <span className="text-[10.5px] font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
              Sets
            </span>
          </div>
          <div className="py-1 border-b border-[hsl(var(--border))]">
            {(Object.keys(SET_LABELS) as CurationSetKind[]).map((kind) => {
              const have = setCounts.get(kind) ?? 0;
              const want = targets[kind] * SCORE_QUERY_TYPES.length;
              const on = selection.kind === 'set' && selection.setKind === kind;
              return (
                <button
                  key={kind}
                  onClick={() => setSelection({ kind: 'set', setKind: kind })}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left ${
                    on ? 'bg-[hsl(var(--muted))] border-l-2 border-[hsl(var(--primary))] pl-[10px]' : 'hover:bg-[hsl(var(--muted))]/40'
                  }`}
                >
                  <span className="flex-1">{SET_LABELS[kind]}</span>
                  <span className={`text-[11px] tabular-nums ${have === want ? 'text-[hsl(var(--muted-foreground))]' : 'text-amber-600 font-bold'}`}>
                    {have}/{want}
                  </span>
                </button>
              );
            })}
            <button
              onClick={() => setSelection({ kind: 'unassigned' })}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left ${
                selection.kind === 'unassigned'
                  ? 'bg-[hsl(var(--muted))] border-l-2 border-[hsl(var(--primary))] pl-[10px]'
                  : 'hover:bg-[hsl(var(--muted))]/40'
              }`}
            >
              <span className="flex-1">Unassigned</span>
              <span className="text-[11px] tabular-nums text-[hsl(var(--muted-foreground))]">
                {state.questions.length - state.members.length}
              </span>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto py-1">
            {SCORE_QUERY_TYPES.map((type) => {
              const list = subtypesByType.get(type) ?? [];
              return (
                <div key={type}>
                  <button
                    onClick={() => setSelection({ kind: 'type', type })}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-left ${
                      selection.kind === 'type' && selection.type === type ? 'bg-[hsl(var(--muted))]' : 'hover:bg-[hsl(var(--muted))]/40'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${TYPE_DOT[type]}`} />
                    <span className="text-[11px] font-bold uppercase tracking-wide flex-1 truncate">
                      {QUERY_TYPE_LABELS[type]}
                    </span>
                    <Badge>{state.typeCounts[type] ?? 0}</Badge>
                  </button>
                  {list.map((s, i) => (
                    <SubtypeRow
                      key={s.intentId}
                      subtype={s}
                      last={i === list.length - 1}
                      active={selection.kind === 'subtype' && selection.intentId === s.intentId}
                      isDemo={state.meta.demoSubtypes.includes(s.title)}
                      assigned={assignedBySubtype.get(s.intentId) ?? [0, 0]}
                      onClick={() => setSelection({ kind: 'subtype', intentId: s.intentId })}
                    />
                  ))}
                </div>
              );
            })}
          </div>

          <div className="px-3 py-2 border-t border-[hsl(var(--border))] text-[10.5px] text-[hsl(var(--muted-foreground))] tabular-nums">
            certain {state.gradeCounts.certain} · boundary {state.gradeCounts.boundary} · unmatched{' '}
            {state.gradeCounts.unmatched}
            <br />
            natural boundary ratio {(state.naturalBoundaryRatio * 100).toFixed(1)}%
          </div>
        </div>

        {/* MIDDLE: questions + assignment */}
        <div className="border border-[hsl(var(--border))] rounded-lg bg-[hsl(var(--card))] flex flex-col overflow-hidden min-h-[300px]">
          <div className="px-3 py-1.5 bg-[hsl(var(--muted))]/60 border-b border-[hsl(var(--border))] flex items-center justify-between gap-2">
            <span className="text-[10.5px] font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))] truncate">
              {selectionLabel(selection, subtypeById)} · {visible.length}
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <select
                value={gradeFilter}
                onChange={(e) => setGradeFilter(e.target.value as 'all' | QuestionGrade)}
                className="text-xs border border-[hsl(var(--border))] rounded px-1.5 py-0.5 bg-[hsl(var(--background))] text-[hsl(var(--foreground))]"
              >
                <option value="all">All</option>
                <option value="certain">● Certain</option>
                <option value="boundary">◐ Boundary</option>
                <option value="unmatched">Unmatched</option>
              </select>
              {/* The board's select rather than the shared one: it carries an
                  option the instructor board has no subject for. */}
              <select
                /* Shows the fallback while it IS the fallback, so the control
                   never reads as a mode the list is not in — and the choice
                   comes back the moment a subtype is selected again. */
                value={selection.kind === 'subtype' || sort !== 'clarity' ? sort : 'participant-asc'}
                onChange={(e) => setSort(e.target.value as QuerySortMode | 'clarity')}
                className="text-xs border border-[hsl(var(--border))] rounded px-1.5 py-0.5 bg-[hsl(var(--background))] text-[hsl(var(--foreground))]"
              >
                {/* Default, and first: the ordering a curator wants the moment
                    they open a subtype. It needs a subtype to mean anything, so
                    it is offered greyed elsewhere and the list falls back — but
                    it comes back on its own when a subtype is picked, which is
                    the point of it being the default rather than a mode to
                    remember to switch into. */}
                <option value="clarity" disabled={selection.kind !== 'subtype'}>
                  Clearest first
                </option>
                <option value="participant-asc">PID ↑</option>
                <option value="participant-desc">PID ↓</option>
                <option value="recent">Newest</option>
                <option value="oldest">Oldest</option>
              </select>
            </div>
          </div>
          {classifierText(selection, subtypeById) && (
            <div className="px-3 py-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/25">
              <p className="text-[10px] font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))] mb-0.5">
                {selection.kind === 'type' ? 'Type definition · given to the 4-way classifier' : 'Subtype definition · given to the judge'}
              </p>
              <p className="text-[11px] leading-relaxed text-[hsl(var(--foreground))]">
                {classifierText(selection, subtypeById)}
              </p>
            </div>
          )}
          <div className="px-3 py-2 border-b border-[hsl(var(--border))]">
            <PaneSearch value={search} onChange={setSearch} />
          </div>
          <ul className="flex-1 overflow-y-auto divide-y divide-[hsl(var(--border))]">
            {visible.map((row) => {
              const q = questionById.get(row.messageId);
              const member = memberByMessage.get(row.messageId);
              return (
                <li
                  key={row.messageId}
                  className={`group relative px-3 py-2.5 cursor-pointer ${
                    selectedId === row.messageId ? 'bg-[hsl(var(--muted))]' : 'hover:bg-[hsl(var(--muted))]/40'
                  }`}
                  onClick={() => setSelectedId(row.messageId)}
                >
                  <div className="flex items-center justify-between text-[11px] font-mono text-[hsl(var(--muted-foreground))] tabular-nums mb-1">
                    <span className="flex items-center gap-1.5">
                      {row.participantToken} · Turn {row.turnNumber}
                      {/* Certainty as a glyph next to the turn: it is one of
                          three states, read at a glance down the column, and a
                          worded chip on every row crowded out the subtypes,
                          which are what a curator is actually comparing. */}
                      {q?.grade === 'certain' && (
                        <span className="text-emerald-600" title="certain — one subtype claims it">
                          ●
                        </span>
                      )}
                      {q?.grade === 'boundary' && (
                        <span className="text-amber-600" title="boundary — competing or weak claims">
                          ◐
                        </span>
                      )}
                      {q?.grade === 'unmatched' && (
                        <span className="opacity-50" title="unmatched — no subtype claims it">
                          ○
                        </span>
                      )}
                    </span>
                    {/* Membership sits on the meta line, flush right: which set
                        a question is already in is scanned DOWN the list, and
                        down in the chip row it moved with however many subtypes
                        the question matched. font-sans so a label does not read
                        as part of the mono identity column. */}
                    <span className="flex items-center gap-1.5">
                      {q?.queryType ? QUERY_TYPE_LABELS[q.queryType] : '—'}
                      {member && (
                        <span className="font-sans">
                          <Chip tone="violet">{SET_LABELS[member.setKind]}</Chip>
                        </span>
                      )}
                    </span>
                  </div>
                  <QueryTextButton
                    queryText={row.queryText}
                    dissection={row.dissection}
                    expanded={expanded === row.messageId}
                    onToggleExpand={() => setExpanded(expanded === row.messageId ? null : row.messageId)}
                    onOpen={() => setSelectedId(row.messageId)}
                  />
                  {/* The classification lives with the question, where it is
                      read while scanning — not in the viewer, which is for
                      reading the conversation. Type and set membership are on
                      the meta line above, so only the subtypes remain here —
                      and this row now varies with the question alone, which is
                      what keeps the hover panel's right edge steady.
                      min-h holds the row's height for an unmatched question, so
                      the list does not shift as the grade filter changes. */}
                  <div className="mt-1 flex flex-wrap gap-1 items-center min-h-[1.25rem]">
                    {Object.entries(q?.matches ?? {}).map(([intentId, grade]) => {
                      const st = subtypeById.get(Number(intentId));
                      if (!st) return null;
                      return (
                        <Chip key={intentId} tone={grade === 'clearly_in' ? 'ok' : 'warn'}>
                          <span className="max-w-[10rem] truncate">{st.title}</span>
                          {grade === 'clearly_in' ? '●' : '◐'}
                        </Chip>
                      );
                    })}
                    {/* In the row's own flow, right-aligned: floating it made
                        the panel sit on the seam between two rows, belonging to
                        neither. Space is reserved so hovering does not reflow. */}
                    {!locked && (
                      <span className="ml-auto flex items-center gap-0.5 rounded-md ring-1 ring-[hsl(var(--border))] bg-[hsl(var(--card))] px-1 py-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                        {(Object.keys(SET_LABELS) as CurationSetKind[]).map((kind) => (
                          <button
                            key={kind}
                            onClick={(e) => {
                              e.stopPropagation();
                              assign(row.messageId, member?.setKind === kind ? null : kind);
                            }}
                            className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                              member?.setKind === kind
                                ? 'bg-[hsl(var(--primary))] text-white'
                                : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]'
                            }`}
                          >
                            {kind === 'review' ? 'Review' : 'Test'}
                          </button>
                        ))}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
            {visible.length === 0 && (
              <li className="px-3 py-8 text-center text-xs text-[hsl(var(--muted-foreground))]">
                No questions match this filter.
              </li>
            )}
          </ul>
        </div>

        {/* RIGHT: the conversation, and nothing else. Classification and the
            assign controls belong to the question row, where the scanning
            happens; a viewer that also carries controls makes reading a thread
            feel like operating a form. */}
        <div className="border border-[hsl(var(--border))] rounded-lg bg-[hsl(var(--card))] flex flex-col overflow-hidden min-h-[300px]">
          {selectedRow ? (
            <>
              <div className="px-3 py-1.5 bg-[hsl(var(--muted))]/60 border-b border-[hsl(var(--border))] flex items-center justify-between">
                <span className="text-[10.5px] font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                  {selectedRow.participantToken} · conversation
                </span>
                <Chip>Turn {selectedRow.turnNumber}</Chip>
              </div>
              <div className="flex-1 overflow-y-auto">
                <ConversationThread rows={rows} current={selectedRow} isNirvana={isNirvana} expandMaterials />
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-xs text-[hsl(var(--muted-foreground))] px-6 text-center">
              Pick a question to read its conversation.
            </div>
          )}
        </div>
      </div>

      {surveyOpen && <SurveyModal onClose={() => setSurveyOpen(false)} />}

      {reRateOpen && (
        <ReRateModal
          datasetKey={state.dataset.key}
          datasetLabel={state.dataset.label}
          locked={locked}
          onClose={() => setReRateOpen(false)}
          onDone={refresh}
        />
      )}

      {settingsOpen && (
        <SetTargetsModal
          targets={targets}
          locked={locked}
          onClose={() => setSettingsOpen(false)}
          onSaved={(next) => {
            setTargets(next);
            setSettingsOpen(false);
            void refresh();
          }}
        />
      )}
    </StudioShell>
  );
}

/**
 * Set sizes. Per QUERY TYPE, because that is the unit the design specifies and
 * the unit the checks use — showing only a total would let a researcher set 60
 * and wonder why four counters still read 0/15.
 */
function SetTargetsModal({
  targets,
  locked,
  onClose,
  onSaved,
}: {
  targets: SetTargets;
  locked: boolean;
  onClose: () => void;
  onSaved: (next: SetTargets) => void;
}) {
  const [draft, setDraft] = useState<SetTargets>(targets);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/study/admin/curation/targets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message ?? 'Could not save.');
        return;
      }
      onSaved(data.targets as SetTargets);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg bg-[hsl(var(--background))] border border-[hsl(var(--border))] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-[hsl(var(--border))]">
          <h2 className="text-sm font-bold">Set sizes</h2>
          <p className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))] leading-relaxed">
            How many questions each set holds <strong>per query type</strong>. It applies to
            all four types, so the total is four times this — and to both datasets.
          </p>
        </div>

        <div className="px-5 py-4 space-y-3">
          {(Object.keys(SET_LABELS) as CurationSetKind[]).map((kind) => {
            const { min, max } = SET_TARGET_LIMITS[kind];
            return (
              <div key={kind} className="flex items-center gap-3">
                <label className="text-xs font-semibold flex-1">{SET_LABELS[kind]}</label>
                <input
                  type="number"
                  min={min}
                  max={max}
                  disabled={locked || busy}
                  value={draft[kind]}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, [kind]: Number(e.target.value) }))
                  }
                  className="w-20 border border-[hsl(var(--border))] rounded px-2 py-1 text-sm text-right tabular-nums bg-[hsl(var(--card))] disabled:opacity-50"
                />
                <span className="w-28 text-[11px] text-[hsl(var(--muted-foreground))] tabular-nums">
                  × 4 types = {draft[kind] * 4}
                </span>
              </div>
            );
          })}

          {locked && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-700">
              A dataset is confirmed, so the sizes are fixed. Unlock it and try again.
            </p>
          )}
          {error && (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-semibold text-rose-700">
              {error}
            </p>
          )}
        </div>

        <div className="px-5 py-3 border-t border-[hsl(var(--border))] flex items-center justify-between gap-2">
          <span className="text-[10.5px] text-[hsl(var(--muted-foreground))]">
            Assigned questions are kept — only the targets move.
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="text-xs font-semibold px-3 py-1.5 rounded border border-[hsl(var(--border))]"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={locked || busy}
              className="text-xs font-semibold px-3 py-1.5 rounded bg-[hsl(var(--primary))] text-white disabled:opacity-40"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface ReRateStatus {
  reachable: { intentId: number; title: string }[];
  unreachable: string[];
  questions: number;
  pairs: number;
  stalePairs: number;
  mode: string;
  ratingVersion: number;
  model: string;
}

/**
 * Re-rate the prepared subtype set under the current harness.
 *
 * Driven as a loop from here rather than as one long request: a master is
 * ~one call per question, which is minutes of work, and a batch that reports
 * back after each round is the only way to show real progress — and the only
 * way to stop halfway without losing what was already rated (every batch is
 * committed, and the job is idempotent by definition hash).
 */
function ReRateModal({
  datasetKey,
  datasetLabel,
  locked,
  onClose,
  onDone,
}: {
  datasetKey: string;
  datasetLabel: string;
  locked: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [status, setStatus] = useState<ReRateStatus | null>(null);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [failed, setFailed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await fetch(
        `/api/study/admin/curation/rerate?datasetKey=${encodeURIComponent(datasetKey)}`
      );
      const data = await res.json().catch(() => ({}));
      if (!alive) return;
      if (!res.ok) setError('Could not read the re-rate status.');
      else setStatus(data as ReRateStatus);
    })();
    return () => {
      alive = false;
    };
  }, [datasetKey]);

  const run = async () => {
    if (!status) return;
    stopRef.current = false;
    setRunning(true);
    setError(null);
    setDone(0);
    setFailed(0);
    setTotal(status.stalePairs);
    let completed = 0;
    try {
      // Loops on the server's own remaining count, not a local estimate: a
      // message whose call produced no usable verdict stays pending, so a
      // client-side countdown would report finished while work remained.
      for (;;) {
        if (stopRef.current) break;
        const res = await fetch('/api/study/admin/curation/rerate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ datasetKey, limit: 500 }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(
            data.error === 'openai_not_configured'
              ? 'OPENAI_API_KEY is not configured.'
              : (data.message ?? 'Re-rating failed.')
          );
          break;
        }
        completed += data.ratedPairs ?? 0;
        setDone(completed);
        setFailed((f) => f + (data.failed ?? 0));
        if (!data.pendingPairs) break;
        // No progress and nothing pending left to try means the remainder is
        // stuck on unusable model output — stop rather than spin on it.
        if (!data.ratedPairs) {
          setError('Some questions produced no usable verdict. Try again later.');
          break;
        }
      }
    } finally {
      setRunning(false);
      const res = await fetch(
        `/api/study/admin/curation/rerate?datasetKey=${encodeURIComponent(datasetKey)}`
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok) setStatus(data as ReRateStatus);
      onDone();
    }
  };

  const upToDate = status !== null && status.stalePairs === 0;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      onClick={running ? undefined : onClose}
    >
      <div
        className="w-full max-w-lg rounded-lg bg-[hsl(var(--background))] border border-[hsl(var(--border))] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-[hsl(var(--border))]">
          <h2 className="text-sm font-bold">Re-rate subtypes — {datasetLabel}</h2>
          <p className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))] leading-relaxed">
            Judges every starter subtype against every question again, under the harness
            the study will actually run — <strong>one definition per call</strong>, the way
            the New Intent modal rates an intent someone wrote themselves. A subtype is
            only re-rated while its definition is still the exact text the chooser seeds;
            that, and judging it alone, is what makes a prepared set and a hand-made
            intent agree.
          </p>
        </div>

        <div className="px-5 py-4 space-y-3 text-xs">
          {!status && !error && (
            <p className="text-[hsl(var(--muted-foreground))]">Reading…</p>
          )}

          {status && (
            <>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                <dt className="text-[hsl(var(--muted-foreground))]">Harness</dt>
                <dd className="font-semibold tabular-nums">
                  {status.mode} · r{status.ratingVersion}
                </dd>
                <dt className="text-[hsl(var(--muted-foreground))]">Model</dt>
                <dd className="font-semibold">{status.model}</dd>
                <dt className="text-[hsl(var(--muted-foreground))]">Subtypes × questions</dt>
                <dd className="font-semibold tabular-nums">
                  {status.reachable.length} × {status.questions} = {status.pairs}
                </dd>
                <dt className="text-[hsl(var(--muted-foreground))]">Out of date</dt>
                <dd className="font-semibold tabular-nums">
                  {status.stalePairs} verdicts = {status.stalePairs} calls
                </dd>
              </dl>

              {status.unreachable.length > 0 && (
                <p className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-3 py-2 text-[10.5px] leading-relaxed">
                  <strong>Skipped ({status.unreachable.length}):</strong>{' '}
                  {status.unreachable.join(', ')} — no chooser option seeds these
                  definitions, so nothing reads their verdicts.
                </p>
              )}

              {locked && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-700">
                  This dataset is confirmed. Re-rating would move the grades its sets were
                  picked on — unlock it first.
                </p>
              )}

              {upToDate && !running && (
                <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-semibold text-emerald-700">
                  Every subtype is current. Nothing to do.
                </p>
              )}

              {(running || done > 0) && (
                <div className="space-y-1.5">
                  <div className="h-1.5 rounded-full bg-[hsl(var(--muted))] overflow-hidden">
                    <div
                      className="h-full bg-[hsl(var(--primary))] transition-all"
                      style={{ width: `${total ? Math.min(100, (done / total) * 100) : 0}%` }}
                    />
                  </div>
                  <p className="text-[10.5px] text-[hsl(var(--muted-foreground))] tabular-nums">
                    {done} / {total} verdicts
                    {failed > 0 && ` · ${failed} calls failed`}
                    {running && ' · running'}
                  </p>
                </div>
              )}
            </>
          )}

          {error && (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-semibold text-rose-700">
              {error}
            </p>
          )}
        </div>

        <div className="px-5 py-3 border-t border-[hsl(var(--border))] flex items-center justify-between gap-2">
          <span className="text-[10.5px] text-[hsl(var(--muted-foreground))] max-w-[22rem] leading-snug">
            Safe to stop and resume — finished questions are kept. Curate after it
            finishes, though: a half-done run reads half old grades.
          </span>
          <div className="flex gap-2">
            <button
              onClick={running ? () => (stopRef.current = true) : onClose}
              className="text-xs font-semibold px-3 py-1.5 rounded border border-[hsl(var(--border))]"
            >
              {running ? 'Stop' : 'Close'}
            </button>
            <button
              onClick={run}
              disabled={!status || running || locked || upToDate}
              className="text-xs font-semibold px-3 py-1.5 rounded bg-[hsl(var(--primary))] text-white disabled:opacity-40"
            >
              {running
                ? 'Re-rating…'
                : status
                  ? `Re-rate ${status.stalePairs} verdicts`
                  : 'Re-rate'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** One starter subtype under its type, with the two grades curation reads. */
function SubtypeRow({
  subtype,
  last,
  active,
  isDemo,
  assigned,
  onClick,
}: {
  subtype: CurationSubtype;
  last: boolean;
  active: boolean;
  isDemo: boolean;
  /** [review, block test] already assigned from this subtype. */
  assigned: [number, number];
  onClick: () => void;
}) {
  const anyAssigned = assigned[0] + assigned[1] > 0;
  return (
    <button
      onClick={onClick}
      className={`relative w-full flex items-center gap-1.5 pl-[26px] pr-3 py-1 min-h-[27px] text-left text-xs ${
        active ? 'bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]' : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]/40'
      }`}
    >
      {/* elbow — the board's tree rule, drawn with borders so it costs no DOM */}
      <span
        className="absolute left-[17px] top-0 w-px bg-[hsl(var(--border))]"
        style={{ height: last ? 13 : '100%' }}
      />
      <span className="absolute left-[17px] top-[13px] w-2.5 border-t border-[hsl(var(--border))]" />
      <span className="flex-1 truncate">{subtype.title}</span>
      {isDemo && <span className="text-[9px] font-bold text-violet-600">DEMO</span>}
      <span className="text-[10px] font-bold tabular-nums whitespace-nowrap">
        <span className="text-emerald-600">●{subtype.clearlyIn}</span>{' '}
        <span className="text-amber-600">◐{subtype.probablyIn}</span>
      </span>
      {/* What this subtype has already contributed, review/block/AB. Shown only
          once something has — a 0/0/0 on all 26 rows would bury the ● ◐ the
          tree is actually browsed by. A question matching two subtypes counts
          on both rows: the number answers "how much of this subtype is spoken
          for", which is per subtype, so the column deliberately sums to more
          than the set's size. */}
      {anyAssigned && (
        <span
          className="text-[10px] font-bold tabular-nums whitespace-nowrap text-violet-600"
          title={`assigned from this subtype — review ${assigned[0]} · block test ${assigned[1]}`}
        >
          {assigned[0]}/{assigned[1]}
        </span>
      )}
    </button>
  );
}

/**
 * The wording the classifier was actually given for the current selection —
 * TYPE_DEFINITIONS for a type, the template's own definition for a subtype.
 *
 * Both are the shipped strings, not a description of them. Curation is reading
 * counts produced by these sentences, and the only way to judge whether a
 * subtype is claiming the right questions is to see the claim it was asked to
 * make. (type-prompts.ts is client-safe precisely so a viewer can reconstruct
 * the prompt; the same guarantee is what lets this render it.)
 *
 * Sets and Unassigned have no definition behind them — the block is omitted
 * rather than filled with a stand-in.
 */
function classifierText(
  selection: Selection,
  subtypes: Map<number, CurationSubtype>
): string | null {
  if (selection.kind === 'type') return TYPE_DEFINITIONS[selection.type];
  if (selection.kind === 'subtype') return subtypes.get(selection.intentId)?.definition ?? null;
  return null;
}

function selectionLabel(selection: Selection, subtypes: Map<number, CurationSubtype>): string {
  switch (selection.kind) {
    case 'set':
      return selection.type
        ? `${SET_LABELS[selection.setKind]} · ${QUERY_TYPE_LABELS[selection.type]}`
        : SET_LABELS[selection.setKind];
    case 'unassigned':
      return 'Unassigned';
    case 'type':
      return QUERY_TYPE_LABELS[selection.type];
    case 'subtype':
      return subtypes.get(selection.intentId)?.title ?? 'Subtype';
  }
}

/**
 * The questionnaire editor.
 *
 * `key` is the column the answers are stored under, so it is editable only
 * while an item is new — renaming one after a session would orphan what a
 * participant already said. The dialog shows which keys have answers and
 * refuses to pretend a removal is free.
 */
function SurveyModal({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<SurveyItem[] | null>(null);
  const [scaleMax, setScaleMax] = useState<number>(7);
  const [answeredKeys, setAnsweredKeys] = useState<string[]>([]);
  const [respondents, setRespondents] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch('/api/study/admin/curation/survey');
      if (!res.ok || cancelled) return;
      const data = await res.json();
      setItems(data.items);
      setScaleMax(data.scale?.max ?? 7);
      setAnsweredKeys(data.answeredKeys ?? []);
      setRespondents(data.respondents ?? 0);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const patch = (index: number, change: Partial<SurveyItem>) =>
    setItems((prev) =>
      prev ? prev.map((item, i) => (i === index ? { ...item, ...change } : item)) : prev
    );

  const addItem = () =>
    setItems((prev) => [
      ...(prev ?? []),
      {
        key: `item_${(prev?.length ?? 0) + 1}`,
        construct: 'control',
        text: '',
        low: 'Strongly disagree',
        high: 'Strongly agree',
      },
    ]);

  const save = async (reset = false) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch('/api/study/admin/curation/survey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reset ? { reset: true } : { items, scaleMax }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message ?? 'Could not save.');
        return;
      }
      setItems(data.items);
      if (typeof data.scaleMax === 'number') setScaleMax(data.scaleMax);
      setAnsweredKeys((prev) => prev);
      if (data.orphanedKeys?.length) {
        setNote(
          `Saved. ${data.orphanedKeys.length} removed item(s) still have answers on record: ${data.orphanedKeys.join(', ')} — they are kept, not deleted.`
        );
      } else {
        setNote('Saved.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[88vh] flex flex-col rounded-lg bg-[hsl(var(--background))] border border-[hsl(var(--border))] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-[hsl(var(--border))]">
          <h2 className="text-sm font-bold">Block questionnaire</h2>
          <p className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))] leading-relaxed">
            Asked after each block. Rewording an item keeps its answers; changing what it
            MEASURES deserves a new key.
            {respondents > 0 && (
              <span className="text-amber-700 font-semibold">
                {' '}
                {respondents} participant(s) have already answered — edit with care.
              </span>
            )}
          </p>
        </div>

        <div className="px-5 py-2.5 border-b border-[hsl(var(--border))] flex items-center gap-2">
          <span className="text-[11px] font-semibold">Response scale</span>
          <div className="flex border border-[hsl(var(--border))] rounded overflow-hidden text-[11px] font-semibold">
            {SURVEY_SCALE_CHOICES.map((choice) => (
              <button
                key={choice}
                disabled={respondents > 0}
                onClick={() => setScaleMax(choice)}
                className={`px-2.5 py-1 disabled:opacity-50 ${
                  scaleMax === choice
                    ? 'bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]'
                    : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]'
                }`}
              >
                {SURVEY_SCALE_MIN}–{choice}
              </button>
            ))}
          </div>
          <span className="text-[10.5px] text-[hsl(var(--muted-foreground))]">
            {respondents > 0
              ? 'Locked — answers exist on the current scale.'
              : 'Applies to every item.'}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {items === null && (
            <p className="text-xs text-[hsl(var(--muted-foreground))]">Loading…</p>
          )}
          {items?.map((item, index) => {
            const hasAnswers = answeredKeys.includes(item.key);
            return (
              <div
                key={index}
                className="rounded-lg border border-[hsl(var(--border))] px-3 py-2.5 space-y-2"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[10.5px] text-[hsl(var(--muted-foreground))] w-4 tabular-nums">
                    {index + 1}
                  </span>
                  <input
                    value={item.key}
                    disabled={hasAnswers}
                    onChange={(e) => patch(index, { key: e.target.value })}
                    title={
                      hasAnswers
                        ? 'Answers exist under this key — renaming would orphan them.'
                        : 'lower_snake_case identifier'
                    }
                    className="w-40 border border-[hsl(var(--border))] rounded px-2 py-1 text-[11px] font-mono bg-[hsl(var(--card))] disabled:opacity-60"
                  />
                  <select
                    value={item.construct}
                    onChange={(e) =>
                      patch(index, { construct: e.target.value as SurveyItem['construct'] })
                    }
                    className="text-[11px] border border-[hsl(var(--border))] rounded px-1.5 py-1 bg-[hsl(var(--card))]"
                  >
                    <option value="control">control</option>
                    <option value="trust">trust</option>
                    <option value="load">load</option>
                  </select>
                  <label className="flex items-center gap-1 text-[10.5px] text-[hsl(var(--muted-foreground))]">
                    <input
                      type="checkbox"
                      checked={!!item.reverse}
                      onChange={(e) => patch(index, { reverse: e.target.checked })}
                      className="accent-[hsl(var(--primary))]"
                    />
                    high = more burden
                  </label>
                  {hasAnswers && <Chip tone="warn">has answers</Chip>}
                  <button
                    onClick={() => setItems((prev) => prev?.filter((_, i) => i !== index) ?? prev)}
                    className="ml-auto text-[hsl(var(--muted-foreground))] hover:text-rose-700"
                    title="Remove item"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <textarea
                  value={item.text}
                  rows={2}
                  placeholder="Question as the participant reads it"
                  onChange={(e) => patch(index, { text: e.target.value })}
                  className="w-full border border-[hsl(var(--border))] rounded px-2 py-1.5 text-xs bg-[hsl(var(--card))]"
                />
                <div className="flex items-center gap-2">
                  <input
                    value={item.low}
                    placeholder="low anchor"
                    onChange={(e) => patch(index, { low: e.target.value })}
                    className="flex-1 border border-[hsl(var(--border))] rounded px-2 py-1 text-[11px] bg-[hsl(var(--card))]"
                  />
                  <span className="text-[10.5px] text-[hsl(var(--muted-foreground))] tabular-nums">
                    {SURVEY_SCALE_MIN} … {scaleMax}
                  </span>
                  <input
                    value={item.high}
                    placeholder="high anchor"
                    onChange={(e) => patch(index, { high: e.target.value })}
                    className="flex-1 border border-[hsl(var(--border))] rounded px-2 py-1 text-[11px] bg-[hsl(var(--card))]"
                  />
                </div>
              </div>
            );
          })}

          <button
            onClick={addItem}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded border border-dashed border-[hsl(var(--primary))]/60 text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/10"
          >
            <Plus className="w-3 h-3" /> Add item
          </button>

          {note && (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-semibold text-emerald-700">
              {note}
            </p>
          )}
          {error && (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-semibold text-rose-700">
              {error}
            </p>
          )}
        </div>

        <div className="px-5 py-3 border-t border-[hsl(var(--border))] flex items-center gap-2">
          <button
            onClick={() => save(true)}
            disabled={busy}
            className="text-[11px] font-semibold px-2.5 py-1.5 rounded border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] disabled:opacity-40"
          >
            Restore defaults
          </button>
          <span className="text-[10.5px] text-[hsl(var(--muted-foreground))]">
            {items?.length ?? 0} item(s)
          </span>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="text-xs font-semibold px-3 py-1.5 rounded border border-[hsl(var(--border))]"
          >
            Close
          </button>
          <button
            onClick={() => save(false)}
            disabled={busy || !items}
            className="text-xs font-semibold px-3 py-1.5 rounded bg-[hsl(var(--primary))] text-white disabled:opacity-40"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface BuildResponse {
  applied: boolean;
  masters: MasterBuildResult[];
  bank: BankBuildResult;
}

/**
 * What the build did, or would do.
 *
 * Reports both halves even when one refused: they fail for unrelated reasons,
 * and a researcher fixing the master should not have to click again to learn
 * the bank was also going to stop.
 */
function BuildReport({ report }: { report: BuildResponse }) {
  const tone = (status: string) =>
    status === 'built'
      ? 'text-emerald-700'
      : status === 'blocked'
        ? 'text-rose-700'
        : status === 'skipped'
          ? 'text-amber-700'
          : 'text-violet-800';

  return (
    <div className="mt-2 rounded border border-violet-200 bg-[hsl(var(--card))] px-3 py-2 space-y-1.5">
      <p className="text-[10.5px] font-bold uppercase tracking-wide text-violet-700">
        {report.applied ? 'Build result' : 'Preview — nothing was written'}
      </p>

      {report.masters.map((m) => (
        <div key={m.datasetKey} className="text-[11px] leading-relaxed">
          <span className="font-semibold">{m.label}</span>{' '}
          <span className={`font-semibold ${tone(m.status)}`}>{m.status}</span>
          {m.reason && <span className="text-[hsl(var(--muted-foreground))]"> — {m.reason}</span>}
          {m.status !== 'skipped' && (
            <span className="text-[hsl(var(--muted-foreground))]">
              {' '}
              · {m.reviewQuestions} review question(s) across {m.threads} thread(s), cut from{' '}
              {m.sourceMessages} messages
            </span>
          )}
          {m.perType && Object.keys(m.perType).length > 0 && (
            <span className="text-[hsl(var(--muted-foreground))]">
              {' '}
              · per type{' '}
              {Object.entries(m.perType)
                .map(([k, v]) => `${k}=${v}`)
                .join(' ')}
            </span>
          )}
          {m.warnings.map((w, i) => (
            <span key={i} className="block text-amber-700 font-semibold">
              ! {w}
            </span>
          ))}
        </div>
      ))}

      <div className="text-[11px] leading-relaxed border-t border-violet-200 pt-1.5">
        <span className="font-semibold">Question bank</span>{' '}
        <span className={`font-semibold ${tone(report.bank.status)}`}>{report.bank.status}</span>
        {report.bank.reason && (
          <span className="text-[hsl(var(--muted-foreground))]"> — {report.bank.reason}</span>
        )}
        <span className="text-[hsl(var(--muted-foreground))]">
          {' '}
          · {report.bank.testCandidates} block-test candidate(s)
          {report.bank.written > 0 && ` · wrote ${report.bank.written} item(s)`}
          {report.bank.replaced > 0 && ` · replaced ${report.bank.replaced}`}
        </span>
        {report.bank.warnings.map((w, i) => (
          <span key={i} className="block text-amber-700 font-semibold">
            ! {w}
          </span>
        ))}
      </div>

      {report.applied && report.masters.some((m) => m.status === 'built') && (
        <p className="text-[10.5px] text-violet-700 border-t border-violet-200 pt-1.5">
          New participants clone the reduced master from now on. Existing participants keep
          the copy they were given — reset them from the session console to move them over.
        </p>
      )}
    </div>
  );
}

/**
 * Which subtypes the demo runs on — and, by the same act, which students are
 * withheld from every set.
 *
 * A popover of checkboxes rather than a multi-select: there are ~26 subtypes
 * across four types, and the thing a researcher checks here is "is this one in
 * the demo", one row at a time. Grouped by query type so the list reads the
 * same way the tree on the left does. Saves on close, once, rather than firing
 * a request per tick — each write recomputes the isolated set.
 */
interface DemoCost {
  /** Students taken out of circulation — the number that drives the rest. */
  students: number;
  /** Questions that ARE the subtype (what the demo would actually show). */
  own: number;
  /** Every question those students asked, all of it isolated. */
  questions: number;
  /** Of those, how many are already assigned to a set — future violations. */
  inSet: number;
}

function DemoSubtypePicker({
  subtypes,
  selected,
  disabled,
  onChange,
  costOf,
  perTitle,
}: {
  subtypes: { intentId: number; title: string; type: ScoreQueryType | null }[];
  selected: string[];
  disabled: boolean;
  onChange: (titles: string[]) => void;
  /** Combined cost of a selection — students overlap, so this is a union. */
  costOf: (titles: string[]) => DemoCost;
  perTitle: Map<string, DemoCost>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(selected);

  // Titles, not intent ids: a subtype title is shared across the two datasets
  // (that is how one choice isolates both), and the same title can appear under
  // more than one type.
  const byType = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const s of subtypes) {
      const key = s.type ?? 'other';
      const list = out.get(key) ?? [];
      if (!list.includes(s.title)) list.push(s.title);
      out.set(key, list);
    }
    return out;
  }, [subtypes]);

  const draftCost = useMemo(() => costOf(draft), [costOf, draft]);

  const close = (commit: boolean) => {
    setOpen(false);
    if (!commit) return;
    const same =
      draft.length === selected.length && draft.every((t) => selected.includes(t));
    if (!same) onChange(draft);
  };

  return (
    <span className="relative inline-flex items-center gap-2">
      <span className="text-[11px] text-[hsl(var(--muted-foreground))]">Demo subtypes</span>
      <button
        onClick={() => {
          setDraft(selected);
          setOpen((v) => !v);
        }}
        disabled={disabled}
        className="text-xs border border-[hsl(var(--border))] rounded px-2 py-0.5 bg-[hsl(var(--background))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] disabled:opacity-50"
      >
        {selected.length === 0 ? '— none —' : `${selected.length} selected`}
      </button>

      {open && (
        <>
          {/* Click-away commits: the popover has no Save, so leaving it is the
              gesture that means "these are the ones". */}
          <div className="fixed inset-0 z-40" onClick={() => close(true)} />
          <div className="absolute top-full left-0 mt-1 z-50 w-72 max-h-96 overflow-y-auto rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-lg p-1">
            {/* The union, not the sum: two subtypes usually share students, so
                adding the rows would overstate what the demo costs. */}
            <div className="flex items-center gap-2 px-2 py-1 border-b border-[hsl(var(--border))] mb-1">
              <span className="text-[10px] font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                {draft.length} selected
              </span>
              {draft.length > 0 && (
                <span className="text-[10px] tabular-nums text-[hsl(var(--muted-foreground))]">
                  {draftCost.students} students · {draftCost.questions} questions
                  {draftCost.inSet > 0 && (
                    <span className="text-amber-700 font-semibold"> · {draftCost.inSet} in a set</span>
                  )}
                </span>
              )}
              <div className="flex-1" />
              <button
                onClick={() => setDraft([])}
                className="text-[10.5px] font-semibold text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
              >
                Clear
              </button>
              <button
                onClick={() => close(true)}
                className="text-[10.5px] font-semibold text-[hsl(var(--primary-foreground))] px-1.5 py-0.5 rounded bg-[hsl(var(--primary))] text-white"
              >
                Done
              </button>
            </div>

            <p className="px-2 pb-1 text-[10px] text-[hsl(var(--muted-foreground))] leading-relaxed border-b border-[hsl(var(--border))] mb-1">
              Isolation is whole-student: one matching question removes that
              student&apos;s whole log. Rows read{' '}
              <span className="tabular-nums">students👤 questions-isolated-q</span>
              {' '}· <span className="text-amber-700 font-semibold tabular-nums">n⚠</span> = already
              in a set.
            </p>

            {[...byType].map(([type, titles]) => (
              <div key={type} className="mb-1">
                <p className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                  {QUERY_TYPE_LABELS[type as ScoreQueryType] ?? type}
                </p>
                {titles.map((title) => {
                  const on = draft.includes(title);
                  const cost = perTitle.get(title);
                  return (
                    <button
                      key={`${type}:${title}`}
                      onClick={() =>
                        setDraft((prev) =>
                          prev.includes(title) ? prev.filter((t) => t !== title) : [...prev, title]
                        )
                      }
                      className="w-full flex items-center gap-2 px-2 py-1 rounded text-left hover:bg-[hsl(var(--muted))]"
                    >
                      <span
                        className={`w-3.5 h-3.5 shrink-0 rounded border flex items-center justify-center ${
                          on
                            ? 'bg-[hsl(var(--primary))] border-[hsl(var(--primary))]'
                            : 'border-[hsl(var(--border))]'
                        }`}
                      >
                        {on && <Check className="w-2.5 h-2.5 text-white" />}
                      </span>
                      <span className="text-[11.5px] truncate flex-1">{title}</span>
                      {/* Read as: this subtype is `own` questions, but picking
                          it removes `students` students and `questions` of
                          their questions. The gap is the point. */}
                      <span className="text-[10px] tabular-nums text-[hsl(var(--muted-foreground))] shrink-0">
                        {cost ? `${cost.students}👤 ${cost.questions}q` : '—'}
                      </span>
                      {cost && cost.inSet > 0 && (
                        <span className="text-[10px] tabular-nums font-semibold text-amber-700 shrink-0">
                          {cost.inSet}⚠
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </>
      )}
    </span>
  );
}

/**
 * Isolate students by name.
 *
 * The sibling of DemoSubtypePicker, and the reason it exists: isolating by
 * subtype is indirect, and the bill arrives in students — one SWAG subtype took
 * 50 of 507 questions, because every student who ever asked it goes with it.
 * A demo needs two or three threads, and this is how to say exactly which.
 *
 * Filterable because a log has scores of students and scanning them is not the
 * task; the researcher usually arrives already knowing which thread they want
 * to demo on.
 */
function DemoStudentPicker({
  tokens,
  selected,
  disabled,
  onChange,
  costOf,
  perToken,
}: {
  tokens: string[];
  selected: string[];
  disabled: boolean;
  onChange: (tokens: string[]) => void;
  costOf: (tokens: string[]) => { students: number; questions: number; inSet: number };
  perToken: Map<string, { questions: number; inSet: number }>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(selected);
  const [filter, setFilter] = useState('');
  const draftCost = costOf(draft);
  const shown = filter.trim()
    ? tokens.filter((t) => t.toLowerCase().includes(filter.trim().toLowerCase()))
    : tokens;

  const toggle = (token: string) =>
    setDraft((prev) => (prev.includes(token) ? prev.filter((t) => t !== token) : [...prev, token]));

  const close = (commit: boolean) => {
    setOpen(false);
    setFilter('');
    if (!commit) return;
    const same = draft.length === selected.length && draft.every((t) => selected.includes(t));
    if (!same) onChange(draft);
  };

  return (
    <span className="relative inline-flex items-center gap-2">
      <span className="text-[11px] text-[hsl(var(--muted-foreground))]">Demo students</span>
      <button
        onClick={() => {
          setDraft(selected);
          setOpen((v) => !v);
        }}
        disabled={disabled}
        className="text-xs border border-[hsl(var(--border))] rounded px-2 py-0.5 bg-[hsl(var(--background))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] disabled:opacity-50"
      >
        {selected.length === 0 ? '— none —' : `${selected.length} selected`}
      </button>

      {open && (
        <>
          {/* Click-away commits, like the subtype picker — no Save button, and
              leaving is the gesture that means "these are the ones". */}
          <div className="fixed inset-0 z-40" onClick={() => close(true)} />
          <div className="absolute top-full left-0 mt-1 z-50 w-64 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-lg p-1">
            <div className="flex items-center gap-2 px-2 py-1 border-b border-[hsl(var(--border))] mb-1">
              <span className="text-[10px] font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                {draft.length} selected
              </span>
              {draft.length > 0 && (
                <span className="text-[10px] tabular-nums text-[hsl(var(--muted-foreground))]">
                  {draftCost.questions} questions
                  {draftCost.inSet > 0 && (
                    <span className="text-amber-700 font-semibold"> · {draftCost.inSet} in a set</span>
                  )}
                </span>
              )}
              <div className="flex-1" />
              <button
                onClick={() => setDraft([])}
                className="text-[10.5px] font-semibold text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
              >
                Clear
              </button>
              <button
                onClick={() => close(true)}
                className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded bg-[hsl(var(--primary))] text-white"
              >
                Done
              </button>
            </div>

            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Find a student…"
              className="w-full mb-1 px-2 py-1 text-xs border border-[hsl(var(--border))] rounded bg-[hsl(var(--background))]"
            />

            <div className="max-h-72 overflow-y-auto">
              {shown.map((token) => {
                const cost = perToken.get(token);
                return (
                  <label
                    key={token}
                    className="flex items-center gap-2 px-2 py-1 rounded hover:bg-[hsl(var(--muted))] cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={draft.includes(token)}
                      onChange={() => toggle(token)}
                      className="shrink-0"
                    />
                    <span className="text-xs font-mono flex-1">{token}</span>
                    <span className="text-[10px] tabular-nums text-[hsl(var(--muted-foreground))]">
                      {cost?.questions ?? 0}q
                      {cost?.inSet ? (
                        <span className="text-amber-700 font-semibold"> · {cost.inSet} in set</span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
              {shown.length === 0 && (
                <p className="px-2 py-3 text-center text-[11px] text-[hsl(var(--muted-foreground))]">
                  No student matches that.
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </span>
  );
}
