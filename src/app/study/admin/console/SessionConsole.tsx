'use client';

/**
 * Facilitator console — one row per participant, run left to right.
 *
 * Everything a moderator needs mid-session without leaving the page: where the
 * participant is, whether each clone is deployed, whether the frozen answers
 * the next phase depends on exist and are still current, and the buttons to
 * generate them, advance, or (when a run goes wrong) reset or remove.
 */

import { useCallback, useState } from 'react';
import { Loader2, RefreshCw, ChevronRight, ChevronLeft, Trash2, RotateCcw } from 'lucide-react';
import type { ParticipantStatus, CloneStatus } from '@/lib/study/console-store';
import { PHASE_LABELS, type StudyPhase } from '@/lib/study/phases';

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

  const refresh = useCallback(async () => {
    const res = await fetch('/api/study/admin/participants');
    if (!res.ok) return;
    const data = await res.json();
    setParticipants(data.participants);
  }, []);

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
              ? `진행 차단: ${(data.blockers as string[]).join(' · ')}`
              : data.message ?? data.error ?? '실패했습니다.',
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

  const generate = async (p: ParticipantStatus, kind: 'test' | 'ab', block?: 1 | 2) => {
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
          ? { tone: 'ok', text: `${kind} 응답 생성 완료` }
          : { tone: 'bad', text: `일부 실패: ${failed.map((f) => f.error ?? `${f.failed}건`).join(', ')}` }
      );
    }
  };

  const runConfirmed = async () => {
    if (!confirmFor) return;
    const data = await post(
      '/api/study/admin/participants/manage',
      { ...confirmFor, confirm: confirmText },
      `${confirmFor.participantId}:${confirmFor.action}`
    );
    if (data?.success) {
      setMessage({ tone: 'ok', text: `${confirmFor.number}: ${confirmFor.action} 완료` });
      setConfirmFor(null);
      setConfirmText('');
    }
  };

  return (
    <div className="min-h-screen bg-[hsl(var(--background))]">
      <header className="bg-[hsl(var(--card))] border-b border-[hsl(var(--border))]">
        <div className="max-w-[1500px] mx-auto px-6 py-4 flex items-center gap-3">
          <h1 className="text-sm font-semibold">Session Console</h1>
          <a
            href="/study/admin/curation"
            className="text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] underline"
          >
            Set curation →
          </a>
          <div className="flex-1" />
          <button
            onClick={refresh}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]"
          >
            <RefreshCw className="w-3 h-3" /> 새로고침
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

        {participants.length === 0 && (
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            아직 로그인한 참가자가 없습니다. 참가자가 /study 에서 번호로 로그인하면 여기에 나타납니다.
          </p>
        )}

        <div className="space-y-3">
          {participants.map((p) => (
            <div
              key={p.id}
              className="border border-[hsl(var(--border))] rounded-xl bg-[hsl(var(--card))] overflow-hidden"
            >
              <div className="px-4 py-3 flex items-center gap-3 flex-wrap border-b border-[hsl(var(--border))]">
                <span className="font-mono text-sm font-bold">{p.participantNumber}</span>
                <Chip tone="violet">cell {p.cell}</Chip>
                <Chip>{p.blockOrder}</Chip>
                <Chip tone="ok">{PHASE_LABELS[p.phase as StudyPhase] ?? p.phase}</Chip>
                {p.lastLoginAt && (
                  <span className="text-[10.5px] text-[hsl(var(--muted-foreground))]">
                    last login {new Date(p.lastLoginAt).toLocaleString()}
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
                  <ChevronLeft className="w-3 h-3" /> 이전
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
                  다음 페이즈
                </button>
              </div>

              {p.blockers.length > 0 && (
                <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 flex items-center gap-2 flex-wrap">
                  <span className="text-[10.5px] font-bold uppercase tracking-wide text-amber-700">
                    다음 페이즈 차단
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
                    무시하고 진행
                  </button>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[hsl(var(--border))]">
                {p.clones.map((clone) => (
                  <CloneCard
                    key={clone.assignmentId}
                    clone={clone}
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

              <div className="px-4 py-2 flex items-center gap-2 border-t border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30">
                <span className="text-[10.5px] text-[hsl(var(--muted-foreground))]">
                  세션 관리
                </span>
                <div className="flex-1" />
                <button
                  onClick={() =>
                    setConfirmFor({ participantId: p.id, number: p.participantNumber, action: 'reset_all' })
                  }
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] disabled:opacity-50"
                >
                  <RotateCcw className="w-3 h-3" /> 전체 워크스페이스 리셋
                </button>
                <button
                  onClick={() =>
                    setConfirmFor({ participantId: p.id, number: p.participantNumber, action: 'remove' })
                  }
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded border border-rose-300 text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                >
                  <Trash2 className="w-3 h-3" /> 참가자 삭제
                </button>
              </div>
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
                  ? '참가자를 완전히 삭제합니다'
                  : confirmFor.action === 'reset_all'
                    ? '모든 워크스페이스를 리셋합니다'
                    : `${confirmFor.datasetKey} 워크스페이스를 리셋합니다`}
              </h2>
            </div>
            <div className="px-5 py-4 space-y-3">
              <p className="text-xs text-[hsl(var(--muted-foreground))] leading-relaxed">
                {confirmFor.action === 'remove'
                  ? '계정과 두 클론, 그동안의 모든 설정 작업이 사라집니다. 되돌릴 수 없습니다.'
                  : '이 참가자의 설정 작업(intent·rule·필터·배포)이 사라지고 마스터에서 다시 복제됩니다. 참가자 번호는 그대로 유지됩니다.'}
              </p>
              <label className="block text-[11px] font-semibold text-[hsl(var(--muted-foreground))]">
                확인을 위해 참가자 번호 <span className="font-mono text-[hsl(var(--foreground))]">{confirmFor.number}</span> 를 입력하세요
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
                취소
              </button>
              <button
                onClick={runConfirmed}
                disabled={confirmText.trim().toUpperCase() !== confirmFor.number || busy !== null}
                className="text-xs font-semibold px-3 py-1.5 rounded bg-rose-600 text-white disabled:opacity-40"
              >
                {busy?.startsWith(confirmFor.participantId) ? '실행 중…' : '실행'}
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
  busy,
  onGenerate,
  onReset,
}: {
  clone: CloneStatus;
  busy: string | null;
  onGenerate: (kind: 'test' | 'ab') => void;
  onReset: () => void;
}) {
  const readiness = (r: { missing: number; stale: number; current: boolean }) =>
    r.current ? (
      <Chip tone="ok">준비됨</Chip>
    ) : (
      <Chip tone="warn">
        {r.missing > 0 && `없음 ${r.missing}`}
        {r.missing > 0 && r.stale > 0 && ' · '}
        {r.stale > 0 && `stale ${r.stale}`}
        {r.missing === 0 && r.stale === 0 && '문항 없음'}
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
          <Chip tone="bad">미배포</Chip>
        )}
        <a
          href={`/instructor/assignments/${clone.assignmentId}/score`}
          className="text-[10.5px] underline text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
        >
          보드 열기
        </a>
      </div>

      <div className="flex items-center gap-2 flex-wrap text-[11px]">
        <span className="text-[hsl(var(--muted-foreground))] w-14">블록 테스트</span>
        {readiness(clone.test)}
        <button
          onClick={() => onGenerate('test')}
          disabled={busy !== null || !clone.deployed}
          className="text-[10.5px] font-semibold px-2 py-0.5 rounded border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] disabled:opacity-40"
        >
          생성
        </button>
      </div>

      <div className="flex items-center gap-2 flex-wrap text-[11px]">
        <span className="text-[hsl(var(--muted-foreground))] w-14">A/B</span>
        {readiness(clone.ab)}
        <button
          onClick={() => onGenerate('ab')}
          disabled={busy !== null || !clone.deployed}
          className="text-[10.5px] font-semibold px-2 py-0.5 rounded border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] disabled:opacity-40"
        >
          생성 (양 데이터셋)
        </button>
        <button
          onClick={onReset}
          disabled={busy !== null}
          className="ml-auto text-[10.5px] font-semibold px-2 py-0.5 rounded border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] disabled:opacity-40"
        >
          이 클론 리셋
        </button>
      </div>
    </div>
  );
}
