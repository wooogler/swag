/**
 * SCORE v6 — intent collection for one assignment.
 *
 * GET  → current intent state (intents + pins + links + version number).
 * POST → create an intent. Immediate-apply versioning: the create and its
 *        config snapshot commit in one transaction (§1.11).
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/db/db';
import { scoreIntents } from '@/db/schema';
import { authorizeAssignment, authErrorResponse } from '@/lib/score/authz';
import { isOpenAIConfigured } from '@/lib/score/classifier';
import { generateIntentTitle } from '@/lib/score/intent-agent';
import {
  ensureIntentTables,
  loadIntentState,
  recordConfigVersion,
} from '@/lib/score/intent-store';

export const dynamic = 'force-dynamic';

const createSchema = z.object({
  title: z.string().trim().max(120).optional(),
  definition: z.string().trim().min(1).max(4000),
  rule: z.string().trim().max(8000).optional(),
  // Auto-generate the title from the definition (git-commit style).
  autoTitle: z.boolean().optional(),
  // false → create WITHOUT a version entry (the modal's Apply; history only
  // records explicit Saves). Default true keeps other callers versioned.
  recordVersion: z.boolean().optional(),
  // true → create as an unregistered DRAFT (discovery): rated and explorable in
  // the modal, but not owning the log until a Save flips it live.
  isTemplate: z.boolean().optional(),
  // Save-time counts from the modal, recorded on the version for history.
  stats: z
    .object({
      included: z.number().int().min(0),
      excluded: z.number().int().min(0),
      inCount: z.number().int().min(0),
    })
    .optional(),
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
    links: state.links.map((l) => ({ fromIntentId: l.fromIntentId, toIntentId: l.toIntentId })),
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
  // Title: explicit > LLM auto-title (git-commit style, best-effort) >
  // definition-head fallback.
  let title = body.title && body.title.length > 0 ? body.title : null;
  if (!title && body.autoTitle !== false && isOpenAIConfigured()) {
    title = await generateIntentTitle(body.definition);
  }
  if (!title) {
    title = body.definition.length > 60 ? `${body.definition.slice(0, 57)}…` : body.definition;
  }

  const created = await db.transaction(async (tx) => {
    const rows = await tx
      .insert(scoreIntents)
      .values({
        assignmentId: id,
        title,
        definition: body.definition,
        rule: body.rule && body.rule.length > 0 ? body.rule : null,
        archived: false,
        isTemplate: body.isTemplate ?? false,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const intent = rows[0];
    const versionNo =
      body.recordVersion === false
        ? null
        : await recordConfigVersion(tx, id, auth.instructor.id, {
            action: 'create_intent',
            intentIds: [intent.id],
            detail: title,
            stats: body.stats,
          });
    return { intent, versionNo };
  });

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
