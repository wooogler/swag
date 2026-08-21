/**
 * SCORE v6 — chatbot deploy versions for one assignment.
 *
 * GET  → deploy status: latest version, whether the live intent→rule set has
 *        undeployed changes (dirty), and the version history.
 * POST → DEPLOY. {} freezes the CURRENT live config as a new version;
 *        {fromVersion: N} re-deploys version N's snapshot as a NEW version
 *        (rollback keeps the history append-only, like the intent versions).
 *        The student chat runtime picks the latest version up immediately.
 */
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/db';
import { scoreConfigVersions, scoreRuleVersions } from '@/db/schema';
import { authorizeAssignment, authErrorResponse } from '@/lib/score/authz';
import { refuseSimpleClone } from '@/lib/study/simple/route-context';
import { logStudyEvent } from '@/lib/study/events';
import { warmClone } from '@/lib/study/warm';
import {
  buildChatDeploySnapshot,
  canonicalChatConfig,
  getLatestChatDeploy,
  isLegacySnapshot,
  listChatDeploys,
  parseChatDeploySnapshot,
  recordChatDeploy,
  splitSnapshot,
  type ChatDeploySnapshot,
} from '@/lib/score/deploy-store';
import { MAX_INTENTS_PER_CALL } from '@/lib/score/intent-prompts';
import { QUERY_TYPE_LABELS, isScoreQueryType } from '@/lib/score/intents';
import { isMinorVersion, loadIntentState, type VersionSummary } from '@/lib/score/intent-store';

export const dynamic = 'force-dynamic';

function summarize(versionNo: number, snapshot: ChatDeploySnapshot, note: string | null, createdAt: Date) {
  const { judged, roots } = splitSnapshot(snapshot);
  return {
    versionNo,
    createdAt: createdAt.toISOString(),
    note,
    // Counts describe the INTENTS an instructor authored; the 4 type roots are
    // structure, not entries in the list.
    intentCount: judged.length,
    ruleCount: judged.filter((i) => i.rule?.trim()).length,
    intents: judged.map((i) => ({
      id: i.id,
      title: i.title,
      hasRule: !!i.rule?.trim(),
      type: isScoreQueryType(i.type) ? i.type : null,
      parentId: i.parentId ?? null,
      position: i.position ?? null,
    })),
    typeRules: roots.map((r) => ({
      id: r.id,
      type: isScoreQueryType(r.type) ? r.type : null,
      title: r.title,
      hasRule: !!r.rule?.trim(),
    })),
    /** Frozen before the v7 cutover — the runtime cannot route it, so students
     * get the plain base prompt until this assignment is deployed once. */
    legacy: isLegacySnapshot(snapshot),
    configVersionNo: snapshot.configVersionNo,
  };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorizeAssignment(id);
  if ('error' in auth) {
    const { body, status } = authErrorResponse(auth.error);
    return NextResponse.json(body, { status });
  }
  // Not on a simple clone: that version has none of this, and letting it
  // through would write a second, disagreeing answer to "what is this
  // participant's configuration" (lib/study/simple/route-context).
  const wrongVersion = await refuseSimpleClone(id);
  if (wrongVersion) return wrongVersion;

  const [rows, current, state, ruleVersionRows, configVersionRows] = await Promise.all([
    listChatDeploys(id),
    buildChatDeploySnapshot(id),
    loadIntentState(id),
    db
      .select({
        intentId: scoreRuleVersions.intentId,
        versionNo: scoreRuleVersions.versionNo,
        name: scoreRuleVersions.name,
        minor: scoreRuleVersions.minor,
        source: scoreRuleVersions.source,
      })
      .from(scoreRuleVersions)
      .where(eq(scoreRuleVersions.assignmentId, id)),
    db
      .select({ summary: scoreConfigVersions.summary })
      .from(scoreConfigVersions)
      .where(eq(scoreConfigVersions.assignmentId, id)),
  ]);
  const latest = rows[0] ?? null;
  // Dirty = the live intent→rule set differs from what students are getting.
  // Never deployed + nothing configured yet → not dirty (nothing to push).
  const currentSplit = splitSnapshot(current);
  const dirty = latest
    ? canonicalChatConfig(current) !== canonicalChatConfig(parseChatDeploySnapshot(latest.snapshot))
    : // Never deployed. The 4 type roots always exist now, so "anything to
      // push?" means an authored intent, or a type rule the instructor has
      // actually written — a freshly cloned board seeded from the assignment
      // default is not a pending change.
      currentSplit.judged.length > 0 ||
      currentSplit.roots.some((r) => (r.rule ?? '').trim() !== (current.basePrompt ?? '').trim());

  // Live intent details for the deploy modal's browser pane: what exactly is
  // about to be frozen (definition, rule, and the instructor's labeled
  // examples — actual question text, same list the Intent modal shows).
  // Version labels mirror the board's intents panel: both show DISPLAY major
  // numbers (v1, v2, …), NOT raw sequence numbers — seeds and simulated minors
  // occupy the sequence too, so raw counts run ahead.
  //  · latestRuleVersion = latest major (non-minor) rule version, numbered by
  //    its major ordinal. The v1 seed counts — it is the rule the intent
  //    starts from, so a never-revised intent still reads "v1 Starting rule".
  //  · intentVersionNo = MAJOR config versions touching the intent (minors —
  //    pin labels, applies — fold into the workbench accordion, per
  //    isMinorVersion, and must not advance "When vN").
  const rulesByIntent = new Map<number, typeof ruleVersionRows>();
  for (const v of ruleVersionRows) {
    const list = rulesByIntent.get(v.intentId) ?? [];
    list.push(v);
    rulesByIntent.set(v.intentId, list);
  }
  const latestRuleByIntent = new Map<number, { versionNo: number; name: string | null }>();
  for (const [intentId, list] of rulesByIntent) {
    const asc = [...list].sort((a, b) => a.versionNo - b.versionNo);
    let majorNo = 0;
    let latest: { versionNo: number; name: string | null } | null = null;
    for (const v of asc) {
      if (!v.minor) {
        majorNo += 1;
        latest = { versionNo: majorNo, name: v.name };
      }
    }
    if (latest) latestRuleByIntent.set(intentId, latest);
  }
  const intentVersionCount = new Map<number, number>();
  for (const row of configVersionRows) {
    const summary = row.summary as VersionSummary | null;
    const ids = summary?.intentIds;
    if (!summary || !Array.isArray(ids) || isMinorVersion(summary)) continue;
    for (const iid of ids) intentVersionCount.set(iid, (intentVersionCount.get(iid) ?? 0) + 1);
  }
  const liveIntents = state.intents
    // kind === 'intent' keeps the v7 type roots (and the baseline prompt-holder)
    // out of the modal's live list — they are containers, not deployable
    // intents. The type roots' else-rules join the review pane in P4.
    .filter((i) => !i.archived && !i.isTemplate && i.kind === 'intent')
    .map((i) => ({
      id: i.id,
      title: i.title,
      definition: i.definition,
      rule: i.rule,
      intentVersionNo: intentVersionCount.get(i.id) ?? 0,
      latestRuleVersion: latestRuleByIntent.get(i.id) ?? null,
      pins: state.pins
        .filter((p) => p.intentId === i.id)
        .map((p) => ({
          messageId: p.messageId,
          verdict: p.verdict as 'in' | 'out',
          queryText: p.queryText,
        })),
    }));

  return NextResponse.json({
    latest: latest
      ? summarize(latest.versionNo, parseChatDeploySnapshot(latest.snapshot), latest.note, latest.createdAt)
      : null,
    dirty,
    live: {
      intentCount: currentSplit.judged.length,
      ruleCount: currentSplit.judged.filter((i) => i.rule?.trim()).length,
      intents: liveIntents,
      // The type roots' else-rules are part of what Deploy freezes, so the
      // review pane shows them alongside the intents.
      typeRules: currentSplit.roots
        .filter((r) => isScoreQueryType(r.type))
        .map((r) => ({
          id: r.id,
          type: r.type as string,
          label: QUERY_TYPE_LABELS[r.type as 'planning'],
          rule: r.rule,
        })),
    },
    versions: rows.map((r) =>
      summarize(r.versionNo, parseChatDeploySnapshot(r.snapshot), r.note, r.createdAt)
    ),
  });
}

const postSchema = z.object({
  note: z.string().trim().max(300).optional(),
  // Re-deploy an older version's snapshot as a new version (rollback).
  fromVersion: z.number().int().positive().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorizeAssignment(id);
  if ('error' in auth) {
    const { body, status } = authErrorResponse(auth.error);
    return NextResponse.json(body, { status });
  }
  // Not on a simple clone: that version has none of this, and letting it
  // through would write a second, disagreeing answer to "what is this
  // participant's configuration" (lib/study/simple/route-context).
  const wrongVersion = await refuseSimpleClone(id);
  if (wrongVersion) return wrongVersion;

  let body: z.infer<typeof postSchema> = {};
  try {
    body = postSchema.parse((await req.json().catch(() => ({}))) ?? {});
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'invalid_input', details: error.errors }, { status: 400 });
    }
  }

  let snapshot: ChatDeploySnapshot;
  let note = body.note ?? null;
  if (body.fromVersion !== undefined) {
    const rows = await listChatDeploys(id, 200);
    const source = rows.find((r) => r.versionNo === body.fromVersion);
    if (!source) return NextResponse.json({ error: 'version_not_found' }, { status: 404 });
    snapshot = parseChatDeploySnapshot(source.snapshot);
    // A pre-v7 snapshot cannot route (no types, no tree). Re-deploying one
    // would put students back on the base prompt with no sign of why, so it is
    // refused: deploy the CURRENT config instead, which is v7-shaped (D5).
    if (isLegacySnapshot(snapshot)) {
      return NextResponse.json(
        {
          error: 'legacy_snapshot',
          message: `v${body.fromVersion} was saved before the intent tree and can no longer be served. Deploy the current setup instead.`,
        },
        { status: 409 }
      );
    }
    note = note ?? `redeploy of v${body.fromVersion}`;
  } else {
    snapshot = await buildChatDeploySnapshot(id);
    // No-op guard: identical to what students already get → don't mint a new
    // version (double-clicks, stale tabs).
    const latestNow = await getLatestChatDeploy(id);
    if (latestNow && canonicalChatConfig(latestNow.snapshot) === canonicalChatConfig(snapshot)) {
      return NextResponse.json({
        versionNo: latestNow.versionNo,
        deployed: summarize(latestNow.versionNo, latestNow.snapshot, null, latestNow.createdAt),
        unchanged: true,
      });
    }
  }

  // The runtime rates every judged set in ONE call, so a chain longer than the
  // call's cap would be silently truncated — and a truncated chain routes
  // WRONGLY, not just partially. Refuse instead (D10).
  const judgedCount = splitSnapshot(snapshot).judged.length;
  if (judgedCount > MAX_INTENTS_PER_CALL) {
    return NextResponse.json(
      {
        error: 'too_many_intents',
        message: `This board has ${judgedCount} intents; the chatbot can route at most ${MAX_INTENTS_PER_CALL}. Archive or merge some before deploying.`,
      },
      { status: 400 }
    );
  }

  const versionNo = await recordChatDeploy(id, auth.instructor.id, snapshot, note);
  // WHAT WAS ACTUALLY SHIPPED, in the one number that decides how the chatbot
  // behaves: how much of the configuration carries a rule. An intent with no
  // rule contributes nothing — its questions reach the model with no system
  // prompt at all — and a type root with no rule does the same for everything
  // its chain leaves unclaimed. The snapshot holds this, but only by being
  // opened and walked; recording it here makes "deployed with three intents
  // still empty" a fact the trail states rather than one an analysis derives.
  {
    const { judged, roots } = splitSnapshot(snapshot);
    const hasRule = (i: { rule: string | null }) => !!i.rule?.trim();
    await logStudyEvent(id, 'deploy', {
      condition: 'score',
      versionNo,
      intents: judged.length,
      intentsWithRule: judged.filter(hasRule).length,
      typeRootsWithRule: roots.filter(hasRule).length,
      typeRoots: roots.length,
      ruleless: judged.filter((i) => !hasRule(i)).map((i) => ({ id: i.id, title: i.title })),
    });
  }
  // Start freezing this version's measurement answers now, while the
  // participant is still working. Deliberately not awaited (warm.ts).
  warmClone(id);
  const latest = await getLatestChatDeploy(id);
  return NextResponse.json(
    {
      versionNo,
      deployed: latest ? summarize(latest.versionNo, latest.snapshot, note, latest.createdAt) : null,
    },
    { status: 201 }
  );
}
