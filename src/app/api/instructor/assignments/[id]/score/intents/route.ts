/**
 * SCORE v6 — intent collection for one assignment.
 *
 * GET  → current intent state (intents + pins + links + version number).
 * POST → create an intent. Immediate-apply versioning: the create and its
 *        config snapshot commit in one transaction (§1.11).
 *        With `fromTemplateId`, the create is a CLONE of a starter-set
 *        template: spec copied from the template AND its rating rows copied to
 *        the new id, so the clone is instantly fresh (defHash is definition-
 *        keyed and templates carry no pins). The template itself is never
 *        mutated — the library keeps its prepared set forever.
 */
import { NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/db';
import { scoreIntentRatings, scoreIntents, scoreRuleVersions } from '@/db/schema';
import { assignmentBasePrompt } from '@/lib/assignment-ai';
import { authorizeAssignment, authErrorResponse } from '@/lib/score/authz';
import { isOpenAIConfigured } from '@/lib/score/classifier';
import { generateIntentTitle } from '@/lib/score/intent-agent';
import { SCORE_QUERY_TYPES, seedRuleVersionName } from '@/lib/score/intents';
import {
  ensureIntentTables,
  loadIntentState,
  recordConfigVersion,
} from '@/lib/score/intent-store';
import { logStudyEvent } from '@/lib/study/events';

export const dynamic = 'force-dynamic';

const createSchema = z
  .object({
    title: z.string().trim().max(120).optional(),
    definition: z.string().trim().min(1).max(4000).optional(),
    rule: z.string().trim().max(8000).optional(),
    // Auto-generate the title from the definition (git-commit style).
    autoTitle: z.boolean().optional(),
    // false → create WITHOUT a version entry (e.g. template clones). Default
    // true keeps other callers versioned.
    recordVersion: z.boolean().optional(),
    // Record as a MINOR version (an Apply — revertible but not a Save; the
    // history accordion folds these under their preceding major).
    minorVersion: z.boolean().optional(),
    // true → create as an unregistered DRAFT (discovery): rated and explorable in
    // the modal, but not owning the log until a Save flips it live.
    isTemplate: z.boolean().optional(),
    // Clone this starter-set template: spec + rating rows copied to the new
    // intent, the template row untouched. definition defaults to the template's
    // own when omitted; rule to the template's own, else the assignment default.
    fromTemplateId: z.number().int().positive().optional(),
    // v7 placement: which query type the set lives in, and the set it is
    // carved out of (null/omitted = directly under the type root). Decided by
    // WHERE creation was invoked from, not by a picker.
    type: z.enum(SCORE_QUERY_TYPES).optional(),
    parentIntentId: z.number().int().positive().nullable().optional(),
    // Save-time counts from the modal, recorded on the version for history.
    stats: z
      .object({
        included: z.number().int().min(0),
        excluded: z.number().int().min(0),
        inCount: z.number().int().min(0),
      })
      .optional(),
  })
  .refine((b) => b.definition !== undefined || b.fromTemplateId !== undefined, {
    message: 'definition is required unless cloning a template',
  });

function serializeState(state: Awaited<ReturnType<typeof loadIntentState>>) {
  return {
    intents: state.intents.map((i) => ({
      id: i.id,
      title: i.title,
      definition: i.definition,
      rule: i.rule,
      archived: i.archived,
      pinCount: state.pins.filter((p) => p.intentId === i.id).length,
      updatedAt: i.updatedAt.toISOString(),
    })),
    versionNo: state.versionNo,
  };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorizeAssignment(id);
  if ('error' in auth) {
    const { body, status } = authErrorResponse(auth.error);
    return NextResponse.json(body, { status });
  }

  const state = await loadIntentState(id);
  return NextResponse.json(serializeState(state));
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorizeAssignment(id);
  if ('error' in auth) {
    const { body, status } = authErrorResponse(auth.error);
    return NextResponse.json(body, { status });
  }

  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(await req.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'invalid_input', details: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  await ensureIntentTables();
  const now = new Date();

  // Clone source: an assignment-scoped template. Its spec fills any omitted
  // fields, and its rating rows are copied below so the clone lands fresh.
  let template: typeof scoreIntents.$inferSelect | null = null;
  if (body.fromTemplateId !== undefined) {
    const tplRows = await db
      .select()
      .from(scoreIntents)
      .where(
        and(
          eq(scoreIntents.id, body.fromTemplateId),
          eq(scoreIntents.assignmentId, id),
          eq(scoreIntents.isTemplate, true)
        )
      );
    template = tplRows[0] ?? null;
    if (!template) {
      return NextResponse.json({ error: 'template_not_found' }, { status: 404 });
    }
    // ONE live intent per starter set. The board already drops an added set
    // from the library, but that is client state: a stale tab, a double click
    // through a slow refresh, or a back-button replay could still fire this
    // twice, and two intents sharing a definition rate clearly_in for the same
    // questions — the resolver then sees two claims on every one of them and
    // assigns neither, so BOTH read 0. Archived twins don't count (re-adding a
    // retired set is legitimate), and neither does a DRAFT copy (isTemplate:
    // the workbench explores a starter without registering it).
    if (body.isTemplate !== true) {
      const twins = await db
        .select({ id: scoreIntents.id })
        .from(scoreIntents)
        .where(
          and(
            eq(scoreIntents.assignmentId, id),
            eq(scoreIntents.isTemplate, false),
            eq(scoreIntents.archived, false),
            eq(scoreIntents.definition, template.definition)
          )
        );
      if (twins.length > 0) {
        return NextResponse.json(
          { error: 'already_active', intentId: twins[0].id, message: 'That starter set is already a live intent.' },
          { status: 409 }
        );
      }
    }
  }

  const definition = body.definition ?? template?.definition;
  if (!definition) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  // A rule is the COMPLETE system prompt for its intent (injection.ts: one
  // layer, never two), so a brand-new intent starts from the assignment's
  // default prompt rather than from nothing. Explicit rule > the template's own
  // > that default. NIRVANA's default is empty, so its intents still start
  // rule-less and the chatbot answers with no system prompt — unchanged.
  // v7 copy-on-create: a new set starts from the rule of the set that ENCLOSES
  // it — the nearest ancestor that actually has one, ultimately the type root
  // (§3.5). The instructor then edits only what should differ. This is a COPY,
  // not live inheritance: editing the parent later never rewrites a child.
  let enclosingRule: string | null = null;
  if (body.type) {
    const rows = await db
      .select()
      .from(scoreIntents)
      .where(and(eq(scoreIntents.assignmentId, id), eq(scoreIntents.type, body.type)));
    const byId = new Map(rows.map((r) => [r.id, r]));
    let cursor = body.parentIntentId ?? null;
    for (let guard = 0; guard < 100; guard++) {
      const node = cursor === null ? null : byId.get(cursor);
      if (!node) break;
      if (node.rule?.trim()) {
        enclosingRule = node.rule;
        break;
      }
      cursor = node.parentIntentId;
    }
    if (enclosingRule === null) {
      const root = rows.find((r) => r.kind === 'type_root');
      if (root?.rule?.trim()) enclosingRule = root.rule;
    }
  }
  const rule =
    body.rule !== undefined
      ? body.rule
      : template?.rule ?? enclosingRule ?? assignmentBasePrompt(auth.assignment);

  // Title: explicit > template's own > LLM auto-title (git-commit style,
  // best-effort) > definition-head fallback.
  let title = body.title && body.title.length > 0 ? body.title : template?.title ?? null;
  if (!title && body.autoTitle !== false && isOpenAIConfigured()) {
    title = await generateIntentTitle(definition);
  }
  if (!title) {
    title = definition.length > 60 ? `${definition.slice(0, 57)}…` : definition;
  }

  const created = await db.transaction(async (tx) => {
    const rows = await tx
      .insert(scoreIntents)
      .values({
        assignmentId: id,
        title,
        definition,
        rule: rule && rule.trim().length > 0 ? rule : null,
        archived: false,
        isTemplate: body.isTemplate ?? false,
        // Untyped when the caller gives no placement (starter-template
        // preparation): such a row is judged whole-log and sits in no chain
        // until it is typed.
        type: body.type ?? null,
        parentIntentId: body.type ? body.parentIntentId ?? null : null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const intent = rows[0];
    // v1 on the RULE axis, recorded up front: an intent is born holding a rule
    // (the assignment default), so the board can show "Then v1 Starting rule"
    // from the first render instead of dumping the raw text, and the Revise
    // history opens on a real v1. source:'seed' = not a Save — it must
    // never re-apply to the live rule (which already holds exactly this text)
    // and carries no anchor response: the workbench serves every question's
    // DELIVERED original under a seed version.
    await tx.insert(scoreRuleVersions).values({
      assignmentId: id,
      intentId: intent.id,
      versionNo: 1,
      name: seedRuleVersionName(intent.rule),
      rule: intent.rule,
      updatedResponse: null,
      anchorMessageId: null,
      source: 'seed',
      note: null,
      minor: false,
      createdBy: auth.instructor.id,
      createdAt: now,
    });
    if (template) {
      // Copy the template's rating rows (all hashes — the unique index keys on
      // (message, intent, hash), so history rides along). Cloning only when the
      // definition is unchanged keeps the copied current-hash rows fresh; a
      // caller that overrides the definition just gets stale rows and re-rates.
      await tx.execute(sql`
        INSERT INTO "score_intent_ratings"
          ("assignment_id", "message_id", "intent_id", "rating", "rationale", "def_hash", "raw_response", "model", "rated_at")
        SELECT "assignment_id", "message_id", ${intent.id}, "rating", "rationale", "def_hash", "raw_response", "model", "rated_at"
        FROM ${scoreIntentRatings}
        WHERE "assignment_id" = ${id} AND "intent_id" = ${template.id}
      `);
    }
    const versionNo =
      body.recordVersion === false
        ? null
        : await recordConfigVersion(tx, id, auth.instructor.id, {
            action: 'create_intent',
            intentIds: [intent.id],
            detail: title,
            ...(body.minorVersion ? { minor: true } : {}),
            stats: body.stats,
          });
    return { intent, versionNo };
  });

  await logStudyEvent(id, 'intent_create', { condition: 'score', intentId: created.intent.id });

  return NextResponse.json(
    {
      intent: {
        id: created.intent.id,
        title: created.intent.title,
        definition: created.intent.definition,
        rule: created.intent.rule,
        archived: created.intent.archived,
        pinCount: 0,
        updatedAt: created.intent.updatedAt.toISOString(),
      },
      versionNo: created.versionNo,
    },
    { status: 201 }
  );
}
