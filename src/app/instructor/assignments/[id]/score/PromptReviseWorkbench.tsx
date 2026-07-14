'use client';

/**
 * Baseline "Revise the system prompt" — the inline counterpart of the SCORE
 * RuleWorkbench, ablated to the whole monolithic prompt. Shell parity: LEFT is
 * the editable system prompt (the thing being revised, where a proposal lands),
 * MIDDLE is the revision agent (anchor question → its response, give feedback or
 * rewrite the response → a MINIMAL-EDIT diff of the whole prompt), RIGHT is the
 * review set the instructor builds BY HAND (picker + similar) to see the edit's
 * effect on other questions. Manual set construction (vs SCORE auto-seeding) IS
 * the study manipulation. Reuses WorkbenchTopBar + DiffApproval + QueryPicker
 * and the baseline revise/preview/review-set endpoints. Spec §B-4 / §4.1–4.4.
 */
import { useEffect, useRef, useState } from 'react';
import { Play, Plus, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ScoreQueryRow } from './IntentBoard';
import { WorkbenchTopBar } from './workbench-shared';
import DiffApproval from './DiffApproval';
import QueryPicker from './QueryPicker';

interface SetRow {
  messageId: number;
  queryText: string;
  response: string | null;
  loading?: boolean;
}

interface PromptReviseWorkbenchProps {
  assignmentId: string;
  /** Every logged question — the picker's source and the anchor's thread. */
  rows: ScoreQueryRow[];
  /** The question the instructor opened Revise from. */
  anchor: ScoreQueryRow;
  /** The board's current draft prompt at open time — the revision starts here. */
  promptText: string;
  /** Called on exit: a revised prompt to apply to the board editor, or null to
   * discard and return. */
  onClose: (revisedPrompt: string | null) => void;
}

export default function PromptReviseWorkbench({
  assignmentId,
  rows,
  anchor,
  promptText,
  onClose,
}: PromptReviseWorkbenchProps) {
  const scoreRoot = `/api/instructor/assignments/${assignmentId}/score`;
  const base = `${scoreRoot}/baseline`;
  const scope = 'prompt';

  const [working, setWorking] = useState(promptText); // the prompt under revision
  const [mode, setMode] = useState<'feedback' | 'edit_response'>('feedback');
  const [feedback, setFeedback] = useState('');
  const [editedResponse, setEditedResponse] = useState('');
  const [anchorResponse, setAnchorResponse] = useState<string | null>(null);
  const [proposal, setProposal] = useState<{ revisedPrompt: string; rationale: string } | null>(null);
  const [setRows_, setSetRows] = useState<SetRow[]>([]);
  const [busy, setBusy] = useState<null | 'propose' | 'apply' | 'refresh'>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const cancelled = useRef(false);
  useEffect(() => () => { cancelled.current = true; }, []);

  const dirty = working !== promptText;

  useEffect(() => {
    void init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function init() {
    // Seed the review set with the anchor, load it, and preview the anchor.
    await fetch(`${scoreRoot}/review-set`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope, messageIds: [anchor.messageId], source: 'manual' }),
    });
    await loadSet();
    const resp = await previewFor(anchor.messageId, working);
    if (cancelled.current) return;
    setAnchorResponse(resp);
    setSetRows((rs) => rs.map((r) => (r.messageId === anchor.messageId ? { ...r, response: resp } : r)));
    if (mode === 'edit_response' && !editedResponse) setEditedResponse(resp);
  }

  async function loadSet() {
    const res = await fetch(`${scoreRoot}/review-set?scope=${scope}`);
    const data = await res.json().catch(() => ({ items: [] }));
    if (cancelled.current) return;
    setSetRows((prev) => {
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
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId, promptText: prompt }),
    });
    const d = await res.json().catch(() => ({}));
    return res.ok ? d.response : `Error: ${d.error ?? 'preview_failed'}`;
  }

  async function rowPreview(messageId: number) {
    setSetRows((rs) => rs.map((r) => (r.messageId === messageId ? { ...r, loading: true } : r)));
    const resp = await previewFor(messageId, working);
    setSetRows((rs) => rs.map((r) => (r.messageId === messageId ? { ...r, response: resp, loading: false } : r)));
  }

  async function refreshAll() {
    setBusy('refresh');
    for (const r of setRows_) {
      if (cancelled.current) break;
      const resp = await previewFor(r.messageId, working);
      setSetRows((rs) => rs.map((x) => (x.messageId === r.messageId ? { ...x, response: resp } : x)));
      if (r.messageId === anchor.messageId) setAnchorResponse(resp);
    }
    setBusy(null);
  }

  async function addIds(ids: number[], source: 'manual' | 'similar') {
    await fetch(`${scoreRoot}/review-set`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    setSetRows((rs) => rs.filter((r) => r.messageId !== messageId));
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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'revise_failed');
      const data = await res.json();
      setProposal({ revisedPrompt: data.revisedPrompt, rationale: data.rationale });
    } catch (e) {
      setNote(`Proposal failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(null);
    }
  }

  function approveProposal() {
    if (!proposal) return;
    setWorking(proposal.revisedPrompt);
    setProposal(null);
    setFeedback('');
    setNote('Revision applied to the prompt — refresh the review set to see its effect on other questions.');
    // Every preview is now stale against the new working prompt.
    setSetRows((rs) => rs.map((r) => ({ ...r, response: null })));
    setAnchorResponse(null);
  }

  const anchorRow = setRows_.find((r) => r.messageId === anchor.messageId);
  const others = setRows_.filter((r) => r.messageId !== anchor.messageId);

  return (
    <div className="flex flex-col gap-3 flex-1 min-h-0">
      <div className="shrink-0 flex items-center justify-between gap-3">
        <WorkbenchTopBar
          title="Revise the system prompt"
          note={note ?? undefined}
          onBack={() => onClose(null)}
          backTitle="Back to the board — unapplied changes are discarded"
        />
        <Button size="sm" onClick={() => onClose(working)} disabled={busy !== null || !dirty}>
          Apply to editor
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[380px_minmax(0,1fr)_minmax(0,1fr)] gap-4 flex-1 min-h-0">
        {/* LEFT — the monolithic system prompt (the thing being revised). */}
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] flex flex-col overflow-hidden">
          <div className="shrink-0 px-3 py-2 border-b border-[hsl(var(--border))] text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
            System prompt
          </div>
          <textarea
            value={working}
            onChange={(e) => setWorking(e.target.value)}
            className="flex-1 min-h-0 w-full resize-none text-sm border-0 px-3 py-2 bg-[hsl(var(--background))] focus:outline-none font-mono leading-relaxed"
            placeholder="The chatbot's whole system prompt — edit it directly, or use the revision agent."
          />
          <div className="shrink-0 px-3 py-1.5 border-t border-[hsl(var(--border))] text-[11px] text-[hsl(var(--muted-foreground))]">
            {working.length.toLocaleString()} chars{dirty ? ' · unapplied' : ''}
          </div>
        </div>

        {/* MIDDLE — the revision agent: anchor question → response → feedback/rewrite → diff. */}
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-y-auto">
          <div className="p-4 space-y-3">
            <div>
              <div className="text-xs font-medium text-[hsl(var(--muted-foreground))] mb-1">Anchor question</div>
              <div className="rounded bg-[hsl(var(--muted))] px-3 py-2 text-sm whitespace-pre-wrap">{anchor.queryText}</div>
            </div>
            <div>
              <div className="text-xs font-medium text-[hsl(var(--muted-foreground))] mb-1">
                Current response (under the prompt on the left)
              </div>
              <div className="rounded bg-[hsl(var(--background))] border border-[hsl(var(--border))] px-3 py-2 text-sm whitespace-pre-wrap min-h-[2rem]">
                {anchorResponse ?? '…'}
              </div>
            </div>

            <div className="flex gap-1 text-xs">
              {(['feedback', 'edit_response'] as const).map((m) => (
                <button
                  key={m}
                  className={`px-2 py-1 rounded ${mode === m ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]' : 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]'}`}
                  onClick={() => {
                    setMode(m);
                    if (m === 'edit_response' && !editedResponse && anchorResponse) setEditedResponse(anchorResponse);
                  }}
                >
                  {m === 'feedback' ? 'Give feedback' : 'Rewrite the response'}
                </button>
              ))}
            </div>

            {mode === 'feedback' ? (
              <textarea
                className="w-full h-24 resize-none rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm focus:outline-none"
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="What's wrong with this response? (e.g. it just handed the student the answer)"
              />
            ) : (
              <textarea
                className="w-full h-32 resize-none rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm focus:outline-none"
                value={editedResponse}
                onChange={(e) => setEditedResponse(e.target.value)}
                placeholder="Rewrite the response the way you want it — the agent infers the generalizable change."
              />
            )}
            <Button
              onClick={propose}
              disabled={busy !== null || (mode === 'feedback' ? !feedback.trim() : !editedResponse.trim())}
            >
              {busy === 'propose' ? 'Proposing…' : 'Propose revision'}
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
        </div>

        {/* RIGHT — the manually built review set (the manipulation). */}
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] flex flex-col overflow-hidden">
          <div className="shrink-0 px-4 py-2 border-b border-[hsl(var(--border))] flex items-center justify-between">
            <span className="text-sm font-semibold text-[hsl(var(--foreground))]">Review set ({setRows_.length})</span>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" className="gap-1 h-7 px-2" onClick={() => setPickerOpen(true)}>
                <Plus className="w-3.5 h-3.5" /> Add
              </Button>
              <Button variant="ghost" size="sm" className="gap-1 h-7 px-2" onClick={addSimilar}>
                <Sparkles className="w-3.5 h-3.5" /> Similar
              </Button>
              <Button variant="ghost" size="sm" className="gap-1 h-7 px-2" onClick={refreshAll} disabled={busy === 'refresh'}>
                <RefreshCw className="w-3.5 h-3.5" /> Refresh
              </Button>
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-2">
            {[anchorRow, ...others].filter(Boolean).map((r) => {
              const row = r as SetRow;
              return (
                <div key={row.messageId} className="rounded border border-[hsl(var(--border))] p-2">
                  <div className="flex items-start gap-1">
                    <span className="flex-1 text-xs text-[hsl(var(--foreground))]">
                      {row.messageId === anchor.messageId && (
                        <span className="text-[hsl(var(--primary))] font-medium">[anchor] </span>
                      )}
                      {row.queryText}
                    </span>
                    {row.messageId !== anchor.messageId && (
                      <button
                        className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--destructive))]"
                        onClick={() => removeRow(row.messageId)}
                        title="Remove from the review set"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))] whitespace-pre-wrap">
                    {row.loading ? (
                      'Generating…'
                    ) : row.response ?? (
                      <button
                        className="inline-flex items-center gap-1 text-[hsl(var(--foreground))]"
                        onClick={() => rowPreview(row.messageId)}
                      >
                        <Play className="w-3 h-3" /> See response
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {setRows_.length === 0 && (
              <p className="px-2 py-4 text-sm text-[hsl(var(--muted-foreground))]">
                Add questions to preview how this prompt answers them.
              </p>
            )}
          </div>
        </div>
      </div>

      {pickerOpen && (
        <QueryPicker
          log={rows}
          excludeIds={new Set(setRows_.map((r) => r.messageId))}
          onAdd={(ids) => addIds(ids, 'manual')}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
