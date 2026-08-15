/**
 * SCORE user-study participant store.
 *
 * Owns (a) the runtime DDL for study_participants + study_clones (mirrors the
 * score tables — the drizzle migration journal is not used for recent tables),
 * including an in-place migration of the earlier single-clone table shape, (b)
 * participant-number normalization/validation shared by the /study login, and
 * (c) lookups.
 */
import { eq, sql } from 'drizzle-orm';
import { db } from '@/db/db';
import { studyClones, studyParticipants, type StudyClone, type StudyParticipant } from '@/db/schema';
import { PARTICIPANT_NUMBER_RE } from './config';

let ensured: Promise<void> | null = null;

/** Idempotently create/upgrade the study tables. */
export async function ensureStudyTables(): Promise<void> {
  if (process.env.NEXT_PHASE === 'phase-production-build') {
    return;
  }

  if (!ensured) {
    ensured = (async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "study_participants" (
          "id" text PRIMARY KEY NOT NULL,
          "participant_number" text NOT NULL,
          "instructor_id" text NOT NULL,
          "label" text,
          "created_at" timestamp NOT NULL,
          "last_login_at" timestamp
        )
      `);
      // Migrate the earlier single-clone shape (columns moved to study_clones /
      // auth moved to the shared passcode). No-ops on a fresh table.
      await db.execute(sql`
        ALTER TABLE "study_participants"
          DROP COLUMN IF EXISTS "assignment_id",
          DROP COLUMN IF EXISTS "source_assignment_id",
          DROP COLUMN IF EXISTS "passcode_hash"
      `);
      await db.execute(sql`
        CREATE UNIQUE INDEX IF NOT EXISTS "study_participants_number_unique"
        ON "study_participants" USING btree ("participant_number")
      `);

      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "study_clones" (
          "id" text PRIMARY KEY NOT NULL,
          "participant_id" text NOT NULL,
          "dataset_key" text NOT NULL,
          "assignment_id" text NOT NULL,
          "source_assignment_id" text NOT NULL,
          "created_at" timestamp NOT NULL
        )
      `);
      await db.execute(sql`
        CREATE UNIQUE INDEX IF NOT EXISTS "study_clones_participant_dataset_unique"
        ON "study_clones" USING btree ("participant_id", "dataset_key")
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS "study_clones_assignment_idx"
        ON "study_clones" USING btree ("assignment_id")
      `);
      await db.execute(sql`
        ALTER TABLE "study_clones"
        ADD COLUMN IF NOT EXISTS "condition" text NOT NULL DEFAULT 'score'
      `);

      // ── Baseline condition + shared study instrumentation (spec §2) ──
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "score_probe_ratings" (
          "id" serial PRIMARY KEY NOT NULL,
          "assignment_id" text NOT NULL, "def_hash" text NOT NULL, "message_id" integer NOT NULL,
          "rating" text NOT NULL, "raw_response" text, "model" text, "rated_at" timestamp NOT NULL
        )`);
      await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "score_probe_ratings_unique" ON "score_probe_ratings" ("assignment_id","def_hash","message_id")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "score_probe_ratings_assignment_idx" ON "score_probe_ratings" ("assignment_id")`);

      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "baseline_searches" (
          "id" text PRIMARY KEY NOT NULL,
          "assignment_id" text NOT NULL, "name" text, "type" text, "description" text NOT NULL, "def_hash" text NOT NULL,
          "created_at" timestamp NOT NULL, "last_run_at" timestamp
        )`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "baseline_searches_assignment_idx" ON "baseline_searches" ("assignment_id")`);
      // Added with the shared create-chooser (name) and the per-type filter
      // tree (type): clones provisioned before them have the table but not the
      // columns.
      await db.execute(sql`ALTER TABLE "baseline_searches" ADD COLUMN IF NOT EXISTS "name" text`);
      await db.execute(sql`ALTER TABLE "baseline_searches" ADD COLUMN IF NOT EXISTS "type" text`);

      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "baseline_prompt_versions" (
          "id" serial PRIMARY KEY NOT NULL,
          "assignment_id" text NOT NULL, "version_no" integer NOT NULL, "prompt" text NOT NULL,
          "deployed_at" timestamp, "created_at" timestamp NOT NULL
        )`);
      await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "baseline_prompt_versions_unique" ON "baseline_prompt_versions" ("assignment_id","version_no")`);

      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "baseline_previews" (
          "id" serial PRIMARY KEY NOT NULL,
          "assignment_id" text NOT NULL, "message_id" integer NOT NULL, "prompt_hash" text NOT NULL,
          "response" text NOT NULL, "model" text, "created_at" timestamp NOT NULL
        )`);
      await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "baseline_previews_unique" ON "baseline_previews" ("message_id","prompt_hash")`);

      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "review_set_items" (
          "id" serial PRIMARY KEY NOT NULL,
          "assignment_id" text NOT NULL, "scope" text NOT NULL, "message_id" integer NOT NULL,
          "source" text NOT NULL, "created_at" timestamp NOT NULL
        )`);
      await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "review_set_items_unique" ON "review_set_items" ("assignment_id","scope","message_id")`);

      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "study_events" (
          "id" serial PRIMARY KEY NOT NULL,
          "assignment_id" text NOT NULL, "event_type" text NOT NULL, "payload" jsonb, "created_at" timestamp NOT NULL
        )`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "study_events_assignment_idx" ON "study_events" ("assignment_id")`);
      // Phase transitions belong to the PARTICIPANT, not to one clone (break,
      // A/B and done span both), so the assignment becomes optional and the
      // participant becomes recordable.
      await db.execute(sql`ALTER TABLE "study_events" ADD COLUMN IF NOT EXISTS "participant_id" text`);
      await db.execute(sql`ALTER TABLE "study_events" ALTER COLUMN "assignment_id" DROP NOT NULL`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "study_events_participant_idx" ON "study_events" ("participant_id")`);

      // Session state: the counterbalancing cell (derived from the number, but
      // RECORDED so the analysis never has to re-derive it) and the phase the
      // facilitator has advanced the participant to.
      await db.execute(sql`ALTER TABLE "study_participants" ADD COLUMN IF NOT EXISTS "cell" integer`);
      // The per-participant start link. Unique so a token identifies one row;
      // nullable because existing rows are backfilled on next provision.
      await db.execute(
        sql`ALTER TABLE "study_participants" ADD COLUMN IF NOT EXISTS "access_token" text`
      );
      await db.execute(sql`
        CREATE UNIQUE INDEX IF NOT EXISTS "study_participants_access_token_unique"
        ON "study_participants" USING btree ("access_token")
      `);
      await db.execute(sql`ALTER TABLE "study_participants" ADD COLUMN IF NOT EXISTS "block_order" text`);
      await db.execute(sql`ALTER TABLE "study_participants" ADD COLUMN IF NOT EXISTS "phase" text NOT NULL DEFAULT 'not_started'`);
      // Demo accounts run the identical session on the isolated demo subtypes;
      // this is what keeps their rows out of the console and the export.
      await db.execute(
        sql`ALTER TABLE "study_participants" ADD COLUMN IF NOT EXISTS "is_demo" boolean NOT NULL DEFAULT false`
      );

      // ── Set curation (researcher admin tool) ────────────────────────────
      // Which MASTER question sits in which curated set. Keyed by master
      // message id; the unique index below is the set-exclusivity rule (a
      // question can be review OR test OR ab, never two).
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "study_set_members" (
          "id" serial PRIMARY KEY NOT NULL,
          "dataset_key" text NOT NULL,
          "set_kind" text NOT NULL,
          "source_message_id" integer NOT NULL,
          "position" double precision,
          "query_type" text,
          "subtype" text,
          "rating" text,
          "added_by" text,
          "created_at" timestamp NOT NULL
        )`);
      await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "study_set_members_unique" ON "study_set_members" ("dataset_key","source_message_id")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "study_set_members_kind_idx" ON "study_set_members" ("dataset_key","set_kind")`);

      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "study_curation_meta" (
          "dataset_key" text PRIMARY KEY NOT NULL,
          "demo_subtype" text,
          "locked_at" timestamp,
          "locked_by" text
        )`);
      // A demo runs on more than one subtype, so the isolated set became a
      // list. The old single-value column stays and is folded in below, because
      // a dataset confirmed before this change still carries its choice there.
      await db.execute(
        sql`ALTER TABLE "study_curation_meta" ADD COLUMN IF NOT EXISTS "demo_subtypes" jsonb`
      );
      await db.execute(sql`
        UPDATE "study_curation_meta"
           SET "demo_subtypes" = jsonb_build_array("demo_subtype")
         WHERE "demo_subtypes" IS NULL AND "demo_subtype" IS NOT NULL`);
      // Students named outright, beside the ones a subtype sweeps in. Isolating
      // by subtype is indirect — one subtype took 50 of SWAG's 507 questions —
      // and a demo only needs a couple of threads to show.
      await db.execute(
        sql`ALTER TABLE "study_curation_meta" ADD COLUMN IF NOT EXISTS "demo_participants" jsonb`
      );

      // Set sizes, editable by a researcher. Singleton: the design requires the
      // two datasets to carry matching set sizes, so this is deliberately NOT
      // per-dataset — a per-dataset figure could silently break that.
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "study_set_targets" (
          "id" integer PRIMARY KEY NOT NULL DEFAULT 1,
          "review" integer NOT NULL,
          "test" integer NOT NULL,
          "updated_at" timestamp NOT NULL,
          "updated_by" text,
          CONSTRAINT "study_set_targets_singleton" CHECK (id = 1)
        )`);
      // Design v2 dropped the blind A/B, so the third target has nothing to
      // size. NOT NULL with no default, so it has to go rather than be ignored:
      // an insert that omitted it would fail at the database, not the type.
      await db.execute(sql`ALTER TABLE "study_set_targets" DROP COLUMN IF EXISTS "ab"`);

      // The questionnaire, as a researcher currently has it worded. Singleton
      // JSON rather than a row per item: the whole instrument is edited and
      // saved as one thing, and item identity lives in the key inside it.
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "study_survey_config" (
          "id" integer PRIMARY KEY NOT NULL DEFAULT 1,
          "items" jsonb NOT NULL,
          "scale_max" integer NOT NULL DEFAULT 7,
          "updated_at" timestamp NOT NULL,
          "updated_by" text,
          CONSTRAINT "study_survey_config_singleton" CHECK (id = 1)
        )`);
      await db.execute(sql`ALTER TABLE "study_survey_config" ADD COLUMN IF NOT EXISTS "scale_max" integer NOT NULL DEFAULT 7`);

      // Which questions of a STUDY assignment are the curated review set. A
      // reduced master keeps whole threads so a question can be read in
      // context, and those earlier turns are questions too — this is what
      // separates "material to review" from "context to read". Absent for every
      // ordinary assignment, which is exactly why the board is unaffected there.
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "study_review_questions" (
          "id" serial PRIMARY KEY NOT NULL,
          "assignment_id" text NOT NULL,
          "message_id" integer NOT NULL
        )`);
      await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "study_review_questions_unique" ON "study_review_questions" ("assignment_id","message_id")`);

      // ── Study measurement: frozen question bank + frozen responses ───────
      // The block-test and A/B questions are NOT part of any clone's log, so
      // they live here as frozen text (context turns + question) rather than
      // as message ids a clone could resolve.
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "study_question_bank" (
          "id" serial PRIMARY KEY NOT NULL,
          "dataset_key" text NOT NULL,
          "kind" text NOT NULL,
          "position" integer NOT NULL,
          "source_message_id" integer,
          "context" jsonb NOT NULL,
          "question" text NOT NULL,
          "query_type" text,
          "subtype" text,
          "created_at" timestamp NOT NULL
        )`);
      await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "study_question_bank_slot_unique" ON "study_question_bank" ("dataset_key","kind","position")`);

      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "study_generated_responses" (
          "id" serial PRIMARY KEY NOT NULL,
          "participant_id" text NOT NULL,
          "clone_assignment_id" text NOT NULL,
          "bank_item_id" integer NOT NULL,
          "purpose" text NOT NULL,
          "config_ref" jsonb NOT NULL,
          "applied" jsonb,
          "outcome" text NOT NULL,
          "response" text NOT NULL,
          "model" text,
          "created_at" timestamp NOT NULL
        )`);
      await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "study_generated_responses_unique" ON "study_generated_responses" ("clone_assignment_id","bank_item_id")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "study_generated_responses_participant_idx" ON "study_generated_responses" ("participant_id")`);

      // Block test: the yes/no prediction is written BEFORE the response is
      // released, so the two timestamps are also the evidence that the guess
      // was not made with the answer in view.
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "study_test_answers" (
          "id" serial PRIMARY KEY NOT NULL,
          "participant_id" text NOT NULL,
          "clone_assignment_id" text NOT NULL,
          "bank_item_id" integer NOT NULL,
          "guess" boolean,
          "rating" smallint,
          "guessed_at" timestamp,
          "rated_at" timestamp
        )`);
      // Design v2 §5 adds a POINTING step between the guess and the reveal:
      // which intent (SCORE) or which stretch of the Rules document (Baseline)
      // the participant expects to shape the answer. The span is stored as
      // offsets AND as the text it covered — a redeploy rewrites the document
      // and the offsets stop meaning anything, while the quotation still does.
      for (const col of [
        `"pointed_kind" text`,
        `"pointed_intent_id" integer`,
        `"pointed_span_start" integer`,
        `"pointed_span_end" integer`,
        `"pointed_text" text`,
        `"pointed_at" timestamp`,
      ]) {
        await db.execute(
          sql`ALTER TABLE "study_test_answers" ADD COLUMN IF NOT EXISTS ${sql.raw(col)}`
        );
      }
      await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "study_test_answers_unique" ON "study_test_answers" ("clone_assignment_id","bank_item_id")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "study_test_answers_participant_idx" ON "study_test_answers" ("participant_id")`);
      // Per-block questionnaire. One row per answered item, so adding or
      // rewording a scale between the pilot and the study changes the config
      // rather than the schema.
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "study_survey_answers" (
          "id" serial PRIMARY KEY NOT NULL,
          "participant_id" text NOT NULL,
          "block" integer NOT NULL,
          "clone_assignment_id" text,
          "item_key" text NOT NULL,
          "value" integer NOT NULL,
          "answered_at" timestamp NOT NULL
        )`);
      await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "study_survey_answers_unique" ON "study_survey_answers" ("participant_id","block","item_key")`);

      // FK-column indexes on core tables that Postgres does NOT auto-create.
      // Without them, deleting a clone's sessions/conversations/messages forces
      // a full seq-scan of the referencing table per row to validate the FK —
      // catastrophic for editor_events (100k+ rows), turning a clone teardown
      // (reset/deprovision) into minutes. IF NOT EXISTS → built once; also speeds
      // ordinary session/replay reads.
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "editor_events_session_idx" ON "editor_events" USING btree ("session_id")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "chat_conversations_session_idx" ON "chat_conversations" USING btree ("session_id")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "chat_messages_conversation_idx" ON "chat_messages" USING btree ("conversation_id")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "score_classifications_message_fk_idx" ON "score_classifications" USING btree ("message_id")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "score_classifications_session_fk_idx" ON "score_classifications" USING btree ("session_id")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "score_classifications_conversation_fk_idx" ON "score_classifications" USING btree ("conversation_id")`);
    })().catch((err) => {
      ensured = null; // allow retry rather than caching the rejection
      throw err;
    });
  }
  return ensured;
}

/**
 * Canonical form of a participant number: trimmed, inner whitespace removed,
 * uppercased. So "p01", " P01 " and "P01" all resolve to the same participant.
 */
export function normalizeParticipantNumber(input: string): string {
  return input.trim().replace(/\s+/g, '').toUpperCase();
}

/** Whether a (normalized) participant number is an acceptable, cloneable code. */
export function isValidParticipantNumber(normalized: string): boolean {
  return PARTICIPANT_NUMBER_RE.test(normalized);
}

/** Look up a participant by (already-or-not normalized) number. */
export async function getParticipantByNumber(
  input: string
): Promise<StudyParticipant | undefined> {
  const number = normalizeParticipantNumber(input);
  if (!number) return undefined;
  return db.query.studyParticipants.findFirst({
    where: eq(studyParticipants.participantNumber, number),
  });
}

/** All dataset clones a participant currently owns. */
export async function getParticipantClones(participantId: string): Promise<StudyClone[]> {
  return db
    .select()
    .from(studyClones)
    .where(eq(studyClones.participantId, participantId));
}
