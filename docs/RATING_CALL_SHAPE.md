# The rating call carries one intent

2026-08-22. Decision record for `INTENTS_PER_RATING_CALL`, the seam-orphan guard,
and the re-rate they forced.

## What started it

A participant test rule — *"Rather than writing students' drafts for them, guide
them on what kind of outline they should have"* — was applied to P65 T12 (a bare
paste of two typo-ridden sentences, no request typed) and the chatbot answered
with a grammar correction. Three separate defects were behind it. Two are fixed
here; the third is the rule's own wording and is the instructor's to write.

## 1. The dissector invented a request (fixed)

`score_dissections` for that message held `requests: ["future."]`. The message
is pure pasted material; `"future."` is the last word of the pasted run, left
outside it by the span locator. `renderDissection` then puts that split in front
of the judge as **authoritative** — *"The student's OWN typed request(s) — rate
ONLY these"* — so the judge read a completion request and the "Complete Text"
intent claimed a question that contains no ask at all.

`intent-prompts.ts` already warned the model about exactly this shape (its
example list literally contains `"future."`), and at `effort: low` the model
saw through it. At the production `effort: none` it did not: 5/6 `clearly_in`.

**Fix.** `dissect.ts` `isSeamOrphan` drops a short gap that runs into its
neighbouring material with no sentence boundary between them — measured across
every log: **63 messages, 64 phantom requests dropped, 0 real requests lost,
0 added**. `DISSECTION_VERSION` → 6. P65 T12 now reports no request and rates
`clearly_out` 6/6.

A first pass also ate `"shouldn't this be: …"`, a genuine ask; the opener test
now normalises contractions before consulting its stem list.

## 2. The dissection was not in the rating hash (fixed)

`intentDefHash` hashed `(INTENT_RATING_VERSION, definition)`. The dissection is
part of the rating prompt, so changing how it is computed changes what the judge
reads — but every one of the 122k cached verdicts stayed marked fresh, and
`seedFromPreparedSets` copied the wrong ones on into every study clone. The
dissection version is now folded into the hash.

`INTENT_RATING_VERSION` was deliberately NOT hand-bumped: `RATING_VERSION_BY_MODE`
is *derived from* `MATERIAL_PROMPT_MODE` by design, and setting it by hand would
break the invariant that the prompt cannot change without the hash moving with it.

## 3. The verdict moved with the batch size (fixed)

Re-rating under the fixed dissection dropped the IN rate far more than 63
messages can explain. The cause was not the guard. `RATING_INSTRUCTIONS` tells
the judge to rate each intent strictly by its own definition and not to balance
across them; it does not. 15 questions × 30 starter definitions, nothing changed
but the batching:

| intents/call | 1 | 3 | 5 | 10 | 30 |
|---|---|---|---|---|---|
| rated IN, `effort: none` | 25.8% | 22.2% | 18.2% | 11.1% | 10.4% |
| rated IN, `effort: low` | 21.1% | 17.1% | 14.4% | 10.9% | 7.3% |

Monotonic, 2.5× end to end, and raising the effort does not flatten it.

This was a live confound in the study, not a tidiness problem. The prepared sets
were rated with the whole starter taxonomy in one call, while a participant's own
two or three definitions go through `judgeBatch` two or three at a time. Adopting
a starter definition therefore produced stricter verdicts than writing the same
words yourself — a difference in the measurement, sitting exactly where the study
makes its comparison.

**Decision: one intent per rating call, everywhere.** `INTENTS_PER_RATING_CALL = 1`
in `intent-prompts.ts`, applied by `chunkForRating` at all three call sites:

- `/api/instructor/assignments/[id]/score/rate` — and its batch is now bounded by
  CALL count, not message count, since one message can be thirty calls.
- `judgeBatch` (`lib/study/simple/judge.ts`) — the participant-facing path.
- `scripts/score/rerate-intents.ts` — the headless backfill.

The cost is calls, not much latency: a single-intent call runs ~1.1s median
against ~1.9s for five and ~4s for thirty, and at concurrency 64 a 150-question
log against one definition finishes in ~5s. The system half of the prompt (the
shared instructions, which dominate it) stays prompt-cached across the fan.

## What was NOT changed

`SCORE_RATING_EFFORT` stays `none`. `low` costs +14% per call and +85% on a
150-question batch (5.16s → 9.53s wall), and — per the table above — it does not
fix the batch sensitivity, which was the real problem. Revisit only if the
single-intent verdicts prove unstable in use.

## Rollout, and how to repeat it

Order matters: dissections feed the rating prompt, and the copy chain is three
deep (dataset master → study master → participant clone).

```
npx tsx --env-file=.env scripts/score/check-seam-orphans.ts --all   # dry run, read the diff
npx tsx --env-file=.env scripts/score/redissect.ts --all            # 4593 rows → v6
npx tsx --env-file=.env scripts/score/rerate-intents.ts --all       # plan
npx tsx --env-file=.env scripts/score/rerate-intents.ts --all --apply
```

`redissect.ts` gained the study masters: `ff36a352` / `4052ebba` have no
editor-event log and are not rows in `study_clones`, so they were being skipped
as "not a known clone" — and every participant clone then copied their stale
rows forward. They are now resolved through `CURATION_DATASETS` and the run is
ordered by depth from the root.

Embeddings rebuild themselves: the cache tag carries `DISSECTION_VERSION`, so
re-dissecting invalidates them.

## Related change: embeddings read what the judge reads

`buildEmbedText` used to have its own scheme — requests verbatim, every pasted
run collapsed to one bare `[Own draft]`. It threw away the excerpt, so two
messages pasting different drafts embedded identically, and because it keyed off
`requests` a message whose only "request" was a seam orphan embedded as
`"[Own draft] future."`. 6.1% of the 2410 stored vectors were that shape. It now
returns `abridgeQuery(...) ?? queryText`, the exact text the classifier is sent,
so the edge-case sweep measures distance between the things the verdicts were
formed from.
