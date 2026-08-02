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
  isIncludedRating,
  resolveAssignment,
  type AssignmentResolution,
  type MaterialKind,
  type RatingLevel,
  type ScoreQueryType,
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
import { getJSON, postJSON } from './http';
import { SortSelect, sortQueryRows, type QuerySortMode } from './query-list';
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
  /** v7: which of the 4 fixed query types this message was classified into.
   * Null = not yet typed (or typed below TYPE_CLASSIFIER_VERSION) — such a
   * message has no chain to walk, so routing treats it as pending. */
  queryType: ScoreQueryType | null;
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
  /** v7 tree placement. `type` scopes which queries this intent is judged
   * against; parent/position place it in that type's first-match chain. Null
   * type = not yet back-filled (judged whole-log, unroutable until typed). */
  type: ScoreQueryType | null;
  parentIntentId: number | null;
  position: number | null;
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
   * left column is topped by ONE monolithic prompt instead of the intent list,
   * Intents become saved Searches, the workbench becomes Search, and Revise
   * edits the whole prompt. Everything else (query list, colours, Run all,
   * conversation) is shared. Undefined = 'score' (the normal SCORE board). */
  condition?: 'score' | 'baseline';
  /** Baseline only: monolithic prompt state (seed + deployed version) + the
   * hidden prompt-holder intent the Revise flow mounts RuleWorkbench on. */
  baseline?: {
    currentPrompt: string;
    deployedVersionNo: number | null;
    deployedPrompt: string | null;
    charLimit: number;
    promptHolderId: number;
  };
  /** The rule each intent currently deploys to students (latest chat deploy) —
   * the Revise Preview compares the working rule against this. */
  deployedRules?: { id: number; rule: string | null }[];
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
  | { kind: 'search'; key: string; ids: number[]; label: string }
  // The questions ONE tie-breaker settles: both intents claim them, and the
  // link hands them to `toIntentId`. Browsing is what the chip does now —
  // removing it is a separate button in the middle column's header.
  | { kind: 'tiebreak'; key: string; fromIntentId: number; toIntentId: number };

function Badge({ n }: { n: number }) {
  return (
    <span className="text-[11px] tabular-nums px-1.5 py-0.5 rounded-full bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]">
      {n}
    </span>
  );
}

/**
 * One segment of the left column's whole-log filter (All / Uncategorized).
 *
 * Deliberately a real segmented control on a filled track: "All" used to be an
 * inline `All · 507` chip in the INTENTS header and read as a count, not a
 * button, and the uncategorized list sat at the far bottom of the column between
 * Archived and Starter sets — so the two never looked like one either/or
 * choice. The raised active pill is the whole point; don't flatten it back into
 * text buttons.
 */
function FilterSegment({
  label,
  count,
  active,
  onClick,
  title,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`flex-1 min-w-0 inline-flex items-center justify-center gap-1.5 rounded px-2 py-1 text-xs transition-colors ${
        active
          ? 'bg-[hsl(var(--card))] shadow-sm font-medium text-[hsl(var(--foreground))]'
          : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'
      }`}
    >
      <span className="truncate">{label}</span>
      <span className="tabular-nums text-[hsl(var(--muted-foreground))]">{count}</span>
    </button>
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

/** A starter-tree row label. The row stays a single tight line; its description
 * (Type or Sub type) is hidden and surfaces as a right-hand tooltip on hover, so
 * the tree reads as structure rather than a wall of text. */
/**
 * A starter-tree row that reveals its description on hover.
 *
 * The WHOLE ROW is the hover target — including the Add Intent button — so the
 * description stays up while the pointer travels to it. And it drops BELOW the
 * row rather than to the right, where it used to sit on top of that very
 * button.
 */
function RowHover({
  description,
  className,
  children,
}: {
  description?: string;
  className: string;
  children: React.ReactNode;
}) {
  const desc = description?.trim();
  if (!desc) return <div className={className}>{children}</div>;
  return (
    <HoverReveal
      placement="bottom"
      className={className}
      content={<p className="text-sm leading-relaxed text-[hsl(var(--foreground))]">{desc}</p>}
    >
      {children}
    </HoverReveal>
  );
}

/**
 * The pre-built starter-set browse tree: Type headers, each an accordion over
 * its sub-type sets (a chevron collapses the children; the sub-types sit under a
 * guide line so the Type→Sub type dependency is visible). Clicking a Type or set
 * filters the question list to its clearly-in count (setSelection → kind:'starter').
 * SCORE also renders the activation affordances (Add a set/Type as a live intent,
 * Added/Adding chips). The BASELINE reuses the SAME tree with `showActivation={false}`,
 * so a "Search" (starter set) just shows its matching questions — Type + Sub type
 * + count, no workbench. Single source of truth for both conditions.
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
  // Accordion: every Type starts COLLAPSED so the library opens as four
  // headings to unpack one at a time, not 26 sets at once. Tracked as the
  // EXPANDED set (empty = all closed) rather than a collapsed set seeded from
  // `groups` — the initializer runs once, so a seeded set would leave any Type
  // that arrives later (or after a refresh) hanging open.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  return (
    <div className="pb-1">
      {groups.map((g) => {
        // SCORE: a set that is already a live intent LEAVES the library. Keeping
        // the row invited a second Add (its button came back the moment the POST
        // resolved, before the refresh landed), and two intents with the same
        // definition overlap on every question — the resolver then assigns
        // neither, so both read 0. The baseline keeps the full tree: there the
        // sets are searches, not intents, and nothing is ever "added".
        const sets = showActivation ? g.sets.filter((s) => !s.active) : g.sets;
        if (showActivation && sets.length === 0 && g.typeActive) return null;
        // Browse the TYPE template's own questions when prepared (what Add would
        // capture); fall back to the union of its prepared sets. Matches the
        // badge (counts.perType) — so it spans ALL sets, added ones included.
        const preparedSetIds = g.sets.map((s) => s.templateId).filter((id): id is number => id !== null);
        const groupIds = g.typeTemplateId !== null ? [g.typeTemplateId] : preparedSetIds;
        const groupKey = `type:${g.typeKey}`;
        const groupActive = selection.kind === 'starter' && selection.key === groupKey;
        const open = expanded.has(g.typeKey);
        return (
          <div key={g.typeKey}>
            {/* Type header — the chevron expands/collapses its sub-types; the
                label browses (SCORE hover Add turns the whole Type into ONE
                intent). The Type description shows as a right-hand tooltip. */}
            <RowHover
              description={g.typeDescription}
              className={`group flex items-center gap-1 pr-3 ${
                groupActive ? 'bg-[hsl(var(--muted))]' : 'bg-[hsl(var(--muted))]/30 hover:bg-[hsl(var(--muted))]/60'
              }`}
            >
              <button
                onClick={() => toggle(g.typeKey)}
                className="shrink-0 self-stretch pl-2 pr-0.5 flex items-center text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                title={open ? 'Collapse' : 'Expand'}
                aria-expanded={open}
                aria-label={open ? `Collapse ${g.typeLabel}` : `Expand ${g.typeLabel}`}
              >
                <ChevronRight className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-90' : ''}`} />
              </button>
              <div className="min-w-0 flex-1">
                <button
                  onClick={() =>
                    groupIds.length > 0 &&
                    setSelection(
                      groupActive ? { kind: 'all' } : { kind: 'starter', key: groupKey, ids: groupIds, label: g.typeLabel }
                    )
                  }
                  disabled={groupIds.length === 0}
                  className={`w-full min-w-0 text-left py-1 pr-1 flex items-center gap-2 ${
                    groupIds.length === 0 ? 'cursor-default' : ''
                  }`}
                >
                  <span className={`w-2 h-2 shrink-0 rounded-full ${TYPE_DOT[g.typeKey] ?? 'bg-gray-400'}`} />
                  <span className={`min-w-0 truncate text-xs uppercase tracking-wide ${groupActive ? 'font-semibold text-[hsl(var(--foreground))]' : 'text-[hsl(var(--muted-foreground))]'}`}>
                    {g.typeLabel} ({sets.length})
                  </span>
                </button>
              </div>
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
                    <Plus className="w-3 h-3" /> Add Intent
                  </button>
                ))}
              {groupIds.length > 0 && (
                <span className="shrink-0">
                  <Badge n={counts.perType.get(g.typeKey) ?? 0} />
                </span>
              )}
            </RowHover>
            {/* Sub-types — the Type's children, indented under a vertical guide
                line with a per-row connector so the dependency reads at a glance.
                Collapsed away by the chevron above. */}
            {open && (
              <div className="ml-4 border-l border-[hsl(var(--border))]">
                {sets.map((s) => {
                  const setKey = `set:${s.code}`;
                  const setActive = selection.kind === 'starter' && selection.key === setKey;
                  const browsable = s.templateId !== null;
                  return (
                    <RowHover
                      key={s.code}
                      description={s.desc}
                      className={`group relative flex items-center gap-2 pl-4 pr-3 py-1.5 border-b border-[hsl(var(--border))]/40 before:content-[''] before:absolute before:left-0 before:top-1/2 before:h-px before:w-2.5 before:bg-[hsl(var(--border))] ${
                        setActive ? 'bg-[hsl(var(--muted))]' : 'hover:bg-[hsl(var(--muted))]/40'
                      }`}
                    >
                      {/* Click the set → browse its clearly-in questions (prepared
                          sets only — unprepared have no ratings). The Sub type
                          description shows as a right-hand tooltip. */}
                      <div className="min-w-0 flex-1">
                        <button
                          onClick={() =>
                            browsable &&
                            setSelection(
                              setActive
                                ? { kind: 'all' }
                                : { kind: 'starter', key: setKey, ids: [s.templateId as number], label: s.title }
                            )
                          }
                          disabled={!browsable}
                          className={`w-full min-w-0 text-left ${browsable ? '' : 'cursor-default'}`}
                        >
                          <span className={`block text-sm truncate ${setActive ? 'font-medium' : 'text-[hsl(var(--foreground))]/90'}`}>
                            {s.title}
                          </span>
                        </button>
                      </div>
                      {/* No "Added" chip here: an added set is filtered out of
                          the tree above, so this row only ever renders for sets
                          that can still be added. */}
                      {showActivation &&
                        (activatingCode === s.code ? (
                          <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-[hsl(var(--border))] text-[10px] font-medium text-[hsl(var(--muted-foreground))]">
                            <RefreshCw className="w-3 h-3 animate-spin" /> Adding…
                          </span>
                        ) : libraryBusy ? null : (
                          <button
                            onClick={() => activateStarterSet?.(s)}
                            className="opacity-0 group-hover:opacity-100 shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-[hsl(var(--primary))] text-[11px] font-medium text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/10"
                            title={
                              s.templateId !== null
                                ? 'Add as an intent — a copy of the prepared set, instantly. It leaves the starter list.'
                                : 'Add as an intent and rate the log against it. It leaves the starter list.'
                            }
                          >
                            <Plus className="w-3 h-3" /> Add Intent
                          </button>
                        ))}
                      {browsable && (
                        <span className="shrink-0">
                          <Badge n={counts.perSet.get(s.templateId as number) ?? 0} />
                        </span>
                      )}
                    </RowHover>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * A 2-line clamp with its own expander, for the middle column's header.
 *
 * The header has to stay short enough that the question list is still the page,
 * but a rule is now a whole system prompt and an instructor must be able to read
 * what is actually in force without leaving the board. The expander only appears
 * when the text is long enough to be cut — no dead control on a one-liner.
 */
function ClampedText({ text, muted = false }: { text: string; muted?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="min-w-0 flex-1">
      <span
        className={`block whitespace-pre-wrap text-[11px] leading-relaxed ${open ? '' : 'line-clamp-2'} ${
          muted ? 'text-[hsl(var(--muted-foreground))]' : 'text-[hsl(var(--foreground))]'
        }`}
      >
        {text}
      </span>
      {text.trim().length > 110 && (
        <button
          onClick={() => setOpen((v) => !v)}
          className="mt-0.5 text-[10px] font-medium text-[hsl(var(--primary))] hover:underline"
        >
          {open ? 'Show less' : 'Show more'}
        </button>
      )}
    </span>
  );
}

/** The header's label gutter — "When" / "Then" / "Set", one fixed column so the
 * texts beside them line up. */
function DetailLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="shrink-0 w-10 pt-px text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
      {children}
    </span>
  );
}

/**
 * A header action — Edit Intent / Edit Rule / Add Intent.
 *
 * ALWAYS VISIBLE, with its label spelled out. These used to be pencils that
 * faded in on card hover, which meant the two main entry points of the whole
 * loop were invisible until you happened to hover the right row.
 */
function HeaderAction({
  onClick,
  disabled,
  title,
  icon,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="shrink-0 self-start inline-flex items-center gap-1 rounded border border-[hsl(var(--primary))] px-2 py-1 text-[11px] font-medium text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/10 disabled:border-[hsl(var(--border))] disabled:text-[hsl(var(--muted-foreground))] disabled:cursor-not-allowed disabled:hover:bg-transparent"
    >
      {icon}
      {children}
    </button>
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
 * cut off by the scroll container. `placement="right"` anchors the panel to the
 * trigger's right edge (flipping left near the viewport border) — used by the
 * starter tree, whose rows hide their description and reveal it sideways. */
function HoverReveal({
  content,
  children,
  placement = 'bottom',
  className,
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  placement?: 'bottom' | 'right';
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; transform?: string } | null>(null);
  return (
    <div
      ref={ref}
      className={className}
      onMouseEnter={() => {
        const r = ref.current?.getBoundingClientRect();
        if (!r) return;
        const width = Math.min(320, window.innerWidth * 0.8); // w-80 / max-w-[80vw]
        if (placement === 'right') {
          // Prefer the trigger's right; flip to its left when the panel would
          // run off the viewport. Vertically centred on the row, clamped in.
          const flipLeft = r.right + width + 12 > window.innerWidth;
          const left = flipLeft ? Math.max(8, r.left - width - 6) : r.right + 6;
          const top = Math.min(Math.max(12, r.top + r.height / 2), window.innerHeight - 12);
          setPos({ left, top, transform: 'translateY(-50%)' });
          return;
        }
        // Flip above when there isn't room below (near the viewport bottom),
        // and clamp horizontally so the fixed-width panel never runs off the
        // right edge (anchors near the viewport border, e.g. the viewer's
        // Revise button).
        const above = window.innerHeight - r.bottom < 240;
        const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
        setPos({ left, top: above ? r.top - 6 : r.bottom + 6, transform: above ? 'translateY(-100%)' : undefined });
      }}
      onMouseLeave={() => setPos(null)}
    >
      {children}
      {pos && (
        <div
          role="tooltip"
          className="fixed z-[60] w-80 max-w-[80vw] rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 shadow-lg pointer-events-none"
          style={{ left: pos.left, top: pos.top, transform: pos.transform }}
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
                        {i.rule ?? <span className="italic">No rule yet</span>}
                      </p>
                    </div>
                  }
                >
                  <p className="mt-0.5 text-[11px] text-[hsl(var(--muted-foreground))] line-clamp-1">
                    <span className="font-semibold">When</span> {i.definition}
                  </p>
                  <p className="mt-0.5 text-[11px] text-[hsl(var(--muted-foreground))] line-clamp-1">
                    <span className="font-semibold">Then</span>{' '}
                    {i.rule ?? <span className="italic">No rule yet</span>}
                  </p>
                </HoverReveal>
              </div>
            );
          })}
          {/* Replies no intent rule covered (no match / fail-open). */}
          <button
            onClick={() => setSel('base')}
            className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between border-t border-[hsl(var(--border))] ${
              sel === 'base' ? 'bg-[hsl(var(--muted))] font-medium' : 'hover:bg-[hsl(var(--muted))]/50'
            }`}
            title="Replies where no intent rule was injected (no match / fail-open)"
          >
            <span className="text-[hsl(var(--muted-foreground))]">No intent matched</span>
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
  deployedRules,
}: IntentBoardProps) {
  const router = useRouter();
  const isBaseline = condition === 'baseline';
  // intentId → the rule currently deployed to students (latest chat deploy).
  const deployedRuleByIntent = useMemo(
    () => new Map((deployedRules ?? []).map((d) => [d.id, d.rule])),
    [deployedRules]
  );
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
  // PID ascending by default: the log is a finished class's archive, so
  // "newest" orders it by an axis that means nothing to the instructor, while
  // PID groups each student's turns in the order they happened — and gives
  // every study participant the identical starting sequence.
  const [sortMode, setSortMode] = useState<QuerySortMode>('participant-asc');
  // Rating model is fixed (picker removed) — 5.4-mini.
  const selectedModel = SCORE_RATING_MODEL;
  // BASELINE: the monolithic system prompt sits at the top of the left column;
  // SCORE has nothing there (each intent's rule IS its whole prompt, shown on
  // the intent itself — there is no separate base layer to display).
  // Read-only display of the current system prompt (the holder's live rule).
  // Editing is in Revise; Deploy is in the header. Synced after a Revise save.
  const [promptDraft, setPromptDraft] = useState(baseline?.currentPrompt ?? basePrompt);

  /** After a Revise session (RuleWorkbench on the holder) saved a new rule,
   * pull the holder's live rule (latest MAJOR) into the board's read-only view. */
  async function syncPromptFromHolder() {
    if (!baseline) return;
    try {
      const d = await getJSON<{ versions?: { rule: string | null; minor: boolean }[] }>(
        `/api/instructor/assignments/${assignmentId}/score/intents/${baseline.promptHolderId}/rule-versions`
      );
      const live = (d.versions ?? []).find((v) => !v.minor);
      if (live) setPromptDraft(live.rule ?? '');
    } catch {
      /* ignore — router.refresh will still update the deployed state */
    }
  }

  // The prompt-holder as an IntentSummary — RuleWorkbench mounts on it in the
  // baseline Revise flow. Empty definition so no SCORE affordance keyed to a real
  // intent misfires; rule seeds v1 on the holder's first open.
  const promptHolder: IntentSummary | null = useMemo(
    () =>
      baseline
        ? {
            id: baseline.promptHolderId,
            title: 'Rules',
            definition: '',
            rule: baseline.currentPrompt,
            archived: false,
            isTemplate: false,
            pinCount: 0,
            includedCount: 0,
            excludedCount: 0,
            // The holder is not a routable node — it has no place in any type's
            // chain (baseline never classifies at all).
            type: null,
            parentIntentId: null,
            position: null,
          }
        : null,
    [baseline]
  );

  /**
   * Overlap resolution, the short way: "these questions are not THAT intent".
   *
   * Declares an exception link (from → to), which the deterministic resolver
   * applies at read time: `from` is dropped whenever `to` also claims the
   * question. So the moment one claimant is left the boundary resolves into a
   * normal assignment and disappears from the queue — no LLM call, and no pin,
   * which would move the intent's defHash and mark all of its ratings stale.
   * Undo lives on the intent card (the "except …" chip) and in the version
   * history, since the links route records a config version.
   */
  const [droppingIntentId, setDroppingIntentId] = useState<number | null>(null);
  const [removingTieBreaker, setRemovingTieBreaker] = useState(false);
  /** Undo a tie-breaker: both intents claim those questions again, so they go
   * back to the overlap queue. Deliberately NOT on the chip — see the chip. */
  async function removeTieBreaker(fromIntentId: number, toIntentId: number) {
    if (removingTieBreaker) return;
    setRemovingTieBreaker(true);
    try {
      const res = await fetch(
        `/api/instructor/assignments/${assignmentId}/score/links?from=${fromIntentId}&to=${toIntentId}`,
        { method: 'DELETE' }
      );
      if (!res.ok) {
        window.alert('Failed to remove the tie-breaker.');
        setRemovingTieBreaker(false);
        return;
      }
      router.refresh();
    } catch {
      window.alert('Failed to remove the tie-breaker — network error.');
      setRemovingTieBreaker(false);
    }
  }
  useEffect(() => setRemovingTieBreaker(false), [links]);
  // Busy state clears when the new links land, not when the POST returns —
  // router.refresh() is fire-and-forget, and until it repaints the overlap is
  // still on screen with live buttons.
  useEffect(() => setDroppingIntentId(null), [links]);
  async function dropFromOverlap(fromIntentId: number, otherIds: number[]) {
    const toIntentId = otherIds[0];
    if (toIntentId === undefined || droppingIntentId !== null) return;
    setDroppingIntentId(fromIntentId);
    try {
      const res = await fetch(`/api/instructor/assignments/${assignmentId}/score/links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromIntentId, toIntentId }),
      });
      // 409 = the link (or its reverse) is already declared — the overlap is
      // resolved either way, so refresh rather than shout at the instructor.
      if (!res.ok && res.status !== 409) {
        window.alert('Failed to take that intent off these questions.');
        setDroppingIntentId(null);
        return;
      }
      router.refresh();
    } catch {
      window.alert('Failed to take that intent off these questions.');
      setDroppingIntentId(null);
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
  // opens RuleWorkbench (promptMode) on the prompt-holder from the anchor question.
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
  // into a live intent (ratings copied, so it's instant); the TEMPLATE row in
  // the database stays put — the prepared library is never consumed — but the
  // set disappears from this tree, so the same starter cannot be added twice.
  // Open by default: the section costs four Type headings, and seeing that a
  // prepared library exists is the point. The TYPES stay collapsed, so it is
  // still unpacked one at a time (StarterSetTree's `expanded`).
  const [starterOpen, setStarterOpen] = useState(true);
  const [activatingCode, setActivatingCode] = useState<string | null>(null);
  /** Definitions added since the last server render — see starterGroups. */
  const [justAddedDefs, setJustAddedDefs] = useState<Set<string>>(() => new Set());
  const markJustAdded = (definition: string) =>
    setJustAddedDefs((prev) => new Set(prev).add(definition.trim()));
  // A fresh server render supersedes the optimistic overlay: whatever it says
  // about live intents is now the truth (added, or archived again since).
  useEffect(() => {
    setJustAddedDefs((prev) => (prev.size === 0 ? prev : new Set()));
  }, [intents]);
  const starterGroups = useMemo(() => {
    // A live (unarchived, non-template) intent with this definition exists.
    const activeDefs = new Set(
      intents.filter((i) => !i.archived && !i.isTemplate).map((i) => i.definition.trim())
    );
    // …plus what was added THIS render cycle. router.refresh() is fire-and-
    // forget, so between the POST resolving and the server render landing the
    // starter row (and its Add button) would otherwise come back and take a
    // second click. justAddedDefs is cleared as soon as any fresh server render
    // arrives, so an intent archived right after adding puts its set back.
    for (const d of justAddedDefs) activeDefs.add(d);
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
  }, [jelsonSuggestions, intents, justAddedDefs]);
  // Only what is still addable — the header count must match the rows inside.
  const starterCount = starterGroups.reduce((n, g) => n + g.sets.filter((s) => !s.active).length, 0);
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
        // 409 = the server's one-live-intent-per-set guard already has it (a
        // stale tab, a replayed click). Not an error to the instructor: mark it
        // added so the row leaves the library, exactly as a fresh add would.
        if (!res.ok && res.status !== 409) {
          window.alert('Failed to activate the starter set.');
          return;
        }
        markJustAdded(set.definition);
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
      markJustAdded(set.definition);
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

  /**
   * Which active intents claim each question BEFORE exception links settle it.
   *
   * `resolutions` above is the post-link picture, where the intent a tie-breaker
   * dropped has simply vanished — so it cannot answer "which questions does this
   * tie-breaker actually decide?". This is the same computation minus the link
   * pass; a tie-breaker applies wherever both of its intents appear here.
   */
  const claimants = useMemo(() => {
    const map = new Map<number, number[]>();
    for (const r of rows) {
      const ratings = new Map<number, RatingLevel>();
      for (const [idStr, v] of Object.entries(r.intentRatings)) ratings.set(Number(idStr), v.rating);
      const pins = new Map<number, 'in' | 'out'>(
        Object.entries(r.pinnedIntents).map(([k, v]) => [Number(k), v])
      );
      const effective = applyPinOverrides(ratings, pins);
      map.set(
        r.messageId,
        activeIds.filter((id) => isIncludedRating(effective.get(id)))
      );
    }
    return map;
  }, [rows, activeIds]);

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
        !selection.ids.some((tid) => intentById.get(tid)?.isTemplate)) ||
      // The tie-breaker was removed (here or from the intent card).
      (selection.kind === 'tiebreak' &&
        !links.some(
          (l) => l.fromIntentId === selection.fromIntentId && l.toIntentId === selection.toIntentId
        ));
    if (gone) setSelection({ kind: 'all' });
  }, [selection, activeIntents, counts, intentById, links]);

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
        case 'tiebreak': {
          // Both intents claim it → this is a question the tie-breaker decides.
          const c = claimants.get(r.messageId);
          return !!c && c.includes(selection.fromIntentId) && c.includes(selection.toIntentId);
        }
      }
    });
  }, [rows, resolutions, selection, claimants]);

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

  const sortedRows = useMemo(() => sortQueryRows(searchedRows, sortMode), [searchedRows, sortMode]);

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
        return 'Uncategorized questions';
      case 'pending':
        return 'Not yet rated';
      case 'boundary':
        return selection.key.split('+').map((s) => titleOf(Number(s))).join(' ↔ ');
      case 'starter':
        return `Starter set · ${selection.label}`;
      case 'search':
        return `Search · ${selection.label}`;
      case 'tiebreak':
        return `Tie-breaker · ${titleOf(selection.toIntentId)} wins`;
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
          deployedRule={deployedRuleByIntent.get(reviseTarget.intent.id) ?? null}
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
      ) : isBaseline && promptReviseTarget && promptHolder ? (
        // Baseline Revise = the SCORE RuleWorkbench mounted on the hidden
        // prompt-holder intent (promptMode hides the intent-only affordances),
        // so version history (v1 seed, minors, checkout, revert) is reused verbatim.
        <RuleWorkbench
          key={`prompt-revise-${promptReviseTarget.messageId}`}
          assignmentId={assignmentId}
          rows={rows}
          row={promptReviseTarget}
          intent={promptHolder}
          basePrompt={basePrompt}
          isNirvana={isNirvana}
          deployedRule={baseline?.deployedPrompt ?? null}
          promptMode
          onClose={(changed) => {
            setPromptReviseTarget(null);
            if (changed) {
              void syncPromptFromHolder();
              router.refresh();
            }
          }}
          onCreateInstead={() => setPromptReviseTarget(null)}
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
          // The overlap chips' shortcut: jump straight into the overlapping
          // intent's editor (re-keys this workbench onto it). Only while editing
          // an existing intent — a create draft has nothing to swap away from.
          onEditIntent={
            editIntent
              ? (iid) => {
                  const target = intentById.get(iid);
                  if (target && !target.archived) setEditIntent(target);
                }
              : undefined
          }
        />
      ) : (
      <div className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)_minmax(0,1.1fr)] gap-4 flex-1 min-h-0">
        {/* LEFT — Intents · Needs decision · Unassigned. In the baseline the
            Rules panel is pinned at the top and only the Searches list below
            it scrolls (flex column); SCORE scrolls as one panel. */}
        <div
          className={`rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] ${
            isBaseline ? 'flex flex-col overflow-hidden' : 'overflow-y-auto'
          }`}
        >
          {isBaseline ? (
            /* BASELINE: read-only view of the current system prompt — the
               participant's own artifact, the counterpart of the per-intent
               rules SCORE shows on each intent row. Editing happens in Revise
               (RuleWorkbench on the holder); Deploy lives in the header. */
            <div className="shrink-0 border-b border-[hsl(var(--border))] px-3 py-2">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                  Rules
                </span>
                <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
                  {baseline?.deployedVersionNo ? `v${baseline.deployedVersionNo} live` : 'not deployed'}
                </span>
              </div>
              <div className="max-h-40 overflow-y-auto rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/20 px-2 py-1.5 text-xs whitespace-pre-wrap leading-relaxed text-[hsl(var(--muted-foreground))]">
                {promptDraft.trim() ? (
                  promptDraft
                ) : (
                  <span className="italic">No rules yet — open a question and Revise to write them.</span>
                )}
              </div>
              <p className="mt-1 text-[10px] text-[hsl(var(--muted-foreground))]">
                Edited in Revise (from a question) · deployed from the top-right.
              </p>
            </div>
          ) : null}

          {/* OVERLAPS — only when boundaries exist. The per-pair "Decide"
              comparison flow is PARKED for now (DecideOwnershipModal stays in
              the tree, unreachable): overlaps are resolved by tightening the
              intents' definitions in Edit intent, where overlapping questions
              are tagged and sorted first. */}
          {!isBaseline && counts.boundaryList.length > 0 && (
            <div className="border-b border-[hsl(var(--border))] bg-amber-50/60 px-3 py-2 space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-700">
                <AlertTriangle className="w-3.5 h-3.5" /> Overlaps
              </div>
              {counts.boundaryList.map((b) => (
                <button
                  key={b.key}
                  onClick={() => setSelection({ kind: 'boundary', key: b.key })}
                  className={`w-full rounded text-left px-2 py-1.5 text-sm flex items-center justify-between gap-2 ${
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
                Answered without an intent rule until resolved — refine the intents in{' '}
                <span className="font-medium">Edit intent</span>.
              </p>
            </div>
          )}

          {/* INTENTS (score) / SEARCHES (baseline) + the whole-log filters.
              Sticky: in the baseline the panel is a flex column and this block
              is shrink-0, and in SCORE the panel scrolls as one — so All /
              Uncategorized would otherwise scroll away behind a long intent list. */}
          <div className="shrink-0 sticky top-0 z-10 bg-[hsl(var(--card))]">
            <div className="px-3 pt-2 pb-1 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                {isBaseline ? 'Searches' : 'Intents'}
              </span>
              <button
                onClick={() => (isBaseline ? setSearchMode({ kind: 'new' }) : setNewIntentOpen(true))}
                className="inline-flex items-center gap-1 shrink-0 text-xs px-1.5 py-0.5 rounded border border-[hsl(var(--primary))] text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/10"
                title={isBaseline ? 'Create a new search' : 'Create a new intent'}
              >
                <Plus className="w-3 h-3" /> New
              </button>
            </div>
            {/* The two views of the WHOLE log, as one either/or control. The
                baseline has no intents, so it gets All alone (a full-width
                "clear the search filter" button). */}
            <div className="mx-3 mb-2 flex items-stretch gap-1 rounded-md bg-[hsl(var(--muted))] p-0.5">
              <FilterSegment
                label="All"
                count={rows.length}
                active={selection.kind === 'all'}
                onClick={() => setSelection({ kind: 'all' })}
                title="Every logged question"
              />
              {!isBaseline && (
                <FilterSegment
                  label="Uncategorized"
                  count={counts.unassigned}
                  active={selection.kind === 'unassigned'}
                  onClick={() => setSelection({ kind: 'unassigned' })}
                  title="No intent captures these yet — no intent rule is applied."
                />
              )}
            </div>
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
                  <div className="px-3 pt-2 pb-1 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
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
                            <span className={`min-w-0 truncate text-sm ${active ? 'font-medium' : 'text-[hsl(var(--foreground))]/90'}`}>
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
                    {/* Navigation only: the title and how many questions it
                        holds. The definition, the rule and their edit actions
                        moved to the middle column's header, where the SELECTED
                        intent gets full width and real buttons instead of two
                        truncated version labels repeated down the whole list.
                        Hover still reveals both texts, so intents can be
                        compared without changing the selection. */}
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
                            {intent.rule ?? <span className="italic">No rule yet</span>}
                          </p>
                        </div>
                      }
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium truncate">{intent.title}</span>
                        <Badge n={counts.perIntent.get(intent.id) ?? 0} />
                      </div>
                    </HoverReveal>
                    {/* TIE-BREAKERS this intent yields to. The chip BROWSES —
                        it filters the list to the questions this tie-breaker
                        actually decides. Removing it is a deliberate second
                        step in the middle column's header, so a stray click
                        can't undo a decision and hand a pile of questions back
                        to Needs Decision. */}
                    {exceptLinks.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {exceptLinks.map((l) => {
                          const key = `tb:${l.fromIntentId}->${l.toIntentId}`;
                          const active = selection.kind === 'tiebreak' && selection.key === key;
                          return (
                            <button
                              key={l.toIntentId}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelection(
                                  active
                                    ? { kind: 'all' }
                                    : {
                                        kind: 'tiebreak',
                                        key,
                                        fromIntentId: l.fromIntentId,
                                        toIntentId: l.toIntentId,
                                      }
                                );
                              }}
                              title={`Tie-breaker — when both match, “${titleOf(l.toIntentId)}” takes the question. Click to see which questions.`}
                            >
                              <SmallChip
                                className={
                                  active
                                    ? 'bg-sky-100 text-sky-800 border-sky-300'
                                    : 'bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-100'
                                }
                              >
                                <Link2 className="w-3 h-3" /> yields to {titleOf(l.toIntentId)}
                              </SmallChip>
                            </button>
                          );
                        })}
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
                  className="flex-1 min-w-0 flex items-center gap-1.5 px-3 py-1.5 text-xs text-[hsl(var(--muted-foreground))]"
                >
                  <ChevronRight className={`w-3.5 h-3.5 transition-transform ${archivedOpen ? 'rotate-90' : ''}`} />
                  <Archive className="w-3.5 h-3.5" /> Archived ({archivedIntents.length})
                </button>
                <button
                  onClick={() => setPurgeTarget({ intents: archivedIntents, all: true })}
                  disabled={purgeBusy}
                  className="shrink-0 inline-flex items-center gap-1 px-2 pr-3 py-1.5 text-xs text-[hsl(var(--muted-foreground))] hover:text-red-600 disabled:opacity-50"
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
                        className="text-sm truncate text-[hsl(var(--muted-foreground))]"
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

          {/* PENDING + STARTER SETS — intent-only. Baseline shows its own
              Searches section (above) instead of this whole block. Uncategorized
              lives in the sticky filter control at the top of the column now:
              it is a view of the whole log, not a library/management row like
              Archived and Starter sets. */}
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
                    className="flex-1 min-w-0 flex items-center gap-1.5 px-3 py-1.5 text-xs text-[hsl(var(--muted-foreground))]"
                  >
                    <ChevronRight className={`w-3.5 h-3.5 shrink-0 transition-transform ${starterOpen ? 'rotate-90' : ''}`} />
                    <Sparkles className="w-3.5 h-3.5 shrink-0" /> Starter sets ({starterCount})
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
                      className="shrink-0 inline-flex items-center gap-1 px-2 pr-3 py-1.5 text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] disabled:opacity-50"
                      title={
                        !openaiConfigured
                          ? 'OPENAI_API_KEY is not configured'
                          : unpreparedCount === 0 && staleTemplateCount === 0
                            ? 'Every starter set is prepared and up to date'
                            : unpreparedCount === 0
                              ? `Run all — ${staleTemplateCount} set(s) carry stale ratings (the matching method changed); refresh them`
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
          <div className="sticky top-0 z-10 bg-[hsl(var(--card))] border-b border-[hsl(var(--border))]">
          <div className="px-3 py-2 flex items-center justify-between gap-2 flex-wrap">
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
              <SortSelect value={sortMode} onChange={setSortMode} />
            </div>
          </div>
          {/* SELECTION DETAIL — what the current selection IS, and what can be
              done to it. The left column is navigation; this is the inspector,
              so it only ever describes ONE thing and can afford full width. */}
          {(() => {
            if (selection.kind === 'intent') {
              const intent = intentById.get(selection.id);
              if (!intent) return null;
              // Rule editing opens on an anchor question — the intent's most
              // recent capture (pins override the classifier).
              const anchor = rows.find((r) => {
                const pin = r.pinnedIntents[intent.id];
                if (pin) return pin === 'in';
                return r.intentRatings[intent.id]?.rating === 'clearly_in';
              });
              return (
                <div className="px-3 py-2 space-y-1.5 border-t border-[hsl(var(--border))] bg-[hsl(var(--muted))]/20">
                  <div className="flex items-start gap-2">
                    <DetailLabel>When</DetailLabel>
                    <ClampedText text={intent.definition} />
                    <HeaderAction
                      onClick={() => setEditIntent(intent)}
                      title="Edit intent — which student questions it captures"
                      icon={<Pencil className="w-3 h-3" />}
                    >
                      Edit Intent
                    </HeaderAction>
                  </div>
                  <div className="flex items-start gap-2">
                    <DetailLabel>Then</DetailLabel>
                    {intent.rule?.trim() ? (
                      <ClampedText text={intent.rule} />
                    ) : (
                      <span className="min-w-0 flex-1 text-[11px] italic text-[hsl(var(--muted-foreground))]">
                        No rule yet
                      </span>
                    )}
                    <HeaderAction
                      onClick={() => anchor && setReviseTarget({ row: anchor, intent, viewVersion: null })}
                      disabled={!anchor}
                      title={
                        anchor
                          ? 'Edit rule — how the chatbot responds to these questions'
                          : 'Edit rule — this intent has to capture at least one question first'
                      }
                      icon={<Pencil className="w-3 h-3" />}
                    >
                      Edit Rule
                    </HeaderAction>
                  </div>
                </div>
              );
            }
            if (selection.kind === 'starter' && !isBaseline) {
              // The browsed starter, found back from the selection key so the
              // header offers the SAME activation the library tree does.
              const isType = selection.key.startsWith('type:');
              const g = isType
                ? starterGroups.find((x) => `type:${x.typeKey}` === selection.key)
                : starterGroups.find((x) => x.sets.some((s) => `set:${s.code}` === selection.key));
              if (!g) return null;
              const set = isType ? null : g.sets.find((s) => `set:${s.code}` === selection.key) ?? null;
              const added = isType ? g.typeActive : set?.active ?? false;
              const desc = isType ? g.typeDescription : set?.desc ?? '';
              const adding = activatingCode === (isType ? `type:${g.typeKey}` : set?.code);
              return (
                <div className="px-3 py-2 border-t border-[hsl(var(--border))] bg-[hsl(var(--muted))]/20">
                  <div className="flex items-start gap-2">
                    <DetailLabel>Set</DetailLabel>
                    <ClampedText text={desc} muted />
                    {added ? (
                      <span className="shrink-0 self-start inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700">
                        <Check className="w-3 h-3" /> Added
                      </span>
                    ) : adding ? (
                      <span className="shrink-0 self-start inline-flex items-center gap-1 rounded border border-[hsl(var(--border))] px-2 py-1 text-[11px] font-medium text-[hsl(var(--muted-foreground))]">
                        <RefreshCw className="w-3 h-3 animate-spin" /> Adding…
                      </span>
                    ) : (
                      <HeaderAction
                        onClick={() =>
                          isType
                            ? activateType(g)
                            : set && void activateStarterSet(set)
                        }
                        disabled={running || preparing || !!activatingCode}
                        title="Add as an intent — it leaves the starter list"
                        icon={<Plus className="w-3 h-3" />}
                      >
                        Add Intent
                      </HeaderAction>
                    )}
                  </div>
                </div>
              );
            }
            if (selection.kind === 'boundary') {
              // Overlaps are resolved by tightening the colliding intents, so
              // the header hands you straight into each one's editor.
              const ids = selection.key.split('+').map(Number).filter((n) => Number.isFinite(n));
              if (ids.length === 0) return null;
              return (
                /* Stacked, not side-by-side: the colliding intents are a LIST
                   of things to go fix, however many there are, and putting them
                   beside the explanation squeezed it into a 7-line ribbon. */
                <div className="px-3 py-2 border-t border-[hsl(var(--border))] bg-amber-50/40">
                  <div className="flex items-start gap-2">
                    <DetailLabel>Both</DetailLabel>
                    <span className="min-w-0 flex-1 text-[11px] leading-relaxed text-amber-900">
                      These questions match every intent below. Take off the ones they don&apos;t belong
                      to — when one is left, it takes them and this overlap is gone.
                    </span>
                  </div>
                  {/* Each colliding intent with its WHEN in full — the overlap
                      is a disagreement between two definitions, so the two
                      definitions are the thing to read, side by side is not
                      possible in this width but stacked is. An overlap bucket
                      holds few questions, so the extra header height is cheap;
                      max-h keeps a pathological definition from taking over. */}
                  <div className="mt-1.5 pl-12 space-y-2 max-h-56 overflow-y-auto">
                    {ids.map((iid) => {
                      const target = intentById.get(iid);
                      return (
                        <div key={iid} className="flex items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-[11px] font-semibold text-amber-900">{titleOf(iid)}</p>
                            <p className="mt-0.5 whitespace-pre-wrap text-[11px] leading-relaxed text-amber-900/80">
                              {target?.definition ?? ''}
                            </p>
                          </div>
                          <div className="shrink-0 flex items-center gap-1">
                            <HeaderAction
                              onClick={() => void dropFromOverlap(iid, ids.filter((x) => x !== iid))}
                              disabled={droppingIntentId !== null || !target}
                              title={`These questions are not “${titleOf(iid)}” — hand them to the other intent`}
                              icon={
                                droppingIntentId === iid ? (
                                  <RefreshCw className="w-3 h-3 animate-spin" />
                                ) : (
                                  <X className="w-3 h-3" />
                                )
                              }
                            >
                              Not this one
                            </HeaderAction>
                            {/* The pencil stays for the instructor who would
                                rather fix the definition than call this one
                                question set. Icon-only: taking the intent off
                                is the fast path, editing is the considered one. */}
                            <button
                              onClick={() => target && setEditIntent(target)}
                              disabled={!target}
                              aria-label={`Edit ${titleOf(iid)}`}
                              title={`Edit “${titleOf(iid)}” — sharpen its definition instead`}
                              className="shrink-0 self-start rounded border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-1.5 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] disabled:opacity-50"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            }
            if (selection.kind === 'tiebreak') {
              return (
                <div className="px-3 py-2 border-t border-[hsl(var(--border))] bg-sky-50/50">
                  {/* Remove sits with the sentence it undoes — it is THE action
                      of this panel and takes a fixed, short label. */}
                  <div className="flex items-start gap-2">
                    <DetailLabel>Tie</DetailLabel>
                    <span className="min-w-0 flex-1 text-[11px] leading-relaxed text-sky-900">
                      Both <span className="font-semibold">{titleOf(selection.fromIntentId)}</span> and{' '}
                      <span className="font-semibold">{titleOf(selection.toIntentId)}</span> claim the
                      questions below, and{' '}
                      <span className="font-semibold">{titleOf(selection.toIntentId)}</span> takes them.
                      Removing this puts them back in the overlap queue.
                    </span>
                    <HeaderAction
                      onClick={() => void removeTieBreaker(selection.fromIntentId, selection.toIntentId)}
                      disabled={removingTieBreaker}
                      title="Remove this tie-breaker — both intents claim these questions again"
                      icon={
                        removingTieBreaker ? (
                          <RefreshCw className="w-3 h-3 animate-spin" />
                        ) : (
                          <X className="w-3 h-3" />
                        )
                      }
                    >
                      Remove tie-breaker
                    </HeaderAction>
                  </div>
                  {/* The edit buttons get their own line: their labels carry
                      intent titles, so two of them never fit beside anything.
                      Each NAMES its intent — a bare pencil gave no clue which
                      of the two it would open. */}
                  <div className="mt-1.5 pl-12 flex flex-wrap items-center gap-1">
                    {[selection.fromIntentId, selection.toIntentId].map((iid) => {
                      const target = intentById.get(iid);
                      return (
                        <HeaderAction
                          key={iid}
                          onClick={() => target && setEditIntent(target)}
                          disabled={!target}
                          title={`Edit “${titleOf(iid)}” — sharpen its definition instead`}
                          icon={<Pencil className="w-3 h-3" />}
                        >
                          Edit {titleOf(iid)}
                        </HeaderAction>
                      );
                    })}
                  </div>
                </div>
              );
            }
            if (selection.kind === 'search' && isBaseline) {
              const saved = savedSearches.find((s) => `search:${s.id}` === selection.key);
              if (!saved) return null;
              return (
                <div className="px-3 py-2 border-t border-[hsl(var(--border))] bg-[hsl(var(--muted))]/20 flex items-start gap-2">
                  <DetailLabel>Finds</DetailLabel>
                  <ClampedText text={saved.description} muted />
                  <HeaderAction
                    onClick={() => setSearchMode({ kind: 'saved', searchId: saved.id, definition: saved.description })}
                    title="Edit this search — change what it looks for"
                    icon={<Pencil className="w-3 h-3" />}
                  >
                    Edit Search
                  </HeaderAction>
                </div>
              );
            }
            return null;
          })()}
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
                        {/* Which intent captured this question, and a shortcut
                            into its editor. ONLY in the All view: there it is
                            live coverage feedback. Not in the Starter set view —
                            once that starter is a live intent every row repeats
                            the heading above the list, which is no information
                            at all. (Uncategorized/Not-yet-rated can't reach here
                            anyway: those views filter to fallback/pending rows,
                            and this needs an assigned one.) Baseline hides it
                            outright: an intent-membership tag AND a way into
                            Edit intent are both mechanism the ablation must not
                            expose. */}
                        {!isBaseline &&
                          selection.kind === 'all' &&
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
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] flex flex-col overflow-hidden">
          {!selectedRow ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 text-[hsl(var(--muted-foreground))]">
              <MessageSquare className="w-8 h-8 mb-3 opacity-50" />
              <p className="text-sm">Select a question to view the conversation.</p>
            </div>
          ) : (
            <div className="flex-1 min-h-0 flex flex-col">
              <div className="shrink-0 px-4 pt-4 pb-2 space-y-1.5 text-xs text-[hsl(var(--muted-foreground))]">
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
                    // BASELINE: Revise the one shared rules document from this
                    // question — no owning intent, always available.
                    <button
                      onClick={() => setPromptReviseTarget(selectedRow)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[hsl(var(--border))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]"
                      title="Revise the rules from this question"
                    >
                      Revise rules <ChevronRight className="w-3.5 h-3.5" />
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

              {/* Scrolls under the shrink-0 header above, so Exit / Full-
                  conversation toggle stays reachable and the thread's own
                  "Back to the question" button anchors correctly. */}
              <div className="flex-1 min-h-0 flex flex-col">
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
                  <li>tie-breakers to and from {purgeTarget.all ? 'them' : 'it'}</li>
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
