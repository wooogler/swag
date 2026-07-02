# SCORE — Classifier A vs. Human Labels (NIRVANA)

Agreement evaluation of the SCORE **Classifier A** (hierarchical single-label intent classifier) against the human-coded gold labels for the NIRVANA student→ChatGPT queries.

- **Date:** 2026-07-01
- **Human labels:** `nirvana/GPTWriting_recoded.csv` (columns `Inquiry, Response, Code`) — 361 records, 27 distinct codes (18 left blank / uncoded).
- **Classifier output:** `score_classifications` in the app DB, assignment `NIRVANA Dataset` (`shareToken='nirvana-dataset'`), `classifier_version = 4` — the Jelson taxonomy from `docs/GPTWriting_fewshot_classifier.md` (Planning 8 / Translating 4 / Reviewing 7 / All 7 = 26 subtypes).
- **Taxonomy** is shared by both sides: codes `PL01–08`, `TR01–04`, `RE01–07`, `AL01–07`.

## Methodology

Each human record is joined to its classifier row by matching the query text (exact after whitespace-normalization, then a whitespace-collapsed + lowercased fallback; duplicates consumed in order). Human `Code` (subtype) implies its Type by prefix (`PL→Planning`, `TR→Translating`, `RE→Reviewing`, `AL→All`); a blank code = *uncoded / Other*, compared against a classifier `null` ("none of the above").

**Matched: 355 / 361 human records** (6 unmatched — see caveats). 337 of the matched records carry a human code; 18 are blank.

## Headline agreement

| Level | Basis | Agreement | Cohen's κ |
|---|---|---|---|
| **Subtype** (exact code) | all matched | 232/355 = **65.4%** | 0.64 |
| **Subtype** (exact code) | human-coded only | 218/337 = 64.7% | — |
| **Type** (4 categories) | all matched | 281/355 = **79.2%** | 0.72 |
| **Type** (4 categories) | human-coded only | 267/337 = 79.2% | — |

Uncoded handling: of 18 human-blank records, the classifier returned `None` for 14.

## Type-level confusion matrix

Rows = human gold Type, columns = Classifier A Type.

| HUMAN \ CLF | Planning | Translating | Reviewing | All | None | **total** |
|---|---|---|---|---|---|---|
| **Planning** | **76** | 1 | 3 | 1 | 3 | 84 |
| **Translating** | 2 | **21** | 4 | 3 | 1 | 31 |
| **Reviewing** | 0 | 2 | **90** | 3 | 2 | 97 |
| **All** | 18 | 5 | 21 | **80** | 1 | 125 |
| **None** | 0 | 1 | 2 | 1 | **14** | 18 |

> Planning / Translating / Reviewing sit on the diagonal (≈90%). The disagreement is concentrated in **All**: of the human-`All` records, a large share are pulled into **Planning** and **Reviewing** by the classifier — it under-recognizes essay *generation* when the surface verb looks like editing ("rewrite", "include") or planning.

## Per-subtype agreement

Share of human records with code *X* that the classifier also labeled exactly *X*.

| Type | Code | Description | Agree / n | % |
|---|---|---|---|---|
| All | `AL01` | Generate an essay entirely | 17/24 | 71% |
| All | `AL02` | Write conclusion | 13/14 | 93% |
| All | `AL03` | Generate an alternative essay with some feedback | 10/27 | 37% |
| All | `AL04` | Generate a portion of an essay given a high-level idea | 8/23 | 35% |
| All | `AL05` | Generate the entire essay given a high-level idea | 2/15 | 13% |
| All | `AL06` | Shorten/Lengthen the generated text from the response | 10/17 | 59% |
| All | `AL07` | Write introduction | 5/5 | 100% |
| Planning | `PL01` | Provide an answer to a question on a topic | 15/20 | 75% |
| Planning | `PL02` | Provide examples | 13/16 | 81% |
| Planning | `PL03` | Search for factual information | 13/18 | 72% |
| Planning | `PL04` | Suggest an essay structure | 8/10 | 80% |
| Planning | `PL05` | Expand on an existing idea | 3/7 | 43% |
| Planning | `PL06` | Recommend topics to write about | 4/6 | 67% |
| Planning | `PL07` | Help interpret the writing prompt | 3/4 | 75% |
| Planning | `PL08` | Compare the essay to an alternative viewpoint | 2/3 | 67% |
| Reviewing | `RE01` | Proofread | 23/32 | 72% |
| Reviewing | `RE02` | Answer spelling/grammar questions | 11/14 | 79% |
| Reviewing | `RE03` | Give feedback | 14/18 | 78% |
| Reviewing | `RE04` | Shorten text/remove some content | 3/8 | 38% |
| Reviewing | `RE05` | Rewrite existing text based on a user's prompt | 9/11 | 82% |
| Reviewing | `RE06` | Improve the essay | 8/9 | 89% |
| Reviewing | `RE07` | Check if the essay meets the prompt | 4/5 | 80% |
| Translating | `TR01` | Write a paragraph given an idea | 1/9 | 11% |
| Translating | `TR02` | Complete incomplete paragraphs/sentences | 9/11 | 82% |
| Translating | `TR03` | Write a sentence given an idea | 5/6 | 83% |
| Translating | `TR04` | Suggest expression/word choice | 5/5 | 100% |

**Strong (≥80%):** `AL02`, `AL07`, `PL02`, `PL04`, `RE05`, `RE06`, `RE07`, `TR02`, `TR03`, `TR04`


**Weak (<45%):** `AL03`, `AL04`, `AL05`, `PL05`, `RE04`, `TR01`

## Where the weak codes go instead

For the lowest-agreement human codes, the classifier's actual predictions:

- **`TR01`** — Write a paragraph given an idea (n=9): `RE06`×3, `AL07`×2, `PL05`×1, `None`×1, `AL04`×1, `TR01`×1
- **`AL05`** — Generate the entire essay given a high-level idea (n=15): `AL01`×4, `PL04`×4, `AL05`×2, `RE05`×1, `AL03`×1, `RE03`×1, `AL04`×1, `TR01`×1
- **`AL04`** — Generate a portion of an essay given a high-level idea (n=23): `AL04`×8, `RE05`×2, `PL08`×2, `TR01`×2, `AL07`×2, `None`×1, `RE06`×1, `PL05`×1, `AL02`×1, `PL06`×1, `TR03`×1, `PL01`×1
- **`AL03`** — Generate an alternative essay with some feedback (n=27): `AL03`×10, `RE05`×10, `AL06`×3, `TR01`×1, `RE03`×1, `PL08`×1, `AL01`×1
- **`RE04`** — Shorten text/remove some content (n=8): `RE04`×3, `RE05`×2, `RE03`×1, `AL06`×1, `None`×1
- **`PL05`** — Expand on an existing idea (n=7): `PL05`×3, `PL08`×1, `PL01`×1, `RE03`×1, `None`×1

Reading these: the errors are semantically coherent, not random —

- **`AL03` ↔ `RE05`** (regenerate-whole-essay vs. rewrite-to-spec): a near-perfect split — "rewrite the essay adding more…" is genuinely ambiguous between *generating a new version* (All) and *revising existing text* (Reviewing).
- **`AL05` ↔ `AL01` / `PL04`**: the *from-a-high-level-idea* vs. *from-the-prompt* distinction is very fine; the classifier often falls back to `AL01` or reads it as structure planning.
- **`AL04` / `TR01`**: single-paragraph *generation* vs. *translation* of an idea blur together, and short "include X" asks read as editing (`RE05`).

## Caveats

- **6 human records unmatched** to a classifier row (query-text differences / dedup); excluded from all figures above.
- The human CSV has 361 records vs. 348 classifier rows — the query sets are not identical (near-duplicate system prompts, empty-query filtering on import). Figures are over the matched intersection only.
- Agreement is computed against a single human coding as gold; no second human coder, so human–human reliability is unknown (κ here is classifier-vs-human, not inter-human).

## Takeaways / next steps

1. Classifier A reproduces the human coding at **Type 79% (κ=0.72) / Subtype 65% (κ=0.64)**, with error concentrated at the **generation-vs-editing boundary** and among **`AL` sibling codes**, not spread across the taxonomy.
2. Targeted lift ideas (each would need a re-run + re-compare): sharpen the `All` Type description so *reworking/generating essay text* wins over surface "rewrite"; add contrast cues for `AL01`↔`AL05` and `AL03`↔`RE05`.
3. Companion row-level disagreement CSV can be exported for manual adjudication on request.
