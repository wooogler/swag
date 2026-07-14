import { db } from '@/db/db';
import { assignments, scoreConfigVersions, scoreRuleVersions, studentSessions } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ChevronLeft } from 'lucide-react';
import { getInstructor, isAdministrator } from '@/lib/auth';
import InstructorHeaderActions from '@/components/instructor/InstructorHeaderActions';
import { ensureScoreTable, getQueryRecords } from '@/lib/score/queries';
import { isOpenAIConfigured } from '@/lib/score/classifier';
import { getScoreConfig } from '@/lib/score/config-store';
import { buildJelsonSuggestions } from '@/lib/score/jelson-suggest';
import {
  ensureIntentTables,
  isMinorVersion,
  listDissections,
  listIntentRatings,
  loadIntentState,
  pickDisplayRatings,
  type VersionSummary,
} from '@/lib/score/intent-store';
import { assignmentBasePrompt } from '@/lib/assignment-ai';
import { listChatDeploys, type ChatDeploySnapshot } from '@/lib/score/deploy-store';
import DeployControls from './DeployControls';
import {
  DISSECTION_VERSION,
  isRatingLevel,
  type MaterialKind,
  type RatingLevel,
} from '@/lib/score/intents';
import IntentBoard, { type IntentSummary, type ScoreQueryRow } from './IntentBoard';
import { getCurrentStudyParticipant } from '@/lib/study/session';
import { getCloneCondition } from '@/lib/study/baseline-store';
import { resolveStudioView } from '@/lib/study/view';
import { ensureStudyTables } from '@/lib/study/store';
import { getBaselineState } from '@/lib/study/baseline-store';
import { STUDY_PROMPT_CHAR_LIMIT } from '@/lib/study/config';

interface PageProps {
  params: Promise<{ id: string }>;
  /** ?chatv=N → board as of chat deploy version N (read-only); ?view=baseline|score → studio override (admin). */
  searchParams: Promise<{ chatv?: string; view?: string }>;
}

export default async function ScorePage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { chatv, view } = await searchParams;
  const instructor = await getInstructor();
  if (!instructor) {
    redirect('/login');
  }

  const assignment = await db.query.assignments.findFirst({
    where: isAdministrator(instructor)
      ? eq(assignments.id, id)
      : and(eq(assignments.id, id), eq(assignments.instructorId, instructor.id)),
  });
  if (!assignment) {
    notFound();
  }

  // Studio view resolution (SCORE board vs Baseline studio) — the single gate.
  await ensureStudyTables();
  const [storedCondition, participant] = await Promise.all([
    getCloneCondition(id),
    getCurrentStudyParticipant(),
  ]);
  const studioView = resolveStudioView({
    storedCondition,
    viewParam: view ?? null,
    isParticipant: !!participant,
  });
  // Baseline is the SAME board with ablations (condition prop) — not a separate
  // page. It shares the SCORE data load below; only the monolithic prompt state
  // is baseline-specific.
  const isBaselineView = studioView === 'baseline';
  const baselineState = isBaselineView ? await getBaselineState(id) : null;

  await Promise.all([ensureScoreTable(), ensureIntentTables()]);

  const [config, records, sessions, intentState, intentRatingRows, dissectionRows, ruleVersionRows, configVersionRows] =
    await Promise.all([
      getScoreConfig(),
      getQueryRecords(id),
      db
        .select({ id: studentSessions.id, participantToken: studentSessions.participantToken })
        .from(studentSessions)
        .where(eq(studentSessions.assignmentId, id)),
      loadIntentState(id),
      listIntentRatings(id),
      listDissections(id),
      db
        .select({
          intentId: scoreRuleVersions.intentId,
          versionNo: scoreRuleVersions.versionNo,
          name: scoreRuleVersions.name,
          minor: scoreRuleVersions.minor,
          source: scoreRuleVersions.source,
        })
        .from(scoreRuleVersions)
        .where(eq(scoreRuleVersions.assignmentId, id)),
      db
        .select({ summary: scoreConfigVersions.summary })
        .from(scoreConfigVersions)
        .where(eq(scoreConfigVersions.assignmentId, id)),
    ]);

  // Chat deploy versions — the header dropdown, and (?chatv=N) the read-only
  // version view of a past deploy.
  const chatDeploys = await listChatDeploys(id, 100);
  const deployVersions = chatDeploys.map((d) => ({ versionNo: d.versionNo, note: d.note }));
  const chatvNo = Number.parseInt(chatv ?? '', 10);
  const viewedDeploy = Number.isFinite(chatvNo)
    ? chatDeploys.find((d) => d.versionNo === chatvNo) ?? null
    : null;
  const deployView = viewedDeploy
    ? {
        versionNo: viewedDeploy.versionNo,
        note: viewedDeploy.note,
        createdAt: viewedDeploy.createdAt.toISOString(),
        intents: (viewedDeploy.snapshot as ChatDeploySnapshot).intents.map((i) => ({
          id: i.id,
          title: i.title,
          definition: i.definition,
          rule: i.rule,
        })),
      }
    : null;

  const tokenBySession = new Map(sessions.map((s) => [s.id, s.participantToken]));

  // The Jelson taxonomy is kept only as the New Intent fuzzy-suggestion source.
  const jelsonSuggestions = buildJelsonSuggestions(config);

  // --- SCORE v6 intent layer ------------------------------------------------
  // Per-message intent ratings (with per-row staleness vs the CURRENT defHash)
  // and dissections. Assignment resolution happens client-side with the shared
  // deterministic resolver so link/pin edits re-derive without reload logic.
  // Ratings are hash-keyed history — pick one display row per (message, intent):
  // the current-hash row when present, else the latest (marked stale).
  const currentIntentHash = new Map(intentState.promptReady.map((p) => [p.intent.id, p.defHash]));
  const displayRatings = pickDisplayRatings(intentRatingRows, currentIntentHash);
  const intentRatingsByMessage = new Map<
    number,
    Record<number, { rating: RatingLevel; rationale: string | null; stale: boolean }>
  >();
  for (const [messageId, perIntent] of displayRatings) {
    const m: Record<number, { rating: RatingLevel; rationale: string | null; stale: boolean }> = {};
    for (const [iid, pick] of perIntent) {
      if (!isRatingLevel(pick.row.rating)) continue;
      m[iid] = { rating: pick.row.rating, rationale: pick.row.rationale, stale: !pick.fresh };
    }
    intentRatingsByMessage.set(messageId, m);
  }
  const dissectionByMessage = new Map(
    dissectionRows.map((d) => [
      d.messageId,
      {
        materialKinds: (Array.isArray(d.materialKinds) ? d.materialKinds : []) as MaterialKind[],
        requests: (Array.isArray(d.requests) ? d.requests : []) as string[],
        stale: d.version < DISSECTION_VERSION,
      },
    ])
  );

  // Pin verdicts per (message, intent) — instructor decisions that override
  // the classifier for the pinned question itself (applyPinOverrides).
  const pinsByMessage = new Map<number, Record<number, 'in' | 'out'>>();
  for (const p of intentState.pins) {
    let m = pinsByMessage.get(p.messageId);
    if (!m) {
      m = {};
      pinsByMessage.set(p.messageId, m);
    }
    m[p.intentId] = p.verdict as 'in' | 'out';
  }

  // Latest saved RULE version per intent (the intents panel's "Then vN name").
  // The board must show the DISPLAY major number (v1, v2, …), NOT the raw
  // per-intent versionNo — the seed and simulated minors also occupy the
  // sequence, so raw versionNo runs ahead (e.g. seed=1, minor=2, applied=3
  // must read as "v2"). Walk each intent's versions ascending, count majors
  // (minor=false, seed included, mirroring the rule-versions route), and keep
  // the latest APPLIED (non-minor, non-seed) version with its major ordinal.
  const rulesByIntent = new Map<number, typeof ruleVersionRows>();
  for (const v of ruleVersionRows) {
    const list = rulesByIntent.get(v.intentId) ?? [];
    list.push(v);
    rulesByIntent.set(v.intentId, list);
  }
  const latestRuleByIntent = new Map<number, { versionNo: number; name: string | null }>();
  for (const [intentId, list] of rulesByIntent) {
    const asc = [...list].sort((a, b) => a.versionNo - b.versionNo);
    let majorNo = 0;
    let latest: { versionNo: number; name: string | null } | null = null;
    for (const v of asc) {
      if (!v.minor) majorNo += 1;
      if (!v.minor && v.source !== 'seed') latest = { versionNo: majorNo, name: v.name };
    }
    if (latest) latestRuleByIntent.set(intentId, latest);
  }
  // MAJOR versions only — minors (applies, pin labels) fold into the workbench
  // accordion and must not advance the board's "When vN"; isMinorVersion keeps
  // this count and the workbench numbering in lockstep.
  const intentVersionCount = new Map<number, number>();
  for (const row of configVersionRows) {
    const summary = row.summary as VersionSummary | null;
    const ids = summary?.intentIds;
    if (!summary || !Array.isArray(ids) || isMinorVersion(summary)) continue;
    for (const iid of ids) intentVersionCount.set(iid, (intentVersionCount.get(iid) ?? 0) + 1);
  }

  // Turn number = ordinal of this student message within its conversation
  // (records are ordered by conversation then sequence). Robust to gaps.
  const turnByMessage = new Map<number, number>();
  let prevConversation: string | null = null;
  let turnCounter = 0;
  for (const rec of records) {
    if (rec.conversationId !== prevConversation) {
      prevConversation = rec.conversationId;
      turnCounter = 0;
    }
    turnCounter += 1;
    turnByMessage.set(rec.messageId, turnCounter);
  }

  // Build rows from the live query records (the whole log). Text/context from
  // the record; intent ratings, pins, and dissection from the v6 layer.
  const rows: ScoreQueryRow[] = records
    .map((rec) => {
      const dissection = dissectionByMessage.get(rec.messageId);
      return {
        messageId: rec.messageId,
        sessionId: rec.sessionId,
        conversationId: rec.conversationId,
        participantToken: tokenBySession.get(rec.sessionId) ?? '',
        queryText: rec.queryText,
        responseText: rec.responseText,
        chatDeployVersion: rec.responseChatVersion,
        appliedIntentId: rec.responseIntentId,
        prevQueryText: rec.prevQueryText,
        prevResponseText: rec.prevResponseText,
        turnIndex: rec.turnIndex,
        turnNumber: turnByMessage.get(rec.messageId) ?? 0,
        queryTimestamp: rec.queryTimestamp.toISOString(),
        intentRatings: intentRatingsByMessage.get(rec.messageId) ?? {},
        pinnedIntents: pinsByMessage.get(rec.messageId) ?? {},
        dissection: dissection
          ? { materialKinds: dissection.materialKinds, requests: dissection.requests }
          : null,
      };
    })
    .sort(
      (x, y) =>
        y.queryTimestamp.localeCompare(x.queryTimestamp) || y.messageId - x.messageId
    );

  const intents: IntentSummary[] = intentState.intents.map((i) => {
    const pins = intentState.pins.filter((p) => p.intentId === i.id);
    return {
      id: i.id,
      title: i.title,
      definition: i.definition,
      rule: i.rule,
      archived: i.archived,
      isTemplate: i.isTemplate,
      pinCount: pins.length,
      includedCount: pins.filter((p) => p.verdict === 'in').length,
      excludedCount: pins.filter((p) => p.verdict === 'out').length,
      latestRuleVersion: latestRuleByIntent.get(i.id) ?? null,
      intentVersionNo: intentVersionCount.get(i.id) ?? 0,
    };
  });
  const links = intentState.links.map((l) => ({
    fromIntentId: l.fromIntentId,
    toIntentId: l.toIntentId,
  }));

  return (
    <div className="h-screen flex flex-col bg-[hsl(var(--background))]">
      <header className="shrink-0 bg-[hsl(var(--card))] border-b border-[hsl(var(--border))]">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-4">
            <Link href={`/instructor/assignments/${id}`}>
              <Button variant="ghost" size="icon" className="hover:bg-[hsl(var(--muted))]">
                <ChevronLeft className="w-5 h-5 text-[hsl(var(--muted-foreground))]" />
              </Button>
            </Link>
            <div className="flex-1">
              <h1 className="text-xl font-bold font-heading text-[hsl(var(--foreground))]">
                Chatbot Studio · <span className="font-normal">{assignment.title}</span>
              </h1>
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                {isBaselineView
                  ? 'Customize the chatbot from real student questions'
                  : 'Organize · Revise · Evaluate — instructor intents own the log'}
              </p>
            </div>
            {!isBaselineView && (
              <DeployControls
                assignmentId={id}
                versions={deployVersions}
                selectedVersion={deployView?.versionNo ?? null}
              />
            )}
            <InstructorHeaderActions email={instructor.email} />
          </div>
        </div>
      </header>

      <main className="w-full max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-6 flex-1 flex flex-col min-h-0">
        <IntentBoard
          assignmentId={id}
          rows={rows}
          intents={intents}
          links={links}
          basePrompt={assignmentBasePrompt(assignment)}
          condition={studioView}
          baseline={
            isBaselineView && baselineState
              ? {
                  currentPrompt: baselineState.currentPrompt,
                  deployedVersionNo: baselineState.deployedVersionNo,
                  charLimit: STUDY_PROMPT_CHAR_LIMIT,
                }
              : undefined
          }
          openaiConfigured={isOpenAIConfigured()}
          jelsonSuggestions={jelsonSuggestions}
          // NIRVANA responses are raw GPT text (single-newline line breaks that
          // CommonMark would collapse) → render them verbatim, not as markdown.
          isNirvana={assignment.shareToken === 'nirvana-dataset'}
          deployView={deployView}
        />
      </main>
    </div>
  );
}
