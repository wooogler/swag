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
import { logStudyEvent } from '@/lib/study/events';
import {
  buildChatDeploySnapshot,
  canonicalChatConfig,
  getLatestChatDeploy,
  listChatDeploys,
  recordChatDeploy,
  type ChatDeploySnapshot,
} from '@/lib/score/deploy-store';
import { isMinorVersion, loadIntentState, type VersionSummary } from '@/lib/score/intent-store';

export const dynamic = 'force-dynamic';

function summarize(versionNo: number, snapshot: ChatDeploySnapshot, note: string | null, createdAt: Date) {
  return {
    versionNo,
    createdAt: createdAt.toISOString(),
    note,
    intentCount: snapshot.intents.length,
    ruleCount: snapshot.intents.filter((i) => i.rule?.trim()).length,
    intents: snapshot.intents.map((i) => ({
      id: i.id,
      title: i.title,
      hasRule: !!i.rule?.trim(),
    })),
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
  const dirty = latest
    ? canonicalChatConfig(current) !== canonicalChatConfig(latest.snapshot as ChatDeploySnapshot)
    : current.intents.length > 0;

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
      ? summarize(latest.versionNo, latest.snapshot as ChatDeploySnapshot, latest.note, latest.createdAt)
      : null,
    dirty,
    live: {
      intentCount: current.intents.length,
      ruleCount: current.intents.filter((i) => i.rule?.trim()).length,
      intents: liveIntents,
    },
    versions: rows.map((r) =>
      summarize(r.versionNo, r.snapshot as ChatDeploySnapshot, r.note, r.createdAt)
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
    snapshot = source.snapshot as ChatDeploySnapshot;
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

  const versionNo = await recordChatDeploy(id, auth.instructor.id, snapshot, note);
  await logStudyEvent(id, 'deploy', { condition: 'score', versionNo });
  const latest = await getLatestChatDeploy(id);
  return NextResponse.json(
    {
      versionNo,
      deployed: latest ? summarize(latest.versionNo, latest.snapshot, note, latest.createdAt) : null,
    },
    { status: 201 }
  );
}
