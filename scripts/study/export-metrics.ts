/**
 * Post-session export: one CSV per unit of analysis, into a directory.
 *
 * Everything here is derived, never re-measured — the session already recorded
 * it. One derivation is worth naming because the design defines it: prediction
 * accuracy folds the 5-point fit rating to a yes/no (≤3 reads as "no, that is
 * not what I intended", design v2 §6) and compares it with the prediction made
 * before the answer was visible.
 *
 * The covered/uncovered classification the design asks for is emitted for the
 * SCORE arm only, where the routing record says which of the participant's own
 * intents answered. The baseline arm has no such record — the whole prompt
 * answers everything — so this writes a coding sheet for a human pass instead
 * of guessing.
 *
 *   npx tsx --env-file=.env scripts/study/export-metrics.ts --out ./export
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../src/db/db';
import {
  baselinePromptVersions,
  studyClones,
  studyEvents,
  studyGeneratedResponses,
  studyParticipants,
  studyQuestionBank,
  studySurveyAnswers,
  studyTestAnswers,
} from '../../src/db/schema';

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] ?? null : null;
}

const OUT = argValue('--out') ?? './export';

function csv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n');
}

function write(name: string, rows: Record<string, unknown>[]) {
  const file = path.join(OUT, name);
  writeFileSync(file, csv(rows));
  console.log(`  ${name.padEnd(28)} ${rows.length} row(s)`);
}

async function main() {
  const { blockPlan } = await import('../../src/lib/study/phases');
  const { getSurveyItems } = await import('../../src/lib/study/survey-store');
  const SURVEY_ITEMS = await getSurveyItems();
  mkdirSync(OUT, { recursive: true });

  // Demo runs produce real rows in every measurement table; they are not study
  // data, so they never reach the export.
  const participants = (await db.select().from(studyParticipants)).filter((p) => !p.isDemo);
  const clones = await db.select().from(studyClones);
  const bank = await db.select().from(studyQuestionBank);
  const bankById = new Map(bank.map((b) => [b.id, b]));

  const cloneByAssignment = new Map(clones.map((c) => [c.assignmentId, c]));
  const clonesByParticipant = new Map<string, typeof clones>();
  for (const c of clones) {
    const list = clonesByParticipant.get(c.participantId) ?? [];
    list.push(c);
    clonesByParticipant.set(c.participantId, list);
  }

  console.log(`participants ${participants.length} · clones ${clones.length} · bank ${bank.length}\n`);

  // ── participants ────────────────────────────────────────────────────
  const participantRows = participants.map((p) => {
    const plan = blockPlan(p.participantNumber);
    return {
      participant: p.participantNumber,
      participant_id: p.id,
      cell: p.cell,
      block_order: p.blockOrder,
      phase: p.phase,
      block1_dataset: plan[0]?.datasetKey,
      block1_condition: plan[0]?.condition,
      block2_dataset: plan[1]?.datasetKey,
      block2_condition: plan[1]?.condition,
      last_login_at: p.lastLoginAt?.toISOString() ?? '',
    };
  });
  write('participants.csv', participantRows);

  // ── block test: prediction vs the rating they then gave ─────────────
  const testAnswers = await db.select().from(studyTestAnswers);
  const generated = await db.select().from(studyGeneratedResponses);
  const generatedByKey = new Map(
    generated.map((g) => [`${g.cloneAssignmentId}:${g.bankItemId}`, g])
  );

  const testRows = testAnswers.map((a) => {
    const clone = cloneByAssignment.get(a.cloneAssignmentId);
    const participant = participants.find((p) => p.id === a.participantId);
    const plan = participant ? blockPlan(participant.participantNumber) : [];
    const block = plan.find((x) => x.datasetKey === clone?.datasetKey)?.block ?? null;
    const item = bankById.get(a.bankItemId);
    const gen = generatedByKey.get(`${a.cloneAssignmentId}:${a.bankItemId}`);
    const applied = gen?.applied as { intentId?: number; outcome?: string; type?: string } | null;

    // Fit ≤3 reads as "not what I intended" (design §6).
    const met = a.rating === null ? null : a.rating >= 4;
    return {
      participant: participant?.participantNumber ?? '',
      block,
      dataset: clone?.datasetKey ?? '',
      condition: clone?.condition ?? '',
      bank_item: a.bankItemId,
      query_type: item?.queryType ?? '',
      subtype: item?.subtype ?? '',
      guess: a.guess === null ? '' : a.guess ? 'yes' : 'no',
      rating: a.rating ?? '',
      met_intent: met === null ? '' : met ? 'yes' : 'no',
      // The RQ2 measure: did the prediction match what they then judged?
      prediction_correct: a.guess === null || met === null ? '' : a.guess === met ? 1 : 0,
      // SCORE only: which of their own sets answered, or the type default.
      applied_outcome: applied?.outcome ?? '',
      applied_intent_id: applied?.intentId ?? '',
      // Covered = one of the participant's own intents claimed it.
      covered: clone?.condition === 'score' ? (applied?.outcome === 'intent' ? 1 : 0) : '',
      generation_outcome: gen?.outcome ?? '',
      guessed_at: a.guessedAt?.toISOString() ?? '',
      rated_at: a.ratedAt?.toISOString() ?? '',
    };
  });
  write('block_test.csv', testRows);

  // ── survey ──────────────────────────────────────────────────────────
  const surveys = await db.select().from(studySurveyAnswers);
  const constructOf = new Map(SURVEY_ITEMS.map((i) => [i.key, i.construct]));
  const surveyRows = surveys.map((s) => {
    const participant = participants.find((p) => p.id === s.participantId);
    const clone = s.cloneAssignmentId ? cloneByAssignment.get(s.cloneAssignmentId) : null;
    return {
      participant: participant?.participantNumber ?? '',
      block: s.block,
      condition: clone?.condition ?? '',
      dataset: clone?.datasetKey ?? '',
      item_key: s.itemKey,
      construct: constructOf.get(s.itemKey) ?? '',
      value: s.value,
      answered_at: s.answeredAt.toISOString(),
    };
  });
  write('survey.csv', surveyRows);

  // ── configuration work, from the DB state the session left behind ───
  const configRows: Record<string, unknown>[] = [];
  for (const clone of clones) {
    const participant = participants.find((p) => p.id === clone.participantId);
    const plan = participant ? blockPlan(participant.participantNumber) : [];
    const block = plan.find((x) => x.datasetKey === clone.datasetKey)?.block ?? null;
    // One row of counts per clone — the shape of what they built.
    const [counts] = await db.execute<Record<string, number>>(
      sql`
        SELECT
          (SELECT count(*)::int FROM score_intents WHERE assignment_id = ${clone.assignmentId} AND kind = 'intent' AND NOT is_template AND NOT archived) AS intents,
          (SELECT count(*)::int FROM score_intents WHERE assignment_id = ${clone.assignmentId} AND kind = 'intent' AND NOT is_template AND parent_intent_id IS NOT NULL) AS nested_intents,
          (SELECT count(*)::int FROM score_intents WHERE assignment_id = ${clone.assignmentId} AND kind = 'type_root' AND coalesce(trim(rule), '') <> '') AS type_rules_written,
          (SELECT count(*)::int FROM score_intent_pins WHERE assignment_id = ${clone.assignmentId}) AS corrections,
          (SELECT count(*)::int FROM score_intent_pins WHERE assignment_id = ${clone.assignmentId} AND status = 'consumed') AS corrections_folded,
          (SELECT count(*)::int FROM score_rule_versions WHERE assignment_id = ${clone.assignmentId}) AS rule_versions,
          (SELECT count(*)::int FROM score_config_versions WHERE assignment_id = ${clone.assignmentId}) AS config_versions,
          (SELECT count(*)::int FROM score_chat_deploys WHERE assignment_id = ${clone.assignmentId}) AS deploys,
          (SELECT count(*)::int FROM baseline_searches WHERE assignment_id = ${clone.assignmentId}) AS filters,
          (SELECT count(*)::int FROM baseline_prompt_versions WHERE assignment_id = ${clone.assignmentId}) AS prompt_versions,
          (SELECT coalesce(max(length(prompt)), 0)::int FROM baseline_prompt_versions WHERE assignment_id = ${clone.assignmentId}) AS prompt_chars_max,
          (SELECT count(*)::int FROM study_events WHERE assignment_id = ${clone.assignmentId}) AS events
      `
    );
    configRows.push({
      participant: participant?.participantNumber ?? '',
      block,
      dataset: clone.datasetKey,
      condition: clone.condition,
      ...counts,
    });
  }
  write('configuration.csv', configRows);

  // ── raw event log ───────────────────────────────────────────────────
  const events = await db.select().from(studyEvents);
  const participantById = new Map(participants.map((p) => [p.id, p]));
  write(
    'events.csv',
    events.map((e) => {
      const clone = e.assignmentId ? cloneByAssignment.get(e.assignmentId) : null;
      const owner = e.participantId
        ? participantById.get(e.participantId)
        : clone
          ? participantById.get(clone.participantId)
          : null;
      return {
        participant: owner?.participantNumber ?? '',
        dataset: clone?.datasetKey ?? '',
        condition: clone?.condition ?? '',
        event_type: e.eventType,
        payload: e.payload ? JSON.stringify(e.payload) : '',
        created_at: e.createdAt.toISOString(),
      };
    })
  );

  // ── coding sheet: baseline coverage needs a human ───────────────────
  const codingRows: Record<string, unknown>[] = [];
  for (const answer of testAnswers) {
    const clone = cloneByAssignment.get(answer.cloneAssignmentId);
    if (clone?.condition !== 'baseline') continue;
    const participant = participants.find((p) => p.id === answer.participantId);
    const item = bankById.get(answer.bankItemId);
    const [version] = await db
      .select({ prompt: baselinePromptVersions.prompt })
      .from(baselinePromptVersions)
      .where(eq(baselinePromptVersions.assignmentId, answer.cloneAssignmentId))
      .limit(1);
    codingRows.push({
      participant: participant?.participantNumber ?? '',
      bank_item: answer.bankItemId,
      query_type: item?.queryType ?? '',
      question: item?.question ?? '',
      final_rules: version?.prompt ?? '',
      // To be filled by two coders, then adjudicated:
      covered_coder1: '',
      covered_coder2: '',
      covered_final: '',
    });
  }
  write('baseline_coverage_coding.csv', codingRows);

  console.log(`\nwrote to ${path.resolve(OUT)}`);
  console.log(
    'baseline_coverage_coding.csv needs a human pass: does the final rules document address that question?'
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
