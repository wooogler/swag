import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, boolean, serial, jsonb, index, uniqueIndex, integer, doublePrecision, smallint } from 'drizzle-orm/pg-core';
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
  // --- v7 intent tree (see docs/SCORE_v7_intent_tree_design.md) -------------
  // What this row IS, replacing the PROMPT_HOLDER_TITLE string sentinel:
  //   'intent'        — an instructor-authored set, judged and routable
  //   'type_root'     — one of the 4 fixed query types; never judged, its rule
  //                     is the type's final else (the chain's last stop)
  //   'prompt_holder' — the baseline condition's monolithic-rule container
  // Only 'intent' rows enter the judged (promptReady) set.
  kind: text('kind').notNull().default('intent'),
  // ScoreQueryType ('planning'|'translating'|'reviewing'|'drafting'). Required
  // on type_root rows; on 'intent' rows it scopes judgment to that type's
  // queries. NULL = not yet migrated → treated whole-log (transitional).
  type: text('type'),
  // Enclosing set (NULL = direct child of its type root). Deliberately NO
  // foreign key: runtime DDL creates these tables without FKs, and a parent is
  // resolved in code by the chain compiler.
  parentIntentId: integer('parent_intent_id'),
  // Sibling order key; effective order is (position ?? id, id) so untouched
  // rows keep creation order. Reorders write fractional midpoints. NEVER part
  // of intentDefHash — reordering must cost zero LLM calls.
  position: doublePrecision('position'),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
}, (table) => ({
  assignmentIdx: index('score_intents_assignment_idx').on(table.assignmentId),
  // Exactly one root per (assignment, type) — makes ensureTypeRoots' insert
  // idempotent under concurrent page loads (ON CONFLICT DO NOTHING).
  typeRootUnique: uniqueIndex('score_intents_type_root_unique')
    .on(table.assignmentId, table.type)
    .where(sql`kind = 'type_root'`),
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
  // Why the instructor overruled the judge. Asked only when the correction
  // DISAGREES with the current rating (out on an in-leaning one, in on an
  // out-leaning one) — agreement carries no information to fold. This is the
  // fold's main fuel: a reason becomes a principle in the definition, whereas a
  // bare verdict can only become another example.
  reason: text('reason'),
  source: text('source').notNull().default('manual'), // 'manual' | 'ownership' | …
  /**
   * A DECISION'S STANDING, not its lifetime. Two values:
   *
   * 'pending' — made, and not yet folded into the definition.
   * 'taught'  — folded in at least once. NOT retired: the decision stays a
   *             live claim about this question, and every later fold takes it
   *             along.
   *
   * It used to be three, and the third ('consumed') is why this comment is
   * long. A consumed decision was a receipt — "you marked this in at v2" — and
   * nothing more: it left the fold's input, so the definition was free to drift
   * off it, and the drift showed up only as one quiet line inside a row. The
   * pilot's participant re-taught the same three questions three times each
   * without ever being told a decision had been reversed, and paid for it in
   * definition length. Keeping the decision means the definition can be checked
   * against it forever, which is the whole point of having written it down.
   *
   * 'held' is the historical spelling of "taught but not reproduced". That is
   * now computed, not stored (see `holds` in the ratings route): a stored flag
   * went stale the moment the next re-rating disagreed with it.
   */
  status: text('status').notNull().default('pending'),
  /** The intent version a fold last carried this decision into. Display only —
   * clones start their own version timeline, so it is never a join key. */
  consumedAtVersion: integer('consumed_at_version'),
  consumedAt: timestamp('consumed_at'),
  /** How many folds have taken this decision in. >1 means it was re-taught —
   * the signal that a definition keeps losing it, and the question may belong
   * to a different intent rather than to a wider version of this one. */
  taughtCount: integer('taught_count').notNull().default(0),
  createdAt: timestamp('created_at').notNull(),
}, (table) => ({
  assignmentIdx: index('score_intent_pins_assignment_idx').on(table.assignmentId),
  // One decision per (intent, question). Ruling on a question that already has
  // a decision REPLACES it and returns the row to 'pending' — you are teaching
  // the same question again, and `taught_count` keeps the count of how often.
  intentMessageUnique: uniqueIndex('score_intent_pins_intent_message_unique').on(
    table.intentId,
    table.messageId
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

// Conversation digests: the thread BEFORE an anchor message, compacted into a
// context brief for preview generation (chatbot voice stripped, the referenced
// draft re-attributed to the student). Rule-independent — one row per anchor,
// reused across every rule/variant preview of that anchor. `version` is
// CONVERSATION_DIGEST_VERSION at write time; bumping it regenerates.
export const scoreConversationDigests = pgTable('score_conversation_digests', {
  id: serial('id').primaryKey(),
  assignmentId: text('assignment_id').notNull().references(() => assignments.id),
  messageId: integer('message_id').notNull().references(() => chatMessages.id),
  digest: text('digest').notNull(),
  model: text('model'),
  version: integer('version').notNull(),
  createdAt: timestamp('created_at').notNull(),
}, (table) => ({
  assignmentIdx: index('score_conversation_digests_assignment_idx').on(table.assignmentId),
  messageUnique: uniqueIndex('score_conversation_digests_message_unique').on(table.messageId),
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
  materialKinds: jsonb('material_kinds').notNull(), // MaterialKind[] — message-wide set
  requests: jsonb('requests').notNull(), // string[] — verbatim substrings
  materials: jsonb('materials'), // MaterialSpan[] — per-run kind + coverage (v4+; null on older rows)
  version: integer('version').notNull(), // DISSECTION_VERSION at write time
  rawResponse: text('raw_response'),
  model: text('model'),
  createdAt: timestamp('created_at').notNull(),
}, (table) => ({
  assignmentIdx: index('score_dissections_assignment_idx').on(table.assignmentId),
  messageUnique: uniqueIndex('score_dissections_message_unique').on(table.messageId),
}));

// v7 type layer: which of the 4 fixed query types a student message belongs to
// (see docs/SCORE_v7_intent_tree_design.md §3.1). One row per message, and the
// judgment is made ONCE PER MESSAGE EVER — message content is immutable, so the
// only invalidation is a TYPE_CLASSIFIER_VERSION bump (rows below it are stale
// and re-classified on the next rate batch). Shape mirrors score_dissections.
export const scoreQueryTypes = pgTable('score_query_types', {
  id: serial('id').primaryKey(),
  assignmentId: text('assignment_id').notNull().references(() => assignments.id),
  messageId: integer('message_id').notNull().references(() => chatMessages.id),
  type: text('type').notNull(), // ScoreQueryType
  rationale: text('rationale'), // short, emitted BEFORE the type
  version: integer('version').notNull(), // TYPE_CLASSIFIER_VERSION at write time
  rawResponse: text('raw_response'),
  model: text('model'),
  createdAt: timestamp('created_at').notNull(),
}, (table) => ({
  assignmentIdx: index('score_query_types_assignment_idx').on(table.assignmentId),
  // Single-column unique: the upsert target (chat_messages ids are global).
  messageUnique: uniqueIndex('score_query_types_message_unique').on(table.messageId),
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

// Per-intent RULE version history (P3, Revise modal) — SEPARATE from the intent
// config-version timeline (scoreConfigVersions): rule edits are their own axis.
// Each Save records the rule text + the anchor's Updated Response under it (so a
// version retrieves with its preview) + which GUI action produced it.
export const scoreRuleVersions = pgTable('score_rule_versions', {
  id: serial('id').primaryKey(),
  assignmentId: text('assignment_id').notNull().references(() => assignments.id),
  intentId: integer('intent_id').notNull().references(() => scoreIntents.id),
  versionNo: integer('version_no').notNull(), // this intent's own rule seq (v1, v2, …)
  name: text('name'), // short git-commit-style label naming the rule
  rule: text('rule'), // null = no rule (base prompt only)
  updatedResponse: text('updated_response'), // the anchor's Updated Response under this rule
  anchorMessageId: integer('anchor_message_id'),
  source: text('source').notNull(), // 'direct' | 'feedback' | 'rewrite' | 'manual'
  note: text('note'),
  // The instructor input that produced this step, verbatim — the feedback text,
  // or the confirmed intents behind a rewrite. The feedback chat is
  // reconstructed from versions on reopen, and this is the user half of it.
  instruction: text('instruction'),
  // MINOR version: a simulated preview (feedback / direct edit / rewrite) —
  // checkout-able and revertible, but not a Save. Majors advance the live rule.
  minor: boolean('minor').default(false).notNull(),
  createdBy: text('created_by'), // instructors.id
  createdAt: timestamp('created_at').notNull(),
}, (table) => ({
  assignmentIdx: index('score_rule_versions_assignment_idx').on(table.assignmentId),
  intentVersionUnique: uniqueIndex('score_rule_versions_intent_version_unique').on(
    table.intentId,
    table.versionNo
  ),
}));

// Responses generated under a SPECIFIC saved rule version ("apply to intent" in
// the Revise modal): one row per (rule version, message). Powers the board's
// per-query version chip and the viewer's version dropdown — past behavior
// retrieves with zero LLM calls.
export const scoreRuleVersionResponses = pgTable('score_rule_version_responses', {
  id: serial('id').primaryKey(),
  assignmentId: text('assignment_id').notNull().references(() => assignments.id),
  intentId: integer('intent_id').notNull().references(() => scoreIntents.id),
  ruleVersionId: integer('rule_version_id').notNull().references(() => scoreRuleVersions.id),
  versionNo: integer('version_no').notNull(), // denormalized rule version_no for cheap lookups
  messageId: integer('message_id').notNull().references(() => chatMessages.id),
  response: text('response').notNull(),
  model: text('model'),
  createdAt: timestamp('created_at').notNull(),
}, (table) => ({
  assignmentIdx: index('score_rule_version_responses_assignment_idx').on(table.assignmentId),
  versionMessageUnique: uniqueIndex('score_rule_version_responses_version_message_unique').on(
    table.ruleVersionId,
    table.messageId
  ),
}));

// ---------------------------------------------------------------------------
// SCORE user-study mode — one participant = one instructor account owning a
// clone of EACH configured dataset. Participants sign in on /study with a
// participant number + the shared study passcode (NOT email/password); auth is
// via the global passcode (src/lib/study/config.ts), so no per-row secret.
// Created by runtime DDL in src/lib/study/store.ts (mirrors the score tables).
// ---------------------------------------------------------------------------
export const studyParticipants = pgTable('study_participants', {
  id: text('id').primaryKey(),
  // Canonical (trimmed, uppercased) code handed to the participant, e.g. 'P01'.
  participantNumber: text('participant_number').notNull(),
  instructorId: text('instructor_id').notNull().references(() => instructors.id),
  label: text('label'),
  // Counterbalancing cell (1-4) and the dataset order it implies. Both are
  // DERIVED from the participant number, but recorded at provisioning so the
  // analysis reads what a session actually ran as rather than re-deriving it
  // from a rule that might later change.
  cell: integer('cell'),
  blockOrder: text('block_order'), // e.g. 'swag,nirvana'
  // The participant's own start link. Handed out by the researcher; opening it
  // signs them in, so it is a credential and is minted random, not derived.
  accessToken: text('access_token'),
  // Where the facilitator has advanced this participant to (StudyPhase).
  phase: text('phase').notNull().default('not_started'),
  // A demo account (DEMO-SCORE / DEMO-BASELINE), not a study participant. Runs
  // the identical session on the isolated demo subtypes; excluded from the
  // console and the metrics export so a demo run cannot become study data.
  isDemo: boolean('is_demo').notNull().default(false),
  // Which build of the tools both blocks run in: 'full' | 'simple'
  // (StudioFamily). The cell counterbalances arm × dataset; this crosses that
  // with the toolset, and does not vary within a session.
  conditionFamily: text('condition_family').notNull().default('full'),
  createdAt: timestamp('created_at').notNull(),
  lastLoginAt: timestamp('last_login_at'),
}, (table) => ({
  numberUnique: uniqueIndex('study_participants_number_unique').on(table.participantNumber),
}));

// One cloned dataset assignment per (participant, dataset). Lets a participant
// hold a clone of several datasets (SWAG, NIRVANA, …) at once; the unique
// (participant, dataset_key) index makes provisioning idempotent + race-safe.
export const studyClones = pgTable('study_clones', {
  id: text('id').primaryKey(),
  participantId: text('participant_id').notNull().references(() => studyParticipants.id),
  datasetKey: text('dataset_key').notNull(), // StudyDataset.key
  assignmentId: text('assignment_id').notNull().references(() => assignments.id),
  sourceAssignmentId: text('source_assignment_id').notNull(),
  // Study condition for this clone (StudioView): the arm — 'score' (intent/rule
  // tool) | 'baseline' (monolithic prompt ablation) — crossed with the toolset,
  // giving 'simple_score' | 'simple_baseline' for the stripped-down build.
  // Drives both the studio UI and /api/chat. Read it through armOf/familyOf.
  condition: text('condition').notNull().default('score'),
  createdAt: timestamp('created_at').notNull(),
}, (table) => ({
  participantDatasetUnique: uniqueIndex('study_clones_participant_dataset_unique').on(
    table.participantId,
    table.datasetKey
  ),
  assignmentIdx: index('study_clones_assignment_idx').on(table.assignmentId),
}));

// ---------------------------------------------------------------------------
// Baseline condition + shared study instrumentation. See docs/STUDY_BASELINE_SPEC.md.
// All created by runtime DDL in src/lib/study/store.ts.
// ---------------------------------------------------------------------------

// Probe rating cache: an intent-LESS judge sweep over the log for a definition
// text. def_hash = intentDefHash(definition, []) so preset (intent) ratings and
// custom-search ratings share one keyspace. Full 5-level rating stored; only
// clearly_in is ever exposed in the baseline UI.
export const scoreProbeRatings = pgTable('score_probe_ratings', {
  id: serial('id').primaryKey(),
  assignmentId: text('assignment_id').notNull(),
  defHash: text('def_hash').notNull(),
  messageId: integer('message_id').notNull(),
  rating: text('rating').notNull(),
  rawResponse: text('raw_response'),
  model: text('model'),
  ratedAt: timestamp('rated_at').notNull(),
}, (table) => ({
  uniq: uniqueIndex('score_probe_ratings_unique').on(table.assignmentId, table.defHash, table.messageId),
  assignmentIdx: index('score_probe_ratings_assignment_idx').on(table.assignmentId),
}));

// Baseline saved filters ("searches" server-side, "Filters" in the UI). Every
// filter is created through the same chooser SCORE creates intents in
// (candidate-chooser.tsx), which carries a name box — so a filter has a name of
// its own instead of being labelled by the first 60 characters of its
// description. `type` is the query type it was created under: it groups the
// filter in the left column and scopes which questions its results SHOW —
// nothing more (no rule, no ownership). Both nullable: rows saved before these
// columns fall back to the description prefix / ungrouped whole-log display.
export const baselineSearches = pgTable('baseline_searches', {
  id: text('id').primaryKey(),
  assignmentId: text('assignment_id').notNull(),
  name: text('name'),
  type: text('type'),
  description: text('description').notNull(),
  defHash: text('def_hash').notNull(),
  createdAt: timestamp('created_at').notNull(),
  lastRunAt: timestamp('last_run_at'),
}, (table) => ({
  assignmentIdx: index('baseline_searches_assignment_idx').on(table.assignmentId),
}));

// Baseline coarse prompt versions. A Save creates a version; deployedAt marks
// the one the student chat serves. draft is never persisted server-side.
export const baselinePromptVersions = pgTable('baseline_prompt_versions', {
  id: serial('id').primaryKey(),
  assignmentId: text('assignment_id').notNull(),
  versionNo: integer('version_no').notNull(),
  prompt: text('prompt').notNull(),
  deployedAt: timestamp('deployed_at'),
  createdAt: timestamp('created_at').notNull(),
}, (table) => ({
  uniq: uniqueIndex('baseline_prompt_versions_unique').on(table.assignmentId, table.versionNo),
}));

// Baseline per-query preview cache (mirror of score_rule_previews).
export const baselinePreviews = pgTable('baseline_previews', {
  id: serial('id').primaryKey(),
  assignmentId: text('assignment_id').notNull(),
  messageId: integer('message_id').notNull(),
  promptHash: text('prompt_hash').notNull(), // stableHash(model + prompt)
  response: text('response').notNull(),
  model: text('model'),
  createdAt: timestamp('created_at').notNull(),
}, (table) => ({
  uniq: uniqueIndex('baseline_previews_unique').on(table.messageId, table.promptHash),
}));

// Shared review set (both conditions). scope: 'prompt' (baseline) | 'intent:<id>' (score).
export const reviewSetItems = pgTable('review_set_items', {
  id: serial('id').primaryKey(),
  assignmentId: text('assignment_id').notNull(),
  scope: text('scope').notNull(),
  messageId: integer('message_id').notNull(),
  source: text('source').notNull(), // 'auto' | 'manual' | 'similar' | 'search'
  createdAt: timestamp('created_at').notNull(),
}, (table) => ({
  uniq: uniqueIndex('review_set_items_unique').on(table.assignmentId, table.scope, table.messageId),
}));

// Behavioral event log (both conditions) — the source of process metrics.
// assignment_id is nullable because phase transitions belong to the
// participant: break, A/B and done span both clones and sit on neither.
export const studyEvents = pgTable('study_events', {
  id: serial('id').primaryKey(),
  assignmentId: text('assignment_id'),
  participantId: text('participant_id'),
  eventType: text('event_type').notNull(),
  payload: jsonb('payload'),
  createdAt: timestamp('created_at').notNull(),
}, (table) => ({
  assignmentIdx: index('study_events_assignment_idx').on(table.assignmentId),
  participantIdx: index('study_events_participant_idx').on(table.participantId),
}));

// ---------------------------------------------------------------------------
// Set curation (researcher admin tool, docs/CURATION_ADMIN_UI_PLAN.md).
// Rows key MASTER questions — the participant clones never see these tables;
// the curated sets reach them by being BUILT INTO the reduced study masters.
// ---------------------------------------------------------------------------

// Which master question belongs to which curated set. The unique index on
// (dataset, message) IS the exclusivity rule: review / test / ab cannot overlap.
export const studySetMembers = pgTable('study_set_members', {
  id: serial('id').primaryKey(),
  datasetKey: text('dataset_key').notNull(),
  setKind: text('set_kind').notNull(), // 'review' | 'test'
  sourceMessageId: integer('source_message_id').notNull(),
  position: doublePrecision('position'),
  // Classification snapshot AT ASSIGNMENT TIME. Kept denormalized so a later
  // re-classification cannot silently rewrite what a set was balanced on, and
  // so post-session analysis can slice by type/subtype without re-deriving.
  queryType: text('query_type'),
  subtype: text('subtype'),
  rating: text('rating'), // 'clearly_in' | 'probably_in' at assignment time
  addedBy: text('added_by'), // researcher code
  createdAt: timestamp('created_at').notNull(),
}, (table) => ({
  uniq: uniqueIndex('study_set_members_unique').on(table.datasetKey, table.sourceMessageId),
  kindIdx: index('study_set_members_kind_idx').on(table.datasetKey, table.setKind),
}));

// Per-dataset curation state: the isolated demo subtype and the confirm lock.
export const studyCurationMeta = pgTable('study_curation_meta', {
  datasetKey: text('dataset_key').primaryKey(),
  // Subtype TITLE (not an intent id): template rows are per-assignment, but the
  // demo subtype must be excluded from BOTH datasets, and titles are shared.
  // Superseded by demoSubtypes — kept so a dataset confirmed before the demo
  // became multi-subtype still reads back the choice it was locked with.
  demoSubtype: text('demo_subtype'),
  /** Subtype TITLEs the demo runs on, all isolated from every set. */
  demoSubtypes: jsonb('demo_subtypes').$type<string[]>(),
  /** Student participant TOKENs isolated outright, whatever they asked. Same
   * effect as a subtype match, reached by naming the student instead. */
  demoParticipants: jsonb('demo_participants').$type<string[]>(),
  lockedAt: timestamp('locked_at'),
  lockedBy: text('locked_by'),
});

// ---------------------------------------------------------------------------
// Study measurement (block test + blind A/B). Both read FROZEN text: the
// questions never belong to a participant's log, and the responses are
// generated once after deploy and never regenerated — generation has no
// temperature or seed control, so re-running would silently change what a
// participant was shown.
// ---------------------------------------------------------------------------

// The block-test and A/B questions, frozen out of the ORIGINAL master at build
// time. `context` is the prior turns verbatim ([{role, content}, …]) so a
// question stays presentable and answerable no matter what the study masters
// were later rebuilt from.
export const studyQuestionBank = pgTable('study_question_bank', {
  id: serial('id').primaryKey(),
  datasetKey: text('dataset_key').notNull(),
  kind: text('kind').notNull(), // 'test'
  position: integer('position').notNull(), // presentation order (A/B: balanced blocks)
  sourceMessageId: integer('source_message_id'), // provenance only
  context: jsonb('context').notNull(),
  question: text('question').notNull(),
  queryType: text('query_type'),
  subtype: text('subtype'),
  createdAt: timestamp('created_at').notNull(),
}, (table) => ({
  slotUnique: uniqueIndex('study_question_bank_slot_unique').on(
    table.datasetKey,
    table.kind,
    table.position
  ),
}));

// One participant configuration's answer to one bank question, frozen.
// config_ref pins WHICH configuration produced it ({deployId} for SCORE,
// {baselineVersionNo} for baseline) so a later redeploy is detectable rather
// than silently changing the meaning of a stored answer.
export const studyGeneratedResponses = pgTable('study_generated_responses', {
  id: serial('id').primaryKey(),
  participantId: text('participant_id').notNull(),
  cloneAssignmentId: text('clone_assignment_id').notNull(),
  bankItemId: integer('bank_item_id').notNull(),
  purpose: text('purpose').notNull(), // 'test'
  configRef: jsonb('config_ref').notNull(),
  applied: jsonb('applied'), // SCORE routing audit: intent, outcome, type
  outcome: text('outcome').notNull(), // 'routed' | 'empty_config' (never fail_open)
  response: text('response').notNull(),
  model: text('model'),
  createdAt: timestamp('created_at').notNull(),
}, (table) => ({
  uniq: uniqueIndex('study_generated_responses_unique').on(
    table.cloneAssignmentId,
    table.bankItemId
  ),
  participantIdx: index('study_generated_responses_participant_idx').on(table.participantId),
}));

// The questionnaire as currently worded. One row (id = 1) holding the whole
// instrument: the design leaves the exact wording (and whether load is TLX or
// UBS) to the advisor meeting, so it has to be editable without a deploy.
export const studySurveyConfig = pgTable('study_survey_config', {
  id: integer('id').primaryKey().default(1),
  items: jsonb('items').notNull(),
  // Top of the response scale (the bottom is always 1). 5 or 7 in practice.
  scaleMax: integer('scale_max').notNull().default(7),
  updatedAt: timestamp('updated_at').notNull(),
  updatedBy: text('updated_by'),
});

// Per-type size of each curated set, as a researcher currently has it. One row
// (id = 1): the design requires both datasets to carry matching set sizes, so
// a per-dataset figure would be a way to break that by accident.
export const studySetTargets = pgTable('study_set_targets', {
  id: integer('id').primaryKey().default(1),
  review: integer('review').notNull(),
  test: integer('test').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
  updatedBy: text('updated_by'),
});

// The curated review set, per STUDY assignment (a reduced master and every
// clone of it). A reduced master keeps whole threads so each curated question
// can be read in its context — and those earlier turns are questions too, so
// without this mark the board would list them as material to review.
// No rows for an ordinary assignment → the board filters nothing there.
export const studyReviewQuestions = pgTable('study_review_questions', {
  id: serial('id').primaryKey(),
  assignmentId: text('assignment_id').notNull(),
  messageId: integer('message_id').notNull(),
}, (table) => ({
  uniq: uniqueIndex('study_review_questions_unique').on(table.assignmentId, table.messageId),
}));

// Block test: the participant predicts whether their configuration will answer
// as they intend, THEN sees the frozen answer, THEN rates the fit. The
// prediction is stored before the answer is released, so guessed_at < rated_at
// is also the evidence that the prediction was made blind.
export const studyTestAnswers = pgTable('study_test_answers', {
  id: serial('id').primaryKey(),
  participantId: text('participant_id').notNull(),
  cloneAssignmentId: text('clone_assignment_id').notNull(),
  bankItemId: integer('bank_item_id').notNull(),
  guess: boolean('guess'),
  rating: smallint('rating'), // 1-5 fit with the instructor's intent
  // The pointing step (design v2 §5). SCORE: 'intent' | 'none' | 'not_sure'.
  // Baseline: 'span' | 'nothing' | 'not_sure'.
  pointedKind: text('pointed_kind'),
  pointedIntentId: integer('pointed_intent_id'),
  pointedSpanStart: integer('pointed_span_start'),
  pointedSpanEnd: integer('pointed_span_end'),
  /** The highlighted text itself — outlives the offsets across a redeploy. */
  pointedText: text('pointed_text'),
  // Free text, all three of them (문항지 §3, 08-15: the block test has no
  // spoken items). `expectation` is Pass 1's description of what they think
  // the chatbot will do — required, and replayed verbatim in Pass 2.
  // `whatsOff` opens at a rating of 3 or less; `probe` opens only where the
  // prediction actually missed, and may be left blank.
  expectation: text('expectation'),
  whatsOff: text('whats_off'),
  probe: text('probe'),
  guessedAt: timestamp('guessed_at'),
  pointedAt: timestamp('pointed_at'),
  ratedAt: timestamp('rated_at'),
  /**
   * How long each step of the item took, in MILLISECONDS FROM THE MOMENT THE
   * QUESTION APPEARED — measured on the client and sent with the write.
   *
   * Durations, not clocks: the three timestamps above all land in one write
   * (the prediction is a single Next press), so they cannot say how long the
   * participant spent deciding WHERE the answer comes from versus what it will
   * say. Relative ms are also immune to client clock skew.
   *
   * Pass 1: { shown, pointFirst, point, pointChanges, expectStart, expectEnd,
   *           guess, submit }. Pass 2: { reveal, rate, probe }, measured from
   *           when the item's rate card appeared.
   */
  timing: jsonb('timing'),
}, (table) => ({
  uniq: uniqueIndex('study_test_answers_unique').on(table.cloneAssignmentId, table.bankItemId),
  participantIdx: index('study_test_answers_participant_idx').on(table.participantId),
}));
// Per-block questionnaire answers, one row per item. Item keys come from a
// config rather than the schema, so rewording a scale after the pilot is a
// content change; `block` (not the clone) is the unit, because the questions
// are about the experience of that block.
export const studySurveyAnswers = pgTable('study_survey_answers', {
  id: serial('id').primaryKey(),
  participantId: text('participant_id').notNull(),
  block: integer('block').notNull(),
  cloneAssignmentId: text('clone_assignment_id'), // which workspace it was about
  itemKey: text('item_key').notNull(),
  value: integer('value').notNull(),
  answeredAt: timestamp('answered_at').notNull(),
}, (table) => ({
  uniq: uniqueIndex('study_survey_answers_unique').on(
    table.participantId,
    table.block,
    table.itemKey
  ),
}));

/**
 * The end-of-session comparison (design §6.5), which rates BOTH versions at
 * once and so cannot live in study_survey_answers — that table is keyed by
 * block, and half of these questions are not about a block at all.
 *
 * Three shapes in one table, told apart by which columns are filled:
 *   • a statement rated per version  → item_key + condition + value
 *   • a direct comparison (bipolar)  → item_key + value, condition null
 *   • a free-text answer per version → item_key + condition + text
 */
export const studyFinalSurveyAnswers = pgTable('study_final_survey_answers', {
  id: serial('id').primaryKey(),
  participantId: text('participant_id').notNull(),
  /** The design's own item code: E2, C1, … I1 … FT. */
  itemKey: text('item_key').notNull(),
  /** Which version this rating is OF; null for the comparison items. */
  condition: text('condition'),
  value: integer('value'),
  text: text('text'),
  answeredAt: timestamp('answered_at').notNull(),
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

export type ScoreIntent = typeof scoreIntents.$inferSelect;
export type NewScoreIntent = typeof scoreIntents.$inferInsert;

export type ScoreIntentRating = typeof scoreIntentRatings.$inferSelect;
export type NewScoreIntentRating = typeof scoreIntentRatings.$inferInsert;

export type ScoreIntentPin = typeof scoreIntentPins.$inferSelect;
export type NewScoreIntentPin = typeof scoreIntentPins.$inferInsert;

export type ScoreConfigVersion = typeof scoreConfigVersions.$inferSelect;
export type NewScoreConfigVersion = typeof scoreConfigVersions.$inferInsert;

export type ScoreDissection = typeof scoreDissections.$inferSelect;
export type NewScoreDissection = typeof scoreDissections.$inferInsert;

export type ScoreQueryTypeRow = typeof scoreQueryTypes.$inferSelect;
export type NewScoreQueryTypeRow = typeof scoreQueryTypes.$inferInsert;

export type ScoreRulePreview = typeof scoreRulePreviews.$inferSelect;
export type NewScoreRulePreview = typeof scoreRulePreviews.$inferInsert;

export type ScoreQueryEmbedding = typeof scoreQueryEmbeddings.$inferSelect;
export type NewScoreQueryEmbedding = typeof scoreQueryEmbeddings.$inferInsert;

export type ScoreChatDeploy = typeof scoreChatDeploys.$inferSelect;
export type NewScoreChatDeploy = typeof scoreChatDeploys.$inferInsert;

export type ScoreRuleVersion = typeof scoreRuleVersions.$inferSelect;
export type NewScoreRuleVersion = typeof scoreRuleVersions.$inferInsert;

export type ScoreRuleVersionResponse = typeof scoreRuleVersionResponses.$inferSelect;
export type NewScoreRuleVersionResponse = typeof scoreRuleVersionResponses.$inferInsert;

export type StudyParticipant = typeof studyParticipants.$inferSelect;
export type NewStudyParticipant = typeof studyParticipants.$inferInsert;

export type StudyClone = typeof studyClones.$inferSelect;
export type NewStudyClone = typeof studyClones.$inferInsert;

export type ScoreProbeRating = typeof scoreProbeRatings.$inferSelect;
export type BaselineSearch = typeof baselineSearches.$inferSelect;
export type BaselinePromptVersion = typeof baselinePromptVersions.$inferSelect;
export type BaselinePreview = typeof baselinePreviews.$inferSelect;
export type ReviewSetItem = typeof reviewSetItems.$inferSelect;
export type StudyEvent = typeof studyEvents.$inferSelect;
export type StudySetMember = typeof studySetMembers.$inferSelect;
export type StudyCurationMeta = typeof studyCurationMeta.$inferSelect;
export type StudyQuestionBankItem = typeof studyQuestionBank.$inferSelect;
export type StudyGeneratedResponse = typeof studyGeneratedResponses.$inferSelect;
export type StudyTestAnswer = typeof studyTestAnswers.$inferSelect;
