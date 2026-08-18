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
block-test.csv  this participant's block-test answers, WITH what their
                configuration actually did with each question.
review-set.csv  the questions each block put in front of them — the
                denominator for any coverage figure.
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
  message_text  that question's first 160 characters (ids are clone-local, so
                without this the export cannot be read on its own)
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
  folds          suggest_fold (what was OFFERED) · fold_apply (what was
                 APPLIED — pair them to see whether the proposal was edited)
  browsing       scope_view / scope_leave (which type or intent was open) ·
                 query_open / query_close (which question was read) ·
                 intent_open / intent_close · rule_open / rule_close ·
                 fold_open / fold_close · deploy_open / deploy_close.
                 The *_close rows carry dwell_ms.
  other          deploy · rating_run · preview_generate · revise_submit
                 set_add · set_remove · test_predict · test_rate · test_reveal
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
  - pin_set payloads carry the reason VERBATIM, where the reason came from
    (reason_source: suggested/edited/custom, with the index of the suggestion),
    and rating_overruled — what the classifier said at the moment it was
    overruled. clearly_out → in is a correction; probably_in → in settles a
    boundary the classifier had already flagged as uncertain.
  - rating_run payloads carry membership: which questions moved into or out
    of each intent because of that re-judgement. A definition rewritten for one
    question re-judges every question, so this is where a decision already
    settled comes back the other way.
  - revise_submit carries the instructor's feedback VERBATIM — their own words,
    which the rule text is a model's rendering of. Proposals they rejected
    leave no rule version, so this is the only record of what was asked.
  - suggest_fold carries the offered definition, how many attempts the fold
    loop needed, and whether the classifier reproduced each correction.
  - the browsing rows come from the client and are batched; each event's time
    is reconstructed from how long before the flush it happened, not from the
    flush. They cover the shared surfaces only — scroll, hover and keystrokes
    are the screen recording's job.

block-test.csv — beyond the answers
  routed_kind / routed_intent_id / routed_intent_title / routed_type
                what actually answered. 'type_default' means no intent claimed
                it and the type's own rule replied.
  routed_rule_chars
                0 means the chatbot answered with NO instructions of theirs.
  pointing_correct
                SCORE only: did the intent they pointed at fire?
  candidates    every set the chain judged, "intentId:rating" — tells a near
                miss from a set that was never in contention.
  response      the answer they rated.
  ms_*          per-step durations from when the question appeared.
                ms_point is the pointing step (point_changes counts how many
                times they changed their mind before Next); ms_reveal and
                ms_rate bracket how long they read the response.
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
    reviewSet: Record<string, unknown>[];
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
      message_text: e.messageText ? e.messageText.replace(/\s+/g, ' ').slice(0, 160) : '',
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
  files['review-set.csv'] = toCsv(extra.reviewSet);
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
  const {
    studyTestAnswers,
    studySurveyAnswers,
    studyFinalSurveyAnswers,
    studyGeneratedResponses,
    studyQuestionBank,
    studyReviewQuestions,
    studyClones,
  } = await import('@/db/schema');
  const { chatMessages, scoreQueryTypes } = await import('@/db/schema');
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

  // WHAT THE CONFIGURATION ACTUALLY DID with each question — the other half of
  // every measure this file carries. Pointing can only be scored against the
  // intent that really fired, and "what's off" can only be coded against the
  // text the participant was reacting to; both live in study_generated_responses
  // and neither was in this export, so scoring a block test meant going back to
  // the database. They are columns now.
  const generated = ids.length
    ? await db
        .select()
        .from(studyGeneratedResponses)
        .where(inArray(studyGeneratedResponses.cloneAssignmentId, ids))
    : [];
  const generatedByItem = new Map(
    generated.map((g) => [`${g.cloneAssignmentId}:${g.bankItemId}`, g])
  );

  const blockTest = answers.map((a) => {
    const b = blockOf.get(a.cloneAssignmentId);
    const item = bankById.get(a.bankItemId);
    const gen = generatedByItem.get(`${a.cloneAssignmentId}:${a.bankItemId}`);
    const applied = (gen?.applied ?? null) as {
      intentId?: number;
      intentTitle?: string;
      outcome?: string;
      rule?: string;
      type?: string;
      candidates?: { intentId: number; rating: string }[];
    } | null;
    const t = (a.timing ?? null) as Record<string, number> | null;
    const ms = (v: number | undefined) => (typeof v === 'number' ? Math.round(v) : '');
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
      // What answered it. `routed_outcome` is 'intent' when one of their sets
      // claimed the question and 'type_default' when the chain ran out — and a
      // type default with an empty rule means the chatbot answered with no
      // instructions of theirs at all, which is why the rule length is here.
      routed_kind: applied?.outcome ?? (gen ? gen.outcome : ''),
      routed_intent_id: applied?.intentId ?? '',
      routed_intent_title: applied?.intentTitle ?? '',
      routed_type: applied?.type ?? '',
      routed_rule_chars: applied ? (applied.rule ?? '').trim().length : '',
      /** Was the pointing right? Blank for baseline, which has no routing. */
      pointing_correct:
        b?.condition !== 'score' || !a.pointedKind
          ? ''
          : a.pointedKind === 'intent'
            ? applied?.outcome === 'intent' && applied.intentId === a.pointedIntentId
              ? 'yes'
              : 'no'
            : a.pointedKind === 'none'
              ? applied == null || applied.outcome === 'type_default'
                ? 'yes'
                : 'no'
              : '',
      /** Every set the chain judged, so a near miss is distinguishable. */
      candidates: (applied?.candidates ?? [])
        .map((c) => `${c.intentId}:${c.rating}`)
        .join(' '),
      response: gen?.response ?? '',
      // Per-step durations (ms from when the question appeared). ms_point is
      // the pointing step — the one that asks them to read their setup.
      ms_point_first: ms(t?.pointFirst),
      ms_point: ms(t?.point),
      point_changes: t?.pointChanges ?? '',
      ms_expect_start: ms(t?.expectStart),
      ms_expect_end: ms(t?.expectEnd),
      ms_guess: ms(t?.guess),
      ms_submit: ms(t?.submit),
      ms_reveal: ms(t?.reveal),
      ms_rate: ms(t?.rate),
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

  // WHAT THEY WERE GIVEN. Coverage — how much of the material an intent or a
  // rules document actually reaches — cannot be computed from the trail alone,
  // because the trail only shows the questions they touched. This is the
  // denominator: every question on the board in each block, with the type and
  // subtype it was curated as.
  const reviewRows = ids.length
    ? await db
        .select()
        .from(studyReviewQuestions)
        .where(inArray(studyReviewQuestions.assignmentId, ids))
    : [];
  const reviewMessageIds = reviewRows.map((r) => r.messageId);
  const [reviewTexts, reviewTypes] = await Promise.all([
    reviewMessageIds.length
      ? db
          .select({ id: chatMessages.id, content: chatMessages.content })
          .from(chatMessages)
          .where(inArray(chatMessages.id, reviewMessageIds))
      : Promise.resolve([] as { id: number; content: string }[]),
    reviewMessageIds.length
      ? db
          .select({ messageId: scoreQueryTypes.messageId, type: scoreQueryTypes.type })
          .from(scoreQueryTypes)
          .where(inArray(scoreQueryTypes.messageId, reviewMessageIds))
      : Promise.resolve([] as { messageId: number; type: string }[]),
  ]);
  const textById = new Map(reviewTexts.map((r) => [r.id, r.content]));
  const typeById = new Map(reviewTypes.map((r) => [r.messageId, r.type]));
  const reviewSet = reviewRows.map((r) => {
    const b = blockOf.get(r.assignmentId);
    return {
      participant: trail.participant.number,
      block: b?.block ?? '',
      dataset: b?.datasetKey ?? '',
      condition: b?.condition ?? '',
      message_id: r.messageId,
      query_type: typeById.get(r.messageId) ?? '',
      question: textById.get(r.messageId) ?? '',
    };
  });

  return {
    number: trail.participant.number,
    files: trailToFiles(trail, { blockTest, survey, finalSurvey, reviewSet }),
  };
}
