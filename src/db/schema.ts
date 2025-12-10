import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

// Instructor table for Phase 2
export const instructors = sqliteTable('instructors', {
  id: text('id').primaryKey(),
  email: text('email').unique().notNull(),
  password: text('password'), // Hashed password (null if not verified yet)
  name: text('name'),
  isVerified: integer('is_verified', { mode: 'boolean' }).default(false).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  lastLoginAt: integer('last_login_at', { mode: 'timestamp' }),
});

// Email verification tokens (for initial registration only)
export const authTokens = sqliteTable('auth_tokens', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  token: text('token').unique().notNull(),
  type: text('type').notNull().default('verification'), // 'verification' or 'password_reset'
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  used: integer('used', { mode: 'boolean' }).default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  tokenIdx: index('auth_tokens_token_idx').on(table.token),
  emailIdx: index('auth_tokens_email_idx').on(table.email),
}));

export const assignments = sqliteTable('assignments', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  instructions: text('instructions').notNull(),
  deadline: integer('deadline', { mode: 'timestamp' }).notNull(),
  shareToken: text('share_token').unique().notNull(),
  // Phase 2 fields
  instructorId: text('instructor_id'), // nullable for Phase 1
  customSystemPrompt: text('custom_system_prompt'), // nullable
  includeInstructionInPrompt: integer('include_instruction_in_prompt', { mode: 'boolean' }).default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const studentSessions = sqliteTable('student_sessions', {
  id: text('id').primaryKey(),
  assignmentId: text('assignment_id').notNull().references(() => assignments.id),
  studentName: text('student_name').notNull(),
  studentEmail: text('student_email').notNull(),
  startedAt: integer('started_at', { mode: 'timestamp' }).notNull(),
  lastSavedAt: integer('last_saved_at', { mode: 'timestamp' }),
});

export const editorEvents = sqliteTable('editor_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sessionId: text('session_id').notNull().references(() => studentSessions.id),
  eventType: text('event_type').notNull(),
  // 'transaction_step', 'paste_internal', 'paste_external', 'snapshot'
  eventData: text('event_data', { mode: 'json' }).notNull(),
  // For transaction_step: { stepType, from, to, slice, ... }
  // For snapshot: { document: BlockNote JSON }
  timestamp: integer('timestamp', { mode: 'timestamp' }).notNull(),
  sequenceNumber: integer('sequence_number').notNull(),
});

export const chatConversations = sqliteTable('chat_conversations', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => studentSessions.id),
  title: text('title').notNull(), // Auto-generated, editable
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const chatMessages = sqliteTable('chat_messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  conversationId: text('conversation_id').notNull().references(() => chatConversations.id),
  role: text('role').notNull(), // 'user' | 'assistant'
  content: text('content').notNull(),
  metadata: text('metadata', { mode: 'json' }), // { tokens, model, etc. }
  timestamp: integer('timestamp', { mode: 'timestamp' }).notNull(),
  sequenceNumber: integer('sequence_number').notNull(),
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
