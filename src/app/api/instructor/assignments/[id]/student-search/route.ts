/**
 * Assignment detail — full-text search across a class's actual work.
 *
 * GET ?q=<term> → the sessions whose ESSAY or whose CHAT QUESTIONS contain the
 * term, with the passages that matched. The student table's search box reaches
 * only the columns the page already loaded, i.e. the participant token — which
 * answers "where is P-042" but not the question a researcher actually arrives
 * with ("who wrote about automation", "who asked the bot for a thesis"). Token
 * matching stays client-side and instant; this route covers only the two bodies
 * of text the page never had.
 *
 * Nothing is cached: at class scale (~80 essays) the two queries below cost a
 * few tens of milliseconds, and a cache would trade that for a window where a
 * just-submitted essay is missing from its own search.
 */
import { NextResponse } from 'next/server';
import { and, eq, ilike, inArray, sql } from 'drizzle-orm';
import { db } from '@/db/db';
import { chatConversations, chatMessages, editorEvents, studentSessions } from '@/db/schema';
import { authorizeAssignment, authErrorResponse } from '@/lib/score/authz';

export const dynamic = 'force-dynamic';

/** Shortest term worth a round trip. One character matches most of the class,
 * which is not a search result — the client doesn't send it. */
const MIN_QUERY = 2;
/** Passages returned per source per student. The table shows why a row matched;
 * reading the whole conversation is what Summary and Replay are for. */
const MAX_SNIPPETS = 3;
/** Ceiling on matched messages across the whole class, so a term like "the"
 * (still ≥ 2 chars) can't turn one keystroke into a megabyte of JSON. */
const MAX_MESSAGE_HITS = 500;
/** Characters of context on each side of a hit. */
const SNIPPET_RADIUS = 70;

export interface StudentSearchMatch {
  sessionId: string;
  /** Occurrences in the essay, and the first few in document order. */
  essayCount: number;
  essaySnippets: string[];
  /** Matching questions (messages, not occurrences), oldest first. */
  questionCount: number;
  questionSnippets: string[];
}

/** LIKE wildcards in the user's term are literal characters, not operators —
 * someone searching for "100%" means the string. Backslash is Postgres' default
 * LIKE escape, so escaping these three needs no ESCAPE clause. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Plain text of a BlockNote document (an editor event's payload). Walks
 * `content`/`children` for any `text`, which covers every block type the editor
 * writes without enumerating them. */
function blockText(doc: unknown): string {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    if (typeof o.text === 'string') out.push(o.text);
    walk(o.content);
    walk(o.children);
  };
  walk(doc);
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

/** Every occurrence of `needle` in `haystack`, case-insensitively, as offsets. */
function occurrences(haystack: string, needle: string): number[] {
  const hay = haystack.toLowerCase();
  const at: number[] = [];
  let i = hay.indexOf(needle);
  while (i !== -1) {
    at.push(i);
    i = hay.indexOf(needle, i + needle.length);
  }
  return at;
}

/** A window of text around one hit, elided on whichever side was cut. The
 * client re-finds the term to highlight it, so the raw text is enough. */
function snippetAt(text: string, at: number, length: number): string {
  const start = Math.max(0, at - SNIPPET_RADIUS);
  const end = Math.min(text.length, at + length + SNIPPET_RADIUS);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorizeAssignment(id);
  if ('error' in auth) {
    const { body, status } = authErrorResponse(auth.error);
    return NextResponse.json(body, { status });
  }

  const q = (new URL(request.url).searchParams.get('q') ?? '').trim();
  if (q.length < MIN_QUERY) {
    return NextResponse.json({ q, matches: [] as StudentSearchMatch[] });
  }

  const pattern = `%${escapeLike(q)}%`;

  const [questionHits, essayPicks] = await Promise.all([
    // Questions are plain text in their own column, so the database does the
    // matching. Only the student's side: an answer the chatbot wrote is not a
    // question, and matching it would put students in the results for words
    // they never used.
    db
      .select({
        sessionId: chatConversations.sessionId,
        content: chatMessages.content,
      })
      .from(chatMessages)
      .innerJoin(chatConversations, eq(chatMessages.conversationId, chatConversations.id))
      .innerJoin(studentSessions, eq(studentSessions.id, chatConversations.sessionId))
      .where(
        and(
          eq(studentSessions.assignmentId, id),
          eq(chatMessages.role, 'user'),
          ilike(chatMessages.content, pattern)
        )
      )
      .orderBy(chatMessages.timestamp, chatMessages.sequenceNumber)
      .limit(MAX_MESSAGE_HITS),

    // The essay: one document per session — the submission if there is one,
    // otherwise the newest snapshot, so a student who wrote but never submitted
    // is still searchable.
    //
    // Two things keep this cheap on a table that is mostly keystroke history
    // (over a million rows, tens of megabytes of document JSON). Selecting no
    // payload column means none of that JSON is read to find the winners. And
    // the pick is a LATERAL per session rather than one DISTINCT ON over the
    // class: given a whole assignment's sessions at once the planner stops
    // believing the session index is worth it and scans the table instead —
    // measured at 245ms against 18ms for the same answer, and the gap only
    // widens as the log grows.
    db.execute<{ id: number }>(sql`
      SELECT p.id
      FROM ${studentSessions} s
      CROSS JOIN LATERAL (
        SELECT e.id
        FROM ${editorEvents} e
        WHERE e.session_id = s.id
          AND e.event_type IN ('submission', 'snapshot')
        ORDER BY (e.event_type = 'submission') DESC, e.timestamp DESC, e.sequence_number DESC
        LIMIT 1
      ) p
      WHERE s.assignment_id = ${id}
    `),
  ]);

  const essayDocs = essayPicks.length
    ? await db
        .select({ sessionId: editorEvents.sessionId, eventData: editorEvents.eventData })
        .from(editorEvents)
        .where(
          inArray(
            editorEvents.id,
            essayPicks.map((p) => p.id)
          )
        )
    : [];

  const needle = q.toLowerCase();
  const bySession = new Map<string, StudentSearchMatch>();
  const forSession = (sessionId: string): StudentSearchMatch => {
    let m = bySession.get(sessionId);
    if (!m) {
      m = { sessionId, essayCount: 0, essaySnippets: [], questionCount: 0, questionSnippets: [] };
      bySession.set(sessionId, m);
    }
    return m;
  };

  for (const doc of essayDocs) {
    const text = blockText(doc.eventData);
    const at = occurrences(text, needle);
    if (at.length === 0) continue;
    const m = forSession(doc.sessionId);
    m.essayCount = at.length;
    m.essaySnippets = at.slice(0, MAX_SNIPPETS).map((i) => snippetAt(text, i, q.length));
  }

  for (const hit of questionHits) {
    const m = forSession(hit.sessionId);
    m.questionCount += 1;
    if (m.questionSnippets.length < MAX_SNIPPETS) {
      // ILIKE already proved the term is in there; `at` only locates it. A
      // question is short, so the window usually swallows the whole message.
      const at = occurrences(hit.content, needle)[0] ?? 0;
      m.questionSnippets.push(snippetAt(hit.content, at, q.length));
    }
  }

  return NextResponse.json({ q, matches: [...bySession.values()] });
}
