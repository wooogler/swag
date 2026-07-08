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
import { z } from 'zod';
import { authorizeAssignment, authErrorResponse } from '@/lib/score/authz';
import {
  buildChatDeploySnapshot,
  canonicalChatConfig,
  getLatestChatDeploy,
  listChatDeploys,
  recordChatDeploy,
  type ChatDeploySnapshot,
} from '@/lib/score/deploy-store';

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

  const [rows, current] = await Promise.all([listChatDeploys(id), buildChatDeploySnapshot(id)]);
  const latest = rows[0] ?? null;
  // Dirty = the live intent→rule set differs from what students are getting.
  // Never deployed + nothing configured yet → not dirty (nothing to push).
  const dirty = latest
    ? canonicalChatConfig(current) !== canonicalChatConfig(latest.snapshot as ChatDeploySnapshot)
    : current.intents.length > 0;

  return NextResponse.json({
    latest: latest
      ? summarize(latest.versionNo, latest.snapshot as ChatDeploySnapshot, latest.note, latest.createdAt)
      : null,
    dirty,
    live: { intentCount: current.intents.length, ruleCount: current.intents.filter((i) => i.rule?.trim()).length },
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
  const latest = await getLatestChatDeploy(id);
  return NextResponse.json(
    {
      versionNo,
      deployed: latest ? summarize(latest.versionNo, latest.snapshot, note, latest.createdAt) : null,
    },
    { status: 201 }
  );
}
