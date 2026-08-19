SCORE user study — participant trail

timeline.csv    every recorded action, in time order. One row per event.
timeline.jsonl  the same events with their full payload, one JSON per line.
blocks.json     the two blocks: dataset, condition, when each started.
snapshots/      SCORE only. The whole intent tree as it stood at each save.
rules/          every rule / RULES-document version, as written.
final/          what was deployed at the end of each block.
block-test.csv  this participant's block-test answers.
survey.csv      this participant's mini-survey answers.

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
