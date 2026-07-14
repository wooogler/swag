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
import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  applyPinOverrides,
  boundaryKey,
  resolveAssignment,
  type AssignmentResolution,
  type MaterialKind,
  type RatingLevel,
} from '@/lib/score/intents';
import { SCORE_RATING_MODEL } from '@/lib/score/models';
import {
  AlertTriangle,
  Archive,
  Check,
  ChevronRight,
  Link2,
  Maximize2,
  MessageSquare,
  Minimize2,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { jelsonToIntent, jelsonTypeToIntent, type JelsonSuggestion } from '@/lib/score/jelson-suggest';
import { MaterialSegments, QuerySnippet, StudentMessage } from './materials';
import { ConversationThread, ResponseBody } from './conversation';
import ChatMessages from '@/components/chat/ChatMessages';
import IntentWorkbench, { type WorkbenchMode } from './IntentWorkbench';
import DecideOwnershipModal from './DecideOwnershipModal';
import RuleWorkbench from './RuleWorkbench';
import SearchWorkbench, { type SearchMode } from './SearchWorkbench';
import PromptReviseWorkbench from './PromptReviseWorkbench';
import { getJSON, postJSON } from './http';
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
  /** Which chat DEPLOY version served this query's reply (reply metadata) —
   * null for pre-deploy / imported logs. */
  chatDeployVersion: number | null;
  /** The intent whose rule the runtime injected for this reply (audit trail). */
  appliedIntentId: number | null;
  dissection: { materialKinds: MaterialKind[]; requests: string[] } | null;
}

/** One rule version as the viewer's dropdown consumes it (rule-versions GET
 * with ?messageId= — `response` is that version's stored response for the
 * selected message, when one exists). */
export interface ViewerRuleVersion {
  /** Raw per-intent sequence — the value passed back to the API. */
  versionNo: number;
  /** DISPLAY major number (v1, v2, …) — the seed and simulated minors also
   * occupy the raw sequence, so versionNo runs ahead; show this instead. */
  major?: number;
  name: string | null;
  rule: string | null;
  response: string | null;
  /** Simulated minor step (rule workbench) — hidden from the viewer dropdown. */
  minor?: boolean;
  /** 'seed' = the workbench's auto-created v1 baseline — also hidden (it IS
   * the delivered original). */
  source?: string;
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
  /** The instructor's boundary labels, split — shown in the When/Then hover. */
  includedCount: number;
  excludedCount: number;
  /** Latest saved RULE version (score_rule_versions) — the intents panel shows
   * "Then vN name" with the full rule on hover. */
  latestRuleVersion?: { versionNo: number; name: string | null } | null;
  /** This intent's own definition-version count (config versions touching it) —
   * the intents panel shows "When vN title" with the definition on hover. */
  intentVersionNo?: number;
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
  basePrompt: string;
  /** Study condition. 'baseline' turns the SAME board into the ablation: the
   * Base Prompt slot becomes an editable monolithic prompt, Intents become
   * saved Searches, the workbench becomes Search, and Revise edits the whole
   * prompt. Everything else (query list, colours, Run all, conversation) is
   * shared. Undefined = 'score' (the normal SCORE board). */
  condition?: 'score' | 'baseline';
  /** Baseline only: monolithic prompt state (seed + deployed version). */
  baseline?: { currentPrompt: string; deployedVersionNo: number | null; charLimit: number };
  openaiConfigured: boolean;
  /** Jelson taxonomy subtypes → fuzzy suggestions in the New Intent modal. */
  jelsonSuggestions: JelsonSuggestion[];
  /** This assignment is the NIRVANA import → render delivered responses as raw
   * text (single-newline line breaks CommonMark would otherwise collapse). */
  isNirvana: boolean;
  /** Viewing a PAST chat deploy (?chatv=N): the board renders that version's
   * intents and the student traffic it served, read-only. */
  deployView: {
    versionNo: number;
    note: string | null;
    createdAt: string;
    intents: { id: number; title: string; definition: string; rule: string | null }[];
  } | null;
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
  | { kind: 'starter'; key: string; ids: number[]; label: string }
  // Baseline saved-search browse: the search's clearly-in questions by messageId
  // (from its cached probe). Clicking a saved Search filters the list here — the
  // baseline analogue of clicking a starter set; only +New opens the workbench.
  | { kind: 'search'; key: string; ids: number[]; label: string };

function Badge({ n }: { n: number }) {
  return (
    <span className="text-[11px] tabular-nums px-1.5 py-0.5 rounded-full bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]">
      {n}
    </span>
  );
}

/** One Type in the pre-built starter-set library (a Jelson taxonomy type + its
 * sub-type sets), as built by the `starterGroups` memo. */
type StarterGroup = {
  typeKey: string;
  typeLabel: string;
  typeDescription: string;
  typeSeed: { title: string; definition: string };
  typeTemplateId: number | null;
  typeActive: boolean;
  sets: {
    code: string;
    title: string;
    definition: string;
    desc: string;
    templateId: number | null;
    active: boolean;
  }[];
};
type StarterCounts = { perSet: Map<number, number>; perType: Map<string, number> };

/**
 * The pre-built starter-set browse tree: Type headers, each with its sub-type
 * sets, showing the clearly-in count and filtering the question list on click
 * (setSelection → kind:'starter'). SCORE also renders the activation affordances
 * (Add a set/Type as a live intent, Added/Adding chips). The BASELINE reuses the
 * SAME tree with `showActivation={false}`, so a "Search" (starter set) just shows
 * its matching questions — Type + Sub type + count, no workbench. Single source
 * of truth for both conditions.
 */
function StarterSetTree({
  groups,
  counts,
  selection,
  setSelection,
  showActivation,
  activatingCode,
  libraryBusy,
  activateType,
  activateStarterSet,
}: {
  groups: StarterGroup[];
  counts: StarterCounts;
  selection: IntentSelection;
  setSelection: (s: IntentSelection) => void;
  showActivation: boolean;
  activatingCode?: string | null;
  libraryBusy?: boolean;
  activateType?: (g: StarterGroup) => void;
  activateStarterSet?: (s: StarterGroup['sets'][number]) => void;
}) {
  return (
    <div className="pb-1">
      {groups.map((g) => {
        // Browse the TYPE template's own questions when prepared (what Add would
        // capture); fall back to the union of its prepared sets. Matches the
        // badge (counts.perType).
        const preparedSetIds = g.sets.map((s) => s.templateId).filter((id): id is number => id !== null);
        const groupIds = g.typeTemplateId !== null ? [g.typeTemplateId] : preparedSetIds;
        const groupKey = `type:${g.typeKey}`;
        const groupActive = selection.kind === 'starter' && selection.key === groupKey;
        return (
          <div key={g.typeKey}>
            {/* Type header — click to browse; hover Add turns the whole Type
                into ONE intent (SCORE only). */}
            <div
              className={`group flex items-center gap-1 pr-3 ${
                groupActive ? 'bg-[hsl(var(--muted))]' : 'bg-[hsl(var(--muted))]/30 hover:bg-[hsl(var(--muted))]/60'
              }`}
            >
              <button
                onClick={() =>
                  groupIds.length > 0 &&
                  setSelection(
                    groupActive ? { kind: 'all' } : { kind: 'starter', key: groupKey, ids: groupIds, label: g.typeLabel }
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
                    {showActivation && g.typeTemplateId !== null && (
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
              {showActivation &&
                (g.typeActive ? (
                  <span
                    className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-emerald-200 bg-emerald-50 text-[10px] font-medium text-emerald-700"
                    title={`"${g.typeLabel}" is already a live intent — the library keeps the set for later re-use`}
                  >
                    <Check className="w-3 h-3" /> Added
                  </span>
                ) : activatingCode === `type:${g.typeKey}` ? (
                  <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-[hsl(var(--border))] text-[10px] font-medium text-[hsl(var(--muted-foreground))]">
                    <RefreshCw className="w-3 h-3 animate-spin" /> Adding…
                  </span>
                ) : libraryBusy ? null : (
                  <button
                    onClick={() => activateType?.(g)}
                    className="opacity-0 group-hover:opacity-100 shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-[hsl(var(--primary))] text-[10px] font-medium text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/10"
                    title={`Add "${g.typeLabel}" as ONE intent covering the whole type (subtypes stay in the library)`}
                  >
                    <Plus className="w-3 h-3" /> Add
                  </button>
                ))}
              {groupIds.length > 0 && (
                <span className="shrink-0">
                  <Badge n={counts.perType.get(g.typeKey) ?? 0} />
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
                  {/* Click the set → browse its clearly-in questions (prepared
                      sets only — unprepared have no ratings). */}
                  <button
                    onClick={() =>
                      browsable &&
                      setSelection(
                        setActive
                          ? { kind: 'all' }
                          : { kind: 'starter', key: setKey, ids: [s.templateId as number], label: s.title }
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
                      {showActivation && browsable && (
                        <span
                          className="shrink-0 w-1.5 h-1.5 rounded-full bg-emerald-500"
                          title="Prepared — rated; click to browse, Add is instant"
                        />
                      )}
                    </span>
                    <span className="block text-[10px] text-[hsl(var(--muted-foreground))] truncate">{s.desc}</span>
                  </button>
                  {showActivation &&
                    (s.active ? (
                      <span
                        className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-emerald-200 bg-emerald-50 text-[10px] font-medium text-emerald-700"
                        title="Already a live intent — the library keeps this set for later re-use"
                      >
                        <Check className="w-3 h-3" /> Added
                      </span>
                    ) : activatingCode === s.code ? (
                      <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-[hsl(var(--border))] text-[10px] font-medium text-[hsl(var(--muted-foreground))]">
                        <RefreshCw className="w-3 h-3 animate-spin" /> Adding…
                      </span>
                    ) : libraryBusy ? null : (
                      <button
                        onClick={() => activateStarterSet?.(s)}
                        className="opacity-0 group-hover:opacity-100 shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-[hsl(var(--primary))] text-[11px] font-medium text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/10"
                        title={
                          s.templateId !== null
                            ? 'Activate — a copy of the prepared set becomes a live intent, instantly'
                            : 'Add as an intent and rate the log against it'
                        }
                      >
                        <Plus className="w-3 h-3" /> Add
                      </button>
                    ))}
                  {browsable && (
                    <span className="shrink-0">
                      <Badge n={counts.perSet.get(s.templateId as number) ?? 0} />
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
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

/** An intent-title chip that is a SHORTCUT into that intent's editor — hover
 * reveals a pencil, click opens Edit intent. role=button span (+ stopPropagation)
 * so it can live inside the question row, which is itself a button. */
function IntentChip({
  label,
  colors,
  title,
  onEdit,
}: {
  label: string;
  colors: string;
  title: string;
  onEdit: () => void;
}) {
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        onEdit();
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        e.stopPropagation();
        onEdit();
      }}
      title={title}
      className={`group/chip inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${colors}`}
    >
      {label}
      <Pencil className="w-2.5 h-2.5 opacity-0 group-hover/chip:opacity-100" />
    </span>
  );
}

/** Hover reveal: shows `content` in a floating panel while the trigger is
 * hovered. Positioned with `position: fixed` (via getBoundingClientRect) so it
 * escapes the intents panel's overflow clip — a CSS/absolute tooltip would be
 * cut off by the scroll container. */
function HoverReveal({ content, children }: { content: React.ReactNode; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; above: boolean } | null>(null);
  return (
    <div
      ref={ref}
      onMouseEnter={() => {
        const r = ref.current?.getBoundingClientRect();
        if (!r) return;
        // Flip above when there isn't room below (near the viewport bottom),
        // and clamp horizontally so the fixed-width panel never runs off the
        // right edge (anchors near the viewport border, e.g. the viewer's
        // Revise button).
        const above = window.innerHeight - r.bottom < 240;
        const width = Math.min(320, window.innerWidth * 0.8); // w-80 / max-w-[80vw]
        const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
        setPos({ left, top: above ? r.top - 6 : r.bottom + 6, above });
      }}
      onMouseLeave={() => setPos(null)}
    >
      {children}
      {pos && (
        <div
          role="tooltip"
          className="fixed z-[60] w-80 max-w-[80vw] rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 shadow-lg pointer-events-none"
          style={{ left: pos.left, top: pos.top, transform: pos.above ? 'translateY(-100%)' : undefined }}
        >
          {content}
        </div>
      )}
    </div>
  );
}

/** Chatbot reply body. NIRVANA replies are raw GPT text whose single-newline
 * line breaks CommonMark would collapse, so render them verbatim (whitespace
 * preserved); everything else renders as markdown. */
/** Read-only board for a PAST chat deploy (?chatv=N): the snapshot's intents on
 * the left, the queries that deploy actually SERVED in the middle (grouped by
 * the intent whose rule was injected, from the reply's audit metadata), and the
 * served response on the right. */
function DeployVersionBoard({
  rows,
  deployView,
}: {
  rows: ScoreQueryRow[];
  deployView: NonNullable<IntentBoardProps['deployView']>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const served = useMemo(
    () => rows.filter((r) => r.chatDeployVersion === deployView.versionNo),
    [rows, deployView.versionNo]
  );
  const [sel, setSel] = useState<'all' | 'base' | number>('all');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const filtered = useMemo(() => {
    if (sel === 'all') return served;
    if (sel === 'base') return served.filter((r) => r.appliedIntentId === null);
    return served.filter((r) => r.appliedIntentId === sel);
  }, [served, sel]);
  const selectedRow = filtered.find((r) => r.messageId === selectedId) ?? null;
  const baseCount = served.filter((r) => r.appliedIntentId === null).length;
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="flex flex-col gap-4 flex-1 min-h-0">
      {/* Version banner — what is being viewed, and the way back. */}
      <div className="shrink-0 rounded-lg border border-violet-200 bg-violet-50/60 px-4 py-2 flex items-center gap-3 text-xs">
        <span className="font-semibold text-violet-800">
          Viewing chat v{deployView.versionNo}
          {deployView.note ? ` · ${deployView.note}` : ''}
        </span>
        <span className="text-violet-700/80">
          deployed {fmt(deployView.createdAt)} · {served.length} served repl{served.length === 1 ? 'y' : 'ies'} ·
          read-only
        </span>
        <span className="flex-1" />
        <button
          onClick={() => router.replace(pathname)}
          className="inline-flex items-center gap-1 px-2 py-1 rounded border border-violet-300 text-violet-800 font-medium hover:bg-violet-100"
        >
          Back to current
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)_minmax(0,1.1fr)] gap-4 flex-1 min-h-0">
        {/* LEFT — the deployed intent→rule set */}
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-y-auto">
          <div className="px-3 pt-2 pb-1 flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
              Deployed intents
            </span>
            <button
              onClick={() => setSel('all')}
              className={`text-[11px] px-1.5 py-0.5 rounded ${
                sel === 'all' ? 'bg-[hsl(var(--muted))] font-medium' : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]/50'
              }`}
            >
              All · {served.length}
            </button>
          </div>
          {deployView.intents.map((i) => {
            const active = sel === i.id;
            const n = served.filter((r) => r.appliedIntentId === i.id).length;
            return (
              <div
                key={i.id}
                className={`border-b border-[hsl(var(--border))]/60 px-3 py-2 cursor-pointer ${
                  active ? 'bg-[hsl(var(--muted))]' : 'hover:bg-[hsl(var(--muted))]/40'
                }`}
                onClick={() => setSel(i.id)}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium truncate">{i.title}</span>
                  <Badge n={n} />
                </div>
                <HoverReveal
                  content={
                    <div className="space-y-1.5 text-[11px] leading-relaxed text-[hsl(var(--foreground))]">
                      <p>
                        <span className="font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">When</span>{' '}
                        {i.definition}
                      </p>
                      <p className="whitespace-pre-wrap">
                        <span className="font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">Then</span>{' '}
                        {i.rule ?? <span className="italic">No rule — base prompt applies</span>}
                      </p>
                    </div>
                  }
                >
                  <p className="mt-0.5 text-[11px] text-[hsl(var(--muted-foreground))] line-clamp-1">
                    <span className="font-semibold">When</span> {i.definition}
                  </p>
                  <p className="mt-0.5 text-[11px] text-[hsl(var(--muted-foreground))] line-clamp-1">
                    <span className="font-semibold">Then</span>{' '}
                    {i.rule ?? <span className="italic">No rule — base prompt applies</span>}
                  </p>
                </HoverReveal>
              </div>
            );
          })}
          {/* Replies the deploy answered with the base prompt alone. */}
          <button
            onClick={() => setSel('base')}
            className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between border-t border-[hsl(var(--border))] ${
              sel === 'base' ? 'bg-[hsl(var(--muted))] font-medium' : 'hover:bg-[hsl(var(--muted))]/50'
            }`}
            title="Replies where no intent rule was injected (no match / fail-open)"
          >
            <span className="text-[hsl(var(--muted-foreground))]">Base prompt only</span>
            <Badge n={baseCount} />
          </button>
        </div>

        {/* MIDDLE — the queries this deploy served */}
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="p-6 text-sm text-[hsl(var(--muted-foreground))]">
              No student queries were served by this version{sel !== 'all' ? ' for this selection' : ''} yet.
            </p>
          ) : (
            <ul className="divide-y divide-[hsl(var(--border))]">
              {filtered.map((r) => (
                <li key={r.messageId}>
                  <button
                    onClick={() => setSelectedId(r.messageId)}
                    className={`w-full text-left px-3 py-2.5 ${
                      r.messageId === selectedId ? 'bg-[hsl(var(--muted))]' : 'hover:bg-[hsl(var(--muted))]/40'
                    }`}
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
                    <p className="text-sm text-[hsl(var(--foreground))] leading-snug">
                      <QuerySnippet text={r.queryText} dissection={r.dissection} />
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* RIGHT — the served conversation turn */}
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-y-auto">
          {!selectedRow ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 text-[hsl(var(--muted-foreground))]">
              <MessageSquare className="w-8 h-8 mb-3 opacity-50" />
              <p className="text-sm">Select a question to view the served reply.</p>
            </div>
          ) : (
            <div className="p-4 space-y-4">
              <div className="flex items-center flex-wrap gap-1.5 text-xs text-[hsl(var(--muted-foreground))]">
                <span className="font-mono">
                  {selectedRow.participantToken || '—'}
                  {selectedRow.turnNumber > 0 && <span className="ml-1 font-sans">· Turn {selectedRow.turnNumber}</span>}
                </span>
                <span>{new Date(selectedRow.queryTimestamp).toLocaleString()}</span>
                <SmallChip className="bg-violet-50 text-violet-700 border-violet-200">
                  chat v{deployView.versionNo}
                </SmallChip>
              </div>
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))] mb-1.5">
                  Student message
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
                  // Deploy-served replies come from the live chat model → markdown.
                  <ResponseBody text={selectedRow.responseText} raw={false} />
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
    </div>
  );
}

export default function IntentBoard({
  assignmentId,
  rows,
  intents,
  links,
  basePrompt,
  condition = 'score',
  baseline,
  openaiConfigured,
  jelsonSuggestions,
  isNirvana,
  deployView,
}: IntentBoardProps) {
  const router = useRouter();
  const isBaseline = condition === 'baseline';
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

  // BASELINE: the editable monolithic system prompt occupies the Base Prompt
  // slot. Save = new version; Deploy = serve it to students. (condition='score'
  // leaves the Base Prompt read-only, exactly as before.)
  const [promptDraft, setPromptDraft] = useState(baseline?.currentPrompt ?? basePrompt);
  const [savedPrompt, setSavedPrompt] = useState<string | null>(baseline?.currentPrompt ?? null);
  const [deployedVersionNo, setDeployedVersionNo] = useState<number | null>(baseline?.deployedVersionNo ?? null);
  const [promptBusy, setPromptBusy] = useState<null | 'save' | 'deploy'>(null);
  const [promptNote, setPromptNote] = useState<string | null>(null);
  const promptChars = promptDraft.length;
  const promptLimit = baseline?.charLimit ?? 8000;
  const promptOver = promptChars > promptLimit;
  const promptDirty = promptDraft !== (savedPrompt ?? baseline?.currentPrompt ?? basePrompt);

  async function persistPrompt(kind: 'save' | 'deploy') {
    if (promptOver) return;
    setPromptBusy(kind);
    setPromptNote(null);
    try {
      const url = `/api/instructor/assignments/${assignmentId}/score/baseline/${kind === 'save' ? 'versions' : 'deploy'}`;
      const { versionNo } = await postJSON<{ versionNo: number }>(url, { prompt: promptDraft });
      setSavedPrompt(promptDraft);
      if (kind === 'deploy') setDeployedVersionNo(versionNo);
      setPromptNote(`${kind === 'save' ? 'Saved' : 'Deployed'} · v${versionNo}`);
    } catch (e) {
      setPromptNote(`${kind === 'save' ? 'Save' : 'Deploy'} failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setPromptBusy(null);
    }
  }

  const [newIntentOpen, setNewIntentOpen] = useState(false);
  const [newIntentSeed, setNewIntentSeed] = useState<{
    title?: string;
    definition?: string;
  } | null>(null);

  // BASELINE: the Intents list is replaced by Searches — the pre-built starter
  // sets (reusing the SCORE StarterSetTree over `starterGroups`) plus the user's
  // saved custom searches. searchMode holds the open Search workbench (+New).
  const [searchMode, setSearchMode] = useState<SearchMode | null>(null);
  const [savedSearches, setSavedSearches] = useState<{ id: string; description: string }[]>([]);
  async function reloadSearches() {
    if (!isBaseline) return;
    const b = `/api/instructor/assignments/${assignmentId}/score/baseline`;
    const s = await getJSON<{ searches?: { id: string; description: string }[] }>(`${b}/searches`).catch(() => ({
      searches: [],
    }));
    setSavedSearches(s.searches ?? []);
  }
  // Clicking a saved Search filters the list to its matches (like clicking a
  // starter set) rather than opening the workbench — only +New does that. The
  // probe is cached from when the search was run, so this is normally instant.
  const [openingSearchId, setOpeningSearchId] = useState<string | null>(null);
  async function openSavedSearch(s: { id: string; description: string }) {
    setOpeningSearchId(s.id);
    const probeUrl = `/api/instructor/assignments/${assignmentId}/score/probe`;
    try {
      let ids: number[] = [];
      for (let guard = 0; guard < 100; guard++) {
        const data = await postJSON<{ clearlyIn?: { messageId: number }[]; remaining: number; ratedThisBatch: number }>(
          probeUrl,
          { description: s.description }
        );
        ids = (data.clearlyIn ?? []).map((x) => x.messageId);
        if (data.remaining === 0 || data.ratedThisBatch === 0) break;
      }
      setSelection({ kind: 'search', key: `search:${s.id}`, ids, label: s.description });
    } catch {
      /* ignore — leave the current selection in place */
    } finally {
      setOpeningSearchId(null);
    }
  }
  useEffect(() => {
    void reloadSearches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentId, isBaseline]);
  const [editIntent, setEditIntent] = useState<IntentSummary | null>(null);
  const [ownershipPair, setOwnershipPair] = useState<{
    a: IntentSummary;
    b: IntentSummary;
    messageIds: number[];
  } | null>(null);
  const [reviseTarget, setReviseTarget] = useState<{
    row: ScoreQueryRow;
    intent: IntentSummary;
    /** Set when the viewer had a rule version selected — Revise starts from it. */
    viewVersion: ViewerRuleVersion | null;
  } | null>(null);
  // BASELINE: Revise targets the whole monolithic prompt (no owning intent) —
  // opens the inline PromptReviseWorkbench from the anchor question.
  const [promptReviseTarget, setPromptReviseTarget] = useState<ScoreQueryRow | null>(null);

  // Full conversation is a per-question opt-in expansion of the viewer; the
  // default is the single Q/A. Reset it whenever the selection changes so a new
  // question never inherits the previous one's expanded state.
  const [convoOpen, setConvoOpen] = useState(false);
  useEffect(() => {
    setConvoOpen(false);
  }, [selectedMessageId]);

  // ---- Archived intents (soft-deleted; restore / hard-purge) --------------
  const archivedIntents = useMemo(() => intents.filter((i) => i.archived), [intents]);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [restoringId, setRestoringId] = useState<number | null>(null);
  // The intent(s) queued for irreversible hard-delete — one row's trash, or
  // the header's "Delete all". A single confirm click executes (no typing).
  const [purgeTarget, setPurgeTarget] = useState<{ intents: IntentSummary[]; all: boolean } | null>(
    null
  );
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

  async function purgeIntents() {
    if (!purgeTarget) return;
    setPurgeBusy(true);
    try {
      // Independent server-side transactions — fire together, report failures
      // once everything settles (the ones that succeeded stay deleted).
      const results = await Promise.allSettled(
        purgeTarget.intents.map((intent) =>
          fetch(`/api/instructor/assignments/${assignmentId}/score/intents/${intent.id}?mode=purge`, {
            method: 'DELETE',
          })
        )
      );
      const failed = results.filter((r) => r.status === 'rejected' || !r.value.ok).length;
      if (failed > 0) {
        window.alert(`Failed to delete ${failed} of ${purgeTarget.intents.length} intent(s).`);
      }
      setPurgeTarget(null);
      setPurgeBusy(false);
      router.refresh();
    } catch {
      window.alert('Failed to delete — network error.');
      setPurgeBusy(false);
    }
  }

  // ---- Starter sets: the Jelson taxonomy as a PERMANENT library of pre-built
  // intents. The library is a catalog — activating a set CLONES its template
  // into a live intent (ratings copied, so it's instant); the template and its
  // library entry stay put. Already-active sets show an "Added" state instead
  // of disappearing.
  const [starterOpen, setStarterOpen] = useState(false);
  const [activatingCode, setActivatingCode] = useState<string | null>(null);
  const starterGroups = useMemo(() => {
    // A live (unarchived, non-template) intent with this definition exists.
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
      /** The Type intent is already live — show Added instead of Add. */
      typeActive: boolean;
      sets: {
        code: string;
        title: string;
        definition: string;
        desc: string;
        templateId: number | null;
        /** A live intent with this definition exists — show Added, block re-Add. */
        active: boolean;
      }[];
    }[] = [];
    for (const s of jelsonSuggestions) {
      const { title, definition } = jelsonToIntent(s);
      const key = definition.trim();
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
        active: activeDefs.has(key),
      });
    }
    return groups;
  }, [jelsonSuggestions, intents]);
  const starterCount = starterGroups.reduce((n, g) => n + g.sets.length, 0);
  // Unprepared work for "Run all": every set/Type without a template — active
  // ones included, so a template lost to the legacy consume-on-activate
  // behavior gets rebuilt (the server reuses same-spec ratings, no LLM cost).
  const unpreparedCount = starterGroups.reduce(
    (n, g) =>
      n +
      g.sets.filter((s) => s.templateId === null).length +
      (g.typeTemplateId === null ? 1 : 0),
    0
  );
  // Prepared templates whose ratings went STALE (e.g. the rating prompt
  // version changed since they ran) or are incomplete — Run all must stay
  // available to refresh them; the rate pipeline re-does only the stale rows.
  const staleTemplateCount = useMemo(() => {
    const ids = new Set<number>();
    for (const g of starterGroups) {
      if (g.typeTemplateId !== null) ids.add(g.typeTemplateId);
      for (const s of g.sets) if (s.templateId !== null) ids.add(s.templateId);
    }
    let stale = 0;
    for (const tid of ids) {
      for (const r of rows) {
        const rating = r.intentRatings[tid];
        if (!rating || rating.stale) {
          stale += 1;
          break;
        }
      }
    }
    return stale;
  }, [rows, starterGroups]);

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

  // Activate a starter set into a live intent. The template is NEVER consumed —
  // the library is a permanent catalog.
  //   • PREPARED (template rated by "Run all") → CLONE it (spec + rating rows
  //     copied server-side). Instant: no LLM call, edit-ready at once.
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
        const res = await fetch(`/api/instructor/assignments/${assignmentId}/score/intents`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fromTemplateId: set.templateId, autoTitle: false }),
        });
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
        case 'search':
          // A baseline saved search: its cached clearly-in messageIds.
          return selection.ids.includes(r.messageId);
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

  // ---- Viewer rule-version dropdown ---------------------------------------
  // The owning intent's rule versions for the SELECTED message, each with its
  // stored response when one was generated (Save / "apply to intent"). null
  // selection = the delivered original.
  const [viewerVersions, setViewerVersions] = useState<ViewerRuleVersion[] | null>(null);
  const [viewedVersionNo, setViewedVersionNo] = useState<number | null>(null);
  // Bumped when a Revise session saved/applied — refetches the dropdown for the
  // (unchanged) selection.
  const [viewerVersionsNonce, setViewerVersionsNonce] = useState(0);
  const selectedOwnerId = useMemo(() => {
    if (selectedMessageId === null) return null;
    const res = resolutions.get(selectedMessageId);
    return res?.kind === 'assigned' ? res.intentId : null;
  }, [selectedMessageId, resolutions]);
  useEffect(() => {
    setViewerVersions(null);
    setViewedVersionNo(null);
    if (selectedMessageId === null || selectedOwnerId === null) return;
    let alive = true;
    fetch(
      `/api/instructor/assignments/${assignmentId}/score/intents/${selectedOwnerId}/rule-versions?messageId=${selectedMessageId}`
    )
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => {
        if (!alive || !d || !Array.isArray(d.versions)) return;
        // Simulated minor steps and the v1 baseline seed stay inside the rule
        // workbench — the viewer dropdown lists APPLIED rule versions only.
        const versions = (d.versions as ViewerRuleVersion[]).filter(
          (v) => !v.minor && v.source !== 'seed'
        );
        setViewerVersions(versions);
        // Land on the most recently applied rule rather than the delivered
        // original: that version is what the instructor just built, and it is
        // what students would get today. The API returns newest-first, so the
        // first one carrying a response for this question is the latest.
        setViewedVersionNo(versions.find((v) => v.response)?.versionNo ?? null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [assignmentId, selectedMessageId, selectedOwnerId, viewerVersionsNonce]);
  const viewedVersion = useMemo(
    () =>
      viewedVersionNo === null
        ? null
        : viewerVersions?.find((v) => v.versionNo === viewedVersionNo) ?? null,
    [viewedVersionNo, viewerVersions]
  );
  // Which response to render, resolved WITHOUT flicker: a question whose owner
  // has a rule may carry an applied-version response, so we hold the pane until
  // the version fetch lands rather than flashing the delivered original first.
  // Owner-less / rule-less questions can only ever show the delivered reply, so
  // they resolve instantly.
  const selectedOwner = selectedOwnerId !== null ? intentById.get(selectedOwnerId) ?? null : null;
  const responseResolved =
    selectedOwnerId === null || !selectedOwner?.rule || viewerVersions !== null;
  // The selected question's user bubble keeps its Material tags (same as the
  // question lists) — passed to ChatMessages' renderUserContent override.
  const renderSelectedUser = () =>
    selectedRow?.dissection && selectedRow.dissection.materialKinds.length > 0 ? (
      <MaterialSegments text={selectedRow.queryText} dissection={selectedRow.dissection} />
    ) : null;

  // ---- Rate runner (same client-driven batch loop as classification) ------
  const [running, setRunning] = useState(false);
  const [runProgress, setRunProgress] = useState<{ rated: number; total: number; failed: number } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  // Any library-wide operation in flight. While true the hover Add buttons are
  // NOT RENDERED (merely disabling them would defeat their opacity-0 hover
  // reveal — disabled:opacity-50 wins and every row's button pops in at once);
  // only the row being activated shows its own progress chip.
  const libraryBusy = preparing || running || activatingCode !== null;
  const mountedRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

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
      case 'search':
        return `Search · ${selection.label}`;
    }
  })();

  // Viewing a past deploy → the read-only version board replaces everything.
  if (deployView) {
    return <DeployVersionBoard rows={rows} deployView={deployView} />;
  }

  // Editing/creating an intent transforms the page: the board's 3-column grid
  // is swapped for the intent workbench (spec · In this intent · Needs
  // decision). Keyed per target so entering it always mounts fresh.
  const workbenchMode: WorkbenchMode | null = editIntent
    ? { kind: 'edit', intent: editIntent }
    : newIntentOpen
      ? { kind: 'create', seed: newIntentSeed }
      : null;

  return (
    <div className="flex flex-col gap-4 flex-1 min-h-0">
      {/* Slim status strip — only mounts while a starter-set rating run is in
          flight (or failed); the old permanent control bar is gone (deploy +
          versions moved to the page header). */}
      {(runError || (running && runProgress)) && (
        <div className="shrink-0 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-1.5 flex items-center gap-3 text-xs">
          {runError && (
            <span className="flex items-center gap-1 text-red-600">
              <AlertTriangle className="w-3.5 h-3.5" /> {runError}
            </span>
          )}
          {running && runProgress && (
            <span className="flex items-center gap-2 text-[hsl(var(--muted-foreground))]">
              <span className="w-32 h-1.5 rounded bg-[hsl(var(--muted))] overflow-hidden inline-block">
                <span
                  className="block h-full bg-[hsl(var(--primary))] transition-all"
                  style={{ width: `${runProgress.total ? Math.round((runProgress.rated / runProgress.total) * 100) : 0}%` }}
                />
              </span>
              <span className="tabular-nums">
                {runProgress.rated}/{runProgress.total}
                {runProgress.failed > 0 && <span className="text-red-600"> · {runProgress.failed} failed</span>}
              </span>
            </span>
          )}
        </div>
      )}

      {reviseTarget ? (
        // Revising a rule ALSO transforms the page (like intent editing): the
        // grid is swapped for the rule workbench.
        <RuleWorkbench
          key={`${reviseTarget.intent.id}-${reviseTarget.row.messageId}`}
          assignmentId={assignmentId}
          rows={rows}
          row={reviseTarget.row}
          intent={reviseTarget.intent}
          basePrompt={basePrompt}
          isNirvana={isNirvana}
          viewVersion={reviseTarget.viewVersion}
          onClose={(changed) => {
            setReviseTarget(null);
            if (changed) {
              setViewerVersionsNonce((n) => n + 1); // refetch the viewer dropdown
              router.refresh();
            }
          }}
          onCreateInstead={(seed) => {
            // §2.3: switching from Revise makes the question being viewed the
            // seed of the new intent — the suggest modal supplies a reviewed
            // {title, definition}; fall back to a raw template without one.
            const q = reviseTarget.row.queryText.replace(/\s+/g, ' ').trim();
            setReviseTarget(null);
            setNewIntentSeed(
              seed ?? {
                title: '',
                definition: `asks the chatbot to <describe the request> — e.g. "${q.length > 120 ? `${q.slice(0, 120)}…` : q}"`,
              }
            );
            setNewIntentOpen(true);
          }}
        />
      ) : isBaseline && searchMode ? (
        <SearchWorkbench
          key={searchMode.kind === 'preset' ? `preset-${searchMode.intentId}` : searchMode.kind === 'saved' ? `saved-${searchMode.searchId}` : 'new-search'}
          assignmentId={assignmentId}
          rows={rows}
          isNirvana={isNirvana}
          mode={searchMode}
          onExit={() => {
            setSearchMode(null);
            void reloadSearches();
          }}
        />
      ) : isBaseline && promptReviseTarget ? (
        <PromptReviseWorkbench
          key={`revise-${promptReviseTarget.messageId}`}
          assignmentId={assignmentId}
          rows={rows}
          anchor={promptReviseTarget}
          promptText={promptDraft}
          onClose={(revised) => {
            setPromptReviseTarget(null);
            if (revised !== null) setPromptDraft(revised);
          }}
        />
      ) : workbenchMode ? (
        <IntentWorkbench
          key={editIntent ? `edit-${editIntent.id}` : 'create'}
          assignmentId={assignmentId}
          model={selectedModel}
          openaiConfigured={openaiConfigured}
          rows={rows}
          isNirvana={isNirvana}
          mode={workbenchMode}
          jelsonSuggestions={jelsonSuggestions}
          templates={intents
            .filter((i) => i.isTemplate && !i.archived)
            .map(({ id, title, definition }) => ({ id, title, definition }))}
          onExit={() => {
            setNewIntentOpen(false);
            setNewIntentSeed(null);
            setEditIntent(null);
            router.refresh();
          }}
        />
      ) : (
      <div className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)_minmax(0,1.1fr)] gap-4 flex-1 min-h-0">
        {/* LEFT — Base prompt · Intents · Needs decision · Unassigned. In the
            baseline the System Prompt is pinned at the top and only the Searches
            list below it scrolls (flex column); SCORE scrolls as one panel. */}
        <div
          className={`rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] ${
            isBaseline ? 'flex flex-col overflow-hidden' : 'overflow-y-auto'
          }`}
        >
          {isBaseline ? (
            /* BASELINE: editable monolithic system prompt in the original slot. */
            <div className="shrink-0 border-b border-[hsl(var(--border))] px-3 py-2">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                  System Prompt
                </span>
                <span className={`text-[10px] ${promptOver ? 'text-red-600 font-medium' : 'text-[hsl(var(--muted-foreground))]'}`}>
                  {promptChars.toLocaleString()}/{promptLimit.toLocaleString()}
                </span>
              </div>
              <textarea
                value={promptDraft}
                onChange={(e) => setPromptDraft(e.target.value)}
                spellCheck={false}
                className="w-full h-48 resize-y rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5 text-xs font-mono leading-relaxed focus:outline-none focus:ring-1 focus:ring-[hsl(var(--ring))]"
                placeholder="Write the chatbot's instructions for how it should talk with students…"
              />
              <div className="mt-1.5 flex items-center gap-1.5">
                <button
                  onClick={() => persistPrompt('save')}
                  disabled={!!promptBusy || !promptDirty || promptOver}
                  className="text-[11px] px-2 py-0.5 rounded border border-[hsl(var(--border))] disabled:opacity-40 hover:bg-[hsl(var(--muted))]/50"
                >
                  {promptBusy === 'save' ? 'Saving…' : 'Save'}
                </button>
                <button
                  onClick={() => persistPrompt('deploy')}
                  disabled={!!promptBusy || promptOver}
                  className="text-[11px] px-2 py-0.5 rounded bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] disabled:opacity-40"
                >
                  {promptBusy === 'deploy' ? 'Deploying…' : 'Deploy'}
                </button>
                {promptNote && <span className="text-[10px] text-[hsl(var(--muted-foreground))] truncate">{promptNote}</span>}
              </div>
              <p className="mt-1 text-[10px] text-[hsl(var(--muted-foreground))]">
                {deployedVersionNo ? `Students receive v${deployedVersionNo}` : 'Not deployed yet — students get the base prompt'}
                {promptDirty && <span className="text-[hsl(var(--foreground))]"> · unsaved</span>}
              </p>
            </div>
          ) : (
            /* BASE PROMPT (read-only, managed in assignment settings) */
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
          )}

          {/* OVERLAPS — only when boundaries exist. The per-pair "Decide"
              comparison flow is PARKED for now (DecideOwnershipModal stays in
              the tree, unreachable): overlaps are resolved by tightening the
              intents' definitions in Edit intent, where overlapping questions
              are tagged and sorted first. */}
          {!isBaseline && counts.boundaryList.length > 0 && (
            <div className="border-b border-[hsl(var(--border))] bg-amber-50/60 px-3 py-2 space-y-1">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                <AlertTriangle className="w-3.5 h-3.5" /> Overlaps
              </div>
              {counts.boundaryList.map((b) => (
                <button
                  key={b.key}
                  onClick={() => setSelection({ kind: 'boundary', key: b.key })}
                  className={`w-full rounded text-left px-2 py-1.5 text-xs flex items-center justify-between gap-2 ${
                    selection.kind === 'boundary' && selection.key === b.key
                      ? 'bg-amber-100 font-medium'
                      : 'hover:bg-amber-100/60'
                  }`}
                >
                  <span className="truncate text-amber-900">
                    {b.intentIds.map((id) => titleOf(id)).join(' ↔ ')}
                  </span>
                  <Badge n={b.count} />
                </button>
              ))}
              <p className="text-[11px] text-amber-700/80">
                Answered with the base prompt until resolved — refine the intents in{' '}
                <span className="font-medium">Edit intent</span>.
              </p>
            </div>
          )}

          {/* INTENTS (score) / SEARCHES (baseline) — the header stays fixed in
              the baseline (shrink-0 is inert in SCORE's non-flex panel). */}
          <div className="shrink-0 px-3 pt-2 pb-1 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                {isBaseline ? 'Searches' : 'Intents'}
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
              onClick={() => (isBaseline ? setSearchMode({ kind: 'new' }) : setNewIntentOpen(true))}
              className="inline-flex items-center gap-1 shrink-0 text-[11px] px-1.5 py-0.5 rounded border border-[hsl(var(--primary))] text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/10"
              title={isBaseline ? 'Create a new search' : 'Create a new intent'}
            >
              <Plus className="w-3 h-3" /> New
            </button>
          </div>

          {isBaseline && (
            /* SEARCHES: the user's saved custom searches, then the pre-built
               starter-set library (reusing the SCORE StarterSetTree). Clicking
               either filters the question list to its matches — Type + Sub type
               + count — WITHOUT opening the workbench; only +New does that. This
               list is the ONLY scrolling region of the baseline left column. */
            <div className="flex-1 min-h-0 overflow-y-auto pb-1">
              {savedSearches.length > 0 && (
                <>
                  <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                    Saved
                  </div>
                  <ul>
                    {savedSearches.map((s) => {
                      const active = selection.kind === 'search' && selection.key === `search:${s.id}`;
                      return (
                        <li key={s.id}>
                          <button
                            onClick={() => openSavedSearch(s)}
                            disabled={openingSearchId !== null}
                            className={`group w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left border-b border-[hsl(var(--border))]/40 ${
                              active ? 'bg-[hsl(var(--muted))]' : 'hover:bg-[hsl(var(--muted))]/40'
                            }`}
                            title={s.description}
                          >
                            <span className={`min-w-0 truncate text-xs ${active ? 'font-medium' : 'text-[hsl(var(--foreground))]/90'}`}>
                              {s.description}
                            </span>
                            {openingSearchId === s.id && (
                              <RefreshCw className="w-3 h-3 shrink-0 animate-spin text-[hsl(var(--muted-foreground))]" />
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
              {starterGroups.length > 0 && (
                <StarterSetTree
                  groups={starterGroups}
                  counts={starterCounts}
                  selection={selection}
                  setSelection={setSelection}
                  showActivation={false}
                />
              )}
            </div>
          )}
          {isBaseline ? null : activeIntents.length === 0 ? (
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
                      <Badge n={counts.perIntent.get(intent.id) ?? 0} />
                    </div>
                    {/* When/Then as short version labels — hovering anywhere on
                        this block reveals BOTH full texts in one tooltip. */}
                    <HoverReveal
                      content={
                        <div className="space-y-1.5 text-[11px] leading-relaxed text-[hsl(var(--foreground))]">
                          <p>
                            <span className="font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                              When
                            </span>{' '}
                            {intent.definition}
                          </p>
                          {intent.pinCount > 0 && (
                            <p className="text-[hsl(var(--muted-foreground))]">
                              Boundary labels:{' '}
                              <span className="text-emerald-700">included {intent.includedCount}</span>
                              {' · '}
                              <span className="text-rose-700">excluded {intent.excludedCount}</span>
                            </p>
                          )}
                          <p className="whitespace-pre-wrap">
                            <span className="font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                              Then
                            </span>{' '}
                            {intent.rule ?? <span className="italic">No rule yet — base prompt applies</span>}
                          </p>
                        </div>
                      }
                    >
                      {/* Each line carries ITS OWN edit affordance, flowing
                          INLINE right after the text (after the ellipsis when
                          truncated): pencil on card hover, label expands on
                          button hover — When → Edit intent, Then → Edit rule. */}
                      <div className="mt-0.5 flex items-center text-[11px] text-[hsl(var(--muted-foreground))]">
                        <p className="min-w-0 truncate">
                          <span className="font-semibold">When</span>{' '}
                          {(intent.intentVersionNo ?? 0) > 0 ? `v${intent.intentVersionNo} ` : ''}
                          {intent.title}
                        </p>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditIntent(intent);
                          }}
                          className="group/edit ml-1 shrink-0 inline-flex items-center gap-0.5 rounded px-0.5 py-px opacity-0 group-hover:opacity-100 hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
                          title="Edit intent — which student questions it captures"
                        >
                          <Pencil className="w-3 h-3" />
                          <span className="hidden text-[10px] font-medium group-hover/edit:inline">
                            Edit intent
                          </span>
                        </button>
                      </div>
                      <div className="mt-0.5 flex items-center text-[11px] text-[hsl(var(--muted-foreground))]">
                        <p className="min-w-0 truncate">
                          <span className="font-semibold">Then</span>{' '}
                          {intent.rule ? (
                            intent.latestRuleVersion ? (
                              `v${intent.latestRuleVersion.versionNo}${
                                intent.latestRuleVersion.name ? ` ${intent.latestRuleVersion.name}` : ''
                              }`
                            ) : (
                              intent.rule
                            )
                          ) : (
                            <span className="italic">No rule yet — base prompt applies</span>
                          )}
                        </p>
                        {(() => {
                          // Rule editing needs an anchor question — use the
                          // intent's most recent capture (pins override).
                          const anchor = rows.find((r) => {
                            const pin = r.pinnedIntents[intent.id];
                            if (pin) return pin === 'in';
                            return r.intentRatings[intent.id]?.rating === 'clearly_in';
                          });
                          return (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!anchor) return;
                                setReviseTarget({ row: anchor, intent, viewVersion: null });
                              }}
                              disabled={!anchor}
                              className={`group/edit ml-1 shrink-0 inline-flex items-center gap-0.5 rounded px-0.5 py-px ${
                                anchor
                                  ? 'opacity-0 group-hover:opacity-100 hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]'
                                  : 'opacity-0 group-hover:opacity-30 cursor-not-allowed'
                              }`}
                              title={
                                anchor
                                  ? 'Edit rule — how the chatbot responds to these questions'
                                  : 'Edit rule — needs at least one question in this intent first'
                              }
                            >
                              <Pencil className="w-3 h-3" />
                              <span className="hidden text-[10px] font-medium group-hover/edit:inline">
                                Edit rule
                              </span>
                            </button>
                          );
                        })()}
                      </div>
                    </HoverReveal>
                    {exceptLinks.length > 0 && (
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
              <div className="flex items-center hover:bg-[hsl(var(--muted))]/50">
                <button
                  onClick={() => setArchivedOpen((o) => !o)}
                  className="flex-1 min-w-0 flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-[hsl(var(--muted-foreground))]"
                >
                  <ChevronRight className={`w-3 h-3 transition-transform ${archivedOpen ? 'rotate-90' : ''}`} />
                  <Archive className="w-3 h-3" /> Archived ({archivedIntents.length})
                </button>
                <button
                  onClick={() => setPurgeTarget({ intents: archivedIntents, all: true })}
                  disabled={purgeBusy}
                  className="shrink-0 inline-flex items-center gap-1 px-2 pr-3 py-1.5 text-[11px] text-[hsl(var(--muted-foreground))] hover:text-red-600 disabled:opacity-50"
                  title="Delete every archived intent permanently"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete all
                </button>
              </div>
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
                          onClick={() => setPurgeTarget({ intents: [intent], all: false })}
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

          {/* PENDING + UNASSIGNED + STARTER SETS — intent-only. Baseline shows
              its own Searches section (above) instead of this whole block. */}
          {!isBaseline && (
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
                      disabled={
                        preparing ||
                        running ||
                        activatingCode !== null ||
                        !openaiConfigured ||
                        (unpreparedCount === 0 && staleTemplateCount === 0)
                      }
                      className="shrink-0 inline-flex items-center gap-1 px-2 pr-3 py-1.5 text-[11px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] disabled:opacity-50"
                      title={
                        !openaiConfigured
                          ? 'OPENAI_API_KEY is not configured'
                          : unpreparedCount === 0 && staleTemplateCount === 0
                            ? 'Every starter set is prepared and up to date'
                            : unpreparedCount === 0
                              ? `Run all — ${staleTemplateCount} set(s) carry stale ratings (the rating prompt changed); refresh them`
                              : 'Run all — pre-rate every starter set so activating is instant'
                      }
                    >
                      <RefreshCw className="w-3.5 h-3.5" /> Run all
                    </button>
                  )}
                </div>
                {starterOpen && (
                  <StarterSetTree
                    groups={starterGroups}
                    counts={starterCounts}
                    selection={selection}
                    setSelection={setSelection}
                    showActivation
                    activatingCode={activatingCode}
                    libraryBusy={libraryBusy}
                    activateType={activateType}
                    activateStarterSet={activateStarterSet}
                  />
                )}
              </div>
            )}
          </div>
          )}
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
                            rating label is dropped — only the pin status (the
                            non-obvious signal) gets a chip; the applied-rule
                            version chip lives next to the participant label. */}
                        {selection.kind === 'intent' && r.pinnedIntents[selection.id] && (
                          <SmallChip
                            className="bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] border-[hsl(var(--border))]"
                            title="Set by instructor pin"
                          >
                            pinned
                          </SmallChip>
                        )}
                        {/* Overlap view: every listed intent is "in" for this
                            question (that's what makes it an overlap), so the
                            rating label is pure repetition — show just each
                            owning intent's title, flagging the ones a pin set.
                            Each chip is a shortcut INTO that intent's editor
                            (sharpen its WHEN to drop this question). role=button
                            span + stopPropagation — the row itself is a button. */}
                        {selection.kind === 'boundary' &&
                          res?.kind === 'boundary' &&
                          res.intentIds.map((iid) => {
                            const pin = r.pinnedIntents[iid];
                            const target = intentById.get(iid);
                            return (
                              <IntentChip
                                key={iid}
                                label={`${titleOf(iid)}${pin ? ' · pinned' : ''}`}
                                colors="border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 hover:border-amber-300"
                                title={`Edit “${titleOf(iid)}” — sharpen its definition to resolve this overlap${pin ? ' (set by instructor pin)' : ''}`}
                                onEdit={() => target && setEditIntent(target)}
                              />
                            );
                          })}
                        {/* Baseline hides this: it's an intent-membership tag
                            AND a shortcut into Edit intent — both intent-mechanism
                            leakage the ablation must not expose. */}
                        {!isBaseline &&
                          (selection.kind === 'unassigned' ||
                            selection.kind === 'all' ||
                            selection.kind === 'pending' ||
                            selection.kind === 'starter') &&
                          res?.kind === 'assigned' &&
                          (() => {
                            const target = intentById.get(res.intentId);
                            return (
                              <IntentChip
                                label={titleOf(res.intentId)}
                                colors="border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:border-emerald-300"
                                title={`Edit “${titleOf(res.intentId)}” — this question is captured by it`}
                                onEdit={() => target && setEditIntent(target)}
                              />
                            );
                          })()}
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
              <div className="space-y-1.5 text-xs text-[hsl(var(--muted-foreground))]">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center flex-wrap gap-1.5">
                  <span className="font-mono">
                    {selectedRow.participantToken || '—'}
                    {selectedRow.turnNumber > 0 && <span className="ml-1 font-sans">· Turn {selectedRow.turnNumber}</span>}
                  </span>
                  <span>{new Date(selectedRow.queryTimestamp).toLocaleString()}</span>
                  {/* Which deployed chatbot served this reply (audit metadata). */}
                  {selectedRow.chatDeployVersion !== null && (
                    <SmallChip
                      className="bg-violet-50 text-violet-700 border-violet-200"
                      title={`This reply was served by chat v${selectedRow.chatDeployVersion}`}
                    >
                      chat v{selectedRow.chatDeployVersion}
                    </SmallChip>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {/* The thread view interleaves DELIVERED replies, so opening
                      it drops any version regeneration back to the original. */}
                  <button
                    onClick={() => {
                      const next = !convoOpen;
                      setConvoOpen(next);
                      if (next) setViewedVersionNo(null);
                    }}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] ${
                      convoOpen ? 'bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]' : 'text-[hsl(var(--foreground))]'
                    }`}
                    title={convoOpen ? 'Back to this turn' : 'Expand the full conversation in place'}
                  >
                    {convoOpen ? (
                      <>
                        <Minimize2 className="w-3.5 h-3.5" /> Exit
                      </>
                    ) : (
                      <>
                        <Maximize2 className="w-3.5 h-3.5" /> Full conversation
                      </>
                    )}
                  </button>
                  {isBaseline ? (
                    // BASELINE: Revise the whole monolithic prompt from this
                    // question — no owning intent, always available.
                    <button
                      onClick={() => setPromptReviseTarget(selectedRow)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[hsl(var(--border))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]"
                      title="Revise the system prompt from this question"
                    >
                      Revise prompt <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  ) : (() => {
                    const res = resolutions.get(selectedRow.messageId);
                    const owner =
                      res?.kind === 'assigned' ? intentById.get(res.intentId) ?? null : null;
                    const button = (
                      <button
                        disabled={!owner}
                        onClick={() =>
                          owner &&
                          setReviseTarget({
                            row: selectedRow,
                            intent: owner,
                            // Viewing a version → revise builds on THAT version
                            // (its rule + the response being looked at).
                            viewVersion: viewedVersion,
                          })
                        }
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded border border-[hsl(var(--border))] ${
                          owner
                            ? 'text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]'
                            : 'text-[hsl(var(--muted-foreground))] opacity-60 cursor-not-allowed'
                        }`}
                        title={
                          owner
                            ? viewedVersion
                              ? `Revise the rule from v${viewedVersion.major ?? viewedVersion.versionNo}${viewedVersion.name ? ` · ${viewedVersion.name}` : ''}`
                              : `Revise the rule of "${owner.title}" from this question`
                            : undefined
                        }
                      >
                        Revise rule <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    );
                    if (owner) return button;
                    // Disabled: a visible card explains WHY and what to do,
                    // instead of a native title nobody notices.
                    return (
                      <HoverReveal
                        content={
                          <div className="space-y-1 text-[11px] leading-relaxed text-[hsl(var(--foreground))]">
                            <p className="font-semibold">Revise rule needs an owning intent</p>
                            <p className="text-[hsl(var(--muted-foreground))]">
                              A rule is an intent&apos;s <span className="font-medium">Then</span> — this
                              question isn&apos;t assigned to any intent yet, so there is no rule to
                              revise from it.
                            </p>
                            <p className="text-[hsl(var(--muted-foreground))]">
                              Pin it into an intent (or pick a question that shows an owner), then
                              revise from there.
                            </p>
                          </div>
                        }
                      >
                        {button}
                      </HoverReveal>
                    );
                  })()}
                </div>
              </div>
              {/* Rule-version picker — view the response this question got
                  (or would get) under each saved rule version. On its own line
                  so the long option labels don't crowd the P76 · Turn row. */}
              {viewerVersions && viewerVersions.some((v) => v.response) && (
                <div>
                  <select
                    value={viewedVersionNo ?? ''}
                    onChange={(e) => {
                      const next = e.target.value === '' ? null : Number(e.target.value);
                      setViewedVersionNo(next);
                      // Thread view shows delivered replies — leave it when
                      // switching to a version regeneration.
                      if (next !== null) setConvoOpen(false);
                    }}
                    className="text-[11px] border border-[hsl(var(--border))] rounded px-1 py-0.5 bg-[hsl(var(--background))] text-[hsl(var(--foreground))]"
                    title="View this question's response under a saved rule version"
                  >
                    <option value="">Original (as delivered)</option>
                    {viewerVersions
                      .filter((v) => v.response)
                      .map((v) => (
                        <option key={v.versionNo} value={v.versionNo}>
                          v{v.major ?? v.versionNo}
                          {v.name ? ` · ${v.name}` : ''}
                        </option>
                      ))}
                  </select>
                </div>
              )}
              </div>

              {convoOpen ? (
                // Full thread — the selected version's response overrides the
                // current turn's reply, so the styling matches the single view.
                <ConversationThread
                  rows={rows}
                  current={selectedRow}
                  isNirvana={isNirvana}
                  overrideResponse={
                    viewedVersion?.response
                      ? { messageId: selectedRow.messageId, text: viewedVersion.response, raw: false }
                      : null
                  }
                />
              ) : !responseResolved ? (
                // Owner has a rule → an applied-version response may exist; hold
                // (show only the question) until the fetch lands, so the reply
                // never flashes delivered → version.
                <ChatMessages
                  messages={[
                    {
                      id: selectedRow.messageId,
                      role: 'user',
                      content: selectedRow.queryText,
                      timestamp: Date.parse(selectedRow.queryTimestamp),
                    },
                  ]}
                  isLoading
                  showTimestamp
                  autoScrollToHighlight
                  renderUserContent={renderSelectedUser}
                />
              ) : (
                // Same chat component as Full conversation — one Q/A turn, the
                // reply being either the applied version's response or the
                // delivered original (raw for NIRVANA when delivered).
                <ChatMessages
                  messages={[
                    {
                      id: selectedRow.messageId,
                      role: 'user' as const,
                      content: selectedRow.queryText,
                      timestamp: Date.parse(selectedRow.queryTimestamp),
                    },
                    ...(viewedVersion?.response
                      ? [
                          {
                            id: `resp-v-${selectedRow.messageId}`,
                            role: 'assistant' as const,
                            content: viewedVersion.response,
                          },
                        ]
                      : selectedRow.responseText && selectedRow.responseText.trim()
                        ? [
                            {
                              id: `resp-${selectedRow.messageId}`,
                              role: 'assistant' as const,
                              content: selectedRow.responseText,
                              metadata: { rawText: isNirvana },
                            },
                          ]
                        : []),
                  ]}
                  showTimestamp
                  autoScrollToHighlight
                  renderUserContent={renderSelectedUser}
                />
              )}
            </div>
          )}
        </div>
      </div>
      )}

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


      {/* HARD DELETE — irreversible; one confirm click executes (no typing). */}
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
              <h2 className="text-sm font-semibold">
                {purgeTarget.all
                  ? `Delete all ${purgeTarget.intents.length} archived intents permanently?`
                  : 'Delete this intent permanently?'}
              </h2>
            </div>
            <div className="px-5 py-4 space-y-3 text-xs text-[hsl(var(--foreground))]">
              <p>
                You are about to permanently delete{' '}
                {purgeTarget.all ? (
                  <span className="font-semibold">
                    every archived intent ({purgeTarget.intents.length})
                  </span>
                ) : (
                  <span className="font-semibold">“{purgeTarget.intents[0].title}”</span>
                )}
                . This <span className="font-semibold">cannot be undone</span> — it is different from
                Archive.
              </p>
              {purgeTarget.all && (
                <ul className="max-h-28 overflow-y-auto rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40 px-3 py-2 space-y-0.5 text-[hsl(var(--muted-foreground))]">
                  {purgeTarget.intents.map((i) => (
                    <li key={i.id} className="truncate" title={i.definition}>
                      {i.title}
                    </li>
                  ))}
                </ul>
              )}
              <div className="rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40 px-3 py-2">
                <p className="mb-1 font-medium text-[hsl(var(--muted-foreground))]">This erases, forever:</p>
                <ul className="list-disc pl-4 space-y-0.5 text-[hsl(var(--muted-foreground))]">
                  <li>every classification rating for {purgeTarget.all ? 'these intents' : 'this intent'}</li>
                  <li>
                    all your in/out labels
                    {(() => {
                      const pins = purgeTarget.intents.reduce((n, i) => n + i.pinCount, 0);
                      return pins > 0 ? ` (${pins})` : '';
                    })()}
                  </li>
                  <li>exception links to and from {purgeTarget.all ? 'them' : 'it'}</li>
                  <li>cached rule previews</li>
                  <li>{purgeTarget.all ? 'their' : 'this intent’s'} own version history</li>
                </ul>
              </div>
              <p className="text-[hsl(var(--muted-foreground))]">
                Your other intents — their ratings, labels, and shared history — are not affected.
              </p>
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
                autoFocus
                onClick={purgeIntents}
                disabled={purgeBusy}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {purgeBusy
                  ? 'Deleting…'
                  : purgeTarget.all
                    ? `Delete all ${purgeTarget.intents.length}`
                    : 'Delete permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
