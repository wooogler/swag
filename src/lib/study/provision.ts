/**
 * SCORE user-study provisioning.
 *
 * A participant is one instructor account that owns a CLONE of every configured
 * dataset (STUDY_DATASETS). Each clone copies the master's message log + the
 * pre-computed SCORE STARTER SET (its template intents and their "Run all"
 * ratings, plus the message-scoped dissection/embedding/classification caches)
 * and NOTHING ELSE — active intents, rules, pins/links on active intents, and
 * all version/deploy history on the master are ignored. So every participant,
 * on every dataset, begins from the same clean, fully-rated starter set:
 *
 *   • Because intentDefHash is assignment-independent, the copied template
 *     ratings stay valid → provisioning costs ZERO LLM calls.
 *   • Because only the template set is taken, a master that the researcher has
 *     since explored (active intents, rules, deploys) still yields a pristine
 *     participant board — no "pristine master" precondition.
 *
 * (Same temp-table serial-id remap the one-off scripts/swag/build_swag_dataset.sql
 * uses, generalized + parameterized.)
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db/db';
import {
  assignments,
  instructors,
  scoreIntents,
  studyClones,
  studyParticipants,
  type StudyClone,
  type StudyParticipant,
} from '@/db/schema';
import { ensureScoreTable } from '@/lib/score/queries';
import { ensureIntentTables } from '@/lib/score/intent-store';
import {
  STUDY_DATASETS,
  STUDY_EMAIL_DOMAIN,
  studyMasterToken,
  type StudioFamily,
  type StudyDataset,
} from './config';
import {
  ensureStudyTables,
  getParticipantByNumber,
  normalizeParticipantNumber,
} from './store';
import { deleteParticipantClones, deleteParticipantCloneByDataset } from './teardown';
import { blockPlan, cellOf, isStudyCell, planForCell, type StudyCell } from './phases';

export type CloneCounts = Record<string, number>;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Keep only these conversations, and within each only turns up to and
 * including `maxSequence`. Used to build the reduced STUDY masters, which hold
 * just the curated review set with each thread cut at its last curated turn. */
export interface CloneRestriction {
  conversationId: string;
  maxSequence: number;
}

/**
 * Deep-clone the source assignment's message log + SCORE starter set into a new
 * assignment owned by `newInstructorId`. Runs entirely inside `tx`; temp maps
 * are ON COMMIT DROP. Returns per-table copied row counts.
 *
 * With `restrictTo`, the copy is a SUBSET. Every per-message cache below joins
 * through _msg_map, so restricting the three id maps filters all of them at
 * once — but the restriction has to be applied to BOTH sides of the 1:1 remap
 * assertion in step 6, or a legitimate subset copy trips it.
 */
export async function cloneStarterSet(
  tx: Tx,
  opts: {
    sourceAssignmentId: string;
    newAssignmentId: string;
    newInstructorId: string;
    shareToken: string;
    newTitle: string;
    includeEditorEvents: boolean;
    restrictTo?: CloneRestriction[];
    /** Source message ids to mark as the curated review set on the new
     * assignment. Used when BUILDING a reduced master; a clone of one inherits
     * its marks automatically (below) and passes nothing here. */
    markReviewSourceMessageIds?: number[];
  }
): Promise<CloneCounts> {
  const { sourceAssignmentId, newAssignmentId, newInstructorId, shareToken, newTitle, includeEditorEvents, restrictTo, markReviewSourceMessageIds } = opts;
  const counts: CloneCounts = {};
  const restricted = Array.isArray(restrictTo);

  // The cut list, as a table so every step below can join the SAME predicate.
  // Unrestricted clones get one row per conversation with an open-ended cutoff,
  // which makes the joins a no-op and keeps a single code path.
  await tx.execute(sql`CREATE TEMP TABLE _keep (conv_id text PRIMARY KEY, max_seq integer NOT NULL) ON COMMIT DROP`);
  if (restricted) {
    if (restrictTo!.length === 0) throw new Error('restrictTo is empty — refusing to build an empty clone');
    const values = sql.join(
      restrictTo!.map((r) => sql`(${r.conversationId}, ${r.maxSequence})`),
      sql`, `
    );
    await tx.execute(sql`INSERT INTO _keep (conv_id, max_seq) VALUES ${values} ON CONFLICT (conv_id) DO UPDATE SET max_seq = GREATEST(_keep.max_seq, EXCLUDED.max_seq)`);
  } else {
    await tx.execute(sql`
      INSERT INTO _keep (conv_id, max_seq)
      SELECT c.id, 2147483647
      FROM chat_conversations c
      JOIN student_sessions s ON s.id = c.session_id
      WHERE s.assignment_id = ${sourceAssignmentId}
    `);
  }

  // 1) New assignment row — copy every field except id/title/token/owner/created.
  await tx.execute(sql`
    INSERT INTO assignments
      (id, title, instructions, criteria, deadline, share_token, instructor_id,
       custom_system_prompt, include_instruction_in_prompt, allow_web_search,
       strict_paste_blocking, created_at)
    SELECT ${newAssignmentId}, ${newTitle}, instructions, criteria, deadline,
           ${shareToken}, ${newInstructorId}, custom_system_prompt,
           include_instruction_in_prompt, allow_web_search, strict_paste_blocking, now()
    FROM assignments WHERE id = ${sourceAssignmentId}
  `);

  // 2) Session map + copy. A restricted clone keeps only the students whose
  //    threads survive the cut — an empty session would otherwise show up in
  //    the reduced master as a student who asked nothing.
  await tx.execute(sql`
    CREATE TEMP TABLE _sess_map ON COMMIT DROP AS
    SELECT id AS old_id, gen_random_uuid()::text AS new_id
    FROM student_sessions s
    WHERE s.assignment_id = ${sourceAssignmentId}
      AND (${!restricted} OR EXISTS (
        SELECT 1 FROM chat_conversations c
        JOIN _keep k ON k.conv_id = c.id
        WHERE c.session_id = s.id
      ))
  `);
  await tx.execute(sql`
    INSERT INTO student_sessions
      (id, assignment_id, user_id, participant_token, student_first_name, student_last_name,
       student_email, password, is_verified, started_at, last_saved_at, last_login_at, metadata)
    SELECT m.new_id, ${newAssignmentId}, s.user_id, s.participant_token, s.student_first_name,
           s.student_last_name, s.student_email, s.password, s.is_verified, s.started_at,
           s.last_saved_at, s.last_login_at, s.metadata
    FROM student_sessions s JOIN _sess_map m ON m.old_id = s.id
  `);
  counts.student_sessions = await tempCount(tx, '_sess_map');

  // 3) Editor events (optional — SCORE doesn't need them; dissections are cached).
  if (includeEditorEvents) {
    await tx.execute(sql`
      INSERT INTO editor_events (session_id, event_type, event_data, timestamp, sequence_number)
      SELECT m.new_id, e.event_type, e.event_data, e.timestamp, e.sequence_number
      FROM editor_events e JOIN _sess_map m ON m.old_id = e.session_id
    `);
    counts.editor_events = await assignmentCount(tx, 'editor_events', newAssignmentId, { via: 'session' });
  }

  // 4) Conversation map + copy.
  await tx.execute(sql`
    CREATE TEMP TABLE _conv_map ON COMMIT DROP AS
    SELECT c.id AS old_id, gen_random_uuid()::text AS new_id, m.new_id AS new_session_id
    FROM chat_conversations c
    JOIN _sess_map m ON m.old_id = c.session_id
    JOIN _keep k ON k.conv_id = c.id
  `);
  await tx.execute(sql`
    INSERT INTO chat_conversations (id, session_id, title, created_at)
    SELECT cm.new_id, cm.new_session_id, c.title, c.created_at
    FROM chat_conversations c JOIN _conv_map cm ON cm.old_id = c.id
  `);
  counts.chat_conversations = await tempCount(tx, '_conv_map');

  // 5) Messages (serial id → omit; remap conversation). The cutoff truncates
  //    each thread at its last curated turn, so a participant reads exactly the
  //    context the chatbot had — and never a turn that comes after it.
  await tx.execute(sql`
    INSERT INTO chat_messages (conversation_id, role, content, metadata, timestamp, sequence_number)
    SELECT cm.new_id, msg.role, msg.content, msg.metadata, msg.timestamp, msg.sequence_number
    FROM chat_messages msg
    JOIN _conv_map cm ON cm.old_id = msg.conversation_id
    JOIN _keep k ON k.conv_id = msg.conversation_id AND msg.sequence_number <= k.max_seq
  `);

  // 6) Message map via natural key (new conversation, sequence_number). Assert
  //    it is 1:1 with the source messages — a collision would silently drop
  //    score rows, so fail the whole clone instead. BOTH sides of the comparison
  //    carry the cutoff: counting the untruncated source here would make every
  //    legitimate subset copy look like a collision.
  await tx.execute(sql`
    CREATE TEMP TABLE _msg_map ON COMMIT DROP AS
    SELECT o.id AS old_id, n.id AS new_id
    FROM _conv_map cm
    JOIN _keep k ON k.conv_id = cm.old_id
    JOIN chat_messages o ON o.conversation_id = cm.old_id AND o.sequence_number <= k.max_seq
    JOIN chat_messages n ON n.conversation_id = cm.new_id AND n.sequence_number = o.sequence_number
  `);
  const mappedMsgs = await tempCount(tx, '_msg_map');
  const srcMsgs = await countExpr(
    tx,
    sql`SELECT count(*)::int AS n
        FROM chat_messages msg
        JOIN _conv_map cm ON cm.old_id = msg.conversation_id
        JOIN _keep k ON k.conv_id = msg.conversation_id AND msg.sequence_number <= k.max_seq`
  );
  if (mappedMsgs !== srcMsgs) {
    throw new Error(
      `Message remap collision: mapped ${mappedMsgs} of ${srcMsgs} messages ` +
        `(non-unique (conversation, sequence_number) in source ${sourceAssignmentId}).`
    );
  }
  counts.chat_messages = mappedMsgs;

  // 7) Starter-set intents ONLY (is_template = true), reset to a clean template:
  //    rule cleared, archived false. Insert one-by-one to build the old→new id
  //    map (serial ids), then materialize it for the bulk child remaps. Clearing
  //    the rule does NOT change intentDefHash (definition + pins only), so the
  //    copied ratings stay valid.
  //    The is_template filter is deliberate and load-bearing for v7: the 4 type
  //    roots and the baseline prompt-holder are NOT cloned. Each clone grows its
  //    own lazily (ensureTypeRoots / getOrCreatePromptHolder), seeded from the
  //    clone's own base prompt — so a master's edited else-rules never leak into
  //    a participant's board (D12), and rule:null below can't erase them.
  const srcIntents = await tx
    .select()
    .from(scoreIntents)
    .where(and(eq(scoreIntents.assignmentId, sourceAssignmentId), eq(scoreIntents.isTemplate, true)))
    .orderBy(scoreIntents.id);
  const intentPairs: [number, number][] = [];
  for (const it of srcIntents) {
    const inserted = await tx
      .insert(scoreIntents)
      .values({
        assignmentId: newAssignmentId,
        title: it.title,
        definition: it.definition,
        rule: null,
        archived: false,
        isTemplate: true,
        // v7 tree fields ride along. This .values() list is explicit (no
        // SELECT *), so any new score_intents column MUST be added here or
        // clones silently lose it. parent_intent_id still holds the SOURCE id
        // at this point — remapped in the post-pass below, once _intent_map is
        // complete (insertion order does not guarantee parents come first).
        kind: it.kind,
        type: it.type,
        parentIntentId: it.parentIntentId,
        position: it.position,
        createdAt: it.createdAt,
        updatedAt: it.updatedAt,
      })
      .returning({ id: scoreIntents.id });
    intentPairs.push([it.id, inserted[0].id]);
  }
  await tx.execute(sql`CREATE TEMP TABLE _intent_map (old_id integer, new_id integer) ON COMMIT DROP`);
  if (intentPairs.length > 0) {
    const values = sql.join(
      intentPairs.map(([o, n]) => sql`(${o}, ${n})`),
      sql`, `
    );
    await tx.execute(sql`INSERT INTO _intent_map (old_id, new_id) VALUES ${values}`);
    // Remap parent pointers old→new. A parent outside the copied set (e.g. a
    // template nested under a live intent, which is not cloned) becomes NULL —
    // a top-level node in the clone — rather than a dangling cross-assignment
    // pointer.
    await tx.execute(sql`
      UPDATE score_intents i
      SET parent_intent_id = (SELECT im.new_id FROM _intent_map im WHERE im.old_id = i.parent_intent_id)
      WHERE i.assignment_id = ${newAssignmentId} AND i.parent_intent_id IS NOT NULL
    `);
  }
  counts.score_intents = intentPairs.length;

  // 8) score_classifications — message/conversation/session (intent-independent).
  await tx.execute(sql`
    INSERT INTO score_classifications
      (assignment_id, message_id, conversation_id, session_id, query_text, response_text,
       prev_query_text, prev_response_text, turn_index, query_timestamp, type_a, subtype_a,
       subtype_tags_b, subtype_scores_b, raw_response_a, raw_response_b, model,
       classifier_version, classified_at)
    SELECT ${newAssignmentId}, mm.new_id, cm.new_id, sm.new_id, sc.query_text, sc.response_text,
           sc.prev_query_text, sc.prev_response_text, sc.turn_index, sc.query_timestamp, sc.type_a,
           sc.subtype_a, sc.subtype_tags_b, sc.subtype_scores_b, sc.raw_response_a, sc.raw_response_b,
           sc.model, sc.classifier_version, sc.classified_at
    FROM score_classifications sc
    JOIN _msg_map  mm ON mm.old_id = sc.message_id
    JOIN _conv_map cm ON cm.old_id = sc.conversation_id
    JOIN _sess_map sm ON sm.old_id = sc.session_id
    WHERE sc.assignment_id = ${sourceAssignmentId}
  `);
  counts.score_classifications = await assignmentCount(tx, 'score_classifications', newAssignmentId);

  // 9) score_intent_ratings — TEMPLATE ratings only (join drops active intents).
  //    def_hash carries over unchanged → no re-rating.
  await tx.execute(sql`
    INSERT INTO score_intent_ratings
      (assignment_id, message_id, intent_id, rating, rationale, def_hash, raw_response, model, rated_at)
    SELECT ${newAssignmentId}, mm.new_id, im.new_id, r.rating, r.rationale, r.def_hash,
           r.raw_response, r.model, r.rated_at
    FROM score_intent_ratings r
    JOIN _msg_map    mm ON mm.old_id = r.message_id
    JOIN _intent_map im ON im.old_id = r.intent_id
    WHERE r.assignment_id = ${sourceAssignmentId}
  `);
  counts.score_intent_ratings = await assignmentCount(tx, 'score_intent_ratings', newAssignmentId);

  // 10) score_dissections — message-scoped.
  await tx.execute(sql`
    INSERT INTO score_dissections
      (assignment_id, message_id, material_kinds, requests, materials, version, raw_response, model, created_at)
    SELECT ${newAssignmentId}, mm.new_id, d.material_kinds, d.requests, d.materials, d.version, d.raw_response,
           d.model, d.created_at
    FROM score_dissections d JOIN _msg_map mm ON mm.old_id = d.message_id
    WHERE d.assignment_id = ${sourceAssignmentId}
  `);
  counts.score_dissections = await assignmentCount(tx, 'score_dissections', newAssignmentId);

  // 10b) score_query_types — message-scoped (v7 type layer). Copied, never
  //      recomputed: message content is immutable, so the master's judgment is
  //      valid for the clone verbatim, and provisioning stays zero-LLM. The
  //      version column carries over as-is so a later TYPE_CLASSIFIER_VERSION
  //      bump correctly marks cloned rows stale.
  await tx.execute(sql`
    INSERT INTO score_query_types
      (assignment_id, message_id, type, rationale, version, raw_response, model, created_at)
    SELECT ${newAssignmentId}, mm.new_id, t.type, t.rationale, t.version, t.raw_response,
           t.model, t.created_at
    FROM score_query_types t JOIN _msg_map mm ON mm.old_id = t.message_id
    WHERE t.assignment_id = ${sourceAssignmentId}
  `);
  counts.score_query_types = await assignmentCount(tx, 'score_query_types', newAssignmentId);

  // 11) score_query_embeddings — message-scoped.
  await tx.execute(sql`
    INSERT INTO score_query_embeddings (assignment_id, message_id, embedding, model, created_at)
    SELECT ${newAssignmentId}, mm.new_id, e.embedding, e.model, e.created_at
    FROM score_query_embeddings e JOIN _msg_map mm ON mm.old_id = e.message_id
    WHERE e.assignment_id = ${sourceAssignmentId}
  `);
  counts.score_query_embeddings = await assignmentCount(tx, 'score_query_embeddings', newAssignmentId);

  // 12) score_subtype_scores — message-scoped.
  await tx.execute(sql`
    INSERT INTO score_subtype_scores
      (assignment_id, message_id, subtype_code, score, def_hash, raw_response, model, scored_at)
    SELECT ${newAssignmentId}, mm.new_id, ss.subtype_code, ss.score, ss.def_hash, ss.raw_response,
           ss.model, ss.scored_at
    FROM score_subtype_scores ss JOIN _msg_map mm ON mm.old_id = ss.message_id
    WHERE ss.assignment_id = ${sourceAssignmentId}
  `);
  counts.score_subtype_scores = await assignmentCount(tx, 'score_subtype_scores', newAssignmentId);

  // 13) score_intent_pins — TEMPLATE pins only (starter boundary examples).
  //     ORDER BY the source (created_at, id) so the clone's fresh serial ids are
  //     assigned in the SAME relative order: pin order feeds intentDefHash, and
  //     a reordered tiebreak would diverge the hash and needlessly re-rate.
  await tx.execute(sql`
    INSERT INTO score_intent_pins
      (assignment_id, intent_id, message_id, verdict, query_text, reason, source,
       status, consumed_at_version, consumed_at, created_at)
    SELECT ${newAssignmentId}, im.new_id, mm.new_id, p.verdict, p.query_text, p.reason, p.source,
           p.status, p.consumed_at_version, p.consumed_at, p.created_at
    FROM score_intent_pins p
    JOIN _intent_map im ON im.old_id = p.intent_id
    JOIN _msg_map    mm ON mm.old_id = p.message_id
    WHERE p.assignment_id = ${sourceAssignmentId}
    ORDER BY p.created_at, p.id
  `);
  counts.score_intent_pins = await assignmentCount(tx, 'score_intent_pins', newAssignmentId);

  // 15) score_rule_previews — TEMPLATE previews only (cached).
  await tx.execute(sql`
    INSERT INTO score_rule_previews
      (assignment_id, message_id, intent_id, prompt_hash, response, model, created_at)
    SELECT ${newAssignmentId}, mm.new_id, im.new_id, rp.prompt_hash, rp.response, rp.model, rp.created_at
    FROM score_rule_previews rp
    JOIN _msg_map    mm ON mm.old_id = rp.message_id
    JOIN _intent_map im ON im.old_id = rp.intent_id
    WHERE rp.assignment_id = ${sourceAssignmentId}
  `);
  counts.score_rule_previews = await assignmentCount(tx, 'score_rule_previews', newAssignmentId);

  // 16) Review-set marks. Two sources, both remapped through _msg_map while it
  //     still exists: an explicit list (building a reduced master) and the
  //     source's own marks (cloning one for a participant). A source with no
  //     marks contributes none, so ordinary clones stay unmarked.
  if (markReviewSourceMessageIds && markReviewSourceMessageIds.length > 0) {
    const ids = sql.join(
      markReviewSourceMessageIds.map((id) => sql`${id}`),
      sql`, `
    );
    await tx.execute(sql`
      INSERT INTO study_review_questions (assignment_id, message_id)
      SELECT ${newAssignmentId}, mm.new_id
      FROM _msg_map mm WHERE mm.old_id IN (${ids})
      ON CONFLICT DO NOTHING
    `);
  }
  await tx.execute(sql`
    INSERT INTO study_review_questions (assignment_id, message_id)
    SELECT ${newAssignmentId}, mm.new_id
    FROM study_review_questions rq
    JOIN _msg_map mm ON mm.old_id = rq.message_id
    WHERE rq.assignment_id = ${sourceAssignmentId}
    ON CONFLICT DO NOTHING
  `);
  counts.study_review_questions = await countExpr(
    tx,
    sql`SELECT count(*)::int AS n FROM study_review_questions WHERE assignment_id = ${newAssignmentId}`
  );

  await tx.execute(sql`DROP TABLE IF EXISTS _sess_map, _conv_map, _msg_map, _intent_map, _keep`);
  return counts;
}

/* ------------------------------------------------------------------ */
/* Account + clone lifecycle (find-or-create, race-safe)               */
/* ------------------------------------------------------------------ */

async function createAccount(
  number: string,
  cell?: StudyCell,
  family?: StudioFamily
): Promise<StudyParticipant> {
  const instructorId = randomUUID();
  const participantId = randomUUID();
  const email = `${number.toLowerCase()}@${STUDY_EMAIL_DOMAIN}`;
  return db.transaction(async (tx) => {
    // Real instructor-role account (getInstructor gates only on role); no
    // password — participants sign in via /study with the shared passcode.
    await tx.insert(instructors).values({
      id: instructorId,
      email,
      password: null,
      firstName: 'Study',
      lastName: number,
      role: 'instructor',
      isVerified: true,
      createdAt: new Date(),
    });
    const [row] = await tx
      .insert(studyParticipants)
      .values({
        id: participantId,
        participantNumber: number,
        instructorId,
        label: `Study ${number}`,
        accessToken: newAccessToken(),
        ...(family ? { conditionFamily: family } : {}),
        ...(cell
          ? { cell, blockOrder: planForCell(cell, family).map((b) => b.datasetKey).join(',') }
          : {}),
        createdAt: new Date(),
      })
      .returning();
    return row;
  });
}

/** Find-or-create the participant's account (no clones yet). Race-safe on the
 * participant_number unique index. */
export async function ensureParticipantAccount(
  participantNumber: string,
  cell?: StudyCell,
  family?: StudioFamily
): Promise<StudyParticipant> {
  const number = normalizeParticipantNumber(participantNumber);
  const existing = await getParticipantByNumber(number);
  if (existing) return existing;
  try {
    return await createAccount(number, cell, family);
  } catch (err) {
    const after = await getParticipantByNumber(number);
    if (after) return after;
    throw err;
  }
}

/**
 * The link a participant is handed IS their credential, so it has to be
 * unguessable — 32 bytes of urlsafe base64, not the participant number.
 */
export function newAccessToken(): string {
  return randomBytes(24).toString('base64url');
}

/**
 * The master a clone is actually made from: the reduced study master once one
 * has been built, otherwise the full log named in STUDY_DATASETS.
 *
 * Resolved by share token at provision time rather than by editing config.ts
 * after each build. A rebuild mints a NEW assignment id, so a hard-coded id
 * would have to be corrected by hand every time — and a source edit that has
 * to follow a button is the step that gets forgotten, silently handing the
 * next participant the whole 507-message log.
 */
export async function resolveMasterAssignmentId(dataset: StudyDataset): Promise<string> {
  const [built] = await db
    .select({ id: assignments.id })
    .from(assignments)
    .where(eq(assignments.shareToken, studyMasterToken(dataset.key)));
  return built?.id ?? dataset.assignmentId;
}

async function provisionClone(participant: StudyParticipant, dataset: StudyDataset): Promise<StudyClone> {
  const assignmentId = randomUUID();
  const shareToken = `study-${participant.participantNumber.toLowerCase()}-${dataset.key}`;
  // Participant-facing clean title (no "… Dataset" / no participant-number
  // suffix). The researcher distinguishes clones by owner in the admin dashboard.
  const newTitle = dataset.cloneTitle;
  const sourceAssignmentId = await resolveMasterAssignmentId(dataset);

  return db.transaction(async (tx) => {
    await cloneStarterSet(tx, {
      sourceAssignmentId,
      newAssignmentId: assignmentId,
      newInstructorId: participant.instructorId,
      shareToken,
      newTitle,
      includeEditorEvents: false,
    });
    const [row] = await tx
      .insert(studyClones)
      .values({
        id: randomUUID(),
        participantId: participant.id,
        datasetKey: dataset.key,
        assignmentId,
        sourceAssignmentId,
        // From the participant's ASSIGNED cell — the researcher chose this
        // pairing, so it cannot be re-derived from the number here.
        condition:
          blockPlan(participant).find((b) => b.datasetKey === dataset.key)?.condition ?? 'score',
        createdAt: new Date(),
      })
      .returning();
    return row;
  });
}

/** Find-or-create this participant's clone of one dataset. Race-safe on the
 * (participant, dataset) unique index — a loser's whole clone rolls back. */
export async function ensureClone(participant: StudyParticipant, dataset: StudyDataset): Promise<StudyClone> {
  const existing = await db.query.studyClones.findFirst({
    where: and(eq(studyClones.participantId, participant.id), eq(studyClones.datasetKey, dataset.key)),
  });
  if (existing) return existing;
  try {
    return await provisionClone(participant, dataset);
  } catch (err) {
    const after = await db.query.studyClones.findFirst({
      where: and(eq(studyClones.participantId, participant.id), eq(studyClones.datasetKey, dataset.key)),
    });
    if (after) return after;
    throw err;
  }
}

/**
 * Entry point for the /study login: ensure the participant account exists and
 * has a clone of every configured dataset, provisioning whatever is missing
 * (first sign-in provisions all clones; returning sign-ins are instant).
 */
export async function ensureParticipantSetup(
  participantNumber: string,
  /** Only used when the participant does not exist yet; never overwrites. */
  cell?: StudyCell,
  /** Likewise: which build of the tools both of their blocks run in. */
  family?: StudioFamily
): Promise<{ participant: StudyParticipant; clones: StudyClone[] }> {
  const number = normalizeParticipantNumber(participantNumber);
  await Promise.all([ensureScoreTable(), ensureIntentTables(), ensureStudyTables()]);

  const account = await ensureParticipantAccount(number, cell, family);
  const participant = await recordCounterbalancing(account);
  const clones: StudyClone[] = [];
  for (const dataset of STUDY_DATASETS) {
    clones.push(await ensureClone(participant, dataset));
  }
  return { participant, clones };
}

/**
 * Make sure the row carries the cell it is running, and a link to reach it by.
 *
 * The cell is normally assigned at creation. This backfills the two cases that
 * arrive without one — rows made before the column existed, and the demo
 * accounts — from the old number rule, which is the cell those rows have
 * always effectively run. Never overwrites an assignment.
 */
async function recordCounterbalancing(participant: StudyParticipant): Promise<StudyParticipant> {
  const patch: Partial<typeof studyParticipants.$inferInsert> = {};
  if (!isStudyCell(participant.cell) || !participant.blockOrder) {
    const cell = cellOf(participant);
    patch.cell = cell;
    patch.blockOrder = planForCell(cell).map((b) => b.datasetKey).join(',');
  }
  if (!participant.accessToken) patch.accessToken = newAccessToken();
  if (Object.keys(patch).length === 0) return participant;
  const [updated] = await db
    .update(studyParticipants)
    .set(patch)
    .where(eq(studyParticipants.id, participant.id))
    .returning();
  return updated ?? participant;
}

/**
 * Reset a participant to the CURRENT master: delete their existing clones
 * (their SCORE work is discarded) but KEEP the account, then re-clone every
 * configured dataset from the master as it stands now. Their participant
 * number + passcode stay valid; the next sign-in shows the refreshed boards.
 * Use after editing a master's starter set (+ re-running "Run all" on it).
 */
export async function resetParticipant(
  participant: StudyParticipant
): Promise<{ participant: StudyParticipant; clones: StudyClone[] }> {
  await ensureStudyTables();
  await deleteParticipantClones(participant);
  return ensureParticipantSetup(participant.participantNumber);
}

/** Reset ONE dataset for a participant: discard that dataset's clone and re-clone
 * it from the current master, keeping the account and their other datasets. */
export async function resetParticipantDataset(
  participant: StudyParticipant,
  datasetKey: string
): Promise<StudyClone> {
  const dataset = STUDY_DATASETS.find((d) => d.key === datasetKey);
  if (!dataset) throw new Error(`Unknown dataset: ${datasetKey}`);
  await ensureStudyTables();
  await deleteParticipantCloneByDataset(participant, datasetKey);
  return ensureClone(participant, dataset);
}

/* ------------------------------------------------------------------ */
/* small count helpers                                                 */
/* ------------------------------------------------------------------ */

async function countExpr(tx: Tx, query: ReturnType<typeof sql>): Promise<number> {
  const rows = await tx.execute<{ n: number }>(query);
  return Number(rows[0]?.n ?? 0);
}

function tempCount(tx: Tx, table: string): Promise<number> {
  return countExpr(tx, sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)}`);
}

function assignmentCount(
  tx: Tx,
  table: string,
  assignmentId: string,
  opts?: { via: 'session' }
): Promise<number> {
  if (opts?.via === 'session') {
    return countExpr(
      tx,
      sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)} t
          JOIN student_sessions s ON s.id = t.session_id
          WHERE s.assignment_id = ${assignmentId}`
    );
  }
  return countExpr(
    tx,
    sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)} WHERE assignment_id = ${assignmentId}`
  );
}
