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
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  compileChains,
  isIncludedRating,
  QUERY_TYPE_LABELS,
  resolveRoute,
  SCORE_QUERY_TYPES,
  type RatingLevel,
  type RouteResolution,
  type ScoreQueryType,
} from '@/lib/score/intents';
import { TYPE_DEFINITIONS } from '@/lib/score/type-prompts';
import { SCORE_RATING_MODEL } from '@/lib/score/models';
import { runShardedRate } from './rate-runner';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Loader2,
  Maximize2,
  MessageSquare,
  Minimize2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type { JelsonSuggestion } from '@/lib/score/jelson-suggest';
import { MaterialSegments, QuerySnippet, StudentMessage, type Dissection } from './materials';
import { ConversationThread, ResponseBody } from './conversation';
import ChatMessages from '@/components/chat/ChatMessages';
import IntentWorkbench, { type WorkbenchMode } from './IntentWorkbench';
import RuleWorkbench from './RuleWorkbench';
import NewIntentModal from './NewIntentModal';
import NewFilterModal from './NewFilterModal';
import FilterWorkbench, { type FilterMode } from './FilterWorkbench';
import { getJSON } from './http';
import { SortSelect, sortQueryRows, type QuerySortMode } from './query-list';

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
  /** How that rule was chosen: 'intent' = a set matched, 'type_default' = the
   * query type's own rule answered. Null on replies from before v7 — they
   * predate the distinction and must not be relabelled as either. */
  appliedOutcome: string | null;
  dissection: Dissection | null;
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

/** One of the 4 fixed query types, as the left column's section header. A type
 * root is a score_intents row, so it owns a rule and a rule history like any
 * intent — but it is never judged: its rule answers whatever its chain leaves
 * unclaimed (docs/SCORE_v7_intent_tree_design.md §3.2). */
export interface TypeRootSummary {
  id: number;
  type: ScoreQueryType;
  title: string;
  rule: string | null;
}

/** One indent level of the tree. Each item inside draws its OWN segment of the
 * rule (see TreeItem), so the last one can end it — the line stops at the
 * elbow rather than running past into empty space. */
function TreeBranch({ children }: { children: React.ReactNode }) {
  return <div className="ml-[18px]">{children}</div>;
}

/** Vertical offset of a row's centre — where its elbow meets the rule. Rows are
 * a fixed height so every elbow in a branch lines up. */
const TREE_ROW_CENTER = 14;

/**
 * One item hanging off its parent's rule: the elbow into it, plus the piece of
 * the vertical rule beside it. The LAST item draws only down to its own elbow,
 * which is what turns the corner into └ instead of ├.
 *
 * The segment spans the whole item — a set plus everything nested under it —
 * so the rule runs unbroken past a subtree.
 */
function TreeItem({ last, children }: { last: boolean; children: React.ReactNode }) {
  return (
    <div className="relative">
      <span
        aria-hidden
        className="absolute left-0 top-0 w-px bg-[hsl(var(--border))]"
        style={last ? { height: TREE_ROW_CENTER } : { bottom: 0 }}
      />
      <span
        aria-hidden
        className="absolute left-0 w-2.5 border-t border-[hsl(var(--border))]"
        style={{ top: TREE_ROW_CENTER }}
      />
      {children}
    </div>
  );
}

/** The "create a set here" affordance, rendered AT the place the new set would
 * land — its indentation is the promise about where it goes. */
function NewIntentRow({
  scope,
  onClick,
}: {
  scope: { label: string; buttonLabel: string };
  onClick: () => void;
}) {
  return (
    <div className="pl-3 pr-2 py-1 min-h-[28px] flex items-center">
      <button
        onClick={onClick}
        title={scope.label}
        className="inline-flex items-center gap-1 min-w-0 rounded border border-dashed border-[hsl(var(--primary))]/60 px-1.5 py-0.5 text-[11px] font-medium text-[hsl(var(--primary))] hover:border-solid hover:bg-[hsl(var(--primary))]/10"
      >
        <Plus className="w-3 h-3 shrink-0" />
        <span className="truncate">{scope.buttonLabel}</span>
      </button>
    </div>
  );
}

/** Section accents for the 4 query types (v7 left column). */
const TYPE_SECTION_DOT: Record<ScoreQueryType, string> = {
  planning: 'bg-blue-500',
  translating: 'bg-emerald-500',
  reviewing: 'bg-amber-500',
  drafting: 'bg-violet-500',
};

interface IntentBoardProps {
  assignmentId: string;
  rows: ScoreQueryRow[];
  intents: IntentSummary[];
  /** The 4 type roots (SCORE only — the baseline has no tree). */
  typeRoots?: TypeRootSummary[];
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
  // Every query of one type — the section header.
  | { kind: 'type'; typeKey: ScoreQueryType }
  // Queries that land on ONE scope's own rule: a type root (its chain left them
  // unclaimed) or an intent (it matched, and none of its subsets did). Rendered
  // as that scope's "Uncategorized" leaf.
  | { kind: 'residue'; scopeId: number }
  | { kind: 'pending' }
  // BASELINE — a saved filter: its clearly-in questions by messageId (from the
  // probe cache, intersected with the filter's own type). Clicking a filter
  // only FILTERS the question list; the workbench is reached by creating or by
  // Edit Filter.
  | { kind: 'search'; key: string; ids: number[]; label: string };

function Badge({ n }: { n: number }) {
  return (
    <span className="text-[11px] tabular-nums px-1.5 py-0.5 rounded-full bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]">
      {n}
    </span>
  );
}

/**
 * The contents of one branch — the rows nested one level in, ending with the
 * create button when this is the selected scope. Rendering them through here
 * is what lets the LAST item end the vertical rule instead of the rule running
 * past into empty space. Shared by SCORE's intent tree and the baseline's
 * filter tree, so the two columns' nesting is drawn by the same code.
 */
function renderBranch(parts: { key: string; node: React.ReactNode }[]): React.ReactNode {
  if (parts.length === 0) return null;
  return (
    <TreeBranch>
      {parts.map((part, i) => (
        <TreeItem key={part.key} last={i === parts.length - 1}>
          {part.node}
        </TreeItem>
      ))}
    </TreeBranch>
  );
}

/** One saved baseline filter, as the searches GET returns it. `clearlyInIds`
 * is the probe cache under its defHash (whole log — the tree intersects with
 * the filter's own type before counting or selecting). */
type SavedFilter = {
  id: string;
  name: string | null;
  type: ScoreQueryType | null;
  description: string;
  clearlyInIds: number[];
};

/**
 * BASELINE — the left column's filter tree: the four query types as sections,
 * each with its saved filters hanging off it, ending (when the type is the
 * scope being looked at) in the same dashed create row SCORE's sections end in.
 *
 * This list used to be the whole taxonomy: four Types opening onto 31 prepared
 * sub-type searches, every one already run across the log. That was fair while
 * SCORE handed out the same 31 as starter intents, but v7 demoted them there
 * to SUGGESTIONS offered at creation — so keeping them here would have given
 * the control condition a finished sub-type map of the corpus for free, which
 * is a product of the structuring work the study measures, not a capability
 * either condition starts with. Now the free tier is the four types on both
 * sides — membership by the SAME copied type classification, so the counts
 * match SCORE's sections — and everything below a type is something this
 * participant made.
 *
 * What the mirror deliberately lacks (the ablation): a filter claims nothing —
 * two filters can collect the same question, so there is no order to the rows,
 * no ↑↓, no nesting, no per-scope Uncategorized residue, and no rule anywhere.
 * See docs/STUDY_BASELINE_SPEC.md §S-6c.
 */
function BaselineFilterTree({
  rows,
  filters,
  untypedCount,
  selection,
  setSelection,
  onNewFilter,
}: {
  rows: ScoreQueryRow[];
  filters: SavedFilter[];
  untypedCount: number;
  selection: IntentSelection;
  setSelection: (s: IntentSelection) => void;
  onNewFilter: (type: ScoreQueryType) => void;
}) {
  const typeCounts = useMemo(() => {
    const m = new Map<ScoreQueryType, number>();
    for (const r of rows) if (r.queryType) m.set(r.queryType, (m.get(r.queryType) ?? 0) + 1);
    return m;
  }, [rows]);
  // A filter's list membership: its cached clearly-in ∩ its own type.
  const filterIds = (f: SavedFilter): number[] => {
    const inSet = new Set(f.clearlyInIds);
    return rows
      .filter((r) => inSet.has(r.messageId) && (f.type === null || r.queryType === f.type))
      .map((r) => r.messageId);
  };
  const filterRow = (f: SavedFilter) => {
    const key = `search:${f.id}`;
    const active = selection.kind === 'search' && selection.key === key;
    const label = f.name?.trim() || f.description;
    const ids = filterIds(f);
    return (
      <button
        onClick={() => setSelection({ kind: 'search', key, ids, label })}
        title={f.description}
        className={`w-full text-left pl-3 pr-3 py-1 min-h-[28px] text-sm flex items-center justify-between gap-2 ${
          active ? 'bg-[hsl(var(--muted))] font-medium' : 'hover:bg-[hsl(var(--muted))]/40'
        }`}
      >
        <span className="truncate">{label}</span>
        <Badge n={ids.length} />
      </button>
    );
  };
  // Untyped rows predate per-type filters; shown at the bottom so they stay
  // reachable, but nothing new ever lands there.
  const untyped = filters.filter((f) => f.type === null);
  return (
    <div className="pb-1">
      {SCORE_QUERY_TYPES.map((t) => {
        const typeActive = selection.kind === 'type' && selection.typeKey === t;
        const mine = filters.filter((f) => f.type === t);
        // The create row belongs to the scope being looked at — this type, or
        // one of its own filters (a filter has no inside, so creation from it
        // still lands beside it).
        const scopeHere =
          typeActive ||
          (selection.kind === 'search' && mine.some((f) => `search:${f.id}` === selection.key));
        return (
          <div key={t} className="border-b border-[hsl(var(--border))]">
            <div
              className={`group flex items-center gap-1.5 px-3 py-1.5 cursor-pointer ${
                typeActive ? 'bg-[hsl(var(--muted))]' : 'hover:bg-[hsl(var(--muted))]/40'
              }`}
              onClick={() => setSelection({ kind: 'type', typeKey: t })}
            >
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${TYPE_SECTION_DOT[t]}`} />
              <span className="text-xs font-semibold uppercase tracking-wide truncate flex-1">
                {QUERY_TYPE_LABELS[t]}
              </span>
              <Badge n={typeCounts.get(t) ?? 0} />
            </div>
            <div className="pb-1">
              {renderBranch([
                ...mine.map((f) => ({ key: f.id, node: filterRow(f) })),
                ...(scopeHere
                  ? [
                      {
                        key: 'new',
                        node: (
                          <NewIntentRow
                            scope={{
                              label: `Create a filter in ${QUERY_TYPE_LABELS[t]}`,
                              buttonLabel: `New filter in ${QUERY_TYPE_LABELS[t]}`,
                            }}
                            onClick={() => onNewFilter(t)}
                          />
                        ),
                      },
                    ]
                  : []),
              ])}
            </div>
          </div>
        );
      })}
      {untyped.length > 0 && (
        <div className="border-b border-[hsl(var(--border))]">
          <p className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
            Ungrouped
          </p>
          <div className="pb-1">{renderBranch(untyped.map((f) => ({ key: f.id, node: filterRow(f) })))}</div>
        </div>
      )}
      {/* A question with no query type belongs to no section, so without this
          it would be reachable from nowhere in this column — the four sections
          are the whole column now that the global "All" is gone. Provisioning
          copies a fully classified log, so this should never render; it is here
          so that "some questions are invisible" can never be the silent
          failure. SCORE's counterpart is its amber Not-yet-categorized row
          (which also offers Run — baseline has no run controls, by design). */}
      {untypedCount > 0 && (
        <button
          onClick={() => setSelection({ kind: 'pending' })}
          className={`w-full text-left px-3 py-1.5 flex items-center justify-between gap-2 border-b border-[hsl(var(--border))] text-xs ${
            selection.kind === 'pending' ? 'bg-amber-100 text-amber-900' : 'bg-amber-50/70 text-amber-800 hover:text-amber-900'
          }`}
          title="These questions have not been classified into a query type."
        >
          <span className="truncate">Not yet categorized</span>
          <Badge n={untypedCount} />
        </button>
      )}
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

/** What the outermost scope is called when nothing above a rule has one. */
const DEFAULT_PROMPT_SCOPE = 'the default prompt';

/**
 * Whether a rule says anything its enclosing scope did not.
 *
 * Rules are seeded copy-on-create and inheritance is NOT live (§3.5), so a set
 * whose rule still matches the scope around it routes questions without
 * changing a word of the answer — it exists, but it does nothing yet. THAT is
 * what a glance at the board should settle. The rule's version number cannot:
 * v3 says a rule was edited three times, not whether those edits moved it away
 * from the rule it started as, and the history the number indexes lives in the
 * workbench anyway.
 */
function RuleOrigin({
  rule,
  enclosing,
}: {
  rule: string | null | undefined;
  enclosing: { rule: string; scope: string };
}) {
  // No rule at all — the "No rule yet" copy beside this already says so.
  if (!rule?.trim()) return null;
  const own = rule.trim() !== enclosing.rule.trim();
  return (
    <SmallChip
      className={
        own
          ? 'shrink-0 self-start border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))]'
          : 'shrink-0 self-start border-[hsl(var(--border))] bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]'
      }
      title={
        own
          ? `This rule differs from ${enclosing.scope} — the difference is what it adds.`
          : `Still word-for-word ${enclosing.scope}. These questions get the same answer they would without this rule.`
      }
    >
      {own ? 'own rule' : `same as ${enclosing.scope}`}
    </SmallChip>
  );
}

/**
 * The WHEN of a type's default rule, in words — the one condition on the board
 * that no instructor wrote and none can edit.
 *
 * A set's When is a definition someone typed and a judge evaluates. A type
 * root's is the leftover of two mechanisms: the type classifier put the
 * question in this type, and no set inside the type claimed it. So it is shown
 * READ-ONLY, with the classifier's own definition available underneath rather
 * than a paraphrase — and with the note that says how to actually narrow it
 * (add a set), since the missing textbox otherwise reads as a bug.
 */
function typeRootWhen(type: ScoreQueryType): {
  summary: string;
  definition: string;
  definitionLabel: string;
  note: string;
} {
  const label = QUERY_TYPE_LABELS[type];
  return {
    summary: `asks a ${label} question that none of the sets inside ${label} capture.`,
    definition: TYPE_DEFINITIONS[type],
    definitionLabel: label,
    note: `Every ${label} question falls here unless a set takes it first, so this rule is the type's last resort — there is nothing to narrow it with. To answer some of these questions differently, add a set inside ${label}; whatever it captures stops arriving here.`,
  };
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
  // Replies with no applied rule at all. Under v7 that is only ever a
  // fail-open (a query the chain leaves unclaimed is answered by its TYPE, and
  // that reply carries the type root's id like any other). Pre-v7 replies land
  // here too and stay undifferentiated — they predate the distinction, so
  // relabelling them as either would be a lie.
  const baseCount = served.filter((r) => r.appliedIntentId === null).length;
  const legacyBase = served.some((r) => r.appliedIntentId === null && r.appliedOutcome === null);
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
          {/* Replies with no rule at all — a fail-open, or a pre-v7 reply. */}
          {baseCount > 0 && (
            <button
              onClick={() => setSel('base')}
              className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between border-t border-[hsl(var(--border))] ${
                sel === 'base' ? 'bg-[hsl(var(--muted))] font-medium' : 'hover:bg-[hsl(var(--muted))]/50'
              }`}
              title={
                legacyBase
                  ? 'Replies served before the intent tree, plus any answered with no rule at all — either nothing was configured yet, or the classifier failed.'
                  : 'Answered with no rule: either nothing was configured for this deploy, or the classifier failed.'
              }
            >
              <span className="text-[hsl(var(--muted-foreground))]">No rule applied</span>
              <Badge n={baseCount} />
            </button>
          )}
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
                  defaultOpen
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
  typeRoots = [],
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

  // Workbench-exit refresh, made VISIBLE: router.refresh() re-renders the whole
  // page server-side (seconds on a big log), during which the stale board shows
  // no trace of the just-saved intent. The transition's pending flag drives a
  // status strip, and the saved intent is flagged (ring + scroll) once the
  // fresh render lands, so "did my intent arrive?" has an answer both during
  // and after the wait.
  const [boardRefreshing, startBoardRefresh] = useTransition();
  const [flagIntent, setFlagIntent] = useState<number | null>(null);
  const flagRowRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (flagIntent === null || boardRefreshing) return;
    // The fresh render is on screen. Bring the row into view, hold the ring
    // long enough to register, then let go. (A discarded/archived id simply
    // never renders a row — the timer clears it all the same.)
    flagRowRef.current?.scrollIntoView({ block: 'nearest' });
    const t = setTimeout(() => setFlagIntent(null), 3000);
    return () => clearTimeout(t);
  }, [flagIntent, boardRefreshing]);

  // Both conditions open on the first type section — there is no global "All"
  // in either left column, and a fixed starting point gives every study
  // participant the same first screen. (Opening on a type also means the
  // dashed create row is visible from the first render, both sides.)
  const [selection, setSelection] = useState<IntentSelection>({
    kind: 'type',
    typeKey: SCORE_QUERY_TYPES[0],
  });
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
   * Move a set: same parent + different neighbour = reorder, different parent =
   * carve it into/out of another set. Both are pure routing changes — position
   * and parent are outside intentDefHash, so nothing is re-rated (§3.4).
   */
  /** The rule a set was seeded from — the nearest enclosing scope that has one,
   * ultimately its type root — and whose scope that was. Mirrors the
   * copy-on-create the API does, so the workbench can tell an untouched copy
   * from an edited rule (§3.5) and the board can name what a set is still
   * following. */
  function enclosingRule(intent: IntentSummary): { rule: string; scope: string } {
    const byId = intentById;
    let cursor = intent.parentIntentId;
    for (let guard = 0; cursor !== null && guard < 100; guard++) {
      const node = byId.get(cursor);
      if (!node) break;
      if (node.rule?.trim()) return { rule: node.rule, scope: node.title };
      cursor = node.parentIntentId;
    }
    const root = intent.type ? typeRoots.find((t) => t.type === intent.type) : undefined;
    return root?.rule != null
      ? { rule: root.rule, scope: QUERY_TYPE_LABELS[root.type] }
      : { rule: basePrompt, scope: DEFAULT_PROMPT_SCOPE };
  }
  function seedRuleFor(intent: IntentSummary): string {
    return enclosingRule(intent).rule;
  }

  /** Revising a TYPE ROOT's rule — the rule that answers whatever its type
   * leaves unclaimed. Mounts the same RuleWorkbench, scoped to those questions. */
  const [rootReviseTarget, setRootReviseTarget] = useState<{
    row: ScoreQueryRow;
    root: TypeRootSummary;
  } | null>(null);

  /** The New Intent chooser — the ONE door to creating an intent (§3.2). It
   * carries the placement, because the left column opens it from a spot in the
   * tree where there may be no question in view at all; `anchorRow` is the
   * question the instructor was looking at, and only seeds the proposals. */
  const [newIntentRequest, setNewIntentRequest] = useState<{
    scope: { type: ScoreQueryType; parentIntentId: number | null };
    anchorRow: ScoreQueryRow | null;
  } | null>(null);

  const [placementBusy, setPlacementBusy] = useState<number | null>(null);
  async function moveIntent(
    intentId: number,
    where: { parentIntentId?: number | null; beforeIntentId?: number | null }
  ) {
    if (placementBusy !== null) return;
    setPlacementBusy(intentId);
    try {
      const res = await fetch(
        `/api/instructor/assignments/${assignmentId}/score/intents/${intentId}/placement`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(where),
        }
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        window.alert(typeof d?.message === 'string' ? d.message : 'Could not move that intent.');
        setPlacementBusy(null);
        return;
      }
      router.refresh();
    } catch {
      window.alert('Could not move that intent — network error.');
      setPlacementBusy(null);
    }
  }
  // Clears when the new order actually lands, not when the POST returns:
  // router.refresh() is fire-and-forget and the old order is still on screen.
  useEffect(() => setPlacementBusy(null), [intents]);

  const [newIntentOpen, setNewIntentOpen] = useState(false);
  const [newIntentSeed, setNewIntentSeed] = useState<{
    title?: string;
    definition?: string;
    /** Chose a prepared starter set: the workbench clones that template instead
     * of rating the log again, so its questions are there on arrival. */
    fromTemplateId?: number;
    /** v7 placement — where the new set lands, decided by WHERE creation was
     * invoked from rather than by a picker (§3.2). */
    type?: ScoreQueryType;
    parentIntentId?: number | null;
  } | null>(null);

  // BASELINE: the Intents list is replaced by Filters — the four query types
  // as sections with this participant's saved filters nested under them
  // (BaselineFilterTree). searchMode holds the open Filter workbench. Clicking
  // a filter only FILTERS the question list (its cached clearly-in ids arrive
  // with the GET, so the click is instant and calls nothing); the workbench is
  // reached by creating or by Edit Filter.
  const [searchMode, setSearchMode] = useState<FilterMode | null>(null);
  const [savedSearches, setSavedSearches] = useState<SavedFilter[]>([]);
  async function reloadSearches() {
    if (!isBaseline) return;
    const b = `/api/instructor/assignments/${assignmentId}/score/baseline`;
    const s = await getJSON<{ searches?: SavedFilter[] }>(`${b}/searches`).catch(() => ({
      searches: [],
    }));
    const fresh = s.searches ?? [];
    setSavedSearches(fresh);
    // A 'search' selection SNAPSHOTS its member ids — refresh the snapshot,
    // or coming back from Edit Filter would keep showing the pre-edit members
    // (and the pre-rename label) until the row was clicked again.
    setSelection((prev) => {
      if (prev.kind !== 'search') return prev;
      const f = fresh.find((x) => `search:${x.id}` === prev.key);
      if (!f) return { kind: 'type', typeKey: SCORE_QUERY_TYPES[0] };
      const inSet = new Set(f.clearlyInIds);
      const ids = rows
        .filter((r) => inSet.has(r.messageId) && (f.type === null || r.queryType === f.type))
        .map((r) => r.messageId);
      return { kind: 'search', key: prev.key, ids, label: f.name?.trim() || f.description };
    });
  }
  /** The create chooser will not offer a starter whose description is already
   * saved — the baseline's counterpart of SCORE's `liveDefinitions`. */
  const savedDescriptions = useMemo(
    () => new Set(savedSearches.map((s) => s.description.trim())),
    [savedSearches]
  );
  /** The open New Filter chooser: the query type the new filter will live
   * under, which is also whose suggestions it offers. Baseline's counterpart
   * of `newIntentRequest` — a placement in the LIST, never a claim. */
  const [newFilterRequest, setNewFilterRequest] = useState<ScoreQueryType | null>(null);
  useEffect(() => {
    void reloadSearches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentId, isBaseline]);
  const [editIntent, setEditIntent] = useState<IntentSummary | null>(null);
  const [reviseTarget, setReviseTarget] = useState<{
    row: ScoreQueryRow;
    intent: IntentSummary;
    /** Set when the viewer had a rule version selected — Revise starts from it. */
    viewVersion: ViewerRuleVersion | null;
  } | null>(null);
  // BASELINE: Revise targets the whole monolithic prompt (no owning intent) —
  // opens RuleWorkbench (variant='prompt') on the prompt-holder from the anchor question.
  const [promptReviseTarget, setPromptReviseTarget] = useState<ScoreQueryRow | null>(null);

  // Full conversation is a per-question opt-in expansion of the viewer; the
  // default is the single Q/A. Reset it whenever the selection changes so a new
  // question never inherits the previous one's expanded state.
  const [convoOpen, setConvoOpen] = useState(false);
  useEffect(() => {
    setConvoOpen(false);
  }, [selectedMessageId]);

  // ---- Direct delete (no archive step) ------------------------------------
  // The row's trash button queues the intent here; the confirm modal shows
  // where its questions will fall before anything is destroyed.
  const [deleteTarget, setDeleteTarget] = useState<IntentSummary | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  async function deleteIntent() {
    if (!deleteTarget || deleteBusy) return;
    setDeleteBusy(true);
    try {
      // One call — the server cascades over the subtree in a transaction.
      const res = await fetch(
        `/api/instructor/assignments/${assignmentId}/score/intents/${deleteTarget.id}?mode=purge`,
        { method: 'DELETE' }
      );
      if (!res.ok) {
        window.alert('Failed to delete the intent.');
        setDeleteBusy(false);
        return;
      }
      setDeleteTarget(null);
      setDeleteBusy(false);
      startBoardRefresh(() => router.refresh()); // visible via the status strip
    } catch {
      window.alert('Failed to delete — network error.');
      setDeleteBusy(false);
    }
  }

  // The starter TEMPLATE rows stay in the database even though neither
  // condition browses them any more (they are chooser seeds now): they carry a
  // full rating pass over the log, so anything whose text still matches one
  // skips the wait — SCORE by cloning, baseline through the probe cache.

  /**
   * Categorize (and rate) whatever is still pending across the whole log. This
   * is the board's one run control: the type pass rides the same sharded loop
   * as rating, and a query with no type cannot be routed at all, so this is
   * what turns a freshly imported log into a browsable one.
   */
  async function runPending() {
    if (running) return;
    setRunning(true);
    setRunError(null);
    setRunProgress({ rated: 0, total: rows.length, failed: 0 });
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await runShardedRate({
        assignmentId,
        model: SCORE_RATING_MODEL,
        estimatedTotal: rows.length,
        signal: controller.signal,
        isLive: () => mountedRef.current && !controller.signal.aborted,
        onProgress: (p) =>
          setRunProgress({ rated: Math.min(p.rated, rows.length), total: rows.length, failed: p.failed }),
      });
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError' && mountedRef.current) {
        setRunError((err as Error)?.message || 'The run was interrupted. Please try again.');
      }
    } finally {
      if (mountedRef.current) {
        setRunning(false);
        setRunProgress(null);
        router.refresh();
      }
    }
  }

  // ---- v7 routing, derived per message ------------------------------------
  // The intent tree compiles to one first-match chain per query type (subsets
  // before the set they were carved from, siblings in order); a message walks
  // the chain of ITS type and the first match owns it. Overlap is structurally
  // impossible, so there is no boundary/tie-breaker layer to settle any more.
  const chains = useMemo(
    () =>
      compileChains(
        activeIntents.map((i) => ({
          id: i.id,
          kind: 'intent' as const,
          type: i.type,
          parentIntentId: i.parentIntentId,
          position: i.position,
        }))
      ),
    [activeIntents]
  );

  /**
   * The same tree the chain compiler walks, shaped for rendering: per type, the
   * top-level sets and each set's children, siblings in evaluation order.
   * `parentIntentId` may point at a type root (or at nothing), which both mean
   * "top level of this type" — normalized here exactly as compileChains does.
   */
  const tree = useMemo(() => {
    const rootIdByType = new Map<ScoreQueryType, number>();
    for (const r of typeRoots) rootIdByType.set(r.type, r.id);
    const byType = new Map<
      ScoreQueryType,
      { topLevel: IntentSummary[]; childrenOf: Map<number, IntentSummary[]> }
    >();
    for (const t of SCORE_QUERY_TYPES) {
      byType.set(t, { topLevel: [], childrenOf: new Map() });
    }
    const membersByType = new Map<ScoreQueryType, IntentSummary[]>();
    for (const i of activeIntents) {
      if (!i.type) continue;
      const list = membersByType.get(i.type);
      if (list) list.push(i);
      else membersByType.set(i.type, [i]);
    }
    const order = (a: IntentSummary, b: IntentSummary) =>
      (a.position ?? a.id) - (b.position ?? b.id) || a.id - b.id;
    for (const [type, members] of membersByType) {
      const ids = new Set(members.map((m) => m.id));
      const rootId = rootIdByType.get(type) ?? null;
      const entry = byType.get(type)!;
      for (const m of members) {
        const parent = m.parentIntentId;
        if (parent === null || parent === rootId || !ids.has(parent)) entry.topLevel.push(m);
        else {
          const list = entry.childrenOf.get(parent);
          if (list) list.push(m);
          else entry.childrenOf.set(parent, [m]);
        }
      }
      entry.topLevel.sort(order);
      for (const list of entry.childrenOf.values()) list.sort(order);
    }
    return { byType, rootIdByType };
  }, [activeIntents, typeRoots]);

  /** Every id in a set's subtree, itself included — what selecting it browses. */
  const subtreeIds = useMemo(() => {
    const map = new Map<number, number[]>();
    const childrenOf = new Map<number, IntentSummary[]>();
    for (const entry of tree.byType.values()) {
      for (const [pid, list] of entry.childrenOf) childrenOf.set(pid, list);
    }
    const walk = (id: number, seen: Set<number>): number[] => {
      if (seen.has(id)) return [];
      seen.add(id);
      const out = [id];
      for (const c of childrenOf.get(id) ?? []) out.push(...walk(c.id, seen));
      return out;
    };
    for (const i of activeIntents) map.set(i.id, walk(i.id, new Set()));
    return map;
  }, [tree, activeIntents]);

  /**
   * The ratings one row routes by — the JUDGMENT, nothing else. Stale ratings
   * still count, for display continuity.
   *
   * Corrections used to override this. They no longer do: the board's job is to
   * show what the DEPLOYED chatbot does, and the chatbot routes from the
   * definitions alone. A correction that has not been folded into a definition
   * yet has changed nothing for students, so counting it here made the board
   * disagree with the runtime it exists to mirror — and a folded one would have
   * gone on faking the routing forever, since a consumed marker is still a row.
   */
  const effectiveRatings = (r: ScoreQueryRow): Map<number, RatingLevel> => {
    const ratings = new Map<number, RatingLevel>();
    for (const [idStr, v] of Object.entries(r.intentRatings)) ratings.set(Number(idStr), v.rating);
    return ratings;
  };

  const resolutions = useMemo(() => {
    const map = new Map<number, RouteResolution>();
    for (const r of rows) {
      // No type yet → no chain to walk. Don't guess: the message is pending
      // until the next run types it (D9).
      const chain = r.queryType ? chains.get(r.queryType) : null;
      map.set(
        r.messageId,
        chain ? resolveRoute(chain, effectiveRatings(r)) : { kind: 'pending' }
      );
    }
    return map;
    // effectiveRatings is a pure helper over `rows`; recompute when rows/chains move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, chains]);

  const counts = useMemo(() => {
    const perIntent = new Map<number, number>();
    // Queries that no intent claimed, per type — each type's own rule answers
    // them (the chain's final else). Replaces the single "Unassigned" bucket.
    const residueByType = new Map<ScoreQueryType, number>();
    let unassigned = 0;
    let pending = 0;
    for (const r of rows) {
      const res = resolutions.get(r.messageId);
      if (!res) continue;
      if (res.kind === 'matched') perIntent.set(res.intentId, (perIntent.get(res.intentId) ?? 0) + 1);
      else if (res.kind === 'type_default') {
        unassigned += 1;
        if (r.queryType) residueByType.set(r.queryType, (residueByType.get(r.queryType) ?? 0) + 1);
      } else pending += 1;
    }
    return { perIntent, residueByType, unassigned, pending };
  }, [rows, resolutions]);

  /** A set's badge: everything its subtree answers (its own residue + every
   * subset's), so a parent's number always equals its children plus its own
   * "Uncategorized" leaf. */
  const subtreeCount = (intentId: number): number =>
    (subtreeIds.get(intentId) ?? [intentId]).reduce(
      (n, id) => n + (counts.perIntent.get(id) ?? 0),
      0
    );
  /** Queries with no type judgment yet — they cannot be routed at all. */
  const untypedCount = useMemo(() => rows.filter((r) => !r.queryType).length, [rows]);

  /**
   * The delete modal's core promise: BEFORE anything is destroyed, show where
   * the questions this set (and its subsets) currently answers will fall.
   * Same machinery as the live board — compile the chains WITHOUT the subtree
   * and re-resolve every affected question — so the preview is exactly what
   * the next render will show, not an estimate.
   */
  const deletePreview = useMemo(() => {
    if (!deleteTarget) return null;
    const subtree = new Set(subtreeIds.get(deleteTarget.id) ?? [deleteTarget.id]);
    const nextChains = compileChains(
      activeIntents
        .filter((i) => !subtree.has(i.id))
        .map((i) => ({
          id: i.id,
          kind: 'intent' as const,
          type: i.type,
          parentIntentId: i.parentIntentId,
          position: i.position,
        }))
    );
    // destination label → count, in first-seen order (chain order).
    const dests = new Map<string, number>();
    let total = 0;
    for (const r of rows) {
      const res = resolutions.get(r.messageId);
      if (!res || res.kind !== 'matched' || !subtree.has(res.intentId)) continue;
      total += 1;
      const chain = r.queryType ? nextChains.get(r.queryType) : null;
      const next = chain ? resolveRoute(chain, effectiveRatings(r)) : ({ kind: 'pending' } as const);
      const label =
        next.kind === 'matched'
          ? `“${titleOf(next.intentId)}”`
          : next.kind === 'type_default'
            ? `the ${r.queryType ? QUERY_TYPE_LABELS[r.queryType] : 'type'} default rule`
            : 'pending (unrated)';
      dests.set(label, (dests.get(label) ?? 0) + 1);
    }
    return {
      total,
      dests: [...dests.entries()].sort((a, b) => b[1] - a[1]),
      nestedCount: subtree.size - 1,
      pinCount: [...subtree].reduce((n, id) => n + (intentById.get(id)?.pinCount ?? 0), 0),
    };
    // effectiveRatings/titleOf are pure helpers over rows/intents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deleteTarget, subtreeIds, activeIntents, rows, resolutions, intentById]);

  // ---- Middle column ------------------------------------------------------
  // Selection can outlive its target (intent archived, boundary resolved,
  // pending bucket drained after a rate run) — fall back to "All" instead of
  // pointing at an empty, unreachable group.
  useEffect(() => {
    const gone =
      (selection.kind === 'intent' && !activeIntents.some((i) => i.id === selection.id)) ||
      // A scope's bucket dies with the scope (archived set, or a type root that
      // is not loaded — the baseline never has them).
      (selection.kind === 'residue' &&
        !typeRoots.some((t) => t.id === selection.scopeId) &&
        !activeIntents.some((i) => i.id === selection.scopeId)) ||
      (selection.kind === 'pending' && untypedCount === 0);
    if (gone) {
      setSelection({ kind: 'type', typeKey: SCORE_QUERY_TYPES[0] });
    }
  }, [selection, activeIntents, untypedCount, typeRoots]);

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      const res = resolutions.get(r.messageId);
      if (!res) return false;
      switch (selection.kind) {
        case 'all':
          return true;
        case 'intent': {
          // A set browses its whole subtree: its own questions plus everything
          // its subsets took first.
          const ids = subtreeIds.get(selection.id) ?? [selection.id];
          return res.kind === 'matched' && ids.includes(res.intentId);
        }
        case 'type':
          return r.queryType === selection.typeKey;
        case 'residue': {
          // A type root's residue is what its chain left unclaimed; an intent's
          // is what it answers itself (its subsets are evaluated first).
          const root = typeRoots.find((t) => t.id === selection.scopeId);
          if (root) return res.kind === 'type_default' && r.queryType === root.type;
          return res.kind === 'matched' && res.intentId === selection.scopeId;
        }
        case 'pending':
          return res.kind === 'pending';
        case 'search':
          // A baseline saved filter: its cached clearly-in messageIds,
          // already intersected with the filter's type by the tree.
          return selection.ids.includes(r.messageId);
      }
    });
  }, [rows, resolutions, selection, subtreeIds, typeRoots]);

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

  /**
   * The question the New Intent chooser anchors its proposals on — the one in
   * view. Guarded on the row still being ON SCREEN: `selectedMessageId` is not
   * cleared when the left column moves, so without this a question left
   * selected in Planning would seed the proposals for a Drafting set.
   */
  const anchorRow = useMemo(
    () =>
      selectedRow && sortedRows.some((r) => r.messageId === selectedRow.messageId)
        ? selectedRow
        : null,
    [selectedRow, sortedRows]
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
    // v7: every routed question has an owner — a matched intent, or the TYPE
    // ROOT whose default rule answers it. Both keep a rule history, so both
    // get the version dropdown.
    if (res?.kind === 'matched') return res.intentId;
    if (res?.kind === 'type_default' && selectedRow?.queryType) {
      return typeRoots.find((t) => t.type === selectedRow.queryType)?.id ?? null;
    }
    return null;
  }, [selectedMessageId, resolutions, selectedRow, typeRoots]);
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
  // Also the scope a new intent created FROM this question is carved out of.
  const selectedOwner = selectedOwnerId !== null ? intentById.get(selectedOwnerId) ?? null : null;
  const responseResolved =
    selectedOwnerId === null || !selectedOwner?.rule || viewerVersions !== null;
  // The selected question's user bubble shows pasted Material as its verbatim
  // text (highlighted per kind) rather than the list's collapsed tags — this
  // pane is where the instructor READS the message. One control in the bubble
  // collapses them back. Passed to ChatMessages' renderUserContent override.
  const renderSelectedUser = () =>
    selectedRow?.dissection && selectedRow.dissection.materialKinds.length > 0 ? (
      <MaterialSegments
        text={selectedRow.queryText}
        dissection={selectedRow.dissection}
        defaultOpen
        toggleAll
      />
    ) : null;

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

  const selectionLabel = (() => {
    switch (selection.kind) {
      case 'all':
        return 'All questions';
      case 'intent':
        return titleOf(selection.id);
      case 'type':
        return `${QUERY_TYPE_LABELS[selection.typeKey]} questions`;
      case 'residue': {
        const root = typeRoots.find((t) => t.id === selection.scopeId);
        return root
          ? `${QUERY_TYPE_LABELS[root.type]} · Uncategorized`
          : `${titleOf(selection.scopeId)} · Uncategorized`;
      }
      case 'pending':
        return 'Not yet categorized';
      case 'search':
        return `Filter · ${selection.label}`;
    }
  })();

  // Viewing a past deploy → the read-only version board replaces everything.
  /**
   * Two things a set's owner needs to see, both invisible under first-match:
   *   shadowedBy — an EARLIER sibling in the same chain answers questions this
   *                set also matches, so they never reach it (§3.7).
   *   outsideParent — questions this set matches that its ENCLOSING sets do
   *                not. Containment means it can never win them; the fix is to
   *                widen the parent or move the set out.
   * Both are derived from the same walk the router does, so they can never
   * disagree with what actually happens.
   */
  const treeDiagnostics = useMemo(() => {
    const shadowed = new Map<number, { intentId: number; count: number }>();
    const outside = new Map<number, number>();
    for (const r of rows) {
      if (!r.queryType) continue;
      const chain = chains.get(r.queryType);
      if (!chain) continue;
      const eff = effectiveRatings(r);
      const winner = resolveRoute(chain, eff);
      const winnerId = winner.kind === 'matched' ? winner.intentId : null;
      for (const id of chain.order) {
        if (id === winnerId) continue;
        if (!isIncludedRating(eff.get(id))) continue; // it did not claim this one
        const blocked = (chain.ancestorsOf.get(id) ?? []).some(
          (a) => !isIncludedRating(eff.get(a))
        );
        if (blocked) {
          outside.set(id, (outside.get(id) ?? 0) + 1);
        } else if (winnerId !== null) {
          const prev = shadowed.get(id);
          if (prev) prev.count += 1;
          else shadowed.set(id, { intentId: winnerId, count: 1 });
        }
      }
    }
    return { shadowed, outside };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, chains]);
  const shadowedBy = treeDiagnostics.shadowed;

  /** One set in the left column's tree, then its subsets under it. */
  function renderTreeNode(
    intent: IntentSummary,
    type: ScoreQueryType,
    entry: { topLevel: IntentSummary[]; childrenOf: Map<number, IntentSummary[]> },
    depth: number
  ): React.ReactNode {
    const children = entry.childrenOf.get(intent.id) ?? [];
    const siblings = depth === 0 ? entry.topLevel : entry.childrenOf.get(intent.parentIntentId ?? -1) ?? [];
    const idx = siblings.findIndex((sib) => sib.id === intent.id);
    const active = selection.kind === 'intent' && selection.id === intent.id;
    const shadow = shadowedBy.get(intent.id);
    const outsideCount = treeDiagnostics.outside.get(intent.id) ?? 0;
    const own = counts.perIntent.get(intent.id) ?? 0;
    // The new set would land INSIDE this one — so the button renders here.
    const createsHere = newIntentScope?.parentIntentId === intent.id;
    // Just landed from the workbench: ring the saved intent so the eye finds
    // it in the refreshed chain (cleared by the board's flag timer).
    const flagged = flagIntent === intent.id;
    return (
      <div>
        <div
          ref={flagged ? flagRowRef : undefined}
          className={`group relative flex items-center gap-1 pl-3 pr-2 py-1 cursor-pointer transition-shadow ${
            flagged
              ? 'ring-2 ring-inset ring-emerald-400 bg-emerald-50'
              : active
                ? 'bg-[hsl(var(--muted))]'
                : 'hover:bg-[hsl(var(--muted))]/40'
          }`}
          onClick={() => setSelection({ kind: 'intent', id: intent.id })}
        >
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
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-sm truncate">{intent.title}</span>
              {shadow && (
                <SmallChip
                  className="bg-amber-50 text-amber-700 border-amber-200 shrink-0"
                  title={`“${titleOf(shadow.intentId)}” comes earlier in ${QUERY_TYPE_LABELS[type]} and answers ${shadow.count} question${shadow.count === 1 ? '' : 's'} this intent also matches. Narrow it, move this intent above it, or nest this intent inside it.`}
                >
                  <AlertTriangle className="w-3 h-3" /> {shadow.count}
                </SmallChip>
              )}
              {outsideCount > 0 && (
                <SmallChip
                  className="bg-sky-50 text-sky-700 border-sky-200 shrink-0"
                  title={`${outsideCount} question${outsideCount === 1 ? '' : 's'} this intent matches sit outside “${titleOf(intent.parentIntentId ?? 0)}”. A nested intent only answers what the intent around it answers, so these never reach it — widen the enclosing intent, or drag this one out of it.`}
                >
                  ↗ {outsideCount}
                </SmallChip>
              )}
            </div>
          </HoverReveal>
          {/* Row actions, right of the text: [up] [down] [delete]. Order is
              routing (the set above answers first), so the movers stay visible
              on the row you are working with (§3.7); delete opens the confirm
              that shows where this set's questions will fall. */}
          <span className="hidden group-hover:flex items-center gap-0.5 shrink-0">
            <button
              onClick={(e) => {
                e.stopPropagation();
                void moveIntent(intent.id, { beforeIntentId: siblings[idx - 1]?.id ?? null });
              }}
              disabled={idx <= 0 || placementBusy !== null}
              className="p-0.5 rounded disabled:opacity-30 hover:bg-[hsl(var(--muted))]"
              title="Answer earlier than the intent above"
            >
              <ChevronUp className="w-3 h-3" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                void moveIntent(intent.id, { beforeIntentId: siblings[idx + 2]?.id ?? null });
              }}
              disabled={idx < 0 || idx >= siblings.length - 1 || placementBusy !== null}
              className="p-0.5 rounded disabled:opacity-30 hover:bg-[hsl(var(--muted))]"
              title="Answer later than the intent below"
            >
              <ChevronDown className="w-3 h-3" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setDeleteTarget(intent);
              }}
              disabled={placementBusy !== null || boardRefreshing}
              className="p-0.5 rounded disabled:opacity-30 text-[hsl(var(--muted-foreground))] hover:bg-rose-50 hover:text-rose-600"
              title="Delete this intent — you’ll see where its questions go first"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </span>
          <div className="ml-auto flex items-center gap-0.5 shrink-0">
            <Badge n={subtreeCount(intent.id)} />
          </div>
        </div>

        {/* Everything INSIDE this set sits behind its own rule, one level in:
            its subsets, its own bucket, and — when this is the scope you have
            selected — the button that creates the next subset. The button's
            POSITION is what says where the new set lands; that is why it moves
            with the selection instead of sitting in a fixed slot. */}
        {renderBranch([
          ...children.map((child) => ({
            key: `i${child.id}`,
            node: renderTreeNode(child, type, entry, depth + 1),
          })),
          ...(children.length > 0
            ? [
                {
                  key: 'residue',
                  node: (
                    <button
                      onClick={() => setSelection({ kind: 'residue', scopeId: intent.id })}
                      className={`w-full text-left pl-3 pr-3 py-1 min-h-[28px] text-xs flex items-center justify-between gap-2 ${
                        selection.kind === 'residue' && selection.scopeId === intent.id
                          ? 'bg-[hsl(var(--muted))] font-medium'
                          : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]/40'
                      }`}
                      title={`Questions “${intent.title}” answers itself — the intents nested inside it take the rest.`}
                    >
                      <span className="truncate italic">Uncategorized</span>
                      <Badge n={own} />
                    </button>
                  ),
                },
              ]
            : []),
          ...(createsHere && newIntentScope
            ? [
                {
                  key: 'new',
                  node: (
                    <NewIntentRow
                      scope={newIntentScope}
                      onClick={() => openIntentChooser(newIntentScope, anchorRow)}
                    />
                  ),
                },
              ]
            : []),
        ])}
      </div>
    );
  }

  /** The prepared starter-set library — picking one of these clones its rating
   * rows server-side instead of rating the log again. */
  const templateOptions = useMemo(
    () =>
      intents
        .filter((i) => i.isTemplate && !i.archived)
        .map(({ id, title, definition }) => ({ id, title, definition })),
    [intents]
  );

  /** Definitions already registered as live intents. Offering a starter set
   * that duplicates one would only produce a set the board immediately flags as
   * shadowed, so the chooser shows those but will not create them. */
  const liveDefinitions = useMemo(
    () =>
      new Set(
        intents.filter((i) => !i.isTemplate && !i.archived).map((i) => i.definition.trim())
      ),
    [intents]
  );

  /**
   * Where a new set would land, read off the CURRENT selection. Creating from a
   * type section (or its Uncategorized bucket) makes a top-level set of that
   * type; creating while a set is selected carves a subset out of it. There is
   * no placement picker — the scope you are looking at is the answer.
   */
  const newIntentScope = useMemo((): {
    type: ScoreQueryType;
    parentIntentId: number | null;
    label: string;
    /** On the button itself: WHERE the set lands, in words. The button's spot
     * in the tree already says it, but position alone is easy to misread —
     * the text makes the placement explicit. */
    buttonLabel: string;
  } | null => {
    if (isBaseline) return null;
    const forScope = (scope: IntentSummary) =>
      scope.type
        ? {
            type: scope.type,
            parentIntentId: scope.id,
            label: `Create an intent inside “${scope.title}”`,
            buttonLabel: `New intent inside “${scope.title}”`,
          }
        : null;
    if (selection.kind === 'type') {
      return {
        type: selection.typeKey,
        parentIntentId: null,
        label: `Create an intent inside ${QUERY_TYPE_LABELS[selection.typeKey]}`,
        buttonLabel: `New intent in ${QUERY_TYPE_LABELS[selection.typeKey]}`,
      };
    }
    if (selection.kind === 'residue') {
      const root = typeRoots.find((t) => t.id === selection.scopeId);
      if (root) {
        return {
          type: root.type,
          parentIntentId: null,
          label: `Create an intent for the questions ${QUERY_TYPE_LABELS[root.type]} does not cover yet`,
          buttonLabel: `New intent in ${QUERY_TYPE_LABELS[root.type]}`,
        };
      }
      const scope = intentById.get(selection.scopeId);
      return scope ? forScope(scope) : null;
    }
    if (selection.kind === 'intent') {
      const scope = intentById.get(selection.id);
      return scope ? forScope(scope) : null;
    }
    return null;
  }, [selection, isBaseline, typeRoots, intentById]);

  /**
   * Every intent is created through the chooser — a blank form does not tell an
   * instructor what a good intent looks like, and the taxonomy's starter sets
   * are invisible from one. The placement is settled BEFORE it opens (by where
   * creation was invoked from), so all the chooser decides is the seed.
   */
  function openIntentChooser(
    scope: { type: ScoreQueryType; parentIntentId: number | null },
    anchor: ScoreQueryRow | null
  ) {
    setNewIntentRequest({ scope, anchorRow: anchor });
  }

  function openNewIntent(
    scope: { type: ScoreQueryType; parentIntentId: number | null },
    seed?: { title?: string; definition?: string; fromTemplateId?: number }
  ) {
    setNewIntentSeed({ ...seed, type: scope.type, parentIntentId: scope.parentIntentId });
    setNewIntentOpen(true);
  }

  // The enclosing-intent chain of the open workbench's placement, nearest
  // first. For an EDIT that is the edited intent's ancestors; for a CREATE the
  // seed's parent IS the first enclosing intent. Type roots are not in
  // intentById, so the walk stops at the type boundary on its own.
  const workbenchScopeAncestors = useMemo(() => {
    const start = editIntent ? editIntent.parentIntentId : newIntentSeed?.parentIntentId ?? null;
    const out: number[] = [];
    let cur = start ?? null;
    for (let guard = 0; cur !== null && guard < 100; guard++) {
      const node = intentById.get(cur);
      if (!node) break;
      out.push(node.id);
      cur = node.parentIntentId;
    }
    return out;
  }, [editIntent, newIntentSeed, intentById]);

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
      {(runError || (running && runProgress) || boardRefreshing) && (
        <div className="shrink-0 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-1.5 flex items-center gap-3 text-xs">
          {boardRefreshing && (
            <span className="flex items-center gap-1.5 text-[hsl(var(--muted-foreground))]">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Updating the board…
            </span>
          )}
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
          seedRule={seedRuleFor(reviseTarget.intent)}
          isNirvana={isNirvana}
          deployedRule={deployedRuleByIntent.get(reviseTarget.intent.id) ?? null}
          viewVersion={reviseTarget.viewVersion}
          // The questions this rule ANSWERS, resolved with the real chain — not
          // the ones it merely matches. Under first-match an intent can match a
          // question an earlier sibling or one of its own subsets takes first,
          // and tuning a rule against a response no student receives is exactly
          // the confusion shadowing exists to name.
          scopeMessageIds={rows
            .filter((r) => {
              const res = resolutions.get(r.messageId);
              return res?.kind === 'matched' && res.intentId === reviseTarget.intent.id;
            })
            .map((r) => r.messageId)}
          onClose={(changed) => {
            const savedIntentId = reviseTarget.intent.id;
            setReviseTarget(null);
            if (changed) {
              setViewerVersionsNonce((n) => n + 1); // refetch the viewer dropdown
              // Visible refresh (status strip + ring on the revised intent's
              // row) — a bare refresh leaves the stale board unchanged for
              // seconds with no trace of the save.
              setFlagIntent(savedIntentId);
              startBoardRefresh(() => router.refresh());
            }
          }}
        />
      ) : isBaseline && searchMode ? (
        <FilterWorkbench
          key={searchMode.kind === 'saved' ? `saved-${searchMode.searchId}` : `new-${searchMode.definition}`}
          assignmentId={assignmentId}
          rows={rows}
          isNirvana={isNirvana}
          mode={searchMode}
          typeLabel={searchMode.type ? QUERY_TYPE_LABELS[searchMode.type] : null}
          typeDot={searchMode.type ? TYPE_SECTION_DOT[searchMode.type] : null}
          onExit={() => {
            setSearchMode(null);
            void reloadSearches();
          }}
        />
      ) : isBaseline && promptReviseTarget && promptHolder ? (
        // Baseline Revise = the SCORE RuleWorkbench mounted on the hidden
        // prompt-holder intent (variant='prompt' hides the intent-only
        // affordances and keeps the hand-built review set), so version history
        // (v1 seed, minors, checkout, revert) is reused verbatim.
        <RuleWorkbench
          key={`prompt-revise-${promptReviseTarget.messageId}`}
          assignmentId={assignmentId}
          rows={rows}
          row={promptReviseTarget}
          intent={promptHolder}
          seedRule={basePrompt}
          isNirvana={isNirvana}
          deployedRule={baseline?.deployedPrompt ?? null}
          variant="prompt"
          onClose={(changed) => {
            setPromptReviseTarget(null);
            if (changed) {
              void syncPromptFromHolder();
              startBoardRefresh(() => router.refresh());
            }
          }}
        />
      ) : !isBaseline && rootReviseTarget ? (
        /* TYPE ROOT rule — no AUTHORED When (it is the type's final else), so
           the condition is shown read-only via `fixedWhen`. It is still a SCORE
           surface with a real question set (what the chain leaves unclaimed),
           so it takes the SCORE interaction model: "Other questions" over that
           set, with pull-in. SCORE-only by an explicit gate — see the matching
           note on the type detail header. */
        <RuleWorkbench
          key={`root-${rootReviseTarget.root.id}-${rootReviseTarget.row.messageId}`}
          assignmentId={assignmentId}
          rows={rows}
          row={rootReviseTarget.row}
          intent={{
            id: rootReviseTarget.root.id,
            title: rootReviseTarget.root.title,
            definition: '',
            rule: rootReviseTarget.root.rule,
            archived: false,
            isTemplate: false,
            pinCount: 0,
            includedCount: 0,
            excludedCount: 0,
            type: rootReviseTarget.root.type,
            parentIntentId: null,
            position: null,
          }}
          seedRule={basePrompt}
          isNirvana={isNirvana}
          deployedRule={
            deployedRules?.find((d) => d.id === rootReviseTarget.root.id)?.rule ?? null
          }
          variant="type-root"
          scopeMessageIds={rows
            .filter(
              (r) =>
                r.queryType === rootReviseTarget.root.type &&
                resolutions.get(r.messageId)?.kind === 'type_default'
            )
            .map((r) => r.messageId)}
          scopeLabel={QUERY_TYPE_LABELS[rootReviseTarget.root.type]}
          fixedWhen={typeRootWhen(rootReviseTarget.root.type)}
          onClose={(changed) => {
            setRootReviseTarget(null);
            if (changed) {
              // The dropdown now covers type_default questions too (owner =
              // the type root) — refetch it, and refresh visibly.
              setViewerVersionsNonce((n) => n + 1);
              startBoardRefresh(() => router.refresh());
            }
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
          scopeAncestorIds={workbenchScopeAncestors}
          scopeLabel={
            workbenchScopeAncestors.length > 0
              ? intentById.get(workbenchScopeAncestors[0])?.title ?? null
              : null
          }
          onExit={(savedIntentId) => {
            setNewIntentOpen(false);
            setNewIntentSeed(null);
            setEditIntent(null);
            setFlagIntent(savedIntentId ?? null);
            startBoardRefresh(() => router.refresh());
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
            Rules panel is pinned at the top and only the Filters tree below
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

          {/* FILTERS (baseline only). The same four type sections SCORE's left
              column opens with — same classifier, same counts — with this
              participant's saved filters nested under them. No global "All"
              (SCORE has none either) and no global "+ New": creating is
              invoked from a type, the same way SCORE's "+ New intent" is, so
              both conditions reach the chooser through a scope. */}
          {isBaseline && (
            <div className="shrink-0 sticky top-0 z-10 bg-[hsl(var(--card))]">
              <div className="px-3 pt-2 pb-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                  Filters
                </span>
              </div>
            </div>
          )}
          {isBaseline && (
            /* Clicking a type or a filter only FILTERS the question list; the
               workbench is reached by creating or by Edit Filter. This list is
               the ONLY scrolling region of the baseline left column. */
            <div className="flex-1 min-h-0 overflow-y-auto pb-1">
              <BaselineFilterTree
                rows={rows}
                filters={savedSearches}
                untypedCount={untypedCount}
                selection={selection}
                setSelection={setSelection}
                onNewFilter={setNewFilterRequest}
              />
            </div>
          )}
          {/* TYPE SECTIONS (score) — the four fixed query types, each a set
              whose own rule answers whatever its subsets leave unclaimed. The
              tree under a section IS the evaluation order: subsets are checked
              before the set they were carved from, siblings top to bottom. */}
          {!isBaseline && (
            <div className="pb-1">
              {untypedCount > 0 && (
                <div
                  className={`flex items-center gap-1 border-b border-[hsl(var(--border))] text-xs ${
                    selection.kind === 'pending' ? 'bg-amber-100' : 'bg-amber-50/70'
                  }`}
                >
                  <button
                    onClick={() => setSelection({ kind: 'pending' })}
                    className="flex-1 min-w-0 text-left pl-3 py-1.5 flex items-center justify-between gap-2 text-amber-800 hover:text-amber-900"
                    title="These questions have no query type yet, so no rule can be chosen for them."
                  >
                    <span className="truncate">Not yet categorized</span>
                    <Badge n={untypedCount} />
                  </button>
                  <button
                    onClick={() => void runPending()}
                    disabled={running || !openaiConfigured}
                    className="shrink-0 inline-flex items-center gap-1 px-2 py-1.5 text-amber-800 hover:text-amber-900 disabled:opacity-50"
                    title={
                      openaiConfigured
                        ? 'Categorize these questions (and rate anything else pending)'
                        : 'OPENAI_API_KEY is not configured'
                    }
                  >
                    {running ? <RefreshCw className="w-3 h-3 animate-spin" /> : null} Run
                  </button>
                </div>
              )}
              {/* An active set with no query type sits in no chain: it can
                  never answer anything and has no section to live in. That can
                  only happen to a row created before the type layer, but it
                  must not be INVISIBLE — surface it so it can be opened and
                  given a home. */}
              {activeIntents.filter((i) => !i.type).length > 0 && (
                <div className="border-b border-[hsl(var(--border))] bg-rose-50/70 px-3 py-1.5">
                  <p className="text-[11px] font-semibold text-rose-800">Not in any type</p>
                  <p className="text-[10px] text-rose-700/80">
                    These answer nothing until they are given one. Open and save to place them.
                  </p>
                  {activeIntents
                    .filter((i) => !i.type)
                    .map((i) => (
                      <button
                        key={i.id}
                        onClick={() => setEditIntent(i)}
                        className="mt-1 w-full text-left text-xs text-rose-900 underline decoration-rose-300 hover:decoration-rose-600 truncate"
                      >
                        {i.title}
                      </button>
                    ))}
                </div>
              )}
              {typeRoots.map((root) => {
                const entry = tree.byType.get(root.type)!;
                const residue = counts.residueByType.get(root.type) ?? 0;
                const total =
                  residue + entry.topLevel.reduce((n, i) => n + subtreeCount(i.id), 0);
                const typeActive = selection.kind === 'type' && selection.typeKey === root.type;
                // A new top-level set of this type — the button belongs at the
                // top level of this section's tree, not in a fixed slot.
                const createsAtTypeLevel =
                  newIntentScope?.type === root.type && newIntentScope.parentIntentId === null;
                return (
                  <div key={root.id} className="border-b border-[hsl(var(--border))]">
                    {/* Section header = the type root. Clicking browses every
                        query of the type; Edit rule opens the rule this type
                        answers with when nothing else claims a question. */}
                    <div
                      className={`group flex items-center gap-1.5 px-3 py-1.5 cursor-pointer ${
                        typeActive ? 'bg-[hsl(var(--muted))]' : 'hover:bg-[hsl(var(--muted))]/40'
                      }`}
                      onClick={() => setSelection({ kind: 'type', typeKey: root.type })}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${TYPE_SECTION_DOT[root.type]}`} />
                      <span className="text-xs font-semibold uppercase tracking-wide truncate flex-1">
                        {QUERY_TYPE_LABELS[root.type]}
                      </span>
                      <Badge n={total} />
                    </div>

                    <div className="pb-1">
                      {/* Everything inside the type sits one level in, behind
                          its own rule — the same shape as any set. */}
                      {renderBranch([
                        ...entry.topLevel.map((intent) => ({
                          key: `i${intent.id}`,
                          node: renderTreeNode(intent, root.type, entry, 0),
                        })),
                        // The type's own bucket — only worth a row once a set
                        // exists to take questions away from it. With none, the
                        // section header already means the same thing.
                        ...(entry.topLevel.length > 0
                          ? [
                              {
                                key: 'residue',
                                node: (
                                  <button
                                    onClick={() => setSelection({ kind: 'residue', scopeId: root.id })}
                                    className={`w-full text-left pl-3 pr-3 py-1 min-h-[28px] text-xs flex items-center justify-between gap-2 ${
                                      selection.kind === 'residue' && selection.scopeId === root.id
                                        ? 'bg-[hsl(var(--muted))] font-medium'
                                        : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]/40'
                                    }`}
                                    title={`Questions no intent in ${QUERY_TYPE_LABELS[root.type]} claims — answered by the type's own rule.`}
                                  >
                                    <span className="truncate italic">Uncategorized</span>
                                    <Badge n={residue} />
                                  </button>
                                ),
                              },
                            ]
                          : []),
                        ...(createsAtTypeLevel && newIntentScope
                          ? [
                              {
                                key: 'new',
                                node: (
                                  <NewIntentRow
                                    scope={newIntentScope}
                                    onClick={() => openIntentChooser(newIntentScope, anchorRow)}
                                  />
                                ),
                              },
                            ]
                          : []),
                      ])}
                    </div>
                  </div>
                );
              })}
              {typeRoots.length === 0 && (
                <p className="px-3 py-3 text-xs text-[hsl(var(--muted-foreground))]">
                  Preparing the query types…
                </p>
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
              // Rule editing opens on a question this rule actually ANSWERS —
              // resolved by the chain, the same way the type root's anchor is
              // picked below. Reading raw membership here (clearly_in + pins)
              // could anchor the whole session on a question an earlier sibling
              // or one of this intent's own subsets takes first, i.e. on a
              // response no student ever receives.
              const anchor = rows.find((r) => {
                const res = resolutions.get(r.messageId);
                return res?.kind === 'matched' && res.intentId === intent.id;
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
                    <RuleOrigin rule={intent.rule} enclosing={enclosingRule(intent)} />
                    <HeaderAction
                      onClick={() => anchor && setReviseTarget({ row: anchor, intent, viewVersion: null })}
                      disabled={!anchor}
                      title={
                        anchor
                          ? 'Edit rule — how the chatbot responds to these questions'
                          : // Matching is not enough: a set whose matches are
                            // all taken by earlier sets or by its own subsets
                            // answers nothing, and there is no response to tune.
                            'Edit rule — this intent has to answer at least one question first'
                      }
                      icon={<Pencil className="w-3 h-3" />}
                    >
                      Edit Rule
                    </HeaderAction>
                  </div>
                </div>
              );
            }
            if (!isBaseline && (selection.kind === 'type' || selection.kind === 'residue')) {
              // The TYPE ROOT's rule — what answers every question here that no
              // set claims. Shown like an intent's Then row so a saved root
              // rule is visible on the board at all (it used to be nowhere).
              // The !isBaseline gate is explicit rather than relying on the
              // baseline having no type roots: the baseline now rests on a
              // kind:'type' selection by default, and "a rule attached to a
              // type, editable" is exactly the mechanism the ablation removes.
              const root =
                selection.kind === 'type'
                  ? typeRoots.find((t) => t.type === selection.typeKey)
                  : typeRoots.find((t) => t.id === selection.scopeId);
              if (!root) return null;
              // Revise opens on a question this rule actually answers.
              const anchor =
                sortedRows.find(
                  (r) =>
                    r.queryType === root.type &&
                    resolutions.get(r.messageId)?.kind === 'type_default'
                ) ?? null;
              const when = typeRootWhen(root.type);
              return (
                <div className="px-3 py-2 space-y-1.5 border-t border-[hsl(var(--border))] bg-[hsl(var(--muted))]/20">
                  {/* Same When/Then pair a set gets. That it is read-only is
                      said by the ABSENCE of the Edit Intent action a set's When
                      carries — not by a badge, which only labels the row without
                      telling anyone what to do about it. The why is on hover. */}
                  <div className="flex items-start gap-2" title={when.note}>
                    <DetailLabel>When</DetailLabel>
                    <ClampedText text={`A student ${when.summary}`} muted />
                  </div>
                  <div className="flex items-start gap-2">
                    <DetailLabel>Then</DetailLabel>
                    {root.rule?.trim() ? (
                      <ClampedText text={root.rule} />
                    ) : (
                      <span className="min-w-0 flex-1 text-[11px] italic text-[hsl(var(--muted-foreground))]">
                        No rule yet — these questions get no system prompt
                      </span>
                    )}
                    {/* A type root's scope is the assignment default — nothing
                        encloses it but that. */}
                    <RuleOrigin
                      rule={root.rule}
                      enclosing={{ rule: basePrompt, scope: DEFAULT_PROMPT_SCOPE }}
                    />
                    <HeaderAction
                      onClick={() => anchor && setRootReviseTarget({ row: anchor, root })}
                      disabled={!anchor}
                      title={
                        anchor
                          ? `Edit the ${QUERY_TYPE_LABELS[root.type]} rule — how unclaimed questions here are answered`
                          : 'Every question here is claimed by a set — edit those rules instead'
                      }
                      icon={<Pencil className="w-3 h-3" />}
                    >
                      Edit Rule
                    </HeaderAction>
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
                    onClick={() =>
                      setSearchMode({
                        kind: 'saved',
                        searchId: saved.id,
                        name: saved.name,
                        definition: saved.description,
                        type: saved.type,
                      })
                    }
                    title="Edit this filter — change what it collects"
                    icon={<Pencil className="w-3 h-3" />}
                  >
                    Edit Filter
                  </HeaderAction>
                </div>
              );
            }
            return null;
          })()}
          </div>
          {sortedRows.length === 0 ? (
            <p className="p-6 text-sm text-[hsl(var(--muted-foreground))]">
              {/* The prompt to go make something is SCORE's only: in baseline
                  an empty result is an empty result, and telling a participant
                  to "create an intent" would hand them the other condition's
                  vocabulary. */}
              {selection.kind === 'pending' || rows.length === 0
                ? 'No questions here.'
                : !isBaseline && activeIntents.length === 0
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
                          res?.kind === 'matched' &&
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
                    // v7: every question is answered by SOMETHING — a matching
                    // intent, or its type's own rule. So Revise always has a
                    // target and the old "no owning intent" disabled state is
                    // gone; the type root is just the outermost owner.
                    const owner =
                      res?.kind === 'matched' ? intentById.get(res.intentId) ?? null : null;
                    const root =
                      !owner && selectedRow.queryType
                        ? typeRoots.find((t) => t.type === selectedRow.queryType) ?? null
                        : null;
                    if (!owner && !root) return null;
                    return (
                      <button
                        onClick={() =>
                          owner
                            ? setReviseTarget({
                                row: selectedRow,
                                intent: owner,
                                // Viewing a version → revise builds on THAT
                                // version (its rule + the response shown).
                                viewVersion: viewedVersion,
                              })
                            : root && setRootReviseTarget({ row: selectedRow, root })
                        }
                        className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[hsl(var(--border))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]"
                        title={
                          owner
                            ? viewedVersion
                              ? `Revise the rule from v${viewedVersion.major ?? viewedVersion.versionNo}${viewedVersion.name ? ` · ${viewedVersion.name}` : ''}`
                              : `Revise the rule of "${owner.title}" from this question`
                            : `No intent claims this question — revise the ${QUERY_TYPE_LABELS[root!.type]} rule that answers it`
                        }
                      >
                        Revise rule <ChevronRight className="w-3.5 h-3.5" />
                      </button>
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
                  expandMaterials
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

      {/* THE NEW INTENT CHOOSER — the one door to creating an intent, from the
          tree (placement = where the button sits) or from a question
          (placement = whatever answers it today). It settles only the SEED;
          the placement was decided before it opened (§3.2). */}
      {newIntentRequest && (() => {
        const parentId = newIntentRequest.scope.parentIntentId;
        const parent = parentId !== null ? intentById.get(parentId) ?? null : null;
        return (
          <NewIntentModal
            assignmentId={assignmentId}
            scope={newIntentRequest.scope}
            anchorRow={newIntentRequest.anchorRow}
            currentIntent={parent ? { id: parent.id, title: parent.title } : null}
            jelsonSuggestions={jelsonSuggestions}
            templates={templateOptions}
            liveDefinitions={liveDefinitions}
            openaiConfigured={openaiConfigured}
            typeLabel={QUERY_TYPE_LABELS[newIntentRequest.scope.type]}
            typeDot={TYPE_SECTION_DOT[newIntentRequest.scope.type]}
            onCancel={() => setNewIntentRequest(null)}
            onPick={(seed) => {
              setNewIntentRequest(null);
              openNewIntent(newIntentRequest.scope, seed);
            }}
          />
        );
      })()}

      {/* THE NEW FILTER CHOOSER (baseline) — the same dialog, minus the part
          about claiming. The type it was opened from is where the filter will
          LIVE (list placement + which questions it shows), never what it owns. */}
      {newFilterRequest && (
        <NewFilterModal
          assignmentId={assignmentId}
          scopeType={newFilterRequest}
          anchorRow={anchorRow}
          jelsonSuggestions={jelsonSuggestions}
          templates={templateOptions}
          savedDescriptions={savedDescriptions}
          openaiConfigured={openaiConfigured}
          typeLabel={QUERY_TYPE_LABELS[newFilterRequest]}
          typeDot={TYPE_SECTION_DOT[newFilterRequest]}
          onCancel={() => setNewFilterRequest(null)}
          onPick={(seed) => {
            setNewFilterRequest(null);
            // fromTemplateId is deliberately dropped: SCORE clones the
            // template's ratings into a new intent, while a filter has nothing
            // to clone into — the probe finds the same rows already cached
            // under this description's hash.
            setSearchMode({
              kind: 'new',
              name: seed.title,
              definition: seed.definition,
              type: newFilterRequest,
            });
          }}
        />
      )}

      {/* DELETE CONFIRM — direct, irreversible; the modal's job is to show
          where this set's questions FALL once its rule stops answering them
          (recomputed with the real chain compiler, not estimated). */}
      {deleteTarget && deletePreview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !deleteBusy && setDeleteTarget(null)}
        >
          <div
            className="w-full max-w-md rounded-lg bg-[hsl(var(--background))] border border-[hsl(var(--border))] shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-[hsl(var(--border))] flex items-center gap-2 text-red-600">
              <AlertTriangle className="w-5 h-5" />
              <h2 className="text-sm font-semibold">Delete “{deleteTarget.title}”?</h2>
            </div>
            <div className="px-5 py-4 space-y-3 text-sm text-[hsl(var(--foreground))]">
              {deletePreview.nestedCount > 0 && (
                <p>
                  The{' '}
                  <span className="font-semibold">
                    {deletePreview.nestedCount} intent{deletePreview.nestedCount === 1 ? '' : 's'} nested
                    inside it
                  </span>{' '}
                  {deletePreview.nestedCount === 1 ? 'is' : 'are'} deleted with it — a nested intent
                  only answers within this one.
                </p>
              )}
              {deletePreview.total > 0 ? (
                <div className="rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40 px-3 py-2">
                  <p className="mb-1 font-medium">
                    {deletePreview.total} question{deletePreview.total === 1 ? '' : 's'} this intent
                    currently answers will be answered by:
                  </p>
                  <ul className="list-disc pl-4 space-y-0.5 text-[hsl(var(--muted-foreground))]">
                    {deletePreview.dests.map(([label, n]) => (
                      <li key={label}>
                        {label} — {n} question{n === 1 ? '' : 's'}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-[hsl(var(--muted-foreground))]">
                  No question currently routes here — deleting it changes nothing for students.
                </p>
              )}
              <p className="text-xs text-[hsl(var(--muted-foreground))]">
                This <span className="font-semibold">cannot be undone</span> — this intent’s rule, its
                ratings, your in/out labels
                {deletePreview.pinCount > 0 ? ` (${deletePreview.pinCount})` : ''} and its version
                history are erased.
              </p>
            </div>
            <div className="px-5 py-3 border-t border-[hsl(var(--border))] flex items-center justify-end gap-2">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleteBusy}
                className="px-3 py-1.5 text-xs rounded border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                autoFocus
                onClick={deleteIntent}
                disabled={deleteBusy}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {deleteBusy ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
