import { db } from '@/db/db';
import {
  assignments,
  scoreConfigVersions,
  scoreQueryTypes,
  studentSessions,
  studyReviewQuestions,
} from '@/db/schema';
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
  ensureTypeRoots,
  isMinorVersion,
  listCurrentRuleVersions,
  listDissections,
  listIntentRatings,
  loadIntentState,
  pickDisplayRatings,
  type VersionSummary,
} from '@/lib/score/intent-store';
import { assignmentBasePrompt } from '@/lib/assignment-ai';
import AssignmentBriefing from './AssignmentBriefing';
import WorkElapsed from '@/components/study/WorkElapsed';
import { isLegacySnapshot, listChatDeploys, parseChatDeploySnapshot } from '@/lib/score/deploy-store';
import DeployControls from './DeployControls';
import StudioShell from './StudioShell';
import {
  DISSECTION_VERSION,
  SCORE_QUERY_TYPES,
  TYPE_CLASSIFIER_VERSION,
  isRatingLevel,
  isScoreQueryType,
  type MaterialKind,
  type MaterialSpan,
  type RatingLevel,
  type ScoreQueryType,
} from '@/lib/score/intents';
import IntentBoard, {
  type IntentSummary,
  type ScoreQueryRow,
  type TypeRootSummary,
} from './IntentBoard';
import { currentPhaseStartedAt, getCurrentStudyParticipant } from '@/lib/study/session';
import { allowedAssignmentIds } from '@/lib/study/console-store';
import { advanceWaits, currentPhase } from '@/lib/study/advance';
import PhaseAdvance from '@/components/study/PhaseAdvance';
import StudyDeployButton from '@/components/study/StudyDeployButton';
import { getCloneCondition } from '@/lib/study/baseline-store';
import { resolveStudioView } from '@/lib/study/view';
import { ensureStudyTables } from '@/lib/study/store';
import { getBaselineState, PROMPT_HOLDER_TITLE } from '@/lib/study/baseline-store';
import { STUDY_PROMPT_CHAR_LIMIT, STUDY_WORK_MINUTES } from '@/lib/study/config';

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
  // Phase gate: a participant may only open the clone their CURRENT phase is
  // about. Reaching the other block's board early exposes the second
  // condition's material before its tutorial; reopening a finished block's
  // board lets them edit a configuration the measurements are already frozen
  // against. Both are silent data corruption, so this redirects rather than
  // rendering a warning.
  if (participant) {
    const allowed = await allowedAssignmentIds(participant);
    if (!allowed.includes(id)) {
      redirect('/study/session');
    }
  }

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
  // v7: each of the 4 query types owns an editable else-rule, stored as a
  // score_intents row (kind='type_root'). Created lazily here so the board can
  // render the sections, and BEFORE loadIntentState so brand-new roots are in
  // the loaded state. SCORE only: a baseline clone never routes, so it must not
  // accumulate root rows (they are filtered out of every list either way).
  if (studioView === 'score') await ensureTypeRoots(id);

  const [
    config,
    records,
    sessions,
    intentState,
    intentRatingRows,
    dissectionRows,
    configVersionRows,
    queryTypeRows,
    currentRuleVersions,
  ] = await Promise.all([
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
        .select({ summary: scoreConfigVersions.summary })
        .from(scoreConfigVersions)
        .where(eq(scoreConfigVersions.assignmentId, id)),
      db
        .select({
          messageId: scoreQueryTypes.messageId,
          type: scoreQueryTypes.type,
          version: scoreQueryTypes.version,
        })
        .from(scoreQueryTypes)
        .where(eq(scoreQueryTypes.assignmentId, id)),
      listCurrentRuleVersions(id),
    ]);

  // STUDY assignments carry a curated review set: the questions that ARE the
  // material, as opposed to the earlier turns of the same threads, which the
  // reduced master keeps only so each question can be read in context. No rows
  // for an ordinary assignment → the board lists everything, as it always has.
  const reviewMarks = await db
    .select({ messageId: studyReviewQuestions.messageId })
    .from(studyReviewQuestions)
    .where(eq(studyReviewQuestions.assignmentId, id));
  const reviewSet = reviewMarks.length > 0 ? reviewMarks.map((r) => r.messageId) : null;

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
        // v2 snapshots carry the 4 type roots inside intents[] — they are the
        // chain's else, not authored intents, so the version board must not
        // list them as such. v1 rows have no kind and are all real intents.
        intents: parseChatDeploySnapshot(viewedDeploy.snapshot)
          .intents.filter((i) => (i.kind ?? 'intent') === 'intent')
          .map((i) => ({
            id: i.id,
            title: i.title,
            definition: i.definition,
            rule: i.rule,
          })),
      }
    : null;

  // The rule each intent CURRENTLY deploys to students (latest chat deploy) — the
  // Revise Preview compares the working rule against this, not against itself.
  const latestDeploy = chatDeploys[0] ? parseChatDeploySnapshot(chatDeploys[0].snapshot) : null;
  // What students ACTUALLY get right now. A pre-v7 snapshot cannot be served
  // (the runtime refuses it and falls back to the base prompt), so presenting
  // its rules as "deployed" in the Revise before/after would be a lie — the
  // board must show that nothing of it is live until a re-deploy.
  const deployedRules =
    latestDeploy && !isLegacySnapshot(latestDeploy)
      ? latestDeploy.intents.map((i) => ({ id: i.id, rule: i.rule }))
      : [];

  const tokenBySession = new Map(sessions.map((s) => [s.id, s.participantToken]));

  // The Jelson taxonomy is kept only as the New Intent fuzzy-suggestion source.
  const jelsonSuggestions = buildJelsonSuggestions(config);

  // --- SCORE v6 intent layer ------------------------------------------------
  // Per-message intent ratings (with per-row staleness vs the CURRENT defHash)
  // and dissections. Assignment resolution happens client-side with the shared
  // deterministic resolver so link/pin edits re-derive without reload logic.
  // Ratings are hash-keyed history — pick one display row per (message, intent):
  // the current-hash row when present, else the latest (marked stale).
  // v7 type layer: which of the 4 fixed types each message was classified into.
  // Rows below TYPE_CLASSIFIER_VERSION are treated as absent (they will be
  // re-classified on the next run) rather than shown against a prompt that no
  // longer exists.
  const queryTypeByMessage = new Map<number, ScoreQueryType>();
  for (const t of queryTypeRows) {
    if (t.version < TYPE_CLASSIFIER_VERSION) continue;
    if (isScoreQueryType(t.type)) queryTypeByMessage.set(t.messageId, t.type);
  }

  const currentIntentHash = new Map(intentState.promptReady.map((p) => [p.intent.id, p.defHash]));
  const displayRatings = pickDisplayRatings(intentRatingRows, currentIntentHash);
  const intentRatingsByMessage = new Map<
    number,
    Record<number, { rating: RatingLevel; rationale: string | null; stale: boolean }>
  >();
  // v7 scoping (D9): a TYPED intent only ever judges its own type's queries, so
  // shipping its ratings for other types would show judgments the chain can
  // never act on. Type-LESS intents (starter templates, pre-backfill rows) keep
  // shipping whole-log — the baseline condition's searches read them across the
  // entire log. A message with no type yet ships everything: it is transitional,
  // and its routing is 'pending' anyway.
  const intentTypeById = new Map(intentState.intents.map((i) => [i.id, i.type]));
  for (const [messageId, perIntent] of displayRatings) {
    const m: Record<number, { rating: RatingLevel; rationale: string | null; stale: boolean }> = {};
    const messageType = queryTypeByMessage.get(messageId) ?? null;
    for (const [iid, pick] of perIntent) {
      if (!isRatingLevel(pick.row.rating)) continue;
      const intentType = intentTypeById.get(iid) ?? null;
      if (messageType !== null && intentType !== null && intentType !== messageType) continue;
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
        materials: (Array.isArray(d.materials) ? d.materials : []) as MaterialSpan[],
        stale: d.version < DISSECTION_VERSION,
      },
    ])
  );

  // Live corrections per (message, intent) — teaching the definitions have not
  // absorbed yet. Consumed rows are excluded on purpose: they are markers of
  // teaching already folded in, and a board that read them as live labels would
  // keep flagging a question as corrected long after the correction became part
  // of the definition.
  const pinsByMessage = new Map<number, Record<number, 'in' | 'out'>>();
  // HELD corrections separately, because they mean something stronger: the fold
  // was measured against them and could not reproduce them, so the system routes
  // by the decision instead of the definition until it can. Only these override
  // the judgment (see effectiveRatings) — a pending correction is still just a
  // request for the definition to change.
  const heldByMessage = new Map<number, Record<number, 'in' | 'out'>>();
  for (const p of intentState.pins.filter((x) => x.status !== 'consumed')) {
    let m = pinsByMessage.get(p.messageId);
    if (!m) {
      m = {};
      pinsByMessage.set(p.messageId, m);
    }
    m[p.intentId] = p.verdict as 'in' | 'out';
    if (p.status === 'held') {
      let h = heldByMessage.get(p.messageId);
      if (!h) {
        h = {};
        heldByMessage.set(p.messageId, h);
      }
      h[p.intentId] = p.verdict as 'in' | 'out';
    }
  }

  // Latest saved RULE version per intent (the intents panel's "Then vN name").
  // NOTE: the board deliberately does NOT carry a rule-version number. It used
  // to load every score_rule_versions row here just to render a "v2 · name"
  // chip; a version ordinal says how many times a rule was saved, which is not
  // the question the board answers, and the history it indexes is one click
  // away in the workbench. The board shows whether a rule has diverged from the
  // scope it was copied from (RuleOrigin) instead — the whole query is gone.
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
        appliedOutcome: rec.responseOutcome,
        prevQueryText: rec.prevQueryText,
        prevResponseText: rec.prevResponseText,
        turnIndex: rec.turnIndex,
        turnNumber: turnByMessage.get(rec.messageId) ?? 0,
        queryTimestamp: rec.queryTimestamp.toISOString(),
        intentRatings: intentRatingsByMessage.get(rec.messageId) ?? {},
        pinnedIntents: pinsByMessage.get(rec.messageId) ?? {},
        heldPins: heldByMessage.get(rec.messageId) ?? {},
        dissection: dissection
          ? {
              materialKinds: dissection.materialKinds,
              requests: dissection.requests,
              materials: dissection.materials,
            }
          : null,
        queryType: queryTypeByMessage.get(rec.messageId) ?? null,
      };
    })
    .sort(
      (x, y) =>
        y.queryTimestamp.localeCompare(x.queryTimestamp) || y.messageId - x.messageId
    );

  const intents: IntentSummary[] = intentState.intents
    // Only real intents are board rows. The other kinds are hidden containers:
    // the baseline prompt-holder (Revise mounts on it directly via
    // baseline.promptHolderId) and the v7 type roots (the left column renders
    // them as section headers from their own payload, added in P3). The title
    // check stays for clones whose holder predates the kind backfill.
    .filter((i) => i.kind === 'intent' && i.title !== PROMPT_HOLDER_TITLE)
    .map((i) => {
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
      intentVersionNo: intentVersionCount.get(i.id) ?? 0,
      type: isScoreQueryType(i.type) ? i.type : null,
      parentIntentId: i.parentIntentId,
      position: i.position,
    };
  });

  // v7: the 4 type roots. They are score_intents rows but NOT board intents —
  // each is a section header whose rule answers the queries its chain leaves
  // unclaimed. Kept in their own payload so every `intents` consumer stays a
  // list of real intents.
  const typeRoots: TypeRootSummary[] = intentState.intents
    .filter((i) => i.kind === 'type_root' && isScoreQueryType(i.type))
    .map((i) => ({
      id: i.id,
      type: i.type as ScoreQueryType,
      title: i.title,
      rule: i.rule,
    }))
    .sort((a, b) => SCORE_QUERY_TYPES.indexOf(a.type) - SCORE_QUERY_TYPES.indexOf(b.type));

  // A study participant's way out of the block, offered only once they have
  // deployed something to measure. Read the same deploy state the study's own
  // gate reads (console-store.deployStateFor): a baseline is live when a
  // version carries a deployedAt, SCORE when a chat deploy exists at all.
  // The participant's own elapsed readout — only while they are IN a configure
  // block. A researcher opening the same board is not on anyone's clock, and a
  // test/survey phase has its own pacing that this number would misdescribe.
  const workPhase = participant ? currentPhase(participant) : null;
  const onWorkClock = workPhase === 'block1_work' || workPhase === 'block2_work';
  const phaseStartedAt = onWorkClock && participant ? await currentPhaseStartedAt(participant.id) : null;

  const studyDeployed = isBaselineView
    ? baselineState?.deployedVersionNo != null
    : chatDeploys.length > 0;
  const studyBlockDone =
    participant && studyDeployed && !deployView
      ? { phase: currentPhase(participant), waits: advanceWaits(currentPhase(participant)) }
      : null;

  return (
    <div className="h-screen flex flex-col bg-[hsl(var(--background))]">
      <StudioShell
        header={
          <div className="flex items-center gap-4">
            {/* Back out of a demo is back to the tool that started it, not up
                the participant's own hierarchy — a researcher filming has no
                use for the assignment page, and this is the only exit the demo
                can carry without putting a control in the recording. Identical
                to look at, so the frame is unchanged either way. */}
            <Link href={participant?.isDemo ? '/api/study/admin/demo/exit' : `/instructor/assignments/${id}`}>
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
            {/* The task the log is OF. Opens by itself on a first visit and
                sits here after that — both conditions, since neither the
                assignment nor the prompt the chatbot started from is part of
                the mechanism under test. */}
            <AssignmentBriefing
              assignmentId={id}
              assignmentTitle={assignment.title}
              instructions={assignment.instructions ?? ''}
              basePrompt={assignmentBasePrompt(assignment)}
              includesInstructions={assignment.includeInstructionInPrompt ?? false}
            />
            {phaseStartedAt && (
              <WorkElapsed
                startedAt={phaseStartedAt.toISOString()}
                budgetMinutes={STUDY_WORK_MINUTES}
              />
            )}
            {/* Participants get the same one-click control in both arms; the
                version dropdown and the review modal are researcher tools, and
                giving them to only one arm would let SCORE inspect and name
                what it published while the baseline could not. */}
            {isBaselineView || participant ? (
              <StudyDeployButton
                assignmentId={id}
                condition={isBaselineView ? 'baseline' : 'score'}
                deployedVersionNo={
                  isBaselineView
                    ? baselineState?.deployedVersionNo ?? null
                    : chatDeploys[0]?.versionNo ?? null
                }
              />
            ) : (
              <DeployControls
                assignmentId={id}
                versions={deployVersions}
                selectedVersion={deployView?.versionNo ?? null}
              />
            )}
            {/* Finishing the block belongs next to Deploy, because deploying is
                what makes it possible: it appears the moment there is a version
                to be measured, and both deploy paths router.refresh() so it
                arrives on its own. Hidden while browsing an older version — the
                block does not end from a page that is only being read. The
                phase gate above already guarantees this board is the one the
                participant's current phase is about. */}
            {studyBlockDone && (
              <PhaseAdvance
                compact
                from={studyBlockDone.phase}
                label="I'm done"
                waits={studyBlockDone.waits}
                waitLabel="Your chatbot is answering the check questions now."
                confirm="This ends the setup for this chatbot and moves you on to checking it. You will not be able to come back and change it."
              />
            )}
            <InstructorHeaderActions email={instructor.email} />
          </div>
        }
      >
        <IntentBoard
          assignmentId={id}
          rows={rows}
          intents={intents}
          typeRoots={typeRoots}
          basePrompt={assignmentBasePrompt(assignment)}
          condition={studioView}
          baseline={
            isBaselineView && baselineState
              ? {
                  currentPrompt: baselineState.currentPrompt,
                  deployedVersionNo: baselineState.deployedVersionNo,
                  deployedPrompt: baselineState.deployedPrompt,
                  charLimit: STUDY_PROMPT_CHAR_LIMIT,
                  promptHolderId: baselineState.promptHolderId,
                }
              : undefined
          }
          deployedRules={deployedRules}
          // Serialized as an array: a Map crosses the RSC boundary, but every
          // other list the board takes is one, and it rebuilds its own index.
          currentRuleVersions={[...currentRuleVersions].map(([intentId, v]) => ({
            intentId,
            major: v.major,
            name: v.name,
          }))}
        reviewSet={reviewSet}
          openaiConfigured={isOpenAIConfigured()}
          jelsonSuggestions={jelsonSuggestions}
          // NIRVANA responses are raw GPT text (single-newline line breaks that
          // CommonMark would collapse) → render them verbatim, not as markdown.
          isNirvana={assignment.shareToken === 'nirvana-dataset'}
          deployView={deployView}
        />
      </StudioShell>
    </div>
  );
}
