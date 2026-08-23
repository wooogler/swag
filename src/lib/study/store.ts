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

      // ── The simple version (docs/SCORE_SIMPLE_DESIGN.md) ────────────────
      // One timeline per clone. The snapshot IS the configuration — there are
      // no live rows beside it — so the newest un-hidden row is what the board
      // shows and what a question is answered against.
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "simple_config_versions" (
          "id" serial PRIMARY KEY NOT NULL,
          "assignment_id" text NOT NULL,
          "version_no" integer NOT NULL,
          "snapshot" jsonb NOT NULL,
          "name" text, "summary" text,
          -- Set when a restore steps back past this version. The participant
          -- sees the timeline end where they restored to; the row stays,
          -- because what someone built and then abandoned is RQ1 material.
          "hidden_at" timestamp,
          "created_by" text,
          "created_at" timestamp NOT NULL
        )`);
      await db.execute(
        sql`CREATE UNIQUE INDEX IF NOT EXISTS "simple_config_versions_unique" ON "simple_config_versions" ("assignment_id","version_no")`
      );
      // 'apply' = took effect, 'save' = took effect AND was marked as a point
      // to come back to. The newest row of either kind is what the board shows
      // and answers from; the newest SAVE is what the study measures. Defaulted
      // to 'save' so every row written before the split stays measurable.
      await db.execute(
        sql`ALTER TABLE "simple_config_versions" ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'save'`
      );

      // The version axis the participant actually reads: one timeline per
      // intent, holding the (definition, rule) PAIR each time it changes.
      //
      // The pair rather than the rule alone, because in this version they are
      // one thought — "when this, do that" — and a history of Thens with no
      // record of which When they answered is a history of half-sentences.
      //
      // The snapshot timeline above is still the configuration and still what
      // gets measured; this is a per-intent view of the same edits, kept as
      // rows because a version needs a number that survives, and a name a
      // model wrote once rather than on every read.
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "simple_intent_versions" (
          "id" serial PRIMARY KEY NOT NULL,
          "assignment_id" text NOT NULL,
          -- The intent's stable id (SimpleIntent.sid), or 0 for the
          -- everything-else rule, which has a history like any other.
          "sid" integer NOT NULL,
          "version_no" integer NOT NULL,
          "definition" text NOT NULL DEFAULT '',
          "rule" text NOT NULL DEFAULT '',
          "title" text NOT NULL DEFAULT '',
          -- Written asynchronously by a small model from this intent's own
          -- diff. Null until it lands, and null for good if it fails.
          "name" text, "summary" text,
          -- The snapshot this pair first appeared in, so a version can be
          -- placed on the configuration's own timeline.
          "config_version_no" integer,
          "created_at" timestamp NOT NULL
        )`);
      await db.execute(
        sql`CREATE UNIQUE INDEX IF NOT EXISTS "simple_intent_versions_unique" ON "simple_intent_versions" ("assignment_id","sid","version_no")`
      );
      await db.execute(
        sql`CREATE INDEX IF NOT EXISTS "simple_intent_versions_assignment_idx" ON "simple_intent_versions" ("assignment_id")`
      );

      // Judgments, keyed by the DEFINITION TEXT rather than by any intent id.
      // Editing one definition therefore re-rates that definition and nothing
      // else, moving or reordering an intent costs no calls at all, and typing
      // a definition back to what it was is a cache hit rather than a re-run.
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "simple_ratings" (
          "id" serial PRIMARY KEY NOT NULL,
          "assignment_id" text NOT NULL, "def_hash" text NOT NULL, "message_id" integer NOT NULL,
          "rating" text NOT NULL, "model" text, "rated_at" timestamp NOT NULL
        )`);
      await db.execute(
        sql`CREATE UNIQUE INDEX IF NOT EXISTS "simple_ratings_unique" ON "simple_ratings" ("assignment_id","def_hash","message_id")`
      );
      await db.execute(
        sql`CREATE INDEX IF NOT EXISTS "simple_ratings_assignment_idx" ON "simple_ratings" ("assignment_id")`
      );

      // When a save became the one the participant stands behind. Deploy is
      // the final save — the briefing tells them to deploy when it is ready —
      // and nothing measures a configuration that was never deployed.
      await db.execute(
        sql`ALTER TABLE "simple_config_versions" ADD COLUMN IF NOT EXISTS "deployed_at" timestamp`
      );

      // The next intent id to hand out, which only ever goes up.
      //
      // It used to be inferred: the largest sid in any stored snapshot, plus
      // one. That held while every write appended a row, and stopped holding
      // when applies began overwriting a single working row — an intent
      // created and deleted without ever being saved left no trace, so the
      // next one was handed the same id and inherited the dead one's examples,
      // its history and its cached verdicts. An id is what judgments, answers
      // and logged events all hang off, so it cannot be a guess about what
      // rows happen to exist.
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "simple_sid_counter" (
          "assignment_id" text PRIMARY KEY NOT NULL,
          "next_sid" integer NOT NULL
        )`);

      // The examples that stand for an intent, and order its question list.
      //
      // One row per example: either a real question from the log (message_id)
      // or a written one (text, with its vector beside it, since there is no
      // query cache to look it up in). They are the participant's — seeded at
      // creation from the question it was carved out of, or from a few the
      // model wrote, and then theirs to add to, remove and regenerate. Keyed
      // by INTENT and not by definition text, so rewording a definition does
      // not silently throw away examples somebody chose.
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "simple_intent_examples" (
          "id" serial PRIMARY KEY NOT NULL,
          "assignment_id" text NOT NULL, "sid" integer NOT NULL,
          "message_id" integer, "text" text, "embedding" jsonb,
          "model" text, "created_at" timestamp NOT NULL
        )`);
      await db.execute(
        sql`CREATE INDEX IF NOT EXISTS "simple_intent_examples_intent_idx" ON "simple_intent_examples" ("assignment_id","sid")`
      );

      // What a definition is ANCHORED to, for ordering its question list.
      //
      // Keyed by the definition text like the verdicts are, so editing a
      // wording and editing it back costs nothing, and two intents that
      // happen to describe the same thing share one anchor. `examples` are
      // the hypothetical questions a small model wrote from the definition —
      // a description and an instance sit in different places in embedding
      // space, so comparing a description with real questions ranks badly and
      // comparing invented questions with real ones ranks well. `anchor` is
      // their mean vector, which is the only part the ordering reads.
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "simple_definition_anchors" (
          "id" serial PRIMARY KEY NOT NULL,
          "assignment_id" text NOT NULL, "def_hash" text NOT NULL,
          "examples" jsonb NOT NULL, "anchor" jsonb NOT NULL,
          "model" text, "created_at" timestamp NOT NULL
        )`);
      await db.execute(
        sql`CREATE UNIQUE INDEX IF NOT EXISTS "simple_definition_anchors_unique" ON "simple_definition_anchors" ("assignment_id","def_hash")`
      );

      // The question an intent was carved out of.
      //
      // Not configuration — it changes no routing and no answer — so it is
      // not in the snapshot. It is what the ordering anchors on when there is
      // one, which is better than anything a model could invent: the
      // participant pointed at it themselves.
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "simple_intent_seeds" (
          "id" serial PRIMARY KEY NOT NULL,
          "assignment_id" text NOT NULL, "sid" integer NOT NULL,
          "message_id" integer NOT NULL, "created_at" timestamp NOT NULL
        )`);
      await db.execute(
        sql`CREATE UNIQUE INDEX IF NOT EXISTS "simple_intent_seeds_unique" ON "simple_intent_seeds" ("assignment_id","sid")`
      );

      // Responses, keyed by the RULE TEXT that produced them. Not by version:
      // an intent's rule is usually untouched from one save to the next, so
      // keying on the text means only the questions whose rule actually
      // changed regenerate, and switching between versions is instant wherever
      // the text is shared. The baseline arm's one document changes for every
      // question at once, which is the manipulation and not a bug to hide.
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "simple_previews" (
          "id" serial PRIMARY KEY NOT NULL,
          "assignment_id" text NOT NULL, "message_id" integer NOT NULL,
          "rule_hash" text NOT NULL, "response" text NOT NULL, "model" text,
          "created_at" timestamp NOT NULL
        )`);
      await db.execute(
        sql`CREATE UNIQUE INDEX IF NOT EXISTS "simple_previews_unique" ON "simple_previews" ("message_id","rule_hash")`
      );
      await db.execute(
        sql`CREATE INDEX IF NOT EXISTS "simple_previews_assignment_idx" ON "simple_previews" ("assignment_id")`
      );

      // A bookmark, and only a bookmark. It is not in any hash, any prompt or
      // any routing decision; it pins a row to the top of the list so a
      // question outside the intent being edited stays reachable while editing
      // it. (Nothing to do with the full version's score_intent_pins, which are
      // rulings on membership.)
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "simple_pins" (
          "id" serial PRIMARY KEY NOT NULL,
          "assignment_id" text NOT NULL, "message_id" integer NOT NULL,
          "created_at" timestamp NOT NULL
        )`);
      await db.execute(
        sql`CREATE UNIQUE INDEX IF NOT EXISTS "simple_pins_unique" ON "simple_pins" ("assignment_id","message_id")`
      );

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
      // Which build of the tools this participant's two blocks run in — 'full'
      // (the product board) or 'simple' (docs/SCORE_SIMPLE_DESIGN.md). It sits
      // on the participant rather than in the cell because it does not vary
      // within a session: the cell still counterbalances arm × dataset, and
      // this picks which pair of boards those arms are shown in. Defaulted so
      // every row that predates it keeps running the full version.
      await db.execute(
        sql`ALTER TABLE "study_participants" ADD COLUMN IF NOT EXISTS "condition_family" text NOT NULL DEFAULT 'full'`
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
        // Baseline pointing became a LIST of stretches rather than one, so the
        // offsets moved into their own column; the two above are the pilot's.
        `"pointed_spans" jsonb`,
        // The v2 instrument's free text. Retired by BLOCK_TEST v3 §9 and never
        // written any more, but kept so the pilot's rows stay readable.
        `"expectation" text`,
        `"whats_off" text`,
        // BLOCK_TEST v3 §4. Pass 1 is now four answers — Q1 the Desire anchor
        // (free text), Q2 the pointing above, Q3 confidence and Q4 expected
        // desirability, both on the 6-point agreement scale. Pass 2 is two
        // judgements on the same scale, Q5 against their teaching standards
        // and Q6 against their configuration, and the two free-text boxes the
        // negative half opens: P (the probe, at Q5 ≤ 3 OR Q6 ≤ 3) and F (the
        // repair, at Q5 ≤ 3).
        `"ideal" text`,
        `"confidence" smallint`,
        `"expect_desirable" smallint`,
        `"desirable" smallint`,
        `"follows_setup" smallint`,
        `"probe" text`,
        `"repair" text`,
        // Per-step durations from the moment the question appeared (ms). The
        // three timestamps above all land in ONE write — the prediction is a
        // single Next press — so without this there is no way to tell how long
        // the pointing step itself took, which is the comprehension measure
        // most directly about reading the configuration.
        `"timing" jsonb`,
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

      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "study_final_survey_answers" (
          "id" serial PRIMARY KEY NOT NULL,
          "participant_id" text NOT NULL,
          "item_key" text NOT NULL,
          "condition" text,
          "value" integer,
          "text" text,
          "answered_at" timestamp NOT NULL
        )`);
      // COALESCE, not the bare column: a unique index over a nullable column
      // treats every NULL as distinct, so the comparison items — which have no
      // condition — could each be inserted twice and the upsert would never
      // find the row it meant to update.
      await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "study_final_survey_answers_unique" ON "study_final_survey_answers" ("participant_id","item_key",COALESCE("condition",''))`);

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
