/**
 * SCORE v6 — hard revert on the RULE axis (git-reset style, mirrors the
 * intent-spec revert).
 *
 * POST → make this rule version the live rule on the intent and DELETE every
 * later rule version (and their stored per-question responses) — the timeline
 * rewinds instead of growing a new entry. Simulated minors piled up past the
 * target disappear with it.
 */
import { NextResponse } from 'next/server';
import { and, eq, gt } from 'drizzle-orm';
import { db } from '@/db/db';
import { scoreIntents, scoreRuleVersionResponses, scoreRuleVersions } from '@/db/schema';
import { authorizeAssignment, authErrorResponse } from '@/lib/score/authz';
import { ensureIntentTables } from '@/lib/score/intent-store';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ id: string; intentId: string; versionNo: string }> };

export async function POST(_req: Request, { params }: RouteParams) {
  const { id, intentId: intentIdRaw, versionNo: versionNoRaw } = await params;
  const auth = await authorizeAssignment(id);
  if ('error' in auth) {
    const { body, status } = authErrorResponse(auth.error);
    return NextResponse.json(body, { status });
  }
  const intentId = Number.parseInt(intentIdRaw, 10);
  const versionNo = Number.parseInt(versionNoRaw, 10);
  if (!Number.isFinite(intentId) || !Number.isFinite(versionNo)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  await ensureIntentTables();
  const intentRows = await db
    .select()
    .from(scoreIntents)
    .where(and(eq(scoreIntents.id, intentId), eq(scoreIntents.assignmentId, id)));
  if (!intentRows[0]) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const targetRows = await db
    .select()
    .from(scoreRuleVersions)
    .where(
      and(
        eq(scoreRuleVersions.assignmentId, id),
        eq(scoreRuleVersions.intentId, intentId),
        eq(scoreRuleVersions.versionNo, versionNo)
      )
    );
  const target = targetRows[0];
  if (!target) return NextResponse.json({ error: 'version_not_found' }, { status: 404 });

  const deleted = await db.transaction(async (tx) => {
    // The target becomes the live rule (even when it was a simulated minor —
    // reverting TO a simulation promotes what it showed).
    await tx
      .update(scoreIntents)
      .set({ rule: target.rule, updatedAt: new Date() })
      .where(and(eq(scoreIntents.id, intentId), eq(scoreIntents.assignmentId, id)));
    // Rewind: drop the later versions and their stored per-question responses.
    await tx
      .delete(scoreRuleVersionResponses)
      .where(
        and(
          eq(scoreRuleVersionResponses.intentId, intentId),
          gt(scoreRuleVersionResponses.versionNo, versionNo)
        )
      );
    const rows = await tx
      .delete(scoreRuleVersions)
      .where(
        and(
          eq(scoreRuleVersions.assignmentId, id),
          eq(scoreRuleVersions.intentId, intentId),
          gt(scoreRuleVersions.versionNo, versionNo)
        )
      )
      .returning({ id: scoreRuleVersions.id });
    return rows.length;
  });

  return NextResponse.json({ reverted: true, versionNo, deleted });
}
