'use client';

/**
 * Set curation — the whole tool, one screen.
 *
 * Browsing axis is the classification the system already has: the 4 query types
 * (score_query_types) and, nested under them, the starter subtypes with their
 * judge grades (● clearly_in / ◐ probably_in). Nothing is labelled by hand here;
 * the researcher reads and ASSIGNS — every question lands in review, block-test,
 * A/B, or nothing, and the sets are exclusive by construction.
 *
 * Layout, chips and row markup are the studio board's, so a researcher who
 * knows the board can already read this screen.
 */

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Lock, Unlock, RefreshCw, Settings } from 'lucide-react';
import type { ScoreQueryRow } from '@/app/instructor/assignments/[id]/score/IntentBoard';
import { ConversationThread } from '@/app/instructor/assignments/[id]/score/conversation';
import { PaneSearch, QueryTextButton } from '@/app/instructor/assignments/[id]/score/workbench-shared';
import { SortSelect, sortQueryRows, type QuerySortMode } from '@/app/instructor/assignments/[id]/score/query-list';
import StudioShell from '@/app/instructor/assignments/[id]/score/StudioShell';
import { QUERY_TYPE_LABELS, SCORE_QUERY_TYPES, type ScoreQueryType } from '@/lib/score/intents';
import { SET_TARGET_LIMITS, type CurationSetKind, type SetTargets } from '@/lib/study/config';
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
  ab: 'A/B',
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

/* ── selection model ── */

type Selection =
  | { kind: 'set'; setKind: CurationSetKind }
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
  const [selection, setSelection] = useState<Selection>({ kind: 'type', type: 'planning' });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<QuerySortMode>('participant-asc');
  // Certainty filter. Assembling a set that follows the log's natural
  // certain/boundary mix (design §4) means being able to go looking for each
  // kind, not just for the ambiguous ones.
  const [gradeFilter, setGradeFilter] = useState<'all' | QuestionGrade>('all');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  const excluded = useMemo(() => new Set(state.excludedMessageIds), [state.excludedMessageIds]);
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
      }
    }
    return counts;
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
          .filter(([id, grade]) => grade === 'clearly_in' && subtypeById.get(Number(id))?.isSubtype)
          .map(([id]) => subtypeById.get(Number(id))!.title);
        if (titles.length === 0) titles.push('(어느 subtype에도 안 걸림)');
        for (const t of titles) tally.set(t, (tally.get(t) ?? 0) + 1);
      }
      return [...tally].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    },
    [state.members, questionById, subtypeById]
  );

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
        setError('확정된 세트입니다 — 잠금을 해제한 뒤 수정하세요.');
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
        setError(data.message ?? '배정에 실패했습니다.');
      }
      await refresh();
    },
    [locked, questionById, state.dataset.key, refresh]
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
          ? 'OPENAI_API_KEY가 설정되지 않았습니다.'
          : '분류 갱신에 실패했습니다.'
      );
    }
    await refresh();
    setBusy(null);
  }, [state.dataset.key, refresh]);

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
        setError('검증을 통과하지 못했습니다 — 아래 위반 항목을 해결하세요.');
      } else {
        setError('잠금 변경에 실패했습니다.');
      }
    }
    await refresh();
    setBusy(null);
  }, [locked, state.dataset.key, refresh]);

  const setDemo = useCallback(
    async (title: string | null) => {
      setBusy('demo');
      setError(null);
      const res = await fetch('/api/study/admin/curation/demo-subtype', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ datasetKey: state.dataset.key, demoSubtype: title }),
      });
      if (!res.ok) setError('데모 subtype 지정에 실패했습니다.');
      await refresh();
      setBusy(null);
    },
    [state.dataset.key, refresh]
  );

  /* ── which questions the middle column shows ── */
  const visible = useMemo(() => {
    let ids: number[];
    if (selection.kind === 'set') {
      ids = state.members.filter((m) => m.setKind === selection.setKind).map((m) => m.messageId);
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
    return sortQueryRows(list, sort);
  }, [selection, state.members, state.questions, memberByMessage, rowById, gradeFilter, search, sort, questionById]);

  const selectedRow = selectedId !== null ? rowById.get(selectedId) ?? null : null;
  const selectedQuestion = selectedId !== null ? questionById.get(selectedId) ?? null : null;
  const selectedMember = selectedId !== null ? memberByMessage.get(selectedId) ?? null : null;

  const subtypesByType = useMemo(() => {
    const map = new Map<ScoreQueryType, CurationSubtype[]>();
    for (const t of SCORE_QUERY_TYPES) map.set(t, []);
    const ungrouped: CurationSubtype[] = [];
    for (const s of state.subtypes) {
      if (s.type && s.isSubtype) map.get(s.type)!.push(s);
      else ungrouped.push(s);
    }
    for (const list of map.values()) list.sort((a, b) => b.clearlyIn - a.clearlyIn);
    ungrouped.sort((a, b) => b.clearlyIn - a.clearlyIn);
    return { map, ungrouped };
  }, [state.subtypes]);

  // Counts and the per-set notes live in the cards; anything else (demo
  // isolation, unclassified questions) still needs saying out loud.
  const otherViolations = violations.filter(
    (v) => v.code !== 'count' && v.code !== 'ab_balance' && v.code !== 'boundary_ratio'
  );

  const header = (
    <div className="flex items-center gap-3">
      <h1 className="text-sm font-semibold">Set Curation</h1>
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
        <span className="text-[11px] text-[hsl(var(--muted-foreground))]">Demo subtype</span>
        <select
          value={state.meta.demoSubtype ?? ''}
          disabled={locked || busy !== null}
          onChange={(e) => setDemo(e.target.value || null)}
          className="text-xs border border-[hsl(var(--border))] rounded px-1.5 py-0.5 bg-[hsl(var(--background))] text-[hsl(var(--foreground))]"
        >
          <option value="">— none —</option>
          {state.subtypes
            .filter((s) => s.isSubtype)
            .map((s) => (
              <option key={s.intentId} value={s.title}>
                {s.title}
              </option>
            ))}
        </select>
        {state.meta.demoSubtype && (
          <Chip tone="violet">격리 {state.excludedMessageIds.length}문항</Chip>
        )}
        <div className="flex-1" />
        <button
          onClick={runClassify}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] disabled:opacity-50"
        >
          {busy === 'classify' ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          분류 갱신
          <Badge tone={state.missingTypeCount > 0 ? 'warn' : 'plain'}>누락 {state.missingTypeCount}</Badge>
        </button>
        <button
          onClick={() => setSettingsOpen(true)}
          disabled={busy !== null}
          title="세트 개수 설정"
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] disabled:opacity-50"
        >
          <Settings className="w-3 h-3" />
          개수 설정
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
          {locked ? '잠금 해제' : '확정 · 잠금'}
        </button>
      </div>

      {/* Progress, one card per set. The per-type counts ARE the blocking
          checks, so they are shown as the work rather than as a list of
          errors — a count list of twelve had to be truncated, which hid the
          one violation that was not a count. */}
      <div className="mb-3 grid grid-cols-1 md:grid-cols-3 gap-2">
        {(Object.keys(SET_LABELS) as CurationSetKind[]).map((kind) => {
          const have = setCounts.get(kind) ?? 0;
          const want = targets[kind] * SCORE_QUERY_TYPES.length;
          const boundaryHave = setCounts.get(`${kind}:boundary`) ?? 0;
          const boundaryWant = boundaryTargetFor(kind);
          const complete = have === want;
          // Violations that belong to this set rather than to a type count.
          const setNotes = violations.filter(
            (v) =>
              (v.code === 'ab_balance' && kind === 'ab') ||
              (v.code === 'boundary_ratio' && v.message.startsWith(kind))
          );
          return (
            <div
              key={kind}
              className={`rounded-lg border px-3 py-2 ${
                complete
                  ? 'border-emerald-200 bg-emerald-50/40'
                  : 'border-[hsl(var(--border))] bg-[hsl(var(--card))]'
              }`}
            >
              <div className="flex items-baseline gap-2 mb-1.5">
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
                  className="ml-auto text-[10.5px] tabular-nums text-[hsl(var(--muted-foreground))]"
                  title={`경계 질문 ${boundaryHave}개 — 로그의 자연 비율(${(state.naturalBoundaryRatio * 100).toFixed(0)}%)대로면 ${boundaryWant}개`}
                >
                  ◐ {boundaryHave}/{boundaryWant}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                {SCORE_QUERY_TYPES.map((type) => {
                  const n = setCounts.get(`${kind}:${type}`) ?? 0;
                  const target = targets[kind];
                  const mix = subtypeMixFor(kind, type);
                  return (
                    <div
                      key={type}
                      className="flex items-center gap-1.5 text-[10.5px]"
                      title={
                        mix.length > 0
                          ? `${QUERY_TYPE_LABELS[type]} — 담긴 subtype\n` +
                            mix.map(([t, c]) => `  ${t} ${c}`).join('\n')
                          : `${QUERY_TYPE_LABELS[type]} — 아직 없음`
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
                    </div>
                  );
                })}
              </div>
              {setNotes.map((v, i) => (
                <p
                  key={i}
                  className={`mt-1.5 text-[10px] font-semibold ${
                    v.severity === 'error' ? 'text-rose-700' : 'text-amber-700'
                  }`}
                >
                  {v.severity === 'error' ? '✗' : '⚠'} {v.message}
                </p>
              ))}
            </div>
          );
        })}
      </div>

      {(error || locked || otherViolations.length > 0) && (
        <div className="mb-3 space-y-1.5">
          {locked && (
            <div className="rounded-lg border border-violet-200 bg-violet-50/60 px-4 py-2 text-xs font-semibold text-violet-800">
              🔒 확정됨 · {new Date(state.meta.lockedAt!).toLocaleString()} · {state.meta.lockedBy} — 스터디 마스터·문항 뱅크 빌드에 이 세트가 사용됩니다.
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
              세트 보기
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
              <span className="flex-1">미배정</span>
              <span className="text-[11px] tabular-nums text-[hsl(var(--muted-foreground))]">
                {state.questions.length - state.members.length}
              </span>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto py-1">
            {SCORE_QUERY_TYPES.map((type) => {
              const list = subtypesByType.map.get(type) ?? [];
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
                      isDemo={state.meta.demoSubtype === s.title}
                      onClick={() => setSelection({ kind: 'subtype', intentId: s.intentId })}
                    />
                  ))}
                </div>
              );
            })}
            {subtypesByType.ungrouped.length > 0 && (
              <div>
                <div className="px-3 py-1.5 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--muted-foreground))]" />
                  <span className="text-[11px] font-bold uppercase tracking-wide flex-1 text-[hsl(var(--muted-foreground))]">
                    Type-level starters
                  </span>
                </div>
                {subtypesByType.ungrouped.map((s, i) => (
                  <SubtypeRow
                    key={s.intentId}
                    subtype={s}
                    last={i === subtypesByType.ungrouped.length - 1}
                    active={selection.kind === 'subtype' && selection.intentId === s.intentId}
                    isDemo={false}
                    onClick={() => setSelection({ kind: 'subtype', intentId: s.intentId })}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="px-3 py-2 border-t border-[hsl(var(--border))] text-[10.5px] text-[hsl(var(--muted-foreground))] tabular-nums">
            확실 {state.gradeCounts.certain} · 경계 {state.gradeCounts.boundary} · 미매칭 {state.gradeCounts.unmatched}
            <br />
            자연 경계비율 {(state.naturalBoundaryRatio * 100).toFixed(1)}%
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
                <option value="all">전체</option>
                <option value="certain">● 확실만</option>
                <option value="boundary">◐ 경계만</option>
                <option value="unmatched">미매칭만</option>
              </select>
              <SortSelect value={sort} onChange={setSort} />
            </div>
          </div>
          <div className="px-3 py-2 border-b border-[hsl(var(--border))]">
            <PaneSearch value={search} onChange={setSearch} />
          </div>
          <ul className="flex-1 overflow-y-auto divide-y divide-[hsl(var(--border))]">
            {visible.map((row) => {
              const q = questionById.get(row.messageId);
              const member = memberByMessage.get(row.messageId);
              const isExcluded = excluded.has(row.messageId);
              return (
                <li
                  key={row.messageId}
                  className={`group relative px-3 py-2.5 cursor-pointer ${
                    selectedId === row.messageId ? 'bg-[hsl(var(--muted))]' : 'hover:bg-[hsl(var(--muted))]/40'
                  } ${isExcluded ? 'opacity-50' : ''}`}
                  onClick={() => setSelectedId(row.messageId)}
                >
                  <div className="flex items-center justify-between text-[11px] font-mono text-[hsl(var(--muted-foreground))] tabular-nums mb-1">
                    <span>
                      {row.participantToken} · Turn {row.turnNumber}
                    </span>
                    <span>{q?.queryType ? QUERY_TYPE_LABELS[q.queryType] : '—'}</span>
                  </div>
                  <QueryTextButton
                    queryText={row.queryText}
                    dissection={row.dissection}
                    expanded={expanded === row.messageId}
                    onToggleExpand={() => setExpanded(expanded === row.messageId ? null : row.messageId)}
                    onOpen={() => setSelectedId(row.messageId)}
                  />
                  <div className="mt-1 flex flex-wrap gap-1 items-center">
                    {q?.grade === 'certain' && <Chip tone="ok">● 확실</Chip>}
                    {q?.grade === 'boundary' && <Chip tone="warn">◐ 경계</Chip>}
                    {q?.grade === 'unmatched' && <Chip>미매칭</Chip>}
                    {member && <Chip tone="violet">{SET_LABELS[member.setKind]}</Chip>}
                    {isExcluded && <Chip tone="violet">데모 격리</Chip>}
                  </div>
                  {!locked && !isExcluded && (
                    <div className="absolute right-2 top-1.5 z-10 flex items-center gap-0.5 rounded-md bg-[hsl(var(--card))] px-1 py-0.5 shadow-sm ring-1 ring-[hsl(var(--border))] opacity-0 group-hover:opacity-100 focus-within:opacity-100">
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
                          {kind === 'review' ? '검토' : kind === 'test' ? '블록' : 'A/B'}
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
            {visible.length === 0 && (
              <li className="px-3 py-8 text-center text-xs text-[hsl(var(--muted-foreground))]">
                이 조건에 해당하는 질문이 없습니다.
              </li>
            )}
          </ul>
        </div>

        {/* RIGHT: conversation + classification + assign */}
        <div className="border border-[hsl(var(--border))] rounded-lg bg-[hsl(var(--card))] flex flex-col overflow-hidden min-h-[300px]">
          {selectedRow ? (
            <>
              <div className="px-3 py-1.5 bg-[hsl(var(--muted))]/60 border-b border-[hsl(var(--border))] flex items-center justify-between">
                <span className="text-[10.5px] font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                  {selectedRow.participantToken} · 대화
                </span>
                <Chip>Turn {selectedRow.turnNumber}</Chip>
              </div>
              <div className="flex-1 overflow-y-auto">
                <ConversationThread rows={rows} current={selectedRow} isNirvana={isNirvana} expandMaterials />
              </div>

              <div className="border-t border-[hsl(var(--border))] px-3 py-2">
                <div className="text-[10.5px] font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))] mb-1.5">
                  기계 분류
                </div>
                <div className="flex flex-wrap gap-1.5 items-center">
                  {selectedQuestion?.queryType ? (
                    <Chip>
                      <span className={`w-1.5 h-1.5 rounded-full ${TYPE_DOT[selectedQuestion.queryType]}`} />
                      {QUERY_TYPE_LABELS[selectedQuestion.queryType]}
                    </Chip>
                  ) : (
                    <Chip tone="bad">분류 없음</Chip>
                  )}
                  {Object.entries(selectedQuestion?.matches ?? {}).map(([intentId, grade]) => {
                    const s = subtypeById.get(Number(intentId));
                    if (!s) return null;
                    return (
                      <Chip key={intentId} tone={grade === 'clearly_in' ? 'ok' : 'warn'}>
                        {s.title} · {grade === 'clearly_in' ? '●' : '◐'}
                      </Chip>
                    );
                  })}
                  {Object.keys(selectedQuestion?.matches ?? {}).length === 0 && (
                    <span className="text-[10.5px] text-[hsl(var(--muted-foreground))]">
                      어떤 starter subtype에도 걸리지 않음
                    </span>
                  )}
                </div>
              </div>

              <div className="border-t border-[hsl(var(--border))] px-3 py-2.5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10.5px] font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                    배정
                  </span>
                  {excluded.has(selectedRow.messageId) && (
                    <Chip tone="violet">데모 격리 — 배정 불가</Chip>
                  )}
                </div>
                <div className="flex gap-2">
                  {(Object.keys(SET_LABELS) as CurationSetKind[]).map((kind) => (
                    <button
                      key={kind}
                      disabled={locked || excluded.has(selectedRow.messageId)}
                      onClick={() =>
                        assign(selectedRow.messageId, selectedMember?.setKind === kind ? null : kind)
                      }
                      className={`flex-1 text-xs font-semibold py-2 rounded-lg border disabled:opacity-40 ${
                        selectedMember?.setKind === kind
                          ? 'bg-[hsl(var(--primary))] border-[hsl(var(--primary))] text-white'
                          : 'border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]'
                      }`}
                    >
                      {SET_LABELS[kind]}
                    </button>
                  ))}
                  <button
                    disabled={locked || !selectedMember}
                    onClick={() => assign(selectedRow.messageId, null)}
                    className="px-3 text-xs font-semibold py-2 rounded-lg border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] disabled:opacity-40"
                  >
                    해제
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-xs text-[hsl(var(--muted-foreground))] px-6 text-center">
              질문을 선택하면 대화 맥락과 분류가 여기에 표시되고, 세트에 배정할 수 있습니다.
            </div>
          )}
        </div>
      </div>

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
        setError(data.message ?? '저장에 실패했습니다.');
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
          <h2 className="text-sm font-bold">세트 개수 설정</h2>
          <p className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))] leading-relaxed">
            각 세트가 <strong>질문 유형당</strong> 몇 문항인지. 네 유형에 모두 적용되므로 전체
            개수는 4배가 됩니다. 두 데이터셋에 함께 적용됩니다.
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
                  × 4유형 = {draft[kind] * 4}문항
                </span>
              </div>
            );
          })}

          <p className="text-[10.5px] text-[hsl(var(--muted-foreground))] leading-relaxed pt-1">
            A/B는 양쪽 데이터셋에서 뽑으므로 참가자가 보는 문항은 그 2배(
            {draft.ab * 8}문항)이고, 순서가 균형 블록으로 짜여 파일럿에서 뒤쪽부터 잘라도 홈·원정이
            맞습니다.
          </p>

          {locked && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-700">
              확정된 데이터셋이 있어 바꿀 수 없습니다. 잠금을 해제한 뒤 다시 시도하세요.
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
            이미 배정한 문항은 지워지지 않습니다 — 목표치만 바뀝니다.
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="text-xs font-semibold px-3 py-1.5 rounded border border-[hsl(var(--border))]"
            >
              취소
            </button>
            <button
              onClick={save}
              disabled={locked || busy}
              className="text-xs font-semibold px-3 py-1.5 rounded bg-[hsl(var(--primary))] text-white disabled:opacity-40"
            >
              {busy ? '저장 중…' : '저장'}
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
  onClick,
}: {
  subtype: CurationSubtype;
  last: boolean;
  active: boolean;
  isDemo: boolean;
  onClick: () => void;
}) {
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
    </button>
  );
}

function selectionLabel(selection: Selection, subtypes: Map<number, CurationSubtype>): string {
  switch (selection.kind) {
    case 'set':
      return SET_LABELS[selection.setKind];
    case 'unassigned':
      return '미배정';
    case 'type':
      return QUERY_TYPE_LABELS[selection.type];
    case 'subtype':
      return subtypes.get(selection.intentId)?.title ?? 'Subtype';
  }
}
