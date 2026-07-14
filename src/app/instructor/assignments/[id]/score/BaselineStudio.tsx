'use client';

/**
 * Baseline condition studio (ablation of the SCORE board): a monolithic
 * system-prompt editor over the same real student-query log, with judge-powered
 * search (presets + saved custom searches, clearly_in only), coarse versions and
 * Deploy. NO rule objects, grades, coverage, pins — that is the manipulation.
 * See docs/STUDY_BASELINE_SPEC.md §3.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, Plus, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import InstructorHeaderActions from '@/components/instructor/InstructorHeaderActions';
import type { BaselineLogRow, BaselineState } from '@/lib/study/baseline-store';
import SearchWorkbench, { type ClearlyInRow } from './SearchWorkbench';

interface Preset { intentId: number; title: string; definition: string }
interface SavedSearch { id: string; description: string }
interface WorkbenchState { description: string; results?: ClearlyInRow[]; savedSearchId?: string }

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
  const [savedPrompt, setSavedPrompt] = useState(initialState.hasSavedVersion ? initialState.currentPrompt : null);
  const [versions, setVersions] = useState(initialState.versions);
  const [deployedVersionNo, setDeployedVersionNo] = useState(initialState.deployedVersionNo);
  const [busy, setBusy] = useState<null | 'save' | 'deploy' | 'restore'>(null);
  const [note, setNote] = useState<string | null>(null);

  const [presets, setPresets] = useState<Preset[]>([]);
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [wb, setWb] = useState<WorkbenchState | null>(null);

  const scoreRoot = `/api/instructor/assignments/${assignmentId}/score`;
  const base = `${scoreRoot}/baseline`;
  const savedBaseline = savedPrompt ?? initialState.currentPrompt;
  const dirty = prompt !== savedBaseline;
  const over = prompt.length > charLimit;

  useEffect(() => { void loadSearchLists(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadSearchLists() {
    const [p, s] = await Promise.all([
      fetch(`${base}/presets`).then((r) => r.json()).catch(() => ({ presets: [] })),
      fetch(`${base}/searches`).then((r) => r.json()).catch(() => ({ searches: [] })),
    ]);
    setPresets(p.presets ?? []);
    setSearches(s.searches ?? []);
  }

  async function openPreset(preset: Preset) {
    const res = await fetch(`${base}/presets?intentId=${preset.intentId}`).then((r) => r.json()).catch(() => ({ clearlyIn: [] }));
    setWb({ description: preset.definition, results: res.clearlyIn ?? [] });
  }

  async function deleteSearch(id: string) {
    await fetch(`${base}/searches?id=${id}`, { method: 'DELETE' });
    await loadSearchLists();
  }

  async function refreshVersions() {
    const res = await fetch(`${base}/versions`);
    if (res.ok) {
      const data = await res.json();
      setVersions(data.versions);
      setDeployedVersionNo(data.deployedVersionNo);
    }
  }

  async function persist(kind: 'save' | 'deploy') {
    if (over) return;
    setBusy(kind);
    setNote(null);
    try {
      const res = await fetch(`${base}/${kind === 'save' ? 'versions' : 'deploy'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      if (!res.ok) throw new Error((await res.json()).error || `${kind}_failed`);
      const { versionNo } = await res.json();
      setSavedPrompt(prompt);
      await refreshVersions();
      setNote(`${kind === 'save' ? '저장됨' : '배포됨'} · v${versionNo}`);
    } catch (e) {
      setNote(`${kind === 'save' ? '저장' : '배포'} 실패: ${e instanceof Error ? e.message : e}`);
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
            <Button variant="outline" onClick={() => persist('save')} disabled={!!busy || !dirty || over}>
              {busy === 'save' ? 'Saving…' : 'Save'}
            </Button>
            <Button onClick={() => persist('deploy')} disabled={!!busy || over}>
              {busy === 'deploy' ? 'Deploying…' : 'Deploy'}
            </Button>
            <InstructorHeaderActions email={instructorEmail} />
          </div>
        </div>
      </header>

      <div className="flex-1 min-h-0 max-w-[1600px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-4 grid grid-cols-[minmax(220px,260px)_minmax(240px,300px)_1fr] gap-4">
        {/* Search list: presets + saved custom searches */}
        <aside className="min-h-0 flex flex-col rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
          <div className="px-4 py-3 border-b border-[hsl(var(--border))] flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[hsl(var(--foreground))]">Searches</h2>
            <Button variant="ghost" size="sm" className="gap-1 h-7 px-2" onClick={() => setWb({ description: '' })}>
              <Plus className="w-3.5 h-3.5" /> New
            </Button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-3">
            {searches.length > 0 && (
              <div>
                <div className="px-2 py-1 text-xs font-medium text-[hsl(var(--muted-foreground))]">Saved</div>
                <ul className="space-y-0.5">
                  {searches.map((s) => (
                    <li key={s.id} className="group flex items-center gap-1 px-2 py-1.5 rounded text-sm hover:bg-[hsl(var(--muted))]/40">
                      <button
                        className="flex-1 text-left flex items-center gap-1.5 text-[hsl(var(--foreground))] truncate"
                        onClick={() => setWb({ description: s.description, savedSearchId: s.id })}
                        title={s.description}
                      >
                        <Search className="w-3.5 h-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
                        <span className="truncate">{s.description}</span>
                      </button>
                      <button className="opacity-0 group-hover:opacity-100 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--destructive))]" onClick={() => deleteSearch(s.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div>
              <div className="px-2 py-1 text-xs font-medium text-[hsl(var(--muted-foreground))]">Presets ({presets.length})</div>
              <ul className="space-y-0.5">
                {presets.map((p) => (
                  <li key={p.intentId}>
                    <button
                      className="w-full text-left px-2 py-1.5 rounded text-sm text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]/40 truncate"
                      onClick={() => openPreset(p)}
                      title={p.definition}
                    >
                      {p.title}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </aside>

        {/* Student query log (read-only) */}
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
                    <li key={r.messageId} title={r.queryText} className="px-2 py-1.5 rounded text-sm text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]/40 line-clamp-2">
                      {r.queryText}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </aside>

        {/* System prompt editor */}
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
                    <option key={v.versionNo} value={v.versionNo}>v{v.versionNo}{v.deployed ? ' (배포됨)' : ''}</option>
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

      {wb && (
        <SearchWorkbench
          assignmentId={assignmentId}
          initialDescription={wb.description}
          initialResults={wb.results}
          savedSearchId={wb.savedSearchId}
          onClose={() => setWb(null)}
          onSavedChange={loadSearchLists}
        />
      )}
    </div>
  );
}
