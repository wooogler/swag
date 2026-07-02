/**
 * SCORE data access: turn an assignment's chat logs into "query records" and
 * ensure the cache table exists.
 *
 * A "query" = one student (user) chat message + its chatbot response, where the
 * response is the most recent assistant reply that follows the query within the
 * same conversation (single Q-A; multi-turn context is out of scope for the
 * viewer). Each query is keyed by the user message id (chat_messages.id), which
 * is globally unique and serves as the cache key.
 */
import { sql, eq, asc } from 'drizzle-orm';
import { db } from '@/db/db';
import { chatMessages, chatConversations, studentSessions } from '@/db/schema';

export interface QueryRecord {
  messageId: number;
  conversationId: string;
  sessionId: string;
  queryText: string;
  /** The chatbot reply that FOLLOWED this query. Kept for human display only —
   *  it is NOT sent to the classifier (it is downstream of the query's intent). */
  responseText: string | null;
  /** Prior context the query is reacting to (sent to the classifier): the
   *  previous student message and the chatbot reply the student had just seen. */
  prevQueryText: string | null;
  prevResponseText: string | null;
  turnIndex: number; // sequenceNumber of the user message
  queryTimestamp: Date;
}

/**
 * Defensively create the score_classifications table at runtime. Mirrors the
 * import-nirvana approach (`ADD COLUMN IF NOT EXISTS`) so the feature works even
 * on deployments where the formal drizzle migration has not been applied.
 *
 * Memoized per process and gated on a to_regclass existence check so the common
 * case (table already present) issues no DDL — avoids the repeated Postgres
 * "relation already exists, skipping" NOTICE on every request.
 */
let ensured: Promise<void> | null = null;

async function createScoreTable(): Promise<void> {
  const existing = await db.execute<{ reg: string | null }>(
    sql`SELECT to_regclass('public.score_classifications') AS reg`
  );
  if (existing[0]?.reg) {
    // Table present — add columns introduced after the initial create (raw
    // output) ONLY if missing. `ADD COLUMN IF NOT EXISTS` would emit a Postgres
    // NOTICE every time (noisy under dev hot-reload), so pre-check first.
    const cols = await db.execute<{ column_name: string }>(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'score_classifications'
        AND column_name IN ('raw_response_a', 'raw_response_b', 'prev_query_text', 'prev_response_text')
    `);
    const have = new Set(cols.map((c) => c.column_name));
    if (!have.has('raw_response_a')) {
      await db.execute(sql`ALTER TABLE "score_classifications" ADD COLUMN "raw_response_a" text`);
    }
    if (!have.has('raw_response_b')) {
      await db.execute(sql`ALTER TABLE "score_classifications" ADD COLUMN "raw_response_b" text`);
    }
    if (!have.has('prev_query_text')) {
      await db.execute(sql`ALTER TABLE "score_classifications" ADD COLUMN "prev_query_text" text`);
    }
    if (!have.has('prev_response_text')) {
      await db.execute(sql`ALTER TABLE "score_classifications" ADD COLUMN "prev_response_text" text`);
    }
    return;
  }

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "score_classifications" (
      "id" serial PRIMARY KEY NOT NULL,
      "assignment_id" text NOT NULL,
      "message_id" integer NOT NULL,
      "conversation_id" text NOT NULL,
      "session_id" text NOT NULL,
      "query_text" text NOT NULL,
      "response_text" text,
      "prev_query_text" text,
      "prev_response_text" text,
      "turn_index" integer NOT NULL,
      "query_timestamp" timestamp NOT NULL,
      "type_a" text,
      "subtype_a" text,
      "subtype_tags_b" jsonb,
      "subtype_scores_b" jsonb,
      "raw_response_a" text,
      "raw_response_b" text,
      "model" text,
      "classifier_version" integer DEFAULT 1 NOT NULL,
      "classified_at" timestamp NOT NULL
    )
  `);
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "score_classifications_assignment_idx" ON "score_classifications" USING btree ("assignment_id")`
  );
  await db.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS "score_classifications_message_unique" ON "score_classifications" USING btree ("message_id")`
  );
}

/** Defensively create the Classifier B per-subtype score table (see schema.ts). */
async function createSubtypeScoresTable(): Promise<void> {
  const existing = await db.execute<{ reg: string | null }>(
    sql`SELECT to_regclass('public.score_subtype_scores') AS reg`
  );
  if (!existing[0]?.reg) {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "score_subtype_scores" (
        "id" serial PRIMARY KEY NOT NULL,
        "assignment_id" text NOT NULL,
        "message_id" integer NOT NULL,
        "subtype_code" text NOT NULL,
        "score" integer NOT NULL,
        "def_hash" text NOT NULL,
        "raw_response" text,
        "model" text,
        "scored_at" timestamp NOT NULL
      )
    `);
  }
  // Ensure the indexes even when the table pre-exists: a crash between CREATE
  // TABLE and CREATE UNIQUE INDEX must not strand the table index-less forever —
  // every upsert targets the unique index and would fail with "no unique or
  // exclusion constraint matching the ON CONFLICT specification". Pre-check via
  // pg_indexes to avoid the noisy IF NOT EXISTS NOTICE on every boot.
  const idx = await db.execute<{ indexname: string }>(sql`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'score_subtype_scores'
  `);
  const have = new Set(idx.map((r) => r.indexname));
  if (!have.has('score_subtype_scores_assignment_idx')) {
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS "score_subtype_scores_assignment_idx" ON "score_subtype_scores" USING btree ("assignment_id")`
    );
  }
  if (!have.has('score_subtype_scores_message_subtype_unique')) {
    await db.execute(
      sql`CREATE UNIQUE INDEX IF NOT EXISTS "score_subtype_scores_message_subtype_unique" ON "score_subtype_scores" USING btree ("message_id", "subtype_code")`
    );
  }
}

export function ensureScoreTable(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await createScoreTable();
      await createSubtypeScoresTable();
    })().catch((error) => {
      ensured = null; // allow retry on next call if creation failed
      throw error;
    });
  }
  return ensured;
}

/**
 * Extract every query record for an assignment from its chat logs, ordered by
 * conversation then turn. Pairs each user message with the next assistant reply
 * that precedes the following user message (null if the query went unanswered).
 * Empty / whitespace-only user messages are skipped.
 */
export async function getQueryRecords(assignmentId: string): Promise<QueryRecord[]> {
  const rows = await db
    .select({
      messageId: chatMessages.id,
      conversationId: chatMessages.conversationId,
      sessionId: chatConversations.sessionId,
      role: chatMessages.role,
      content: chatMessages.content,
      seq: chatMessages.sequenceNumber,
      ts: chatMessages.timestamp,
    })
    .from(chatMessages)
    .innerJoin(chatConversations, eq(chatMessages.conversationId, chatConversations.id))
    .innerJoin(studentSessions, eq(chatConversations.sessionId, studentSessions.id))
    .where(eq(studentSessions.assignmentId, assignmentId))
    .orderBy(
      asc(chatMessages.conversationId),
      asc(chatMessages.sequenceNumber),
      asc(chatMessages.id)
    );

  const records: QueryRecord[] = [];
  for (let i = 0; i < rows.length; i++) {
    const m = rows[i];
    if (m.role !== 'user') continue;
    if (!m.content || !m.content.trim()) continue;

    // Find the chatbot response: next assistant message in the same
    // conversation, before the next user message. Kept for human display only.
    let responseText: string | null = null;
    for (let j = i + 1; j < rows.length; j++) {
      const next = rows[j];
      if (next.conversationId !== m.conversationId) break;
      if (next.role === 'user') break;
      if (next.role === 'assistant') {
        responseText = next.content;
        break;
      }
    }

    // Prior context — what the student had just seen before writing this query:
    // the chatbot reply immediately before it, and the student message before
    // that reply. This is the context the query is actually reacting to, so it
    // (not the following response) is what the classifier receives.
    let prevResponseText: string | null = null;
    let prevQueryText: string | null = null;
    let k = i - 1;
    for (; k >= 0; k--) {
      const p = rows[k];
      if (p.conversationId !== m.conversationId) {
        k = -1;
        break;
      }
      if (p.role === 'assistant') {
        prevResponseText = p.content;
        k--;
        break;
      }
      if (p.role === 'user') break; // consecutive student messages: no reply between
    }
    for (; k >= 0; k--) {
      const p = rows[k];
      if (p.conversationId !== m.conversationId) break;
      if (p.role === 'user' && p.content && p.content.trim()) {
        prevQueryText = p.content;
        break;
      }
    }

    records.push({
      messageId: m.messageId,
      conversationId: m.conversationId,
      sessionId: m.sessionId,
      queryText: m.content,
      responseText,
      prevQueryText,
      prevResponseText,
      turnIndex: m.seq,
      queryTimestamp: m.ts,
    });
  }

  return records;
}
