/**
 * SCORE v6 — one intent.
 *
 * PATCH  → edit title/definition/rule, or archive/restore. A definition edit
 *          changes the intent's defHash, so its ratings automatically read as
 *          stale (no explicit invalidation write needed).
 * DELETE → archive (soft, default): ratings/pins/version history keep
 *          referencing the intent so the timeline and granular revert stay
 *          reconstructible.
 * DELETE ?mode=purge → HARD delete: irreversibly wipe the intent AND every
 *          row that references it — its ratings, your in/out labels (pins),
 *          exception links to/from it, cached rule previews, and the version
 *          snapshots that are solely about this intent. Shared timeline entries
 *          (versions touching another intent too) are left intact.
 */
import { NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/db';
import {
  scoreConfigVersions,
  scoreIntentPins,
  scoreIntentRatings,
  scoreIntents,
  scoreRulePreviews,
} from '@/db/schema';
import { authorizeAssignment, authErrorResponse } from '@/lib/score/authz';
import { isOpenAIConfigured } from '@/lib/score/classifier';
import { generateIntentTitle } from '@/lib/score/intent-agent';
import {
  ensureIntentTables,
  recordConfigVersion,
  type IntentConfigSnapshot,
  type VersionSummary,
} from '@/lib/score/intent-store';

export const dynamic = 'force-dynamic';

const patchSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    definition: z.string().trim().min(1).max(4000).optional(),
    // rule: null clears it back to "No rule yet → base prompt applies".
    rule: z.string().trim().max(8000).nullable().optional(),
    archived: z.boolean().optional(),
    // Register a discovery draft → false (the modal's Save; the draft joins
    // the active set — its ratings are already valid, so it lands instantly).
    // Library templates are activated by CLONING (POST fromTemplateId), never
    // by flipping this on the template row itself.
    isTemplate: z.boolean().optional(),
    // Auto-generate the title from the definition on save (git-commit style).
    // Ignored when an explicit title is sent.
    autoTitle: z.boolean().optional(),
    // false → update WITHOUT a version entry. Default true keeps callers versioned.
    recordVersion: z.boolean().optional(),
    // Record as a MINOR version (an Apply — revertible but not a Save; the
    // history accordion folds these under their preceding major).
    minorVersion: z.boolean().optional(),
    // Version rollback: replace this intent's pins with the set snapshotted in
    // that config version (order preserved so the prompt/defHash reproduce
    // byte-identically → the stored ratings for that spec re-attach instantly).
    pinsFromVersion: z.number().int().positive().optional(),
    // Save-time counts from the modal, recorded on the version for history.
    stats: z
      .object({
        included: z.number().int().min(0),
        excluded: z.number().int().min(0),
        inCount: z.number().int().min(0),
      })
      .optional(),
    // Provenance for the version timeline (§1.10: which GUI action, anchored
    // on which question, produced this change). Display metadata only.
    provenance: z
      .object({
        via: z.enum(['direct', 'feedback', 'rewrite']),
        anchorMessageId: z.number().int().positive().optional(),
      })
      .optional(),
  })
  .refine(
    (b) =>
      b.title !== undefined ||
      b.definition !== undefined ||
      b.rule !== undefined ||
      b.archived !== undefined ||
      b.isTemplate !== undefined,
    { message: 'no fields to update' }
  );

async function loadIntent(assignmentId: string, intentId: number) {
  await ensureIntentTables();
  const rows = await db
    .select()
    .from(scoreIntents)
    .where(and(eq(scoreIntents.id, intentId), eq(scoreIntents.assignmentId, assignmentId)));
  return rows[0] ?? null;
}

type RouteParams = { params: Promise<{ id: string; intentId: string }> };

export async function PATCH(req: Request, { params }: RouteParams) {
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

  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await req.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'invalid_input', details: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const existing = await loadIntent(id, intentId);
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const set: Partial<typeof existing> = { updatedAt: new Date() };
  if (body.title !== undefined) set.title = body.title;
  if (body.definition !== undefined) set.definition = body.definition;
  if (body.rule !== undefined) set.rule = body.rule && body.rule.length > 0 ? body.rule : null;
  if (body.archived !== undefined) set.archived = body.archived;
  if (body.isTemplate !== undefined) set.isTemplate = body.isTemplate;

  // Auto-title (git-commit style): regenerate from the definition on save.
  // Best-effort — a failed LLM call must never fail the save.
  let autoTitled = false;
  if (body.autoTitle && body.title === undefined && isOpenAIConfigured()) {
    const generated = await generateIntentTitle(body.definition ?? existing.definition);
    if (generated) {
      set.title = generated;
      autoTitled = true;
    }
  }

  // One summary per change; archive/restore dominates for the timeline label.
  const activated = body.isTemplate === false && existing.isTemplate;
  const changed = [
    activated ? 'activated' : null,
    body.definition !== undefined ? 'definition' : null,
    body.rule !== undefined ? 'rule' : null,
    body.title !== undefined ? 'title' : autoTitled ? 'title(auto)' : null,
  ]
    .filter(Boolean)
    .join('+');
  const summary: VersionSummary = {
    action:
      body.archived === true
        ? 'archive_intent'
        : body.archived === false && existing.archived
          ? 'restore_intent'
          : activated
            ? // First registration: a draft/template became a live intent — this
              // Save IS its creation as far as the version history is concerned.
              'create_intent'
            : 'update_intent',
    intentIds: [intentId],
    messageId: body.provenance?.anchorMessageId,
    detail:
      [changed || null, body.provenance ? `via ${body.provenance.via}` : null]
        .filter(Boolean)
        .join(' · ') || undefined,
    ...(body.minorVersion ? { minor: true } : {}),
    stats: body.stats,
  };

  // Version rollback: pins are part of the spec, so restoring a version means
  // restoring its pin set too. Load the snapshot up front (outside the tx).
  let rollbackPins: { messageId: number; verdict: string; queryText: string; source: string }[] | null =
    null;
  if (body.pinsFromVersion !== undefined) {
    const versionRows = await db
      .select({ snapshot: scoreConfigVersions.snapshot })
      .from(scoreConfigVersions)
      .where(
        and(
          eq(scoreConfigVersions.assignmentId, id),
          eq(scoreConfigVersions.versionNo, body.pinsFromVersion)
        )
      );
    const snapshot = versionRows[0]?.snapshot as IntentConfigSnapshot | undefined;
    if (!snapshot) return NextResponse.json({ error: 'version_not_found' }, { status: 404 });
    rollbackPins = (snapshot.pins ?? []).filter((p) => p.intentId === intentId);
  }

  const result = await db.transaction(async (tx) => {
    const rows = await tx
      .update(scoreIntents)
      .set(set)
      .where(and(eq(scoreIntents.id, intentId), eq(scoreIntents.assignmentId, id)))
      .returning();
    if (rollbackPins !== null) {
      await tx.delete(scoreIntentPins).where(eq(scoreIntentPins.intentId, intentId));
      if (rollbackPins.length > 0) {
        // Snapshot pins are stored newest-first; stagger createdAt descending so
        // the restored recency order (and thus the prompt-pin selection and
        // defHash) reproduces the original spec byte-for-byte.
        const base = Date.now();
        await tx.insert(scoreIntentPins).values(
          rollbackPins.map((p, i) => ({
            assignmentId: id,
            intentId,
            messageId: p.messageId,
            verdict: p.verdict,
            queryText: p.queryText,
            source: p.source ?? 'manual',
            createdAt: new Date(base - i * 1000),
          }))
        );
      }
    }
    const versionNo =
      body.recordVersion === false
        ? null
        : await recordConfigVersion(tx, id, auth.instructor.id, summary);
    return { intent: rows[0], versionNo };
  });

  return NextResponse.json({
    intent: {
      id: result.intent.id,
      title: result.intent.title,
      definition: result.intent.definition,
      rule: result.intent.rule,
      archived: result.intent.archived,
      updatedAt: result.intent.updatedAt.toISOString(),
    },
    versionNo: result.versionNo,
  });
}

export async function DELETE(req: Request, { params }: RouteParams) {
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

  const existing = await loadIntent(id, intentId);
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Hard delete: irreversibly remove the intent and all rows referencing it.
  // No version is recorded — the intent is gone, so a snapshot pointing at it
  // would be meaningless. Children go first (FK: ratings/pins/links → intent).
  const mode = new URL(req.url).searchParams.get('mode');
  if (mode === 'purge') {
    const deleted = await db.transaction(async (tx) => {
      const ratings = (
        await tx
          .delete(scoreIntentRatings)
          .where(and(eq(scoreIntentRatings.assignmentId, id), eq(scoreIntentRatings.intentId, intentId)))
          .returning({ id: scoreIntentRatings.id })
      ).length;
      const pins = (
        await tx
          .delete(scoreIntentPins)
          .where(and(eq(scoreIntentPins.assignmentId, id), eq(scoreIntentPins.intentId, intentId)))
          .returning({ id: scoreIntentPins.id })
      ).length;
      const previews = (
        await tx
          .delete(scoreRulePreviews)
          .where(and(eq(scoreRulePreviews.assignmentId, id), eq(scoreRulePreviews.intentId, intentId)))
          .returning({ id: scoreRulePreviews.id })
      ).length;
      // Only versions SOLELY about this intent — shared entries (e.g. an
      // ownership decision touching two intents) keep the other intent's history.
      const versions = (
        await tx
          .delete(scoreConfigVersions)
          .where(
            and(
              eq(scoreConfigVersions.assignmentId, id),
              sql`${scoreConfigVersions.summary}->'intentIds' = ${JSON.stringify([intentId])}::jsonb`
            )
          )
          .returning({ id: scoreConfigVersions.id })
      ).length;
      await tx
        .delete(scoreIntents)
        .where(and(eq(scoreIntents.id, intentId), eq(scoreIntents.assignmentId, id)));
      return { ratings, pins, previews, versions };
    });
    return NextResponse.json({ purged: true, deleted });
  }

  if (existing.archived) return NextResponse.json({ versionNo: null, archived: true });

  const versionNo = await db.transaction(async (tx) => {
    await tx
      .update(scoreIntents)
      .set({ archived: true, updatedAt: new Date() })
      .where(and(eq(scoreIntents.id, intentId), eq(scoreIntents.assignmentId, id)));
    return recordConfigVersion(tx, id, auth.instructor.id, {
      action: 'archive_intent',
      intentIds: [intentId],
      detail: existing.title,
    });
  });

  return NextResponse.json({ versionNo, archived: true });
}
