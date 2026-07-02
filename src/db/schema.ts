import { pgTable, text, timestamp, boolean, serial, jsonb, index, uniqueIndex, integer } from 'drizzle-orm/pg-core';
import { DEFAULT_ASSIGNMENT_AI_GUIDANCE } from '../lib/assignment-ai';

// Instructor table for Phase 2
export const instructors = pgTable('instructors', {
  id: text('id').primaryKey(),
  email: text('email').unique().notNull(),
  password: text('password'), // Hashed password (null if not verified yet)
  firstName: text('first_name'),
  lastName: text('last_name'),
  role: text('role').notNull().default('instructor'), // 'instructor' | 'administrator' | 'student'
  isVerified: boolean('is_verified').default(false).notNull(),
  createdAt: timestamp('created_at').notNull(),
  lastLoginAt: timestamp('last_login_at'),
});

// Email verification tokens (for initial registration only)
export const authTokens = pgTable('auth_tokens', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  token: text('token').unique().notNull(),
  type: text('type').notNull().default('verification'), // 'verification' or 'password_reset'
  expiresAt: timestamp('expires_at').notNull(),
  used: boolean('used').default(false),
  createdAt: timestamp('created_at').notNull(),
}, (table) => ({
  tokenIdx: index('auth_tokens_token_idx').on(table.token),
  emailIdx: index('auth_tokens_email_idx').on(table.email),
}));

export const assignments = pgTable('assignments', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  instructions: text('instructions').notNull(),
  criteria: text('criteria'),
  deadline: timestamp('deadline').notNull(),
  shareToken: text('share_token').unique().notNull(),
  // Phase 2 fields
  instructorId: text('instructor_id'), // nullable for Phase 1
  customSystemPrompt: text('custom_system_prompt').notNull().default(DEFAULT_ASSIGNMENT_AI_GUIDANCE),
  includeInstructionInPrompt: boolean('include_instruction_in_prompt').default(false),
  allowWebSearch: boolean('allow_web_search').default(false),
  strictPasteBlocking: boolean('strict_paste_blocking').default(false),
  createdAt: timestamp('created_at').notNull(),
});

export const studentSessions = pgTable('student_sessions', {
  id: text('id').primaryKey(),
  assignmentId: text('assignment_id').notNull().references(() => assignments.id),
  userId: text('user_id').references(() => instructors.id),
  participantToken: text('participant_token').notNull().default(''),
  studentFirstName: text('student_first_name').notNull(),
  studentLastName: text('student_last_name').notNull(),
  studentEmail: text('student_email').notNull(),
  password: text('password'), // Hashed password (null if not verified yet)
  isVerified: boolean('is_verified').default(false).notNull(),
  startedAt: timestamp('started_at').notNull(),
  lastSavedAt: timestamp('last_saved_at'),
  lastLoginAt: timestamp('last_login_at'),
  // Free-form per-session attributes (e.g. imported NIRVANA participant survey
  // scales, writer-profile groupings, readability, and aggregate metrics).
  metadata: jsonb('metadata'),
});

export const editorEvents = pgTable('editor_events', {
  id: serial('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => studentSessions.id),
  eventType: text('event_type').notNull(),
  // 'paste_internal', 'paste_external', 'snapshot', 'submission', 'typing_op', 'editor_selection', 'chat_input', 'chat_web_search_toggle'
  eventData: jsonb('event_data').notNull(),
  // For snapshot: BlockNote document JSON array
  // For paste: { content: string }
  timestamp: timestamp('timestamp').notNull(),
  sequenceNumber: integer('sequence_number').notNull(),
});

export const chatConversations = pgTable('chat_conversations', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => studentSessions.id),
  title: text('title').notNull(), // Auto-generated, editable
  createdAt: timestamp('created_at').notNull(),
});

export const chatMessages = pgTable('chat_messages', {
  id: serial('id').primaryKey(),
  conversationId: text('conversation_id').notNull().references(() => chatConversations.id),
  role: text('role').notNull(), // 'user' | 'assistant'
  content: text('content').notNull(),
  metadata: jsonb('metadata'), // { tokens, model, etc. }
  timestamp: timestamp('timestamp').notNull(),
  sequenceNumber: integer('sequence_number').notNull(),
});

// SCORE — cached intent classifications of student->chatbot queries.
// One row per "query" (a single student message + its chatbot response),
// holding the results of BOTH classifiers so the viewer can compare them.
// See docs/SCORE_viewer_spec.md and src/lib/score/.
export const scoreClassifications = pgTable('score_classifications', {
  id: serial('id').primaryKey(),
  assignmentId: text('assignment_id').notNull().references(() => assignments.id),
  // The student (user) chat message this classification is about.
  messageId: integer('message_id').notNull().references(() => chatMessages.id),
  conversationId: text('conversation_id').notNull().references(() => chatConversations.id),
  sessionId: text('session_id').notNull().references(() => studentSessions.id),
  // Snapshot of the Q-A pair at classification time (the response is the most
  // recent chatbot reply that followed the query within the same conversation).
  // responseText is kept for human display only — it is NOT sent to the model.
  queryText: text('query_text').notNull(),
  responseText: text('response_text'),
  // Prior context actually sent to the classifier: the previous student message
  // and the chatbot reply the student had just seen before writing this query.
  // This is what the query is reacting to (see src/lib/score/prompts.ts).
  prevQueryText: text('prev_query_text'),
  prevResponseText: text('prev_response_text'),
  turnIndex: integer('turn_index').notNull(), // sequenceNumber of the user message
  queryTimestamp: timestamp('query_timestamp').notNull(),
  // Classifier A — Hierarchical single-label: exactly one Type + one Subtype.
  typeA: text('type_a'), // 'Planning' | 'Translating' | 'Reviewing' | 'All'
  subtypeA: text('subtype_a'), // e.g. 'PL01'
  // Classifier B — Per-subtype binary multi-tag.
  subtypeTagsB: jsonb('subtype_tags_b'), // string[] of subtype codes that fired
  subtypeScoresB: jsonb('subtype_scores_b'), // Record<subtypeCode, 0-10 score>
  // Raw model output for each classifier (for the prompt/result preview modal).
  rawResponseA: text('raw_response_a'),
  rawResponseB: text('raw_response_b'),
  model: text('model'),
  classifierVersion: integer('classifier_version').notNull().default(1),
  classifiedAt: timestamp('classified_at').notNull(),
}, (table) => ({
  assignmentIdx: index('score_classifications_assignment_idx').on(table.assignmentId),
  messageUnique: uniqueIndex('score_classifications_message_unique').on(table.messageId),
}));

// SCORE Classifier B — per-subtype independent scores.
//
// Unlike Classifier A (one joint call per message, stored on
// score_classifications), B scores each subtype in ITS OWN call, in isolation.
// That independence is what lets us cache partially: one row per
// (message, subtype). When an instructor edits ONE subtype's definition/examples
// its defHash changes and only that subtype's rows are re-scored on the next
// run; every other subtype's rows stay valid. Adding a subtype only computes the
// new column; deleting one drops it — the rest are untouched.
//
// The 0-10 "fired" threshold is applied at READ time (adjustable live in the
// viewer), so only the raw score is persisted here — never the derived tags.
export const scoreSubtypeScores = pgTable('score_subtype_scores', {
  id: serial('id').primaryKey(),
  assignmentId: text('assignment_id').notNull().references(() => assignments.id),
  messageId: integer('message_id').notNull().references(() => chatMessages.id),
  subtypeCode: text('subtype_code').notNull(), // e.g. 'PL01'
  score: integer('score').notNull(), // 0-10
  // hash(rubric version + this subtype's code/label/description/examples). A
  // mismatch vs the current config means this subtype was edited → re-score.
  defHash: text('def_hash').notNull(),
  rawResponse: text('raw_response'), // raw model output (preview/debug)
  model: text('model'),
  scoredAt: timestamp('scored_at').notNull(),
}, (table) => ({
  assignmentIdx: index('score_subtype_scores_assignment_idx').on(table.assignmentId),
  // One score per (message, subtype); upserts target this.
  messageSubtypeUnique: uniqueIndex('score_subtype_scores_message_subtype_unique').on(
    table.messageId,
    table.subtypeCode
  ),
}));

// SCORE — editable taxonomy + few-shot config (singleton row, id='default').
// Drives both the viewer and the classifier prompts. See src/lib/score/config.ts.
export const scoreConfig = pgTable('score_config', {
  id: text('id').primaryKey(),
  config: jsonb('config').notNull(), // ScoreConfig
  updatedAt: timestamp('updated_at').notNull(),
});

// TypeScript types
export type Assignment = typeof assignments.$inferSelect;
export type NewAssignment = typeof assignments.$inferInsert;

export type StudentSession = typeof studentSessions.$inferSelect;
export type NewStudentSession = typeof studentSessions.$inferInsert;

export type EditorEvent = typeof editorEvents.$inferSelect;
export type NewEditorEvent = typeof editorEvents.$inferInsert;

export type ChatConversation = typeof chatConversations.$inferSelect;
export type NewChatConversation = typeof chatConversations.$inferInsert;

export type ChatMessage = typeof chatMessages.$inferSelect;
export type NewChatMessage = typeof chatMessages.$inferInsert;

export type Instructor = typeof instructors.$inferSelect;
export type NewInstructor = typeof instructors.$inferInsert;

export type AuthToken = typeof authTokens.$inferSelect;
export type NewAuthToken = typeof authTokens.$inferInsert;

export type ScoreClassification = typeof scoreClassifications.$inferSelect;
export type NewScoreClassification = typeof scoreClassifications.$inferInsert;

export type ScoreSubtypeScore = typeof scoreSubtypeScores.$inferSelect;
export type NewScoreSubtypeScore = typeof scoreSubtypeScores.$inferInsert;

export type ScoreConfigRow = typeof scoreConfig.$inferSelect;
export type NewScoreConfigRow = typeof scoreConfig.$inferInsert;
