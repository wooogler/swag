/**
 * A participant's trail as a set of files.
 *
 * Shared by the console's per-participant download (zipped) and the bulk
 * export (written to disk under trails/<number>/), so the two cannot drift
 * into containing different things.
 */
import { toCsv } from './csv';
import { buildParticipantTrail, type ParticipantTrail } from './trail';

export type TrailFiles = Record<string, string>;

const README = `SCORE user study — participant trail

timeline.csv    every recorded action, in time order. One row per event.
timeline.jsonl  the same events with their full payload, one JSON per line.
blocks.json     the two blocks: dataset, condition, when each started.
snapshots/      SCORE only. The whole intent tree as it stood at each save.
rules/          every rule / RULES-document version, as written.
final/          what was deployed at the end of each block.
block-test.csv  this participant's block-test answers.
survey.csv      this participant's in-block workload (TLX) answers.
final-survey.csv the end-of-session comparison: one row per rating, with the
                version it is about (blank for the direct comparisons).

timeline.csv columns
  seq           1..N in time order
  at            ISO timestamp
  t_block       seconds since that block's work phase opened (blank outside)
  block         1 or 2
  condition     score | baseline
  phase         where they were in the protocol
  source        where the row came from:
                  snapshot  a diff of the configuration snapshots (SCORE)
                  event     an act that writes no snapshot (corrections,
                            rewinds, suggestion calls)
                  rule      a rule version was written
                  prompt    a Baseline RULES version was saved / deployed
                  deploy    a chatbot deploy
                  test      block-test prediction or rating
                  survey    a mini-survey answer
                  session   phase change or facilitator action
  kind          the specific act (see below)
  intent_id     which intent, where the act had one
  intent_title  its name AT THAT MOMENT (titles change)
  message_id    the student question involved, where there was one
  detail        one human-readable line

kinds
  configuration  intent_draft (New Intent pressed — a draft, which may be
                 abandoned) · intent_create (Save — it is on the board now)
                 intent_update_definition · intent_update_rule
                 intent_update_title · intent_archive · intent_restore
                 intent_move · intent_reorder · intent_fold · intent_apply
                 intent_update · intent_revert · pins_changed
  corrections    pin_set · pin_retire · pin_remove · pin_remove_all
  rules          rule_save · rule_apply · rule_revert
  baseline       prompt_save · prompt_deploy · search_run · search_save
  suggestions    suggest_intents · suggest_rewrite_intents · suggest_reasons
                 suggest_fold
  other          deploy · rating_run · preview_generate · revise_submit
                 set_add · set_remove · test_predict · test_rate
                 survey_answer · phase_advance · phase_forced · clone_reset

notes
  - rule_apply means "generate what this rule version WOULD answer for N
    questions", not "make it live".
  - intent_revert and rule_revert DELETE the versions they rewind past. The
    dropped versions are preserved in the event payload (timeline.jsonl).
  - suggest_* rows carry adopted_within_60s in their payload. It is an
    approximation: the client never says which candidate was used, so this is
    "a change to the same intent followed within a minute".
  - pins_changed can duplicate a pin_* event from the same moment; the pin_*
    row is the precise one.
`;

function pad(n: number): string {
  return String(n).padStart(3, '0');
}

export function trailToFiles(
  trail: ParticipantTrail,
  extra: {
    blockTest: Record<string, unknown>[];
    survey: Record<string, unknown>[];
    finalSurvey: Record<string, unknown>[];
  }
): TrailFiles {
  const files: TrailFiles = {};
  files['README.txt'] = README;

  files['timeline.csv'] = toCsv(
    trail.events.map((e) => ({
      seq: e.seq,
      at: e.at,
      t_block: e.tBlock ?? '',
      block: e.block ?? '',
      condition: e.condition ?? '',
      phase: e.phase,
      source: e.source,
      kind: e.kind,
      intent_id: e.intentId ?? '',
      intent_title: e.intentTitle ?? '',
      message_id: e.messageId ?? '',
      detail: e.detail ?? '',
    }))
  );
  files['timeline.jsonl'] = trail.events.map((e) => JSON.stringify(e)).join('\n');
  files['blocks.json'] = JSON.stringify(
    { participant: trail.participant, blocks: trail.blocks },
    null,
    2
  );

  for (const s of trail.snapshots) {
    files[`snapshots/block${s.block ?? '0'}/v${pad(s.versionNo)}.json`] = JSON.stringify(
      { versionNo: s.versionNo, createdAt: s.createdAt, summary: s.summary, snapshot: s.snapshot },
      null,
      2
    );
  }

  for (const r of trail.rules) {
    const name =
      r.kind === 'baseline_prompt'
        ? `rules-v${pad(r.versionNo)}.txt`
        : `intent-${r.intentId}-v${pad(r.versionNo)}.txt`;
    files[`rules/block${r.block ?? '0'}/${name}`] = r.text;
  }

  for (const f of trail.final) {
    files[`final/block${f.block}-config.json`] =
      typeof f.config === 'string' ? f.config : JSON.stringify(f.config, null, 2);
  }

  files['block-test.csv'] = toCsv(extra.blockTest);
  files['survey.csv'] = toCsv(extra.survey);
  files['final-survey.csv'] = toCsv(extra.finalSurvey);
  return files;
}

/**
 * Everything a participant's folder holds, built from scratch.
 *
 * The block-test and survey rows are simple enough to assemble here rather
 * than importing the bulk export's row builders, which are shaped around
 * every-participant joins.
 */
export async function buildTrailFiles(participantId: string): Promise<{
  number: string;
  files: TrailFiles;
} | null> {
  const trail = await buildParticipantTrail(participantId);
  if (!trail) return null;

  const { db } = await import('@/db/db');
  const { studyTestAnswers, studySurveyAnswers, studyFinalSurveyAnswers, studyQuestionBank, studyClones } =
    await import('@/db/schema');
  const { eq, inArray } = await import('drizzle-orm');

  const clones = await db
    .select()
    .from(studyClones)
    .where(eq(studyClones.participantId, trail.participant.id));
  const ids = clones.map((c) => c.assignmentId);
  const blockOf = new Map(trail.blocks.map((b) => [b.assignmentId, b]));

  const answers = ids.length
    ? await db
        .select()
        .from(studyTestAnswers)
        .where(inArray(studyTestAnswers.cloneAssignmentId, ids))
    : [];
  const bank = await db.select().from(studyQuestionBank);
  const bankById = new Map(bank.map((b) => [b.id, b]));

  const blockTest = answers.map((a) => {
    const b = blockOf.get(a.cloneAssignmentId);
    const item = bankById.get(a.bankItemId);
    return {
      participant: trail.participant.number,
      block: b?.block ?? '',
      dataset: b?.datasetKey ?? '',
      condition: b?.condition ?? '',
      bank_item: a.bankItemId,
      position: item?.position ?? '',
      question: item?.question ?? '',
      expectation: a.expectation ?? '',
      guess: a.guess === null ? '' : a.guess ? 'yes' : 'no',
      pointed_kind: a.pointedKind ?? '',
      pointed_intent_id: a.pointedIntentId ?? '',
      pointed_text: a.pointedText ?? '',
      rating: a.rating ?? '',
      whats_off: a.whatsOff ?? '',
      probe: a.probe ?? '',
      guessed_at: a.guessedAt?.toISOString() ?? '',
      rated_at: a.ratedAt?.toISOString() ?? '',
    };
  });

  const surveyRows = await db
    .select()
    .from(studySurveyAnswers)
    .where(eq(studySurveyAnswers.participantId, trail.participant.id));
  const survey = surveyRows.map((s) => ({
    participant: trail.participant.number,
    block: s.block,
    condition: blockOf.get(s.cloneAssignmentId ?? '')?.condition ?? '',
    item: s.itemKey,
    value: s.value,
    answered_at: s.answeredAt?.toISOString() ?? '',
  }));

  // The comparison belongs to no block, so it carries the CONDITION rather
  // than a block number — and the direct-comparison items carry neither,
  // because they are one judgement about the pair.
  const finalRows = await db
    .select()
    .from(studyFinalSurveyAnswers)
    .where(eq(studyFinalSurveyAnswers.participantId, trail.participant.id));
  const finalSurvey = finalRows.map((f) => ({
    participant: trail.participant.number,
    item: f.itemKey,
    condition: f.condition ?? '',
    value: f.value ?? '',
    text: f.text ?? '',
    answered_at: f.answeredAt?.toISOString() ?? '',
  }));

  return {
    number: trail.participant.number,
    files: trailToFiles(trail, { blockTest, survey, finalSurvey }),
  };
}
