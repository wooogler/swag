'use client';

/**
 * Facilitator console — one row per participant, read left to right.
 *
 * A watching tool first: the participant moves themselves through the protocol
 * and generates their own frozen answers on the way (advance.ts), so a session
 * that is going well needs nothing from this page. What it shows is where each
 * participant is, whether each clone is deployed, and whether the answers the
 * next phase depends on exist and are still current.
 *
 * The buttons are the recovery half — generate by hand, step back, jump, force
 * past a blocker, reset or remove — for the runs that go wrong.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Loader2,
  PlayCircle,
  RefreshCw,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  ChevronRight as ChevronRightIcon,
  Trash2,
  RotateCcw,
  Check,
  Copy,
  Plus,
  Download,
} from 'lucide-react';
import AdminNav from '@/components/study/AdminNav';
import type { StudyDataset } from '@/lib/study/datasets';
import type {
  ParticipantStatus,
  CloneStatus,
  PredictionRow,
  BlockResults,
  RecordingStatus,
} from '@/lib/study/console-store';
import {
  cellLabel,
  PHASE_LABELS,
  STUDY_CELLS,
  type StudyCell,
  type StudyPhase,
} from '@/lib/study/phases';
import {
  STUDIO_VIEWS,
  STUDY_WORK_MINUTES,
  STUDY_WORK_WARNING_MINUTES,
  type StudioFamily,
  type StudioView,
} from '@/lib/study/config';

/**
 * Where everyone is, in one line each.
 *
 * The console was built to be read over someone's shoulder: one participant at
 * a time, the researcher already knowing what step they were on because they
 * were watching it happen. In breakout rooms nobody is watching, so the first
 * question is no longer "how is this person doing" but "who is behind, and who
 * is stuck" — and that question has to be answerable in a glance across the
 * whole cohort, every fifteen seconds, without expanding anything.
 *
 * So: the protocol as a row of ticks, one per phase, in order. Done is filled,
 * current is ringed, ahead is empty. Every participant's row is the same width
 * with the same steps in the same places, which is what makes a column of them
 * scannable — the eye finds the one whose filled run is shorter.
 */
const STEP_ORDER: StudyPhase[] = [
  'not_started',
  'block1_work',
  'block1_survey',
  'block1_test',
  'break',
  'block2_work',
  'block2_survey',
  'block2_test',
  'final_survey',
  'done',
];

/**
 * The clock a step-name and a single number could not give.
 *
 * The bar started as ticks alone and the elapsed minutes lived in one chip
 * beside it, which meant the console could say how long someone had been in
 * the phase they were in and nothing about the ones behind them — the two
 * questions a facilitator actually has ("is this one slow NOW?" and "where did
 * their hour go?") answered one and a half times. So the minutes moved onto
 * the bar itself: every step carries its own, done steps included.
 *
 * Terminal steps are deliberately blank. `not_started` has no clock at all —
 * nothing is measured before the first advance — and a number under `done`
 * would grow for as long as the console stayed open, turning a finished row
 * into the loudest one on the screen.
 */
const UNTIMED: StudyPhase[] = ['not_started', 'done'];

function PhaseProgress({
  phase,
  spent,
}: {
  phase: StudyPhase;
  spent: Partial<Record<StudyPhase, number>>;
}) {
  const at = STEP_ORDER.indexOf(phase);
  const total = STEP_ORDER.filter((s) => !UNTIMED.includes(s)).reduce(
    (sum, s) => sum + (spent[s] ?? 0),
    0
  );
  return (
    <span className="inline-flex items-end gap-[3px]">
      {STEP_ORDER.map((step, i) => {
        const done = at > i;
        const now = at === i;
        const minutes = spent[step];
        const timed = !UNTIMED.includes(step) && minutes !== undefined && (done || now);
        // A configure block that ended over the cap stays marked after the
        // fact. The amber warning does not: "five minutes left" is only ever
        // about a clock that is still running, and a block that finished at 21
        // finished inside its budget.
        const overCap =
          timed && step.endsWith('_work') && (minutes ?? 0) >= STUDY_WORK_MINUTES;
        const label = PHASE_LABELS[step] ?? step;
        return (
          <span
            key={step}
            className={`inline-flex flex-col items-center gap-1 ${
              // The two configure blocks are the long ones; giving them width
              // makes the row read as the session's actual shape rather than as
              // ten equal beads — and leaves room for the two digits under the
              // step whose number a facilitator is actually watching.
              step.endsWith('_work') ? 'w-8' : 'w-5'
            }`}
            title={
              timed
                ? `${label} — ${minutes}m${now ? ' so far' : ''}${
                    overCap ? ` (cap ${STUDY_WORK_MINUTES}m)` : ''
                  }`
                : `${label}${done ? '' : ' — not reached'}`
            }
          >
            <span
              className={`h-2 w-full rounded-sm ${
                done
                  ? 'bg-emerald-500'
                  : now
                    ? 'bg-[hsl(var(--foreground))] ring-2 ring-offset-1 ring-[hsl(var(--foreground))]/25'
                    : 'bg-[hsl(var(--border))]'
              }`}
            />
            <span
              className={`w-full text-center text-[9px] leading-none tabular-nums ${
                now
                  ? `font-bold ${phaseClockTone(step, minutes ?? 0)}`
                  : overCap
                    ? 'text-rose-700 font-semibold'
                    : 'text-[hsl(var(--muted-foreground))]'
              }`}
            >
              {timed ? minutes : <span className="opacity-40">·</span>}
            </span>
          </span>
        );
      })}
      {total > 0 && (
        <span
          className="ml-1.5 text-[10.5px] tabular-nums text-[hsl(var(--muted-foreground))]"
          title="Total of the steps — configure blocks counted from their [Start]"
        >
          Σ {total}m
        </span>
      )}
    </span>
  );
}

/**
 * Whether this participant is actually being recorded, and whether what they
 * sent is whole.
 *
 * Three separate facts, because they fail separately: the equipment check ever
 * passed, a run is open right now, and the runs that closed stored everything
 * they said they would. A single green tick over "recording" would hide the
 * case this whole feature is most afraid of — bytes arriving, from the wrong
 * screen or with holes in them.
 */
function RecordingCell({ recordings }: { recordings: RecordingStatus[] }) {
  const check = recordings.find((r) => r.block === 0);
  const blocks = recordings.filter((r) => r.block > 0);
  if (!check && blocks.length === 0) {
    return <Chip tone="warn">no rec</Chip>;
  }
  const live = blocks.find((r) => r.endReason === null);
  const short = blocks.filter(
    (r) => r.endReason !== null && r.chunksDeclared !== null && r.chunksStored < r.chunksDeclared
  );
  const mb = (n: number) => `${(n / 1_048_576).toFixed(0)}MB`;
  return (
    <>
      {check ? (
        <Chip tone="ok" title="Equipment check passed and stored bytes">
          check ✓
        </Chip>
      ) : (
        <Chip tone="warn" title="No equipment check on file — they may not be recording">
          no check
        </Chip>
      )}
      {live && (
        <Chip tone="ok" title={`Recording block ${live.block}, ${live.chunksStored} chunks so far`}>
          rec b{live.block} · {mb(live.bytes)}
        </Chip>
      )}
      {/* A link, not a button: the browser streams the file straight to disk
          and the console never waits on it. Same naming as the bulk pull
          script, so a video grabbed here mid-session and the same video pulled
          afterwards are one file with one name. */}
      {blocks
        .filter((r) => r.endReason !== null && r.chunksStored > 0)
        .map((r) => (
          <a
            key={`${r.block}-${r.segment}`}
            href={`/api/study/admin/participants/recording?id=${r.id}`}
            download
            title={`Download block ${r.block} segment ${r.segment} — ${r.chunksStored}/${
              r.chunksDeclared ?? '?'
            } chunks, ended ${r.endReason}`}
            className={`inline-flex items-center gap-1 text-[10.5px] font-semibold px-1.5 py-0.5 rounded border ${
              r.chunksDeclared !== null && r.chunksStored < r.chunksDeclared
                ? 'bg-rose-50 text-rose-700 border-rose-200'
                : 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] border-[hsl(var(--border))]'
            } hover:bg-[hsl(var(--card))]`}
          >
            <Download className="w-3 h-3" />
            b{r.block}
            {r.segment > 1 ? `.${r.segment}` : ''} {mb(r.bytes)}
          </a>
        ))}
      {short.length > 0 && (
        <Chip tone="bad" title="Fewer chunks stored than the browser said it sent">
          short
        </Chip>
      )}
    </>
  );
}

function Chip({
  children,
  tone = 'plain',
  title,
}: {
  children: React.ReactNode;
  tone?: 'plain' | 'ok' | 'warn' | 'bad' | 'violet';
  title?: string;
}) {
  const map = {
    plain: 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] border-[hsl(var(--border))]',
    ok: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    warn: 'bg-amber-50 text-amber-700 border-amber-200',
    bad: 'bg-rose-50 text-rose-700 border-rose-200',
    violet: 'bg-violet-50 text-violet-700 border-violet-200',
  } as const;
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 text-[10.5px] font-semibold px-1.5 py-0.5 rounded border ${map[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * The two datasets a participant is actually running.
 *
 * Their stamp, not the study's current pair: the console can be repointed at
 * new material at any time, and a row created before that must keep reading as
 * what it is made of.
 */
function datasetPairOf(p: { blockOrder: string | null }): string[] | undefined {
  const keys = (p.blockOrder ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  return keys.length === 2 ? keys : undefined;
}

/** "3m ago" — a facilitator reads elapsed time, not a wall clock. */
function sinceLabel(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

/** Green once every measurement this participant owes has been answered. */
function measurementTone(p: ParticipantStatus): 'plain' | 'ok' {
  const testTotal = p.clones.reduce((n, c) => n + c.testTotal, 0);
  const testDone = p.clones.reduce((n, c) => n + c.testAnswered, 0);
  const complete = testTotal > 0 && testDone === testTotal;
  return complete ? 'ok' : 'plain';
}

export default function SessionConsole({
  initial,
  phases,
  actor,
  datasets = [],
  studyPair = [],
  demoDatasets = [],
}: {
  initial: ParticipantStatus[];
  phases: string[];
  actor: string;
  /** Every dataset there is — a participant's clone may be any of them. */
  datasets?: (StudyDataset & { built: boolean })[];
  /** The two the study is currently made of, in block order. */
  studyPair?: string[];
  /** Datasets that can be demoed, and how much material each has reserved. */
  demoDatasets?: { key: string; label: string; questions: number }[];
}) {
  const [participants, setParticipants] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [confirmFor, setConfirmFor] = useState<{
    participantId: string;
    number: string;
    action: 'reset_all' | 'reset_dataset' | 'remove';
    datasetKey?: string;
  } | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Sessions are watched, not clicked through: without this a facilitator has
  // to keep pressing refresh to see a participant reach the next step.
  const [autoRefresh, setAutoRefresh] = useState(true);

  const refresh = useCallback(async () => {
    const res = await fetch('/api/study/admin/participants');
    if (!res.ok) return;
    const data = await res.json();
    setParticipants(data.participants);
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => {
      void refresh();
    }, 15_000);
    return () => clearInterval(id);
  }, [autoRefresh, refresh]);

  const post = useCallback(
    async (url: string, body: unknown, label: string) => {
      setBusy(label);
      setMessage(null);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setMessage({
            tone: 'bad',
            text: data.blockers
              ? `Blocked: ${(data.blockers as string[]).join(' · ')}`
              : data.message ?? data.error ?? 'Failed.',
          });
          return data;
        }
        await refresh();
        return data;
      } finally {
        setBusy(null);
      }
    },
    [refresh]
  );

  const advance = (p: ParticipantStatus, move: 'next' | 'back', force = false) =>
    post(
      '/api/study/admin/participants/phase',
      { participantId: p.id, move, force },
      `${p.id}:${move}`
    );

  const generate = async (p: ParticipantStatus, kind: 'test', block?: 1 | 2) => {
    const data = await post(
      '/api/study/admin/participants/generate',
      { participantId: p.id, kind, block },
      `${p.id}:gen:${kind}:${block ?? 'all'}`
    );
    if (data?.reports) {
      const failed = (data.reports as { error?: string; failed?: number }[]).filter(
        (r) => r.error || (r.failed ?? 0) > 0
      );
      setMessage(
        failed.length === 0
          ? { tone: 'ok', text: `${kind} responses generated` }
          : { tone: 'bad', text: `Some failed: ${failed.map((f) => f.error ?? `${f.failed} item(s)`).join(', ')}` }
      );
    }
  };

  const isOpen = (id: string) => expanded.has(id);
  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const runConfirmed = async () => {
    if (!confirmFor) return;
    const data = await post(
      '/api/study/admin/participants/manage',
      { ...confirmFor, confirm: confirmText },
      `${confirmFor.participantId}:${confirmFor.action}`
    );
    if (data?.success) {
      setMessage({ tone: 'ok', text: `${confirmFor.number}: ${confirmFor.action} done` });
      setConfirmFor(null);
      setConfirmText('');
    }
  };

  return (
    <div className="min-h-screen bg-[hsl(var(--background))]">
      <header className="bg-[hsl(var(--card))] border-b border-[hsl(var(--border))]">
        <div className="max-w-[1500px] mx-auto px-6 py-4 flex items-center gap-3">
          <h1 className="text-sm font-semibold">Session Console</h1>
          <AdminNav current="console" />
          <div className="flex-1" />
          <label className="flex items-center gap-1.5 text-[11px] text-[hsl(var(--muted-foreground))]">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="accent-[hsl(var(--primary))]"
            />
            auto every 15s
          </label>
          <button
            onClick={refresh}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]"
          >
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
          <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
            researcher <span className="font-semibold text-[hsl(var(--foreground))]">{actor}</span>
          </span>
        </div>
      </header>

      <main className="max-w-[1500px] mx-auto px-6 py-5">
        {message && (
          <div
            className={`mb-4 rounded-lg border px-4 py-2 text-xs font-semibold ${
              message.tone === 'ok'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-rose-200 bg-rose-50 text-rose-700'
            }`}
          >
            {message.text}
          </div>
        )}

        <StudyMaterial datasets={datasets} pair={studyPair} busy={busy} setBusy={setBusy} setMessage={setMessage} />

        <DemoLauncher datasets={demoDatasets} busy={busy} setBusy={setBusy} setMessage={setMessage} />

        <NewParticipant
          pair={studyPair}
          existing={participants}
          busy={busy !== null}
          onCreate={async (participantNumber, cell, family) => {
            setBusy('create');
            setMessage(null);
            try {
              const res = await fetch('/api/study/admin/participants/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ participantNumber, cell, family }),
              });
              const data = await res.json().catch(() => ({}));
              if (!res.ok) {
                setMessage({ tone: 'bad', text: data.error ?? 'Could not create that one.' });
                return null;
              }
              await refresh();
              setMessage({ tone: 'ok', text: `${data.participantNumber} created in cell ${cell}.` });
              return data.accessToken as string;
            } finally {
              setBusy(null);
            }
          }}
        />

        {participants.length === 0 && (
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            No participants yet. Create one above, then hand them their link.
          </p>
        )}

        <div className="space-y-3">
          {participants.map((p) => (
            <div
              key={p.id}
              className="border border-[hsl(var(--border))] rounded-xl bg-[hsl(var(--card))] overflow-hidden"
            >
              <div className="px-4 py-3 flex items-center gap-3 flex-wrap border-b border-[hsl(var(--border))]">
                <button
                  onClick={() => toggleExpanded(p.id)}
                  className="flex items-center gap-1.5 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                  title={isOpen(p.id) ? 'Collapse' : 'Expand'}
                >
                  {isOpen(p.id) ? (
                    <ChevronDown className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronRightIcon className="w-3.5 h-3.5" />
                  )}
                  <span className="font-mono text-sm font-bold text-[hsl(var(--foreground))]">
                    {p.participantNumber}
                  </span>
                </button>
                <Chip
                  tone="violet"
                  title={
                    p.cell
                      ? cellLabel(p.cell as StudyCell, p.family, datasetPairOf(p))
                      : undefined
                  }
                >
                  cell {p.cell}
                </Chip>
                {/* Only when it is not the default: four rows saying "full" is
                    four rows of nothing, but a simple participant in a full
                    batch has to be obvious. */}
                {p.family === 'simple' && <Chip>simple</Chip>}
                <CellControl
                  participant={p}
                  busy={busy}
                  onAssign={(cell) =>
                    post(
                      '/api/study/admin/participants/cell',
                      { participantId: p.id, cell },
                      `${p.id}:cell`
                    )
                  }
                />
                <LinkButton token={p.accessToken} expired={p.phase === 'done'} />
                {/* Built on demand from tables that already hold everything —
                    a plain link, so the browser downloads it and the console
                    does not sit waiting on a fetch. */}
                <a
                  href={`/api/study/admin/participants/trail?participantId=${p.id}`}
                  download
                  title="Download this participant's session trail (zip)"
                  className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]"
                >
                  <Download className="w-3 h-3" /> trail
                </a>
                <PhaseProgress phase={p.phase as StudyPhase} spent={p.phaseSpent ?? {}} />
                {/* The name of the step only: its minutes are on the bar now,
                    under the step they belong to, and printing them twice made
                    the pair disagree by a minute whenever the two floors fell
                    either side of a boundary. */}
                <Chip tone="ok">{PHASE_LABELS[p.phase as StudyPhase] ?? p.phase}</Chip>
                <RecordingCell recordings={p.recordings ?? []} />
                {/* What they have actually built, per block — the question a
                    facilitator has while watching, which the phase alone does
                    not answer. */}
                {p.clones.map((c) => (
                  <span
                    key={c.assignmentId}
                    className="text-[10.5px] text-[hsl(var(--muted-foreground))] tabular-nums"
                    title={`${c.datasetKey} · ${c.condition}`}
                  >
                    <span className="font-semibold text-[hsl(var(--foreground))]">
                      B{c.block ?? '?'}
                    </span>{' '}
                    {c.condition === 'score'
                      ? `intent ${c.work.intents}`
                      : p.family === 'simple'
                        ? `${c.work.rulesChars} chars`
                        : `${c.work.filters} filter(s) · ${c.work.rulesChars} chars`}
                    {' · '}
                    {/* A save is the simple version's whole publishing act, so
                        counting edits and deploys separately would print the
                        same number twice. */}
                    {p.family === 'simple'
                      ? `${c.work.ruleEdits} change(s) · ${c.work.deploys} save(s)`
                      : `${c.work.ruleEdits} edit(s) · ${c.work.deploys} deploy(s)`}
                  </span>
                ))}
                <Chip tone={measurementTone(p)}>
                  test {p.clones.reduce((n, c) => n + c.testAnswered, 0)}/
                  {p.clones.reduce((n, c) => n + c.testTotal, 0)}
                </Chip>
                {p.lastActivityAt && (
                  <span className="text-[10.5px] text-[hsl(var(--muted-foreground))]">
                    {sinceLabel(p.lastActivityAt)}
                  </span>
                )}
                <div className="flex-1" />
                <select
                  value={p.phase}
                  onChange={(e) =>
                    post(
                      '/api/study/admin/participants/phase',
                      { participantId: p.id, move: e.target.value, force: true },
                      `${p.id}:jump`
                    )
                  }
                  className="text-xs border border-[hsl(var(--border))] rounded px-1.5 py-1 bg-[hsl(var(--background))]"
                >
                  {phases.map((ph) => (
                    <option key={ph} value={ph}>
                      {PHASE_LABELS[ph as StudyPhase] ?? ph}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => advance(p, 'back')}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] disabled:opacity-50"
                >
                  <ChevronLeft className="w-3 h-3" /> Back
                </button>
                <button
                  onClick={() => advance(p, 'next')}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded border border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-white disabled:opacity-50"
                >
                  {busy === `${p.id}:next` ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <ChevronRight className="w-3 h-3" />
                  )}
                  Next phase
                </button>
              </div>

              {p.blockers.length > 0 && (
                <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 flex items-center gap-2 flex-wrap">
                  <span className="text-[10.5px] font-bold uppercase tracking-wide text-amber-700">
                    Next phase blocked
                  </span>
                  {p.blockers.map((b, i) => (
                    <Chip key={i} tone="warn">
                      {b}
                    </Chip>
                  ))}
                  <button
                    onClick={() => advance(p, 'next', true)}
                    className="ml-auto text-[10.5px] font-semibold px-2 py-0.5 rounded border border-amber-300 text-amber-800 hover:bg-amber-100"
                  >
                    Override
                  </button>
                </div>
              )}

              {isOpen(p.id) && (
              <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[hsl(var(--border))]">
                {p.clones.map((clone) => (
                  <CloneCard
                    key={clone.assignmentId}
                    clone={clone}
                    participantId={p.id}
                    busy={busy}
                    onGenerate={(kind) => generate(p, kind, clone.block ?? undefined)}
                    onReset={() =>
                      setConfirmFor({
                        participantId: p.id,
                        number: p.participantNumber,
                        action: 'reset_dataset',
                        datasetKey: clone.datasetKey,
                      })
                    }
                  />
                ))}
              </div>
              )}

              {isOpen(p.id) && (
              <div className="px-4 py-2 flex items-center gap-2 border-t border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30">
                <span className="text-[10.5px] text-[hsl(var(--muted-foreground))]">
                  Session management
                </span>
                <div className="flex-1" />
                <button
                  onClick={() =>
                    setConfirmFor({ participantId: p.id, number: p.participantNumber, action: 'reset_all' })
                  }
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] disabled:opacity-50"
                >
                  <RotateCcw className="w-3 h-3" /> Reset all workspaces
                </button>
                <button
                  onClick={() =>
                    setConfirmFor({ participantId: p.id, number: p.participantNumber, action: 'remove' })
                  }
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded border border-rose-300 text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                >
                  <Trash2 className="w-3 h-3" /> Remove participant
                </button>
              </div>
              )}
            </div>
          ))}
        </div>
      </main>

      {confirmFor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => {
            setConfirmFor(null);
            setConfirmText('');
          }}
        >
          <div
            className="w-full max-w-md rounded-lg bg-[hsl(var(--background))] border border-[hsl(var(--border))] shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-[hsl(var(--border))]">
              <h2 className="text-sm font-bold text-rose-700">
                {confirmFor.action === 'remove'
                  ? 'Remove this participant entirely'
                  : confirmFor.action === 'reset_all'
                    ? 'Reset every workspace'
                    : `Reset the ${confirmFor.datasetKey} workspace`}
              </h2>
            </div>
            <div className="px-5 py-4 space-y-3">
              <p className="text-xs text-[hsl(var(--muted-foreground))] leading-relaxed">
                {confirmFor.action === 'remove'
                  ? 'The account, both clones and every bit of configuration work go. This cannot be undone.'
                  : 'Their configuration work (sets, rules, filters, deploys) goes and the workspace is re-cloned from the master. Their participant number stays valid.'}
              </p>
              <label className="block text-[11px] font-semibold text-[hsl(var(--muted-foreground))]">
                Type the participant number <span className="font-mono text-[hsl(var(--foreground))]">{confirmFor.number}</span> to confirm
              </label>
              <input
                autoFocus
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                className="w-full border border-[hsl(var(--border))] rounded-lg px-3 py-2 text-sm bg-[hsl(var(--card))]"
                placeholder={confirmFor.number}
              />
            </div>
            <div className="px-5 py-3 border-t border-[hsl(var(--border))] flex justify-end gap-2">
              <button
                onClick={() => {
                  setConfirmFor(null);
                  setConfirmText('');
                }}
                className="text-xs font-semibold px-3 py-1.5 rounded border border-[hsl(var(--border))]"
              >
                Cancel
              </button>
              <button
                onClick={runConfirmed}
                disabled={confirmText.trim().toUpperCase() !== confirmFor.number || busy !== null}
                className="text-xs font-semibold px-3 py-1.5 rounded bg-rose-600 text-white disabled:opacity-40"
              >
                {busy?.startsWith(confirmFor.participantId) ? 'Running…' : 'Run'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CloneCard({
  clone,
  participantId,
  busy,
  onGenerate,
  onReset,
}: {
  clone: CloneStatus;
  participantId: string;
  busy: string | null;
  onGenerate: (kind: 'test') => void;
  onReset: () => void;
}) {
  const readiness = (r: { missing: number; stale: number; current: boolean }) =>
    r.current ? (
      <Chip tone="ok">ready</Chip>
    ) : (
      <Chip tone="warn">
        {r.missing > 0 && `${r.missing} missing`}
        {r.missing > 0 && r.stale > 0 && ' · '}
        {r.stale > 0 && `stale ${r.stale}`}
        {r.missing === 0 && r.stale === 0 && 'no bank items'}
      </Chip>
    );

  return (
    <div className="px-4 py-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-bold">
          {clone.block ? `Block ${clone.block}` : '—'} · {clone.datasetKey}
        </span>
        <Chip tone="violet">{clone.condition}</Chip>
        {clone.deployed ? (
          <Chip tone="ok">{clone.deployLabel}</Chip>
        ) : (
          <Chip tone="bad">not deployed</Chip>
        )}
        <a
          href={`/instructor/assignments/${clone.assignmentId}/score`}
          target="_blank"
          rel="noreferrer"
          // study_events carries no actor, so anything done here is recorded as
          // if the participant did it. Fine between sessions, not during one.
          title="Do not open during a session — anything done here is recorded as the participant\u2019s."
          className="text-[10.5px] underline text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
        >
          Open board ⚠
        </a>
      </div>

      <div className="flex items-center gap-2 flex-wrap text-[11px]">
        <span className="text-[hsl(var(--muted-foreground))] w-14">Block test</span>
        {readiness(clone.test)}
        <button
          onClick={() => onGenerate('test')}
          disabled={busy !== null || !clone.deployed}
          className="text-[10.5px] font-semibold px-2 py-0.5 rounded border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] disabled:opacity-40"
        >
          Generate
        </button>
      </div>

      <BlockResultsPanel participantId={participantId} assignmentId={clone.assignmentId} />
    </div>
  );
}

/**
 * One block's results — what happened, in the order it is asked about.
 *
 * Everything here is in the export already. It is on screen because reading a
 * block otherwise means downloading a zip, opening three CSVs and joining
 * them, and the questions it answers are the ones asked immediately: did the
 * configuration do what they intended, could they predict it, and did they
 * know which part of their setup was acting.
 *
 * The coverage split is the part the first pilot made non-negotiable. One
 * block averaged 3.5, which reads as mediocre; it was four 5s on the questions
 * that reached a rule and three 1-2s on the questions that reached an empty
 * one. Those are not the same finding, and a single mean hides which one it is.
 *
 * Collapsed and loaded on open — during a session this is read between
 * questions, not while the participant is answering one.
 */
function BlockResultsPanel({
  participantId,
  assignmentId,
}: {
  participantId: string;
  assignmentId: string;
}) {
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<BlockResults | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/study/admin/participants/predictions?participantId=${participantId}&assignmentId=${assignmentId}`
      );
      const data = await res.json().catch(() => ({}));
      setResults(res.ok && data.results ? (data.results as BlockResults) : null);
    } finally {
      setLoading(false);
    }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) void load();
  };

  const rows = results?.rows ?? [];
  const missed = rows.filter((r) => r.foldMissed || r.pointingMissed || r.selfModelError);

  return (
    <div className="pt-1">
      <button
        onClick={toggle}
        className="text-[10.5px] font-semibold text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] underline"
      >
        {open ? 'Hide results' : 'Results'}
        {open && results && ` · ${missed.length} missed of ${rows.length}`}
      </button>

      {open && (
        <div className="mt-1.5 rounded-lg border border-[hsl(var(--border))] overflow-hidden">
          {loading && (
            <p className="px-2.5 py-2 text-[10.5px] text-[hsl(var(--muted-foreground))]">
              Reading…
            </p>
          )}
          {!loading && results === null && (
            <p className="px-2.5 py-2 text-[10.5px] text-[hsl(var(--muted-foreground))]">
              Nothing recorded for this block yet.
            </p>
          )}
          {!loading && results && (
            <>
              <ResultsSummary results={results} />
              <ItemStrip rows={rows} />
              <div className="border-t border-[hsl(var(--border))]">
                {rows.map((r) => (
                  <ItemRow key={r.number} row={r} />
                ))}
              </div>
              <SurveyStrip results={results} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Mean desirability, split by whether a rule was reached, then the accuracies. */
function ResultsSummary({ results }: { results: BlockResults }) {
  const fmt = (v: number | null) => (v === null ? '—' : v.toFixed(1));
  const cov = results.covered;
  const unc = results.uncovered;
  return (
    <div className="px-2.5 py-2 bg-[hsl(var(--muted))]/40 border-b border-[hsl(var(--border))] flex flex-wrap items-center gap-x-4 gap-y-1.5">
      <Stat
        label="Desirable"
        value={fmt(results.mean)}
        sub={`Q5, of 6 · ${results.rated}/${results.total} judged`}
        title="Q5 — “the response is educationally desirable”, by their own teaching standards."
      />
      <Stat
        label="Follows setup"
        value={fmt(results.meanFollows)}
        sub="Q6, of 6"
        title="Q6 — “the response follows what I set up”, judged against the configuration on screen."
      />
      {cov && unc && (
        <Stat
          label="Rule reached"
          value={`${fmt(cov.mean)} vs ${fmt(unc.mean)}`}
          sub={`${cov.n} with a rule · ${unc.n} without`}
          // The whole point of the split: an uncovered question was answered
          // with no instruction of theirs, so a low score there is a gap in
          // the configuration, not a rule that behaved badly.
          tone={unc.n > 0 ? 'warn' : 'plain'}
          title="Mean Q5 where a non-empty rule answered, versus where none did. A question with no rule is answered by the bare model."
        />
      )}
      <Stat
        label="Predicted"
        value={`${results.predictionHits}/${results.predictionScored}`}
        sub={`Q4 vs Q5 · err ${fmt(results.meanError)}`}
        title="How often the desirability call landed on the right side of the fold, and the mean |Q4 − Q5| behind it."
      />
      {results.pointingScored !== null && (
        <Stat
          label="Pointed"
          value={`${results.pointingHits}/${results.pointingScored}`}
          sub={`vs what fired · ${results.dontKnow} unsure`}
          title="Did the intent they pointed at turn out to be the one that answered? “I don't know” is a real answer and is counted separately, not as a miss."
        />
      )}
      <Stat
        label="Confidence"
        value={fmt(results.meanConfidence)}
        sub="Q3, of 6"
        title="Q3 — “I can anticipate how the chatbot will respond”. Read against the two hit rates beside it: that pair is the calibration."
      />
      {/* The two quadrants, and the reason they are separate numbers: one is
          about foresight and one is about their own rule. A block can be clean
          on the first and full of the second. */}
      <Stat
        label="Blind spots"
        value={String(results.blindSpots)}
        sub="expected good, wasn’t"
        tone={results.blindSpots > 0 ? 'warn' : 'plain'}
        title="Q4 positive and Q5 negative — the failures they did not see coming."
      />
      <Stat
        label="Rule ≠ want"
        value={String(results.selfModelErrors)}
        sub="followed setup, still bad"
        tone={results.selfModelErrors > 0 ? 'warn' : 'plain'}
        title="Q6 positive and Q5 negative — the response did what their setup said and they still did not want it (code C5)."
      />
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone = 'plain',
  title,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'plain' | 'warn';
  title?: string;
}) {
  return (
    <div title={title} className="leading-tight">
      <p className="text-[9px] font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
        {label}
      </p>
      <p
        className={`text-[13px] font-bold tabular-nums ${
          tone === 'warn' ? 'text-amber-700' : 'text-[hsl(var(--foreground))]'
        }`}
      >
        {value}
      </p>
      {sub && <p className="text-[9px] text-[hsl(var(--muted-foreground))]">{sub}</p>}
    </div>
  );
}

/**
 * Rating colours: one scale, used by the strip and the rows alike.
 *
 * Both variants are spelled out rather than composed with an opacity suffix at
 * render time — Tailwind generates classes it can SEE in the source, so a class
 * built from a template literal produces markup with no styling behind it.
 */
const RATING_TONE: Record<number, string> = {
  1: 'bg-rose-500',
  2: 'bg-orange-400',
  3: 'bg-amber-400',
  4: 'bg-emerald-200',
  5: 'bg-emerald-400',
  6: 'bg-emerald-600',
};

/** The same scale for a question no rule answered — present, but not claimed. */
const RATING_TONE_FADED: Record<number, string> = {
  1: 'bg-rose-100',
  2: 'bg-orange-100',
  3: 'bg-amber-100',
  4: 'bg-emerald-100',
  5: 'bg-emerald-100',
  6: 'bg-emerald-100',
};

/**
 * The block's items as one row — its shape before its detail.
 *
 * Fill is Q5, the ring marks a desirability call that landed on the wrong side
 * of the fold, and a hollow block is a question that reached no rule at all.
 * Reading left to right usually answers "was this a bad configuration or an
 * absent one" on its own.
 */
function ItemStrip({ rows }: { rows: PredictionRow[] }) {
  return (
    <div className="px-2.5 py-2 flex items-end gap-1 border-b border-[hsl(var(--border))]">
      {rows.map((r) => {
        const noRule = r.ruleChars === 0;
        return (
          <div key={r.number} className="flex flex-col items-center gap-0.5">
            <span
              title={`Q${r.number} · desirable ${r.desirable ?? '—'}/6 · follows setup ${
                r.follows ?? '—'
              }/6 · ${noRule ? 'no rule reached' : r.appliedLabel ?? 'answered'}${
                r.foldMissed ? ' · prediction missed' : ''
              }`}
              className={`w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold ${
                r.desirable === null
                  ? 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]'
                  : noRule
                    ? `${RATING_TONE_FADED[r.desirable]} text-[hsl(var(--foreground))] border border-dashed border-[hsl(var(--muted-foreground))]`
                    : `${RATING_TONE[r.desirable]} text-white`
              } ${r.foldMissed ? 'ring-2 ring-offset-1 ring-amber-500' : ''}`}
            >
              {r.desirable ?? '·'}
            </span>
            <span className="text-[8px] text-[hsl(var(--muted-foreground))] tabular-nums">
              {r.number}
            </span>
          </div>
        );
      })}
      <span className="ml-2 text-[9px] leading-snug text-[hsl(var(--muted-foreground))]">
        fill = Q5 desirable · ring = prediction missed
        <br />
        dashed = no rule reached
      </span>
    </div>
  );
}

/** One question: what they said, what fired, and whether either missed. */
function ItemRow({ row: r }: { row: PredictionRow }) {
  const miss = r.foldMissed || r.pointingMissed || r.selfModelError;
  return (
    <div
      className={`px-2.5 py-1.5 border-b last:border-b-0 border-[hsl(var(--border))] ${
        miss ? 'bg-amber-50' : ''
      }`}
    >
      <div className="flex items-center gap-1.5 flex-wrap text-[10.5px]">
        <span className="font-bold tabular-nums w-4">{r.number}</span>
        {r.desirable !== null && (
          <span
            title="Q5 — educationally desirable"
            className={`w-4 h-4 rounded-sm text-white text-[9px] font-bold flex items-center justify-center ${RATING_TONE[r.desirable]}`}
          >
            {r.desirable}
          </span>
        )}
        {r.expectDesirable !== null && (
          <Chip tone={r.foldMissed ? 'warn' : 'plain'}>
            expected {r.expectDesirable}/6
            {r.predError !== null && r.predError > 0 ? ` (±${r.predError})` : ''}
          </Chip>
        )}
        {r.follows !== null && (
          <Chip tone={r.selfModelError ? 'warn' : 'plain'} title="Q6 — follows what I set up">
            follows {r.follows}/6
          </Chip>
        )}
        {r.pointedLabel && (
          <Chip tone={r.pointingMissed ? 'warn' : 'plain'}>→ {r.pointedLabel}</Chip>
        )}
        {r.pointingMissed && r.appliedLabel && (
          <span className="text-[10px] text-amber-800">actually {r.appliedLabel}</span>
        )}
        {r.ruleChars === 0 && (
          <Chip tone="bad" title="No rule answered this — the chatbot replied with no instruction of theirs.">
            no rule
          </Chip>
        )}
      </div>
      <p className="text-[10px] text-[hsl(var(--muted-foreground))] leading-snug mt-0.5">
        {r.question}
      </p>
    </div>
  );
}

/** The block's questionnaire answers, as bars against the scale's top. */
function SurveyStrip({ results }: { results: BlockResults }) {
  const answered = results.survey.filter((s) => s.value !== null);
  if (answered.length === 0) return null;
  return (
    <div className="px-2.5 py-2 border-t border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 flex flex-wrap gap-x-4 gap-y-1.5">
      {answered.map((s) => (
        <div key={s.key} className="leading-tight" title={`${s.label}: ${s.value} of ${results.surveyScaleMax}`}>
          <p className="text-[9px] font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
            {s.label}
          </p>
          <div className="flex items-center gap-1">
            <span className="text-[12px] font-bold tabular-nums">{s.value}</span>
            <span className="inline-block w-10 h-1.5 rounded-full bg-[hsl(var(--border))] overflow-hidden">
              <span
                className="block h-full bg-[hsl(var(--primary))]"
                style={{ width: `${((s.value ?? 0) / results.surveyScaleMax) * 100}%` }}
              />
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Create a participant and assign their cell.
 *
 * The cell used to be arithmetic on the participant number, which meant the
 * design was decided by the naming and could not be balanced against who
 * actually showed up. Here it is a choice, defaulted to whichever cell is
 * currently thinnest so the even split is the path of least resistance rather
 * than something to keep track of on paper.
 */
/**
 * What the study is currently made of.
 *
 * Two datasets, one per block, and the cell a participant is in decides which
 * of the two they meet first — so pointing this at different material
 * re-counterbalances the same four cells rather than breaking them.
 *
 * The change reaches the NEXT participant only. Each participant's pair is
 * stamped on their row when they are created and every phase check reads it
 * from there, because a study that repointed mid-session would otherwise hand
 * someone in block 2 a board they have never seen. That is stated on the
 * control rather than left to be discovered.
 */
function StudyMaterial({
  datasets,
  pair,
  busy,
  setBusy,
  setMessage,
}: {
  datasets: (StudyDataset & { built: boolean })[];
  pair: string[];
  busy: string | null;
  setBusy: (v: string | null) => void;
  setMessage: (v: { tone: 'ok' | 'bad'; text: string } | null) => void;
}) {
  const [current, setCurrent] = useState(pair);
  if (datasets.length === 0) return null;

  const save = async (block1: string, block2: string) => {
    setBusy('pair');
    setMessage(null);
    try {
      const res = await fetch('/api/study/admin/datasets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ block1, block2 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ tone: 'bad', text: data.message ?? 'Could not change the material.' });
        return;
      }
      setCurrent(data.pair as string[]);
      setMessage({
        tone: 'ok',
        text: 'Study material changed — participants created from now on get these two.',
      });
    } finally {
      setBusy(null);
    }
  };

  const pick = (block: 1 | 2, key: string) => {
    const next = block === 1 ? [key, current[1]] : [current[0], key];
    // Choosing the dataset that already holds the other block would leave the
    // study with one dataset twice; the two swap instead, which is what the
    // click plainly means.
    if (next[0] === next[1]) next[block === 1 ? 1 : 0] = current[block === 1 ? 0 : 1];
    void save(next[0], next[1]);
  };

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
        Study material
      </span>
      {([1, 2] as const).map((block) => {
        const chosen = datasets.find((d) => d.key === current[block - 1]);
        return (
          <span key={block} className="flex items-center gap-1.5">
            <span className="text-xs font-semibold">B{block}</span>
            <select
              value={current[block - 1] ?? ''}
              disabled={busy !== null}
              onChange={(e) => pick(block, e.target.value)}
              className="text-[11.5px] border border-[hsl(var(--border))] rounded px-1.5 py-1 bg-[hsl(var(--card))] disabled:opacity-50 max-w-[220px]"
            >
              {datasets.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.label}
                  {d.built ? '' : ' — not built'}
                </option>
              ))}
            </select>
            {chosen && !chosen.built && (
              <Chip tone="warn" title="No study master has been built from this dataset — a participant made now would be cloned the WHOLE log. Confirm its sets and build it first.">
                whole log
              </Chip>
            )}
          </span>
        );
      })}
      {busy === 'pair' && <Loader2 className="w-3 h-3 animate-spin" />}
      <span className="text-[10.5px] text-[hsl(var(--muted-foreground))]">
        applies to participants created from now on
      </span>
      <a
        href="/study/admin/curation"
        className="ml-auto text-[10.5px] font-semibold text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] underline"
      >
        curate datasets →
      </a>
    </div>
  );
}

/**
 * Open a demo from the console.
 *
 * Same route the curation board's buttons call, and deliberately so: a demo is
 * one thing, configured next to the pickers that reserve its material and run
 * from the page that is open on session day. Two entrances, one behaviour.
 *
 * Leaving a demo is a visit to /study/admin, which spends the return cookie and
 * puts the researcher back — and since the demo's own end-of-block control now
 * exits there too, the round trip closes without anything being typed.
 */
function DemoLauncher({
  datasets,
  busy,
  setBusy,
  setMessage,
}: {
  datasets: { key: string; label: string; questions: number }[];
  busy: string | null;
  setBusy: (v: string | null) => void;
  setMessage: (v: { tone: 'ok' | 'bad'; text: string } | null) => void;
}) {
  const run = async (datasetKey: string, condition: StudioView) => {
    setBusy(`demo:${datasetKey}:${condition}`);
    setMessage(null);
    try {
      const res = await fetch('/api/study/admin/curation/demo/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          datasetKey,
          condition,
          start: 'board',
          returnTo: '/study/admin/console',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ tone: 'bad', text: data.message ?? 'Could not start the demo.' });
        setBusy(null);
        return;
      }
      // Not a router push: the session cookie has just been swapped for the
      // demo participant's, and every page above this one was rendered for the
      // researcher.
      window.location.assign(data.url);
    } catch {
      setMessage({ tone: 'bad', text: 'Could not start the demo.' });
      setBusy(null);
    }
  };

  if (datasets.length === 0) return null;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
        Demo
      </span>
      {datasets.map((d) => (
        <span key={d.key} className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-semibold">{d.label}</span>
          {d.questions === 0 ? (
            /* Stated rather than hidden: nothing is reserved for this dataset,
               which is a picker away on the curation board — not a missing
               feature, which is what an absent button reads as. */
            <Chip tone="warn" title="Reserve demo students or subtypes on the curation board first">
              no demo material
            </Chip>
          ) : (
            <>
              <Chip tone="violet">{d.questions} questions</Chip>
              {STUDIO_VIEWS.map((view) => (
                <button
                  key={view}
                  onClick={() => void run(d.key, view)}
                  disabled={busy !== null}
                  title={`Open the ${CONSOLE_DEMO_LABEL[view]} board on ${d.label}'s demo conversations, as a participant sees it`}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] disabled:opacity-50"
                >
                  {busy === `demo:${d.key}:${view}` ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <PlayCircle className="w-3 h-3" />
                  )}
                  {CONSOLE_DEMO_LABEL[view]}
                </button>
              ))}
            </>
          )}
        </span>
      ))}
    </div>
  );
}

/** The researcher's own names for the four boards — the participant-facing
 * code names would make four buttons read Slate / Clay / Slate / Clay. */
const CONSOLE_DEMO_LABEL: Record<StudioView, string> = {
  score: 'SCORE',
  baseline: 'Baseline',
  simple_score: 'Simple SCORE',
  simple_baseline: 'Simple Baseline',
};

function NewParticipant({
  pair,
  existing,
  busy,
  onCreate,
}: {
  /** The study's current material — what the participant being made will get. */
  pair: string[];
  existing: ParticipantStatus[];
  busy: boolean;
  onCreate: (
    participantNumber: string,
    cell: StudyCell,
    family: StudioFamily
  ) => Promise<string | null>;
}) {
  const counts = STUDY_CELLS.map((c) => existing.filter((p) => p.cell === c).length);
  const thinnest = STUDY_CELLS[counts.indexOf(Math.min(...counts))];

  // Left empty on purpose. A suggested "next" number goes wrong in both
  // directions: recruitment slips and the sequence stops matching the roster,
  // and some participants need an id that is not in the pattern at all. The
  // researcher types what this person is actually called.
  const [open, setOpen] = useState(false);
  const [number, setNumber] = useState('');
  const [cell, setCell] = useState<StudyCell>(thinnest);
  // Simple unless said otherwise, and listed first below, because that is what
  // the study runs now — the full board is the earlier build, kept for the
  // pilot's data and for figures. The two families are separate runs of the
  // study, so this is set once for a batch of participants rather than
  // balanced against anything; the cell still does the balancing, within
  // whichever family is being run.
  const [family, setFamily] = useState<StudioFamily>('simple');
  const [made, setMade] = useState<{ number: string; token: string } | null>(null);

  const start = () => {
    setNumber('');
    setCell(thinnest);
    // `family` is deliberately NOT reset: participants are created in batches
    // of one family, so carrying the last choice forward is right and
    // re-picking it every time is not.
    setMade(null);
    setOpen(true);
  };

  const submit = async () => {
    const token = await onCreate(number.trim(), cell, family);
    if (token) setMade({ number: number.trim().toUpperCase(), token });
  };

  if (!open) {
    return (
      <button
        onClick={start}
        className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]"
      >
        <Plus className="w-3.5 h-3.5" /> New participant
      </button>
    );
  }

  return (
    <div className="mb-4 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
      {made ? (
        <>
          <p className="text-xs font-semibold mb-2">
            {made.number} is ready. Send them this link.
          </p>
          <LinkRow token={made.token} />
          <div className="mt-3 flex gap-2">
            <button
              onClick={start}
              className="text-[11px] font-semibold px-2.5 py-1 rounded border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]"
            >
              Create another
            </button>
            <button
              onClick={() => setOpen(false)}
              className="text-[11px] font-semibold px-2.5 py-1 rounded border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]"
            >
              Done
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-3 flex-wrap mb-3">
            <label className="text-[11px] font-semibold">Participant ID</label>
            <input
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              autoFocus
              placeholder="e.g. P01"
              className="w-28 rounded border border-[hsl(var(--border))] px-2 py-1 text-xs font-mono"
            />
            <span className="text-[10.5px] text-[hsl(var(--muted-foreground))]">
              Creating clones both datasets — about 15 seconds.
            </span>
          </div>
          <div className="flex items-center gap-2 mb-3">
            <label className="text-[11px] font-semibold">Version</label>
            {(['simple', 'full'] as StudioFamily[]).map((f) => (
              <button
                key={f}
                onClick={() => setFamily(f)}
                className={`text-[11px] font-semibold px-2.5 py-1 rounded border ${
                  family === f
                    ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5'
                    : 'border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]'
                }`}
              >
                {f}
              </button>
            ))}
            <span className="text-[10.5px] text-[hsl(var(--muted-foreground))]">
              Both of this participant&apos;s blocks. Cannot be changed after setup.
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 mb-3">
            {STUDY_CELLS.map((c, i) => (
              <button
                key={c}
                onClick={() => setCell(c)}
                className={`text-left rounded-lg border px-3 py-2 ${
                  cell === c
                    ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5'
                    : 'border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]'
                }`}
              >
                <span className="text-[11px] font-bold">Cell {c}</span>
                <span className="ml-2 text-[10.5px] text-[hsl(var(--muted-foreground))]">
                  {counts[i]} assigned
                </span>
                <span className="block text-[11px] mt-0.5">{cellLabel(c, family, pair)}</span>
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={submit}
              disabled={busy || number.trim().length === 0}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-[hsl(var(--primary))] text-white disabled:opacity-40"
            >
              {busy && <Loader2 className="w-3 h-3 animate-spin" />} Create
            </button>
            <button
              onClick={() => setOpen(false)}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]"
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** The full link, visible — a facilitator often reads it out or pastes it. */
function LinkRow({ token }: { token: string }) {
  const url = useStudyLink(token);
  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-2 py-1.5 text-[11px] break-all">
        {url}
      </code>
      <CopyButton value={url} label="Copy" />
    </div>
  );
}

/**
 * The start link, or the fact that it has stopped working.
 *
 * Expiry is `phase === 'done'` and nothing else, so the way to reopen a
 * finished session is the phase control already on this row: set it to the step
 * they should resume at and the same link is live again. Said here because a
 * chip that only reads "expired" leaves the researcher hunting for an unlock
 * button that does not exist.
 */
function LinkButton({ token, expired }: { token: string | null; expired: boolean }) {
  // Before the early returns: hooks may not sit behind a condition, and both of
  // those returns are conditions.
  const link = useStudyLink(token ?? '');
  if (!token) return null;
  if (expired) {
    return (
      <Chip tone="plain" title="Set a phase on this row to reopen the link at that step.">
        link expired
      </Chip>
    );
  }
  return <CopyButton value={link} label="link" compact />;
}

/**
 * How the RUNNING number on the progress bar reads — amber at the warning,
 * rose at the cap, plain everywhere else.
 *
 * It used to go rose at a hard-coded 30, the cap from BEFORE design v2 cut the
 * configure block to 25. So the one visual cue the person running the clock
 * gets was arriving five minutes after the block was already over. Both numbers
 * now come from config, and there are two of them because the protocol has two
 * moments: a verbal warning at 20, the cap at 25.
 *
 * Only the configure blocks are on that clock. The bar prints minutes for
 * every step, and a 21-minute break or a slow interview is not late — it is
 * just a different phase, and colouring it would train the facilitator to
 * ignore the colour.
 */
function phaseClockTone(phase: string, minutes: number): string {
  const isWorkBlock = phase === 'block1_work' || phase === 'block2_work';
  if (!isWorkBlock) return 'opacity-70';
  if (minutes >= STUDY_WORK_MINUTES) return 'text-rose-700 font-bold';
  if (minutes >= STUDY_WORK_WARNING_MINUTES) return 'text-amber-700 font-semibold';
  return 'opacity-70';
}

function CopyButton({
  value,
  label,
  compact = false,
}: {
  value: string;
  label: string;
  compact?: boolean;
}) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
        } catch {
          // Clipboard is blocked without https or a user gesture on some
          // setups; the link is on screen either way.
        }
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      title={value}
      className={`inline-flex items-center gap-1 font-semibold rounded border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] ${
        compact ? 'text-[10px] px-1.5 py-0.5' : 'text-[11px] px-2.5 py-1.5'
      }`}
    >
      {done ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
      {done ? 'copied' : label}
    </button>
  );
}

/**
 * The participant's start link, absolute — because it is pasted into a chat
 * window on another machine, where a relative path means nothing.
 *
 * The origin arrives AFTER mount rather than during render. Reading
 * `window.location.origin` while rendering is a server/client branch: the
 * server has no window and produced `/study/s/<token>`, the browser produced
 * `http://…/study/s/<token>`, and React found the two `title` attributes
 * disagreeing and warned that it would not patch the difference up. Which is
 * the real cost — "won't be patched up" means whichever string won could be the
 * server's relative one, and a facilitator would have pasted THAT into the chat
 * window. The first paint still shows the path, and it is a working link on
 * this machine; a moment later it is the full URL.
 */
function useStudyLink(token: string): string {
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);
  return `${origin}/study/s/${token}`;
}

/**
 * Move someone to a different cell — only before they start.
 *
 * Shown as a plain select rather than hidden behind a confirm: mis-assigning
 * the cell is a thing that happens while setting up sixteen people, and it is
 * free to fix right up until the moment they begin. After that the server
 * refuses, because the condition is already stamped on work they have done.
 */
function CellControl({
  participant,
  busy,
  onAssign,
}: {
  participant: ParticipantStatus;
  busy: string | null;
  onAssign: (cell: StudyCell) => void;
}) {
  if (participant.phase !== 'not_started') return null;
  return (
    <select
      value={participant.cell ?? ''}
      disabled={busy !== null}
      onChange={(e) => onAssign(Number(e.target.value) as StudyCell)}
      title="Reassign the counterbalancing cell"
      className="text-[10.5px] rounded border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-1 py-0.5"
    >
      {STUDY_CELLS.map((c) => (
        <option key={c} value={c}>
          {c} · {cellLabel(c, undefined, datasetPairOf(participant))}
        </option>
      ))}
    </select>
  );
}
