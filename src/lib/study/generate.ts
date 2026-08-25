/**
 * Frozen response generation for the study's measurement phases.
 *
 * After a participant deploys, their configuration answers the block-test and
 * A/B questions ONCE and the answers are stored. Generation has no temperature
 * or seed control anywhere in this codebase, so a regenerated answer would not
 * be the answer the participant was shown — freezing is what makes the block
 * test and the blind A/B replayable and analysable at all.
 *
 * Two rules this module exists to enforce:
 *
 *  1. NEVER store a fail-open answer. When the classifier times out or comes
 *     back partial, the student runtime deliberately serves the assignment's
 *     base prompt so the chat never blocks — correct there, fatal here: the
 *     stored text would be an answer the participant's configuration never
 *     produced, silently weakening the very difference the study measures.
 *     Hence generous call options, retries, and a hard refusal to persist.
 *
 *  2. Pin the configuration. SCORE resolves against ONE snapshot loaded up
 *     front; baseline reads an explicit versionNo rather than "latest deployed"
 *     (which would drift the moment the participant redeploys). Either way the
 *     pin is stored alongside the answer, so staleness is detectable later.
 *
 *  3. Route on the type the question was CURATED as. A bank question is held
 *     out of the participant's log, but it is not a new message: it comes from
 *     the master log, curation typed it once, and that verdict is what put it
 *     in this block and what the analysis counts it as. Classifying it again
 *     here asks the same model the same question a second time and can get a
 *     different answer — and then a rule the participant wrote under Drafting
 *     is skipped on an item everything else calls Drafting, because this one
 *     call said reviewing. They see an answer their rule never touched and
 *     conclude the rule does not work. The frozen bank type goes in as
 *     knownType, which also drops one LLM call per question and removes
 *     'unusable_type' as a way for generation to fail.
 *
 * Context policy, identical in both arms and mirroring /api/chat:
 *   generation  — every context turn plus the question (the route hands the
 *                 model the whole history)
 *   classifier  — the LAST assistant turn as prevResponseText and the user turn
 *                 before it as prevQueryText (the route derives exactly one
 *                 prior exchange, server-side)
 */
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db/db';
import {
  assignments,
  baselinePromptVersions,
  studyClones,
  studyGeneratedResponses,
  studyQuestionBank,
  type StudyQuestionBankItem,
} from '@/db/schema';
import { assignmentBasePrompt } from '@/lib/assignment-ai';
import { getLatestChatDeploy, resolveChatPromptFromSnapshot } from '@/lib/score/deploy-store';
import { isScoreQueryType } from '@/lib/score/intents';
import { createLimiter, SCORE_CONCURRENCY } from '@/lib/score/limiter';
import { armOf, familyOf, type StudioView } from './config';
import type { SimpleSnapshot } from './simple/chain';
import { resolveSimpleLive } from './simple/live';
import { getSimpleSaved } from './simple/store';
import { isChatConfigured, runChatTurn, type TurnMessage } from './chat-run';
import { ensureStudyTables } from './store';

/** Generous next to the runtime's 15s/0 — a batch may wait, a student may not. */
const CALL_OPTIONS = { timeoutMs: 45_000, maxRetries: 2 };
/**
 * The generation leg, which writes prose rather than a verdict and so gets
 * longer — but is capped, which it was not.
 *
 * It ran on the SDK's own defaults while the classifier leg beside it was
 * budgeted, so one hung turn could hold the whole batch, and this batch is
 * awaited inside the hand-off a participant clicks. Fail fast beats waiting:
 * a turn that times out is retried by FAIL_OPEN_RETRIES below, and a batch
 * that cannot finish is refused rather than stored, so the cost of a tight
 * budget is a retry and the cost of no budget is a stranded session.
 */
const CHAT_CALL_OPTIONS = { timeoutMs: 60_000, maxRetries: 1 };
/** Retries of the WHOLE resolve+generate step when it fails open. */
const FAIL_OPEN_RETRIES = 2;

export type BankKind = 'test';

export interface GenerateOutcome {
  bankItemId: number;
  status: 'generated' | 'cached' | 'failed';
  outcome?: 'routed' | 'empty_config';
  reason?: string;
}

export interface GenerateReport {
  cloneAssignmentId: string;
  condition: 'score' | 'baseline';
  configRef: Record<string, unknown> | null;
  items: GenerateOutcome[];
  generated: number;
  cached: number;
  failed: number;
}

/** Context turns as stored in the bank. */
type BankContext = { role: 'user' | 'assistant'; content: string }[];

function readContext(item: StudyQuestionBankItem): BankContext {
  const raw = item.context;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (t): t is { role: 'user' | 'assistant'; content: string } =>
      !!t &&
      typeof t === 'object' &&
      (('role' in t && (t as { role: unknown }).role === 'user') ||
        (t as { role: unknown }).role === 'assistant') &&
      typeof (t as { content: unknown }).content === 'string'
  );
}

/** The single prior exchange the live classifier sees (route.ts:159-165). */
function priorExchange(context: BankContext): {
  prevQueryText: string | null;
  prevResponseText: string | null;
} {
  let prevResponseText: string | null = null;
  let prevQueryText: string | null = null;
  for (let i = context.length - 1; i >= 0; i--) {
    if (context[i].role === 'assistant') {
      prevResponseText = context[i].content;
      for (let j = i - 1; j >= 0; j--) {
        if (context[j].role === 'user') {
          prevQueryText = context[j].content;
          break;
        }
      }
      break;
    }
  }
  return { prevQueryText, prevResponseText };
}

/**
 * Did the model emit its whole reply twice?
 *
 * Seen in the wild while auditing rule-following: 2 of 360 generations came
 * back as an exact doubling with no separator — "What would you write or say in
 * response to that question?What would you write or say in response to that
 * question?". Both were under the shortest rule in that battery (a single
 * question back to the student, ~15 words), and the other 348 replies showed
 * nothing like it, so it looks like a short-output artefact rather than
 * anything the configuration did.
 *
 * It matters here and not on the board: a doubled reply on the board is a bad
 * screen someone regenerates, while a doubled reply HERE is written to
 * study_generated_responses and scored as what the participant's configuration
 * produces. Cheaper to retry than to explain in the analysis.
 *
 * Exact halves only. Anything looser risks throwing away a legitimate reply
 * that repeats a phrase.
 */
function isSelfDuplicated(text: string): boolean {
  const s = text.trim();
  if (s.length < 40) return false;
  // Two cuts, so a reply doubled across a single separator character (a
  // newline, a space) is caught as well as one doubled with nothing between.
  for (const cut of [Math.floor(s.length / 2), Math.ceil(s.length / 2)]) {
    const head = s.slice(0, cut).trim();
    const tail = s.slice(cut).trim();
    if (head.length >= 20 && head === tail) return true;
  }
  return false;
}

export async function getBankItems(
  datasetKey: string,
  kind: BankKind
): Promise<StudyQuestionBankItem[]> {
  const rows = await db
    .select()
    .from(studyQuestionBank)
    .where(and(eq(studyQuestionBank.datasetKey, datasetKey), eq(studyQuestionBank.kind, kind)));
  return rows.sort((a, b) => a.position - b.position);
}

/**
 * Generate (and freeze) one clone's answers to a set of bank questions.
 *
 * `datasetKey` selects WHICH questions — for the block test it is the clone's
 * own dataset, for A/B it is each dataset in turn, which is how a configuration
 * comes to answer the other dataset's questions (the home/away split). Nothing
 * about routing is clone-specific, so an away question resolves exactly like a
 * home one given only its text.
 */
export async function generateForClone(args: {
  cloneAssignmentId: string;
  datasetKey: string;
  kind: BankKind;
  /** Re-generate even if an answer is already stored (after a redeploy). */
  force?: boolean;
}): Promise<GenerateReport> {
  await ensureStudyTables();
  const { cloneAssignmentId, datasetKey, kind, force = false } = args;

  const [clone] = await db
    .select()
    .from(studyClones)
    .where(eq(studyClones.assignmentId, cloneAssignmentId));
  if (!clone) throw new Error('not_a_study_clone');

  const assignment = await db.query.assignments.findFirst({
    where: eq(assignments.id, cloneAssignmentId),
  });
  if (!assignment) throw new Error('assignment_missing');
  if (!isChatConfigured()) throw new Error('openai_not_configured');

  const items = await getBankItems(datasetKey, kind);
  if (items.length === 0) throw new Error('empty_bank');

  const basePrompt = assignmentBasePrompt(assignment);
  const view = clone.condition as StudioView;
  const condition = armOf(view);
  const simple = familyOf(view) === 'simple';

  // ── pin the configuration ONCE, before any answer is produced ──
  let configRef: Record<string, unknown>;
  let baselinePrompt: string | null = null;
  let snapshot: Awaited<ReturnType<typeof getLatestChatDeploy>> = null;
  let simpleSnapshot: SimpleSnapshot | null = null;

  if (simple) {
    // The newest SAVE, not whatever was applied last: a save is the
    // participant saying this is the version, and the block test asks about
    // the version they meant. The advance gate refuses to reach here with
    // unsaved changes, so the two agree by the time this runs.
    const tip = await getSimpleSaved({
      assignmentId: cloneAssignmentId,
      condition: view,
      seedPrompt: basePrompt,
    });
    if (!tip.version) throw new Error('not_deployed');
    simpleSnapshot = tip.snapshot;
    configRef = { simpleVersionNo: tip.version.versionNo };
  } else if (condition === 'baseline') {
    // Most-recently-DEPLOYED version, resolved to an explicit versionNo:
    // resolveBaselineChatPrompt always reads "latest deployed", which would
    // drift under a redeploy mid-session.
    const rows = await db
      .select({
        versionNo: baselinePromptVersions.versionNo,
        prompt: baselinePromptVersions.prompt,
        deployedAt: baselinePromptVersions.deployedAt,
      })
      .from(baselinePromptVersions)
      .where(eq(baselinePromptVersions.assignmentId, cloneAssignmentId));
    const live = rows
      .filter((r) => r.deployedAt)
      .sort((a, b) => b.deployedAt!.getTime() - a.deployedAt!.getTime())[0];
    if (!live) throw new Error('not_deployed');
    baselinePrompt = live.prompt;
    configRef = { baselineVersionNo: live.versionNo };
  } else {
    snapshot = await getLatestChatDeploy(cloneAssignmentId);
    if (!snapshot) throw new Error('not_deployed');
    configRef = { deployVersionNo: snapshot.versionNo };
  }

  // "Cached" has to mean cached FOR THIS CONFIGURATION. A participant who
  // tweaks and redeploys leaves rows pinned to the old version behind, and
  // counting those as done would test them against a chatbot they no longer
  // have — the exact drift the pin exists to catch, read the same way
  // isGenerationCurrent reads it below. Without this a re-run reports
  // everything cached and the staleness never clears.
  const existing = await db
    .select({
      bankItemId: studyGeneratedResponses.bankItemId,
      configRef: studyGeneratedResponses.configRef,
    })
    .from(studyGeneratedResponses)
    .where(
      and(
        eq(studyGeneratedResponses.cloneAssignmentId, cloneAssignmentId),
        inArray(
          studyGeneratedResponses.bankItemId,
          items.map((i) => i.id)
        )
      )
    );
  const pinned = JSON.stringify(configRef);
  const done = new Set(
    existing.filter((e) => JSON.stringify(e.configRef) === pinned).map((e) => e.bankItemId)
  );

  const run = createLimiter(SCORE_CONCURRENCY);
  const results: GenerateOutcome[] = [];

  await Promise.all(
    items.map((item) =>
      run(async () => {
        if (done.has(item.id) && !force) {
          results.push({ bankItemId: item.id, status: 'cached' });
          return;
        }

        const context = readContext(item);
        const messages: TurnMessage[] = [
          ...context.map((t) => ({ role: t.role, content: t.content })),
          { role: 'user' as const, content: item.question },
        ];

        for (let attempt = 0; attempt <= FAIL_OPEN_RETRIES; attempt++) {
          try {
            let systemPrompt: string;
            let applied: unknown = null;
            let outcome: 'routed' | 'empty_config';

            if (simple) {
              const { prevQueryText, prevResponseText } = priorExchange(context);
              // Throws rather than falling back if the judge cannot answer:
              // the assignment's own prompt is not this participant's
              // configuration, and recording it would put a reply nobody wrote
              // into the measurement.
              const route = await resolveSimpleLive({
                snapshot: simpleSnapshot!,
                queryText: item.question,
                prevQueryText,
                prevResponseText,
                callOptions: CALL_OPTIONS,
              });
              systemPrompt = route.systemPrompt;
              // The same three fields the full version records, so the
              // pointing question is scored the same way in both.
              applied = {
                intentId: route.sid,
                intentTitle: route.title,
                outcome: route.outcome === 'intent' ? 'intent' : 'type_default',
              };
              outcome = systemPrompt.trim() ? 'routed' : 'empty_config';
            } else if (condition === 'baseline') {
              systemPrompt = baselinePrompt ?? '';
              // A deployed baseline prompt IS the configuration — there is no
              // classifier to fail, so the only two states are "has text" and
              // "deliberately empty".
              outcome = systemPrompt.trim() ? 'routed' : 'empty_config';
            } else {
              const { prevQueryText, prevResponseText } = priorExchange(context);
              const resolved = await resolveChatPromptFromSnapshot({
                snapshot: snapshot!.snapshot,
                basePrompt,
                queryText: item.question,
                prevQueryText,
                prevResponseText,
                callOptions: CALL_OPTIONS,
                // Rule 3. A bank item with no frozen type falls through to the
                // live call rather than blocking generation — it is the old
                // behaviour, and buildQuestionBank refuses to write one.
                knownType: isScoreQueryType(item.queryType) ? item.queryType : null,
              });
              if (resolved.outcome === 'fail_open') {
                // The base prompt is NOT this participant's configuration.
                if (attempt === FAIL_OPEN_RETRIES) {
                  results.push({
                    bankItemId: item.id,
                    status: 'failed',
                    reason: `fail_open:${resolved.reason}`,
                  });
                  return;
                }
                continue;
              }
              systemPrompt = resolved.systemPrompt;
              applied = resolved.applied;
              outcome = resolved.outcome;
            }

            const response = await runChatTurn(systemPrompt, messages, CHAT_CALL_OPTIONS);
            if (!response.trim()) {
              if (attempt === FAIL_OPEN_RETRIES) {
                results.push({ bankItemId: item.id, status: 'failed', reason: 'empty_response' });
                return;
              }
              continue;
            }
            // Same posture as an empty reply: retry, and fail the item rather
            // than store a doubled one as the configuration's output.
            if (isSelfDuplicated(response)) {
              if (attempt === FAIL_OPEN_RETRIES) {
                results.push({ bankItemId: item.id, status: 'failed', reason: 'duplicated_response' });
                return;
              }
              continue;
            }

            const values = {
              participantId: clone.participantId,
              cloneAssignmentId,
              bankItemId: item.id,
              purpose: kind,
              configRef,
              applied: applied ?? null,
              outcome,
              response,
              model: process.env.OPENAI_MODEL ?? 'gpt-4o',
              createdAt: new Date(),
            };
            await db
              .insert(studyGeneratedResponses)
              .values(values)
              .onConflictDoUpdate({
                target: [
                  studyGeneratedResponses.cloneAssignmentId,
                  studyGeneratedResponses.bankItemId,
                ],
                set: values,
              });
            results.push({ bankItemId: item.id, status: 'generated', outcome });
            return;
          } catch (error) {
            if (attempt === FAIL_OPEN_RETRIES) {
              results.push({
                bankItemId: item.id,
                status: 'failed',
                reason: (error as Error).message,
              });
              return;
            }
          }
        }
      })
    )
  );

  return {
    cloneAssignmentId,
    condition,
    configRef,
    items: results.sort((a, b) => a.bankItemId - b.bankItemId),
    generated: results.filter((r) => r.status === 'generated').length,
    cached: results.filter((r) => r.status === 'cached').length,
    failed: results.filter((r) => r.status === 'failed').length,
  };
}

/**
 * Whether every stored answer for a clone still matches the configuration that
 * is deployed NOW. The session gate reads this: a participant who tweaks and
 * redeploys after generation would otherwise be tested against answers their
 * current chatbot no longer gives.
 */
export async function isGenerationCurrent(args: {
  cloneAssignmentId: string;
  datasetKey: string;
  kind: BankKind;
}): Promise<{ current: boolean; missing: number; stale: number }> {
  const { cloneAssignmentId, datasetKey, kind } = args;
  const items = await getBankItems(datasetKey, kind);
  if (items.length === 0) return { current: false, missing: 0, stale: 0 };

  const [clone] = await db
    .select()
    .from(studyClones)
    .where(eq(studyClones.assignmentId, cloneAssignmentId));
  if (!clone) return { current: false, missing: items.length, stale: 0 };

  let liveRef: Record<string, unknown> | null = null;
  if (familyOf(clone.condition as StudioView) === 'simple') {
    // Newest saved version, which in this version is also the one in effect.
    const [assignment] = await db
      .select()
      .from(assignments)
      .where(eq(assignments.id, cloneAssignmentId));
    const tip = await getSimpleSaved({
      assignmentId: cloneAssignmentId,
      condition: clone.condition as StudioView,
      seedPrompt: assignment ? assignmentBasePrompt(assignment) : '',
    });
    if (tip.version) liveRef = { simpleVersionNo: tip.version.versionNo };
  } else if (armOf(clone.condition as StudioView) === 'baseline') {
    const rows = await db
      .select({ versionNo: baselinePromptVersions.versionNo, deployedAt: baselinePromptVersions.deployedAt })
      .from(baselinePromptVersions)
      .where(eq(baselinePromptVersions.assignmentId, cloneAssignmentId));
    const live = rows
      .filter((r) => r.deployedAt)
      .sort((a, b) => b.deployedAt!.getTime() - a.deployedAt!.getTime())[0];
    if (live) liveRef = { baselineVersionNo: live.versionNo };
  } else {
    const latest = await getLatestChatDeploy(cloneAssignmentId);
    if (latest) liveRef = { deployVersionNo: latest.versionNo };
  }
  if (!liveRef) return { current: false, missing: items.length, stale: 0 };

  const stored = await db
    .select({
      bankItemId: studyGeneratedResponses.bankItemId,
      configRef: studyGeneratedResponses.configRef,
    })
    .from(studyGeneratedResponses)
    .where(
      and(
        eq(studyGeneratedResponses.cloneAssignmentId, cloneAssignmentId),
        inArray(
          studyGeneratedResponses.bankItemId,
          items.map((i) => i.id)
        )
      )
    );
  const byItem = new Map(stored.map((s) => [s.bankItemId, s.configRef]));

  let missing = 0;
  let stale = 0;
  for (const item of items) {
    const ref = byItem.get(item.id);
    if (!ref) missing += 1;
    else if (JSON.stringify(ref) !== JSON.stringify(liveRef)) stale += 1;
  }
  return { current: missing === 0 && stale === 0, missing, stale };
}
