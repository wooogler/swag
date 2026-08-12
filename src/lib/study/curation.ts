/**
 * Set curation — the researcher-side assembly of the study's question sets.
 *
 * Reads the MASTER logs through the classification the system already has:
 *   • 4-type multiclass  → score_query_types (one verdict per message, ever)
 *   • starter subtypes   → score_intent_ratings on the master's TEMPLATE intents
 * so there is no cold start and no human labelling pass. The judge's grades are
 * the curation vocabulary too: clearly_in reads as "certain", probably_in as
 * "boundary" (design §4's certain/boundary split, derived rather than voted).
 *
 * Writes only study_set_members / study_curation_meta. The curated sets reach
 * participants by being BUILT INTO the reduced study masters (M6), never by
 * this table being read at study time.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db/db';
import {
  chatConversations,
  chatMessages,
  scoreDissections,
  scoreIntentRatings,
  scoreIntents,
  scoreQueryTypes,
  studentSessions,
  studyCurationMeta,
  studySetMembers,
  studySetTargets,
} from '@/db/schema';
import { getQueryRecords } from '@/lib/score/queries';
import {
  INTENT_RATING_VERSION,
  MATERIAL_PROMPT_MODE,
  SCORE_QUERY_TYPES,
  TYPE_CLASSIFIER_VERSION,
  intentDefHash,
  type DissectionResult,
  type MaterialKind,
  type MaterialSpan,
  type ScoreQueryType,
} from '@/lib/score/intents';
import { classifyMessageType } from '@/lib/score/type-classifier';
import { rateMessageIntents } from '@/lib/score/intent-classifier';
import { isOpenAIConfigured } from '@/lib/score/classifier';
import { createLimiter, SCORE_CONCURRENCY } from '@/lib/score/limiter';
import { getDefaultScoreModel } from '@/lib/score/models';
import { DEFAULT_SCORE_CONFIG } from '@/lib/score/default-config';
import { getScoreConfig } from '@/lib/score/config-store';
import { flattenSubtypes } from '@/lib/score/config';
import {
  LEGACY_TYPE_TO_QUERY_TYPE,
  buildJelsonSuggestions,
  jelsonToIntent,
} from '@/lib/score/jelson-suggest';
import {
  CURATION_DATASETS,
  CURATION_SET_KINDS,
  DEFAULT_SET_TARGETS,
  SET_TARGET_LIMITS,
  curationDataset,
  type CurationSetKind,
  type SetTargets,
} from './config';
import { ensureStudyTables } from './store';

/** Judge grades curation exposes. Everything else is "not in this subtype". */
export type CurationGrade = 'clearly_in' | 'probably_in';

export interface CurationSubtype {
  intentId: number;
  title: string;
  type: ScoreQueryType | null; // via the starter taxonomy, not the intent row
  /** The template's own definition — the text the judge was given, verbatim,
   * not a paraphrase of it. Shown while browsing so the counts on this row can
   * be read against the wording that produced them. */
  definition: string;
  clearlyIn: number;
  probablyIn: number;
}

/**
 * Per-question certainty, the machine reading of design §4's certain/boundary
 * split (which was defined by labeller agreement):
 *   certain   — exactly one subtype claims it clearly_in
 *   boundary  — nothing claims it clearly but something claims it probably,
 *               OR two+ subtypes claim it clearly (competing claims)
 *   unmatched — no subtype claims it at either grade
 * Computed over real subtypes only — the type-level starters are dropped when
 * the state is read, so they cannot make every question look boundary.
 */
export type QuestionGrade = 'certain' | 'boundary' | 'unmatched';

export interface CurationQuestion {
  messageId: number;
  participantToken: string;
  turnIndex: number;
  queryText: string;
  queryType: ScoreQueryType | null;
  /** subtype intentId → grade, only for the two grades curation shows, and only
   * for subtypes under THIS question's own type — the ones the deployed chain
   * could actually route it to. See gradeOf. */
  matches: Record<number, CurationGrade>;
  grade: QuestionGrade;
}

export interface CurationMember {
  messageId: number;
  setKind: CurationSetKind;
  queryType: string | null;
  subtype: string | null;
  /** QuestionGrade frozen at assignment time (stored in the `rating` column). */
  grade: string | null;
  position: number | null;
}

export interface CurationState {
  dataset: { key: string; label: string; assignmentId: string };
  questions: CurationQuestion[];
  subtypes: CurationSubtype[];
  members: CurationMember[];
  meta: { demoSubtypes: string[]; lockedAt: string | null; lockedBy: string | null };
  /** Assigned questions that are ALSO isolated — a demo/set overlap. */
  demoSetOverlap: number;
  /** Questions blocked from assignment: the demo subtype's students (design §4
   * isolates the whole student, in BOTH datasets). */
  excludedMessageIds: number[];
  typeCounts: Record<string, number>;
  /** Messages with no usable type verdict — what [Refresh classification] fixes. */
  missingTypeCount: number;
  /** Boundary share of the CLASSIFIED log (boundary / (certain + boundary)) —
   * the natural ratio each set is measured against (design §4). */
  naturalBoundaryRatio: number;
  gradeCounts: Record<QuestionGrade, number>;
}

/** Starter-taxonomy subtype label → query type (the mapping the chooser uses). */
function subtypeTypeByLabel(): Map<string, ScoreQueryType> {
  const map = new Map<string, ScoreQueryType>();
  for (const { type, subtype } of flattenSubtypes(DEFAULT_SCORE_CONFIG)) {
    const qt = LEGACY_TYPE_TO_QUERY_TYPE[type.key];
    if (qt) map.set(subtype.label.trim().toLowerCase(), qt);
  }
  return map;
}

function isGrade(rating: string): rating is CurationGrade {
  return rating === 'clearly_in' || rating === 'probably_in';
}

/**
 * Everything the curation screen renders, in one round trip.
 *
 * The subtype verdicts are read NEWEST-PER-(message,intent) REGARDLESS OF
 * def_hash — the templates were rated when the master was prepared, and a
 * rating-harness version bump since then changes the hash without changing the
 * definition text. Same rule probe.ts uses when it seeds a filter from a
 * starter suggestion; reading only the current hash would show empty subtypes.
 */
export async function getCurationState(datasetKey: string): Promise<CurationState> {
  const dataset = curationDataset(datasetKey);
  if (!dataset) throw new Error(`unknown curation dataset: ${datasetKey}`);
  await ensureStudyTables();
  const assignmentId = dataset.masterAssignmentId;

  const [records, sessions, templates, typeRows, ratingRows, memberRows, metaRows] =
    await Promise.all([
      getQueryRecords(assignmentId),
      db
        .select({ id: studentSessions.id, participantToken: studentSessions.participantToken })
        .from(studentSessions)
        .where(eq(studentSessions.assignmentId, assignmentId)),
      db
        .select({ id: scoreIntents.id, title: scoreIntents.title, definition: scoreIntents.definition })
        .from(scoreIntents)
        .where(and(eq(scoreIntents.assignmentId, assignmentId), eq(scoreIntents.isTemplate, true))),
      db
        .select({
          messageId: scoreQueryTypes.messageId,
          type: scoreQueryTypes.type,
          version: scoreQueryTypes.version,
        })
        .from(scoreQueryTypes)
        .where(eq(scoreQueryTypes.assignmentId, assignmentId)),
      db
        .select({
          messageId: scoreIntentRatings.messageId,
          intentId: scoreIntentRatings.intentId,
          rating: scoreIntentRatings.rating,
          ratedAt: scoreIntentRatings.ratedAt,
        })
        .from(scoreIntentRatings)
        .innerJoin(scoreIntents, eq(scoreIntents.id, scoreIntentRatings.intentId))
        .where(
          and(
            eq(scoreIntentRatings.assignmentId, assignmentId),
            eq(scoreIntents.isTemplate, true)
          )
        ),
      db.select().from(studySetMembers).where(eq(studySetMembers.datasetKey, datasetKey)),
      db.select().from(studyCurationMeta).where(eq(studyCurationMeta.datasetKey, datasetKey)),
    ]);

  const tokenBySession = new Map(sessions.map((s) => [s.id, s.participantToken]));
  const typeByMessage = new Map<number, ScoreQueryType>();
  for (const row of typeRows) {
    if (row.version >= TYPE_CLASSIFIER_VERSION && (SCORE_QUERY_TYPES as readonly string[]).includes(row.type)) {
      typeByMessage.set(row.messageId, row.type as ScoreQueryType);
    }
  }

  // A master also carries TYPE-LEVEL starter sets ("Planning", "All", …) and
  // the odd renamed row. They claim across a whole type, so they say nothing a
  // question's own type does not already say — and shown beside a real subtype
  // they read as a competing claim. Dropped here, once, rather than filtered at
  // each place they would otherwise surface.
  const labelToType = subtypeTypeByLabel();
  const subtypeById = new Map<number, CurationSubtype>();
  for (const t of templates) {
    const type = labelToType.get(t.title.trim().toLowerCase()) ?? null;
    if (!type) continue;
    subtypeById.set(t.id, {
      intentId: t.id,
      title: t.title,
      type,
      definition: t.definition,
      clearlyIn: 0,
      probablyIn: 0,
    });
  }

  // Newest verdict per (message, template), ACROSS hash generations — see the
  // function's doc comment. Same reduction probe.ts does when seeding.
  const newest = new Map<string, (typeof ratingRows)[number]>();
  for (const r of ratingRows) {
    const key = `${r.messageId}:${r.intentId}`;
    const prev = newest.get(key);
    if (!prev || r.ratedAt > prev.ratedAt) newest.set(key, r);
  }

  const matchesByMessage = new Map<number, Record<number, CurationGrade>>();
  for (const raw of newest.values()) {
    if (!isGrade(raw.rating)) continue;
    const subtype = subtypeById.get(raw.intentId);
    if (!subtype) continue;
    // Same type scoping as gradeOf, and for the same reason: a subtype's count
    // is a promise about what it can claim, and it cannot claim a question the
    // chain will never route to it. Counting cross-type matches here while the
    // grade ignores them would put a question under a subtype badged unmatched.
    if (typeByMessage.get(raw.messageId) !== subtype.type) continue;
    if (raw.rating === 'clearly_in') subtype.clearlyIn += 1;
    else subtype.probablyIn += 1;
    const bag = matchesByMessage.get(raw.messageId) ?? {};
    bag[raw.intentId] = raw.rating;
    matchesByMessage.set(raw.messageId, bag);
  }

  const typeOfSubtype = (intentId: number) => subtypeById.get(intentId)?.type ?? null;
  const questions: CurationQuestion[] = records.map((r) => {
    const matches = matchesByMessage.get(r.messageId) ?? {};
    const queryType = typeByMessage.get(r.messageId) ?? null;
    return {
      messageId: r.messageId,
      participantToken: tokenBySession.get(r.sessionId) ?? '',
      turnIndex: r.turnIndex,
      queryText: r.queryText,
      queryType,
      matches,
      grade: gradeOf(matches, queryType, typeOfSubtype),
    };
  });

  const gradeCounts: Record<QuestionGrade, number> = { certain: 0, boundary: 0, unmatched: 0 };
  for (const q of questions) gradeCounts[q.grade] += 1;

  const typeCounts: Record<string, number> = {};
  for (const t of SCORE_QUERY_TYPES) typeCounts[t] = 0;
  let missingTypeCount = 0;
  for (const q of questions) {
    if (q.queryType) typeCounts[q.queryType] += 1;
    else missingTypeCount += 1;
  }

  const meta = metaRows[0];
  const demoSubtypes = readDemoSubtypes(meta);
  const excludedMessageIds =
    demoSubtypes.length > 0
      ? demoIsolatedMessageIds(questions, subtypeById, demoSubtypes)
      : [];

  const classified = gradeCounts.certain + gradeCounts.boundary;

  return {
    dataset: { key: dataset.key, label: dataset.label, assignmentId },
    questions,
    subtypes: [...subtypeById.values()].sort((a, b) => a.title.localeCompare(b.title)),
    members: memberRows.map((m) => ({
      messageId: m.sourceMessageId,
      setKind: m.setKind as CurationSetKind,
      queryType: m.queryType,
      subtype: m.subtype,
      grade: m.rating,
      position: m.position,
    })),
    meta: {
      demoSubtypes,
      lockedAt: meta?.lockedAt ? meta.lockedAt.toISOString() : null,
      lockedBy: meta?.lockedBy ?? null,
    },
    excludedMessageIds,
    demoSetOverlap: memberRows.filter((m) =>
      new Set(excludedMessageIds).has(m.sourceMessageId)
    ).length,
    typeCounts,
    missingTypeCount,
    naturalBoundaryRatio: classified > 0 ? gradeCounts.boundary / classified : 0,
    gradeCounts,
  };
}

/**
 * See QuestionGrade. `matches` only ever holds real subtypes (see above).
 *
 * Counted WITHIN THE QUESTION'S OWN TYPE. A template is type-less, so it is
 * rated against every question in the log — but the deployed chain is not: a
 * typed intent only ever sees its own type's queries (rate/route.ts isNeeded).
 * So a planning question that reads clearly_in for a reviewing subtype carries
 * a match the runtime can never act on, and counting it would grade the
 * question by ambiguity that does not exist where it matters.
 *
 * It is also what makes the grade usable. Under solo rating a question matches
 * ~4 subtypes across the taxonomy, so "exactly one clearly_in" over all 26 is
 * nearly unreachable — 86-88% of both masters graded boundary, and translating
 * was down to 3 certain questions. Scoped to the type: 77-78% boundary, and
 * translating recovers to 25 (SWAG) and 12 (NIRVANA).
 *
 * An UNTYPED question grades unmatched: nothing can claim it until it has a
 * type, and the board surfaces that separately as missingTypeCount rather than
 * letting it hide inside a grade.
 */
function gradeOf(
  matches: Record<number, CurationGrade>,
  queryType: string | null,
  typeOfSubtype: (intentId: number) => ScoreQueryType | null
): QuestionGrade {
  let clearly = 0;
  let probably = 0;
  if (queryType) {
    for (const [id, grade] of Object.entries(matches)) {
      if (typeOfSubtype(Number(id)) !== queryType) continue;
      if (grade === 'clearly_in') clearly += 1;
      else probably += 1;
    }
  }
  if (clearly === 1) return 'certain';
  if (clearly > 1 || probably > 0) return 'boundary';
  return 'unmatched';
}

/**
 * Every question belonging to a student who asked anything in ANY demo subtype.
 * Whole-student, because a participant who met that student in the tutorial
 * would recognize their thread in the study material (design §4 step 1) — and
 * that holds however many subtypes the demo covers, so the isolated set is the
 * union across all of them.
 */
function demoIsolatedMessageIds(
  questions: CurationQuestion[],
  subtypeById: Map<number, CurationSubtype>,
  demoSubtypeTitles: string[]
): number[] {
  const wanted = new Set(demoSubtypeTitles);
  const demoIds = new Set(
    [...subtypeById.values()].filter((s) => wanted.has(s.title)).map((s) => s.intentId)
  );
  if (demoIds.size === 0) return [];
  const tokens = new Set<string>();
  for (const q of questions) {
    for (const [intentId, grade] of Object.entries(q.matches)) {
      if (grade === 'clearly_in' && demoIds.has(Number(intentId))) tokens.add(q.participantToken);
    }
  }
  return questions.filter((q) => tokens.has(q.participantToken)).map((q) => q.messageId);
}

/* ------------------------------------------------------------------ */
/* Mutations                                                          */
/* ------------------------------------------------------------------ */

export interface AssignInput {
  datasetKey: string;
  messageId: number;
  setKind: CurationSetKind | null; // null = unassign
  addedBy: string;
}

/**
 * The classification snapshot frozen onto a member row. Derived server-side
 * for the one question being assigned (cheap) rather than taken from the
 * client, so the stored record cannot drift from what the judge actually said.
 */
async function classifyOne(
  assignmentId: string,
  messageId: number
): Promise<{ queryType: string | null; subtype: string | null; grade: QuestionGrade }> {
  const [typeRows, ratingRows] = await Promise.all([
    db
      .select({ type: scoreQueryTypes.type, version: scoreQueryTypes.version })
      .from(scoreQueryTypes)
      .where(eq(scoreQueryTypes.messageId, messageId)),
    db
      .select({
        intentId: scoreIntentRatings.intentId,
        rating: scoreIntentRatings.rating,
        ratedAt: scoreIntentRatings.ratedAt,
        title: scoreIntents.title,
      })
      .from(scoreIntentRatings)
      .innerJoin(scoreIntents, eq(scoreIntents.id, scoreIntentRatings.intentId))
      .where(
        and(
          eq(scoreIntentRatings.messageId, messageId),
          eq(scoreIntents.assignmentId, assignmentId),
          eq(scoreIntents.isTemplate, true)
        )
      ),
  ]);

  const typeRow = typeRows.find((r) => r.version >= TYPE_CLASSIFIER_VERSION);
  const labelToType = subtypeTypeByLabel();

  const newest = new Map<number, (typeof ratingRows)[number]>();
  for (const r of ratingRows) {
    const prev = newest.get(r.intentId);
    if (!prev || r.ratedAt > prev.ratedAt) newest.set(r.intentId, r);
  }

  // Rebuilt into gradeOf's shape rather than counted inline: the board and the
  // stored snapshot MUST grade identically, and two copies of the rule is
  // exactly how they stop doing that.
  const queryType = typeRow?.type ?? null;
  const matches: Record<number, CurationGrade> = {};
  const typeById = new Map<number, ScoreQueryType | null>();
  let best: string | null = null;
  for (const r of newest.values()) {
    if (!isGrade(r.rating)) continue;
    const type = labelToType.get(r.title.trim().toLowerCase());
    if (!type) continue; // real subtypes only
    matches[r.intentId] = r.rating;
    typeById.set(r.intentId, type);
    // The label stored beside the member is the subtype the chain could
    // actually route it to, so it follows the same type scoping.
    if (!best && type === queryType) best = r.title;
  }
  const grade = gradeOf(matches, queryType, (id) => typeById.get(id) ?? null);

  return { queryType, subtype: best, grade };
}

/**
 * Whether one question is blocked by demo isolation — the cheap check the
 * assign route needs (recomputing the whole state per click would read the
 * entire log for one boolean).
 */
export async function isDemoIsolated(datasetKey: string, messageId: number): Promise<boolean> {
  const dataset = curationDataset(datasetKey);
  if (!dataset) return false;

  const [meta] = await db
    .select({
      demoSubtypes: studyCurationMeta.demoSubtypes,
      demoSubtype: studyCurationMeta.demoSubtype,
    })
    .from(studyCurationMeta)
    .where(eq(studyCurationMeta.datasetKey, datasetKey));
  const demoSubtypes = readDemoSubtypes(meta);
  if (demoSubtypes.length === 0) return false;

  const demoIntents = await db
    .select({ id: scoreIntents.id })
    .from(scoreIntents)
    .where(
      and(
        eq(scoreIntents.assignmentId, dataset.masterAssignmentId),
        eq(scoreIntents.isTemplate, true),
        inArray(scoreIntents.title, demoSubtypes)
      )
    );
  if (demoIntents.length === 0) return false;

  // The student this question belongs to …
  const [owner] = await db
    .select({ sessionId: chatConversations.sessionId })
    .from(chatMessages)
    .innerJoin(chatConversations, eq(chatConversations.id, chatMessages.conversationId))
    .where(eq(chatMessages.id, messageId));
  if (!owner) return false;

  // … and whether ANY of that student's questions is clearly in the demo subtype.
  const hit = await db
    .select({ messageId: scoreIntentRatings.messageId })
    .from(scoreIntentRatings)
    .innerJoin(chatMessages, eq(chatMessages.id, scoreIntentRatings.messageId))
    .innerJoin(chatConversations, eq(chatConversations.id, chatMessages.conversationId))
    .where(
      and(
        eq(chatConversations.sessionId, owner.sessionId),
        eq(scoreIntentRatings.rating, 'clearly_in'),
        inArray(
          scoreIntentRatings.intentId,
          demoIntents.map((i) => i.id)
        )
      )
    )
    .limit(1);

  return hit.length > 0;
}

/** Assign a master question to a set (or clear it). Idempotent per question. */
export async function setSetMember(input: AssignInput): Promise<void> {
  const { datasetKey, messageId, setKind, addedBy } = input;
  const dataset = curationDataset(datasetKey);
  if (!dataset) throw new Error(`unknown curation dataset: ${datasetKey}`);
  await ensureStudyTables();

  if (await isLocked(datasetKey)) throw new Error('curation_locked');

  if (setKind === null) {
    await db
      .delete(studySetMembers)
      .where(
        and(
          eq(studySetMembers.datasetKey, datasetKey),
          eq(studySetMembers.sourceMessageId, messageId)
        )
      );
    return;
  }

  const snapshot = await classifyOne(dataset.masterAssignmentId, messageId);

  await db
    .insert(studySetMembers)
    .values({
      datasetKey,
      setKind,
      sourceMessageId: messageId,
      queryType: snapshot.queryType,
      subtype: snapshot.subtype,
      rating: snapshot.grade,
      addedBy,
      createdAt: new Date(),
    })
    // Re-assigning MOVES the question between sets rather than erroring — the
    // unique index is on (dataset, message), so a set change is an update.
    .onConflictDoUpdate({
      target: [studySetMembers.datasetKey, studySetMembers.sourceMessageId],
      set: {
        setKind,
        queryType: snapshot.queryType,
        subtype: snapshot.subtype,
        rating: snapshot.grade,
        addedBy,
        createdAt: new Date(),
      },
    });
}

/**
 * Empty one set, or one type's slot inside it.
 *
 * Hand-assigned members are the researcher's own reading of the log — the one
 * thing on this screen that cannot be recomputed — so this returns what it
 * removed rather than a bare count, and the caller shows it before asking a
 * second time. The type filter reads the LIVE type (score_query_types), not the
 * snapshot frozen on the member row: a re-classification can move a question
 * between types after it was assigned, and clearing "Planning" should empty
 * what the board currently shows under Planning.
 */
export async function clearSet(
  datasetKey: string,
  setKind: CurationSetKind,
  queryType: ScoreQueryType | null
): Promise<{ removed: { messageId: number; queryType: string | null; subtype: string | null }[] }> {
  const dataset = curationDataset(datasetKey);
  if (!dataset) throw new Error(`unknown curation dataset: ${datasetKey}`);
  await ensureStudyTables();
  if (await isLocked(datasetKey)) throw new Error('curation_locked');

  const rows = await db
    .select({
      messageId: studySetMembers.sourceMessageId,
      queryType: studySetMembers.queryType,
      subtype: studySetMembers.subtype,
    })
    .from(studySetMembers)
    .where(and(eq(studySetMembers.datasetKey, datasetKey), eq(studySetMembers.setKind, setKind)));
  if (rows.length === 0) return { removed: [] };

  let targets = rows;
  if (queryType) {
    const liveTypes = await db
      .select({ messageId: scoreQueryTypes.messageId, type: scoreQueryTypes.type })
      .from(scoreQueryTypes)
      .where(
        and(
          eq(scoreQueryTypes.assignmentId, dataset.masterAssignmentId),
          inArray(
            scoreQueryTypes.messageId,
            rows.map((r) => r.messageId)
          )
        )
      );
    const typeByMessage = new Map(liveTypes.map((t) => [t.messageId, t.type]));
    targets = rows.filter((r) => (typeByMessage.get(r.messageId) ?? r.queryType) === queryType);
  }
  if (targets.length === 0) return { removed: [] };

  await db.delete(studySetMembers).where(
    and(
      eq(studySetMembers.datasetKey, datasetKey),
      eq(studySetMembers.setKind, setKind),
      inArray(
        studySetMembers.sourceMessageId,
        targets.map((t) => t.messageId)
      )
    )
  );
  return { removed: targets };
}

/**
 * The demo's isolated subtypes, from whichever column holds them.
 *
 * The list column wins; the pre-list single value is read as a one-item list so
 * a dataset locked before the change keeps isolating what it was locked with.
 */
export function readDemoSubtypes(meta?: {
  demoSubtypes?: string[] | null;
  demoSubtype?: string | null;
}): string[] {
  if (Array.isArray(meta?.demoSubtypes)) return meta.demoSubtypes.filter((t) => !!t);
  return meta?.demoSubtype ? [meta.demoSubtype] : [];
}

export async function setDemoSubtypes(datasetKey: string, titles: string[]): Promise<void> {
  await ensureStudyTables();
  const clean = [...new Set(titles.map((t) => t.trim()).filter(Boolean))].sort();

  // Deliberately allowed even when the sets are confirmed.
  //
  // Isolation is whole-student, so on a dataset already curated across many
  // students almost ANY subtype overlaps something in a set — reserving the
  // demo is meant to happen before assignment, and refusing afterwards would
  // just make the demo unusable on a finished dataset. Whether that overlap
  // matters depends on what the demo is FOR: it disqualifies a participant-
  // facing tutorial, and means nothing for a dev preview or a talk.
  //
  // That is the researcher's call, so this records the choice and lets the
  // overlap be seen — validateCuration still raises it as a blocking error, so
  // a curation cannot be re-confirmed while it stands.
  // Both columns move together: the old one keeps a single-subtype demo
  // readable by anything not yet updated, and is cleared when the list is.
  const values = { demoSubtypes: clean, demoSubtype: clean.length === 1 ? clean[0] : null };
  await db
    .insert(studyCurationMeta)
    .values({ datasetKey, ...values })
    .onConflictDoUpdate({ target: studyCurationMeta.datasetKey, set: values });
}

/**
 * The questions the demo is ABOUT: clearly in one of the demo subtypes.
 *
 * Narrower than the isolated set, deliberately. Isolation is whole-student —
 * every question by anyone who asked a demo-subtype question, so a participant
 * cannot meet that student twice. The demo workspace instead lists only the
 * questions that are the demo, with the rest of their threads kept as context,
 * exactly the way the study master treats its review set.
 */
export async function demoQuestionIds(datasetKey: string): Promise<number[]> {
  const dataset = curationDataset(datasetKey);
  if (!dataset) return [];
  const titles = await getDemoSubtypes(datasetKey);
  if (titles.length === 0) return [];

  const intents = await db
    .select({ id: scoreIntents.id })
    .from(scoreIntents)
    .where(
      and(
        eq(scoreIntents.assignmentId, dataset.masterAssignmentId),
        eq(scoreIntents.isTemplate, true),
        inArray(scoreIntents.title, titles)
      )
    );
  if (intents.length === 0) return [];

  const rows = await db
    .select({ messageId: scoreIntentRatings.messageId })
    .from(scoreIntentRatings)
    .where(
      and(
        eq(scoreIntentRatings.assignmentId, dataset.masterAssignmentId),
        eq(scoreIntentRatings.rating, 'clearly_in'),
        inArray(
          scoreIntentRatings.intentId,
          intents.map((i) => i.id)
        )
      )
    );
  return [...new Set(rows.map((r) => r.messageId))];
}

/** The demo subtypes recorded for a dataset. */
export async function getDemoSubtypes(datasetKey: string): Promise<string[]> {
  await ensureStudyTables();
  const [row] = await db
    .select({
      demoSubtypes: studyCurationMeta.demoSubtypes,
      demoSubtype: studyCurationMeta.demoSubtype,
    })
    .from(studyCurationMeta)
    .where(eq(studyCurationMeta.datasetKey, datasetKey));
  return readDemoSubtypes(row);
}

export async function isLocked(datasetKey: string): Promise<boolean> {
  const [row] = await db
    .select({ lockedAt: studyCurationMeta.lockedAt })
    .from(studyCurationMeta)
    .where(eq(studyCurationMeta.datasetKey, datasetKey));
  return !!row?.lockedAt;
}

export async function setLock(datasetKey: string, by: string | null, locked: boolean): Promise<void> {
  await ensureStudyTables();
  const values = locked
    ? { lockedAt: new Date(), lockedBy: by }
    : { lockedAt: null, lockedBy: null };
  await db
    .insert(studyCurationMeta)
    .values({ datasetKey, ...values })
    .onConflictDoUpdate({ target: studyCurationMeta.datasetKey, set: values });
}

/* ------------------------------------------------------------------ */
/* Set sizes                                                           */
/* ------------------------------------------------------------------ */

/** The current per-type set sizes, seeded from the design's figures. */
export async function getSetTargets(): Promise<SetTargets> {
  await ensureStudyTables();
  const [row] = await db.select().from(studySetTargets).where(eq(studySetTargets.id, 1));
  if (!row) return { ...DEFAULT_SET_TARGETS };
  return { review: row.review, test: row.test, ab: row.ab };
}

export function clampSetTargets(input: Partial<SetTargets>): SetTargets {
  const out = { ...DEFAULT_SET_TARGETS } as SetTargets;
  for (const kind of CURATION_SET_KINDS) {
    const { min, max } = SET_TARGET_LIMITS[kind];
    const raw = input[kind];
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      out[kind] = Math.min(max, Math.max(min, Math.round(raw)));
    }
  }
  return out;
}

/**
 * Change the set sizes. Refused while any dataset is confirmed: the lock means
 * "these sets are the study material", and moving the target under it would
 * leave a locked set that no longer satisfies its own rule.
 */
export async function saveSetTargets(
  input: Partial<SetTargets>,
  updatedBy: string
): Promise<SetTargets> {
  await ensureStudyTables();
  for (const dataset of CURATION_DATASETS) {
    if (await isLocked(dataset.key)) throw new Error('curation_locked');
  }
  const targets = clampSetTargets(input);
  await db
    .insert(studySetTargets)
    .values({ id: 1, ...targets, updatedAt: new Date(), updatedBy })
    .onConflictDoUpdate({
      target: studySetTargets.id,
      set: { ...targets, updatedAt: new Date(), updatedBy },
    });
  return targets;
}

/* ------------------------------------------------------------------ */
/* Validation (shared by the confirm button and the build scripts)     */
/* ------------------------------------------------------------------ */

export interface CurationViolation {
  code: 'count' | 'isolation' | 'ab_balance' | 'missing_type' | 'boundary_ratio';
  severity: 'error' | 'warning';
  message: string;
  messageIds?: number[];
}

/**
 * Whether the sets are shippable. Counts / isolation / A-B balance are errors
 * (they break the design's arithmetic); the boundary-ratio drift is a warning —
 * design §4 asks the sets to FOLLOW the natural ratio, but with 2 items per
 * type per test set exact proportionality is not achievable.
 */
export function validateCuration(
  state: CurationState,
  targets: SetTargets
): CurationViolation[] {
  const out: CurationViolation[] = [];

  for (const kind of CURATION_SET_KINDS) {
    const target = targets[kind];
    for (const type of SCORE_QUERY_TYPES) {
      const have = state.members.filter(
        (m) => m.setKind === kind && questionType(state, m.messageId) === type
      ).length;
      if (have !== target) {
        out.push({
          code: 'count',
          severity: 'error',
          message: `${kind} · ${type}: ${have}/${target}`,
        });
      }
    }
  }

  const excluded = new Set(state.excludedMessageIds);
  const violating = state.members.filter((m) => excluded.has(m.messageId)).map((m) => m.messageId);
  if (violating.length > 0) {
    out.push({
      code: 'isolation',
      severity: 'error',
      message: `${violating.length} demo-isolation violation(s) — questions from an isolated student are in a set`,
      messageIds: violating,
    });
  }

  const untyped = state.members
    .filter((m) => !questionType(state, m.messageId))
    .map((m) => m.messageId);
  if (untyped.length > 0) {
    out.push({
      code: 'missing_type',
      severity: 'error',
      message: `${untyped.length} unclassified question(s) in a set — run Refresh classification`,
      messageIds: untyped,
    });
  }

  // A/B needs 2 per type so the cross-dataset item order can be built in
  // balanced blocks (every 4 consecutive items = both datasets, rotating
  // types), which is what keeps a 16→12→8 pilot truncation unbiased.
  const abPerType = SCORE_QUERY_TYPES.map(
    (type) =>
      state.members.filter((m) => m.setKind === 'ab' && questionType(state, m.messageId) === type)
        .length
  );
  if (abPerType.some((n) => n !== targets.ab)) {
    out.push({
      code: 'ab_balance',
      severity: 'error',
      message: `A/B blocks unbalanced — needs exactly ${targets.ab} per type`,
    });
  }

  for (const kind of CURATION_SET_KINDS) {
    const rows = state.members.filter((m) => m.setKind === kind);
    if (rows.length === 0) continue;
    const boundary = rows.filter((m) => m.grade === 'boundary').length / rows.length;
    const drift = Math.abs(boundary - state.naturalBoundaryRatio);
    if (drift > 0.15) {
      out.push({
        code: 'boundary_ratio',
        severity: 'warning',
        message: `${kind} boundary ${(boundary * 100).toFixed(0)}% vs natural ${(
          state.naturalBoundaryRatio * 100
        ).toFixed(0)}%`,
      });
    }
  }

  return out;
}

function questionType(state: CurationState, messageId: number): ScoreQueryType | null {
  const q = state.questions.find((x) => x.messageId === messageId);
  return q?.queryType ?? null;
}

/* ------------------------------------------------------------------ */
/* Classification top-up                                               */
/* ------------------------------------------------------------------ */

/**
 * Fill in missing 4-type verdicts on a master, using the same primitives the
 * board's rate route uses (stored dissection steer, staleness by
 * TYPE_CLASSIFIER_VERSION, upsert on message_id). Idempotent — a fully typed
 * master costs zero calls, which is why the button is safe to press twice.
 *
 * Subtype verdicts are topped up separately, by reRateSubtypes below — same
 * shape, different unit of work.
 */
export async function classifyMissingTypes(
  datasetKey: string,
  limit = 200
): Promise<{ pending: number; classified: number; failed: number }> {
  const dataset = curationDataset(datasetKey);
  if (!dataset) throw new Error(`unknown curation dataset: ${datasetKey}`);
  const assignmentId = dataset.masterAssignmentId;

  const [records, typeRows] = await Promise.all([
    getQueryRecords(assignmentId),
    db
      .select({ messageId: scoreQueryTypes.messageId, version: scoreQueryTypes.version })
      .from(scoreQueryTypes)
      .where(eq(scoreQueryTypes.assignmentId, assignmentId)),
  ]);
  const fresh = new Set(
    typeRows.filter((t) => t.version >= TYPE_CLASSIFIER_VERSION).map((t) => t.messageId)
  );
  const pending = records.filter((r) => !fresh.has(r.messageId));
  if (pending.length === 0) return { pending: 0, classified: 0, failed: 0 };
  if (!isOpenAIConfigured()) throw new Error('openai_not_configured');

  const batch = pending.slice(0, limit);
  const ids = batch.map((b) => b.messageId);
  const stored = await db
    .select({
      messageId: scoreDissections.messageId,
      materialKinds: scoreDissections.materialKinds,
      requests: scoreDissections.requests,
    })
    .from(scoreDissections)
    .where(
      and(eq(scoreDissections.assignmentId, assignmentId), inArray(scoreDissections.messageId, ids))
    );
  const dissectionByMsg = new Map<number, DissectionResult>(
    stored.map((s) => [
      s.messageId,
      {
        materialKinds: (s.materialKinds ?? []) as MaterialKind[],
        requests: (s.requests ?? []) as string[],
      },
    ])
  );

  const model = getDefaultScoreModel();
  const run = createLimiter(SCORE_CONCURRENCY);
  const now = new Date();
  let classified = 0;
  let failed = 0;

  await Promise.all(
    batch.map((rec) =>
      run(async () => {
        try {
          const result = await classifyMessageType({
            queryText: rec.queryText,
            prevQueryText: rec.prevQueryText,
            prevResponseText: rec.prevResponseText,
            dissection: dissectionByMsg.get(rec.messageId) ?? null,
            model,
          });
          if (!result.type) {
            failed += 1;
            return;
          }
          const values = {
            type: result.type,
            rationale: result.rationale || null,
            version: TYPE_CLASSIFIER_VERSION,
            rawResponse: result.raw,
            model,
            createdAt: now,
          };
          await db
            .insert(scoreQueryTypes)
            .values({ assignmentId, messageId: rec.messageId, ...values })
            .onConflictDoUpdate({ target: scoreQueryTypes.messageId, set: values });
          classified += 1;
        } catch {
          failed += 1;
        }
      })
    )
  );

  return { pending: pending.length, classified, failed };
}

/* ------------------------------------------------------------------ */
/* Subtype re-rating                                                   */
/* ------------------------------------------------------------------ */

/**
 * The definitions the CHOOSER seeds, keyed by hash.
 *
 * This is the parity contract, and it runs one way: a prepared subtype set is
 * only meaningful because its definition is the exact text a participant would
 * get by picking that suggestion and creating the intent by hand. Same text →
 * same intentDefHash → same verdicts, whichever route produced them. So the
 * chooser's text is the authority here, and a template is worth re-rating
 * precisely when it still matches one.
 *
 * Type-level starters are not in this map: jelsonTypeToIntent has no caller in
 * the app, so no chooser option can seed one. The 4 type templates left on the
 * masters by an older seeding pass are unreachable text — re-rating them would
 * buy verdicts nothing reads.
 */
async function chooserDefinitions(): Promise<Map<string, string>> {
  const config = await getScoreConfig();
  const byHash = new Map<string, string>();
  for (const s of buildJelsonSuggestions(config)) {
    const { definition } = jelsonToIntent(s);
    byHash.set(intentDefHash(definition), s.label);
  }
  return byHash;
}

export interface ReRateStatus {
  /** Templates on the master whose definition is still a live chooser option. */
  reachable: { intentId: number; title: string }[];
  /** Templates no chooser option can seed — skipped, listed so it is visible. */
  unreachable: string[];
  questions: number;
  /** reachable × questions — the verdicts the prepared set is made of, and,
   * one definition per call, the number of calls a full pass costs. */
  pairs: number;
  /** Pairs with no row at the current defHash — the calls left to make. */
  stalePairs: number;
  mode: string;
  ratingVersion: number;
  model: string;
}

/** What a re-rate would cost right now, without spending anything. */
export async function getReRateStatus(datasetKey: string): Promise<ReRateStatus> {
  const dataset = curationDataset(datasetKey);
  if (!dataset) throw new Error(`unknown curation dataset: ${datasetKey}`);
  const assignmentId = dataset.masterAssignmentId;

  const [records, templates, chooser] = await Promise.all([
    getQueryRecords(assignmentId),
    db
      .select({ id: scoreIntents.id, title: scoreIntents.title, definition: scoreIntents.definition })
      .from(scoreIntents)
      .where(and(eq(scoreIntents.assignmentId, assignmentId), eq(scoreIntents.isTemplate, true))),
    chooserDefinitions(),
  ]);

  const reachable: { intentId: number; title: string; defHash: string }[] = [];
  const unreachable: string[] = [];
  for (const t of templates) {
    const hash = intentDefHash(t.definition);
    if (chooser.has(hash)) reachable.push({ intentId: t.id, title: t.title, defHash: hash });
    else unreachable.push(t.title);
  }

  const stale = await stalePairs(assignmentId, records, reachable);

  return {
    reachable: reachable.map((r) => ({ intentId: r.intentId, title: r.title })),
    unreachable,
    questions: records.length,
    pairs: reachable.length * records.length,
    stalePairs: stale.length,
    mode: MATERIAL_PROMPT_MODE,
    ratingVersion: INTENT_RATING_VERSION,
    model: getDefaultScoreModel(),
  };
}

/**
 * Which (question, subtype) pairs have no verdict at their CURRENT defHash.
 * Unlike probe.ts — which deliberately accepts an older generation so a seeded
 * filter opens instantly — this is the strict test: a row from the previous
 * harness is a verdict the current system would not necessarily produce, and
 * topping those up is the whole point of the button.
 */
async function stalePairs(
  assignmentId: string,
  records: { messageId: number }[],
  templates: { intentId: number; defHash: string }[]
): Promise<{ messageId: number; intentId: number; defHash: string }[]> {
  const out: { messageId: number; intentId: number; defHash: string }[] = [];
  if (templates.length === 0 || records.length === 0) return out;

  const rows = await db
    .select({ messageId: scoreIntentRatings.messageId, intentId: scoreIntentRatings.intentId, defHash: scoreIntentRatings.defHash })
    .from(scoreIntentRatings)
    .where(
      and(
        eq(scoreIntentRatings.assignmentId, assignmentId),
        inArray(
          scoreIntentRatings.intentId,
          templates.map((t) => t.intentId)
        )
      )
    );
  const have = new Set(rows.map((r) => `${r.messageId}:${r.intentId}:${r.defHash}`));

  // Question-major, so a partial run leaves whole questions finished rather
  // than every question half-judged — the board reads a mix of generations
  // until a pass completes, and this keeps that mix legible.
  for (const rec of records) {
    for (const t of templates) {
      if (!have.has(`${rec.messageId}:${t.intentId}:${t.defHash}`)) {
        out.push({ messageId: rec.messageId, intentId: t.intentId, defHash: t.defHash });
      }
    }
  }
  return out;
}

/**
 * Re-rate the prepared subtype set against the master log under the CURRENT
 * rating harness — same model, same mode, same prompt builder, and ONE
 * DEFINITION PER CALL.
 *
 * That last part is the expensive part and the whole point. A definition judged
 * beside its 25 siblings is not judged the same way as one judged alone: a
 * sibling with a narrower definition takes the question, so a broad set keeps
 * only what nothing else claims better. Measured on this master (see
 * scripts/study/check-neighbor-effect.ts), a broad subtype flipped membership on
 * 6 of 30 questions between the two, every flip in the same direction.
 *
 * The path a participant takes is solo: the chooser's probe rates one
 * definition (probe.ts), and creating the intent rates it alone too — the New
 * Intent modal scopes the run with `intentIds: [id]`. The prepared sets were
 * only ever batched because they were filled by an UNSCOPED sweep, which pools
 * every stale intent on a message into one call. So this matches the sets to
 * the path, at 26× the calls, rather than leaving a starter and a hand-typed
 * intent with the same text disagreeing about which questions they cover.
 *
 * Idempotent by defHash: a pair already rated at its current hash costs
 * nothing, which is what makes the button safe to press repeatedly and what
 * lets the UI drive it as a loop. Rows from older generations are left alone —
 * they are hash-keyed history, and probe.ts still falls back to them.
 *
 * Dissections are read, never written. The masters were dissected from an
 * event log this function has no business re-deriving (scripts/score/redissect
 * owns that), and in `abridged` mode the stored material spans are what the
 * judge actually sees.
 */
export async function reRateSubtypes(
  datasetKey: string,
  /** Pairs — and so calls — per invocation. */
  limit = 500
): Promise<{
  pendingPairs: number;
  ratedPairs: number;
  failed: number;
  remainingPairs: number;
}> {
  const dataset = curationDataset(datasetKey);
  if (!dataset) throw new Error(`unknown curation dataset: ${datasetKey}`);
  const assignmentId = dataset.masterAssignmentId;

  const [records, templateRows, chooser] = await Promise.all([
    getQueryRecords(assignmentId),
    db
      .select({ id: scoreIntents.id, title: scoreIntents.title, definition: scoreIntents.definition })
      .from(scoreIntents)
      .where(and(eq(scoreIntents.assignmentId, assignmentId), eq(scoreIntents.isTemplate, true))),
    chooserDefinitions(),
  ]);

  const templates = templateRows
    .map((t) => ({ intentId: t.id, definition: t.definition, defHash: intentDefHash(t.definition) }))
    .filter((t) => chooser.has(t.defHash));
  const nothing = { pendingPairs: 0, ratedPairs: 0, failed: 0, remainingPairs: 0 };
  if (templates.length === 0) return nothing;

  const pending = await stalePairs(assignmentId, records, templates);
  if (pending.length === 0) return nothing;
  if (!isOpenAIConfigured()) throw new Error('openai_not_configured');

  const definitionById = new Map(templates.map((t) => [t.intentId, t.definition]));
  const recordById = new Map(records.map((r) => [r.messageId, r]));
  const batch = pending.slice(0, limit);

  // `materials` is required by the rating prompt in abridged mode — without the
  // spans the judge would silently read the pasted material verbatim and rate a
  // different prompt than the workbench does. Loaded per distinct message, not
  // per pair: 26 pairs share one question's dissection.
  const stored = await db
    .select({
      messageId: scoreDissections.messageId,
      materialKinds: scoreDissections.materialKinds,
      requests: scoreDissections.requests,
      materials: scoreDissections.materials,
    })
    .from(scoreDissections)
    .where(
      and(
        eq(scoreDissections.assignmentId, assignmentId),
        inArray(scoreDissections.messageId, [...new Set(batch.map((p) => p.messageId))])
      )
    );
  const dissectionByMsg = new Map(
    stored.map((s) => [
      s.messageId,
      {
        materialKinds: (s.materialKinds ?? []) as MaterialKind[],
        requests: (s.requests ?? []) as string[],
        materials: (Array.isArray(s.materials) ? s.materials : []) as MaterialSpan[],
      },
    ])
  );

  const model = getDefaultScoreModel();
  const run = createLimiter(SCORE_CONCURRENCY);
  const now = new Date();
  let ratedPairs = 0;
  let failed = 0;

  await Promise.all(
    batch.map((pair) =>
      run(async () => {
        const rec = recordById.get(pair.messageId);
        const definition = definitionById.get(pair.intentId);
        if (!rec || !definition) return;
        try {
          const result = await rateMessageIntents({
            queryText: rec.queryText,
            prevQueryText: rec.prevQueryText,
            prevResponseText: rec.prevResponseText,
            intents: [{ id: pair.intentId, definition }],
            includeDissection: false,
            dissection: dissectionByMsg.get(pair.messageId) ?? null,
            model,
          });
          const rating = result.ratings.get(pair.intentId);
          if (!rating) {
            failed += 1; // no usable verdict → stays stale, retried next batch
            return;
          }
          const values = {
            rating: rating.rating,
            rationale: rating.rationale || null,
            defHash: pair.defHash,
            rawResponse: result.raw,
            model,
            ratedAt: now,
          };
          await db
            .insert(scoreIntentRatings)
            .values({ assignmentId, messageId: pair.messageId, intentId: pair.intentId, ...values })
            .onConflictDoUpdate({
              target: [
                scoreIntentRatings.messageId,
                scoreIntentRatings.intentId,
                scoreIntentRatings.defHash,
              ],
              set: values,
            });
          ratedPairs += 1;
        } catch {
          failed += 1;
        }
      })
    )
  );

  return {
    pendingPairs: pending.length,
    ratedPairs,
    failed,
    remainingPairs: Math.max(0, pending.length - ratedPairs),
  };
}

/* ------------------------------------------------------------------ */
/* Read helpers for the build scripts (M6)                             */
/* ------------------------------------------------------------------ */

/** Confirmed members of one set, in position order. Throws unless locked. */
export async function getConfirmedSet(
  datasetKey: string,
  setKind: CurationSetKind
): Promise<{ messageId: number; queryType: string | null; subtype: string | null }[]> {
  if (!(await isLocked(datasetKey))) throw new Error('curation_not_locked');
  const rows = await db
    .select()
    .from(studySetMembers)
    .where(and(eq(studySetMembers.datasetKey, datasetKey), eq(studySetMembers.setKind, setKind)));
  return rows
    .sort((a, b) => (a.position ?? a.sourceMessageId) - (b.position ?? b.sourceMessageId))
    .map((r) => ({ messageId: r.sourceMessageId, queryType: r.queryType, subtype: r.subtype }));
}

/** Conversation ids the review set anchors live in (M6 truncation input). */
export async function getReviewAnchors(
  datasetKey: string
): Promise<{ messageId: number; conversationId: string }[]> {
  const rows = await db
    .select()
    .from(studySetMembers)
    .where(and(eq(studySetMembers.datasetKey, datasetKey), eq(studySetMembers.setKind, 'review')));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.sourceMessageId);
  const msgs = await db
    .select({ id: chatMessages.id, conversationId: chatMessages.conversationId })
    .from(chatMessages)
    .where(inArray(chatMessages.id, ids));
  return msgs.map((m) => ({ messageId: m.id, conversationId: m.conversationId }));
}
