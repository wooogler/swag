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
  isMinorVersion,
  type IntentConfigSnapshot,
  type VersionSummary,
} from '@/lib/score/intent-store';

export const dynamic = 'force-dynamic';

// Full-ish history: numbering needs every row (a LIMIT slice would misnumber
// the majors), and the workbench accordion keeps long lists compact anyway.
const LIMIT = 200;

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
  const rows = await db
    .select({
      versionNo: scoreConfigVersions.versionNo,
      snapshot: scoreConfigVersions.snapshot,
      summary: scoreConfigVersions.summary,
      createdAt: scoreConfigVersions.createdAt,
    })
    .from(scoreConfigVersions)
    .where(touchesIntent)
    .orderBy(desc(scoreConfigVersions.versionNo))
    .limit(LIMIT);

  // Per-INTENT numbering (independent of the global config sequence): majors
  // count this intent's v1, v2, …; each minor gets {preceding major}.{k}
  // (v2.1, v2.2, … — v0.x while still an unsaved draft). Number ascending so
  // history stays append-only and the display ranking stable.
  let majorNo = 0;
  let minorNo = 0;
  const numbered = [...rows].reverse().map((row) => {
    const summary = row.summary as VersionSummary;
    const minor = isMinorVersion(summary);
    if (minor) {
      minorNo += 1;
    } else {
      majorNo += 1;
      minorNo = 0;
    }
    return { row, summary, minor, intentVersion: majorNo, minorNo: minor ? minorNo : null };
  });

  const versions = numbered.reverse().map(({ row, summary, minor, intentVersion, minorNo: mNo }) => {
    const snapshot = row.snapshot as IntentConfigSnapshot;
    const intent = snapshot.intents?.find((i) => i.id === intentId) ?? null;
    const pins = (snapshot.pins ?? []).filter((p) => p.intentId === intentId);
    return {
      versionNo: row.versionNo,
      intentVersion,
      minor,
      minorNo: mNo,
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
