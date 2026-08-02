/**
 * SCORE v6 intent persistence: runtime DDL for the intent tables, CRUD
 * helpers, and the immediate-apply version snapshot writer.
 *
 * Follows the queries.ts pattern: tables are created defensively at runtime
 * (to_regclass pre-check, memoized) because the drizzle migration journal is
 * not used for recent tables. schema.ts is the shape source of truth.
 *
 * Versioning contract (§1.11): every config mutation (intent create/edit/
 * archive, pin add/remove, link add/remove, revert) runs inside ONE
 * db.transaction together with recordConfigVersion(), so the snapshot
 * timeline never skips or double-counts a change. Rating/dissection writes
 * are NOT config changes and bypass versioning.
 */
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db/db';
import {
  assignments,
  chatConversations,
  chatMessages,
  scoreConfigVersions,
  scoreDissections,
  scoreIntentLinks,
  scoreIntentPins,
  scoreIntentRatings,
  scoreIntents,
  scoreRuleVersions,
  studentSessions,
  type ScoreIntent,
  type ScoreIntentLink,
  type ScoreIntentPin,
} from '@/db/schema';
import { assignmentBasePrompt } from '@/lib/assignment-ai';
import {
  DISSECTION_VERSION,
  INTENT_RATING_VERSION,
  PROMPT_HOLDER_TITLE,
  QUERY_TYPE_LABELS,
  SCORE_QUERY_TYPES,
  TYPE_CLASSIFIER_VERSION,
  intentDefHash,
  seedRuleVersionName,
  selectPromptPins,
  type PromptPin,
} from './intents';

/** db or a drizzle transaction — mutation helpers accept either so routes can
 * bundle a mutation with its version snapshot atomically. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type ScoreDb = typeof db | Tx;

/* ------------------------------------------------------------------ */
/* Runtime DDL                                                         */
/* ------------------------------------------------------------------ */

let ensured: Promise<void> | null = null;

async function createIntentTables(): Promise<void> {
  // Gate each table individually — a crash between two CREATE TABLEs must not
  // leave the ensemble permanently half-created behind a single check on the
  // first table.
  const existing = await db.execute<{ tablename: string }>(sql`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename IN
      ('score_intents','score_intent_ratings','score_intent_pins','score_intent_links','score_config_versions','score_dissections','score_query_types','score_rule_previews','score_query_embeddings','score_chat_deploys','score_rule_versions','score_rule_version_responses')
  `);
  const has = new Set(existing.map((r) => r.tablename));
  if (!has.has('score_intents')) {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "score_intents" (
        "id" serial PRIMARY KEY NOT NULL,
        "assignment_id" text NOT NULL,
        "title" text NOT NULL,
        "definition" text NOT NULL,
        "rule" text,
        "archived" boolean DEFAULT false NOT NULL,
        "created_at" timestamp NOT NULL,
        "updated_at" timestamp NOT NULL
      )
    `);
  }
  if (!has.has('score_intent_ratings')) {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "score_intent_ratings" (
        "id" serial PRIMARY KEY NOT NULL,
        "assignment_id" text NOT NULL,
        "message_id" integer NOT NULL,
        "intent_id" integer NOT NULL,
        "rating" text NOT NULL,
        "rationale" text,
        "def_hash" text NOT NULL,
        "raw_response" text,
        "model" text,
        "rated_at" timestamp NOT NULL
      )
    `);
  }
  if (!has.has('score_intent_pins')) {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "score_intent_pins" (
        "id" serial PRIMARY KEY NOT NULL,
        "assignment_id" text NOT NULL,
        "intent_id" integer NOT NULL,
        "message_id" integer NOT NULL,
        "verdict" text NOT NULL,
        "query_text" text NOT NULL,
        "reason" text,
        "source" text DEFAULT 'manual' NOT NULL,
        "created_at" timestamp NOT NULL
      )
    `);
  }
  if (!has.has('score_intent_links')) {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "score_intent_links" (
        "id" serial PRIMARY KEY NOT NULL,
        "assignment_id" text NOT NULL,
        "from_intent_id" integer NOT NULL,
        "to_intent_id" integer NOT NULL,
        "created_at" timestamp NOT NULL
      )
    `);
  }
  if (!has.has('score_config_versions')) {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "score_config_versions" (
        "id" serial PRIMARY KEY NOT NULL,
        "assignment_id" text NOT NULL,
        "version_no" integer NOT NULL,
        "snapshot" jsonb NOT NULL,
        "summary" jsonb NOT NULL,
        "created_by" text,
        "created_at" timestamp NOT NULL
      )
    `);
  }
  if (!has.has('score_dissections')) {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "score_dissections" (
        "id" serial PRIMARY KEY NOT NULL,
        "assignment_id" text NOT NULL,
        "message_id" integer NOT NULL,
        "material_kinds" jsonb NOT NULL,
        "requests" jsonb NOT NULL,
        "version" integer NOT NULL,
        "raw_response" text,
        "model" text,
        "created_at" timestamp NOT NULL
      )
    `);
  }
  if (!has.has('score_query_types')) {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "score_query_types" (
        "id" serial PRIMARY KEY NOT NULL,
        "assignment_id" text NOT NULL,
        "message_id" integer NOT NULL,
        "type" text NOT NULL,
        "rationale" text,
        "version" integer NOT NULL,
        "raw_response" text,
        "model" text,
        "created_at" timestamp NOT NULL
      )
    `);
  }
  if (!has.has('score_rule_previews')) {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "score_rule_previews" (
        "id" serial PRIMARY KEY NOT NULL,
        "assignment_id" text NOT NULL,
        "message_id" integer NOT NULL,
        "intent_id" integer NOT NULL,
        "prompt_hash" text NOT NULL,
        "response" text NOT NULL,
        "model" text,
        "created_at" timestamp NOT NULL
      )
    `);
  }
  if (!has.has('score_query_embeddings')) {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "score_query_embeddings" (
        "id" serial PRIMARY KEY NOT NULL,
        "assignment_id" text NOT NULL,
        "message_id" integer NOT NULL,
        "embedding" jsonb NOT NULL,
        "model" text NOT NULL,
        "created_at" timestamp NOT NULL
      )
    `);
  }
  if (!has.has('score_chat_deploys')) {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "score_chat_deploys" (
        "id" serial PRIMARY KEY NOT NULL,
        "assignment_id" text NOT NULL,
        "version_no" integer NOT NULL,
        "snapshot" jsonb NOT NULL,
        "note" text,
        "created_by" text,
        "created_at" timestamp NOT NULL
      )
    `);
  }
  if (!has.has('score_rule_versions')) {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "score_rule_versions" (
        "id" serial PRIMARY KEY NOT NULL,
        "assignment_id" text NOT NULL,
        "intent_id" integer NOT NULL,
        "version_no" integer NOT NULL,
        "name" text,
        "rule" text,
        "updated_response" text,
        "anchor_message_id" integer,
        "source" text NOT NULL,
        "note" text,
        "minor" boolean DEFAULT false NOT NULL,
        "created_by" text,
        "created_at" timestamp NOT NULL
      )
    `);
  }
  if (!has.has('score_rule_version_responses')) {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "score_rule_version_responses" (
        "id" serial PRIMARY KEY NOT NULL,
        "assignment_id" text NOT NULL,
        "intent_id" integer NOT NULL,
        "rule_version_id" integer NOT NULL,
        "version_no" integer NOT NULL,
        "message_id" integer NOT NULL,
        "response" text NOT NULL,
        "model" text,
        "created_at" timestamp NOT NULL
      )
    `);
  }

  // Add columns introduced after the table's original CREATE (existing DBs skip
  // the CREATE above). Pre-check information_schema so an already-present column
  // doesn't emit the noisy "already exists, skipping" NOTICE on every boot (same
  // reasoning as the pg_indexes pre-check below).
  const cols = await db.execute<{ column_name: string }>(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'score_intents' AND column_name = 'is_template'
  `);
  if (cols.length === 0) {
    await db.execute(
      sql`ALTER TABLE "score_intents" ADD COLUMN "is_template" boolean DEFAULT false NOT NULL`
    );
  }
  // score_rule_versions.name / .minor were added after the table's first CREATE.
  const ruleVersionCols = await db.execute<{ column_name: string }>(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'score_rule_versions'
      AND column_name IN ('name', 'minor')
  `);
  const haveRuleCols = new Set(ruleVersionCols.map((r) => r.column_name));
  if (!haveRuleCols.has('name')) {
    await db.execute(sql`ALTER TABLE "score_rule_versions" ADD COLUMN "name" text`);
  }
  if (!haveRuleCols.has('minor')) {
    await db.execute(
      sql`ALTER TABLE "score_rule_versions" ADD COLUMN "minor" boolean DEFAULT false NOT NULL`
    );
  }
  // score_intent_pins.reason — an optional out-pin rationale added after v6.
  const pinCols = await db.execute<{ column_name: string }>(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'score_intent_pins' AND column_name = 'reason'
  `);
  if (pinCols.length === 0) {
    await db.execute(sql`ALTER TABLE "score_intent_pins" ADD COLUMN "reason" text`);
  }
  // v7 intent tree: kind / type / parent_intent_id / position on score_intents.
  // parent_intent_id gets no FK (the runtime CREATEs above declare none either);
  // position is double precision so a reorder can bisect between two siblings.
  const treeCols = await db.execute<{ column_name: string }>(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'score_intents'
      AND column_name IN ('kind', 'type', 'parent_intent_id', 'position')
  `);
  const haveTreeCols = new Set(treeCols.map((r) => r.column_name));
  if (!haveTreeCols.has('kind')) {
    await db.execute(
      sql`ALTER TABLE "score_intents" ADD COLUMN "kind" text DEFAULT 'intent' NOT NULL`
    );
  }
  if (!haveTreeCols.has('type')) {
    await db.execute(sql`ALTER TABLE "score_intents" ADD COLUMN "type" text`);
  }
  if (!haveTreeCols.has('parent_intent_id')) {
    await db.execute(sql`ALTER TABLE "score_intents" ADD COLUMN "parent_intent_id" integer`);
  }
  if (!haveTreeCols.has('position')) {
    await db.execute(sql`ALTER TABLE "score_intents" ADD COLUMN "position" double precision`);
  }
  // Backfill the kind column from the pre-v7 title sentinel. Deliberately NOT
  // gated on the ALTER above: a crash between adding the column and backfilling
  // it would otherwise strand old holders as kind='intent' forever (same
  // reasoning as the per-table CREATE gating). The predicate makes every run
  // after the first a no-op. PROMPT_HOLDER_TITLE remains the constant of record
  // so pre-migration clones keep resolving by title too.
  await db.execute(sql`
    UPDATE "score_intents" SET "kind" = 'prompt_holder'
    WHERE "title" = ${PROMPT_HOLDER_TITLE} AND "kind" <> 'prompt_holder'
  `);

  // Ensure indexes even when tables pre-exist (crash between CREATE TABLE and
  // CREATE INDEX must not strand a table whose unique index upserts target —
  // see the same recovery logic in queries.ts). pg_indexes pre-check avoids
  // the noisy IF NOT EXISTS NOTICE on every boot.
  const wanted: [table: string, name: string, ddl: ReturnType<typeof sql>][] = [
    ['score_intents', 'score_intents_assignment_idx',
      sql`CREATE INDEX IF NOT EXISTS "score_intents_assignment_idx" ON "score_intents" USING btree ("assignment_id")`],
    // Exactly one type root per (assignment, type): makes ensureTypeRoots'
    // INSERT ... ON CONFLICT DO NOTHING idempotent under concurrent loads.
    ['score_intents', 'score_intents_type_root_unique',
      sql`CREATE UNIQUE INDEX IF NOT EXISTS "score_intents_type_root_unique" ON "score_intents" USING btree ("assignment_id", "type") WHERE "kind" = 'type_root'`],
    ['score_intent_ratings', 'score_intent_ratings_assignment_idx',
      sql`CREATE INDEX IF NOT EXISTS "score_intent_ratings_assignment_idx" ON "score_intent_ratings" USING btree ("assignment_id")`],
    ['score_intent_ratings', 'score_intent_ratings_intent_idx',
      sql`CREATE INDEX IF NOT EXISTS "score_intent_ratings_intent_idx" ON "score_intent_ratings" USING btree ("intent_id")`],
    ['score_intent_ratings', 'score_intent_ratings_message_intent_hash_unique',
      sql`CREATE UNIQUE INDEX IF NOT EXISTS "score_intent_ratings_message_intent_hash_unique" ON "score_intent_ratings" USING btree ("message_id", "intent_id", "def_hash")`],
    ['score_intent_pins', 'score_intent_pins_assignment_idx',
      sql`CREATE INDEX IF NOT EXISTS "score_intent_pins_assignment_idx" ON "score_intent_pins" USING btree ("assignment_id")`],
    ['score_intent_pins', 'score_intent_pins_intent_message_unique',
      sql`CREATE UNIQUE INDEX IF NOT EXISTS "score_intent_pins_intent_message_unique" ON "score_intent_pins" USING btree ("intent_id", "message_id")`],
    ['score_intent_links', 'score_intent_links_assignment_idx',
      sql`CREATE INDEX IF NOT EXISTS "score_intent_links_assignment_idx" ON "score_intent_links" USING btree ("assignment_id")`],
    ['score_intent_links', 'score_intent_links_pair_unique',
      sql`CREATE UNIQUE INDEX IF NOT EXISTS "score_intent_links_pair_unique" ON "score_intent_links" USING btree ("from_intent_id", "to_intent_id")`],
    ['score_config_versions', 'score_config_versions_assignment_version_unique',
      sql`CREATE UNIQUE INDEX IF NOT EXISTS "score_config_versions_assignment_version_unique" ON "score_config_versions" USING btree ("assignment_id", "version_no")`],
    ['score_dissections', 'score_dissections_assignment_idx',
      sql`CREATE INDEX IF NOT EXISTS "score_dissections_assignment_idx" ON "score_dissections" USING btree ("assignment_id")`],
    ['score_dissections', 'score_dissections_message_unique',
      sql`CREATE UNIQUE INDEX IF NOT EXISTS "score_dissections_message_unique" ON "score_dissections" USING btree ("message_id")`],
    ['score_query_types', 'score_query_types_assignment_idx',
      sql`CREATE INDEX IF NOT EXISTS "score_query_types_assignment_idx" ON "score_query_types" USING btree ("assignment_id")`],
    ['score_query_types', 'score_query_types_message_unique',
      sql`CREATE UNIQUE INDEX IF NOT EXISTS "score_query_types_message_unique" ON "score_query_types" USING btree ("message_id")`],
    ['score_rule_previews', 'score_rule_previews_assignment_idx',
      sql`CREATE INDEX IF NOT EXISTS "score_rule_previews_assignment_idx" ON "score_rule_previews" USING btree ("assignment_id")`],
    ['score_rule_previews', 'score_rule_previews_message_intent_unique',
      sql`CREATE UNIQUE INDEX IF NOT EXISTS "score_rule_previews_message_intent_unique" ON "score_rule_previews" USING btree ("message_id", "intent_id")`],
    ['score_query_embeddings', 'score_query_embeddings_assignment_idx',
      sql`CREATE INDEX IF NOT EXISTS "score_query_embeddings_assignment_idx" ON "score_query_embeddings" USING btree ("assignment_id")`],
    ['score_query_embeddings', 'score_query_embeddings_message_unique',
      sql`CREATE UNIQUE INDEX IF NOT EXISTS "score_query_embeddings_message_unique" ON "score_query_embeddings" USING btree ("message_id")`],
    ['score_chat_deploys', 'score_chat_deploys_assignment_idx',
      sql`CREATE INDEX IF NOT EXISTS "score_chat_deploys_assignment_idx" ON "score_chat_deploys" USING btree ("assignment_id")`],
    ['score_chat_deploys', 'score_chat_deploys_assignment_version_unique',
      sql`CREATE UNIQUE INDEX IF NOT EXISTS "score_chat_deploys_assignment_version_unique" ON "score_chat_deploys" USING btree ("assignment_id", "version_no")`],
    ['score_rule_versions', 'score_rule_versions_assignment_idx',
      sql`CREATE INDEX IF NOT EXISTS "score_rule_versions_assignment_idx" ON "score_rule_versions" USING btree ("assignment_id")`],
    ['score_rule_versions', 'score_rule_versions_intent_version_unique',
      sql`CREATE UNIQUE INDEX IF NOT EXISTS "score_rule_versions_intent_version_unique" ON "score_rule_versions" USING btree ("intent_id", "version_no")`],
    ['score_rule_version_responses', 'score_rule_version_responses_assignment_idx',
      sql`CREATE INDEX IF NOT EXISTS "score_rule_version_responses_assignment_idx" ON "score_rule_version_responses" USING btree ("assignment_id")`],
    ['score_rule_version_responses', 'score_rule_version_responses_version_message_unique',
      sql`CREATE UNIQUE INDEX IF NOT EXISTS "score_rule_version_responses_version_message_unique" ON "score_rule_version_responses" USING btree ("rule_version_id", "message_id")`],
  ];
  const idx = await db.execute<{ indexname: string }>(sql`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public' AND tablename IN
      ('score_intents','score_intent_ratings','score_intent_pins','score_intent_links','score_config_versions','score_dissections','score_query_types','score_rule_previews','score_query_embeddings','score_chat_deploys','score_rule_versions','score_rule_version_responses')
  `);
  const have = new Set(idx.map((r) => r.indexname));
  // Ratings were re-keyed from (message, intent) to (message, intent, def_hash)
  // so every rated spec keeps its rows (instant version recall). Drop the old
  // narrower unique index — it would reject the multi-hash rows.
  if (have.has('score_intent_ratings_message_intent_unique')) {
    await db.execute(sql`DROP INDEX "score_intent_ratings_message_intent_unique"`);
  }
  for (const [, name, ddl] of wanted) {
    if (!have.has(name)) await db.execute(ddl);
  }
}

export function ensureIntentTables(): Promise<void> {
  if (!ensured) {
    ensured = createIntentTables().catch((error) => {
      ensured = null; // allow retry on next call if creation failed
      throw error;
    });
  }
  return ensured;
}

/* ------------------------------------------------------------------ */
/* Loaders                                                             */
/* ------------------------------------------------------------------ */

export async function listIntents(dbx: ScoreDb, assignmentId: string): Promise<ScoreIntent[]> {
  return dbx
    .select()
    .from(scoreIntents)
    .where(eq(scoreIntents.assignmentId, assignmentId))
    .orderBy(asc(scoreIntents.id));
}

/** All pins for the assignment, newest first (the order selectPromptPins expects). */
export async function listPins(dbx: ScoreDb, assignmentId: string): Promise<ScoreIntentPin[]> {
  return dbx
    .select()
    .from(scoreIntentPins)
    .where(eq(scoreIntentPins.assignmentId, assignmentId))
    .orderBy(desc(scoreIntentPins.createdAt), desc(scoreIntentPins.id));
}

export async function listLinks(dbx: ScoreDb, assignmentId: string): Promise<ScoreIntentLink[]> {
  return dbx
    .select()
    .from(scoreIntentLinks)
    .where(eq(scoreIntentLinks.assignmentId, assignmentId))
    .orderBy(asc(scoreIntentLinks.id));
}

export async function latestVersionNo(dbx: ScoreDb, assignmentId: string): Promise<number> {
  const rows = await dbx
    .select({ max: sql<number | null>`max(${scoreConfigVersions.versionNo})` })
    .from(scoreConfigVersions)
    .where(eq(scoreConfigVersions.assignmentId, assignmentId));
  return rows[0]?.max ?? 0;
}

/** One active intent prepared for prompting/staleness checks. */
export interface PromptReadyIntent {
  intent: ScoreIntent;
  promptPins: PromptPin[];
  defHash: string;
}

/**
 * Join active intents with the pins actually sent to the classifier and the
 * resulting defHash. This is THE staleness reference: a rating row is fresh
 * iff its stored def_hash equals this defHash.
 */
export function buildPromptReadyIntents(
  intents: ScoreIntent[],
  pinsNewestFirst: ScoreIntentPin[]
): PromptReadyIntent[] {
  return intents
    // Only 'intent' rows are judged. The other two kinds are containers, not
    // classification intents, and leaving either in would make the resolver
    // return `pending` for every message (their rating is always missing):
    //   - prompt_holder — the baseline condition's monolithic-rule container
    //   - type_root     — a type's final else; its rule fires when the chain
    //                     is exhausted, so it is never rated against the log
    // Every promptReady consumer (staleness, routing, deploy) inherits this.
    // The title check stays as a belt-and-braces fallback for clones whose
    // holder predates the kind backfill.
    .filter((i) => !i.archived && i.kind === 'intent' && i.title !== PROMPT_HOLDER_TITLE)
    .map((intent) => {
      const promptPins = selectPromptPins(
        pinsNewestFirst
          .filter((p) => p.intentId === intent.id)
          .map((p) => ({ verdict: p.verdict as 'in' | 'out', text: p.queryText, reason: p.reason }))
      );
      return { intent, promptPins, defHash: intentDefHash(intent.definition, promptPins) };
    });
}

export interface IntentState {
  intents: ScoreIntent[]; // includes archived (callers filter for display)
  pins: ScoreIntentPin[]; // newest first
  links: ScoreIntentLink[];
  versionNo: number;
  promptReady: PromptReadyIntent[]; // active intents only
}

export async function loadIntentState(assignmentId: string): Promise<IntentState> {
  await ensureIntentTables();
  const [intents, pins, links, versionNo] = await Promise.all([
    listIntents(db, assignmentId),
    listPins(db, assignmentId),
    listLinks(db, assignmentId),
    latestVersionNo(db, assignmentId),
  ]);
  return { intents, pins, links, versionNo, promptReady: buildPromptReadyIntents(intents, pins) };
}

/**
 * The 4 fixed type roots for an assignment, creating any that are missing.
 *
 * A type root is a score_intents row (kind='type_root') so that editing its
 * else-rule reuses the whole rule axis — rule versions, Revise, previews — with
 * no parallel machinery. It is never judged: buildPromptReadyIntents filters it
 * out, and the chain compiler treats it as the final else rather than a node.
 *
 * Idempotent under concurrent page loads: the insert relies on the partial
 * unique index (assignment_id, type) WHERE kind='type_root', so racing callers
 * collide on the index instead of creating duplicate roots, then re-select.
 *
 * Seeded from the assignment's base prompt — the same text a v6 intent started
 * from. On NIRVANA that is empty, which is fine: an empty rule means the
 * chatbot gets no system message at all (injection.ts), exactly as today.
 *
 * Call this only for the SCORE studio view: a baseline clone never routes, so
 * it must not accumulate root rows (D12 — roots are per-assignment, and a clone
 * lazily grows its own if it is ever opened as SCORE).
 */
export async function ensureTypeRoots(assignmentId: string): Promise<ScoreIntent[]> {
  await ensureIntentTables();
  const existing = await db
    .select()
    .from(scoreIntents)
    .where(and(eq(scoreIntents.assignmentId, assignmentId), eq(scoreIntents.kind, 'type_root')));
  const have = new Set(existing.map((r) => r.type));
  const missing = SCORE_QUERY_TYPES.filter((t) => !have.has(t));
  if (missing.length === 0) return existing;

  const assignmentRows = await db
    .select({
      customSystemPrompt: assignments.customSystemPrompt,
      instructions: assignments.instructions,
      includeInstructionInPrompt: assignments.includeInstructionInPrompt,
    })
    .from(assignments)
    .where(eq(assignments.id, assignmentId));
  const seed = assignmentBasePrompt(assignmentRows[0] ?? {});
  const now = new Date();

  await db
    .insert(scoreIntents)
    .values(
      missing.map((type) => ({
        assignmentId,
        title: QUERY_TYPE_LABELS[type],
        // Never rated, so the definition is unused — the type's meaning lives
        // in the type-classifier prompt (type-prompts.ts), not here.
        definition: '',
        rule: seed.trim().length > 0 ? seed : null,
        archived: false,
        isTemplate: false,
        kind: 'type_root' as const,
        type,
        parentIntentId: null,
        position: null,
        createdAt: now,
        updatedAt: now,
      }))
    )
    .onConflictDoNothing();

  const roots = await db
    .select()
    .from(scoreIntents)
    .where(and(eq(scoreIntents.assignmentId, assignmentId), eq(scoreIntents.kind, 'type_root')));

  // Seed v1 on the rule axis for roots that just appeared, mirroring intent
  // creation: the board reads "Then v1 Starting rule" and Revise opens on a
  // real v1 instead of an empty history.
  const seeded = roots.filter((r) => !existing.some((e) => e.id === r.id));
  if (seeded.length > 0) {
    await db
      .insert(scoreRuleVersions)
      .values(
        seeded.map((root) => ({
          assignmentId,
          intentId: root.id,
          versionNo: 1,
          name: seedRuleVersionName(root.rule),
          rule: root.rule,
          updatedResponse: null,
          anchorMessageId: null,
          source: 'seed',
          note: null,
          minor: false,
          createdBy: null,
          createdAt: now,
        }))
      )
      .onConflictDoNothing();
  }
  return roots;
}

export async function listIntentRatings(assignmentId: string) {
  await ensureIntentTables();
  return db
    .select()
    .from(scoreIntentRatings)
    .where(eq(scoreIntentRatings.assignmentId, assignmentId));
}

/**
 * Ratings are stored per (message, intent, def_hash) — every spec ever rated
 * keeps its rows so version checkout/rollback is instant. This picks the ONE
 * display row per (message, intent): the row matching the intent's wanted hash
 * when present (fresh), else the most recently rated row (shown as stale —
 * same "previous state until overwritten" philosophy as before the re-key).
 */
export function pickDisplayRatings<
  T extends { messageId: number; intentId: number; defHash: string; ratedAt: Date }
>(
  rows: T[],
  wantedHashByIntent: ReadonlyMap<number, string>
): Map<number, Map<number, { row: T; fresh: boolean }>> {
  const byMessage = new Map<number, Map<number, { row: T; fresh: boolean }>>();
  for (const r of rows) {
    let m = byMessage.get(r.messageId);
    if (!m) {
      m = new Map();
      byMessage.set(r.messageId, m);
    }
    const fresh = r.defHash === wantedHashByIntent.get(r.intentId);
    const prev = m.get(r.intentId);
    if (
      !prev ||
      (fresh && !prev.fresh) ||
      (fresh === prev.fresh && r.ratedAt.getTime() > prev.row.ratedAt.getTime())
    ) {
      m.set(r.intentId, { row: r, fresh });
    }
  }
  return byMessage;
}

export async function listDissections(assignmentId: string) {
  await ensureIntentTables();
  return db
    .select()
    .from(scoreDissections)
    .where(eq(scoreDissections.assignmentId, assignmentId));
}

/**
 * The text of one student (user) chat message, validated to belong to this
 * assignment (join through conversations → sessions). Used to snapshot pin
 * text and to reject pins on foreign/nonexistent messages. Returns null when
 * the message is not a user message of this assignment.
 */
export async function getAssignmentMessageText(
  assignmentId: string,
  messageId: number
): Promise<string | null> {
  const rows = await db
    .select({ content: chatMessages.content, role: chatMessages.role })
    .from(chatMessages)
    .innerJoin(chatConversations, eq(chatMessages.conversationId, chatConversations.id))
    .innerJoin(studentSessions, eq(chatConversations.sessionId, studentSessions.id))
    .where(and(eq(chatMessages.id, messageId), eq(studentSessions.assignmentId, assignmentId)));
  const row = rows[0];
  if (!row || row.role !== 'user' || !row.content?.trim()) return null;
  return row.content;
}

/* ------------------------------------------------------------------ */
/* Version snapshots                                                   */
/* ------------------------------------------------------------------ */

export interface IntentConfigSnapshot {
  intents: {
    id: number;
    title: string;
    definition: string;
    rule: string | null;
    archived: boolean;
    isTemplate?: boolean;
    // v7 tree. Optional so snapshots written before the migration still parse:
    // readers must default (kind → 'intent', the rest → null).
    kind?: string;
    type?: string | null;
    parentIntentId?: number | null;
    position?: number | null;
  }[];
  pins: {
    intentId: number;
    messageId: number;
    verdict: string;
    queryText: string;
    reason?: string | null;
    source: string;
  }[];
  links: { fromIntentId: number; toIntentId: number }[];
  ratingPromptVersion: number;
  dissectionVersion: number;
  /** TYPE_CLASSIFIER_VERSION at snapshot time. Absent on pre-v7 snapshots. */
  typeClassifierVersion?: number;
  /** Resolved Base Prompt at snapshot time — reference only (§1.9: the base
   * prompt is managed in SWAG assignment settings, not in the SCORE loop). */
  basePrompt: string;
}

export interface VersionSummary {
  action:
    | 'create_intent'
    | 'update_intent'
    | 'archive_intent'
    | 'restore_intent'
    | 'add_pin'
    | 'remove_pin'
    | 'add_link'
    | 'remove_link'
    // Ownership decision (§2.4) that diverged → per-question contrast pins
    // committed as ONE change (one version, provenance in detail).
    | 'ownership_pins'
    // v7 tree edits. Both are MAJOR: they change which rule a question gets
    // (routing is position-sensitive) even though they cost zero LLM calls, so
    // they must be as visible and revertible as a definition edit.
    // 'move_intent'    — re-parented into/out of another set
    // 'reorder_intent' — sibling order changed (writes position)
    | 'move_intent'
    | 'reorder_intent'
    | 'revert';
  intentIds?: number[];
  messageId?: number;
  detail?: string;
  /** MINOR version: an Apply persisted the spec (LLM re-rate — costly, so it
   * must be revertible) without registering it as a Save. The workbench
   * history folds minors into an accordion under their preceding major. */
  minor?: boolean;
  /** Save-time counts from the Intent modal (for the history display):
   * included/excluded = labeled examples, inCount = questions in the intent. */
  stats?: { included: number; excluded: number; inCount: number };
}

/** Minor entries fold into the workbench-history accordion under their
 * preceding major, and do NOT advance an intent's displayed version number:
 * the silent Apply persists (flagged by the client) and the pin-label
 * bookkeeping. Everything else — Save, create, archive/restore, ownership,
 * revert — is a major. Old rows carry no flag and read as major (back-compat).
 * Shared by the versions route (numbering) and the board (the "When vN" count)
 * so the two can never disagree. */
export function isMinorVersion(summary: VersionSummary): boolean {
  return summary.minor === true || summary.action === 'add_pin' || summary.action === 'remove_pin';
}

/**
 * Write the next full snapshot for the assignment. MUST run in the same
 * transaction as the mutation it records, AFTER the mutation, so the snapshot
 * reflects the post-change state. Returns the new version number.
 * (Concurrent editors racing to the same version_no fail on the unique index
 * and roll back together with their mutation — retry is the client's job.)
 */
export async function recordConfigVersion(
  tx: ScoreDb,
  assignmentId: string,
  createdBy: string | null,
  summary: VersionSummary
): Promise<number> {
  const [intents, pins, links, current, assignmentRows] = await Promise.all([
    listIntents(tx, assignmentId),
    listPins(tx, assignmentId),
    listLinks(tx, assignmentId),
    latestVersionNo(tx, assignmentId),
    tx
      .select({
        customSystemPrompt: assignments.customSystemPrompt,
        instructions: assignments.instructions,
        includeInstructionInPrompt: assignments.includeInstructionInPrompt,
      })
      .from(assignments)
      .where(eq(assignments.id, assignmentId)),
  ]);

  const snapshot: IntentConfigSnapshot = {
    intents: intents.map((i) => ({
      id: i.id,
      title: i.title,
      definition: i.definition,
      rule: i.rule,
      archived: i.archived,
      isTemplate: i.isTemplate,
      kind: i.kind,
      type: i.type,
      parentIntentId: i.parentIntentId,
      position: i.position,
    })),
    pins: pins.map((p) => ({
      intentId: p.intentId,
      messageId: p.messageId,
      verdict: p.verdict,
      queryText: p.queryText,
      reason: p.reason,
      source: p.source,
    })),
    links: links.map((l) => ({ fromIntentId: l.fromIntentId, toIntentId: l.toIntentId })),
    ratingPromptVersion: INTENT_RATING_VERSION,
    dissectionVersion: DISSECTION_VERSION,
    typeClassifierVersion: TYPE_CLASSIFIER_VERSION,
    basePrompt: assignmentBasePrompt(assignmentRows[0] ?? {}),
  };

  const versionNo = current + 1;
  await tx.insert(scoreConfigVersions).values({
    assignmentId,
    versionNo,
    snapshot,
    summary,
    createdBy,
    createdAt: new Date(),
  });
  return versionNo;
}
