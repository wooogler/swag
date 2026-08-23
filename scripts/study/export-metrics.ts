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
import { toCsv } from '../../src/lib/study/csv';
import { buildTrailFiles } from '../../src/lib/study/trail-files';
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
  studyFinalSurveyAnswers,
  studyTestAnswers,
} from '../../src/db/schema';

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] ?? null : null;
}

const OUT = argValue('--out') ?? './export';

function write(name: string, rows: Record<string, unknown>[]) {
  const file = path.join(OUT, name);
  writeFileSync(file, toCsv(rows));
  console.log(`  ${name.padEnd(28)} ${rows.length} row(s)`);
}

/**
 * Did the pointing name what actually answered? SCORE only.
 *
 * Scorable because an intent has an id and the response carries the routing
 * record. Two ways to be right: naming the intent that fired, or saying "none
 * of them" when nothing of theirs did and the type default answered. "Not sure"
 * is left blank rather than marked wrong — it is a real answer to a different
 * question, and counting it as an error would punish the honesty the item asks
 * for. Baseline is never scored: highlighting a stretch of a document that
 * answers everything has no fact of the matter, so the analysis codes the
 * pattern (v2 §6).
 */
function pointingCorrect(
  condition: string | undefined,
  answer: { pointedKind: string | null; pointedIntentId: number | null },
  applied: { intentId?: number; outcome?: string } | null
): number | '' {
  if (condition !== 'score') return '';
  if (answer.pointedKind === 'intent') {
    return applied?.outcome === 'intent' && applied?.intentId === answer.pointedIntentId ? 1 : 0;
  }
  if (answer.pointedKind === 'none') {
    return applied == null || applied.outcome === 'type_default' ? 1 : 0;
  }
  return '';
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
    const plan = blockPlan(p);
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
    const plan = participant ? blockPlan(participant) : [];
    const block = plan.find((x) => x.datasetKey === clone?.datasetKey)?.block ?? null;
    const item = bankById.get(a.bankItemId);
    const gen = generatedByKey.get(`${a.cloneAssignmentId}:${a.bankItemId}`);
    const applied = gen?.applied as {
      intentId?: number;
      intentTitle?: string;
      outcome?: string;
      type?: string;
    } | null;

    // The fold: 1-3 negative, 4-6 positive (BLOCK_TEST v3 §3.3).
    const negative = (v: number | null) => (v === null ? null : v <= 3);
    const wanted = negative(a.desirable) === null ? null : !negative(a.desirable);
    const expected = negative(a.expectDesirable) === null ? null : !negative(a.expectDesirable);
    return {
      participant: participant?.participantNumber ?? '',
      block,
      dataset: clone?.datasetKey ?? '',
      condition: clone?.condition ?? '',
      bank_item: a.bankItemId,
      query_type: item?.queryType ?? '',
      subtype: item?.subtype ?? '',
      // Pass 1 · Q3, Q4. Pass 2 · Q5, Q6. All on the 6-point agreement scale.
      confidence: a.confidence ?? '',
      expect_desirable: a.expectDesirable ?? '',
      desirable: a.desirable ?? '',
      follows_setup: a.followsSetup ?? '',
      // RQ2's first measure, in both forms: the signed distance, and whether
      // the call landed on the right side of the fold.
      pred_error:
        a.expectDesirable === null || a.desirable === null
          ? ''
          : Math.abs(a.expectDesirable - a.desirable),
      prediction_correct: expected === null || wanted === null ? '' : expected === wanted ? 1 : 0,
      // The two quadrants of §1.3 — the same Q5 crossed with two different
      // axes, which is why they are two columns and not one.
      blind_spot: expected === null || wanted === null ? '' : expected && !wanted ? 1 : 0,
      rule_not_want:
        a.followsSetup === null || wanted === null ? '' : !negative(a.followsSetup) && !wanted ? 1 : 0,
      // SCORE only: which of their own sets answered, or the type default.
      applied_outcome: applied?.outcome ?? '',
      applied_intent_id: applied?.intentId ?? '',
      applied_intent_title: applied?.intentTitle ?? '',
      // Covered = one of the participant's own intents claimed it.
      covered: clone?.condition === 'score' ? (applied?.outcome === 'intent' ? 1 : 0) : '',
      // Where they expected it to come from, before they saw it.
      pointed_kind: a.pointedKind ?? '',
      pointed_intent_id: a.pointedIntentId ?? '',
      /** Baseline: how many places in the prompt they pointed at, and their
       * text. One span or six, it is one answer. */
      pointed_span_count: Array.isArray(a.pointedSpans) ? a.pointedSpans.length : '',
      pointed_text: a.pointedText ?? '',
      pointing_correct: pointingCorrect(clone?.condition, a, applied),
      // The written answers. `ideal` is the Desire anchor, coded against the
      // response; P and F are the §7 codebook's material.
      ideal: a.ideal ?? '',
      probe: a.probe ?? '',
      repair: a.repair ?? '',
      generation_outcome: gen?.outcome ?? '',
      guessed_at: a.guessedAt?.toISOString() ?? '',
      pointed_at: a.pointedAt?.toISOString() ?? '',
      rated_at: a.ratedAt?.toISOString() ?? '',
    };
  });
  write('block_test.csv', testRows);

  // ── the coding sheet: the items a probe opened on ───────────────────
  // §7's codebook is applied by a human to P and F, and that pass needs the
  // response beside the prediction it disappointed — not a filter someone has
  // to rebuild in a spreadsheet. The rows are the ones the probe panel opened
  // on: Q5 ≤ 3 OR Q6 ≤ 3 (§4 ③).
  const misalignedRows = testRows
    .filter(
      (r) =>
        (typeof r.desirable === 'number' && r.desirable <= 3) ||
        (typeof r.follows_setup === 'number' && r.follows_setup <= 3)
    )
    .map((r) => ({
      participant: r.participant,
      block: r.block,
      condition: r.condition,
      dataset: r.dataset,
      bank_item: r.bank_item,
      query_type: r.query_type,
      subtype: r.subtype,
      question: bankById.get(r.bank_item)?.question ?? '',
      response: generatedByKey.get(
        `${testAnswers.find((a) => a.bankItemId === r.bank_item)?.cloneAssignmentId}:${r.bank_item}`
      )?.response ?? '',
      desirable: r.desirable,
      follows_setup: r.follows_setup,
      expect_desirable: r.expect_desirable,
      confidence: r.confidence,
      pred_error: r.pred_error,
      prediction_correct: r.prediction_correct,
      blind_spot: r.blind_spot,
      rule_not_want: r.rule_not_want,
      pointed_kind: r.pointed_kind,
      pointed_intent_id: r.pointed_intent_id,
      pointed_span_count: r.pointed_span_count,
      pointed_text: r.pointed_text,
      applied_outcome: r.applied_outcome,
      applied_intent_title: r.applied_intent_title,
      pointing_correct: r.pointing_correct,
      // What they wrote, on the sheet the coding happens on — the whole point
      // of taking these as text was that the coder reads them, not a summary.
      ideal: r.ideal,
      probe: r.probe,
      repair: r.repair,
      // §7 C1-C6, and the F dimensions. Filled by the coder.
      misalignment_code: '',
      repair_target: '',
      repair_scope: '',
      note: '',
    }));
  write('misalignment.csv', misalignedRows);

  // ── per block: prediction accuracy and deployment confidence ────────
  // Confidence calibration (v2 §6) is the pair, not either number: how many
  // items they walked in expecting to be right, against how many turned out
  // that way. A participant can be well calibrated and mostly wrong.
  const byBlock = new Map<string, typeof testRows>();
  for (const r of testRows) {
    const key = `${r.participant}|${r.block}`;
    byBlock.set(key, [...(byBlock.get(key) ?? []), r]);
  }
  /** Mean over the values that are actually there — '' is not a zero. */
  const mean = (values: (number | string)[]): number | '' => {
    const nums = values.filter((v): v is number => typeof v === 'number');
    return nums.length === 0 ? '' : Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100;
  };
  const calibrationRows = [...byBlock.values()]
    .filter((rows) => rows.length > 0)
    .map((rows) => {
      const scored = rows.filter((r) => r.prediction_correct !== '');
      const pointed = rows.filter((r) => r.pointing_correct !== '');
      return {
        participant: rows[0].participant,
        block: rows[0].block,
        condition: rows[0].condition,
        dataset: rows[0].dataset,
        items: rows.length,
        // Means over the block, on the 6-point scale.
        mean_desirable: mean(rows.map((r) => r.desirable)),
        mean_follows: mean(rows.map((r) => r.follows_setup)),
        mean_confidence: mean(rows.map((r) => r.confidence)),
        mean_error: mean(rows.map((r) => r.pred_error)),
        prediction_correct: scored.filter((r) => r.prediction_correct === 1).length,
        prediction_scored: scored.length,
        pointing_correct: pointed.filter((r) => r.pointing_correct === 1).length,
        pointing_scored: pointed.length,
        // The two quadrant cells worth counting per block, and the coverage
        // signal: "I don't know" is a real answer to Q2, not a missing one.
        blind_spots: rows.filter((r) => r.blind_spot === 1).length,
        rule_not_want: rows.filter((r) => r.rule_not_want === 1).length,
        dont_know: rows.filter((r) => r.pointed_kind === 'not_sure').length,
        /** Baseline: how scattered the pointing was, averaged over the block. */
        mean_spans: mean(rows.map((r) => r.pointed_span_count)),
      };
    });
  write('block_summary.csv', calibrationRows);

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

  // ── final survey (end-of-session comparison) ────────────────────────
  // One row per rating, carrying the CONDITION it is about rather than a
  // block — the comparison is not a block's measurement. The direct-comparison
  // items (I1–I5) carry no condition at all: they are one judgement about the
  // pair, and `direction` says which way the scale ran for that participant,
  // because the left column follows the order they used the versions in.
  const finalAnswers = await db.select().from(studyFinalSurveyAnswers);
  const finalRows = finalAnswers.map((f) => {
    const participant = participants.find((p) => p.id === f.participantId);
    const plan = participant ? blockPlan(participant) : [];
    return {
      participant: participant?.participantNumber ?? '',
      item_key: f.itemKey,
      condition: f.condition ?? '',
      block: plan.find((b) => b.condition === f.condition)?.block ?? '',
      value: f.value ?? '',
      text: f.text ?? '',
      direction: f.condition ? '' : plan.map((b) => b.condition).join('→'),
      answered_at: f.answeredAt.toISOString(),
    };
  });
  write('final_survey.csv', finalRows);

  // ── configuration work, from the DB state the session left behind ───
  const configRows: Record<string, unknown>[] = [];
  for (const clone of clones) {
    const participant = participants.find((p) => p.id === clone.participantId);
    const plan = participant ? blockPlan(participant) : [];
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

  // ── per-participant trails ──────────────────────────────────────────
  // The same files the console hands out one at a time, unzipped. RQ1 is read
  // by walking one session in order, so the folder is per person rather than
  // another all-participant table.
  for (const p of participants) {
    const built = await buildTrailFiles(p.id);
    if (!built) continue;
    let n = 0;
    for (const [name, text] of Object.entries(built.files)) {
      const file = path.join(OUT, 'trails', built.number, name);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, text);
      n++;
    }
    console.log(`  trails/${built.number.padEnd(20)} ${n} file(s)`);
  }

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
