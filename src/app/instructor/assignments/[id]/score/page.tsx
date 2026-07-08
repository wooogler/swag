import { db } from '@/db/db';
import { assignments, studentSessions } from '@/db/schema';
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
  listDissections,
  listIntentRatings,
  loadIntentState,
  pickDisplayRatings,
} from '@/lib/score/intent-store';
import { assignmentBasePrompt } from '@/lib/assignment-ai';
import {
  DISSECTION_VERSION,
  isRatingLevel,
  type MaterialKind,
  type RatingLevel,
} from '@/lib/score/intents';
import IntentBoard, { type IntentSummary, type ScoreQueryRow } from './IntentBoard';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ScorePage({ params }: PageProps) {
  const { id } = await params;
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

  await ensureScoreTable();

  const [config, records, sessions, intentState, intentRatingRows, dissectionRows] = await Promise.all([
    getScoreConfig(),
    getQueryRecords(id),
    db
      .select({ id: studentSessions.id, participantToken: studentSessions.participantToken })
      .from(studentSessions)
      .where(eq(studentSessions.assignmentId, id)),
    loadIntentState(id),
    listIntentRatings(id),
    listDissections(id),
  ]);

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

  // Pending rating work, mirroring the rate route — but only the ACTIVE intents
  // (starter-set templates are rated on their own "Run all", not counted here).
  const activePromptReady = intentState.promptReady.filter((p) => !p.intent.isTemplate);
  let pendingRatings = 0;
  if (activePromptReady.length > 0) {
    for (const rec of records) {
      const have = intentRatingsByMessage.get(rec.messageId);
      const intentsStale = activePromptReady.some((p) => {
        const r = have?.[p.intent.id];
        return !r || r.stale;
      });
      const d = dissectionByMessage.get(rec.messageId);
      if (intentsStale || !d || d.stale) pendingRatings += 1;
    }
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

  const intents: IntentSummary[] = intentState.intents.map((i) => ({
    id: i.id,
    title: i.title,
    definition: i.definition,
    rule: i.rule,
    archived: i.archived,
    isTemplate: i.isTemplate,
    pinCount: intentState.pins.filter((p) => p.intentId === i.id).length,
  }));
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
                SCORE · <span className="font-normal">{assignment.title}</span>
              </h1>
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                Organize · Revise · Evaluate — instructor intents own the log
              </p>
            </div>
            <span
              className="text-xs font-mono px-2 py-1 rounded bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]"
              title="Intent config version — every applied change snapshots a new version"
            >
              v{intentState.versionNo}
            </span>
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
          versionNo={intentState.versionNo}
          pendingRatings={pendingRatings}
          basePrompt={assignmentBasePrompt(assignment)}
          openaiConfigured={isOpenAIConfigured()}
          jelsonSuggestions={jelsonSuggestions}
          // NIRVANA responses are raw GPT text (single-newline line breaks that
          // CommonMark would collapse) → render them verbatim, not as markdown.
          isNirvana={assignment.shareToken === 'nirvana-dataset'}
        />
      </main>
    </div>
  );
}
