/**
 * Stage 2 of the NIRVANA -> SWAG import.
 *
 * Reads the NDJSON produced by scripts/nirvana/build_nirvana_import.py and loads
 * it into the SWAG Postgres database using the existing Drizzle schema, so the
 * 77 essays become instructor-openable sessions playable in the replay UI.
 *
 *   1. python3 scripts/nirvana/build_nirvana_import.py   # -> nirvana/nirvana-import.ndjson
 *   2. npm run db:import-nirvana
 *
 * Idempotent: re-running deletes the prior NIRVANA assignment (matched by
 * shareToken) and all of its sessions/events/conversations/messages first.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { eq, inArray, sql } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Load POSTGRES_URL from .env BEFORE importing the db module (which reads it at
// module-init time), then dynamic-import db so the connection string is set.
// ---------------------------------------------------------------------------
function loadEnv() {
  if (process.env.POSTGRES_URL || process.env.DATABASE_URL) return;
  try {
    const envText = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
    for (const line of envText.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const key = m[1];
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    // .env optional; rely on ambient env
  }
}
loadEnv();

const BASE_TIME = Date.UTC(2026, 0, 1, 0, 0, 0); // synthetic session base (2026-01-01Z)
const SESSION_SPACING_MS = 60 * 60 * 1000; // 1h apart so "Started" times are distinct
const NDJSON_PATH = resolve(process.cwd(), 'nirvana', 'nirvana-import.ndjson');
const CHUNK = 500;

interface SeedLine {
  kind: 'seed';
  ownerEmail: string;
  shareToken: string;
  title: string;
  instructions: string;
}
interface EventLine {
  type: 'snapshot' | 'submission' | 'paste_internal';
  rel: number;
  seq: number;
  data: unknown;
}
interface MessageLine {
  role: 'user' | 'assistant';
  content: string;
  rel: number;
  seq: number;
}
interface SessionLine {
  kind: 'session';
  essayNum: number;
  participantToken: string;
  studentEmail: string;
  studentFirstName: string;
  studentLastName: string;
  metadata: Record<string, unknown>;
  events: EventLine[];
  conversation: { title: string } | null;
  messages: MessageLine[];
}

async function chunkedInsert<T>(
  insert: (rows: T[]) => Promise<unknown>,
  rows: T[],
) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    await insert(rows.slice(i, i + CHUNK));
  }
}

async function main() {
  const { db } = await import('./db');
  const { assignments, studentSessions, editorEvents, chatConversations, chatMessages, instructors } =
    await import('./schema');

  // Ensure the metadata column exists even if the formal migration hasn't run.
  await db.execute(sql`ALTER TABLE student_sessions ADD COLUMN IF NOT EXISTS metadata jsonb`);

  // Parse NDJSON
  const lines = readFileSync(NDJSON_PATH, 'utf8').split('\n').filter((l) => l.trim().length > 0);
  const seed = JSON.parse(lines[0]) as SeedLine;
  const sessions = lines.slice(1).map((l) => JSON.parse(l) as SessionLine);
  console.log(`📦 Parsed ${sessions.length} sessions from ${NDJSON_PATH}`);

  // ---- Resolve owner instructor -----------------------------------------
  let owner = await db.query.instructors.findFirst({ where: eq(instructors.email, seed.ownerEmail) });
  if (!owner) {
    owner = await db.query.instructors.findFirst({ where: eq(instructors.role, 'administrator') });
  }
  if (!owner) {
    const id = crypto.randomUUID();
    await db.insert(instructors).values({
      id,
      email: 'nirvana-import@dataset.local',
      role: 'administrator',
      isVerified: true,
      createdAt: new Date(),
    });
    owner = await db.query.instructors.findFirst({ where: eq(instructors.id, id) });
  }
  if (!owner) throw new Error('Could not resolve or create an owner instructor');
  console.log(`👤 Owner instructor: ${owner.email} (${owner.role})`);

  // ---- Idempotent cleanup of any prior NIRVANA import --------------------
  const prior = await db.query.assignments.findFirst({ where: eq(assignments.shareToken, seed.shareToken) });
  if (prior) {
    const priorSessions = await db
      .select({ id: studentSessions.id })
      .from(studentSessions)
      .where(eq(studentSessions.assignmentId, prior.id));
    const sessionIds = priorSessions.map((s) => s.id);
    if (sessionIds.length > 0) {
      const priorConvs = await db
        .select({ id: chatConversations.id })
        .from(chatConversations)
        .where(inArray(chatConversations.sessionId, sessionIds));
      const convIds = priorConvs.map((c) => c.id);
      if (convIds.length > 0) {
        await db.delete(chatMessages).where(inArray(chatMessages.conversationId, convIds));
        await db.delete(chatConversations).where(inArray(chatConversations.sessionId, sessionIds));
      }
      await db.delete(editorEvents).where(inArray(editorEvents.sessionId, sessionIds));
      await db.delete(studentSessions).where(eq(studentSessions.assignmentId, prior.id));
    }
    await db.delete(assignments).where(eq(assignments.id, prior.id));
    console.log(`🧹 Removed prior import (${sessionIds.length} sessions)`);
  }

  // ---- Insert assignment -------------------------------------------------
  const assignmentId = crypto.randomUUID();
  await db.insert(assignments).values({
    id: assignmentId,
    title: seed.title,
    instructions: seed.instructions,
    deadline: new Date(BASE_TIME),
    shareToken: seed.shareToken,
    instructorId: owner.id,
    // NIRVANA's chatbot ran with NO default system prompt, so store an empty
    // guidance (surfaced as blank in the "How the AI helps" tab) rather than the
    // app's default writing-coach prompt.
    customSystemPrompt: '',
    includeInstructionInPrompt: false,
    createdAt: new Date(),
  });

  // ---- Insert sessions + events + chat -----------------------------------
  let totalEvents = 0;
  let totalMsgs = 0;
  for (const s of sessions) {
    const startedAt = BASE_TIME + s.essayNum * SESSION_SPACING_MS;
    const sessionId = crypto.randomUUID();

    await db.insert(studentSessions).values({
      id: sessionId,
      assignmentId,
      participantToken: s.participantToken,
      studentFirstName: s.studentFirstName,
      studentLastName: s.studentLastName,
      studentEmail: s.studentEmail,
      isVerified: true,
      startedAt: new Date(startedAt),
      lastSavedAt: new Date(startedAt + (s.events.at(-1)?.rel ?? 0)),
      metadata: s.metadata,
    });

    const eventRows = s.events.map((e) => ({
      sessionId,
      eventType: e.type,
      eventData: (e.data ?? {}) as Record<string, unknown>,
      timestamp: new Date(startedAt + e.rel),
      sequenceNumber: e.seq,
    }));
    await chunkedInsert((rows) => db.insert(editorEvents).values(rows), eventRows);
    totalEvents += eventRows.length;

    if (s.conversation && s.messages.length > 0) {
      const conversationId = crypto.randomUUID();
      await db.insert(chatConversations).values({
        id: conversationId,
        sessionId,
        title: s.conversation.title,
        createdAt: new Date(startedAt + (s.messages[0]?.rel ?? 0)),
      });
      const msgRows = s.messages.map((m) => ({
        conversationId,
        role: m.role,
        content: m.content,
        metadata: m.role === 'assistant' ? { model: 'gpt-3.5-turbo', source: 'nirvana' } : { source: 'nirvana' },
        timestamp: new Date(startedAt + m.rel),
        sequenceNumber: m.seq,
      }));
      await chunkedInsert((rows) => db.insert(chatMessages).values(rows), msgRows);
      totalMsgs += msgRows.length;
    }
  }

  console.log('✅ NIRVANA import complete');
  console.log(`   assignment : ${assignmentId}`);
  console.log(`   sessions   : ${sessions.length}`);
  console.log(`   events     : ${totalEvents}`);
  console.log(`   messages   : ${totalMsgs}`);
  console.log('');
  console.log(`🔗 Open in SWAG (as ${owner.email} or any administrator):`);
  console.log(`   Assignment: /instructor/assignments/${assignmentId}`);
  console.log(`   Dashboard : /instructor/dashboard  ->  "${seed.title}"`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ NIRVANA import failed:', err);
    process.exit(1);
  });
