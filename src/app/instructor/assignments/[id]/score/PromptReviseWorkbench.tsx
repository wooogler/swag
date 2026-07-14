'use client';

/**
 * Baseline "Revise the system prompt" — the ablation counterpart of the SCORE
 * RuleWorkbench, mirroring its layout so the two conditions feel the same:
 *
 *   LEFT   the monolithic SYSTEM PROMPT in an always-editable box + the coarse
 *          prompt version history (Save records a version; click one to view it)
 *   MIDDLE the response the current prompt produces for the active question,
 *          rendered with the same ChatMessages component; question TABS across
 *          the anchor + examples you pull in ("Add example")
 *   RIGHT  a Cursor-style feedback panel: give feedback / rewrite the reply →
 *          the agent proposes a MINIMAL edit of the whole prompt, applied to the
 *          box; input pinned at the bottom, with the shared feedback starters
 *
 * The ONE structural difference from SCORE's RuleWorkbench (the study
 * manipulation): the target is the WHOLE monolithic prompt, not one intent's
 * rule, and the review set (the example tabs) is built BY HAND. Reuses
 * ChatMessages + QueryPicker + the FEEDBACK_CHIPS starters + MaterialSegments,
 * and the baseline revise/preview/versions/deploy endpoints.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUp,
  HelpCircle,
  Loader2,
  Plus,
  Rocket,
  Save as SaveIcon,
  Sparkles,
  Star,
  Wand2,
  X,
} from 'lucide-react';
import type { ScoreQueryRow } from './IntentBoard';
import ChatMessages from '@/components/chat/ChatMessages';
import QueryPicker from './QueryPicker';
import { FEEDBACK_CHIPS } from './RuleWorkbench';
import { MaterialSegments } from './materials';
import { getJSON, postJSON } from './http';

interface ChatEntry {
  id: number;
  role: 'user' | 'agent';
  text: string;
  /** Agent entries: the short rationale. */
  name?: string;
  /** The prompt this exchange produced — the panel reads as a changelog. */
  prompt?: string;
}

interface PromptVersion {
  versionNo: number;
  deployed: boolean;
  createdAt: string;
}

interface PromptReviseWorkbenchProps {
  assignmentId: string;
  /** Every logged question — the picker's source and the tabs' threads. */
  rows: ScoreQueryRow[];
  /** The question the instructor opened Revise from. */
  anchor: ScoreQueryRow;
  /** The board's current draft prompt at open time — the revision starts here. */
  promptText: string;
  /** Exit: a revised prompt to apply to the board editor, or null to discard. */
  onClose: (revisedPrompt: string | null) => void;
}

export default function PromptReviseWorkbench({
  assignmentId,
  rows,
  anchor,
  promptText,
  onClose,
}: PromptReviseWorkbenchProps) {
  const base = `/api/instructor/assignments/${assignmentId}/score/baseline`;
  const rowById = useMemo(() => new Map(rows.map((r) => [r.messageId, r])), [rows]);

  // The monolithic prompt under revision, and the reference it's "dirty" against.
  const [working, setWorking] = useState(promptText);
  const [refText, setRefText] = useState(promptText);
  const dirty = working !== refText;

  // Coarse version history (baseline_prompt_versions) + which one is being viewed.
  const [versions, setVersions] = useState<PromptVersion[] | null>(null);
  const [deployedVersionNo, setDeployedVersionNo] = useState<number | null>(null);
  const [viewingVersionNo, setViewingVersionNo] = useState<number | null>(null);

  // Question TABS: the anchor plus examples pulled in by hand.
  const [exampleIds, setExampleIds] = useState<number[]>([]);
  const tabIds = useMemo(
    () => [anchor.messageId, ...exampleIds.filter((id) => id !== anchor.messageId)],
    [anchor.messageId, exampleIds]
  );
  const [activeId, setActiveId] = useState(anchor.messageId);
  const activeRow = rowById.get(activeId) ?? anchor;

  // The response each tab's question gets under the CURRENT prompt.
  const [previews, setPreviews] = useState<Map<number, string | null>>(new Map());
  const [previewing, setPreviewing] = useState<Set<number>>(new Set());

  // The Cursor-style agent log + input.
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [feedback, setFeedback] = useState('');
  const [rewriteOpen, setRewriteOpen] = useState(false);
  const [rewriteText, setRewriteText] = useState('');
  const [guideOpen, setGuideOpen] = useState<boolean | null>(null);

  const [busy, setBusy] = useState<null | 'propose' | 'save' | 'deploy'>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const chatIdRef = useRef(1);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const cancelled = useRef(false);
  useEffect(() => () => { cancelled.current = true; }, []);
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat.length, busy]);

  const activeResponse = previews.get(activeId) ?? null;
  const activePreviewing = previewing.has(activeId);

  // Load the version list + preview the anchor once, on open.
  useEffect(() => {
    void loadVersions();
    void regen(anchor.messageId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadVersions() {
    const d = await getJSON<{ versions?: PromptVersion[]; deployedVersionNo?: number | null }>(
      `${base}/versions`
    ).catch(() => ({ versions: [] as PromptVersion[], deployedVersionNo: null }));
    if (cancelled.current) return;
    setVersions(d.versions ?? []);
    setDeployedVersionNo(d.deployedVersionNo ?? null);
  }

  async function preview(messageId: number, prompt: string): Promise<string> {
    try {
      const d = await postJSON<{ response: string }>(`${base}/preview`, { messageId, promptText: prompt });
      return d.response;
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : e}`;
    }
  }

  /** (Re)generate the response for one tab under the current working prompt. */
  async function regen(messageId: number) {
    setPreviewing((s) => new Set(s).add(messageId));
    const resp = await preview(messageId, working);
    if (cancelled.current) return;
    setPreviews((m) => new Map(m).set(messageId, resp));
    setPreviewing((s) => {
      const n = new Set(s);
      n.delete(messageId);
      return n;
    });
  }

  /** Fold the agent's proposal into the working prompt + refresh the tab. */
  function applyProposal(revisedPrompt: string, rationale: string) {
    setWorking(revisedPrompt);
    setViewingVersionNo(null);
    // Every tab's response is now stale against the new prompt.
    setPreviews(new Map());
    setChat((c) => [
      ...c,
      { id: chatIdRef.current++, role: 'agent', text: rationale, name: 'Revised the prompt', prompt: revisedPrompt },
    ]);
    void regenUnder(activeId, revisedPrompt);
  }

  async function regenUnder(messageId: number, prompt: string) {
    setPreviewing((s) => new Set(s).add(messageId));
    const resp = await preview(messageId, prompt);
    if (cancelled.current) return;
    setPreviews((m) => new Map(m).set(messageId, resp));
    setPreviewing((s) => {
      const n = new Set(s);
      n.delete(messageId);
      return n;
    });
  }

  async function propose(mode: 'feedback' | 'edit_response', payload: string) {
    setBusy('propose');
    setError(null);
    setNote(null);
    const userText = mode === 'feedback' ? payload : 'Rewrote the reply the way I want it.';
    setChat((c) => [...c, { id: chatIdRef.current++, role: 'user', text: userText }]);
    try {
      const body =
        mode === 'feedback'
          ? { mode, promptText: working, anchorMessageId: activeId, feedback: payload, currentResponse: activeResponse ?? undefined }
          : { mode, promptText: working, anchorMessageId: activeId, editedResponse: payload, currentResponse: activeResponse ?? undefined };
      const data = await postJSON<{ revisedPrompt: string; rationale: string }>(`${base}/revise`, body);
      applyProposal(data.revisedPrompt, data.rationale);
    } catch (e) {
      setError(`Proposal failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(null);
    }
  }

  function sendFeedback() {
    if (!feedback.trim() || busy) return;
    const text = feedback.trim();
    setFeedback('');
    void propose('feedback', text);
  }

  function sendRewrite() {
    if (!rewriteText.trim() || busy) return;
    const text = rewriteText.trim();
    setRewriteOpen(false);
    void propose('edit_response', text);
  }

  async function save() {
    setBusy('save');
    setError(null);
    try {
      const { versionNo } = await postJSON<{ versionNo: number }>(`${base}/versions`, { prompt: working });
      setRefText(working);
      setViewingVersionNo(versionNo);
      setNote(`Saved · v${versionNo}`);
      await loadVersions();
    } catch (e) {
      setError(`Save failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(null);
    }
  }

  async function deploy() {
    setBusy('deploy');
    setError(null);
    try {
      const { versionNo } = await postJSON<{ versionNo: number }>(`${base}/deploy`, { prompt: working });
      setRefText(working);
      setViewingVersionNo(versionNo);
      setDeployedVersionNo(versionNo);
      setNote(`Deployed · v${versionNo}`);
      await loadVersions();
    } catch (e) {
      setError(`Deploy failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(null);
    }
  }

  async function viewVersion(versionNo: number) {
    setError(null);
    try {
      const { prompt } = await getJSON<{ prompt: string }>(`${base}/versions?versionNo=${versionNo}`);
      setWorking(prompt);
      setRefText(prompt);
      setViewingVersionNo(versionNo);
      setPreviews(new Map());
      void regenUnder(activeId, prompt);
    } catch (e) {
      setError(`Could not load v${versionNo}: ${e instanceof Error ? e.message : e}`);
    }
  }

  function addExamples(ids: number[]) {
    const fresh = ids.filter((id) => id !== anchor.messageId && !exampleIds.includes(id));
    if (!fresh.length) return;
    setExampleIds((prev) => [...prev, ...fresh]);
    for (const id of fresh) void regen(id);
  }

  function removeExample(id: number) {
    setExampleIds((prev) => prev.filter((x) => x !== id));
    if (activeId === id) setActiveId(anchor.messageId);
  }

  function selectTab(id: number) {
    setActiveId(id);
    setRewriteOpen(false);
    if (!previews.has(id)) void regen(id);
  }

  const showGuide = guideOpen ?? chat.length === 0;

  return (
    <div className="flex flex-col gap-3 flex-1 min-h-0">
      {/* TOP BAR */}
      <div className="shrink-0 flex items-center gap-3">
        <button
          onClick={() => onClose(null)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-xs font-medium text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]"
          title="Back to the board — unapplied changes are discarded"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Board
        </button>
        <h2 className="text-sm font-semibold truncate">Revise the system prompt</h2>
        <span className="ml-auto text-[10px] text-[hsl(var(--muted-foreground))]">
          Previews are single-turn regenerations with the live chatbot model — indicative, not a guarantee.
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(320px,380px)_minmax(0,1fr)_minmax(300px,380px)] gap-4 flex-1 min-h-0">
        {/* LEFT — the monolithic system prompt + version history. */}
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] flex flex-col overflow-hidden">
          <div className="shrink-0 px-4 pt-3 flex items-center justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
              System prompt{viewingVersionNo ? ` · v${viewingVersionNo}` : ''}
            </p>
            {dirty ? (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">not saved yet</span>
            ) : null}
          </div>
          <div className="flex-1 min-h-0 px-4 pt-1.5">
            <textarea
              value={working}
              onChange={(e) => {
                setWorking(e.target.value);
                setViewingVersionNo(null);
              }}
              spellCheck={false}
              className="w-full h-full min-h-[8rem] resize-none rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5 text-xs font-mono leading-relaxed focus:outline-none focus:ring-1 focus:ring-[hsl(var(--ring))]"
              placeholder="The chatbot's whole system prompt — edit it directly, or use the feedback agent on the right."
            />
          </div>
          <div className="shrink-0 px-4 py-2 flex items-center gap-2">
            <button
              onClick={() => void save()}
              disabled={!!busy || !dirty}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] disabled:opacity-50"
              title="Record a version of this prompt"
            >
              {busy === 'save' ? <Loader2 className="w-3 h-3 animate-spin" /> : <SaveIcon className="w-3 h-3" />} Save
            </button>
            <button
              onClick={() => void deploy()}
              disabled={!!busy}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] disabled:opacity-50"
              title="Save this prompt and serve it to students"
            >
              {busy === 'deploy' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Rocket className="w-3 h-3" />} Deploy
            </button>
            <span className="text-[10px] text-[hsl(var(--muted-foreground))]">{working.length.toLocaleString()} chars</span>
          </div>

          {/* VERSION HISTORY */}
          <div className="shrink-0 max-h-44 overflow-y-auto border-t border-[hsl(var(--border))] px-4 py-2 space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">History</p>
            {versions === null ? (
              <p className="flex items-center gap-1.5 text-[11px] text-[hsl(var(--muted-foreground))]">
                <Loader2 className="w-3 h-3 animate-spin" /> Loading…
              </p>
            ) : versions.length === 0 ? (
              <p className="text-[11px] text-[hsl(var(--muted-foreground))]">No versions yet — Save records one.</p>
            ) : (
              <ul className="space-y-0.5">
                {versions.map((v) => {
                  const active = viewingVersionNo === v.versionNo;
                  return (
                    <li key={v.versionNo}>
                      <button
                        onClick={() => void viewVersion(v.versionNo)}
                        className={`w-full flex items-center justify-between gap-2 rounded px-2 py-1 text-left text-[11px] ${
                          active ? 'bg-[hsl(var(--muted))] font-medium' : 'hover:bg-[hsl(var(--muted))]/50'
                        }`}
                        title="Load this version into the editor"
                      >
                        <span>v{v.versionNo}</span>
                        {v.deployed || deployedVersionNo === v.versionNo ? (
                          <span className="rounded border border-emerald-200 bg-emerald-50 px-1 text-[9px] font-medium text-emerald-700">
                            deployed
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="pt-0.5 text-[10px] text-[hsl(var(--muted-foreground))]">
              {deployedVersionNo ? `Students receive v${deployedVersionNo}` : 'Not deployed yet — students get the base prompt'}
            </p>
          </div>
        </div>

        {/* MIDDLE — the response the current prompt gives the active question. */}
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] flex flex-col overflow-hidden">
          {/* QUESTION TABS — anchor + examples. */}
          <div className="shrink-0 flex items-center gap-1 border-b border-[hsl(var(--border))] px-2 py-1.5 overflow-x-auto">
            {tabIds.map((id) => {
              const r = rowById.get(id);
              const isAnchor = id === anchor.messageId;
              const on = activeId === id;
              return (
                <span key={id} className="group inline-flex items-center shrink-0">
                  <button
                    onClick={() => selectTab(id)}
                    className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] ${
                      on ? 'bg-[hsl(var(--muted))] font-medium text-[hsl(var(--foreground))]' : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]/50'
                    }`}
                    title={r?.queryText}
                  >
                    {isAnchor && <Star className="w-3 h-3 text-[hsl(var(--primary))]" />}
                    {r?.participantToken || `#${id}`}
                    {r && r.turnNumber > 0 ? ` · T${r.turnNumber}` : ''}
                  </button>
                  {!isAnchor && (
                    <button
                      onClick={() => removeExample(id)}
                      className="opacity-0 group-hover:opacity-100 -ml-1 p-0.5 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--destructive))]"
                      title="Remove this example"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </span>
              );
            })}
            <button
              onClick={() => setPickerOpen(true)}
              className="ml-auto shrink-0 inline-flex items-center gap-1 rounded border border-[hsl(var(--border))] px-2 py-1 text-[11px] font-medium text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]"
              title="Pull in more logged questions to preview this prompt against"
            >
              <Plus className="w-3 h-3" /> Add example
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto">
            <ChatMessages
              messages={[
                {
                  id: activeRow.messageId,
                  role: 'user' as const,
                  content: activeRow.queryText,
                  timestamp: Date.parse(activeRow.queryTimestamp),
                },
                ...(activeResponse && !activePreviewing
                  ? [{ id: `resp-${activeId}`, role: 'assistant' as const, content: activeResponse }]
                  : []),
              ]}
              showTimestamp
              autoScrollToHighlight
              renderUserContent={(m) =>
                m.id === activeRow.messageId && activeRow.dissection && activeRow.dissection.materialKinds.length > 0 ? (
                  <MaterialSegments text={activeRow.queryText} dissection={activeRow.dissection} />
                ) : null
              }
              onEditAssistant={(m) => {
                setRewriteText(m.content);
                setRewriteOpen(true);
              }}
            />
            <div className="px-4 pb-4">
              {activePreviewing ? (
                <p className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating the response under this prompt…
                </p>
              ) : rewriteOpen ? (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-medium text-[hsl(var(--muted-foreground))]">
                    Rewrite the reply the way you want it — the agent infers the generalizable change.
                  </p>
                  <textarea
                    value={rewriteText}
                    onChange={(e) => setRewriteText(e.target.value)}
                    rows={6}
                    className="w-full resize-y rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm focus:outline-none"
                  />
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => setRewriteOpen(false)}
                      className="px-2.5 py-1 rounded text-[11px] border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={sendRewrite}
                      disabled={!!busy || !rewriteText.trim()}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] disabled:opacity-50"
                    >
                      <Wand2 className="w-3 h-3" /> Propose from my rewrite
                    </button>
                  </div>
                </div>
              ) : !activeResponse ? (
                <button
                  onClick={() => void regen(activeId)}
                  className="inline-flex items-center gap-1 text-xs text-[hsl(var(--foreground))] hover:underline"
                >
                  <Wand2 className="w-3.5 h-3.5" /> Generate the response
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {/* RIGHT — Cursor-style feedback agent. */}
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] flex flex-col overflow-hidden min-h-[300px] lg:min-h-0">
          <div className="shrink-0 px-3 py-2 border-b border-[hsl(var(--border))] flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
              <Sparkles className="w-3.5 h-3.5" /> Feedback
              <button
                onClick={() => setGuideOpen((v) => !(v ?? chat.length === 0))}
                title="What makes a strong prompt — the five elements"
                className={`inline-flex items-center p-0.5 rounded hover:text-[hsl(var(--foreground))] ${showGuide ? 'text-[hsl(var(--primary))]' : ''}`}
              >
                <HelpCircle className="w-3.5 h-3.5" />
              </button>
            </span>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
            {showGuide && (
              <div className="rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 p-2.5 space-y-1.5 text-[11px] text-[hsl(var(--muted-foreground))]">
                <p className="font-semibold text-[hsl(var(--foreground))]">
                  Not sure what to ask for? A strong prompt covers five things:
                </p>
                <ul className="space-y-1">
                  <li><span className="font-medium text-[hsl(var(--foreground))]">Finish line</span> — what &quot;done&quot; looks like. <span className="text-emerald-700">Highest impact.</span></li>
                  <li><span className="font-medium text-[hsl(var(--foreground))]">Role</span> — the stance (coach, not answer engine).</li>
                  <li><span className="font-medium text-[hsl(var(--foreground))]">Moves</span> — one question at a time; hints only after an attempt.</li>
                  <li><span className="font-medium text-[hsl(var(--foreground))]">Load</span> — 1–2 sentences; end with a next step.</li>
                  <li><span className="font-medium text-[hsl(var(--foreground))]">Guardrails</span> — no direct answers, even under pressure.</li>
                </ul>
              </div>
            )}
            {chat.map((m) =>
              m.role === 'user' ? (
                <div key={m.id} className="flex flex-col items-end gap-1">
                  <p className="max-w-[90%] rounded-2xl rounded-tr-sm bg-[hsl(var(--muted))] px-3 py-2 text-xs whitespace-pre-wrap">{m.text}</p>
                </div>
              ) : (
                <div key={m.id} className="text-xs">
                  <p className="flex items-center gap-1.5 font-medium text-[hsl(var(--foreground))]">
                    <Sparkles className="w-3 h-3 shrink-0 text-[hsl(var(--primary))]" />
                    <span className="min-w-0 truncate">{m.name}</span>
                  </p>
                  {m.text && <p className="mt-0.5 whitespace-pre-wrap text-[hsl(var(--muted-foreground))]">{m.text}</p>}
                  {m.prompt !== undefined && (
                    <div className="mt-1 max-h-40 overflow-y-auto rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 p-2 text-[11px] leading-relaxed whitespace-pre-wrap text-[hsl(var(--foreground))]">
                      {m.prompt}
                    </div>
                  )}
                </div>
              )
            )}
            {busy === 'propose' && (
              <p className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Revising the prompt…
              </p>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Feedback starters — insert into the box (editable), not send. */}
          <div className="shrink-0 flex flex-wrap gap-1 px-3 pb-2">
            {FEEDBACK_CHIPS.map((c) => (
              <button
                key={c.label}
                onClick={() => setFeedback((prev) => (prev.trim() ? `${prev.trimEnd()}\n${c.text}` : c.text))}
                disabled={busy === 'propose'}
                title={c.text}
                className="rounded-full border border-[hsl(var(--border))] px-2 py-0.5 text-[10px] font-medium text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] disabled:opacity-50"
              >
                {c.label}
              </button>
            ))}
          </div>

          <div className="shrink-0 border-t border-[hsl(var(--border))] p-2.5 space-y-1.5">
            {error && (
              <p className="flex items-center gap-1 text-[11px] text-red-600">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {error}
                <button onClick={() => setError(null)} className="ml-auto p-0.5" aria-label="Dismiss">
                  <X className="w-3 h-3" />
                </button>
              </p>
            )}
            {note && !error && <p className="text-[11px] text-[hsl(var(--muted-foreground))]">{note}</p>}
            <p className="flex flex-wrap items-center gap-1 text-[10px] text-[hsl(var(--muted-foreground))]">
              Feedback on:
              <span className="rounded border border-[hsl(var(--border))] px-1 py-0.5 font-mono">
                {activeRow.participantToken || '—'}
                {activeRow.turnNumber > 0 ? ` · T${activeRow.turnNumber}` : ''}
              </span>
            </p>
            <div className="relative">
              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendFeedback();
                  }
                }}
                rows={3}
                placeholder="What's wrong with this response? (Enter to send, Shift+Enter for a new line)"
                className="w-full resize-none rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2.5 py-2 pr-10 text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
              />
              <button
                onClick={sendFeedback}
                disabled={busy === 'propose' || !feedback.trim()}
                title="Propose a revision from this feedback"
                className="absolute bottom-2.5 right-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] disabled:opacity-40"
              >
                {busy === 'propose' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowUp className="w-3.5 h-3.5" />}
              </button>
            </div>
            <div className="flex justify-end">
              <button
                onClick={() => onClose(working)}
                disabled={!!busy}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] disabled:opacity-50"
                title="Take this prompt back to the board editor"
              >
                Apply to editor
              </button>
            </div>
          </div>
        </div>
      </div>

      {pickerOpen && (
        <QueryPicker
          log={rows}
          excludeIds={new Set(tabIds)}
          onAdd={addExamples}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
