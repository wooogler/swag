/**
 * SCORE v6 — compact per-intent version history for the Intent modal.
 *
 * GET → the latest config versions that touched THIS intent, each reduced to
 * what the modal's history strip shows: the definition at that version, the
 * labeled-example counts (from the snapshot's pins), and the save-time stats
 * (in-this-intent count) when the change recorded them.
 */
import { NextResponse } from 'next/server';
import { desc, eq, sql, and } from 'drizzle-orm';
import { db } from '@/db/db';
import { scoreConfigVersions } from '@/db/schema';
import { authorizeAssignment, authErrorResponse } from '@/lib/score/authz';
import {
  ensureIntentTables,
  type IntentConfigSnapshot,
  type VersionSummary,
} from '@/lib/score/intent-store';

export const dynamic = 'force-dynamic';

const LIMIT = 12;

type RouteParams = { params: Promise<{ id: string; intentId: string }> };

export async function GET(_req: Request, { params }: RouteParams) {
  const { id, intentId: intentIdRaw } = await params;
  const auth = await authorizeAssignment(id);
  if ('error' in auth) {
    const { body, status } = authErrorResponse(auth.error);
    return NextResponse.json(body, { status });
  }
  const intentId = Number.parseInt(intentIdRaw, 10);
  if (!Number.isFinite(intentId)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  await ensureIntentTables();
  // jsonb containment: versions whose summary.intentIds includes this id
  const touchesIntent = and(
    eq(scoreConfigVersions.assignmentId, id),
    sql`${scoreConfigVersions.summary}->'intentIds' @> ${JSON.stringify([intentId])}::jsonb`
  );
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        versionNo: scoreConfigVersions.versionNo,
        snapshot: scoreConfigVersions.snapshot,
        summary: scoreConfigVersions.summary,
        createdAt: scoreConfigVersions.createdAt,
      })
      .from(scoreConfigVersions)
      .where(touchesIntent)
      .orderBy(desc(scoreConfigVersions.versionNo))
      .limit(LIMIT),
    // Total count → per-INTENT version numbers (this intent's own v1, v2, …),
    // independent of the global config version sequence. History is append-only,
    // so the display-time ranking is stable.
    db.select({ total: sql<number>`count(*)::int` }).from(scoreConfigVersions).where(touchesIntent),
  ]);

  const versions = rows.map((row, i) => {
    const intentVersion = total - i;
    const snapshot = row.snapshot as IntentConfigSnapshot;
    const summary = row.summary as VersionSummary;
    const intent = snapshot.intents?.find((i) => i.id === intentId) ?? null;
    const pins = (snapshot.pins ?? []).filter((p) => p.intentId === intentId);
    return {
      versionNo: row.versionNo,
      intentVersion,
      createdAt: row.createdAt.toISOString(),
      action: summary.action,
      detail: summary.detail ?? null,
      title: intent?.title ?? null,
      definition: intent?.definition ?? null,
      included: pins.filter((p) => p.verdict === 'in').length,
      excluded: pins.filter((p) => p.verdict === 'out').length,
      stats: summary.stats ?? null,
    };
  });

  return NextResponse.json({ versions });
}
