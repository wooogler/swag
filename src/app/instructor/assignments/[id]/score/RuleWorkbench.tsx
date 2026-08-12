'use client';

/**
 * SCORE v6 — the inline rule workbench (replaces the old ReviseModal dialog).
 *
 *   LEFT   WHEN (read-only) · THEN — the rule in an always-editable textbox ·
 *          the rule-version history underneath (accordion, like the intent
 *          workbench: majors v1, v2 …; simulated minors v1.1, v1.2 …)
 *   MIDDLE the VIEWED version's Q → response for the active question, rendered
 *          with the student-facing chat component
 *   RIGHT  a Cursor-style feedback panel: the conversation with the revision
 *          agent, input pinned at the bottom
 *
 * Version model (mirrors the intent workbench so the two feel the same):
 *  - v1 is auto-seeded on first open: the intent's current rule — the prompt
 *    it started from, so labelled "Original" — with the anchor's DELIVERED
 *    response as its response. The original is just v1; no separate switcher.
 *  - EVERY simulation (direct edit Preview / feedback / rewrite) records a
 *    MINOR version with its regenerated response — costly LLM output never
 *    vanishes, and any step can be checked out by clicking it.
 *  - Save records a MAJOR version and reflects the rule onto the live intent.
 *  - Checkout an older step → "Revert to vX" makes it live and deletes the
 *    later steps (git-reset, confirmed) — clicking the newest returns to it.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUp,
  Eye,
  HelpCircle,
  Loader2,
  Maximize2,
  Minimize2,
  Pencil,
  Quote,
  RotateCcw,
  Save as SaveIcon,
  Sparkles,
  Wand2,
  X,
} from 'lucide-react';
import type { IntentSummary, ScoreQueryRow } from './IntentBoard';
import { MaterialSegments } from './materials';
import { ConversationThread } from './conversation';
import { WorkbenchTopBar } from './workbench-shared';
import ChatMessages from '@/components/chat/ChatMessages';
import { seedRuleVersionName } from '@/lib/score/intents';
import RuleApplyPreview from './RuleApplyPreview';
import ProposalPreviewModal, { type ProposalVariant } from './ProposalPreviewModal';
import { RuleDiff } from './rule-diff';

type RuleSource = 'direct' | 'feedback' | 'rewrite' | 'manual' | 'seed';

/** One saved rule version (score_rule_versions) — its own axis, separate from
 * the intent config-version timeline. */
interface RuleVersion {
  id: number;
  versionNo: number;
  name: string | null;
  rule: string | null;
  updatedResponse: string | null;
  anchorMessageId: number | null;
  source: RuleSource;
  note: string | null;
  /** The instructor input that produced this step, verbatim — the user half of
   * the reconstructed timeline. */
  instruction: string | null;
  minor: boolean;
  major: number;
  minorNo: number | null;
  createdAt: string;
}

/**
 * One entry of the feedback TIMELINE — the workbench's single history. Session
 * exchanges append live; on reopen the whole thing is RECONSTRUCTED from the
 * persisted rule versions (each step stores the instruction that made it), so
 * chat and version history are one axis, not two.
 */
interface ChatEntry {
  id: number;
  /** 'event' = a milestone row (the v1 baseline, a Save), rendered as a
   * divider rather than a bubble. */
  role: 'user' | 'agent' | 'event';
  text: string;
  /** Agent entries: the proposed rule's short name. */
  name?: string;
  /** The rule text this exchange produced (agent proposals) — shown inline so
   * the feedback history reads as a self-contained changelog. */
  rule?: string | null;
  /** The rule this exchange STARTED from — the diff's left side. */
  baseRule?: string | null;
  /** The recorded step this exchange produced — chip checks it out. */
  versionNo?: number;
}

/**
 * The timeline as the persisted versions tell it (ascending): the seed and
 * each Save as event rows; each minor as the instruction that asked for it
 * plus (for agent steps) the proposal card that answered. Reverted steps are
 * gone from `list`, exactly as the live git-reset semantics delete them.
 */
function reconstructChat(list: RuleVersion[]): Omit<ChatEntry, 'id'>[] {
  const entries: Omit<ChatEntry, 'id'>[] = [];
  let prevRule: string | null = null;
  for (const v of [...list].reverse()) {
    // list arrives newest-first
    if (v.source === 'seed') {
      // The seed carries its rule block too — where this rule began is part
      // of the story, and the block is the checkout target for v1.
      entries.push({
        role: 'event',
        text: v.name ? `Starting rule — ${v.name}` : 'Starting rule',
        versionNo: v.versionNo,
        rule: v.rule,
        baseRule: null,
      });
    } else if (!v.minor) {
      entries.push({
        role: 'event',
        text: `Applied${v.name ? ` · ${v.name}` : ''}`,
        versionNo: v.versionNo,
      });
    } else {
      entries.push({
        role: 'user',
        text:
          v.instruction?.trim() ||
          (v.source === 'direct'
            ? 'Edited the rule directly.'
            : v.source === 'rewrite'
              ? 'Rewrote the response — infer the rule change.'
              : 'Feedback on the response.'),
        // Direct edits have no agent card — their rule block hangs off the
        // user bubble instead.
        ...(v.source === 'direct' ? { versionNo: v.versionNo, rule: v.rule, baseRule: prevRule } : {}),
      });
      if (v.source !== 'direct') {
        entries.push({
          role: 'agent',
          name: v.name ?? 'Revised rule',
          text: v.note ?? '',
          rule: v.rule,
          baseRule: prevRule,
          versionNo: v.versionNo,
        });
      }
    }
    prevRule = v.rule;
  }
  return entries;
}

/** "v2" for majors, "v2.3" for simulated minors. */
function versionLabel(v: RuleVersion): string {
  return v.minor ? `v${v.major}.${v.minorNo}` : `v${v.major}`;
}

/**
 * Wraps the response pane and owns the span-quote affordance.
 *
 * ISOLATED ON PURPOSE — this is what makes the selection survive. The button's
 * state lives HERE, so showing it re-renders only this layer; `children` keeps
 * the element reference the workbench last handed down, and React bails out of
 * re-rendering that subtree entirely. Holding the state in the workbench
 * instead re-rendered ChatMessages, whose ReactMarkdown `components` are
 * defined inline (new function identities every render), so the markdown
 * subtree remounted and its DOM — with the browser's selection on it — was
 * replaced. The highlight vanished at the very moment the button appeared,
 * leaving nothing to check the quote against.
 */
function QuoteSelectionLayer({
  disabled,
  onQuote,
  children,
}: {
  disabled: boolean;
  onQuote: (text: string) => void;
  children: React.ReactNode;
}) {
  const [sel, setSel] = useState<{ text: string; x: number; y: number } | null>(null);

  // The button lives exactly as long as its selection: collapsing it anywhere
  // (click, Esc, a new drag elsewhere) dismisses the button too.
  useEffect(() => {
    function onSelectionChange() {
      const s = window.getSelection();
      if (!s || s.isCollapsed) setSel(null);
    }
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, []);

  function handleMouseUp() {
    if (disabled) {
      setSel(null);
      return;
    }
    const s = window.getSelection();
    const text = s?.toString().replace(/\s+/g, ' ').trim() ?? '';
    if (!s || s.isCollapsed || text.length < 3) {
      setSel(null);
      return;
    }
    const rect = s.getRangeAt(0).getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      setSel(null);
      return;
    }
    setSel({
      text,
      x: Math.min(Math.max(8, rect.left), window.innerWidth - 190),
      y: Math.max(8, rect.top - 34),
    });
  }

  return (
    <div
      className="flex-1 min-h-0 overflow-y-auto"
      // Scrolling would strand the fixed-position button, so it dismisses.
      onMouseUp={handleMouseUp}
      onScroll={() => setSel(null)}
    >
      {children}
      {/* onMouseDown preventDefault keeps the selection alive through the click. */}
      {sel && !disabled && (
        <button
          style={{ position: 'fixed', top: sel.y, left: sel.x }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onQuote(sel.text);
            setSel(null);
          }}
          title="Insert this part of the response into the feedback box"
          className="z-[70] inline-flex items-center gap-1 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-2 py-1 text-xs font-medium text-[hsl(var(--foreground))] shadow-md hover:bg-[hsl(var(--muted))]"
        >
          <Quote className="w-3 h-3 text-[hsl(var(--primary))]" /> Quote in feedback
        </button>
      )}
    </div>
  );
}

/**
 * A step's rule in the timeline: version-labelled, and CLICKABLE — clicking
 * the block checks that step out (the block IS the version navigation; the
 * old separate v1.1 chips read as decoration). Shows the DIFF against the
 * step it revised (what changed is the point), full text a toggle away; a
 * step with no predecessor (the seed, or a step on an empty rule) shows the
 * plain text — an all-green diff says nothing.
 */
function ChatRuleBlock({
  rule,
  baseRule,
  label,
  exists = true,
  active = false,
  onOpen,
}: {
  rule: string | null;
  baseRule: string | null;
  /** "v1" / "v2.3" — shown in the block's header strip. */
  label?: string;
  /** False when a revert deleted this step — the block renders inert. */
  exists?: boolean;
  /** This step is the one checked out right now. */
  active?: boolean;
  onOpen?: () => void;
}) {
  const [full, setFull] = useState(false);
  const clickable = !!onOpen && exists;
  const diffable = rule !== null && baseRule !== null;
  return (
    <div
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? onOpen : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              onOpen?.();
            }
          : undefined
      }
      title={
        !exists
          ? 'This step was deleted by a revert'
          : clickable
            ? 'View this step — its rule and response load in place'
            : undefined
      }
      className={`mt-1 rounded border ${
        active
          ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5'
          : 'border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30'
      } ${clickable ? 'cursor-pointer hover:border-[hsl(var(--primary))]/60' : ''} ${!exists ? 'opacity-60' : ''}`}
    >
      {label && (
        <div className="flex items-center justify-between gap-2 border-b border-[hsl(var(--border))]/60 px-2 py-1">
          <span
            className={`font-mono text-[10px] font-semibold ${
              active ? 'text-[hsl(var(--primary))]' : 'text-[hsl(var(--muted-foreground))]'
            }`}
          >
            {label}
            {!exists && <span className="ml-1 font-sans line-through">removed</span>}
            {active && <span className="ml-1 rounded bg-[hsl(var(--primary))]/10 px-1 font-sans">viewing</span>}
          </span>
          {diffable && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setFull((v) => !v);
              }}
              className="text-[10px] font-medium text-[hsl(var(--primary))] hover:underline"
            >
              {full ? 'Show what changed' : 'Show full text'}
            </button>
          )}
        </div>
      )}
      <div className="max-h-40 overflow-y-auto p-2 text-xs leading-relaxed">
        {rule === null ? (
          <span className="italic text-[hsl(var(--foreground))]">(no rule yet)</span>
        ) : !diffable || full ? (
          <span className="whitespace-pre-wrap text-[hsl(var(--foreground))]">{rule}</span>
        ) : (
          <RuleDiff before={baseRule} after={rule} />
        )}
      </div>
    </div>
  );
}


/** Batch cap of the preview/apply endpoints (MAX_PREVIEW_MESSAGES mirror). */
const APPLY_BATCH = 6;

/** The three rules this one workbench edits — see the `variant` prop. */
export type RuleTarget = 'intent' | 'type-root' | 'prompt';

interface RuleWorkbenchProps {
  assignmentId: string;
  /** Every question row — conversation threads and the intent's question list. */
  rows: ScoreQueryRow[];
  /** Every turn of the threads the rows belong to. Lists narrow to the review
   * set; a conversation must still be readable in full. Defaults to rows. */
  contextRows?: ScoreQueryRow[];

  row: ScoreQueryRow; // anchor question (assigned to `intent`)
  intent: IntentSummary;
  /** The assignment's default prompt — the text a fresh intent's rule is
   * seeded with. Used only to tell "still the starting prompt" from "edited"
   * when seeding v1; never rendered. */
  /** The rule this target STARTED from — what "untouched" is measured against
   * when seeding v1. v7: a set is seeded by COPYING the rule of the scope that
   * encloses it (§3.5), so that copy is the reference, not the assignment's
   * default. Type roots and the baseline holder are still seeded from the
   * assignment default, and pass it here. */
  seedRule: string;
  /** NIRVANA import → render the delivered response as raw text. */
  isNirvana: boolean;
  /** The rule students CURRENTLY receive (deployed). The cross-query Preview
   * compares the working rule against THIS, so a fresh Save isn't compared to
   * itself. Null = nothing deployed yet. */
  deployedRule?: string | null;
  /** Set when the viewer had a rule VERSION selected — open checked out on it. */
  viewVersion?: { versionNo: number; name: string | null; rule: string | null; response: string | null } | null;
  onClose: (changed: boolean) => void;
  /**
   * WHICH of the three rules this workbench is editing. This used to be one
   * `promptMode` boolean, which collapsed the last two together — and since the
   * baseline half of that pair carries the ABLATION's affordances, a SCORE type
   * root was silently getting the control condition's interaction model (a blind
   * picker instead of the cross-query preview, review-only instead of
   * pull-a-question-in, plus the header door SCORE deliberately dropped).
   *
   *  'intent'    SCORE — an intent's rule. Authored WHEN, edge-case sweep.
   *  'type-root' SCORE — a v7 type root's rule: the type's last resort, answering
   *              whatever its chain leaves unclaimed. No authored WHEN (see
   *              `fixedWhen`) but a real, bounded question set (`scopeMessageIds`),
   *              so it takes the SCORE flow everywhere the question set is what
   *              matters.
   *  'prompt'    BASELINE — `intent` is the hidden prompt-holder and its rule IS
   *              the whole monolithic rules document. No WHEN and no question set:
   *              it answers everything, so its review set is built by hand from a
   *              blind picker. That is the ablation, not an oversight.
   *
   * Read the derived `authoredWhen` / `scoped` / `monolith` below rather than
   * testing this directly — they name WHY each branch differs.
   */
  variant?: RuleTarget;
  /** The questions this rule actually ANSWERS under v7 first-match routing —
   * computed by the board, which owns the resolver. Both SCORE variants pass it
   * ('intent': the questions resolved to this intent, not merely matching it;
   * 'type-root': the type's unclaimed residue). Null for the baseline: its one
   * prompt answers the whole log. */
  scopeMessageIds?: number[] | null;
  /** Header/copy name for a scoped rule (e.g. "Planning"). */
  scopeLabel?: string | null;
  /** A WHEN nobody authored, shown READ-ONLY. A type root's rule fires on
   * whatever its type leaves unclaimed: half of that condition is the type
   * classifier's own definition, half is the chain's shape — neither is a
   * sentence there is a box to edit. Rendered in the same slot an intent's
   * definition occupies so the rule is never shown without the question it
   * answers. Omitted (baseline) → no WHEN at all: that rule has no trigger. */
  fixedWhen?: { summary: string; definition?: string; definitionLabel?: string; note: string } | null;
}

export default function RuleWorkbench({
  assignmentId,
  rows,
  contextRows,
  row,
  intent,
  seedRule,
  isNirvana,
  deployedRule = null,
  viewVersion = null,
  onClose,
  variant = 'intent',
  scopeMessageIds = null,
  scopeLabel = null,
  fixedWhen = null,
}: RuleWorkbenchProps) {
  // The three axes the variants actually differ on. Every branch below asks one
  // of these rather than naming a variant, so what a branch is FOR stays legible
  // (and so a new caller cannot land on the wrong side of one by accident).
  /** There is an instructor-written WHEN — only an intent has one. */
  const authoredWhen = variant === 'intent';
  /** The baseline's single rules DOCUMENT: plural copy, no WHEN, and the one
   * target whose question set is the whole log rather than a bounded slice
   * (see `scopeRows`). */
  const monolith = variant === 'prompt';
  const base = `/api/instructor/assignments/${assignmentId}/score`;
  // Full conversation — replaces the MIDDLE column in place (shared thread view).
  const [convoOpen, setConvoOpen] = useState(false);

  // Rule version history — the single source of truth for what's shown.
  const [versions, setVersions] = useState<RuleVersion[] | null>(null);
  // Checked-out versionNo; null = the latest entry (the live working state).
  const [viewNo, setViewNo] = useState<number | null>(null);
  // The always-editable rule box; synced to the viewed version, edits become a
  // simulated minor via Preview.
  const [ruleText, setRuleText] = useState(intent.rule ?? '');

  // TABS — the anchor plus any opened intent questions (edge cases / apply-all).
  const [caseIds, setCaseIds] = useState<number[] | null>(null);
  const [activeId, setActiveId] = useState(row.messageId);
  // Lazily generated previews under the VIEWED rule for tabs the viewed
  // version's own stored response doesn't cover. Cleared on version switch.
  const [updated, setUpdated] = useState<Record<number, { text: string | null; loading: boolean }>>({});
  const [checking, setChecking] = useState(false);
  // Cross-query preview workbench (review the saved rule across questions).
  const [previewOpen, setPreviewOpen] = useState(false);
  // "Make this a new intent" suggestion modal.

  const [feedback, setFeedback] = useState('');
  const [rewriteOpen, setRewriteOpen] = useState(false);
  const [rewriteText, setRewriteText] = useState('');
  const [proposing, setProposing] = useState(false);
  // The variant chooser: a successful propose lands here; only the variant the
  // instructor picks is recorded (Cancel records nothing).
  const [proposal, setProposal] = useState<{
    variants: ProposalVariant[];
    mode: 'feedback' | 'rewrite';
    origin: 'feedback' | 'rewrite';
    baseRule: string | null;
    /** The instructor input behind this proposal — stored on whichever variant
     * gets recorded, so the reopened timeline replays it verbatim. */
    instruction: string;
  } | null>(null);
  // The rewrite-intent confirmation step: before proposing from a rewrite, the
  // agent reads the edit and offers what it might MEAN; the instructor
  // confirms. A before/after pair alone underdetermines the intent.
  const [rewriteStep, setRewriteStep] = useState<{
    loading: boolean;
    options: string[];
    selected: Set<string>;
    custom: string;
  } | null>(null);
  // Span-quote target: the feedback box a quoted span lands in (the button and
  // its selection state live in QuoteSelectionLayer, deliberately isolated).
  const feedbackRef = useRef<HTMLTextAreaElement>(null);
  // The rule box grows to fit its text (see the textarea below).
  const ruleBoxRef = useRef<HTMLTextAreaElement>(null);
  // A simulation (preview + minor record) is in flight.
  const [simulating, setSimulating] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The six-element rule hint: auto-shown while the panel is fresh, and
  // re-openable anytime from the Hint button by the input (null = auto by
  // chat state).
  const [guideOpen, setGuideOpen] = useState<boolean | null>(null);
  // The Cursor-style exchange log (session-local).
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const chatIdRef = useRef(0);
  const chatEndRef = useRef<HTMLDivElement>(null);
  // Any Save/apply/revert this session → the board must refresh on close.
  const savedAnyRef = useRef(false);

  // Conditionally mounted by the parent → the abort genuinely fires on close.
  const abortRef = useRef<AbortController>(new AbortController());
  const signal = () => abortRef.current.signal;
  const live = () => !abortRef.current.signal.aborted;
  // Generation counter — version switches / new simulations bump it, and every
  // async preview producer discards results it started for an older view.
  const genRef = useRef(0);

  useEffect(() => {
    const controller = abortRef.current;
    void (async () => {
      let list = await loadVersions();
      if (!live()) return;
      if (list && list.length === 0) {
        // First open for this intent → seed v1: the CURRENT rule, with the
        // anchor's delivered response as its response — the "original" is
        // simply v1.
        list = await seedV1();
      } else if (viewVersion && list?.some((v) => v.versionNo === viewVersion.versionNo)) {
        setViewNo(viewVersion.versionNo);
      }
      // The timeline picks up where the last session left off — reconstructed
      // from the persisted versions. Chat and version history are ONE axis:
      // every step stores the instruction that made it.
      if (live() && list && list.length > 0) {
        const entries = reconstructChat(list);
        setChat(entries.map((e) => ({ ...e, id: ++chatIdRef.current })));
      }
    })();
    // Seed the tab strip with the intent's top edge cases. Only an intent has
    // them: the sweep asks which questions the CHAIN resolves to this intent,
    // and a type root is not a chain member (it is what the chain falls through
    // to), so the call would come back empty. The type root's other questions
    // are reached through the cross-query preview instead.
    if (authoredWhen) void checkEdgeCases();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // New chat entries scroll into view (the panel follows the conversation).
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [chat.length]);

  // Closing the rewrite panel drops any pending intent-confirmation step.
  useEffect(() => {
    if (!rewriteOpen) setRewriteStep(null);
  }, [rewriteOpen]);

  // Keep the rule box exactly as tall as its text. Runs before paint so a
  // version checkout never flashes the wrong height; min-height (CSS) is the
  // floor, so short rules still get a usable box.
  useLayoutEffect(() => {
    const el = ruleBoxRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [ruleText]);

  /** Insert the selected span into the feedback box as a quote (editable like
   * any typed text — propose reads it as part of the feedback). */
  function quoteIntoFeedback(text: string) {
    const capped = text.length > 600 ? `${text.slice(0, 600)}…` : text;
    const quoted = `Regarding this part: "${capped}"`;
    setFeedback((prev) => (prev.trim() ? `${prev.trimEnd()}\n${quoted}\n` : `${quoted}\n`));
    window.getSelection()?.removeAllRanges();
    feedbackRef.current?.focus();
  }

  function pushChat(entry: Omit<ChatEntry, 'id'>) {
    setChat((prev) => [...prev, { ...entry, id: ++chatIdRef.current }]);
  }

  // "Fresh" = no exchange yet, only milestone rows (the reconstructed v1
  // baseline). Drives the six-element guide's auto-show.
  const chatFresh = chat.every((m) => m.role === 'event');

  /* ---- versions ----------------------------------------------------------- */

  const latest = versions?.[0] ?? null;
  const viewed = useMemo(
    () =>
      versions === null
        ? null
        : viewNo === null
          ? versions[0] ?? null
          : versions.find((v) => v.versionNo === viewNo) ?? versions[0] ?? null,
    [versions, viewNo]
  );
  const viewingLatest = viewed !== null && latest !== null && viewed.versionNo === latest.versionNo;

  // Sync the rule box (and invalidate stale previews) whenever the viewed
  // version changes.
  const viewedNo = viewed?.versionNo;
  useEffect(() => {
    if (viewedNo === undefined) return;
    genRef.current += 1;
    setUpdated({});
    setRewriteOpen(false);
    setRuleText(versions?.find((v) => v.versionNo === viewedNo)?.rule ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewedNo]);

  async function loadVersions(): Promise<RuleVersion[] | null> {
    try {
      const res = await fetch(`${base}/intents/${intent.id}/rule-versions`, { signal: signal() });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.versions) && live()) {
        setVersions(data.versions as RuleVersion[]);
        return data.versions as RuleVersion[];
      }
    } catch {
      /* history is best-effort; a failed load leaves the previous list */
    }
    return null;
  }

  async function seedV1(): Promise<RuleVersion[] | null> {
    // While the rule is still the one this target STARTED from — the copy it
    // was seeded with, or nothing at all (NIRVANA) — the anchor's delivered
    // response is exactly what that rule produced, so v1 keeps it verbatim.
    // Once edited, v1's response regenerates lazily like any other step.
    const untouched = !intent.rule?.trim() || intent.rule.trim() === seedRule.trim();
    try {
      const res = await fetch(`${base}/intents/${intent.id}/rule-versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rule: intent.rule,
          // Plural only for the baseline's rules DOCUMENT. A type root owns one
          // rule like any set, and this name is persisted — a wrong plural
          // outlives the copy fix.
          ...(untouched ? { name: seedRuleVersionName(intent.rule, { plural: monolith }) } : {}),
          source: 'seed',
          updatedResponse: untouched ? row.responseText?.trim() || null : null,
          anchorMessageId: row.messageId,
        }),
        signal: signal(),
      });
      if (res.ok && live()) return await loadVersions();
    } catch {
      /* seeding is best-effort — the first simulation creates v1 implicitly */
    }
    return null;
  }

  /* ---- active tab --------------------------------------------------------- */

  const activeRow = useMemo(
    () => rows.find((r) => r.messageId === activeId) ?? row,
    [rows, activeId, row]
  );
  const threadLength = useMemo(
    () => rows.filter((r) => r.conversationId === activeRow.conversationId).length,
    [rows, activeRow.conversationId]
  );

  /** The questions this rule can be tried against: the ones it ANSWERS, which
   * the board resolves with the real chain compiler and hands over as
   * `scopeMessageIds`. Only the baseline falls back to the whole log — its one
   * prompt genuinely answers everything.
   *
   * It used to read membership here itself (clearly_in + pins). Under v7 that
   * is the wrong set: first-match means an intent can MATCH a question that an
   * earlier sibling or one of its own subsets answers instead, and tuning a
   * rule against a response no student receives is exactly the confusion the
   * shadowing diagnostic exists to name. */
  const scopeRows = useMemo(
    () => (scopeMessageIds ? rows.filter((r) => scopeMessageIds.includes(r.messageId)) : rows),
    [scopeMessageIds, rows]
  );

  // The response the pane shows for the active tab under the VIEWED version:
  // the version's own stored response when it anchors this tab; for the SEED
  // (the baseline = what was actually deployed) EVERY question's response is
  // simply its delivered original — never regenerate the starting prompt;
  // anything else falls back to the lazily generated preview.
  const viewedCoversActive = viewed !== null && viewed.anchorMessageId === activeId;
  const viewedIsSeed = viewed?.source === 'seed';
  const deliveredText = activeRow.responseText?.trim() ? activeRow.responseText : null;
  const activeEntry = viewedCoversActive
    ? { text: viewed.updatedResponse, loading: false }
    : viewedIsSeed
      ? { text: deliveredText, loading: false }
      : updated[activeId];
  const displayedResponse = activeEntry?.text ?? null;
  // Seed responses ARE the delivered replies (raw for NIRVANA); everything
  // else is a fresh regeneration → markdown.
  const displayedRaw = isNirvana && viewedIsSeed;

  /* ---- previews ----------------------------------------------------------- */

  async function fetchPreviews(messageIds: number[], draftRule?: string | null) {
    const res = await fetch(`${base}/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intentId: intent.id,
        messageIds,
        ...(draftRule !== undefined ? { draftRule } : {}),
      }),
      signal: signal(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(typeof data?.message === 'string' ? data.message : 'Preview generation failed.');
    }
    return new Map<number, string | null>(
      (data.previews as { messageId: number; response: string | null }[]).map((p) => [p.messageId, p.response])
    );
  }

  /** The draftRule param for previews under the VIEWED version: the latest
   * MAJOR is the live intent rule → undefined (server cache); anything else
   * regenerates uncached under that version's rule. */
  function ruleParamFor(v: RuleVersion | null): string | null | undefined {
    if (!v) return null;
    const latestMajor = versions?.find((x) => !x.minor) ?? null;
    return latestMajor && v.versionNo === latestMajor.versionNo ? undefined : v.rule;
  }

  /** Generate previews for `ids` under the viewed rule context. */
  async function generateUpdated(ids: number[], draftRule: string | null | undefined, gen: number) {
    if (ids.length === 0) return;
    const fresh = () => live() && gen === genRef.current;
    setUpdated((prev) => {
      const next = { ...prev };
      for (const id of ids) next[id] = { text: prev[id]?.text ?? null, loading: true };
      return next;
    });
    try {
      // The preview endpoint caps a call at 6 messages — chunk larger sets.
      for (let i = 0; i < ids.length; i += APPLY_BATCH) {
        const batch = ids.slice(i, i + APPLY_BATCH);
        const m = await fetchPreviews(batch, draftRule);
        if (!fresh()) return;
        setUpdated((prev) => {
          const next = { ...prev };
          for (const id of batch) next[id] = { text: m.get(id) ?? null, loading: false };
          return next;
        });
      }
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError' && fresh()) setError((e as Error).message);
      if (fresh()) {
        setUpdated((prev) => {
          const next = { ...prev };
          for (const id of ids) if (next[id]?.loading) next[id] = { text: next[id].text, loading: false };
          return next;
        });
      }
    }
  }

  // The viewed version doesn't cover the active tab → generate its preview
  // lazily under the viewed rule (covers version switches and tab switches).
  // The seed never generates — its response for any question is the delivered
  // original.
  useEffect(() => {
    if (!viewed || viewedCoversActive || viewed.source === 'seed') return;
    if (updated[activeId] !== undefined) return;
    if (simulating) return;
    void generateUpdated([activeId], ruleParamFor(viewed), genRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewed?.versionNo, activeId, viewedCoversActive]);

  function selectTab(id: number) {
    setActiveId(id);
    setConvoOpen(false);
    setRewriteOpen(false);
  }

  /* ---- simulate → minor version ------------------------------------------- */

  /**
   * The core loop: regenerate the ACTIVE question's response under `rule`,
   * then record it as a MINOR version (checkout-able, revertible — the costly
   * LLM output never vanishes). The new step becomes the viewed state.
   * `precomputed` skips the regeneration when the caller already holds this
   * question's response under `rule` (the variant chooser generated it).
   * `instruction` is the instructor input that asked for this step, stored on
   * the version so the timeline reconstructs verbatim on reopen.
   */
  async function simulate(
    rule: string | null,
    source: RuleSource,
    name?: string,
    note?: string,
    precomputed?: string,
    instruction?: string
  ): Promise<{ versionNo: number } | null> {
    if (simulating) return null;
    setSimulating(true);
    setError(null);
    const gen = ++genRef.current;
    try {
      let text: string | null;
      if (precomputed !== undefined) {
        text = precomputed;
      } else {
        const m = await fetchPreviews([activeId], rule);
        if (!live()) return null;
        text = m.get(activeId) ?? null;
      }
      const res = await fetch(`${base}/intents/${intent.id}/rule-versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rule,
          updatedResponse: text,
          anchorMessageId: activeId,
          source,
          name,
          note,
          instruction,
          minor: true,
        }),
        signal: signal(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data?.message === 'string' ? data.message : 'Save failed.');
      if (!live() || gen !== genRef.current) return null;
      await loadVersions();
      setViewNo(null); // the new step is the working state
      return (data.version as { versionNo: number }) ?? null;
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError' && live()) setError((e as Error).message);
      return null;
    } finally {
      if (live()) setSimulating(false);
    }
  }

  /**
   * Ask the agent for revision candidates. The route returns up to three
   * strength variants; nothing is recorded here — the chooser modal opens and
   * only the variant the instructor picks becomes a step (chooseVariant).
   */
  async function propose(
    payload: object,
    origin: 'feedback' | 'rewrite',
    instruction: string
  ): Promise<void> {
    setProposing(true);
    setError(null);
    // What was already asked and done in this session, from the persisted
    // steps (oldest first) — so "stronger" means stronger than the last step,
    // and repeated feedback compounds instead of re-litigating.
    const priorExchanges = (versions ?? [])
      .filter((v) => v.minor && v.source !== 'seed' && v.instruction?.trim())
      .slice(0, 6)
      .reverse()
      .map((v) => ({
        instruction: v.instruction as string,
        ...(v.note ? { note: v.note } : {}),
      }));
    try {
      const res = await fetch(`${base}/intents/${intent.id}/propose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          ...(priorExchanges.length > 0 ? { priorExchanges } : {}),
        }),
        signal: signal(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data?.message === 'string' ? data.message : 'Proposal failed.');
      }
      if (!live()) return;
      const variants = (Array.isArray(data.variants) ? data.variants : []) as ProposalVariant[];
      if (variants.length === 0) throw new Error('The proposal came back empty — try again.');
      setProposal({
        variants,
        mode: (data.mode as 'feedback' | 'rewrite') ?? 'feedback',
        origin,
        // Diff against the rule the proposal revised — the viewed rule at
        // submit time (draftRule), not whatever is viewed when the modal
        // renders.
        baseRule: viewed?.rule ?? null,
        instruction,
      });
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError' && live()) {
        setError((e as Error).message);
        // Give the typed feedback back, so retrying is not retyping.
        if (origin === 'feedback') setFeedback(instruction);
      }
    } finally {
      if (live()) setProposing(false);
    }
  }

  /** Rewrite step 1: have the agent read the edit and surface candidate
   * intents to confirm. Any failure degrades to the direct propose — the
   * confirmation step is an aid, never a gate. */
  async function analyzeRewrite() {
    const edited = rewriteText.trim();
    if (!edited || proposing || simulating) return;
    setRewriteStep({ loading: true, options: [], selected: new Set(), custom: '' });
    setError(null);
    try {
      const res = await fetch(`${base}/intents/${intent.id}/rewrite-intents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messageId: activeId,
          editedResponse: edited,
          ...(displayedResponse ? { currentResponse: displayedResponse } : {}),
        }),
        signal: signal(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error('analysis failed');
      if (!live()) return;
      const options = (Array.isArray(data.intents) ? data.intents : []).filter(
        (s: unknown): s is string => typeof s === 'string' && s.trim().length > 0
      );
      if (options.length === 0) throw new Error('analysis empty');
      // "Propose anyway" may already have fired during the wait — prev is null
      // then, and the late analysis must not resurrect the step.
      setRewriteStep((prev) => (prev ? { ...prev, loading: false, options } : prev));
    } catch (e) {
      if ((e as Error)?.name === 'AbortError' || !live()) return;
      setRewriteStep(null);
      submitRewrite([]);
    }
  }

  /** Rewrite step 2: propose, carrying the confirmed intents (possibly none). */
  function submitRewrite(intents: string[]) {
    const instruction =
      intents.length > 0
        ? `Rewrote the response — meaning:\n${intents.map((s) => `· ${s}`).join('\n')}`
        : 'Rewrote the response — infer the rule change.';
    pushChat({ role: 'user', text: instruction });
    void propose(
      {
        mode: 'rewrite',
        messageId: activeId,
        editedResponse: rewriteText.trim(),
        // The edit was made AGAINST the displayed response.
        currentResponse: displayedResponse ?? undefined,
        ...(viewed?.rule ? { draftRule: viewed.rule } : {}),
        ...(intents.length > 0 ? { changeIntents: intents } : {}),
      },
      'rewrite',
      instruction
    );
  }

  /** The instructor picked a variant in the chooser — record it as a minor
   * step (reusing its already-generated preview when it has one) and log the
   * exchange. Cancel never reaches here: nothing gets recorded. */
  async function chooseVariant(v: ProposalVariant, previewText: string | null) {
    if (!proposal) return;
    const created = await simulate(
      v.revisedRule,
      proposal.mode,
      v.title || undefined,
      v.note || undefined,
      previewText ?? undefined,
      proposal.instruction || undefined
    );
    if (created && live()) {
      pushChat({
        role: 'agent',
        name: v.title || 'Revised rule',
        text: v.note || '',
        rule: v.revisedRule,
        baseRule: proposal.baseRule,
        versionNo: created.versionNo,
      });
      // The feedback box was already emptied on send.
      if (proposal.origin === 'rewrite') setRewriteOpen(false);
      setProposal(null);
    }
  }

  function sendFeedback() {
    const text = feedback.trim();
    if (!text || proposing || simulating || readOnly) return;
    pushChat({ role: 'user', text });
    // Sending empties the box — the text is already in the timeline above, and
    // leaving it sitting there read as "not sent yet". propose puts it back if
    // the call fails, so a failed send never costs you what you typed.
    setFeedback('');
    void propose(
      {
        mode: 'feedback',
        messageId: activeId,
        feedback: text,
        // Critique what is ON SCREEN — the viewed version's response.
        currentResponse: displayedResponse ?? undefined,
        ...(viewed?.rule ? { draftRule: viewed.rule } : {}),
      },
      'feedback',
      text
    );
  }

  /* ---- save / revert ------------------------------------------------------ */

  // The rule box holds an edit that hasn't been simulated yet.
  const boxEdited = ruleText.trim() !== (viewed?.rule ?? '');
  // Unsaved work = the newest entry is a simulated minor.
  const dirty = latest !== null && latest.minor;
  // Viewing an old step = READ-ONLY: editing/feedback/rewrite there would make
  // the next version number ambiguous (steps only stack on the latest). The
  // ways forward are Revert (make it live) or returning to the latest.
  const readOnly = !viewingLatest;

  /**
   * What leaving would silently cost (the demo confusion: "Apply" LOOKED like
   * it applied — but only Save puts a rule on the board):
   *  - 'edit': an un-applied textarea edit — client state, genuinely lost.
   *  - 'unsaved': simulated steps never saved — persisted and reopenable, but
   *    NOT the intent's live rule, which is exactly what the leaver believes.
   */
  const leaveLoss = (): 'edit' | 'unsaved' | null => {
    if (boxEdited && !readOnly) return 'edit';
    if (dirty) return 'unsaved';
    return null;
  };
  const [leavePrompt, setLeavePrompt] = useState(false);
  // Browser-level leave (reload, tab close): the native confirm, reading fresh.
  const leaveLossRef = useRef(leaveLoss);
  leaveLossRef.current = leaveLoss;
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (leaveLossRef.current()) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  /** Save = promote the latest simulated state to a MAJOR version (recorded +
   * reflected onto the live intent rule). Gated to the latest view. */
  async function saveVersion(): Promise<RuleVersion | null> {
    if (!latest || !dirty || !viewingLatest || saving || boxEdited) return null;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${base}/intents/${intent.id}/rule-versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rule: latest.rule,
          updatedResponse: latest.updatedResponse,
          anchorMessageId: latest.anchorMessageId ?? row.messageId,
          source: latest.source,
          name: latest.name ?? undefined,
          note: latest.note ?? undefined,
        }),
        signal: signal(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data?.message === 'string' ? data.message : 'Save failed.');
      const saved = (data.version as RuleVersion) ?? null;
      // Persist this session's already-generated previews onto the saved
      // version (store-only, no LLM cost) — the board's per-question version
      // dropdown reads score_rule_version_responses, and without this only the
      // anchor ever showed the rule's effect. Best-effort: a failure loses
      // nothing but board evidence.
      if (saved) {
        const responses = Object.entries(updated)
          .filter(([id, e]) => e.text && Number(id) !== (latest.anchorMessageId ?? row.messageId))
          .map(([id, e]) => ({ messageId: Number(id), response: e.text as string }))
          .slice(0, 50);
        if (responses.length > 0) {
          try {
            await fetch(`${base}/intents/${intent.id}/rule-versions/${saved.versionNo}/apply`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ responses }),
              signal: signal(),
            });
          } catch {
            /* the anchor row (stored by the save itself) still lands */
          }
        }
      }
      if (live()) {
        savedAnyRef.current = true;
        if (saved) {
          // The timeline's Save milestone — same row reconstruction produces.
          pushChat({
            role: 'event',
            text: `Applied${latest.name ? ` · ${latest.name}` : ''}`,
            versionNo: saved.versionNo,
          });
        }
        await loadVersions();
        setViewNo(null);
      }
      return saved;
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError' && live()) setError((e as Error).message);
      return null;
    } finally {
      if (live()) setSaving(false);
    }
  }

  /** HARD REVERT (git-reset, mirrors the intent workbench): the viewed version
   * becomes the live rule and every later step is deleted. */
  async function revertToViewed() {
    if (!viewed || viewingLatest || saving || simulating || proposing) return;
    const laterCount = versions?.filter((v) => v.versionNo > viewed.versionNo).length ?? 0;
    const label = versionLabel(viewed);
    if (
      !window.confirm(
        `Revert to ${label}?\n\nThis makes ${label} the live rule and permanently deletes the ${laterCount} later step(s) — including any Save among them. This cannot be undone.`
      )
    ) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `${base}/intents/${intent.id}/rule-versions/${viewed.versionNo}/revert`,
        { method: 'POST', signal: signal() }
      );
      if (!res.ok) throw new Error('Failed to revert.');
      if (live()) {
        savedAnyRef.current = true;
        await loadVersions();
        setViewNo(null);
      }
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError' && live()) setError((e as Error).message);
    } finally {
      if (live()) setSaving(false);
    }
  }


  /** Apply the viewed rule to the intent's 3 most-different questions and open
   * them as tabs. One-shot: once tabs exist the footer button disappears. */
  /** SCORE: seed the tab strip with the intent's 3 most-different questions
   * (auto, on open). Responses generate lazily when a tab is opened, so opening
   * stays fast; from any tab you refine with feedback / rewrite, or Add example. */
  async function checkEdgeCases() {
    if (checking || caseIds) return;
    setChecking(true);
    setError(null);
    const gen = genRef.current;
    try {
      const res = await fetch(`${base}/intents/${intent.id}/edgecases?anchor=${row.messageId}&farthest=3`, {
        signal: signal(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error('Edge-case lookup failed.');
      const ids = ((data.cases ?? []) as { messageId: number }[]).map((c) => c.messageId);
      if (!live() || gen !== genRef.current) return;
      setCaseIds([row.messageId, ...ids]);
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError' && live()) setError((e as Error).message);
    } finally {
      if (live()) setChecking(false);
    }
  }

  /** From the cross-query preview (every condition's one way to add) — open
   * checked questions as example tabs, seeding the responses generated THERE so
   * the tabs open instantly (the preview runs under the same working rule,
   * viewingLatest-gated). */
  function addExamplesFromPreview(ids: number[], responses: Map<number, string | null>) {
    setPreviewOpen(false);
    if (ids.length === 0) return;
    setUpdated((prev) => {
      const next = { ...prev };
      for (const id of ids) {
        const t = responses.get(id);
        if (t && next[id] === undefined) next[id] = { text: t, loading: false };
      }
      return next;
    });
    const existing = caseIds ?? [row.messageId];
    const fresh = ids.filter((id) => !existing.includes(id));
    if (fresh.length > 0) setCaseIds([...existing, ...fresh]);
    selectTab(ids[0]);
  }

  /* ---- timeline checkout --------------------------------------------------- */

  /** Check out a step from a timeline chip — its rule and response load in
   * place (the chat IS the history; there is no separate accordion). */
  function jumpToVersion(versionNo: number) {
    if (!versions) return;
    setViewNo(latest && versionNo === latest.versionNo ? null : versionNo);
  }

  /** How a timeline entry's step renders: its display label, whether it still
   * exists (a revert may have deleted it), and whether it is checked out. The
   * rule BLOCKS carry this — they are the version navigation. */
  const stepInfo = (versionNo: number | undefined) => {
    if (versionNo === undefined) return null;
    const v = versions?.find((x) => x.versionNo === versionNo);
    return {
      label: v ? versionLabel(v) : 'v?',
      exists: v !== undefined,
      active: v !== undefined && viewed !== null && viewed.versionNo === versionNo,
    };
  };

  // CROSS-QUERY PREVIEW — replaces the workbench while reviewing the rule's
  // response across every question it answers (paginated 10 at a time).
  if (previewOpen) {
    const inScope = scopeRows.map((r) => r.messageId);
    const previewIds = [row.messageId, ...inScope.filter((id) => id !== row.messageId)];
    const seed = new Map<number, string | null>();
    for (const [idStr, entry] of Object.entries(updated)) {
      if (entry.text) seed.set(Number(idStr), entry.text);
    }
    if (latest?.anchorMessageId != null && latest.updatedResponse) seed.set(latest.anchorMessageId, latest.updatedResponse);
    return (
      <RuleApplyPreview
        assignmentId={assignmentId}
        intent={intent}
        variant={variant}
        scopeLabel={scopeLabel}
        rows={rows}
        queryIds={previewIds}
        anchorId={row.messageId}
        // Compare the working rule against what students CURRENTLY get (deployed),
        // not against the just-saved version (which would be identical).
        beforeRule={deployedRule}
        beforeLabel={deployedRule != null ? 'deployed' : 'not deployed'}
        afterRule={latest?.rule ?? null}
        afterLabel={latest ? `${versionLabel(latest)}${latest.name ? ` — ${latest.name}` : ''}` : ''}
        isNirvana={isNirvana}
        seed={seed}
        onClose={() => setPreviewOpen(false)}
        // The preview doubles as the example picker in every condition — a bad
        // response here is one checkbox away from being a tab to fix. The only
        // review-set difference the ablation calls for is the AUTO-SEED
        // (checkEdgeCases), which the baseline still does not get.
        onAddExamples={addExamplesFromPreview}
        existingIds={new Set(caseIds ?? [row.messageId])}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3 flex-1 min-h-0">
      {/* TOP BAR — rendered into the page header (see StudioShell). */}
      <WorkbenchTopBar
        title={
          monolith
            ? 'Revise the rules'
            : `Revise rule — ${scopeLabel ?? intent.title}`
        }
        onBack={() => (leaveLoss() ? setLeavePrompt(true) : onClose(savedAnyRef.current))}
        /* No header Preview door in ANY condition: the cross-query surface is
           reached from "Other questions" in the tab strip, where it belongs —
           it is about the questions, and a second door only asked which one to
           use. The baseline used to keep this one because its own entry was a
           blind picker; now it opens the same merged preview, so the second
           door has nothing left to be. */
      />

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(320px,380px)_minmax(0,1fr)_minmax(300px,380px)] gap-4 flex-1 min-h-0">
        {/* LEFT — WHEN (read-only) · THEN (editable rule) · rule history */}
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-y-auto">
          <div className="p-4 space-y-3">
            {/* WHEN — an intent's authored definition. Read-only here: this
                screen is for the Then; the When is edited in the intent
                workbench. A type root's condition is nobody's sentence, so it
                falls through to `fixedWhen`; the baseline's rules document has
                no trigger at all and gets nothing. */}
            {authoredWhen ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                  When a student…
                </p>
                <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))] whitespace-pre-wrap rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 p-2">
                  {intent.definition}
                </p>
              </div>
            ) : fixedWhen ? (
              /* A type root's WHEN. Shown, because a rule with no visible
                 trigger reads as "applies to everything" — which is the one
                 thing this rule does NOT do. Read-only, because there is
                 nothing here anyone authored: see `fixedWhen`. */
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                  When a student…
                </p>
                <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))] whitespace-pre-wrap rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 p-2">
                  {fixedWhen.summary}
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-[hsl(var(--muted-foreground))]">
                  {fixedWhen.note}
                </p>
                {/* The classifier's own words for the type, verbatim — folded
                    away because it is reference, not the condition's headline. */}
                {fixedWhen.definition && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-[11px] font-medium text-[hsl(var(--primary))] hover:underline">
                      What counts as {fixedWhen.definitionLabel ?? 'this type'}?
                    </summary>
                    <p className="mt-1 rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/20 p-2 text-[11px] leading-relaxed text-[hsl(var(--muted-foreground))]">
                      {fixedWhen.definition}
                    </p>
                  </details>
                )}
              </div>
            ) : null}

            <div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                  {/* A When above it makes this half of a pair — label it as one.
                      Only the baseline's rules document (no When) keeps the
                      bare "Rules". */}
                  {monolith
                    ? `Rules${viewed ? ` · ${versionLabel(viewed)}` : ''}`
                    : `Then… (rule${viewed ? ` · ${versionLabel(viewed)}` : ''})`}
                </p>
                {!readOnly && dirty && (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">
                    not saved yet
                  </span>
                )}
              </div>
              {/* Checked out on an old step (from a timeline block): one clean
                  banner on its own row — the label row above never wraps. */}
              {readOnly && (
                <div className="mt-1 flex items-center gap-2 rounded border border-amber-200 bg-amber-50 px-2 py-1">
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-amber-800">
                    Viewing {viewed ? versionLabel(viewed) : 'an old step'} · read-only
                  </span>
                  <button
                    onClick={revertToViewed}
                    disabled={saving || simulating || proposing}
                    title="Make this step the live rule and delete the later steps (asks first)"
                    className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[hsl(var(--primary))] text-xs font-medium text-[hsl(var(--primary-foreground))] disabled:opacity-40"
                  >
                    <RotateCcw className="w-3 h-3" /> Revert here
                  </button>
                  <button
                    onClick={() => setViewNo(null)}
                    disabled={saving || simulating || proposing}
                    title="Back to the latest step"
                    className="shrink-0 px-2 py-0.5 rounded border border-amber-300 bg-white/60 text-xs font-medium text-amber-800 hover:bg-white disabled:opacity-40"
                  >
                    Latest
                  </button>
                </div>
              )}
              {/* Grows with the rule instead of scrolling inside a fixed box:
                  a rule is the whole system prompt, and judging one you can
                  only see nine lines of is the wrong constraint. The column
                  scrolls; min-height keeps a short rule from collapsing. */}
              <textarea
                ref={ruleBoxRef}
                value={ruleText}
                onChange={(e) => !readOnly && setRuleText(e.target.value)}
                readOnly={readOnly}
                placeholder={
                  variant === 'type-root'
                    ? 'Empty — the questions above get no system prompt at all.'
                    : monolith
                      ? 'Empty — the chatbot answers with no rules at all.'
                      : 'Empty — this intent has no rule of its own yet.'
                }
                title={readOnly ? 'Viewing an old step — Revert to make it live, or Latest to edit' : undefined}
                className={`mt-1 w-full min-h-[200px] resize-none overflow-hidden text-sm leading-relaxed border border-[hsl(var(--border))] rounded px-2 py-1.5 ${
                  readOnly ? 'bg-[hsl(var(--muted))]/40 text-[hsl(var(--muted-foreground))]' : 'bg-[hsl(var(--background))]'
                }`}
              />
              <div className="mt-1.5 flex items-center justify-end gap-2">
                {/* Apply the rule you edited directly — regenerates the active
                    question's response and records a simulated step. Nothing
                    reaches students until Save. */}
                <button
                  onClick={() => {
                    void (async () => {
                      const prevRule = viewed?.rule ?? null;
                      const nextRule = ruleText.trim() || null;
                      const created = await simulate(nextRule, 'direct');
                      if (created) {
                        pushChat({
                          role: 'user',
                          text: 'Edited the rule directly.',
                          versionNo: created.versionNo,
                          rule: nextRule,
                          baseRule: prevRule,
                        });
                      }
                    })();
                  }}
                  disabled={proposing || simulating || readOnly || !boxEdited}
                  title={
                    readOnly
                      ? 'Viewing an old step — Revert to make it live, or return to the latest to edit'
                      : boxEdited
                        ? 'Apply this edit — regenerates the response and records a step (students are not affected)'
                        : 'Edit the rule text to apply a change'
                  }
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium border border-[hsl(var(--primary))]/60 text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/10 disabled:opacity-50 disabled:border-[hsl(var(--border))] disabled:text-[hsl(var(--muted-foreground))]"
                >
                  {simulating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                  Apply edit
                </button>
                {/* SAVE is THE consequential action here — it makes this rule
                    the intent's live rule, visible on the board the moment you
                    go back. Two verbs, the same pair in both benches: Apply
                    iterates and students never see it, Save is the one that
                    reaches them. The live boundary sits on the same word
                    everywhere, which is the whole point of sharing them. */}
                <button
                  onClick={() => void saveVersion()}
                  disabled={!dirty || !viewingLatest || boxEdited || saving || proposing || simulating}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:bg-[hsl(var(--primary))]/90 disabled:opacity-50"
                  title={
                    boxEdited
                      ? 'Apply the edited rule first, then save'
                      : !viewingLatest
                        ? 'Viewing an old step — Revert to make it live instead'
                        : dirty
                          ? // Says what goes live, in the words of whatever is
                            // being edited — the label below has three audiences
                            // and this tooltip used to name only the intent.
                            monolith
                            ? 'Make these the live rules — the board shows them as soon as you go back'
                            : variant === 'type-root'
                              ? `Make this the live ${scopeLabel ?? 'type'} rule — the board shows it as soon as you go back`
                              : "Make this the intent's live rule — the board shows it as soon as you go back"
                          : 'Nothing to save — apply a change first'
                  }
                >
                  {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <SaveIcon className="w-3 h-3" />}
                  {monolith ? 'Save rules' : 'Save rule'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* MIDDLE — the viewed version's Q → response for the active question */}
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] flex flex-col overflow-hidden min-h-[300px] lg:min-h-0">
          {/* QUESTION TABS — always shown: the anchor ★, any examples pulled
              in, and the door to the rest. SCORE seeds the intent's top edge
              cases and reviews the others through the cross-query preview;
              baseline starts at the anchor and adds from the blind picker. */}
          <div className="shrink-0 flex items-center gap-1 overflow-x-auto border-b border-[hsl(var(--border))] px-3 py-1.5">
            {(caseIds ?? [row.messageId]).map((id) => {
                const r0 = rows.find((r) => r.messageId === id);
                const isActive = id === activeId;
                const label = `${r0?.participantToken || '—'}${r0 && r0.turnNumber > 0 ? ` · T${r0.turnNumber}` : ''}`;
                return (
                  <button
                    key={id}
                    onClick={() => selectTab(id)}
                    title={r0 ? r0.queryText.replace(/\s+/g, ' ').trim().slice(0, 140) : undefined}
                    className={`shrink-0 inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium border ${
                      isActive
                        ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]'
                        : 'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]'
                    }`}
                  >
                    {id === row.messageId ? '★ ' : ''}
                    {label}
                  </button>
                );
              })}
            <button
              // The main affordance here, in EVERY condition: the rule is doing
              // something to every OTHER question it answers, and this is the
              // door to that. Named for what you go there to do (look at the
              // others) rather than the mechanism (adding a tab), and styled to
              // be seen — in the study nobody found the quiet "Add example".
              //
              // The baseline used to get a blind picker instead, on the theory
              // that hand-building the review set was part of the ablation. It
              // is not: spec §4.1/4.2 put exactly ONE difference in this flow —
              // SCORE auto-seeds the tabs on open (checkEdgeCases) and the
              // baseline starts at the anchor. Every MANUAL path is shared, so
              // choosing from responses you can see is a preview capability
              // (§0 principle 1 lists previews as parity), not a structuring
              // one. Withholding it just made the control's loop worse, which
              // is the strawman §0 principle 3 forbids.
              onClick={() => setPreviewOpen(true)}
              disabled={
                boxEdited || !viewingLatest || versions === null || versions.length === 0 || proposing || simulating || saving
              }
              className="shrink-0 ml-auto inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs disabled:opacity-50 border border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/10 font-semibold text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/20"
              title={
                monolith
                  ? 'See what these rules do to the other logged questions — and pull any in to fix'
                  : variant === 'type-root'
                    ? `See what this rule does to the other ${scopeLabel ?? 'type'} questions no set claims — and pull any in to fix`
                    : "See what this rule does to the intent's other questions — and pull any in to fix"
              }
            >
              <Eye className="w-3.5 h-3.5" /> Other questions
            </button>
          </div>

          {convoOpen ? (
            <div className="flex-1 min-h-0 flex flex-col">
              <div className="shrink-0 px-3 py-1.5 bg-[hsl(var(--muted))]/40 border-b border-[hsl(var(--border))] flex items-center justify-between gap-2">
                <button
                  onClick={() => setConvoOpen(false)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[hsl(var(--border))] text-xs font-medium text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]"
                >
                  <Minimize2 className="w-3.5 h-3.5" /> Exit
                </button>
                {/* The point of this view: the prior conversation as context,
                    with the VIEWED step's response in place of the original. */}
                {displayedResponse && viewed && (
                  <span className="text-xs text-[hsl(var(--muted-foreground))]">
                    showing the{' '}
                    <span className="font-medium text-emerald-700">{versionLabel(viewed)} response</span>{' '}
                    in place of the original
                  </span>
                )}
              </div>
              <ConversationThread
                rows={contextRows ?? rows}
                current={activeRow}
                isNirvana={isNirvana}
                overrideResponse={
                  displayedResponse
                    ? { messageId: activeId, text: displayedResponse, raw: displayedRaw }
                    : null
                }
              />
            </div>
          ) : (
            <div className="flex-1 min-h-0 flex flex-col">
              {/* Pane header — which version's response is on screen. */}
              <div className="shrink-0 px-3 py-1.5 bg-[hsl(var(--muted))]/40 border-b border-[hsl(var(--border))] flex items-center justify-between gap-2 flex-wrap">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                  Response{' '}
                  {viewed && (
                    <span className="font-normal normal-case">
                      · {versionLabel(viewed)}
                      {viewed.name ? ` — ${viewed.name}` : ''}
                    </span>
                  )}
                </h3>
                <div className="flex items-center gap-1.5">
                  {displayedResponse && !rewriteOpen && !readOnly && (
                    <button
                      onClick={() => {
                        setRewriteText(displayedResponse);
                        setRewriteOpen(true);
                      }}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-[hsl(var(--border))] text-xs font-medium text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
                      title="Rewrite this response the way you want it — the agent infers the rule change"
                    >
                      <Pencil className="w-2.5 h-2.5" /> Rewrite instead
                    </button>
                  )}
                  {threadLength > 1 && (
                    <button
                      onClick={() => setConvoOpen(true)}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-[hsl(var(--border))] text-xs font-medium text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
                      title="See this step's response inside the prior conversation (the earlier turns stay as delivered)"
                    >
                      <Maximize2 className="w-2.5 h-2.5" /> View in context
                    </button>
                  )}
                </div>
              </div>

              {/* Q/A rendered with the SAME chat component as Full conversation. */}
              {(() => {
                const loading = simulating || (activeEntry?.loading ?? false);
                const assistantText = rewriteOpen || loading ? null : displayedResponse;
                const messages = [
                  {
                    id: activeRow.messageId,
                    role: 'user' as const,
                    content: activeRow.queryText,
                    timestamp: Date.parse(activeRow.queryTimestamp),
                  },
                  ...(assistantText
                    ? [
                        {
                          id: `resp-${viewed?.versionNo ?? 0}-${activeId}`,
                          role: 'assistant' as const,
                          content: assistantText,
                        },
                      ]
                    : []),
                ];
                return (
                  <QuoteSelectionLayer
                    disabled={readOnly || rewriteOpen}
                    onQuote={quoteIntoFeedback}
                  >
                    <ChatMessages
                      messages={messages}
                      showTimestamp
                      autoScrollToHighlight // suppress the live-chat bottom-follow
                      rawAssistantText={displayedRaw}
                      renderUserContent={(m) =>
                        m.id === activeRow.messageId &&
                        activeRow.dissection &&
                        activeRow.dissection.materialKinds.length > 0 ? (
                          // Tags stay collapsed here: revising a rule is about
                          // the SHAPE of the question, and a pasted draft is
                          // exactly the part the rule shouldn't be written
                          // against. The bubble's control reveals it on demand.
                          <MaterialSegments
                            text={activeRow.queryText}
                            dissection={activeRow.dissection}
                            toggleAll
                          />
                        ) : null
                      }
                      // Editing the reply IS the rewrite affordance (read-only
                      // checkouts keep the default Copy instead).
                      onEditAssistant={
                        readOnly
                          ? undefined
                          : (m) => {
                              setRewriteText(m.content);
                              setRewriteOpen(true);
                            }
                      }
                    />
                    {/* Non-message states render below the question bubble. */}
                    <div className="px-4 pb-4">
                      {rewriteOpen ? (
                        <div className="space-y-1.5">
                          <textarea
                            value={rewriteText}
                            onChange={(e) => setRewriteText(e.target.value)}
                            readOnly={rewriteStep !== null}
                            rows={14}
                            title={rewriteStep !== null ? 'Back returns to editing the rewrite' : undefined}
                            className={`w-full resize-y text-sm leading-relaxed border border-[hsl(var(--border))] rounded px-2 py-1.5 ${
                              rewriteStep !== null
                                ? 'bg-[hsl(var(--muted))]/40 text-[hsl(var(--muted-foreground))]'
                                : 'bg-[hsl(var(--background))]'
                            }`}
                          />
                          {rewriteStep === null ? (
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => setRewriteOpen(false)}
                                className="px-2.5 py-1 rounded text-xs font-medium border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => void analyzeRewrite()}
                                disabled={proposing || simulating || !rewriteText.trim()}
                                title="The agent reads your edit, asks what you meant, then proposes the rule"
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] disabled:opacity-50"
                              >
                                <Wand2 className="w-3 h-3" />
                                Propose rule from my rewrite
                              </button>
                            </div>
                          ) : (
                            /* THE CONFIRMATION STEP — what the rewrite MEANS.
                               Your own words come FIRST (they are the best
                               signal); the agent's readings of the edit are
                               below as checkable fallbacks. */
                            <div className="rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 p-3 space-y-2.5">
                              <p className="text-sm font-semibold text-[hsl(var(--foreground))]">
                                What should this change in general?{' '}
                                <span className="font-normal text-[hsl(var(--muted-foreground))]">
                                  It steers the new rule.
                                </span>
                              </p>
                              <input
                                autoFocus
                                value={rewriteStep.custom}
                                onChange={(e) =>
                                  setRewriteStep((prev) => (prev ? { ...prev, custom: e.target.value } : prev))
                                }
                                placeholder="Say it in your own words — the strongest signal…"
                                className="w-full text-sm border border-[hsl(var(--border))] rounded px-2.5 py-1.5 bg-[hsl(var(--background))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
                              />
                              {rewriteStep.loading ? (
                                <p className="flex items-center gap-2 text-sm text-[hsl(var(--muted-foreground))]">
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Reading your edit…
                                </p>
                              ) : (
                                <div className="space-y-1.5">
                                  <p className="text-xs text-[hsl(var(--muted-foreground))]">
                                    …or confirm what the agent read from your edit:
                                  </p>
                                  {rewriteStep.options.map((opt) => (
                                    <label key={opt} className="flex items-start gap-2 text-sm cursor-pointer">
                                      <input
                                        type="checkbox"
                                        className="mt-1 shrink-0"
                                        checked={rewriteStep.selected.has(opt)}
                                        onChange={() =>
                                          setRewriteStep((prev) => {
                                            if (!prev) return prev;
                                            const next = new Set(prev.selected);
                                            if (next.has(opt)) next.delete(opt);
                                            else next.add(opt);
                                            return { ...prev, selected: next };
                                          })
                                        }
                                      />
                                      <span>{opt}</span>
                                    </label>
                                  ))}
                                </div>
                              )}
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  onClick={() => setRewriteStep(null)}
                                  disabled={proposing || simulating}
                                  className="px-2.5 py-1 rounded text-xs font-medium border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] disabled:opacity-50"
                                >
                                  Back
                                </button>
                                {(() => {
                                  const chosen = [...rewriteStep.selected];
                                  const custom = rewriteStep.custom.trim();
                                  if (custom) chosen.push(custom);
                                  return (
                                    <button
                                      onClick={() => {
                                        setRewriteStep(null);
                                        submitRewrite(chosen);
                                      }}
                                      disabled={proposing || simulating}
                                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] disabled:opacity-50"
                                    >
                                      {proposing || simulating ? (
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                      ) : (
                                        <Wand2 className="w-3 h-3" />
                                      )}
                                      {/* "intent" here meant "what you meant by
                                          the edit" — an unrelated sense of the
                                          word, which reads as the object noun
                                          in SCORE and is treatment vocabulary
                                          in the baseline. Say the plain thing. */}
                                      {chosen.length > 0
                                        ? `Propose with ${chosen.length} change${chosen.length === 1 ? '' : 's'}`
                                        : 'Propose anyway'}
                                    </button>
                                  );
                                })()}
                              </div>
                            </div>
                          )}
                        </div>
                      ) : loading ? (
                        <p className="flex items-center gap-2 text-sm text-[hsl(var(--muted-foreground))]">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          {simulating ? 'Simulating under the revised rule…' : 'Generating this step’s response…'}
                        </p>
                      ) : !displayedResponse && (viewedIsSeed || viewedCoversActive) ? (
                        <p className="text-sm italic text-[hsl(var(--muted-foreground))]">
                          No chatbot response was recorded for this question.
                        </p>
                      ) : !displayedResponse && activeEntry ? (
                        <p className="text-sm italic text-[hsl(var(--muted-foreground))]">
                          Preview failed to generate.
                        </p>
                      ) : !displayedResponse ? (
                        <p className="text-sm text-[hsl(var(--muted-foreground))]">
                          The response for this step loads in a moment…
                        </p>
                      ) : null}
                    </div>
                  </QuoteSelectionLayer>
                );
              })()}

            </div>
          )}
        </div>

        {/* RIGHT — Cursor-style feedback panel: exchanges above, input pinned
            at the bottom. */}
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] flex flex-col overflow-hidden min-h-[300px] lg:min-h-0">
          <div className="shrink-0 px-3 py-2 border-b border-[hsl(var(--border))] flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
              <Sparkles className="w-3.5 h-3.5" /> Feedback &amp; history
            </span>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
            {chat.map((m) => {
              const info = stepInfo(m.versionNo);
              // A rule block, when this entry carries one — labelled with its
              // version and clickable to check the step out.
              const block =
                m.rule !== undefined ? (
                  <ChatRuleBlock
                    rule={m.rule}
                    baseRule={m.baseRule ?? null}
                    label={info?.label}
                    exists={info?.exists ?? true}
                    active={info?.active ?? false}
                    onOpen={
                      m.versionNo !== undefined && info?.exists
                        ? () => jumpToVersion(m.versionNo as number)
                        : undefined
                    }
                  />
                ) : null;
              return m.role === 'event' ? (
                /* Milestone row — the v1 baseline (with its rule block) or a
                   Save. Rows with a surviving step check it out on click. */
                <div key={m.id}>
                  <div
                    role={info?.exists ? 'button' : undefined}
                    onClick={info?.exists ? () => jumpToVersion(m.versionNo as number) : undefined}
                    title={info?.exists ? 'View this step — its rule and response load in place' : undefined}
                    className={`flex items-center gap-2 text-[11px] text-[hsl(var(--muted-foreground))] ${
                      info?.exists ? 'cursor-pointer hover:text-[hsl(var(--foreground))]' : ''
                    }`}
                  >
                    <span className="flex-1 border-t border-[hsl(var(--border))]" aria-hidden />
                    {info && (
                      <span className={`shrink-0 font-mono font-semibold ${info.active ? 'text-[hsl(var(--primary))]' : ''}`}>
                        {info.exists ? info.label : 'removed'}
                      </span>
                    )}
                    <span className="shrink-0">{m.text}</span>
                    <span className="flex-1 border-t border-[hsl(var(--border))]" aria-hidden />
                  </div>
                  {block}
                </div>
              ) : m.role === 'user' ? (
                <div key={m.id} className="flex flex-col items-stretch gap-0">
                  <p className="ml-auto max-w-[90%] rounded-2xl rounded-tr-sm bg-[hsl(var(--muted))] px-3 py-2 text-sm whitespace-pre-wrap">
                    {m.text}
                  </p>
                  {/* Direct edits carry their rule block here (no agent card). */}
                  {block}
                </div>
              ) : (
                <div key={m.id} className="text-sm">
                  <p className="flex items-center gap-1.5 font-medium text-[hsl(var(--foreground))]">
                    <Sparkles className="w-3 h-3 shrink-0 text-[hsl(var(--primary))]" />
                    <span className="min-w-0 truncate">{m.name}</span>
                  </p>
                  {m.text && (
                    <p className="mt-0.5 whitespace-pre-wrap text-[hsl(var(--muted-foreground))]">{m.text}</p>
                  )}
                  {/* What this exchange did to the rule — a diff by default,
                      so the panel reads as a self-contained changelog. */}
                  {block}
                </div>
              );
            })}
            {(proposing || simulating) && (
              <p className="flex items-center gap-2 text-sm text-[hsl(var(--muted-foreground))]">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {proposing ? 'Revising the rule…' : 'Simulating the response…'}
              </p>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* HINT — what a strong rule usually sets. The six one-click starters
              that used to sit here are gone: in the user study nobody built a
              revision out of them, and a row of canned sentences above the box
              mostly crowded out writing one. The same six ideas survive as this
              hint, which explains rather than types for you. They map onto the
              teacher-authored prompt schema in Liu et al. 2026
              (arXiv:2604.16738, Table 1) plus the "no direct answers" guardrail
              — the study's most effective safeguard (AI answer-giving 16.2% →
              7.7%). Opened from the button by the input, not a "?" in the
              header nobody looked at. */}
          {(guideOpen ?? chatFresh) && !readOnly && (
            <div className="shrink-0 px-2.5 pb-2">
              <div className="rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 p-2.5 space-y-1.5">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-[hsl(var(--foreground))]">
                  Not sure what to ask for? A strong rule usually sets these six:
                  <button
                    onClick={() => setGuideOpen(false)}
                    className="ml-auto p-0.5 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                    aria-label="Hide the hint"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </p>
                <ul className="space-y-1 text-xs text-[hsl(var(--muted-foreground))]">
                  <li>
                    <span className="font-medium text-[hsl(var(--foreground))]">Role.</span> The stance
                    the AI takes, like a coach that draws out thinking rather than an answer engine.
                  </li>
                  <li>
                    <span className="font-medium text-[hsl(var(--foreground))]">No direct answers.</span>{' '}
                    What it must not hand over, even when the student pushes for it.
                  </li>
                  <li>
                    <span className="font-medium text-[hsl(var(--foreground))]">Attempt first.</span> Have
                    the student try before the AI steps in.
                  </li>
                  <li>
                    <span className="font-medium text-[hsl(var(--foreground))]">One thing at a time.</span> A
                    single question or step per turn, not a wall of them.
                  </li>
                  <li>
                    <span className="font-medium text-[hsl(var(--foreground))]">Brief, with a next step.</span>{' '}
                    Short replies that end with something concrete to do.
                  </li>
                  <li>
                    <span className="font-medium text-[hsl(var(--foreground))]">Ask for evidence.</span> Have
                    the student back a claim with a reason or evidence.
                  </li>
                </ul>
              </div>
            </div>
          )}

          <div className="shrink-0 border-t border-[hsl(var(--border))] p-2.5 space-y-1.5">
            {error && (
              <p className="flex items-center gap-1 text-xs text-red-600">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {error}
                <button onClick={() => setError(null)} className="ml-auto p-0.5" aria-label="Dismiss">
                  <X className="w-3 h-3" />
                </button>
              </p>
            )}
            {!readOnly && (
              <div className="flex items-start justify-between gap-2">
                {/* WHAT the feedback critiques — the response on screen now. */}
                {viewed ? (
                  <p className="flex flex-wrap items-center gap-1 text-xs text-[hsl(var(--muted-foreground))]">
                    Feedback on:
                    <span className="rounded border border-emerald-200 bg-emerald-50 px-1 py-0.5 font-medium text-emerald-700">
                      {versionLabel(viewed)} response
                    </span>
                    <span className="rounded border border-[hsl(var(--border))] px-1 py-0.5 font-mono">
                      {activeRow.participantToken || '—'}
                      {activeRow.turnNumber > 0 ? ` · T${activeRow.turnNumber}` : ''}
                    </span>
                  </p>
                ) : (
                  <span />
                )}
                <button
                  onClick={() => setGuideOpen((v) => !(v ?? chatFresh))}
                  title="What makes a strong rule: the six elements"
                  className={`shrink-0 inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs font-medium ${
                    (guideOpen ?? chatFresh)
                      ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]'
                      : 'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]'
                  }`}
                >
                  <HelpCircle className="w-3 h-3" /> Hint
                </button>
              </div>
            )}
            <div className="relative">
              <textarea
                ref={feedbackRef}
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendFeedback();
                  }
                }}
                rows={3}
                disabled={readOnly}
                placeholder={
                  readOnly
                    ? `Viewing ${viewed ? versionLabel(viewed) : 'an old step'} (read-only) — Revert to make it live, or Latest (by the rule box) to continue.`
                    : "What's wrong with this response? (Enter to send, Shift+Enter for a new line)"
                }
                className="w-full resize-none rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2.5 py-2 pr-10 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))] disabled:bg-[hsl(var(--muted))]/40"
              />
              <button
                onClick={sendFeedback}
                disabled={proposing || simulating || readOnly || !feedback.trim()}
                title="Propose a revision from this feedback"
                className="absolute bottom-2.5 right-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] disabled:opacity-40"
              >
                {proposing || simulating ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ArrowUp className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* "Make this a new intent" — three editable candidates seeded from the
          ACTIVE question; picking one opens the New Intent workbench. */}

      {/* LEAVE GUARD — the demo confusion this prevents: Apply/feedback only
          SIMULATE; walking out after them leaves the board on the old rule.
          Mirrors the intent workbench's leave prompt, plus a save-and-leave
          primary action since here the fix is one click. */}
      {leavePrompt &&
        (() => {
          const loss = leaveLoss();
          if (!loss) return null; // resolved meanwhile
          const canSaveNow = loss === 'unsaved' && viewingLatest && !boxEdited;
          return (
            <div
              className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 p-4"
              onClick={() => setLeavePrompt(false)}
            >
              <div
                className="w-full max-w-sm rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-xl"
                onClick={(e) => e.stopPropagation()}
              >
                <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">
                  {loss === 'edit' ? 'Unapplied edit' : 'Not saved yet'}
                </h3>
                <p className="mt-1.5 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">
                  {/* Condition-neutral on purpose: this modal fires for all
                      three targets, and "the intent" is the treatment's object
                      noun — a control participant must never read it. */}
                  {loss === 'edit'
                    ? 'The rule text you edited hasn’t been applied yet — leaving discards it.'
                    : `Your latest steps are simulations — students still get the old ${
                        monolith ? 'rules' : 'rule'
                      }. Save to make ${monolith ? 'these the live rules' : 'this the live rule'}; if you leave, the steps stay here as drafts you can save later.`}
                </p>
                <div className="mt-3 flex items-center justify-end gap-2">
                  <button
                    onClick={() => setLeavePrompt(false)}
                    className="px-2.5 py-1.5 rounded border border-[hsl(var(--border))] text-xs font-medium text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]"
                  >
                    Keep working
                  </button>
                  <button
                    onClick={() => {
                      setLeavePrompt(false);
                      onClose(savedAnyRef.current);
                    }}
                    className="px-2.5 py-1.5 rounded border border-rose-300 text-xs font-medium text-rose-700 hover:bg-rose-50"
                  >
                    {loss === 'edit' ? 'Discard & leave' : 'Leave without saving'}
                  </button>
                  {canSaveNow && (
                    <button
                      onClick={() => {
                        void (async () => {
                          const saved = await saveVersion();
                          if (saved && live()) {
                            setLeavePrompt(false);
                            onClose(true);
                          }
                        })();
                      }}
                      disabled={saving}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-[hsl(var(--primary))] text-xs font-semibold text-[hsl(var(--primary-foreground))] disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <SaveIcon className="w-3 h-3" />}
                      Save &amp; leave
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

      {/* THE VARIANT CHOOSER — three strengths of the proposed revision, each
          with its rule diff and regenerated response; picking one records it. */}
      {proposal && (
        <ProposalPreviewModal
          assignmentId={assignmentId}
          intentId={intent.id}
          baseRule={proposal.baseRule}
          variants={proposal.variants}
          row={activeRow}
          busy={simulating}
          onChoose={(v, text) => void chooseVariant(v, text)}
          onClose={() => !simulating && setProposal(null)}
        />
      )}
    </div>
  );
}
