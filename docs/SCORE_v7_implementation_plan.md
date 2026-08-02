# SCORE v7 Implementation Plan — Intent Tree Migration

Written 2026-08-02 (rev 2, after adversarial verification) · Target design: **`docs/SCORE_v7_intent_tree_design.md`**
(read it first; §-references below point there). Audience: the implementing model/session (no conversation context
assumed). Branch: **`score-v7`** (branched from `main`/`study-baseline` @ `680a552` — the commit every
file:line anchor in this plan was verified against; that ref is also the rollback point).

All `file:line` anchors were verified at commit `680a552`. Line numbers drift — treat them as search anchors.
**The design doc wins over this plan; this plan wins over improvisation.** When a step is ambiguous, stop and
re-read the referenced code — do not invent semantics.

---

## 0. Summary of the change

Replace v6's "N independent intent classifiers over the whole log + overlap resolution (boundary/links/ownership)"
with: a fixed 4-type multi-class front layer (cached once per message, ever) → nested intent **sets** within each
type → routing = post-order-DFS-compiled **first-match chain** (children before parent, siblings by adjustable
creation order) → the type root's editable rule is the final *else*. Judgments stay per-intent independent and
hash-cached; tree/order is applied only at read time.

## 1. Non-negotiable invariants

1. **`intentDefHash` stays `[INTENT_RATING_VERSION, definition, pins]` only** (`src/lib/score/intents.ts:213-226`).
   Tree fields (kind/type/parent/position) must NEVER enter it. Reorder/re-parent = zero LLM cost.
2. **Do NOT bump `INTENT_RATING_VERSION`** (`intents.ts:150`). This plan never changes `RATING_INSTRUCTIONS` or
   the rating schema (`intent-prompts.ts:15-17` mandates a bump if you do). A bump would orphan the baseline study
   keyspace (probe ratings `src/lib/study/probe.ts:60,147-164`, saved-search defHash `baseline-store.ts:85-99`,
   provisioning zero-LLM invariant `provision.ts:11-15`) and break instant version checkout
   (`ratings/route.ts:109`). Type-scoping is **candidate filtering only**; the runtime type judgment is a
   **separate parallel call** (P4), precisely to protect this.
3. **Baseline condition untouched in behavior.** `chat/route.ts:169-173` early-branch stays first (baseline never
   pays a type call); prompt-holder machinery keeps working; `is_template` rows + their whole-log ratings are
   load-bearing for baseline presets (`probe.ts:136-163`) and provisioning (`provision.ts:148-216`) — v7
   "starter set dies" removes only the SCORE-side *activation UI*.
4. **Rating scope rule**: **type-less rows stay whole-log; typed rows are type-scoped.** Concretely: starter/preset
   templates and pre-backfill rows have `type IS NULL` → whole-log needed-pairs (today's behavior); any row with a
   `type` (live intents, AND create-flow drafts — which are `isTemplate:true` until Save,
   `IntentWorkbench.tsx:613-619`, `intents/route.ts:192`) → same-type needed-pairs. Do NOT branch on `isTemplate`
   alone.
5. **Preview = runtime**: prompt builders stay client-safe (no openai import), same seam as
   `intent-prompts.ts:5-13`. The new type-prompt builder follows the same rule.
6. **Runtime DDL, not drizzle migrations** (journal stale by design, `schema.ts:182-184`). Column adds follow the
   `is_template` recipe (`intent-store.ts:225-233`); new tables follow the 3-site pattern (pg_tables IN-list
   `intent-store.ts:60`, gated CREATE, `wanted` index entries + pg_indexes IN-list `:309`).
7. **Assignment/routing is always derived, never stored** (exceptions: the immutable per-message type judgment,
   and audit metadata on generated messages).
8. Every config mutation records a full snapshot **in the same tx, mutation first** (`intent-store.ts:566-620`).
9. Instructor-facing copy: never the word "prompt" (say *rule*); the type label is **Drafting**, never "All".

## 2. Locked decisions (decision log)

| # | Decision | Rationale |
|---|---|---|
| D1 | **Type roots are `score_intents` rows**, `kind='type_root'`, 4 per assignment, lazily ensured, protected by a **partial unique index `(assignment_id, type) WHERE kind='type_root'`** + insert `ON CONFLICT DO NOTHING` then re-select | Rule editing + rule-version history + Revise flow for free (precedent: baseline prompt-holder). The unique index kills the select-then-insert race the holder precedent has (`baseline-store.ts:227-262`). |
| D2 | **Canonical type key**: lowercase `'planning'\|'translating'\|'reviewing'\|'drafting'` (`ScoreQueryType` in `intents.ts`). Map to Jelson `'All'` only at jelson-suggest edges; gold-CSV `AL` ↔ `drafting` in eval scripts. Legacy `ScoreTypeKey` (`config.ts:8`) untouched. | One canonical key for new columns/prompts. |
| D3 | **Runtime = two PARALLEL LLM calls** (type judgment ∥ intent ratings), both `{timeoutMs:15000, maxRetries:0}`, `Promise.all` | Rating prompt stays byte-identical → no version bump (invariant 2). Wall clock = max, not sum. |
| D4 | **Runtime pending rule**: any node of the emitted type's chain missing a valid rating → fail-open to assignment base prompt | Skip-and-continue could mis-route past an unrated early node; conservative = v6 spirit (`deploy-store.ts:231-234`). |
| D5 | **Legacy (v1) latest deploy snapshot → runtime serves base prompt** + dirty true; `fromVersion` redeploy of v1 → 409; deploy GET shows "re-deploy needed" | No production classes pre-study; instructor redeploys once. |
| D6 | **`position double precision`, default NULL** → ordering key `(position ?? id, id)`. Every move/reorder writes an **explicit position** on the moved node; when the computed midpoint ties either neighbor's effective position (or float exhaustion), **renumber the neighbors in the same tx** (zero-LLM — position is outside the hash). Actions `move_intent`/`reorder_intent` are **major**, `intentIds:[movedId]`. | Fractional ordering without global renumbering in the common case; explicit tie/exhaustion fallback. Revert restores `parentIntentId`+`position` (P0.10), so per-intent revert rewinding position is intended. |
| D7 | **Type backfill runs in P0** (not P5): masters get type roots + live-intent types assigned (template-definition match → that Jelson subtype's type; else `'drafting'` + a printed report for manual fix). Pilot participant clones with live intents (24 rows across 5 clone assignments at `680a552`) are **reset** (`resetParticipant`) or included in the backfill — decide at run time, state in the run log. `score_classifications.type_a` is NOT a source. | P1–P2 acceptance depends on typed intents; NULL-type rows must be transitional only. |
| D8 | **New table `score_query_types`** for per-message type judgments (clone of `score_dissections` shape) + `TYPE_CLASSIFIER_VERSION=1` | Message-immutable → judged once ever; version bump = only invalidation. |
| D9 | **Untyped message rule** (`queryType` null — no row or stale version): resolution = `{kind:'pending'}`; board ships ALL its rating entries unfiltered; excluded from same-type candidate pools and shadowing. Typed messages: out-of-type rating entries for **typed** intents are not shipped to the board; type-less (template) entries ship whole-log. | Cross-type leakage invisible by design (§3.4); untyped = well-defined transitional state. |
| D10 | **Deploy-time validation**: total chain nodes (live intents + 4 type roots) > `MAX_INTENTS_PER_CALL=40` → deploy refused with a clear error | Runtime rates all deployed live intents in one call (parallel with type call — no per-type slicing possible). Truncation would amputate routing. |
| D11 | **Legacy resolver lifetime**: `resolveAssignment` + `IntentLinkEdge` + snapshot `links` **reading** survive P2 inside deploy-store only (runtime keeps resolving old snapshots); they are deleted in P4 with the runtime rewrite. From P2, `buildChatDeploySnapshot` writes `links: []` (links can no longer be created). | P2 must compile AND behave; the runtime cannot use `resolveRoute` before the type call and snapshot v2 exist (P4). |
| D12 | **Master type-root rules do NOT propagate to clones.** Provisioning keeps its `isTemplate=true` filter; type roots + prompt-holder are lazily recreated per clone, seeded from the clone's base prompt. | Pristine-participant philosophy; matches the holder precedent. If the study later needs curated else-rules per participant, that is a provisioning feature, not this migration. |

## 3. What dies / what's new / what's untouched

**Dies**: `score_intent_links` write paths + routes (`links/`, `ownership/`) + `compare/` route + board
overlap/boundary/tiebreak UI + `DecideOwnershipModal.tsx` (P2); resolver link passes/`boundary`/`boundaryKey` from
all non-runtime consumers (P2) and from deploy-store (P4, per D11); SCORE starter-activation UI (P3 — **scope
precisely, see P3.6**); SCORE-side `basePrompt` threading (P3 — baseline keeps its path, see P3.10); snapshot
`.links` field (P4); provisioning step 14 (`provision.ts:266-274`, P2); teardown `'score_intent_links'` entry
(P5; code tolerates a missing table first); the physical table via a **documented one-off
`DROP TABLE IF EXISTS score_intent_links`** run manually after P5 ships (runtime DDL never drops; without this
step the table lingers forever — that is the deliberate default until the operator runs it).

**New**: `kind`/`type`/`parent_intent_id`/`position` columns + partial unique root index; `score_query_types`;
`type-prompts.ts` + `type-classifier.ts`; `compileChain` + `resolveRoute`; type roots + `ensureTypeRoots`;
shadowing diagnostics; type sections/tree/order/placement UI; snapshot `schemaVersion:2` + total parse helper;
audit `appliedOutcome`/`appliedType`; verification scripts.

**Untouched**: rating call/prompt/schema + `intentDefHash` economy; pins as judgment overrides
(`applyPinOverrides`); rule-version axis; deploy append-only versioning; embeddings/similar/exclusion-reasons/
feedback-chips; probe/baseline stores; the `fromTemplateId` create branch (**live consumer**: jelson-suggestion
`adoptTemplate`, `IntentWorkbench.tsx:405-447` — see P3.5); legacy `score_classifications`/`score_subtype_scores`
(zero live readers — leave data AND ensure-machinery alone, `queries.ts:53-168`).

---

## P0 — Schema, core model, backfill (no behavior change; app runs identically after)

1. **Columns on `score_intents`** (drizzle `schema.ts:186-202` + runtime DDL via the `is_template` recipe,
   `intent-store.ts:225-233`, batched pre-check): `kind text NOT NULL DEFAULT 'intent'`
   (`'intent'|'type_root'|'prompt_holder'`), `type text NULL` (`ScoreQueryType`; enforced in code for
   `type_root` and new intents), `parent_intent_id integer NULL` (plain int, no FK), `position double precision
   NULL`. Backfill in the same DDL block: `UPDATE score_intents SET kind='prompt_holder' WHERE
   title='__system_prompt__'`. Add the **partial unique index** `(assignment_id, type) WHERE kind='type_root'`
   to the `wanted` list (3-site pattern).
2. **Kind adoption** — replace sentinel/filters at exactly FIVE sites: `intent-store.ts:393`
   (`buildPromptReadyIntents` → `!archived && kind === 'intent'` — excludes holder AND type roots from the judged
   set), `page.tsx:273` (predicate: `kind === 'intent'`), `baseline-store.ts:230` (lookup by kind, title fallback
   for pre-migration clones), `:249` (insert with kind), **`deploy/route.ts:118-119`** (`liveIntents` filter
   gains `&& kind === 'intent'` — otherwise type roots render as phantom intents in DeployModal, violating this
   phase's invariant; P4.6 re-adds them deliberately). Keep `PROMPT_HOLDER_TITLE` (heal path
   `baseline-store.ts:236-240`).
3. **`ScoreQueryType` + `TYPE_CLASSIFIER_VERSION = 1`** in `intents.ts` (next to `DISSECTION_VERSION` `:157`,
   same bump-on-wording-change comment).
4. **`score_query_types`**: `id serial PK, assignment_id text NOT NULL, message_id integer NOT NULL
   (single-column uniqueIndex — upsert target, mirrors `schema.ts:346`), type text NOT NULL, rationale text,
   version integer NOT NULL, raw_response text, model text, created_at`. Wire ALL lifecycle sites: drizzle
   schema; DDL 3-site pattern in `createIntentTables` (NOT `study/store.ts`); provisioning copy via `_msg_map`
   (mirror `provision.ts:218-227`, copy `version` verbatim); teardown `SCORE_TABLES_BY_ASSIGNMENT`
   (`teardown.ts:22-43`).
5. **Type classifier**: `src/lib/score/type-prompts.ts` (client-safe; 4 type definitions seeded from
   `TYPE_INTENT_DEFINITIONS` `jelson-suggest.ts:162-171` reworded to the new keys; **Drafting-wins multi-activity
   tie-break**; "no Other — off-topic picks the closest type"; strict schema `{rationale, type: enum-of-4}`,
   rationale first, NO null escape) + `src/lib/score/type-classifier.ts` (`classifyMessageType` mirroring
   `intent-classifier.ts:57-135`; user message via `buildQueryContent` `prompts.ts:105-122` so the dissection
   steer applies when available).
6. **Chain + router (pure, client-safe, in `intents.ts`)**: `compileChain(nodes)` — post-order DFS per type,
   children before parent, siblings by `(position ?? id, id)`; exactly design §3.3 (`T{A{B},D{E}}` →
   `[B,A,E,D,root]`). `resolveRoute(chainForType, effectiveRatings)` → `{kind:'matched', intentId} |
   {kind:'type_default'} | {kind:'pending'}` — first node whose pin-overridden rating `isIncludedRating`; any
   node unrated → `pending`. `applyPinOverrides` unchanged as pre-pass. `resolveAssignment` is NOT deleted here
   (D11).
7. **Type roots**: `ensureTypeRoots(assignmentId)` — insert 4 rows (`kind='type_root'`, `type`, title = display
   label, `definition=''`, rule seeded from `assignmentBasePrompt`; empty on NIRVANA is fine — empty rule → no
   system message, `chat/route.ts:232-237`) with `ON CONFLICT DO NOTHING` against the partial unique index, then
   re-select. Seed rule-versions like any intent (`intents/route.ts:205-218` pattern). **Call it only when
   `studioView==='score'`** in the page loader (baseline clones stay free of root rows) and from the deploy build
   (P4).
8. **Snapshot write-side prep**: extend `IntentConfigSnapshot.intents` with `kind/type/parentIntentId/position`
   (`intent-store.ts:497-520`, mapping `:588-595`) + `typeClassifierVersion` (`:605-606`). Readers tolerate old
   snapshots (absent → defaults). `links` field stays until P4 (D11).
9. **Version actions**: add `'move_intent' | 'reorder_intent'` (`intent-store.ts:522-546`); both major (don't
   touch `isMinorVersion` `:555-557`; its lockstep consumers are `deploy/route.ts:115`, `page.tsx:220`,
   `versions/route.ts:67`).
10. **Revert route** (`intents/[intentId]/revert/route.ts`): restore `parentIntentId`+`position` with
    title/definition (`:84-90`); fix the existing bug where reinserted pins drop `reason` (`:100-108` — reason is
    part of `intentDefHash`, `intents.ts:219-223`).
11. **Provisioning step 7** (`provision.ts:148-183`): the `isTemplate=true` WHERE filter **stays** — type roots
    and the prompt-holder are intentionally NOT cloned (lazily recreated per clone, D12; do NOT widen the filter:
    `:166` forces `rule:null` and would erase root rules). Add `kind/type/parent_intent_id/position` to the
    explicit `.values()` list for the template rows; remap `parent_intent_id` old→new via `_intent_map` in a
    **post-pass UPDATE** after all inserts; a parent id absent from `_intent_map` → set NULL.
12. **Master backfill (run now, not P5)**: script that, per master assignment: `ensureTypeRoots`; assigns `type`
    to live `kind='intent'` rows (template-definition match → that subtype's type; else `'drafting'` + printed
    report); `position` stays NULL (id order). NIRVANA master has 3 live intents (all template-matching); handle
    pilot clones per D7 (reset or backfill — record which). **NULL-type transitional rule** (until backfill runs
    everywhere): a `kind='intent'` row with `type IS NULL` is treated like a template (whole-log) by the rate
    pipeline and surfaced in the backfill report — the app must be well-defined between column-add and backfill.

**Acceptance P0**: `npx tsc --noEmit` clean; board + DeployModal + baseline page render identically (type roots
exist on score-view masters but are filtered everywhere — verify board list, deploy GET/Modal, rate pipeline,
baseline flows); scratch script exercises `compileChain`/`resolveRoute` on the design-doc example trees incl. the
`[B,A,E,D,root]` case; fresh provisioning clones tree columns + `score_query_types` rows; backfill report printed.

## P1 — Batch type pass (type infrastructure ONLY — board behavior stays byte-identical)

Scope note: type-scoped needed-pairs and D9 payload filtering do **NOT** land here — they ride the P2 cutover
commit. Landing them now would drive the still-active v6 resolver into `pending` for most of the log
(`intents.ts:260` — any active intent missing a rating → pending).

1. **Rate route type pass** (`rate/route.ts`): messages with a missing/stale (`version <
   TYPE_CLASSIFIER_VERSION`) `score_query_types` row are stale-typed. Classify inside the job loop (one
   `classifyMessageType` per message, dissection fed — the dissection precompute `:286-317` already runs first),
   upsert on `messageId`, stamp version. A message with ONLY a stale type must still yield a job and count in
   `remaining`/`succeeded` (mirror the `dissectionOnly` drain `:314-321` — else `rate-runner.ts:96-99` stalls).
   **Type-pass jobs bypass both zero-intent early-returns** (`:106-108` `wanted.length===0`, `:222-229`
   `promptReady.length===0`) — a fresh assignment with zero intents must still be typeable, since the v7 entry
   experience (§5.1 browse-by-type) precedes intent creation.
2. **Board payload additions** (`page.tsx`): ship `queryType` per row (null when untyped) and tree fields in the
   intents payload (extend `IntentSummary` `IntentBoard.tsx:103-121`). **No rating filtering yet.**
3. Needed-pairs and Apply-scope math stay untouched in this phase.

**Acceptance P1**: on NIRVANA, a rate run types the whole log once (`score_query_types` populated); re-runs are
zero-LLM; board behavior/counts byte-identical to P0; baseline untouched.

## P2 — Cutover commit: resolver swap + type scoping + machinery deletion

One commit (or one tightly-reviewed PR): the board/server consumers swap resolvers, rating scope changes, and the
overlap machinery dies together. The **runtime is exempt** (D11): deploy-store keeps `resolveAssignment` +
snapshot `links` reading until P4; from now `buildChatDeploySnapshot` writes `links: []`.

1. **Resolver swap** at the non-runtime consumers (preview=runtime seam continuity):
   - Board `resolutions` (`IntentBoard.tsx:1459-1475`): per message, `queryType` null → `{kind:'pending'}` (D9);
     else walk that type's compiled chain. `counts` (`:1502-1524`): perIntent + per-type `type_default` residue
     (replaces `unassigned`) + `pending`; `boundaryList` dies. Same-commit re-keys: `selectedOwnerId`
     (`:1611-1615`), Edit-Rule anchor (`:2316-2320`), captured-by chips (`:2623-2636`), Revise owner gate
     (`:2712-2714`).
   - `edgecases/route.ts:88-95`: group = messages routing to this intent; candidate pool = same-type, typed
     messages only.
   - `ratings/route.ts:162-232`: `prior` → **shadowing** (per message this intent matches, which earlier chain
     node captures it); `overlaps` → `shadowedBy: {intentId,title,count}[]`. `RatingsPayload`/`RatingRow`
     (`IntentWorkbench.tsx:52-96`) re-keyed in the SAME commit with a **minimal mechanical re-key** of their
     consumers (`isOverlapRow`/sort `:1215-1219`, row chips `:1391-1416`, banner `:2019-2034`) — the UX redesign
     of these surfaces is P3.5; here they just keep compiling with shadowing data.
2. **Type-scoped needed pairs** (`loadRateStatus` `rate/route.ts:88-156`) per invariant 4: typed rows →
   same-type pairs; type-less rows (templates, un-backfilled intents) → whole-log. Untyped messages count as
   type-pass work only (D9). `total/rated/remaining` defined over scoped pairs so `force` (`:231-270`) stays
   consistent. **IntentWorkbench Apply** (`:554-606`): `estimatedTotal` + live-poll fill follow the server's
   scoped totals (create-flow drafts carry `type` → same-type).
3. **D9 payload filtering** (`page.tsx`): for typed messages, drop out-of-type rating entries of **typed**
   intents; template/type-less entries ship whole-log (starter/search selections read them:
   `IntentBoard.tsx:1561-1567`, `1286-1308`).
4. **Deletions** — routes/UI/write-paths (TS exhaustiveness is the net; expect ~9 board regions):
   `links/` + `ownership/` route dirs; `compare/` route (its `preview-service` backend stays — Revise uses it);
   `DecideOwnershipModal.tsx` + mount (`:2879-2901`) + `ownershipPair` (`:1084-1088`);
   `dropFromOverlap`/`removeTieBreaker` (`:973-1034`); Overlaps panel (`:1892-1918`); yields-to chips
   (`:2073-2115`); boundary/tiebreak inspector arms (`:2402-2471`, `:2472-2523`); boundary list buttons
   (`:1900-1902`); row boundary chips (`:2597-2611`); claimants memo (`:1485-1500`) — superseded by a
   **shadowing memo** (nodes earlier in this node's chain that also match; powers P3.5); `IntentSelection`
   kinds `'boundary'|'tiebreak'` (guard `:1530-1544`, filteredRows `:1546-1578`, selectionLabel `:1685-1704`,
   inspector arms above); purge-modal tie-breaker copy (`:2955`); **plus the full links plumbing**: intent
   DELETE-route cascade + response field (`intents/[intentId]/route.ts:22, 280-289, 307`), `serializeState`
   links (`intents/route.ts:76`), `page.tsx:290-293` links build + `IntentBoard` links prop +
   `IntentLinkSummary` (`:123-126, :140, :894`), `intent-store.ts` `listLinks`/`IntentState.links`/
   `loadIntentState`/`recordConfigVersion` links (`:354-360, :407, :414-417, :572-575, :604`), schema type
   exports (`schema.ts:587-588`), provisioning step 14 (`provision.ts:266-274`), drizzle `scoreIntentLinks` def +
   DDL + indexes (`schema.ts:259-271`, `intent-store.ts:108-118, 275-278`). **Exception (D11)**: keep
   `resolveAssignment`, `IntentLinkEdge`, and the snapshot-`links` READ inside deploy-store; keep the stored
   jsonb `links` arrays in old config versions (readers ignore them; version checkout `ratings/route.ts:54-113`
   is link-free — verified).
5. **Keep** `ACTION_LABELS` entries for `add_link/remove_link/ownership_pins` (`IntentWorkbench.tsx:119-130`) —
   history rows exist in DB.

**Acceptance P2**: `tsc` clean; board shows per-type residue buckets; typed intents' counts match pre-cutover for
same-type queries (NIRVANA backfilled in P0 makes this checkable); pin/definition edits re-derive routing
client-side without reload (`page.tsx:143-146`); old version history renders labels; deploy + live chat still
work on old snapshots (legacy path); baseline board + presets byte-identical.

## P3 — Board UI rebuild (SCORE only — gate every new affordance `!isBaseline`; leak-test `?view=baseline` too, gate is `resolveStudioView` `view.ts:9-21`)

The dashboard's three-column layout is KEPT; the rebuild concentrates on the left (intent) column plus one new
affordance on query selection. Baseline layout unchanged.

1. **Left column = 4 fixed type sections** (order Planning / Translating / Reviewing / Drafting), replacing the
   flat active list (`IntentBoard.tsx:2022-2120`), the SCORE global 'all' selection, the global 'Uncategorized'
   segment (`:1948-1956`), and the SCORE use of the global '+ New' header button (`:1929-1935` — baseline keeps
   it for searches). Section header = the type root: label (Drafting per D2), query count, click →
   `{kind:'type', typeKey}` selection showing that type's queries in the middle column; "Edit rule" affordance on
   the root (P3.9). Default selection on load = Planning (deterministic start, consistent with the PID-asc
   philosophy). **Untyped queries**: a transient row above the sections — "Not yet categorized: N · Run" —
   triggers the type pass (P1) and disappears at 0; this replaces the old global pending entry. There is NO
   global All and NO global Uncategorized in the SCORE left column.
2. **Tree with per-scope Uncategorized items**: inside each section, the intent tree (indented by depth; sibling
   order visible + adjustable via up/down or drag → POST `reorder_intent`, fractional position per D6). Counts
   are routing-derived and SUM hierarchically: an intent item's count = queries routed into its subtree; every
   scope (type root or intent) with ≥1 child intent also renders an **"Uncategorized" leaf** = queries routed to
   the scope itself (its own rule fires), so scope count = Σ child subtrees + its Uncategorized leaf. Clicks:
   intent item → `{kind:'intent', intentId}` (subtree queries); Uncategorized leaf → new selection kind
   `{kind:'residue', scopeId}` (scopeId = the type root's or intent's row id — type roots are rows, so one kind
   covers both levels). A childless intent needs no Uncategorized leaf. Update ALL selection-kind consumer sites
   (filteredRows, selectionLabel, stale-guard, inspector) for: dropped 'all' (SCORE), new 'type' + 'residue'.
   **Payload**: ship type-root rows client-side (dedicated `typeRoots` prop from `page.tsx`: id, type, title,
   rule, latestRuleVersion) — P0.2's `kind==='intent'` filter keeps them out of `intents[]`.
3. **Creation is context-driven — the scope you invoke it from IS the parent** (the earlier abstract
   placement-picker dialog is dropped):
   - "New intent" in a type section (shown when the type or its Uncategorized leaf is selected) → child of that
     type root.
   - Selecting an intent surfaces "New intent" under that intent → child of that intent (the carve-out case).
   - Selecting a scope's Uncategorized leaf → "New intent" there also creates a child of that scope (a sibling
     of its existing children) — same parent as the scope-level button, different browsing context (unclaimed
     queries).
   `POST /score/intents` accepts `{type, parentIntentId, position}`; **rule seed = enclosing scope's effective
   rule** (nearest ancestor with a non-empty rule, ultimately the type root; replaces the
   `assignmentBasePrompt` default at `intents/route.ts:170-171`). Draft lifecycle (`isTemplate:true` draft +
   purge, `IntentWorkbench.tsx:498-515`) carries placement; drafts carry `type` → same-type rating scope
   (invariant 4).
4. **"New intent for this query"** (on query selection): relocate the RuleWorkbench feedback-panel 'New intent'
   button (`RuleWorkbench.tsx:1305-1316`) to the board — when a query row is selected, show a "New intent for
   this query" action; it opens `NewIntentSuggestModal` seeded with `{messageId, currentIntentId: the query's
   routed node, queryType}`, and the `intent-suggestions` route's prompt gains that context (the owning
   intent's definition, or the type definition when routed to the root) so candidates read as scoped
   refinements rather than from-scratch descriptions. Placement per P3.3: parent = the query's routed node
   (routed to the type root → child of the root; routed to intent A → child of A). The modal +
   `onCreateInstead` machinery (`IntentBoard.tsx:1769-1782`) is reused; the RuleWorkbench header button is
   removed (the Revise flow itself is unchanged).
5. **Jelson subtype suggestions stay** in create mode (`IntentWorkbench.tsx:345-398, 1805-1871`), scoped to the
   chosen type's subtypes. **The `fromTemplateId` branch in `intents/route.ts` is KEPT** — `adoptTemplate`
   (`IntentWorkbench.tsx:405-447`, POST at `:419`) is its live consumer and fires on every suggestion click on
   provisioned clones (all subtype templates exist there).
6. **Starter-activation removal (SCORE), precise scope**: DELETE `starterCount` (`:1249`), `unpreparedCount`
   (`:1253-1259`), `staleTemplateCount` (`:1263-1280`), `activateStarterSet`/`activateType`/`runPrepareAll`
   (`:1315-1455`), the SCORE `StarterSetTree` usage (`:2198-2270`), the starter inspector arm (`:2359-2401`),
   and the `'starter'` selection arm for SCORE. **KEEP** `starterGroups` (`:1183-1247`) and `starterCounts`
   (`:1286-1308`) — the baseline Searches panel consumes them (`:1998-2006`); optionally gate the memos behind
   `isBaseline`. Keep `templates/route.ts` (data-prep for masters).
7. **Shadowing UX** (redesign of the P2 mechanical re-key): chips on tree nodes ("earlier ‘X’ intercepts N",
   click → browse intercepted queries) and workbench rows/banner keyed to `shadowedBy`; keep the `onEditIntent`
   jump shortcut targeting the interceptor.
8. **"Send this query here" compound action** (§3.6): in-pin on the target + system-written out-pins on every
   earlier matching chain node; update pin copy (`IntentWorkbench.tsx:1516/:1531`) since a lone in-pin no longer
   guarantees routing.
9. **Type-root rule editing**: mount RuleWorkbench on roots via the Revise flow; delete the no-owner disabled
   state + HoverReveal explainer (`:2711-2767`, `:2747-2766`); Edit-Rule anchor (`:2343-2354`) accepts
   type-default rows.
10. **basePrompt de-threading — SCORE side only**: remove it from the SCORE Revise mount (`:1758`) and thread the
    intent's copied seed rule for `seedV1`'s "untouched" heuristic (`RuleWorkbench.tsx:330`). **The baseline
    promptMode mount (`:1806`) and the `promptDraft` fallback (`:935`) KEEP a baseline prompt source** (keep the
    prop for `isBaseline`, or ship the holder's seed in the `baseline` payload); baseline seedV1 keeps comparing
    against `deployedOrBasePrompt`. Add the parent-rule-save nudge ("N intents started from this rule —
    review?", §3.5).

**Acceptance P3**: SCORE: 4 type sections whose counts sum (child subtrees + Uncategorized leaves = section
count); type / intent / residue browsing all filter the middle column; creation works from all three contexts
(type section, selected intent, selected query via "New intent for this query") with the correct parent and
seeded rule each time; jelson suggestion click adopts a template successfully; reorder versions correctly;
shadowing chip appears for two overlapping siblings (manufacture on NIRVANA); no global All / Uncategorized /
'+ New' remains in the SCORE left column. Baseline: behaviorally unchanged — screenshot diff AND exercise
presets, saved searches, Revise v1 naming, in both `condition='baseline'` and `?view=baseline`.

## P4 — Deploy & runtime

1. **Snapshot v2 + total parse helper** `parseChatDeploySnapshot(raw)` (never throws — DeployModal lockout risk,
   `DeployModal.tsx:325`); route ALL 7 raw-cast sites through it (`deploy-store.ts:141`,
   `deploy/route.ts:77,138,147,181`, `page.tsx:123,134`). Missing `schemaVersion` → v1. v2: `ChatDeployIntent` +
   `{kind, type, parentId, position}`, `typeClassifierVersion`, NO `links`. **Explicit build step**: extend
   `buildChatDeploySnapshot` (`deploy-store.ts:59-94`) to `ensureTypeRoots` and append `kind='type_root'` rows
   (id/title/rule/type, empty pins) from `state.intents` into `snapshot.intents` — `promptReady` excludes them
   (P0.2), so without this the chains have no else-rules. Include roots in the D10 ≤40 count and in
   hasRules/dirty computations.
2. **`canonicalChatConfig`** (`deploy-store.ts:100-120`): keep id-ASC sort; add per-intent
   `{kind,type,parentId,position}` (order captured by explicit position — never array-order comparison; jsonb
   key-reorder precedent `:112-117`); keep pin normalization both sides (`:108-109`); add `schemaVersion` +
   `typeClassifierVersion` next to `v:`; drop links. v1-vs-v2 canonicals never match → every pre-migration deploy
   reads dirty once — intended; surface as "re-deploy needed" in deploy GET.
3. **Dirty/never-deployed fallback** (`deploy/route.ts:78`): `liveIntents(kind='intent').length > 0 || any
   type-root rule differs from its seed (assignmentBasePrompt)`. This keeps fresh SWAG clones (non-empty base
   prompt copied into seeds) from reading dirty on first load.
4. **Runtime rewrite** (make `resolveChatPromptFromSnapshot` the shared core — currently zero callers — with
   `resolveDeployedChatPrompt` delegating; delete the legacy `resolveAssignment`/`IntentLinkEdge`/links-read
   here, ending D11):
   - v1 latest snapshot → base prompt + `deployVersion:null` (D5); `fromVersion` on v1 → 409.
   - Short-circuit: no live-intent rules AND all type-root rules empty → **empty systemPrompt with outcome
     `type_default`** (no system message — matching the routed else contract `chat/route.ts:232-237`), NOT base
     prompt (base is strictly error/timeout/legacy fail-open, §3.5).
   - Two parallel calls (D3): `classifyMessageType` (no dissection live — accepted, same gap as ratings
     `:242-250`) ∥ `rateMessageIntents` over ALL deployed live intents. Both 15s/0-retry; either fails/invalid →
     base prompt fail-open.
   - Walk the emitted type's chain; missing rating on any of its nodes → base (D4); matched → that rule; chain
     exhausted → type root's rule (empty → no system message).
   - Widen `DeployedPromptResult.applied` (`:199-204`) → `{intentId, intentTitle, rule,
     outcome:'intent'|'type_default', type}` — type roots are rows, so `appliedIntentId` is always present on
     success.
5. **Audit metadata** (`chat/route.ts:290-313`): add `appliedOutcome`+`appliedType`; read in
   `queries.ts:206-222` + `page.tsx:250-251`; `DeployVersionBoard` (`IntentBoard.tsx:690-888`): group by
   `appliedIntentId`; legacy `null` rows → undifferentiated "legacy base" bucket (never relabel); new no-applied
   rows → "error fail-open" bucket.
6. **Deploy validation + GET/Modal**: refuse >40-node deploys (D10); `summarize()` (`deploy/route.ts:30-44`) +
   `liveIntents` (`:92-134`) carry tree fields and re-include type roots grouped by type; DeployModal renders
   grouped/indented; footer drops "tie-breakers" (`DeployModal.tsx:337-340`). Redeploy path
   (`deploy/route.ts:177-182`) upgrades via the parse helper (v1 → 409).

**Acceptance P4**: deploy on NIRVANA; live chat: (a) matched intent rule, (b) empty chain → type-root rule,
(c) type-call timeout (simulate) → base, (d) all-empty config → no system message with `type_default`; audit
fields visible in ?chatv with per-type else buckets; old snapshots render in history + ?chatv; >40-node deploy
refused; `grep resolveAssignment` returns nothing.

## P5 — Study/provisioning integration pass

1. E2E: fresh participant login → clone → SCORE board works with tree; baseline behaviorally identical (presets
   instant from cache, probe searches, review set, Revise, deploy). Note: there is **no test-chat** surface in
   either condition (`resolveChatPromptFromSnapshot` had zero callers; spec §5.3/§5.4 test-chat was never
   implemented) — do not hunt for one.
2. Teardown/reset cycle on a scratch participant (new table + columns included; `'score_intent_links'` entry
   removed from `teardown.ts:22-43` — code must tolerate the table's absence; then the operator may run the
   documented `DROP TABLE IF EXISTS score_intent_links`).
3. Verify the P0 backfill held (masters typed; pilot clones reset/backfilled per D7 run log).
4. Update `docs/STUDY_BASELINE_SPEC.md`: §B-7 leak checklist (add tree/type/order/shadowing/else-rule
   affordances); coverage-metric prose (Overlaps bucket dies; Unassigned → per-type residue); §5.4/§5.6 runtime
   description; **§6 S-6** — the "템플릿 활성화 플로우 유지 / create→workbench 직행 유지" clauses are superseded
   by the v7 create-from-type-browse + jelson-suggestion flow (presets stay is_template-backed, baseline-only);
   note in `docs/SCORE_v6_remaining_work.md` that the classification layer is superseded (pointer to v7 docs).

## P6 — Verification scripts (build now; RUN only when the user asks — the type re-eval is the §6.1 gate)

Follow `scripts/score/stability-check.ts` harness shape exactly (inline .env loader BEFORE imports `:20-37`,
dynamic `@/lib/score/*` imports, `createLimiter`, argv positionals, JSON out + stderr progress). Resolve NIRVANA
by `shareToken='nirvana-dataset'` (UUID changes on re-import, `import-nirvana.ts:147`).

1. `scripts/score/type-eval.ts` — new 4-type classifier vs gold `nirvana/GPTWriting_recoded.csv` (join:
   `docs/SCORE_classifierA_vs_human_eval.md:12-14`; `PL/TR/RE/AL` → type, `AL`↔`drafting`; blank-Code rows
   reported separately — forced choice has no null escape); accuracy, Cohen's κ, 4×4 confusion; arms
   with/without dissection (`SCORE_NO_DISSECTION=1` pattern — the without-arm is the live-runtime number).
   Reference: old instrument scored 79.2%/κ0.72.
2. `scripts/score/type-stability.ts` — K repeats per message, flip rate (the cache freezes the first draw
   forever).
3. `scripts/score/multi-activity-rate.ts` — fraction of messages with ≥2 dissected requests spanning ≥2 types →
   decides whether Drafting-wins needs UI surfacing (§6.2/§6.3).

## Sequencing & risk notes

- Order: P0 → P1 → P2 → P3 → P4 → P5; P6 anytime after P0.5. P3 before P4 (board is the daily driver; runtime
  keeps working on the legacy path per D11 meanwhile).
- Single-commit cutovers: P2 (resolver + scoping + deletions), P4.4+P4.5 (runtime + audit).
- The `ensured` DDL memo is per-process (`intent-store.ts:51`) — new columns exist only after the first
  `ensureIntentTables()`; every new route awaits it first (existing discipline).
- Never rename/renumber intent ids: review-set scopes (`intent:<id>`), rule versions, pins key on id.
- Two DDL sites exist; everything here goes in `intent-store.ts`'s `createIntentTables`, NOT `study/store.ts`.
- If any step tempts you to change `RATING_INSTRUCTIONS` or the rating schema — stop and re-read invariant 2.
