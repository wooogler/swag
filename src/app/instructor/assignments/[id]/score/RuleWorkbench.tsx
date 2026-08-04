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
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUp,
  Eye,
  HelpCircle,
  Loader2,
  Maximize2,
  Minimize2,
  Pencil,
  Plus,
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
import { FEEDBACK_CHIPS } from '@/lib/score/feedback-chips';
import { seedRuleVersionName } from '@/lib/score/intents';
import RuleApplyPreview from './RuleApplyPreview';
import QueryPicker from './QueryPicker';
import { timeAgo } from './IntentWorkbench';

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
  minor: boolean;
  major: number;
  minorNo: number | null;
  createdAt: string;
}

/** One exchange in the feedback panel (session-local, not persisted). */
interface ChatEntry {
  id: number;
  role: 'user' | 'agent';
  text: string;
  /** Agent entries: the proposed rule's short name. */
  name?: string;
  /** The rule text this exchange produced (agent proposals) — shown inline so
   * the feedback history reads as a self-contained changelog. */
  rule?: string | null;
  /** The recorded step this exchange produced — chip links to History. */
  versionNo?: number;
}

const SOURCE_LABEL: Record<RuleSource, string> = {
  direct: 'edited',
  feedback: 'feedback',
  rewrite: 'rewrite',
  manual: 'saved',
  seed: 'baseline',
};

/** "v2" for majors, "v2.3" for simulated minors. */
function versionLabel(v: RuleVersion): string {
  return v.minor ? `v${v.major}.${v.minorNo}` : `v${v.major}`;
}


/** Batch cap of the preview/apply endpoints (MAX_PREVIEW_MESSAGES mirror). */
const APPLY_BATCH = 6;

interface RuleWorkbenchProps {
  assignmentId: string;
  /** Every question row — conversation threads and the intent's question list. */
  rows: ScoreQueryRow[];
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
  /** BASELINE (ablation): `intent` is the hidden prompt-holder and its rule IS
   * the whole monolithic system prompt. Hides the intent-only affordances (WHEN,
   * apply-to-intent, edge-case sweep, "doesn't fit → new intent") and swaps them
   * for a manual "Add example" set. Everything else — the rich rule-version
   * history (v1 seed, minors, checkout, revert) + the feedback agent — is reused
   * verbatim. Default false → the SCORE rule workbench is unchanged. */
  promptMode?: boolean;
  /** promptMode variants that DO have a scope: a v7 type root's rule answers
   * whatever its type leaves unclaimed, so its examples and cross-query preview
   * must come from those questions, not from the whole log. Omitted (baseline)
   * → the whole log, unchanged. */
  scopeMessageIds?: number[] | null;
  /** Header/copy name for a scoped promptMode rule (e.g. "Planning"). */
  scopeLabel?: string | null;
}

export default function RuleWorkbench({
  assignmentId,
  rows,
  row,
  intent,
  seedRule,
  isNirvana,
  deployedRule = null,
  viewVersion = null,
  onClose,
  promptMode = false,
  scopeMessageIds = null,
  scopeLabel = null,
}: RuleWorkbenchProps) {
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
  // promptMode: the manual "Add example" picker (no intent question list to sweep).
  const [pickerOpen, setPickerOpen] = useState(false);
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
  // A simulation (preview + minor record) is in flight.
  const [simulating, setSimulating] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Feedback starters — the generic templates until the intent-tailored ones
  // load (a small-model call server-side; generic is the graceful fallback).
  const [chips, setChips] = useState(FEEDBACK_CHIPS);
  // The five-element rule guide: auto-shown while the panel is fresh, and
  // re-openable anytime from the header (null = auto by chat state).
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
    // Tailor the feedback starters to this intent (fire-and-forget — the
    // generic texts stay if it fails or is slow). Skipped in promptMode: the
    // holder has no definition, so the generic prompt-authoring starters fit.
    if (!promptMode)
      void (async () => {
        try {
          const res = await fetch(`${base}/intents/${intent.id}/feedback-chips`, { signal: signal() });
          const d = await res.json().catch(() => null);
          if (res.ok && d?.chips && live()) {
            setChips((prev) =>
              prev.map((c) =>
                typeof d.chips[c.key] === 'string' && d.chips[c.key].trim()
                  ? { ...c, text: d.chips[c.key].trim() }
                  : c
              )
            );
          }
        } catch {
          /* generic templates remain */
        }
      })();
    void (async () => {
      const list = await loadVersions();
      if (!live()) return;
      if (list && list.length === 0) {
        // First open for this intent → seed v1: the CURRENT rule, with the
        // anchor's delivered response as its response — the "original" is
        // simply v1.
        await seedV1();
      } else if (viewVersion && list?.some((v) => v.versionNo === viewVersion.versionNo)) {
        setViewNo(viewVersion.versionNo);
      }
    })();
    // SCORE: seed the tab strip with the intent's top edge cases by default
    // (baseline starts at the anchor and adds examples by hand).
    if (!promptMode) void checkEdgeCases();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // New chat entries scroll into view (the panel follows the conversation).
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [chat.length]);

  function pushChat(entry: Omit<ChatEntry, 'id'>) {
    setChat((prev) => [...prev, { ...entry, id: ++chatIdRef.current }]);
  }

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

  async function seedV1() {
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
          ...(untouched ? { name: seedRuleVersionName(intent.rule, { plural: promptMode }) } : {}),
          source: 'seed',
          updatedResponse: untouched ? row.responseText?.trim() || null : null,
          anchorMessageId: row.messageId,
        }),
        signal: signal(),
      });
      if (res.ok && live()) await loadVersions();
    } catch {
      /* seeding is best-effort — the first simulation creates v1 implicitly */
    }
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

  // "Add example" candidate scope: baseline draws from the WHOLE log (the prompt
  // applies to everything); SCORE limits it to THIS intent's questions (its
  // clearly-in members, pins overriding) — examples belong to the intent.
  const pickerLog = useMemo(
    () =>
      promptMode
        ? scopeMessageIds
          ? rows.filter((r) => scopeMessageIds.includes(r.messageId))
          : rows
        : rows.filter((r) => {
            const pin = r.pinnedIntents[intent.id];
            return pin ? pin === 'in' : r.intentRatings[intent.id]?.rating === 'clearly_in';
          }),
    [promptMode, scopeMessageIds, rows, intent.id]
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
   */
  async function simulate(
    rule: string | null,
    source: RuleSource,
    name?: string,
    note?: string
  ): Promise<{ versionNo: number } | null> {
    if (simulating) return null;
    setSimulating(true);
    setError(null);
    const gen = ++genRef.current;
    try {
      const m = await fetchPreviews([activeId], rule);
      if (!live()) return null;
      const text = m.get(activeId) ?? null;
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

  async function propose(payload: object, origin: 'feedback' | 'rewrite'): Promise<void> {
    setProposing(true);
    setError(null);
    try {
      const res = await fetch(`${base}/intents/${intent.id}/propose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: signal(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data?.message === 'string' ? data.message : 'Proposal failed.');
      }
      if (!live()) return;
      const created = await simulate(
        (data.revisedRule as string) ?? null,
        (data.mode as 'feedback' | 'rewrite') ?? 'feedback',
        (data.title as string) || undefined,
        (data.note as string) || undefined
      );
      if (created && live()) {
        pushChat({
          role: 'agent',
          name: (data.title as string) || 'Revised rule',
          text: (data.note as string) || '',
          rule: (data.revisedRule as string) ?? null,
          versionNo: created.versionNo,
        });
        if (origin === 'feedback') setFeedback('');
        if (origin === 'rewrite') setRewriteOpen(false);
      }
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError' && live()) setError((e as Error).message);
    } finally {
      if (live()) setProposing(false);
    }
  }

  function sendFeedback() {
    const text = feedback.trim();
    if (!text || proposing || simulating || readOnly) return;
    pushChat({ role: 'user', text });
    void propose(
      {
        mode: 'feedback',
        messageId: activeId,
        feedback: text,
        // Critique what is ON SCREEN — the viewed version's response.
        currentResponse: displayedResponse ?? undefined,
        ...(viewed?.rule ? { draftRule: viewed.rule } : {}),
      },
      'feedback'
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

  /** promptMode: append manually-picked questions as tabs (the ablation's
   * hand-built review set), generating each one's response under the viewed rule. */
  async function addExamples(ids: number[]) {
    const existing = caseIds ?? [row.messageId];
    const fresh = ids.filter((id) => id !== row.messageId && !existing.includes(id));
    if (!fresh.length) return;
    setCaseIds([...existing, ...fresh]);
    const gen = genRef.current;
    const need = viewed?.source === 'seed' ? [] : fresh.filter((id) => updated[id] === undefined);
    await generateUpdated(need, ruleParamFor(viewed), gen);
  }

  /* ---- history accordion --------------------------------------------------- */

  // Group minors under their preceding major (newest-first walk, same shape as
  // the intent workbench history).
  const versionGroups = useMemo(() => {
    if (!versions) return [];
    const groups: { key: string; major: RuleVersion | null; minors: RuleVersion[] }[] = [];
    let pending: RuleVersion[] = [];
    for (const v of versions) {
      if (v.minor) {
        pending.push(v);
      } else {
        groups.push({ key: `v${v.versionNo}`, major: v, minors: pending });
        pending = [];
      }
    }
    if (pending.length > 0) groups.push({ key: 'draft', major: null, minors: pending });
    return groups;
  }, [versions]);
  const [groupToggles, setGroupToggles] = useState<Record<string, boolean>>({});

  /** Check out a step from a feedback-history chip: view it AND expand the
   * accordion group it sits in so History shows where you landed. */
  function jumpToVersion(versionNo: number) {
    if (!versions) return;
    setViewNo(latest && versionNo === latest.versionNo ? null : versionNo);
    const g = versionGroups.find(
      (grp) => grp.major?.versionNo === versionNo || grp.minors.some((m) => m.versionNo === versionNo)
    );
    if (g) setGroupToggles((t) => ({ ...t, [g.key]: true }));
  }

  /** The chip linking a feedback exchange to its recorded step. A step wiped
   * by a later revert renders inert. */
  const versionChip = (versionNo: number) => {
    const v = versions?.find((x) => x.versionNo === versionNo);
    if (!v) {
      return (
        <span
          className="shrink-0 rounded border border-[hsl(var(--border))] px-1 py-0.5 text-xs text-[hsl(var(--muted-foreground))] line-through"
          title="This step was deleted by a revert"
        >
          removed
        </span>
      );
    }
    const isViewed = viewed !== null && viewed.versionNo === versionNo;
    return (
      <button
        onClick={() => jumpToVersion(versionNo)}
        title="Open this step in History (its rule and response load in place)"
        className={`shrink-0 rounded border px-1 py-0.5 font-mono text-xs font-medium ${
          isViewed
            ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]'
            : 'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]'
        }`}
      >
        {versionLabel(v)}
      </button>
    );
  };

  const versionEntry = (v: RuleVersion, compact: boolean) => {
    const isNewest = latest !== null && v.versionNo === latest.versionNo;
    const isViewed = viewed !== null && v.versionNo === viewed.versionNo;
    const busyAny = saving || simulating || proposing;
    return (
      <div
        key={v.versionNo}
        role="button"
        tabIndex={0}
        onClick={() => !busyAny && setViewNo(isNewest ? null : v.versionNo)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          if (!busyAny) setViewNo(isNewest ? null : v.versionNo);
        }}
        title={
          isNewest
            ? 'The current working state — click to return to it'
            : 'View this step — its rule and response load instantly'
        }
        className={`w-full cursor-pointer text-left rounded border text-xs ${
          compact ? 'px-2 py-1' : 'px-2 py-1.5'
        } ${
          isViewed
            ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5'
            : 'border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/40'
        } ${busyAny ? 'opacity-50 pointer-events-none' : ''}`}
      >
        <div className="flex items-center justify-between gap-2 text-[hsl(var(--muted-foreground))]">
          <span className="shrink-0 font-mono">
            {versionLabel(v)}
            {isNewest && viewNo === null && (
              <span className="ml-1 rounded bg-[hsl(var(--primary))]/10 px-1 py-px font-sans text-[11px] font-semibold text-[hsl(var(--primary))]">
                current
              </span>
            )}
          </span>
          <span className="min-w-0 flex-1 truncate font-medium text-[hsl(var(--foreground))]">
            {v.name || (v.rule ? 'Untitled rule' : 'No rule')}
          </span>
          <span className="shrink-0 flex items-center gap-1.5">
            <span className="rounded bg-[hsl(var(--muted))] px-1 py-0.5 text-xs">
              {SOURCE_LABEL[v.source]}
            </span>
            <span title={new Date(v.createdAt).toLocaleString()}>{timeAgo(v.createdAt)}</span>
          </span>
        </div>
        {!compact && v.note && (
          <p className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">{v.note}</p>
        )}
        {/* Which logged question this change was made from — lets you trace (and
            revert) a version back to the query that motivated it. */}
        {v.anchorMessageId != null &&
          (() => {
            const ar = rows.find((r) => r.messageId === v.anchorMessageId);
            if (!ar) return null;
            return (
              <p
                className="mt-0.5 truncate text-xs text-[hsl(var(--muted-foreground))]"
                title={ar.queryText.replace(/\s+/g, ' ').trim()}
              >
                from <span className="font-mono">{ar.participantToken}{ar.turnNumber > 0 ? ` · T${ar.turnNumber}` : ''}</span>
                {' · '}
                {ar.queryText.replace(/\s+/g, ' ').trim().slice(0, 48)}
              </p>
            );
          })()}
      </div>
    );
  };

  // CROSS-QUERY PREVIEW — replaces the workbench while reviewing the saved rule's
  // response across questions. SCORE: the intent's questions; baseline: the whole
  // log (RuleApplyPreview paginates 10 at a time). Review-only — Back to return.
  if (previewOpen) {
    const inScope = promptMode
      ? (scopeMessageIds ?? rows.map((r) => r.messageId))
      : rows
          .filter((r) => {
            const pin = r.pinnedIntents[intent.id];
            return pin ? pin === 'in' : r.intentRatings[intent.id]?.rating === 'clearly_in';
          })
          .map((r) => r.messageId);
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
        promptMode={promptMode}
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
      />
    );
  }

  return (
    <div className="flex flex-col gap-3 flex-1 min-h-0">
      {/* TOP BAR — rendered into the page header (see StudioShell). */}
      <WorkbenchTopBar
        title={
          promptMode
            ? scopeLabel
              ? `Revise rule — ${scopeLabel}`
              : 'Revise the system prompt'
            : `Revise rule — ${intent.title}`
        }
        onBack={() => onClose(savedAnyRef.current)}
        actions={
          /* Preview the SAVED rule across many questions before deploying —
             SCORE across the intent's questions, baseline across the whole log
             (10 at a time). Review-only; edits happen on the left, deploy on the board. */
          <button
            onClick={() => setPreviewOpen(true)}
            disabled={boxEdited || !viewingLatest || versions === null || versions.length === 0 || proposing || simulating || saving}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] disabled:opacity-50"
            title={
              boxEdited
                ? 'Apply your edit first, then Preview'
                : promptMode
                  ? 'Preview these rules across the log (10 questions at a time)'
                  : "Preview this rule across the intent's questions"
            }
          >
            <Eye className="w-3.5 h-3.5" /> Preview
          </button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(320px,380px)_minmax(0,1fr)_minmax(300px,380px)] gap-4 flex-1 min-h-0">
        {/* LEFT — WHEN (read-only) · THEN (editable rule) · rule history */}
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-y-auto">
          <div className="p-4 space-y-3">
            {/* WHEN — intent-only; the baseline's rules have no trigger condition. */}
            {!promptMode && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                  When a student…
                </p>
                <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))] whitespace-pre-wrap rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 p-2">
                  {intent.definition}
                </p>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                  {promptMode
                    ? `Rules${viewed ? ` · ${versionLabel(viewed)}` : ''}`
                    : `Then… (rule${viewed ? ` · ${versionLabel(viewed)}` : ''})`}
                </p>
                {readOnly ? (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">
                    read-only — viewing {viewed ? versionLabel(viewed) : 'an old step'}
                  </span>
                ) : dirty ? (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">
                    not saved yet
                  </span>
                ) : null}
              </div>
              <textarea
                value={ruleText}
                onChange={(e) => !readOnly && setRuleText(e.target.value)}
                readOnly={readOnly}
                rows={9}
                placeholder={
                  promptMode
                    ? 'Empty — the chatbot answers with no rules at all.'
                    : 'Empty — this intent has no rule of its own yet.'
                }
                title={readOnly ? 'Viewing an old step — Revert to make it live, or click the newest step to edit' : undefined}
                className={`mt-1 w-full text-sm leading-relaxed border border-[hsl(var(--border))] rounded px-2 py-1.5 ${
                  readOnly ? 'bg-[hsl(var(--muted))]/40 text-[hsl(var(--muted-foreground))]' : 'bg-[hsl(var(--background))]'
                }`}
              />
              <div className="mt-1.5 flex items-center justify-end gap-2">
                {/* Apply the rule you edited directly — regenerates the active
                    question's response and records a simulated step. */}
                <button
                  onClick={() => {
                    void (async () => {
                      const created = await simulate(ruleText.trim() || null, 'direct');
                      if (created) {
                        pushChat({ role: 'user', text: 'Edited the rule directly.', versionNo: created.versionNo });
                      }
                    })();
                  }}
                  disabled={proposing || simulating || readOnly || !boxEdited}
                  title={
                    readOnly
                      ? 'Viewing an old step — Revert to make it live, or return to the latest to edit'
                      : boxEdited
                        ? 'Apply this edit — regenerates the response and records a step'
                        : 'Edit the rule text to apply a change'
                  }
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium border border-[hsl(var(--primary))]/60 text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/10 disabled:opacity-50 disabled:border-[hsl(var(--border))] disabled:text-[hsl(var(--muted-foreground))]"
                >
                  {simulating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                  Apply edit
                </button>
                <button
                  onClick={() => void saveVersion()}
                  disabled={!dirty || !viewingLatest || boxEdited || saving || proposing || simulating}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] disabled:opacity-50"
                  title={
                    boxEdited
                      ? 'Apply the edited rule first, then Save'
                      : !viewingLatest
                        ? 'Viewing an old step — Revert to make it live instead'
                        : dirty
                          ? 'Record a major version and apply it to the live intent'
                          : 'Nothing to save — apply a change first'
                  }
                >
                  {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <SaveIcon className="w-3 h-3" />}
                  Save
                </button>
              </div>
            </div>

            {/* RULE HISTORY — majors with their simulated minors folded in
                (accordion, same mental model as the intent workbench). */}
            <div className="space-y-1.5 border-t border-[hsl(var(--border))] pt-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                  History
                  {viewed && !viewingLatest && (
                    <span className="ml-1.5 normal-case font-normal text-amber-700">
                      viewing {versionLabel(viewed)}
                    </span>
                  )}
                </p>
                {viewed && !viewingLatest && (
                  <button
                    onClick={revertToViewed}
                    disabled={saving || simulating || proposing}
                    title="Make this step the live rule and delete the later steps (asks first)"
                    className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[hsl(var(--primary))] text-xs font-medium text-[hsl(var(--primary-foreground))] disabled:opacity-40"
                  >
                    <RotateCcw className="w-3 h-3" /> Revert to {versionLabel(viewed)}
                  </button>
                )}
              </div>
              {versions === null ? (
                <p className="flex items-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))]">
                  <Loader2 className="w-3 h-3 animate-spin" /> Loading history…
                </p>
              ) : versionGroups.length === 0 ? (
                <p className="text-xs text-[hsl(var(--muted-foreground))]">
                  No versions yet — the first simulation records one.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {versionGroups.map((g, gi) => {
                    const open = groupToggles[g.key] ?? gi === 0;
                    const minorsAsc = [...g.minors].reverse();
                    return (
                      <li key={g.key} className="space-y-1">
                        {g.major ? (
                          versionEntry(g.major, false)
                        ) : (
                          <p className="px-1 text-xs font-medium text-[hsl(var(--muted-foreground))]">
                            Simulated steps — not saved yet
                          </p>
                        )}
                        {g.minors.length > 0 && (
                          <div className="ml-3 border-l border-[hsl(var(--border))] pl-2 space-y-1">
                            <button
                              onClick={() => setGroupToggles((t) => ({ ...t, [g.key]: !open }))}
                              className="inline-flex items-center gap-1 text-xs font-medium text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                              title="Simulated steps on top of this version"
                            >
                              {open ? '▾' : '▸'} {g.minors.length} step{g.minors.length === 1 ? '' : 's'}
                              {g.major ? ` since ${versionLabel(g.major)}` : ''}
                            </button>
                            {open && minorsAsc.map((v) => versionEntry(v, true))}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>

        {/* MIDDLE — the viewed version's Q → response for the active question */}
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] flex flex-col overflow-hidden min-h-[300px] lg:min-h-0">
          {/* QUESTION TABS — always shown (anchor ★ + examples + "Add example").
              SCORE seeds the intent's top edge cases; baseline starts at the
              anchor. Both add more from the log with the same picker. */}
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
              onClick={() => setPickerOpen(true)}
              className="shrink-0 ml-auto inline-flex items-center gap-1 rounded border border-[hsl(var(--border))] px-2 py-0.5 text-xs font-medium text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]"
              title="Pull in more logged questions to try the rule against"
            >
              <Plus className="w-3 h-3" /> Add example
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
                rows={rows}
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
                  <div className="flex-1 min-h-0 overflow-y-auto">
                    <ChatMessages
                      messages={messages}
                      showTimestamp
                      autoScrollToHighlight // suppress the live-chat bottom-follow
                      rawAssistantText={displayedRaw}
                      renderUserContent={(m) =>
                        m.id === activeRow.messageId &&
                        activeRow.dissection &&
                        activeRow.dissection.materialKinds.length > 0 ? (
                          <MaterialSegments
                            text={activeRow.queryText}
                            dissection={activeRow.dissection}
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
                            rows={14}
                            className="w-full resize-y text-sm leading-relaxed border border-[hsl(var(--border))] rounded px-2 py-1.5 bg-[hsl(var(--background))]"
                          />
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => setRewriteOpen(false)}
                              className="px-2.5 py-1 rounded text-xs font-medium border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => {
                                pushChat({ role: 'user', text: 'Rewrote the response — infer the rule change.' });
                                void propose(
                                  {
                                    mode: 'rewrite',
                                    messageId: activeId,
                                    editedResponse: rewriteText.trim(),
                                    // The edit was made AGAINST the displayed response.
                                    currentResponse: displayedResponse ?? undefined,
                                    ...(viewed?.rule ? { draftRule: viewed.rule } : {}),
                                  },
                                  'rewrite'
                                );
                              }}
                              disabled={proposing || simulating || !rewriteText.trim()}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] disabled:opacity-50"
                            >
                              {proposing || simulating ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Wand2 className="w-3 h-3" />
                              )}
                              Propose rule from my rewrite
                            </button>
                          </div>
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
                  </div>
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
              <Sparkles className="w-3.5 h-3.5" /> Feedback
              <button
                onClick={() => setGuideOpen((v) => !(v ?? chat.length === 0))}
                title="What makes a strong rule: the six elements"
                className={`inline-flex items-center p-0.5 rounded hover:text-[hsl(var(--foreground))] ${
                  (guideOpen ?? chat.length === 0) ? 'text-[hsl(var(--primary))]' : ''
                }`}
              >
                <HelpCircle className="w-3.5 h-3.5" />
              </button>
            </span>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
            {(guideOpen ?? chat.length === 0) && (
              <div className="text-sm text-[hsl(var(--muted-foreground))] leading-relaxed">
                {/* Rule-authoring guide: the six elements a strong rule sets,
                    one-to-one with the feedback chips (see
                    @/lib/score/feedback-chips). Auto-shown while fresh; the
                    header ? re-opens it anytime. */}
                <div className="rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 p-2.5 space-y-1.5">
                  <p className="text-xs font-semibold text-[hsl(var(--foreground))]">
                    Not sure what to ask for? A strong rule usually sets these six:
                  </p>
                  <ul className="space-y-1 text-xs">
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
            {chat.map((m) =>
              m.role === 'user' ? (
                <div key={m.id} className="flex flex-col items-end gap-1">
                  <p className="max-w-[90%] rounded-2xl rounded-tr-sm bg-[hsl(var(--muted))] px-3 py-2 text-sm whitespace-pre-wrap">
                    {m.text}
                  </p>
                  {m.versionNo !== undefined && versionChip(m.versionNo)}
                </div>
              ) : (
                <div key={m.id} className="text-sm">
                  <p className="flex items-center gap-1.5 font-medium text-[hsl(var(--foreground))]">
                    <Sparkles className="w-3 h-3 shrink-0 text-[hsl(var(--primary))]" />
                    <span className="min-w-0 truncate">{m.name}</span>
                    {m.versionNo !== undefined && versionChip(m.versionNo)}
                  </p>
                  {m.text && (
                    <p className="mt-0.5 whitespace-pre-wrap text-[hsl(var(--muted-foreground))]">{m.text}</p>
                  )}
                  {/* The rule this exchange produced — the feedback panel reads
                      as a self-contained changelog. */}
                  {m.rule !== undefined && (
                    <div className="mt-1 max-h-40 overflow-y-auto rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 p-2 text-xs leading-relaxed whitespace-pre-wrap text-[hsl(var(--foreground))]">
                      {m.rule ?? <span className="italic">(no rule yet)</span>}
                    </div>
                  )}
                </div>
              )
            )}
            {(proposing || simulating) && (
              <p className="flex items-center gap-2 text-sm text-[hsl(var(--muted-foreground))]">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {proposing ? 'Revising the rule…' : 'Simulating the response…'}
              </p>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* One-click feedback starters — pinned just above the input, in ONE
              place; they insert into the box (editable), not send. */}
          {!readOnly && (
            <div className="shrink-0 flex flex-wrap gap-1 px-3 pb-2">
              {chips.map((c) => (
                <button
                  key={c.label}
                  onClick={() =>
                    setFeedback((prev) => (prev.trim() ? `${prev.trimEnd()}\n${c.text}` : c.text))
                  }
                  disabled={proposing || simulating}
                  title={c.text}
                  className="rounded-full border border-[hsl(var(--border))] px-2 py-0.5 text-xs font-medium text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] disabled:opacity-50"
                >
                  {c.label}
                </button>
              ))}
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
            {/* WHAT the feedback critiques — the response on screen right now. */}
            {viewed && !readOnly && (
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
            )}
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
                disabled={readOnly}
                placeholder={
                  readOnly
                    ? `Viewing ${viewed ? versionLabel(viewed) : 'an old step'} (read-only) — Revert to make it live, or click the newest step to continue.`
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

      {/* promptMode: pull logged questions in as example tabs (manual review set).
          Distance is measured from the active tab, so the picker leads with the
          questions most different from what you're currently viewing. */}
      {pickerOpen && (
        <QueryPicker
          log={pickerLog}
          excludeIds={new Set(caseIds ?? [row.messageId])}
          anchorId={activeId}
          assignmentId={assignmentId}
          intentId={intent.id}
          isNirvana={isNirvana}
          onAdd={(ids) => void addExamples(ids)}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
