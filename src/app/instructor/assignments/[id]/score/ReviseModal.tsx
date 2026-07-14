'use client';

/**
 * Baseline Revise flow: from an anchor question, give feedback / directly edit /
 * rewrite the response → the agent proposes a MINIMAL-EDIT revision of the whole
 * prompt → approve the diff → see the effect across a manually-built review set.
 * Shares DiffApproval + QueryPicker with SCORE; the review set here is built
 * MANUALLY (picker + similar), whereas SCORE auto-seeds it — that difference IS
 * the manipulation. Spec §B-4 / §4.1-4.4.
 */
import { useEffect, useState } from 'react';
import { X, Plus, Sparkles, RefreshCw, Play, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import DiffApproval from './DiffApproval';
import QueryPicker, { type PickerRow } from './QueryPicker';

interface Anchor { messageId: number; queryText: string }
interface SetRow { messageId: number; queryText: string; response: string | null; loading?: boolean }

interface ReviseModalProps {
  assignmentId: string;
  promptText: string; // current editor prompt at open time
  anchor: Anchor;
  log: PickerRow[];
  onApply: (revisedPrompt: string) => void; // commit to editor
  onClose: () => void;
}

export default function ReviseModal({ assignmentId, promptText, anchor, log, onApply, onClose }: ReviseModalProps) {
  const scoreRoot = `/api/instructor/assignments/${assignmentId}/score`;
  const base = `${scoreRoot}/baseline`;
  const scope = 'prompt';

  const [working, setWorking] = useState(promptText); // prompt under revision
  const [mode, setMode] = useState<'feedback' | 'edit_response'>('feedback');
  const [feedback, setFeedback] = useState('');
  const [editedResponse, setEditedResponse] = useState('');
  const [anchorResponse, setAnchorResponse] = useState<string | null>(null);
  const [proposal, setProposal] = useState<{ revisedPrompt: string; rationale: string } | null>(null);
  const [rows, setRows] = useState<SetRow[]>([]);
  const [busy, setBusy] = useState<null | 'propose' | 'apply' | 'refresh'>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => { void init(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function init() {
    await fetch(`${scoreRoot}/review-set`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope, messageIds: [anchor.messageId], source: 'manual' }),
    });
    await loadSet();
    const resp = await previewFor(anchor.messageId, working);
    setAnchorResponse(resp);
    setRows((rs) => rs.map((r) => (r.messageId === anchor.messageId ? { ...r, response: resp } : r)));
    if (mode === 'edit_response' && !editedResponse) setEditedResponse(resp);
  }

  async function loadSet() {
    const res = await fetch(`${scoreRoot}/review-set?scope=${scope}`);
    const data = await res.json().catch(() => ({ items: [] }));
    setRows((prev) => {
      const byId = new Map(prev.map((r) => [r.messageId, r]));
      return (data.items ?? []).map((it: { messageId: number; queryText: string }) => ({
        messageId: it.messageId,
        queryText: it.queryText,
        response: byId.get(it.messageId)?.response ?? null,
      }));
    });
  }

  async function previewFor(messageId: number, prompt: string): Promise<string> {
    const res = await fetch(`${base}/preview`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId, promptText: prompt }),
    });
    const d = await res.json();
    return res.ok ? d.response : `오류: ${d.error}`;
  }

  async function rowPreview(messageId: number) {
    setRows((rs) => rs.map((r) => (r.messageId === messageId ? { ...r, loading: true } : r)));
    const resp = await previewFor(messageId, working);
    setRows((rs) => rs.map((r) => (r.messageId === messageId ? { ...r, response: resp, loading: false } : r)));
  }

  async function refreshAll() {
    setBusy('refresh');
    for (const r of rows) {
      const resp = await previewFor(r.messageId, working);
      setRows((rs) => rs.map((x) => (x.messageId === r.messageId ? { ...x, response: resp } : x)));
      if (r.messageId === anchor.messageId) setAnchorResponse(resp);
    }
    setBusy(null);
  }

  async function addIds(ids: number[], source: 'manual' | 'similar') {
    await fetch(`${scoreRoot}/review-set`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope, messageIds: ids, source }),
    });
    await loadSet();
  }

  async function addSimilar() {
    const res = await fetch(`${scoreRoot}/similar-log?messageId=${anchor.messageId}&limit=8`);
    const data = await res.json().catch(() => ({ similar: [] }));
    const ids = (data.similar ?? []).map((s: { messageId: number }) => s.messageId);
    if (ids.length) await addIds(ids, 'similar');
  }

  async function removeRow(messageId: number) {
    await fetch(`${scoreRoot}/review-set?scope=${scope}&messageId=${messageId}`, { method: 'DELETE' });
    setRows((rs) => rs.filter((r) => r.messageId !== messageId));
  }

  async function propose() {
    setBusy('propose');
    setNote(null);
    setProposal(null);
    try {
      const body =
        mode === 'feedback'
          ? { mode, promptText: working, anchorMessageId: anchor.messageId, feedback, currentResponse: anchorResponse ?? undefined }
          : { mode, promptText: working, anchorMessageId: anchor.messageId, editedResponse, currentResponse: anchorResponse ?? undefined };
      const res = await fetch(`${base}/revise`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'revise_failed');
      const data = await res.json();
      setProposal({ revisedPrompt: data.revisedPrompt, rationale: data.rationale });
    } catch (e) {
      setNote(`제안 실패: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(null);
    }
  }

  function approveProposal() {
    if (!proposal) return;
    setWorking(proposal.revisedPrompt);
    setProposal(null);
    setFeedback('');
    setNote('수정 반영됨 — 검토 세트를 갱신해 다른 질문에 미친 영향을 확인하세요');
    // Responses are now stale vs the new working prompt.
    setRows((rs) => rs.map((r) => ({ ...r, response: null })));
    setAnchorResponse(null);
  }

  const anchorRow = rows.find((r) => r.messageId === anchor.messageId);
  const others = rows.filter((r) => r.messageId !== anchor.messageId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-5xl h-[88vh] flex flex-col rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-[hsl(var(--border))]">
          <div>
            <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">Revise the prompt</h3>
            {note && <p className="text-xs text-[hsl(var(--muted-foreground))]">{note}</p>}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => { onApply(working); onClose(); }} disabled={busy !== null}>
              에디터에 적용
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}><X className="w-4 h-4" /></Button>
          </div>
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-2 gap-0">
          {/* Left: anchor + 3 modes + proposal diff */}
          <div className="min-h-0 flex flex-col border-r border-[hsl(var(--border))] overflow-y-auto p-4 space-y-3">
            <div>
              <div className="text-xs font-medium text-[hsl(var(--muted-foreground))] mb-1">Anchor question</div>
              <div className="rounded bg-[hsl(var(--muted))] px-3 py-2 text-sm whitespace-pre-wrap">{anchor.queryText}</div>
            </div>
            <div>
              <div className="text-xs font-medium text-[hsl(var(--muted-foreground))] mb-1">Current response (draft)</div>
              <div className="rounded bg-[hsl(var(--background))] border border-[hsl(var(--border))] px-3 py-2 text-sm whitespace-pre-wrap min-h-[2rem]">
                {anchorResponse ?? '…'}
              </div>
            </div>

            <div className="flex gap-1 text-xs">
              {(['feedback', 'edit_response'] as const).map((m) => (
                <button
                  key={m}
                  className={`px-2 py-1 rounded ${mode === m ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]' : 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]'}`}
                  onClick={() => { setMode(m); if (m === 'edit_response' && !editedResponse && anchorResponse) setEditedResponse(anchorResponse); }}
                >
                  {m === 'feedback' ? '피드백' : '응답 고쳐쓰기'}
                </button>
              ))}
              <button className="px-2 py-1 rounded bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]" onClick={onClose} title="에디터에서 직접 수정">직접 편집</button>
            </div>

            {mode === 'feedback' ? (
              <textarea
                className="w-full h-24 resize-none rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm focus:outline-none"
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="이 응답의 무엇이 문제인지 알려주세요 (예: 학생에게 답을 그냥 줬다)"
              />
            ) : (
              <textarea
                className="w-full h-32 resize-none rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm focus:outline-none"
                value={editedResponse}
                onChange={(e) => setEditedResponse(e.target.value)}
                placeholder="원하는 응답으로 고쳐 쓰세요 — 에이전트가 일반화된 변경을 추론합니다"
              />
            )}
            <Button
              onClick={propose}
              disabled={busy !== null || (mode === 'feedback' ? !feedback.trim() : !editedResponse.trim())}
            >
              {busy === 'propose' ? '제안 중…' : '수정안 받기'}
            </Button>

            {proposal && (
              <DiffApproval
                before={working}
                after={proposal.revisedPrompt}
                rationale={proposal.rationale}
                onApprove={approveProposal}
                onReject={() => setProposal(null)}
              />
            )}
          </div>

          {/* Right: review set */}
          <div className="min-h-0 flex flex-col overflow-hidden">
            <div className="px-4 py-2 border-b border-[hsl(var(--border))] flex items-center justify-between">
              <span className="text-sm font-semibold text-[hsl(var(--foreground))]">검토 세트 ({rows.length})</span>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" className="gap-1 h-7 px-2" onClick={() => setPickerOpen(true)}><Plus className="w-3.5 h-3.5" /> 추가</Button>
                <Button variant="ghost" size="sm" className="gap-1 h-7 px-2" onClick={addSimilar}><Sparkles className="w-3.5 h-3.5" /> 유사</Button>
                <Button variant="ghost" size="sm" className="gap-1 h-7 px-2" onClick={refreshAll} disabled={busy === 'refresh'}><RefreshCw className="w-3.5 h-3.5" /> 갱신</Button>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-2">
              {[anchorRow, ...others].filter(Boolean).map((r) => {
                const row = r as SetRow;
                return (
                  <div key={row.messageId} className="rounded border border-[hsl(var(--border))] p-2">
                    <div className="flex items-start gap-1">
                      <span className="flex-1 text-xs text-[hsl(var(--foreground))]">
                        {row.messageId === anchor.messageId && <span className="text-[hsl(var(--primary))] font-medium">[anchor] </span>}
                        {row.queryText}
                      </span>
                      {row.messageId !== anchor.messageId && (
                        <button className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--destructive))]" onClick={() => removeRow(row.messageId)}><Trash2 className="w-3.5 h-3.5" /></button>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))] whitespace-pre-wrap">
                      {row.loading ? '생성 중…' : row.response ?? (
                        <button className="inline-flex items-center gap-1 text-[hsl(var(--foreground))]" onClick={() => rowPreview(row.messageId)}><Play className="w-3 h-3" /> 응답 보기</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {pickerOpen && (
        <QueryPicker
          log={log}
          excludeIds={new Set(rows.map((r) => r.messageId))}
          onAdd={(ids) => addIds(ids, 'manual')}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
