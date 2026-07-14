'use client';

/**
 * Baseline condition studio (ablation of the SCORE board): a monolithic
 * system-prompt editor over the same real student-query log, with coarse
 * versions + Deploy. Search / test-chat / revise are added in later phases.
 * See docs/STUDY_BASELINE_SPEC.md §3.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import InstructorHeaderActions from '@/components/instructor/InstructorHeaderActions';
import type { BaselineLogRow, BaselineState } from '@/lib/study/baseline-store';

interface BaselineStudioProps {
  assignmentId: string;
  assignmentTitle: string;
  instructorEmail: string;
  initialState: BaselineState;
  log: BaselineLogRow[];
  charLimit: number;
}

export default function BaselineStudio({
  assignmentId,
  assignmentTitle,
  instructorEmail,
  initialState,
  log,
  charLimit,
}: BaselineStudioProps) {
  const [prompt, setPrompt] = useState(initialState.currentPrompt);
  const [savedPrompt, setSavedPrompt] = useState(
    initialState.hasSavedVersion ? initialState.currentPrompt : null
  );
  const [versions, setVersions] = useState(initialState.versions);
  const [deployedVersionNo, setDeployedVersionNo] = useState(initialState.deployedVersionNo);
  const [busy, setBusy] = useState<null | 'save' | 'deploy' | 'restore'>(null);
  const [note, setNote] = useState<string | null>(null);

  const base = `/api/instructor/assignments/${assignmentId}/score/baseline`;
  const savedBaseline = savedPrompt ?? initialState.currentPrompt;
  const dirty = prompt !== savedBaseline;
  const over = prompt.length > charLimit;

  async function refreshVersions() {
    const res = await fetch(`${base}/versions`);
    if (res.ok) {
      const data = await res.json();
      setVersions(data.versions);
      setDeployedVersionNo(data.deployedVersionNo);
    }
  }

  async function doSave() {
    if (over) return;
    setBusy('save');
    setNote(null);
    try {
      const res = await fetch(`${base}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'save_failed');
      const { versionNo } = await res.json();
      setSavedPrompt(prompt);
      await refreshVersions();
      setNote(`저장됨 · v${versionNo}`);
    } catch (e) {
      setNote(`저장 실패: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(null);
    }
  }

  async function doDeploy() {
    if (over) return;
    setBusy('deploy');
    setNote(null);
    try {
      const res = await fetch(`${base}/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'deploy_failed');
      const { versionNo } = await res.json();
      setSavedPrompt(prompt);
      await refreshVersions();
      setNote(`배포됨 · v${versionNo}`);
    } catch (e) {
      setNote(`배포 실패: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(null);
    }
  }

  async function restore(versionNo: number) {
    setBusy('restore');
    setNote(null);
    try {
      const res = await fetch(`${base}/versions?versionNo=${versionNo}`);
      if (!res.ok) throw new Error('restore_failed');
      const { prompt: text } = await res.json();
      setPrompt(text);
      setNote(`v${versionNo} 불러옴 (저장하려면 Save)`);
    } catch {
      setNote('불러오기 실패');
    } finally {
      setBusy(null);
    }
  }

  const grouped = useMemo(() => {
    const m = new Map<string, BaselineLogRow[]>();
    for (const r of log) {
      const k = r.participantToken || '—';
      (m.get(k) ?? m.set(k, []).get(k)!).push(r);
    }
    return [...m.entries()];
  }, [log]);

  return (
    <div className="h-screen flex flex-col bg-[hsl(var(--background))]">
      <header className="shrink-0 bg-[hsl(var(--card))] border-b border-[hsl(var(--border))]">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-4">
            <Link href={`/instructor/assignments/${assignmentId}`}>
              <Button variant="ghost" size="icon" className="hover:bg-[hsl(var(--muted))]">
                <ChevronLeft className="w-5 h-5 text-[hsl(var(--muted-foreground))]" />
              </Button>
            </Link>
            <div className="flex-1">
              <h1 className="text-xl font-bold font-heading text-[hsl(var(--foreground))]">
                Chatbot Studio · <span className="font-normal">{assignmentTitle}</span>
              </h1>
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                Write the chatbot&apos;s instructions, grounded in real student questions
              </p>
            </div>
            {note && <span className="text-sm text-[hsl(var(--muted-foreground))]">{note}</span>}
            <Button variant="outline" onClick={doSave} disabled={!!busy || !dirty || over}>
              {busy === 'save' ? 'Saving…' : 'Save'}
            </Button>
            <Button onClick={doDeploy} disabled={!!busy || over}>
              {busy === 'deploy' ? 'Deploying…' : 'Deploy'}
            </Button>
            <InstructorHeaderActions email={instructorEmail} />
          </div>
        </div>
      </header>

      <div className="flex-1 min-h-0 max-w-[1600px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-4 grid grid-cols-[minmax(280px,360px)_1fr] gap-4">
        {/* Left: student query log (read-only) */}
        <aside className="min-h-0 flex flex-col rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
          <div className="px-4 py-3 border-b border-[hsl(var(--border))]">
            <h2 className="text-sm font-semibold text-[hsl(var(--foreground))]">Student questions</h2>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">{log.length} queries · {grouped.length} students</p>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-3">
            {grouped.map(([token, rows]) => (
              <div key={token}>
                <div className="px-2 py-1 text-xs font-medium text-[hsl(var(--muted-foreground))]">{token}</div>
                <ul className="space-y-1">
                  {rows.map((r) => (
                    <li
                      key={r.messageId}
                      title={r.queryText}
                      className="px-2 py-1.5 rounded text-sm text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]/40 line-clamp-2"
                    >
                      {r.queryText}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </aside>

        {/* Center: system prompt editor */}
        <main className="min-h-0 flex flex-col rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
          <div className="px-4 py-3 border-b border-[hsl(var(--border))] flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-[hsl(var(--foreground))]">System prompt</h2>
            <div className="flex items-center gap-3 text-xs">
              {versions.length > 0 && (
                <select
                  className="bg-[hsl(var(--background))] border border-[hsl(var(--border))] rounded px-2 py-1 text-[hsl(var(--foreground))]"
                  value=""
                  onChange={(e) => e.target.value && restore(Number(e.target.value))}
                  disabled={!!busy}
                >
                  <option value="">버전 불러오기…</option>
                  {versions.map((v) => (
                    <option key={v.versionNo} value={v.versionNo}>
                      v{v.versionNo}{v.deployed ? ' (배포됨)' : ''}
                    </option>
                  ))}
                </select>
              )}
              <span className={over ? 'text-[hsl(var(--destructive))] font-medium' : 'text-[hsl(var(--muted-foreground))]'}>
                {prompt.length.toLocaleString()} / {charLimit.toLocaleString()}
              </span>
            </div>
          </div>
          <textarea
            className="flex-1 min-h-0 w-full resize-none bg-transparent px-4 py-3 text-sm font-mono leading-relaxed text-[hsl(var(--foreground))] focus:outline-none"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            spellCheck={false}
            placeholder="이 챗봇이 학생과 어떻게 대화해야 하는지 지침을 작성하세요…"
          />
          <div className="px-4 py-2 border-t border-[hsl(var(--border))] text-xs text-[hsl(var(--muted-foreground))]">
            {deployedVersionNo ? `학생에게 배포된 버전: v${deployedVersionNo}` : '아직 배포 안 됨 — 학생은 기본 프롬프트를 받습니다'}
            {dirty && <span className="ml-2 text-[hsl(var(--foreground))]">· 저장되지 않은 변경</span>}
          </div>
        </main>
      </div>
    </div>
  );
}
