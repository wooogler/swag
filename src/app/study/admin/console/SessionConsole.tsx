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
import type { ParticipantStatus, CloneStatus, PredictionRow } from '@/lib/study/console-store';
import {
  cellLabel,
  PHASE_LABELS,
  STUDY_CELLS,
  type StudyCell,
  type StudyPhase,
} from '@/lib/study/phases';
import { STUDY_WORK_MINUTES, STUDY_WORK_WARNING_MINUTES } from '@/lib/study/config';

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
}: {
  initial: ParticipantStatus[];
  phases: string[];
  actor: string;
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

        <NewParticipant
          existing={participants}
          busy={busy !== null}
          onCreate={async (participantNumber, cell) => {
            setBusy('create');
            setMessage(null);
            try {
              const res = await fetch('/api/study/admin/participants/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ participantNumber, cell }),
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
                <Chip tone="violet" title={p.cell ? cellLabel(p.cell as StudyCell) : undefined}>
                  cell {p.cell}
                </Chip>
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
                <Chip tone="ok">
                  {PHASE_LABELS[p.phase as StudyPhase] ?? p.phase}
                  {p.phaseMinutes !== null && (
                    <span className={phaseClockTone(p.phase, p.phaseMinutes)}>
                      {' '}
                      {p.phaseMinutes}m
                    </span>
                  )}
                </Chip>
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
                      : `${c.work.filters} filter(s) · ${c.work.rulesChars} chars`}
                    {' · '}
                    {c.work.ruleEdits} edit(s) · {c.work.deploys} deploy(s)
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

      <ProbeList participantId={participantId} assignmentId={clone.assignmentId} />
    </div>
  );
}

/**
 * Which questions to probe (문항지 §3 ④).
 *
 * The facilitator can watch the yes/no miss happen on the shared screen, but
 * not the pointing one — whether the intent they picked is the intent that
 * fired is a comparison the participant never sees and, before this, no screen
 * showed. Collapsed by default and loaded on open: it is read between
 * questions, not while the participant is answering one.
 */
function ProbeList({
  participantId,
  assignmentId,
}: {
  participantId: string;
  assignmentId: string;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<PredictionRow[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/study/admin/participants/predictions?participantId=${participantId}&assignmentId=${assignmentId}`
      );
      const data = await res.json().catch(() => ({}));
      setRows(res.ok && Array.isArray(data.rows) ? (data.rows as PredictionRow[]) : []);
    } finally {
      setLoading(false);
    }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) void load();
  };

  const missed = (rows ?? []).filter((r) => r.guessMissed || r.pointingMissed);

  return (
    <div className="pt-1">
      <button
        onClick={toggle}
        className="text-[10.5px] font-semibold text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] underline"
      >
        {open ? 'Hide' : 'Probe list'}
        {open && rows !== null && ` · ${missed.length} missed of ${rows.length}`}
      </button>

      {open && (
        <div className="mt-1.5 rounded-lg border border-[hsl(var(--border))] overflow-hidden">
          {loading && (
            <p className="px-2.5 py-2 text-[10.5px] text-[hsl(var(--muted-foreground))]">
              Reading…
            </p>
          )}
          {!loading && rows !== null && rows.length === 0 && (
            <p className="px-2.5 py-2 text-[10.5px] text-[hsl(var(--muted-foreground))]">
              Nothing recorded for this block yet.
            </p>
          )}
          {!loading &&
            (rows ?? []).map((r) => {
              const miss = r.guessMissed || r.pointingMissed;
              return (
                <div
                  key={r.number}
                  className={`px-2.5 py-1.5 border-b last:border-b-0 border-[hsl(var(--border))] ${
                    miss ? 'bg-amber-50' : ''
                  }`}
                >
                  <div className="flex items-center gap-1.5 flex-wrap text-[10.5px]">
                    <span className="font-bold tabular-nums w-4">{r.number}</span>
                    {r.guess !== null && (
                      <Chip tone={r.guessMissed ? 'warn' : 'plain'}>
                        said {r.guess ? 'yes' : 'no'}
                        {r.rating !== null && ` · rated ${r.rating}`}
                      </Chip>
                    )}
                    {r.pointedLabel && (
                      <Chip tone={r.pointingMissed ? 'warn' : 'plain'}>
                        → {r.pointedLabel}
                      </Chip>
                    )}
                    {r.pointingMissed && r.appliedLabel && (
                      <span className="text-[10px] text-amber-800">
                        actually {r.appliedLabel}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-[hsl(var(--muted-foreground))] leading-snug mt-0.5">
                    {r.question}
                  </p>
                </div>
              );
            })}
        </div>
      )}
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
function NewParticipant({
  existing,
  busy,
  onCreate,
}: {
  existing: ParticipantStatus[];
  busy: boolean;
  onCreate: (participantNumber: string, cell: StudyCell) => Promise<string | null>;
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
  const [made, setMade] = useState<{ number: string; token: string } | null>(null);

  const start = () => {
    setNumber('');
    setCell(thinnest);
    setMade(null);
    setOpen(true);
  };

  const submit = async () => {
    const token = await onCreate(number.trim(), cell);
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
                <span className="block text-[11px] mt-0.5">{cellLabel(c)}</span>
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
 * How the facilitator's elapsed chip reads — amber at the warning, rose at the
 * cap, plain everywhere else.
 *
 * It used to go rose at a hard-coded 30, the cap from BEFORE design v2 cut the
 * configure block to 25. So the one visual cue the person running the clock
 * gets was arriving five minutes after the block was already over. Both numbers
 * now come from config, and there are two of them because the protocol has two
 * moments: a verbal warning at 20, the cap at 25.
 *
 * Only the configure blocks are on that clock. The chip shows minutes-in-phase
 * for every phase, and a 21-minute break or a slow interview is not late — it
 * is just a different phase, and colouring it would train the facilitator to
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
          {c} · {cellLabel(c)}
        </option>
      ))}
    </select>
  );
}
