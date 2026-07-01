import { db } from '@/db/db';
import { assignments, studentSessions, scoreClassifications } from '@/db/schema';
import { eq, and, desc } from 'drizzle-orm';
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
import ScoreViewer, { type ScoreQueryRow } from './ScoreViewer';

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

  const [config, records, cachedRows, sessions] = await Promise.all([
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
  ]);

  const tokenBySession = new Map(sessions.map((s) => [s.id, s.participantToken]));

  // Only show rows that still correspond to an existing query in the logs.
  const liveMessageIds = new Set(records.map((r) => r.messageId));

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

  const rows: ScoreQueryRow[] = cachedRows
    .filter((r) => liveMessageIds.has(r.messageId))
    .map((r) => ({
      messageId: r.messageId,
      sessionId: r.sessionId,
      participantToken: tokenBySession.get(r.sessionId) ?? '',
      queryText: r.queryText,
      responseText: r.responseText,
      prevQueryText: r.prevQueryText,
      prevResponseText: r.prevResponseText,
      turnIndex: r.turnIndex,
      turnNumber: turnByMessage.get(r.messageId) ?? 0,
      queryTimestamp: r.queryTimestamp.toISOString(),
      typeA: (r.typeA as ScoreQueryRow['typeA']) ?? null,
      subtypeA: r.subtypeA ?? null,
      tagsB: Array.isArray(r.subtypeTagsB) ? (r.subtypeTagsB as string[]) : [],
      scoresB: (r.subtypeScoresB as Record<string, number> | null) ?? {},
      model: r.model ?? null,
      rawA: r.rawResponseA ?? null,
      rawB: r.rawResponseB ?? null,
    }));

  const total = records.length;
  const classified = rows.length;

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
                Intent viewer — Jelson taxonomy · two classifiers compared
              </p>
            </div>
            <InstructorHeaderActions email={instructor.email} />
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <ScoreViewer
          assignmentId={id}
          rows={rows}
          total={total}
          classified={classified}
          defaultModel={getDefaultScoreModel()}
          openaiConfigured={isOpenAIConfigured()}
          initialConfig={config}
          canEditTaxonomy={isAdministrator(instructor)}
        />
      </main>
    </div>
  );
}
