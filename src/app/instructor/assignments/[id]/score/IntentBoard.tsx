'use client';

/**
 * SCORE v6 — the intents-mode main page (S1): BASE PROMPT card + INTENTS
 * panel + NEEDS DECISION box + UNASSIGNED row on the left, the selected
 * Question Group in the middle, and the read-only Conversation viewer on the
 * right (pasted Material collapsed into per-kind tags — materials.tsx).
 *
 * Assignment resolution is derived here with the shared deterministic
 * resolver (intents.ts) — nothing is stored; link/pin edits re-derive
 * instantly after router.refresh().
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  applyPinOverrides,
  boundaryKey,
  RATING_LABELS,
  resolveAssignment,
  type AssignmentResolution,
  type MaterialKind,
  type RatingLevel,
} from '@/lib/score/intents';
import { SCORE_RATING_MODEL } from '@/lib/score/models';
import {
  AlertTriangle,
  Archive,
  ChevronRight,
  Link2,
  Maximize2,
  MessageSquare,
  Pencil,
  Pin,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { jelsonToIntent, jelsonTypeToIntent, type JelsonSuggestion } from '@/lib/score/jelson-suggest';
import { QuerySnippet, StudentMessage } from './materials';
import IntentModal from './IntentModal';
import DecideOwnershipModal from './DecideOwnershipModal';
import DeployModal, { type DeployStatus } from './DeployModal';
import ReviseModal from './ReviseModal';
import { runShardedRate } from './rate-runner';

/** One student message, with its per-intent ratings/pins and dissection. Built
 * server-side in page.tsx; the sole row shape for the intents board. */
export interface ScoreQueryRow {
  messageId: number;
  sessionId: string;
  /** The chat thread this message belongs to — one session may hold several.
   * Used to reconstruct the full conversation in the viewer's modal. */
  conversationId: string;
  participantToken: string;
  queryText: string;
  responseText: string | null;
  prevQueryText: string | null;
  prevResponseText: string | null;
  turnIndex: number;
  turnNumber: number;
  queryTimestamp: string;
  /** v6 intent layer: per-intent 5-level rating (+staleness vs the intent's
   * current defHash) and the message dissection, when rated. */
  intentRatings: Record<number, { rating: RatingLevel; rationale: string | null; stale: boolean }>;
  /** Instructor pin verdicts on this question — override its ratings (§1.6). */
  pinnedIntents: Record<number, 'in' | 'out'>;
  dissection: { materialKinds: MaterialKind[]; requests: string[] } | null;
}

export interface IntentSummary {
  id: number;
  title: string;
  definition: string;
  rule: string | null;
  archived: boolean;
  /** Pre-built starter-set template: rated in advance but not owning the log. */
  isTemplate: boolean;
  pinCount: number;
}

export interface IntentLinkSummary {
  fromIntentId: number;
  toIntentId: number;
}

/** Type dot colors for the pre-built starter-set library. */
const TYPE_DOT: Record<string, string> = {
  Planning: 'bg-blue-500',
  Translating: 'bg-emerald-500',
  Reviewing: 'bg-amber-500',
  All: 'bg-violet-500',
};

interface IntentBoardProps {
  assignmentId: string;
  rows: ScoreQueryRow[];
  intents: IntentSummary[];
  links: IntentLinkSummary[];
  versionNo: number;
  pendingRatings: number;
  basePrompt: string;
  openaiConfigured: boolean;
  /** Jelson taxonomy subtypes → fuzzy suggestions in the New Intent modal. */
  jelsonSuggestions: JelsonSuggestion[];
  /** This assignment is the NIRVANA import → render delivered responses as raw
   * text (single-newline line breaks CommonMark would otherwise collapse). */
  isNirvana: boolean;
}

type IntentSelection =
  | { kind: 'all' }
  | { kind: 'intent'; id: number }
  | { kind: 'unassigned' }
  | { kind: 'pending' }
  | { kind: 'boundary'; key: string }
  // Starter-set browse: questions rated clearly-in for one prepared template
  // (`set:CODE`) or for every prepared template of a Type (`type:KEY`).
  // ids = template intent ids; label = display name for the middle header.
  | { kind: 'starter'; key: string; ids: number[]; label: string };

const RATING_CHIP: Record<RatingLevel, string> = {
  clearly_in: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  probably_in: 'bg-lime-50 text-lime-700 border-lime-200',
  unsure: 'bg-amber-50 text-amber-700 border-amber-200',
  probably_out: 'bg-slate-50 text-slate-600 border-slate-200',
  clearly_out: 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] border-[hsl(var(--border))]',
};

function Badge({ n }: { n: number }) {
  return (
    <span className="text-[11px] tabular-nums px-1.5 py-0.5 rounded-full bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]">
      {n}
    </span>
  );
}

function SmallChip({ className, children, title }: { className: string; children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] font-medium whitespace-nowrap ${className}`}
    >
      {children}
    </span>
  );
}

/** Chatbot reply body. NIRVANA replies are raw GPT text whose single-newline
 * line breaks CommonMark would collapse, so render them verbatim (whitespace
 * preserved); everything else renders as markdown. */
function ResponseBody({ text, raw }: { text: string; raw: boolean }) {
  if (raw) {
    return <p className="whitespace-pre-wrap break-words text-sm text-[hsl(var(--foreground))]">{text}</p>;
  }
  return (
    <div className="prose prose-sm max-w-none dark:prose-invert prose-pre:bg-[hsl(var(--muted))] prose-pre:text-[hsl(var(--foreground))] prose-pre:border prose-pre:border-[hsl(var(--border))]">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}

/** Full-conversation modal: every turn of the selected message's chat thread,
 * in send order, with Material tags + rendered bot replies. Opens scrolled so
 * the current query is centered and ringed. */
function ConversationModal({
  rows,
  current,
  isNirvana,
  onClose,
}: {
  rows: ScoreQueryRow[];
  current: ScoreQueryRow;
  isNirvana: boolean;
  onClose: () => void;
}) {
  const currentRef = useRef<HTMLDivElement>(null);
  const thread = useMemo(
    () =>
      rows
        .filter((r) => r.conversationId === current.conversationId)
        .sort((a, b) => a.turnIndex - b.turnIndex || a.messageId - b.messageId),
    [rows, current.conversationId]
  );

  // Center the current turn once the list is laid out.
  useLayoutEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'center' });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[hsl(var(--border))] px-5 py-3">
          <div className="flex items-center gap-2 text-sm">
            <MessageSquare className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
            <span className="font-medium">Full conversation</span>
            <span className="font-mono text-xs text-[hsl(var(--muted-foreground))]">
              {current.participantToken || '—'} · {thread.length} turn{thread.length === 1 ? '' : 's'}
            </span>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
            title="Close (Esc)"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {thread.map((r) => {
            const isCurrent = r.messageId === current.messageId;
            return (
              <div
                key={r.messageId}
                ref={isCurrent ? currentRef : undefined}
                className={`space-y-2 rounded-lg p-3 ${
                  isCurrent
                    ? 'ring-2 ring-[hsl(var(--primary))] ring-offset-2 ring-offset-[hsl(var(--background))] bg-[hsl(var(--muted))]/20'
                    : ''
                }`}
              >
                <div className="flex items-center gap-2 text-[11px] text-[hsl(var(--muted-foreground))]">
                  <span>Turn {r.turnNumber}</span>
                  {isCurrent && (
                    <span className="rounded bg-[hsl(var(--primary))]/10 px-1.5 py-0.5 font-medium text-[hsl(var(--primary))]">
                      current
                    </span>
                  )}
                  <span className="ml-auto">{new Date(r.queryTimestamp).toLocaleString()}</span>
                </div>

                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                    Student
                  </p>
                  <StudentMessage text={r.queryText} dissection={r.dissection} />
                </div>

                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                    Chatbot
                  </p>
                  {r.responseText && r.responseText.trim() ? (
                    <ResponseBody text={r.responseText} raw={isNirvana} />
                  ) : (
                    <p className="text-sm italic text-[hsl(var(--muted-foreground))]">
                      No chatbot response was recorded for this turn.
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function IntentBoard({
  assignmentId,
  rows,
  intents,
  links,
  versionNo,
  pendingRatings,
  basePrompt,
  openaiConfigured,
  jelsonSuggestions,
  isNirvana,
}: IntentBoardProps) {
  const router = useRouter();
  // Active = owns the log. Templates (pre-built starter sets, rated in advance)
  // and archived are excluded from the active set.
  const activeIntents = useMemo(
    () => intents.filter((i) => !i.archived && !i.isTemplate),
    [intents]
  );
  const intentById = useMemo(() => new Map(intents.map((i) => [i.id, i])), [intents]);
  const titleOf = (id: number) => intentById.get(id)?.title ?? `Intent ${id}`;

  const [selection, setSelection] = useState<IntentSelection>({ kind: 'all' });
  const [selectedMessageId, setSelectedMessageId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [sortMode, setSortMode] = useState<
    'recent' | 'oldest' | 'participant-asc' | 'participant-desc'
  >('recent');
  // Rating model is fixed (picker removed) — 5.4-mini.
  const selectedModel = SCORE_RATING_MODEL;
  const [basePromptOpen, setBasePromptOpen] = useState(false);
  const [newIntentOpen, setNewIntentOpen] = useState(false);
  const [newIntentSeed, setNewIntentSeed] = useState<{
    title?: string;
    definition?: string;
  } | null>(null);
  const [editIntent, setEditIntent] = useState<IntentSummary | null>(null);
  const [ownershipPair, setOwnershipPair] = useState<{
    a: IntentSummary;
    b: IntentSummary;
    messageIds: number[];
  } | null>(null);
  const [reviseTarget, setReviseTarget] = useState<{ row: ScoreQueryRow; intent: IntentSummary } | null>(null);

  // ---- Chatbot deploy versions --------------------------------------------
  // Students always chat against the LATEST deploy; the board is staging. The
  // badge shows the deployed version + an undeployed-changes dot; the modal
  // deploys/redeploys. Status refetches whenever the board data refreshes
  // (intents in the deps → any save/apply/refresh recomputes dirty).
  const [deployOpen, setDeployOpen] = useState(false);
  const [deployStatus, setDeployStatus] = useState<DeployStatus | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/instructor/assignments/${assignmentId}/score/deploy`)
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => {
        if (alive && d) setDeployStatus(d as DeployStatus);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [assignmentId, intents, links]);
  // Full-conversation modal — open for the currently selected message.
  const [convoOpen, setConvoOpen] = useState(false);

  // ---- Archived intents (soft-deleted; restore / hard-purge) --------------
  const archivedIntents = useMemo(() => intents.filter((i) => i.archived), [intents]);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [restoringId, setRestoringId] = useState<number | null>(null);
  // The intent queued for irreversible hard-delete, plus the type-to-confirm text.
  const [purgeTarget, setPurgeTarget] = useState<IntentSummary | null>(null);
  const [purgeText, setPurgeText] = useState('');
  const [purgeBusy, setPurgeBusy] = useState(false);

  async function restoreIntent(intent: IntentSummary) {
    setRestoringId(intent.id);
    try {
      const res = await fetch(`/api/instructor/assignments/${assignmentId}/score/intents/${intent.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: false, autoTitle: false }),
      });
      if (!res.ok) {
        window.alert('Failed to restore the intent.');
        return;
      }
      router.refresh();
    } catch {
      window.alert('Failed to restore the intent — network error.');
    } finally {
      setRestoringId(null);
    }
  }

  async function purgeIntent() {
    if (!purgeTarget) return;
    setPurgeBusy(true);
    try {
      const res = await fetch(
        `/api/instructor/assignments/${assignmentId}/score/intents/${purgeTarget.id}?mode=purge`,
        { method: 'DELETE' }
      );
      if (!res.ok) {
        window.alert('Failed to delete the intent.');
        setPurgeBusy(false);
        return;
      }
      setPurgeTarget(null);
      setPurgeText('');
      setPurgeBusy(false);
      router.refresh();
    } catch {
      window.alert('Failed to delete the intent — network error.');
      setPurgeBusy(false);
    }
  }

  // ---- Starter sets: the Jelson taxonomy as a library of PRE-BUILT intents,
  // treated like archived intents — sitting inactive until you activate one,
  // which creates a real intent seeded from its template (then Rate to populate).
  const [starterOpen, setStarterOpen] = useState(false);
  const [activatingCode, setActivatingCode] = useState<string | null>(null);
  // Group the pre-built templates by Type, dropping ones already turned into an
  // intent (matched by seeded definition). shortDesc is the description minus the
  // folded-in examples — a one-liner for the list.
  const starterGroups = useMemo(() => {
    // Already an ACTIVE intent → drop from the library.
    const activeDefs = new Set(
      intents.filter((i) => !i.archived && !i.isTemplate).map((i) => i.definition.trim())
    );
    // Prepared templates (rated in advance) by definition → id for instant activate.
    const templateByDef = new Map(
      intents.filter((i) => i.isTemplate).map((i) => [i.definition.trim(), i.id])
    );
    const groups: {
      typeKey: string;
      typeLabel: string;
      typeDescription: string;
      /** ONE-intent seed for the whole Type (dedicated definition). */
      typeSeed: { title: string; definition: string };
      /** Prepared type-level template (from "Run all") → instant activation. */
      typeTemplateId: number | null;
      /** The Type intent is already live — hide its Add. */
      typeActive: boolean;
      sets: {
        code: string;
        title: string;
        definition: string;
        desc: string;
        templateId: number | null;
      }[];
    }[] = [];
    for (const s of jelsonSuggestions) {
      const { title, definition } = jelsonToIntent(s);
      const key = definition.trim();
      if (activeDefs.has(key)) continue;
      let g = groups[groups.length - 1];
      if (!g || g.typeKey !== s.typeKey) {
        const typeSeed = jelsonTypeToIntent(s.typeKey, s.typeLabel, s.typeDescription);
        const typeDefKey = typeSeed.definition.trim();
        g = {
          typeKey: s.typeKey,
          typeLabel: s.typeLabel,
          typeDescription: s.typeDescription,
          typeSeed,
          typeTemplateId: templateByDef.get(typeDefKey) ?? null,
          typeActive: activeDefs.has(typeDefKey),
          sets: [],
        };
        groups.push(g);
      }
      // desc = full description (examples folded in), shown truncated.
      g.sets.push({
        code: s.code,
        title,
        definition,
        desc: s.description,
        templateId: templateByDef.get(key) ?? null,
      });
    }
    return groups;
  }, [jelsonSuggestions, intents]);
  const starterCount = starterGroups.reduce((n, g) => n + g.sets.length, 0);
  // Unprepared work for "Run all": sets without a template + Type-level
  // templates not yet created (unless the Type intent is already live).
  const unpreparedCount = starterGroups.reduce(
    (n, g) =>
      n +
      g.sets.filter((s) => s.templateId === null).length +
      (!g.typeActive && g.typeTemplateId === null ? 1 : 0),
    0
  );

  // Question counts behind the starter library: per prepared set = its
  // clearly-in count (pins override). Per Type = the TYPE template's own count
  // when prepared (that's exactly what Add would produce); otherwise the union
  // across its prepared sets — either way the badge matches the browse list.
  const starterCounts = useMemo(() => {
    const perSet = new Map<number, number>();
    const perType = new Map<string, number>();
    const isIn = (r: ScoreQueryRow, tid: number) => {
      const pin = r.pinnedIntents[tid];
      return pin ? pin === 'in' : r.intentRatings[tid]?.rating === 'clearly_in';
    };
    for (const r of rows) {
      for (const g of starterGroups) {
        let anyIn = false;
        for (const s of g.sets) {
          if (s.templateId === null) continue;
          if (isIn(r, s.templateId)) {
            perSet.set(s.templateId, (perSet.get(s.templateId) ?? 0) + 1);
            anyIn = true;
          }
        }
        const typeIn = g.typeTemplateId !== null ? isIn(r, g.typeTemplateId) : anyIn;
        if (typeIn) perType.set(g.typeKey, (perType.get(g.typeKey) ?? 0) + 1);
      }
    }
    return { perSet, perType };
  }, [rows, starterGroups]);

  // Activate a starter set into a live intent.
  //   • PREPARED (template already rated by "Run all") → just flip is_template
  //     off. Instant: its ratings are already valid, so it's edit-ready at once.
  //   • not prepared → create + rate on the spot (waits for the rating).
  async function activateStarterSet(set: {
    code: string;
    title: string;
    definition: string;
    templateId: number | null;
  }) {
    if (running || activatingCode) return;
    setActivatingCode(set.code);
    setRunError(null);
    try {
      if (set.templateId !== null) {
        const res = await fetch(
          `/api/instructor/assignments/${assignmentId}/score/intents/${set.templateId}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isTemplate: false, autoTitle: false }),
          }
        );
        if (!res.ok) {
          window.alert('Failed to activate the starter set.');
          return;
        }
        router.refresh();
        return;
      }
      // Not prepared → create the intent, then rate the log against just it.
      const controller = new AbortController();
      abortRef.current = controller;
      const res = await fetch(`/api/instructor/assignments/${assignmentId}/score/intents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: set.title, definition: set.definition, autoTitle: false }),
      });
      if (!res.ok) {
        window.alert('Failed to activate the starter set.');
        return;
      }
      const created = (await res.json().catch(() => null)) as { intent?: { id?: number } } | null;
      const newId = created?.intent?.id;
      if (!newId) return;
      setRunning(true);
      setRunProgress({ rated: 0, total: rows.length, failed: 0 });
      await runShardedRate({
        assignmentId,
        model: selectedModel,
        intentIds: [newId],
        estimatedTotal: rows.length,
        signal: controller.signal,
        isLive: () => mountedRef.current && !controller.signal.aborted,
        onProgress: (p) =>
          setRunProgress({ rated: Math.min(p.rated, rows.length), total: rows.length, failed: p.failed }),
      });
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError' && mountedRef.current) {
        setRunError((err as Error)?.message || 'Rating was interrupted. Please try again.');
      }
    } finally {
      if (mountedRef.current) {
        setActivatingCode(null);
        setRunning(false);
        router.refresh();
      }
    }
  }

  // Add a Type as ONE intent (not its subtypes): a dedicated self-contained
  // definition covers the whole Type. Reuses the set-activation path — instant
  // when the type template was prepared by "Run all", else create + rate.
  function activateType(g: {
    typeKey: string;
    typeSeed: { title: string; definition: string };
    typeTemplateId: number | null;
    typeActive: boolean;
  }) {
    if (running || preparing || activatingCode || g.typeActive) return;
    void activateStarterSet({
      code: `type:${g.typeKey}`,
      title: g.typeSeed.title,
      definition: g.typeSeed.definition,
      templateId: g.typeTemplateId,
    });
  }

  // "Run all" — prepare EVERY starter set up front: a template intent per
  // subtype set AND per whole Type (its one-intent seed), deduped server-side,
  // then one rate run over all of them — so any later activation is instant.
  const [preparing, setPreparing] = useState(false);
  async function runPrepareAll() {
    if (preparing || running || activatingCode) return;
    const templates = starterGroups.flatMap((g) => [
      { title: g.typeSeed.title, definition: g.typeSeed.definition },
      ...g.sets.map((s) => ({ title: s.title, definition: s.definition })),
    ]);
    if (templates.length === 0) return;
    setPreparing(true);
    setRunError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch(`/api/instructor/assignments/${assignmentId}/score/templates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templates }),
        signal: controller.signal,
      });
      if (!res.ok) {
        window.alert('Failed to prepare the starter sets.');
        return;
      }
      const data = (await res.json().catch(() => null)) as { templates?: { id: number }[] } | null;
      const ids = (data?.templates ?? []).map((t) => t.id);
      if (ids.length === 0) {
        router.refresh();
        return;
      }
      setRunProgress({ rated: 0, total: rows.length, failed: 0 });
      await runShardedRate({
        assignmentId,
        model: selectedModel,
        intentIds: ids,
        estimatedTotal: rows.length,
        signal: controller.signal,
        isLive: () => mountedRef.current && !controller.signal.aborted,
        onProgress: (p) =>
          setRunProgress({ rated: Math.min(p.rated, rows.length), total: rows.length, failed: p.failed }),
      });
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError' && mountedRef.current) {
        setRunError((err as Error)?.message || 'Preparing was interrupted. Please try again.');
      }
    } finally {
      if (mountedRef.current) {
        setPreparing(false);
        setRunProgress(null);
        router.refresh();
      }
    }
  }

  // ---- Exclusive assignment, derived per message -------------------------
  const activeIds = useMemo(() => activeIntents.map((i) => i.id), [activeIntents]);
  const resolutions = useMemo(() => {
    const map = new Map<number, AssignmentResolution>();
    for (const r of rows) {
      const ratings = new Map<number, RatingLevel>();
      for (const [idStr, v] of Object.entries(r.intentRatings)) {
        // Stale ratings still count for display continuity (same philosophy
        // as classify force: show the previous state until overwritten).
        ratings.set(Number(idStr), v.rating);
      }
      // Instructor pins settle the pinned question immediately (§1.6).
      const pins = new Map<number, 'in' | 'out'>(
        Object.entries(r.pinnedIntents).map(([k, v]) => [Number(k), v])
      );
      map.set(r.messageId, resolveAssignment(applyPinOverrides(ratings, pins), activeIds, links));
    }
    return map;
  }, [rows, activeIds, links]);

  const counts = useMemo(() => {
    const perIntent = new Map<number, number>();
    let unassigned = 0;
    let pending = 0;
    const boundaries = new Map<string, { intentIds: number[]; count: number }>();
    for (const r of rows) {
      const res = resolutions.get(r.messageId);
      if (!res) continue;
      if (res.kind === 'assigned') perIntent.set(res.intentId, (perIntent.get(res.intentId) ?? 0) + 1);
      else if (res.kind === 'fallback') unassigned += 1;
      else if (res.kind === 'pending') pending += 1;
      else {
        const key = boundaryKey(res.intentIds);
        const e = boundaries.get(key);
        if (e) e.count += 1;
        else boundaries.set(key, { intentIds: [...res.intentIds], count: 1 });
      }
    }
    const boundaryList = [...boundaries.entries()]
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => b.count - a.count);
    return { perIntent, unassigned, pending, boundaryList };
  }, [rows, resolutions]);

  // ---- Middle column ------------------------------------------------------
  // Selection can outlive its target (intent archived, boundary resolved,
  // pending bucket drained after a rate run) — fall back to "All" instead of
  // pointing at an empty, unreachable group.
  useEffect(() => {
    const gone =
      (selection.kind === 'intent' && !activeIntents.some((i) => i.id === selection.id)) ||
      (selection.kind === 'boundary' && !counts.boundaryList.some((b) => b.key === selection.key)) ||
      (selection.kind === 'pending' && counts.pending === 0) ||
      // A browsed template can leave the library (activated → live intent).
      (selection.kind === 'starter' &&
        !selection.ids.some((tid) => intentById.get(tid)?.isTemplate));
    if (gone) setSelection({ kind: 'all' });
  }, [selection, activeIntents, counts, intentById]);

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      const res = resolutions.get(r.messageId);
      if (!res) return false;
      switch (selection.kind) {
        case 'all':
          return true;
        case 'intent':
          return res.kind === 'assigned' && res.intentId === selection.id;
        case 'unassigned':
          return res.kind === 'fallback';
        case 'pending':
          return res.kind === 'pending';
        case 'boundary':
          return res.kind === 'boundary' && boundaryKey(res.intentIds) === selection.key;
        case 'starter':
          // Rated clearly-in for ANY of the browsed templates (pins override).
          return selection.ids.some((tid) => {
            const pin = r.pinnedIntents[tid];
            if (pin) return pin === 'in';
            return r.intentRatings[tid]?.rating === 'clearly_in';
          });
      }
    });
  }, [rows, resolutions, selection]);

  const searchedRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return filteredRows;
    return filteredRows.filter((r) => r.queryText.toLowerCase().includes(q));
  }, [filteredRows, search]);

  /** Effective rating for sorting/chips in the current selection context —
   * instructor pins override the classifier (same rule the resolver uses). */
  const contextRating = (r: ScoreQueryRow): RatingLevel | null => {
    if (selection.kind !== 'intent') return null;
    const pin = r.pinnedIntents[selection.id];
    if (pin) return pin === 'in' ? 'clearly_in' : 'clearly_out';
    return r.intentRatings[selection.id]?.rating ?? null;
  };

  const sortedRows = useMemo(() => {
    const ts = (r: ScoreQueryRow) => new Date(r.queryTimestamp).getTime();
    const pc = (a: ScoreQueryRow, b: ScoreQueryRow) =>
      a.participantToken.localeCompare(b.participantToken, undefined, {
        numeric: true,
        sensitivity: 'base',
      });
    const arr = searchedRows.slice();
    switch (sortMode) {
      case 'oldest':
        arr.sort((a, b) => ts(a) - ts(b));
        break;
      case 'participant-asc':
        arr.sort((a, b) => pc(a, b) || ts(b) - ts(a));
        break;
      case 'participant-desc':
        arr.sort((a, b) => pc(b, a) || ts(b) - ts(a));
        break;
      default:
        arr.sort((a, b) => ts(b) - ts(a));
    }
    return arr;
  }, [searchedRows, sortMode]);

  const selectedRow = useMemo(
    () => rows.find((r) => r.messageId === selectedMessageId) ?? null,
    [rows, selectedMessageId]
  );

  // ---- Rate runner (same client-driven batch loop as classification) ------
  const [running, setRunning] = useState(false);
  const [runProgress, setRunProgress] = useState<{ rated: number; total: number; failed: number } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  async function runRating(force: boolean) {
    if (running) return;
    if (force && !window.confirm('Re-rate ALL queries against every intent? This re-runs the LLM for the whole log.')) {
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setRunError(null);
    setRunProgress({ rated: force ? 0 : rows.length - pendingRatings, total: rows.length, failed: 0 });
    try {
      // Parallel shard fan-out (see rate-runner): re-rating the whole log lands
      // in ~one wave of the concurrency pool instead of a sequential crawl.
      // Scoped to ACTIVE intents so starter-set templates (rated via "Run all")
      // aren't dragged into every normal rate.
      await runShardedRate({
        assignmentId,
        model: selectedModel,
        intentIds: activeIds,
        force,
        estimatedTotal: rows.length,
        signal: controller.signal,
        isLive: () => mountedRef.current && !controller.signal.aborted,
        onProgress: (p) =>
          setRunProgress({ rated: Math.min(p.rated, rows.length), total: rows.length, failed: p.failed }),
      });
    } catch (err) {
      if ((err as Error)?.name === 'AbortError' || !mountedRef.current) return;
      setRunError((err as Error)?.message || 'Rating was interrupted. Please try again.');
    } finally {
      if (mountedRef.current) {
        setRunning(false);
        router.refresh();
      }
    }
  }

  const selectionLabel = (() => {
    switch (selection.kind) {
      case 'all':
        return 'All questions';
      case 'intent':
        return titleOf(selection.id);
      case 'unassigned':
        return 'Uncovered questions';
      case 'pending':
        return 'Not yet rated';
      case 'boundary':
        return selection.key.split('+').map((s) => titleOf(Number(s))).join(' ↔ ');
      case 'starter':
        return `Starter set · ${selection.label}`;
    }
  })();

  return (
    <div className="flex flex-col gap-4 flex-1 min-h-0">
      {/* Control bar — version badge, rate runner, new intent */}
      <div className="shrink-0 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 flex flex-wrap items-center gap-3">
        <span
          className="text-xs font-mono px-2 py-1 rounded bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]"
          title="Intent config version — every applied change snapshots a new version"
        >
          v{versionNo}
        </span>
        <span className="text-sm text-[hsl(var(--muted-foreground))]">
          {activeIntents.length} intent{activeIntents.length === 1 ? '' : 's'} · {rows.length} questions
        </span>

        {/* Chatbot deploy: what students are served. Amber dot = the board has
            undeployed changes. */}
        <button
          onClick={() => setDeployOpen(true)}
          className="relative inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-[hsl(var(--border))] text-xs font-medium text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]"
          title={
            deployStatus?.latest
              ? `Students are on chat v${deployStatus.latest.versionNo}${deployStatus.dirty ? ' — undeployed changes' : ''}`
              : 'Not deployed — students get the base prompt only'
          }
        >
          <Rocket className="w-3.5 h-3.5" />
          {deployStatus?.latest ? `chat v${deployStatus.latest.versionNo}` : 'Deploy'}
          {deployStatus?.dirty && (
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-500" />
          )}
        </button>

        <div className="flex-1" />

        {runError && (
          <span className="flex items-center gap-1 text-xs text-red-600">
            <AlertTriangle className="w-3.5 h-3.5" /> {runError}
          </span>
        )}
        {/* Rate progress lives here; "Run all" (prepare) shows its own bar in
            the Starter sets header instead of the top control bar. */}
        {running && runProgress && (
          <div className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
            <div className="w-32 h-1.5 rounded bg-[hsl(var(--muted))] overflow-hidden">
              <div
                className="h-full bg-[hsl(var(--primary))] transition-all"
                style={{ width: `${runProgress.total ? Math.round((runProgress.rated / runProgress.total) * 100) : 0}%` }}
              />
            </div>
            <span className="tabular-nums">
              {runProgress.rated}/{runProgress.total}
              {runProgress.failed > 0 && <span className="text-red-600"> · {runProgress.failed} failed</span>}
            </span>
          </div>
        )}

        {activeIntents.length > 0 && (
          <>
            <button
              onClick={() => runRating(false)}
              disabled={running || !openaiConfigured || pendingRatings === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] disabled:opacity-50"
              title={openaiConfigured ? 'Rate stale/new questions against the current intents' : 'OPENAI_API_KEY is not configured'}
            >
              <Play className="w-3.5 h-3.5" /> Rate {pendingRatings > 0 ? pendingRatings : ''} remaining
            </button>
            <button
              onClick={() => runRating(true)}
              disabled={running || !openaiConfigured}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs border border-[hsl(var(--border))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] disabled:opacity-50"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Re-rate all
            </button>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)_minmax(0,1.1fr)] gap-4 flex-1 min-h-0">
        {/* LEFT — Base prompt · Intents · Needs decision · Unassigned */}
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-y-auto">
          {/* BASE PROMPT (read-only, managed in assignment settings) */}
          <div className="border-b border-[hsl(var(--border))] px-3 py-2">
            <button
              onClick={() => setBasePromptOpen((v) => !v)}
              className="w-full text-left flex items-center justify-between gap-2"
            >
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                Base Prompt
              </span>
              <ChevronRight
                className={`w-3.5 h-3.5 text-[hsl(var(--muted-foreground))] transition-transform ${basePromptOpen ? 'rotate-90' : ''}`}
              />
            </button>
            <p
              className={`mt-1 text-xs whitespace-pre-wrap ${basePrompt.trim() ? 'text-[hsl(var(--muted-foreground))]' : 'italic text-[hsl(var(--muted-foreground))]'} ${basePromptOpen ? '' : 'line-clamp-2'}`}
            >
              {basePrompt.trim()
                ? basePrompt
                : 'No base prompt — the chatbot starts with no system guidance. Intents build on top of this empty baseline.'}
            </p>
            {basePromptOpen && (
              <p className="mt-1 text-[11px] italic text-[hsl(var(--muted-foreground))]">
                Always applied. Managed in assignment settings — not edited in the SCORE loop.
              </p>
            )}
          </div>

          {/* NEEDS DECISION — only when overlaps exist */}
          {counts.boundaryList.length > 0 && (
            <div className="border-b border-[hsl(var(--border))] bg-amber-50/60 px-3 py-2 space-y-1">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                <AlertTriangle className="w-3.5 h-3.5" /> Needs decision
              </div>
              {counts.boundaryList.map((b) => {
                const pairable = b.intentIds.length === 2;
                return (
                  // Sibling buttons (not nested) — a control inside a control
                  // is unfocusable and an ARIA nested-interactive violation.
                  <div
                    key={b.key}
                    className={`rounded flex items-center ${
                      selection.kind === 'boundary' && selection.key === b.key ? 'bg-amber-100' : 'hover:bg-amber-100/60'
                    }`}
                  >
                    <button
                      onClick={() => setSelection({ kind: 'boundary', key: b.key })}
                      className={`flex-1 min-w-0 text-left px-2 py-1.5 text-xs flex items-center justify-between gap-2 ${
                        selection.kind === 'boundary' && selection.key === b.key ? 'font-medium' : ''
                      }`}
                    >
                      <span className="truncate text-amber-900">
                        {b.intentIds.map((id) => titleOf(id)).join(' ↔ ')}
                      </span>
                      <Badge n={b.count} />
                    </button>
                    {pairable && (
                      <button
                        onClick={() => {
                          const a = intentById.get(b.intentIds[0]);
                          const bb = intentById.get(b.intentIds[1]);
                          if (!a || !bb) return;
                          const messageIds = rows
                            .filter((r) => {
                              const res = resolutions.get(r.messageId);
                              return res?.kind === 'boundary' && boundaryKey(res.intentIds) === b.key;
                            })
                            .map((r) => r.messageId);
                          setOwnershipPair({ a, b: bb, messageIds });
                        }}
                        className="shrink-0 mr-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-600 text-white hover:bg-amber-700"
                      >
                        Decide →
                      </button>
                    )}
                  </div>
                );
              })}
              <p className="text-[11px] text-amber-700/80">
                Until decided, these answer with the base prompt only. Deciding compares the two rules&apos; actual
                responses.
              </p>
            </div>
          )}

          {/* INTENTS */}
          <div className="px-3 pt-2 pb-1 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                Intents
              </span>
              <button
                onClick={() => setSelection({ kind: 'all' })}
                className={`text-[11px] px-1.5 py-0.5 rounded ${
                  selection.kind === 'all' ? 'bg-[hsl(var(--muted))] font-medium' : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]/50'
                }`}
              >
                All · {rows.length}
              </button>
            </div>
            <button
              onClick={() => setNewIntentOpen(true)}
              className="inline-flex items-center gap-1 shrink-0 text-[11px] px-1.5 py-0.5 rounded border border-[hsl(var(--primary))] text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/10"
              title="Create a new intent"
            >
              <Plus className="w-3 h-3" /> New
            </button>
          </div>
          {activeIntents.length === 0 ? (
            <div className="px-3 py-3 text-xs text-[hsl(var(--muted-foreground))] space-y-2">
              <p>
                No intents yet. Create your first one — describe when a student is making a particular kind
                of request, and Apply to rate the log against it.
              </p>
              <button
                onClick={() => setNewIntentOpen(true)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]"
              >
                <Plus className="w-3 h-3" /> New Intent
              </button>
            </div>
          ) : (
            <div className="pb-1">
              {activeIntents.map((intent) => {
                const active = selection.kind === 'intent' && selection.id === intent.id;
                const exceptLinks = links.filter((l) => l.fromIntentId === intent.id);
                return (
                  <div
                    key={intent.id}
                    className={`group border-b border-[hsl(var(--border))]/60 px-3 py-2 cursor-pointer ${
                      active ? 'bg-[hsl(var(--muted))]' : 'hover:bg-[hsl(var(--muted))]/40'
                    }`}
                    onClick={() => setSelection({ kind: 'intent', id: intent.id })}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium truncate">{intent.title}</span>
                      <span className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditIntent(intent);
                          }}
                          className="opacity-0 group-hover:opacity-100 p-0.5 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                          title="Edit intent"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <Badge n={counts.perIntent.get(intent.id) ?? 0} />
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-[hsl(var(--muted-foreground))] line-clamp-2">
                      <span className="font-semibold">When</span> {intent.definition}
                    </p>
                    <p className="mt-0.5 text-[11px] text-[hsl(var(--muted-foreground))] line-clamp-1">
                      <span className="font-semibold">Then</span>{' '}
                      {intent.rule ? intent.rule : <span className="italic">No rule yet — base prompt applies</span>}
                    </p>
                    {(exceptLinks.length > 0 || intent.pinCount > 0) && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {exceptLinks.map((l) => (
                          <button
                            key={l.toIntentId}
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (
                                !window.confirm(
                                  `Remove the exception link "${intent.title} except ${titleOf(l.toIntentId)}"? Overlapping questions go back to Needs Decision.`
                                )
                              )
                                return;
                              try {
                                const res = await fetch(
                                  `/api/instructor/assignments/${assignmentId}/score/links?from=${l.fromIntentId}&to=${l.toIntentId}`,
                                  { method: 'DELETE' }
                                );
                                if (!res.ok) {
                                  window.alert('Failed to remove the exception link.');
                                  return;
                                }
                                router.refresh();
                              } catch {
                                window.alert('Failed to remove the exception link — network error.');
                              }
                            }}
                            title="Exception link — click to remove (undo restores the overlap to Needs Decision)"
                          >
                            <SmallChip className="bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-100">
                              <Link2 className="w-3 h-3" /> except → {titleOf(l.toIntentId)}
                            </SmallChip>
                          </button>
                        ))}
                        {intent.pinCount > 0 && (
                          <SmallChip className="bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] border-[hsl(var(--border))]">
                            <Pin className="w-3 h-3" /> {intent.pinCount}
                          </SmallChip>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ARCHIVED — collapsible; restore or permanently delete */}
          {archivedIntents.length > 0 && (
            <div className="border-t border-[hsl(var(--border))]">
              <button
                onClick={() => setArchivedOpen((o) => !o)}
                className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]/50"
              >
                <ChevronRight className={`w-3 h-3 transition-transform ${archivedOpen ? 'rotate-90' : ''}`} />
                <Archive className="w-3 h-3" /> Archived ({archivedIntents.length})
              </button>
              {archivedOpen && (
                <div className="pb-1">
                  {archivedIntents.map((intent) => (
                    <div
                      key={intent.id}
                      className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-[hsl(var(--border))]/40"
                    >
                      <span
                        className="text-xs truncate text-[hsl(var(--muted-foreground))]"
                        title={intent.definition}
                      >
                        {intent.title}
                      </span>
                      <span className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => restoreIntent(intent)}
                          disabled={restoringId === intent.id}
                          className="p-0.5 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] disabled:opacity-50"
                          title="Restore — re-activate this intent"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => {
                            setPurgeTarget(intent);
                            setPurgeText('');
                          }}
                          className="p-0.5 text-[hsl(var(--muted-foreground))] hover:text-red-600"
                          title="Delete permanently"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* PENDING + UNASSIGNED */}
          <div className="mt-auto border-t border-[hsl(var(--border))]">
            {counts.pending > 0 && (
              <button
                onClick={() => setSelection({ kind: 'pending' })}
                className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between ${
                  selection.kind === 'pending' ? 'bg-[hsl(var(--muted))] font-medium' : 'hover:bg-[hsl(var(--muted))]/50'
                }`}
                title="Questions not yet rated against every active intent"
              >
                <span className="text-[hsl(var(--muted-foreground))]">Not yet rated</span>
                <Badge n={counts.pending} />
              </button>
            )}
            <button
              onClick={() => setSelection({ kind: 'unassigned' })}
              className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between ${
                selection.kind === 'unassigned' ? 'bg-[hsl(var(--muted))] font-medium' : 'hover:bg-[hsl(var(--muted))]/50'
              }`}
              title="No intent covers these yet — the base prompt alone applies."
            >
              <span className="text-[hsl(var(--muted-foreground))]">Uncovered questions</span>
              <Badge n={counts.unassigned} />
            </button>

            {/* STARTER SETS — pre-built intent templates (the Jelson taxonomy),
                grouped by Type. "Run all" pre-rates every set so activation is
                instant; the hover Add turns one into a live intent. */}
            {starterCount > 0 && (
              <div className="border-t border-[hsl(var(--border))]">
                <div
                  className={`flex items-center ${
                    starterOpen ? 'bg-[hsl(var(--muted))]/40' : 'hover:bg-[hsl(var(--muted))]/50'
                  }`}
                >
                  <button
                    onClick={() => setStarterOpen((o) => !o)}
                    className="flex-1 min-w-0 flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-[hsl(var(--muted-foreground))]"
                  >
                    <ChevronRight className={`w-3 h-3 shrink-0 transition-transform ${starterOpen ? 'rotate-90' : ''}`} />
                    <Sparkles className="w-3 h-3 shrink-0" /> Starter sets ({starterCount})
                  </button>
                  {preparing && runProgress ? (
                    // Run all in progress → the button slot becomes its bar.
                    <div className="shrink-0 flex items-center gap-1.5 pr-3 py-1.5 text-[10px] text-[hsl(var(--muted-foreground))]">
                      <RefreshCw className="w-3 h-3 animate-spin" />
                      <div className="w-16 h-1.5 rounded bg-[hsl(var(--muted))] overflow-hidden">
                        <div
                          className="h-full bg-[hsl(var(--primary))] transition-all"
                          style={{
                            width: `${runProgress.total ? Math.round((runProgress.rated / runProgress.total) * 100) : 0}%`,
                          }}
                        />
                      </div>
                      <span className="tabular-nums">
                        {runProgress.rated}/{runProgress.total}
                      </span>
                    </div>
                  ) : (
                    <button
                      onClick={runPrepareAll}
                      disabled={preparing || running || activatingCode !== null || !openaiConfigured || unpreparedCount === 0}
                      className="shrink-0 inline-flex items-center gap-1 px-2 pr-3 py-1.5 text-[11px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] disabled:opacity-50"
                      title={
                        openaiConfigured
                          ? 'Run all — pre-rate every starter set so activating is instant'
                          : 'OPENAI_API_KEY is not configured'
                      }
                    >
                      <RefreshCw className="w-3.5 h-3.5" /> Run all
                    </button>
                  )}
                </div>
                {starterOpen && (
                  <div className="pb-1">
                    {starterGroups.map((g) => {
                      // Browse the TYPE template's own questions when prepared
                      // (what Add would capture); fall back to the union of its
                      // prepared sets. Matches the badge (starterCounts.perType).
                      const preparedSetIds = g.sets
                        .map((s) => s.templateId)
                        .filter((id): id is number => id !== null);
                      const groupIds =
                        g.typeTemplateId !== null ? [g.typeTemplateId] : preparedSetIds;
                      const groupKey = `type:${g.typeKey}`;
                      const groupActive = selection.kind === 'starter' && selection.key === groupKey;
                      return (
                        <div key={g.typeKey}>
                          {/* Type header — click to browse; hover Add turns the
                              whole Type into ONE intent. */}
                          <div
                            className={`group flex items-center gap-1 pr-3 ${
                              groupActive ? 'bg-[hsl(var(--muted))]' : 'bg-[hsl(var(--muted))]/30 hover:bg-[hsl(var(--muted))]/60'
                            }`}
                          >
                            <button
                              onClick={() =>
                                groupIds.length > 0 &&
                                setSelection(
                                  groupActive
                                    ? { kind: 'all' }
                                    : { kind: 'starter', key: groupKey, ids: groupIds, label: g.typeLabel }
                                )
                              }
                              disabled={groupIds.length === 0}
                              title={
                                groupIds.length > 0
                                  ? `${g.typeDescription} — click to see this Type's questions`
                                  : `${g.typeDescription} — Run all first to rate these sets`
                              }
                              className={`min-w-0 flex-1 text-left px-3 py-1 flex items-start gap-2 ${
                                groupIds.length === 0 ? 'cursor-default' : ''
                              }`}
                            >
                              <span className={`mt-1 w-2 h-2 shrink-0 rounded-full ${TYPE_DOT[g.typeKey] ?? 'bg-gray-400'}`} />
                              <span className="min-w-0">
                                <span className={`flex items-center gap-1.5 text-[10px] uppercase tracking-wide ${groupActive ? 'font-semibold text-[hsl(var(--foreground))]' : 'text-[hsl(var(--muted-foreground))]'}`}>
                                  {g.typeLabel} ({g.sets.length})
                                  {g.typeTemplateId !== null && (
                                    <span
                                      className="shrink-0 w-1.5 h-1.5 rounded-full bg-emerald-500"
                                      title="Prepared — the one-intent Add is instant"
                                    />
                                  )}
                                </span>
                                <span className="block text-[10px] normal-case text-[hsl(var(--muted-foreground))] truncate">
                                  {g.typeDescription}
                                </span>
                              </span>
                            </button>
                            {!g.typeActive && (
                              <button
                                onClick={() => activateType(g)}
                                disabled={activatingCode !== null || running || preparing}
                                className="opacity-0 group-hover:opacity-100 shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-[hsl(var(--primary))] text-[10px] font-medium text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/10 disabled:opacity-50"
                                title={`Add "${g.typeLabel}" as ONE intent covering the whole type (subtypes stay in the library)`}
                              >
                                <Plus className="w-3 h-3" />
                                {activatingCode === `type:${g.typeKey}` ? 'Adding…' : 'Add'}
                              </button>
                            )}
                            {groupIds.length > 0 && (
                              <span className="shrink-0">
                                <Badge n={starterCounts.perType.get(g.typeKey) ?? 0} />
                              </span>
                            )}
                          </div>
                          {g.sets.map((s) => {
                            const setKey = `set:${s.code}`;
                            const setActive = selection.kind === 'starter' && selection.key === setKey;
                            const browsable = s.templateId !== null;
                            return (
                              <div
                                key={s.code}
                                className={`group flex items-center justify-between gap-2 px-3 py-1.5 border-b border-[hsl(var(--border))]/40 ${
                                  setActive ? 'bg-[hsl(var(--muted))]' : 'hover:bg-[hsl(var(--muted))]/40'
                                }`}
                              >
                                {/* Click the set → browse its clearly-in questions
                                    (prepared sets only — unprepared have no ratings). */}
                                <button
                                  onClick={() =>
                                    browsable &&
                                    setSelection(
                                      setActive
                                        ? { kind: 'all' }
                                        : {
                                            kind: 'starter',
                                            key: setKey,
                                            ids: [s.templateId as number],
                                            label: s.title,
                                          }
                                    )
                                  }
                                  title={
                                    browsable
                                      ? `${s.definition} — click to see its questions`
                                      : `${s.definition} — Run all first to rate this set`
                                  }
                                  className={`min-w-0 flex-1 text-left ${browsable ? '' : 'cursor-default'}`}
                                >
                                  <span className="flex items-center gap-1.5">
                                    <span className={`text-xs truncate ${setActive ? 'font-medium' : 'text-[hsl(var(--foreground))]/90'}`}>
                                      {s.title}
                                    </span>
                                    {browsable && (
                                      <span
                                        className="shrink-0 w-1.5 h-1.5 rounded-full bg-emerald-500"
                                        title="Prepared — rated; click to browse, Add is instant"
                                      />
                                    )}
                                  </span>
                                  <span className="block text-[10px] text-[hsl(var(--muted-foreground))] truncate">
                                    {s.desc}
                                  </span>
                                </button>
                                <button
                                  onClick={() => activateStarterSet(s)}
                                  disabled={activatingCode !== null || running || preparing}
                                  className="opacity-0 group-hover:opacity-100 shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-[hsl(var(--primary))] text-[11px] font-medium text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/10 disabled:opacity-50"
                                  title={
                                    s.templateId !== null
                                      ? 'Activate — already rated, instant'
                                      : 'Add as an intent and rate the log against it'
                                  }
                                >
                                  <Plus className="w-3 h-3" />
                                  {activatingCode === s.code ? 'Adding…' : 'Add'}
                                </button>
                                {browsable && (
                                  <span className="shrink-0">
                                    <Badge n={starterCounts.perSet.get(s.templateId as number) ?? 0} />
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* MIDDLE — question group */}
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-y-auto">
          <div className="sticky top-0 z-10 bg-[hsl(var(--card))] border-b border-[hsl(var(--border))] px-3 py-2 flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))] truncate">
                {selectionLabel}
              </span>
              <Badge n={sortedRows.length} />
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[hsl(var(--muted-foreground))]" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search query text…"
                  className="w-44 pl-7 pr-7 py-1 text-xs border border-[hsl(var(--border))] rounded bg-[hsl(var(--background))] text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
                />
                {search && (
                  <button
                    onClick={() => setSearch('')}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                    aria-label="Clear search"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as typeof sortMode)}
                className="text-xs border border-[hsl(var(--border))] rounded px-1.5 py-0.5 bg-[hsl(var(--background))] text-[hsl(var(--foreground))]"
              >
                <option value="recent">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="participant-asc">PID ↑</option>
                <option value="participant-desc">PID ↓</option>
              </select>
            </div>
          </div>
          {sortedRows.length === 0 ? (
            <p className="p-6 text-sm text-[hsl(var(--muted-foreground))]">
              {selection.kind === 'pending' || rows.length === 0
                ? 'No questions here.'
                : activeIntents.length === 0
                  ? 'Create an intent to start organizing the log.'
                  : 'No questions for this selection.'}
            </p>
          ) : (
            <ul className="divide-y divide-[hsl(var(--border))]">
              {sortedRows.map((r) => {
                const active = r.messageId === selectedMessageId;
                const res = resolutions.get(r.messageId);
                const rating = contextRating(r);
                const ratingInfo = selection.kind === 'intent' ? r.intentRatings[selection.id] : undefined;
                return (
                  <li key={r.messageId}>
                    <button
                      onClick={() => setSelectedMessageId(r.messageId)}
                      className={`w-full text-left px-3 py-2.5 ${active ? 'bg-[hsl(var(--muted))]' : 'hover:bg-[hsl(var(--muted))]/40'}`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-[11px] font-mono text-[hsl(var(--muted-foreground))]">
                          {r.participantToken || '—'}
                          {r.turnNumber > 0 && <span className="ml-1 font-sans">· Turn {r.turnNumber}</span>}
                        </span>
                        <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
                          {new Date(r.queryTimestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        </span>
                      </div>
                      <p className="text-sm text-[hsl(var(--foreground))] leading-snug mb-1.5">
                        <QuerySnippet text={r.queryText} dissection={r.dissection} />
                      </p>
                      <div className="flex flex-wrap gap-1 items-center">
                        {/* Intent view: everything shown is clearly-in, so the
                            rating label is dropped — only the pin/stale status
                            (the non-obvious signals) gets a chip. */}
                        {selection.kind === 'intent' &&
                          (r.pinnedIntents[selection.id] || ratingInfo?.stale) && (
                            <SmallChip
                              className="bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] border-[hsl(var(--border))]"
                              title={r.pinnedIntents[selection.id] ? 'Set by instructor pin' : 'Needs re-rating'}
                            >
                              {r.pinnedIntents[selection.id] ? 'pinned' : 'stale'}
                            </SmallChip>
                          )}
                        {selection.kind === 'boundary' &&
                          res?.kind === 'boundary' &&
                          res.intentIds.map((iid) => {
                            // Effective rating — a pin can be what PUT the row
                            // in this boundary; showing the raw rating would
                            // contradict the bucket.
                            const pin = r.pinnedIntents[iid];
                            const eff: RatingLevel = pin
                              ? pin === 'in'
                                ? 'clearly_in'
                                : 'clearly_out'
                              : r.intentRatings[iid]?.rating ?? 'unsure';
                            return (
                              <SmallChip
                                key={iid}
                                className={RATING_CHIP[eff]}
                                title={pin ? 'Set by instructor pin' : undefined}
                              >
                                {titleOf(iid)}: {RATING_LABELS[eff]}
                                {pin ? ' · pinned' : ''}
                              </SmallChip>
                            );
                          })}
                        {(selection.kind === 'unassigned' ||
                          selection.kind === 'all' ||
                          selection.kind === 'pending' ||
                          selection.kind === 'starter') &&
                          res?.kind === 'assigned' && (
                            <SmallChip className="bg-emerald-50 text-emerald-700 border-emerald-200">
                              {titleOf(res.intentId)}
                            </SmallChip>
                          )}
                      </div>
                      {/* Only "unsure" rows surface the rationale inline (§2.1 skim rule). */}
                      {rating === 'unsure' && ratingInfo?.rationale && (
                        <p className="mt-1 text-[11px] italic text-amber-700">{ratingInfo.rationale}</p>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* RIGHT — conversation viewer (read-only) */}
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-y-auto">
          {!selectedRow ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 text-[hsl(var(--muted-foreground))]">
              <MessageSquare className="w-8 h-8 mb-3 opacity-50" />
              <p className="text-sm">Select a question to view the conversation.</p>
            </div>
          ) : (
            <div className="p-4 space-y-4">
              <div className="flex items-start justify-between gap-2 text-xs text-[hsl(var(--muted-foreground))]">
                <div className="flex items-center flex-wrap gap-1.5">
                  <span className="font-mono">
                    {selectedRow.participantToken || '—'}
                    {selectedRow.turnNumber > 0 && <span className="ml-1 font-sans">· Turn {selectedRow.turnNumber}</span>}
                  </span>
                  <span>{new Date(selectedRow.queryTimestamp).toLocaleString()}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => setConvoOpen(true)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[hsl(var(--border))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]"
                    title="View the full conversation"
                  >
                    <Maximize2 className="w-3.5 h-3.5" /> Full conversation
                  </button>
                  {(() => {
                    const res = resolutions.get(selectedRow.messageId);
                    const owner =
                      res?.kind === 'assigned' ? intentById.get(res.intentId) ?? null : null;
                    return (
                      <button
                        disabled={!owner}
                        onClick={() => owner && setReviseTarget({ row: selectedRow, intent: owner })}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded border border-[hsl(var(--border))] ${
                          owner
                            ? 'text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]'
                            : 'text-[hsl(var(--muted-foreground))] opacity-60 cursor-not-allowed'
                        }`}
                        title={
                          owner
                            ? `Revise the rule of "${owner.title}" from this question`
                            : 'Revise edits the owning intent’s rule — this question is not assigned to an intent'
                        }
                      >
                        Revise <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    );
                  })()}
                </div>
              </div>

              {/* Intents this question is IN (clearly-in / pinned-in). The rating
                  label is dropped — the intent name is the signal, and only
                  "in" matters (clearly-out is not shown). Pins override (§1.6). */}
              {activeIntents.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {activeIntents.map((i) => {
                    const rr = selectedRow.intentRatings[i.id];
                    const pin = selectedRow.pinnedIntents[i.id];
                    const isIn = pin ? pin === 'in' : rr?.rating === 'clearly_in';
                    if (!isIn) return null;
                    return (
                      <SmallChip
                        key={i.id}
                        className="bg-emerald-50 text-emerald-700 border-emerald-200"
                        title={pin ? 'Set by instructor pin' : rr?.rationale ?? undefined}
                      >
                        {i.title}
                        {pin ? ' · pinned' : ''}
                      </SmallChip>
                    );
                  })}
                </div>
              )}

              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))] mb-1.5">
                  Student message{' '}
                  {selectedRow.dissection && selectedRow.dissection.materialKinds.length > 0 && (
                    <span className="font-normal normal-case">(click a tag to reveal pasted material)</span>
                  )}
                </h3>
                <StudentMessage
                  key={selectedRow.messageId}
                  text={selectedRow.queryText}
                  dissection={selectedRow.dissection}
                />
              </section>

              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))] mb-1.5">
                  Chatbot response
                </h3>
                {selectedRow.responseText && selectedRow.responseText.trim() ? (
                  <ResponseBody text={selectedRow.responseText} raw={isNirvana} />
                ) : (
                  <p className="text-sm text-[hsl(var(--muted-foreground))] italic">
                    No chatbot response was recorded for this question.
                  </p>
                )}
              </section>
            </div>
          )}
        </div>
      </div>

      {/* One shared modal for both create and edit (the pencil sets editIntent,
          "+ New intent" sets newIntentOpen). Edit mode preloads the intent and
          its ratings; only the header/footer differ. */}
      <IntentModal
        open={newIntentOpen || editIntent !== null}
        onClose={() => {
          setNewIntentOpen(false);
          setNewIntentSeed(null);
          setEditIntent(null);
          router.refresh();
        }}
        assignmentId={assignmentId}
        model={selectedModel}
        openaiConfigured={openaiConfigured}
        totalQuestions={rows.length}
        intent={editIntent}
        seed={newIntentSeed}
        jelsonSuggestions={jelsonSuggestions}
        templates={intents
          .filter((i) => i.isTemplate && !i.archived)
          .map(({ id, title, definition }) => ({ id, title, definition }))}
      />

      <DeployModal
        open={deployOpen}
        onClose={() => setDeployOpen(false)}
        assignmentId={assignmentId}
        onStatus={setDeployStatus}
      />

      {ownershipPair && (
        <DecideOwnershipModal
          assignmentId={assignmentId}
          intentA={ownershipPair.a}
          intentB={ownershipPair.b}
          messageIds={ownershipPair.messageIds}
          onClose={(changed) => {
            setOwnershipPair(null);
            if (changed) router.refresh();
          }}
          onCreateNew={() => {
            // C-intent flow (§1.7): the overlap region deserves its own
            // response — seed a new intent scoped to exactly that region.
            const { a, b } = ownershipPair;
            setOwnershipPair(null);
            setNewIntentSeed({
              title: '',
              definition: `asks for something that matches both "${a.title}" and "${b.title}" at the same time — <describe the specific combined situation this intent owns>`,
            });
            setNewIntentOpen(true);
          }}
        />
      )}

      {reviseTarget && (
        <ReviseModal
          assignmentId={assignmentId}
          row={reviseTarget.row}
          intent={reviseTarget.intent}
          basePrompt={basePrompt}
          isNirvana={isNirvana}
          onClose={(changed) => {
            setReviseTarget(null);
            if (changed) router.refresh();
          }}
          onCreateInstead={() => {
            // §2.3: switching from Revise makes the question being viewed the
            // seed of the new intent.
            const q = reviseTarget.row.queryText.replace(/\s+/g, ' ').trim();
            setReviseTarget(null);
            setNewIntentSeed({
              title: '',
              definition: `asks the chatbot to <describe the request> — e.g. "${q.length > 120 ? `${q.slice(0, 120)}…` : q}"`,
            });
            setNewIntentOpen(true);
          }}
        />
      )}

      {/* HARD DELETE — irreversible; type-to-confirm gates the button. */}
      {purgeTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !purgeBusy && setPurgeTarget(null)}
        >
          <div
            className="w-full max-w-md rounded-lg bg-[hsl(var(--background))] border border-[hsl(var(--border))] shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-[hsl(var(--border))] flex items-center gap-2 text-red-600">
              <AlertTriangle className="w-5 h-5" />
              <h2 className="text-sm font-semibold">Delete this intent permanently?</h2>
            </div>
            <div className="px-5 py-4 space-y-3 text-xs text-[hsl(var(--foreground))]">
              <p>
                You are about to permanently delete{' '}
                <span className="font-semibold">“{purgeTarget.title}”</span>. This{' '}
                <span className="font-semibold">cannot be undone</span> — it is different from Archive.
              </p>
              <div className="rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40 px-3 py-2">
                <p className="mb-1 font-medium text-[hsl(var(--muted-foreground))]">This erases, forever:</p>
                <ul className="list-disc pl-4 space-y-0.5 text-[hsl(var(--muted-foreground))]">
                  <li>every classification rating for this intent</li>
                  <li>all your in/out labels{purgeTarget.pinCount > 0 ? ` (${purgeTarget.pinCount})` : ''}</li>
                  <li>exception links to and from it</li>
                  <li>its cached rule previews</li>
                  <li>this intent’s own version history</li>
                </ul>
              </div>
              <p className="text-[hsl(var(--muted-foreground))]">
                Your other intents — their ratings, labels, and shared history — are not affected. If you only
                want to hide it, use{' '}
                <button
                  className="underline hover:text-[hsl(var(--foreground))]"
                  onClick={() => setPurgeTarget(null)}
                >
                  Archive
                </button>{' '}
                instead.
              </p>
              <div>
                <label className="block mb-1 text-[hsl(var(--muted-foreground))]">
                  Type <span className="font-semibold text-[hsl(var(--foreground))]">{purgeTarget.title}</span> to
                  confirm:
                </label>
                <input
                  autoFocus
                  value={purgeText}
                  onChange={(e) => setPurgeText(e.target.value)}
                  className="w-full rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5 text-xs outline-none focus:border-red-500"
                  placeholder={purgeTarget.title}
                />
              </div>
            </div>
            <div className="px-5 py-3 border-t border-[hsl(var(--border))] flex items-center justify-end gap-2">
              <button
                onClick={() => setPurgeTarget(null)}
                disabled={purgeBusy}
                className="px-3 py-1.5 text-xs rounded border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={purgeIntent}
                disabled={purgeBusy || purgeText.trim() !== purgeTarget.title.trim()}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {purgeBusy ? 'Deleting…' : 'Delete permanently'}
              </button>
            </div>
          </div>
        </div>
      )}

      {convoOpen && selectedRow && (
        <ConversationModal rows={rows} current={selectedRow} isNirvana={isNirvana} onClose={() => setConvoOpen(false)} />
      )}
    </div>
  );
}
