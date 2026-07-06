import { db } from '@/db/db';
import { assignments, studentSessions, scoreClassifications, scoreSubtypeScores } from '@/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { allCodes, flattenSubtypes, subtypeDefHash } from '@/lib/score/config';
import { CLASSIFIER_VERSION } from '@/lib/score/classifier';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ChevronLeft } from 'lucide-react';
import { getInstructor, isAdministrator } from '@/lib/auth';
import InstructorHeaderActions from '@/components/instructor/InstructorHeaderActions';
import { ensureScoreTable, getQueryRecords } from '@/lib/score/queries';
import { isOpenAIConfigured } from '@/lib/score/classifier';
import { getDefaultScoreModel } from '@/lib/score/models';
import { getScoreConfig } from '@/lib/score/config-store';
import {
  listDissections,
  listIntentRatings,
  loadIntentState,
} from '@/lib/score/intent-store';
import { assignmentBasePrompt } from '@/lib/assignment-ai';
import {
  DISSECTION_VERSION,
  isRatingLevel,
  type MaterialKind,
  type RatingLevel,
} from '@/lib/score/intents';
import ScoreViewer, { type IntentSummary, type ScoreQueryRow } from './ScoreViewer';

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

  const [config, records, cachedRows, sessions, subtypeScoreRows, intentState, intentRatingRows, dissectionRows] = await Promise.all([
    getScoreConfig(),
    getQueryRecords(id),
    db
      .select()
      .from(scoreClassifications)
      .where(eq(scoreClassifications.assignmentId, id))
      .orderBy(desc(scoreClassifications.queryTimestamp), desc(scoreClassifications.messageId)),
    db
      .select({ id: studentSessions.id, participantToken: studentSessions.participantToken })
      .from(studentSessions)
      .where(eq(studentSessions.assignmentId, id)),
    db
      .select({
        messageId: scoreSubtypeScores.messageId,
        subtypeCode: scoreSubtypeScores.subtypeCode,
        score: scoreSubtypeScores.score,
        defHash: scoreSubtypeScores.defHash,
        rawResponse: scoreSubtypeScores.rawResponse,
        model: scoreSubtypeScores.model,
      })
      .from(scoreSubtypeScores)
      .where(eq(scoreSubtypeScores.assignmentId, id)),
    loadIntentState(id),
    listIntentRatings(id),
    listDissections(id),
  ]);

  const tokenBySession = new Map(sessions.map((s) => [s.id, s.participantToken]));

  // Aggregate Classifier B's per-subtype rows back into a per-message score map.
  // Only codes in the CURRENT config are shown; scores from subtypes since
  // deleted are ignored (their orphan rows linger harmlessly). Tags are NOT
  // stored — the viewer derives them from these scores at the live threshold.
  const currentCodes = new Set(allCodes(config));
  const currentHash = new Map(
    flattenSubtypes(config).map((s) => [s.subtype.code, subtypeDefHash(s.type, s.subtype)])
  );
  const scoresByMessage = new Map<number, Record<string, number>>();
  const rawBByMessage = new Map<number, string[]>();
  const bFreshByMessage = new Map<number, Set<string>>();
  // Model that produced each message's B scores — 'mixed' after partial re-runs.
  const bModelByMessage = new Map<number, string>();
  for (const r of subtypeScoreRows) {
    if (!currentCodes.has(r.subtypeCode)) continue;
    let scores = scoresByMessage.get(r.messageId);
    if (!scores) {
      scores = {};
      scoresByMessage.set(r.messageId, scores);
    }
    scores[r.subtypeCode] = r.score;
    let raw = rawBByMessage.get(r.messageId);
    if (!raw) {
      raw = [];
      rawBByMessage.set(r.messageId, raw);
    }
    raw.push(`${r.subtypeCode}: ${r.rawResponse ?? `{"score":${r.score}}`}`);
    if (r.model) {
      const prev = bModelByMessage.get(r.messageId);
      bModelByMessage.set(r.messageId, prev && prev !== r.model ? 'mixed' : r.model);
    }
    if (r.defHash === currentHash.get(r.subtypeCode)) {
      let fresh = bFreshByMessage.get(r.messageId);
      if (!fresh) {
        fresh = new Set();
        bFreshByMessage.set(r.messageId, fresh);
      }
      fresh.add(r.subtypeCode);
    }
  }

  // --- SCORE v6 intent layer ------------------------------------------------
  // Per-message intent ratings (with per-row staleness vs the CURRENT defHash)
  // and dissections. Assignment resolution happens client-side with the shared
  // deterministic resolver so link/pin edits re-derive without reload logic.
  const currentIntentHash = new Map(intentState.promptReady.map((p) => [p.intent.id, p.defHash]));
  const intentRatingsByMessage = new Map<
    number,
    Record<number, { rating: RatingLevel; rationale: string | null; stale: boolean }>
  >();
  for (const r of intentRatingRows) {
    if (!isRatingLevel(r.rating)) continue;
    let m = intentRatingsByMessage.get(r.messageId);
    if (!m) {
      m = {};
      intentRatingsByMessage.set(r.messageId, m);
    }
    m[r.intentId] = {
      rating: r.rating,
      rationale: r.rationale,
      stale: r.defHash !== currentIntentHash.get(r.intentId),
    };
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

  // Pending rating work, mirroring the rate route: a message is pending when
  // any active intent's rating is missing/stale, or its dissection is (the
  // latter only counted once intents exist — see the rate route's gate).
  let pendingRatings = 0;
  if (intentState.promptReady.length > 0) {
    for (const rec of records) {
      const have = intentRatingsByMessage.get(rec.messageId);
      const intentsStale = intentState.promptReady.some((p) => {
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

  // Build rows from the live query records. Every record appears (the intents
  // mode organizes the WHOLE log); hasJelson marks messages carrying tag data
  // (an A row OR any B score) — the tags mode shows only those, preserving its
  // original behavior. Text fields come from the live record, A fields from
  // the cached A row when present.
  const aRowByMessage = new Map(cachedRows.map((r) => [r.messageId, r]));
  const rows: ScoreQueryRow[] = records
    .map((rec) => {
      const a = aRowByMessage.get(rec.messageId);
      const dissection = dissectionByMessage.get(rec.messageId);
      return {
        messageId: rec.messageId,
        sessionId: rec.sessionId,
        participantToken: tokenBySession.get(rec.sessionId) ?? '',
        queryText: rec.queryText,
        responseText: rec.responseText,
        prevQueryText: rec.prevQueryText,
        prevResponseText: rec.prevResponseText,
        turnIndex: rec.turnIndex,
        turnNumber: turnByMessage.get(rec.messageId) ?? 0,
        queryTimestamp: rec.queryTimestamp.toISOString(),
        hasJelson: aRowByMessage.has(rec.messageId) || scoresByMessage.has(rec.messageId),
        typeA: (a?.typeA as ScoreQueryRow['typeA']) ?? null,
        subtypeA: a?.subtypeA ?? null,
        // tagsB is derived client-side from scoresB at the live threshold.
        tagsB: [],
        scoresB: scoresByMessage.get(rec.messageId) ?? {},
        model: a?.model ?? null,
        bModel: bModelByMessage.get(rec.messageId) ?? null,
        rawA: a?.rawResponseA ?? null,
        rawB: (rawBByMessage.get(rec.messageId) ?? []).sort().join('\n') || null,
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

  const total = records.length;
  const classified = rows.filter((r) => r.hasJelson).length;

  const intents: IntentSummary[] = intentState.intents.map((i) => ({
    id: i.id,
    title: i.title,
    definition: i.definition,
    rule: i.rule,
    archived: i.archived,
    pinCount: intentState.pins.filter((p) => p.intentId === i.id).length,
  }));
  const links = intentState.links.map((l) => ({
    fromIntentId: l.fromIntentId,
    toIntentId: l.toIntentId,
  }));

  // Pending work PER CLASSIFIER, mirroring the classify route's staleness rules:
  // A is stale when its row is missing/below CLASSIFIER_VERSION; B is stale when
  // any current subtype lacks a score with a matching defHash. The viewer's
  // A/B toggle picks which count the "Classify N remaining" button shows, so it
  // stays consistent with the scoped "Re-classify A/B" buttons. Version/rubric
  // bumps and taxonomy edits therefore surface as pending work, not row absence.
  const aFresh = new Set(
    cachedRows
      .filter((r) => (r.classifierVersion ?? 0) >= CLASSIFIER_VERSION)
      .map((r) => r.messageId)
  );
  let pendingA = 0;
  let pendingB = 0;
  for (const rec of records) {
    if (!aFresh.has(rec.messageId)) pendingA += 1;
    const fresh = bFreshByMessage.get(rec.messageId);
    const bStale = currentHash.size > 0 && (!fresh || fresh.size < currentHash.size);
    if (bStale) pendingB += 1;
  }

  return (
    <div className="min-h-screen bg-[hsl(var(--background))]">
      <header className="bg-[hsl(var(--card))] border-b border-[hsl(var(--border))] sticky top-0 z-10">
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
                Organize · Revise · Evaluate — intents own the log; Jelson tags assist browsing
              </p>
            </div>
            <InstructorHeaderActions email={instructor.email} />
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <ScoreViewer
          assignmentId={id}
          assignmentTitle={assignment.title}
          rows={rows}
          total={total}
          classified={classified}
          pendingA={pendingA}
          pendingB={pendingB}
          defaultModel={getDefaultScoreModel()}
          openaiConfigured={isOpenAIConfigured()}
          initialConfig={config}
          canEditTaxonomy={isAdministrator(instructor)}
          intents={intents}
          intentLinks={links}
          versionNo={intentState.versionNo}
          pendingRatings={pendingRatings}
          basePrompt={assignmentBasePrompt(assignment)}
        />
      </main>
    </div>
  );
}
