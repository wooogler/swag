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

// ---------------------------------------------------------------------------
// SCORE v6 — instructor-created Intents with Rules (per assignment).
//
// Unlike score_config (global Jelson taxonomy, demoted to a tagging/browse
// layer), intents are the real classification units: each is a WHEN
// (definition) that owns one THEN (rule) injected on top of the assignment's
// Base Prompt. See src/lib/score/intents.ts and the v6 design doc.
// Tables are created by runtime DDL in src/lib/score/intent-store.ts (the
// migration journal is not used for recent tables).
// ---------------------------------------------------------------------------

export const scoreIntents = pgTable('score_intents', {
  id: serial('id').primaryKey(),
  assignmentId: text('assignment_id').notNull().references(() => assignments.id),
  title: text('title').notNull(), // short card label
  definition: text('definition').notNull(), // the WHEN — what the classifier rates against
  rule: text('rule'), // the THEN — response guideline; null = "No rule yet → base prompt applies"
  // Soft delete: ratings/pins/versions keep referencing archived intents so
  // history and granular revert stay reconstructible.
  archived: boolean('archived').notNull().default(false),
  // Pre-built starter-set template: rated in advance (via "Run all") but NOT
  // owning the log — excluded from the active set until activated (→ false).
  isTemplate: boolean('is_template').notNull().default(false),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
}, (table) => ({
  assignmentIdx: index('score_intents_assignment_idx').on(table.assignmentId),
}));

// Per-(message, intent, def_hash) 5-level rating + short rationale. Keyed by
// def_hash so every (definition + pins) combination ever rated KEEPS its rows —
// version checkout/rollback re-reads them instantly; only never-seen
// combinations cost LLM calls. Readers pick the current-hash row when present,
// else the latest row (shown as stale).
export const scoreIntentRatings = pgTable('score_intent_ratings', {
  id: serial('id').primaryKey(),
  assignmentId: text('assignment_id').notNull().references(() => assignments.id),
  messageId: integer('message_id').notNull().references(() => chatMessages.id),
  intentId: integer('intent_id').notNull().references(() => scoreIntents.id),
  rating: text('rating').notNull(), // RatingLevel (clearly_in … clearly_out)
  rationale: text('rationale'), // ≤10 words, emitted before the rating
  // intentDefHash(definition, promptPins) at rating time; mismatch = re-rate.
  defHash: text('def_hash').notNull(),
  rawResponse: text('raw_response'),
  model: text('model'),
  ratedAt: timestamp('rated_at').notNull(),
}, (table) => ({
  assignmentIdx: index('score_intent_ratings_assignment_idx').on(table.assignmentId),
  intentIdx: index('score_intent_ratings_intent_idx').on(table.intentId),
  messageIntentHashUnique: uniqueIndex('score_intent_ratings_message_intent_hash_unique').on(
    table.messageId,
    table.intentId,
    table.defHash
  ),
}));

// Boundary Examples ("pins") — instructor in/out verdicts on ambiguous
// questions. The latest few are injected into the rating prompt as contrast
// examples. query_text is snapshotted at pin time (same denormalization as
// score_classifications) so prompt building needs no joins.
export const scoreIntentPins = pgTable('score_intent_pins', {
  id: serial('id').primaryKey(),
  assignmentId: text('assignment_id').notNull().references(() => assignments.id),
  intentId: integer('intent_id').notNull().references(() => scoreIntents.id),
  messageId: integer('message_id').notNull().references(() => chatMessages.id),
  verdict: text('verdict').notNull(), // 'in' | 'out'
  queryText: text('query_text').notNull(),
  source: text('source').notNull().default('manual'), // 'manual' | 'ownership' | …
  createdAt: timestamp('created_at').notNull(),
}, (table) => ({
  assignmentIdx: index('score_intent_pins_assignment_idx').on(table.assignmentId),
  intentMessageUnique: uniqueIndex('score_intent_pins_intent_message_unique').on(
    table.intentId,
    table.messageId
  ),
}));

// Exception Links — "A except B": when a question is included by both, B owns
// it. Applied deterministically in the assignment resolver (zero LLM cost);
// deleting the link restores the previous behavior.
export const scoreIntentLinks = pgTable('score_intent_links', {
  id: serial('id').primaryKey(),
  assignmentId: text('assignment_id').notNull().references(() => assignments.id),
  fromIntentId: integer('from_intent_id').notNull().references(() => scoreIntents.id),
  toIntentId: integer('to_intent_id').notNull().references(() => scoreIntents.id),
  createdAt: timestamp('created_at').notNull(),
}, (table) => ({
  assignmentIdx: index('score_intent_links_assignment_idx').on(table.assignmentId),
  pairUnique: uniqueIndex('score_intent_links_pair_unique').on(
    table.fromIntentId,
    table.toIntentId
  ),
}));

// Immediate-apply versioning (§1.11): every approved config change writes a
// FULL snapshot (intents + pins + links + prompt versions + base prompt ref)
// plus a summary of what changed. Diffs are computed at read time (git-style);
// granular revert creates a NEW snapshot. No deploy gate.
export const scoreConfigVersions = pgTable('score_config_versions', {
  id: serial('id').primaryKey(),
  assignmentId: text('assignment_id').notNull().references(() => assignments.id),
  versionNo: integer('version_no').notNull(),
  snapshot: jsonb('snapshot').notNull(), // IntentConfigSnapshot
  summary: jsonb('summary').notNull(), // { action, intentIds, messageId?, detail? }
  createdBy: text('created_by'), // instructors.id
  createdAt: timestamp('created_at').notNull(),
}, (table) => ({
  assignmentVersionUnique: uniqueIndex('score_config_versions_assignment_version_unique').on(
    table.assignmentId,
    table.versionNo
  ),
}));

// Cached rule-preview responses (§1.7/§4.6): what the chatbot WOULD answer to
// a question under Base Prompt + one intent's Rule. Generated on demand for
// ownership comparisons (and later the Revise before/after), keyed per
// (message, intent) with a prompt_hash covering base+rule+model — any edit
// regenerates. Indicative single-turn output, never shown to students.
export const scoreRulePreviews = pgTable('score_rule_previews', {
  id: serial('id').primaryKey(),
  assignmentId: text('assignment_id').notNull().references(() => assignments.id),
  messageId: integer('message_id').notNull().references(() => chatMessages.id),
  intentId: integer('intent_id').notNull().references(() => scoreIntents.id),
  // rulePreviewHash(model, basePrompt, rule) at generation time.
  promptHash: text('prompt_hash').notNull(),
  response: text('response').notNull(),
  model: text('model'),
  createdAt: timestamp('created_at').notNull(),
}, (table) => ({
  assignmentIdx: index('score_rule_previews_assignment_idx').on(table.assignmentId),
  messageIntentUnique: uniqueIndex('score_rule_previews_message_intent_unique').on(
    table.messageId,
    table.intentId
  ),
}));

// Query embeddings (P3): one vector per student message, used to order the
// Revise modal's edge-case sweep (semantic distance from the anchor question)
// at zero LLM cost per sweep. Stored as a jsonb number[] — assignment logs
// are a few hundred rows, so in-memory cosine beats a pgvector dependency.
export const scoreQueryEmbeddings = pgTable('score_query_embeddings', {
  id: serial('id').primaryKey(),
  assignmentId: text('assignment_id').notNull().references(() => assignments.id),
  messageId: integer('message_id').notNull().references(() => chatMessages.id),
  embedding: jsonb('embedding').notNull(), // number[]
  model: text('model').notNull(),
  createdAt: timestamp('created_at').notNull(),
}, (table) => ({
  assignmentIdx: index('score_query_embeddings_assignment_idx').on(table.assignmentId),
  messageUnique: uniqueIndex('score_query_embeddings_message_unique').on(table.messageId),
}));

// Message dissection (§1.4a): Material kinds + verbatim Request substrings,
// one row per student message. Intent-independent, so it lives apart from
// ratings and is versioned by DISSECTION_VERSION alone.
export const scoreDissections = pgTable('score_dissections', {
  id: serial('id').primaryKey(),
  assignmentId: text('assignment_id').notNull().references(() => assignments.id),
  messageId: integer('message_id').notNull().references(() => chatMessages.id),
  materialKinds: jsonb('material_kinds').notNull(), // MaterialKind[]
  requests: jsonb('requests').notNull(), // string[] — verbatim substrings
  version: integer('version').notNull(), // DISSECTION_VERSION at write time
  rawResponse: text('raw_response'),
  model: text('model'),
  createdAt: timestamp('created_at').notNull(),
}, (table) => ({
  assignmentIdx: index('score_dissections_assignment_idx').on(table.assignmentId),
  messageUnique: uniqueIndex('score_dissections_message_unique').on(table.messageId),
}));

// Chatbot DEPLOY versions: each Deploy freezes the assignment's intent→rule
// set (active intents' definitions, rules, prompt pins, exception links) as a
// numbered snapshot. The STUDENT chat runtime (/api/chat) always serves the
// LATEST deploy — instructors edit intents freely on the SCORE board without
// touching students until they press Deploy. Base prompt stays live (§1.9:
// managed in assignment settings, outside the SCORE loop); it is recorded in
// the snapshot for reference only.
export const scoreChatDeploys = pgTable('score_chat_deploys', {
  id: serial('id').primaryKey(),
  assignmentId: text('assignment_id').notNull().references(() => assignments.id),
  versionNo: integer('version_no').notNull(),
  snapshot: jsonb('snapshot').notNull(), // ChatDeploySnapshot (deploy-store.ts)
  note: text('note'),
  createdBy: text('created_by'), // instructors.id
  createdAt: timestamp('created_at').notNull(),
}, (table) => ({
  assignmentIdx: index('score_chat_deploys_assignment_idx').on(table.assignmentId),
  assignmentVersionUnique: uniqueIndex('score_chat_deploys_assignment_version_unique').on(
    table.assignmentId,
    table.versionNo
  ),
}));

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

export type ScoreIntent = typeof scoreIntents.$inferSelect;
export type NewScoreIntent = typeof scoreIntents.$inferInsert;

export type ScoreIntentRating = typeof scoreIntentRatings.$inferSelect;
export type NewScoreIntentRating = typeof scoreIntentRatings.$inferInsert;

export type ScoreIntentPin = typeof scoreIntentPins.$inferSelect;
export type NewScoreIntentPin = typeof scoreIntentPins.$inferInsert;

export type ScoreIntentLink = typeof scoreIntentLinks.$inferSelect;
export type NewScoreIntentLink = typeof scoreIntentLinks.$inferInsert;

export type ScoreConfigVersion = typeof scoreConfigVersions.$inferSelect;
export type NewScoreConfigVersion = typeof scoreConfigVersions.$inferInsert;

export type ScoreDissection = typeof scoreDissections.$inferSelect;
export type NewScoreDissection = typeof scoreDissections.$inferInsert;

export type ScoreRulePreview = typeof scoreRulePreviews.$inferSelect;
export type NewScoreRulePreview = typeof scoreRulePreviews.$inferInsert;

export type ScoreQueryEmbedding = typeof scoreQueryEmbeddings.$inferSelect;
export type NewScoreQueryEmbedding = typeof scoreQueryEmbeddings.$inferInsert;

export type ScoreChatDeploy = typeof scoreChatDeploys.$inferSelect;
export type NewScoreChatDeploy = typeof scoreChatDeploys.$inferInsert;
