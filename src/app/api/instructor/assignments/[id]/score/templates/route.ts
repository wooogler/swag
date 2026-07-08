/**
 * SCORE v6 — starter-set templates.
 *
 * POST → ensure a PRE-BUILT template intent exists for each supplied
 * {title, definition} (deduped by definition). Templates are `is_template=true`:
 * they get rated in advance (the client then runs the rate pipeline scoped to
 * their ids) but never own the log until activated. No config version is
 * recorded — templates aren't part of the versioned narrative until a PATCH
 * flips is_template=false. Returns every template intent's id so the client can
 * scope the rate run and match them to the taxonomy.
 */
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/db';
import { scoreIntents } from '@/db/schema';
import { authorizeAssignment, authErrorResponse } from '@/lib/score/authz';
import { ensureIntentTables } from '@/lib/score/intent-store';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  templates: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(120),
        definition: z.string().trim().min(1).max(4000),
      })
    )
    .max(200),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorizeAssignment(id);
  if ('error' in auth) {
    const { body, status } = authErrorResponse(auth.error);
    return NextResponse.json(body, { status });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'invalid_input', details: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  await ensureIntentTables();
  const now = new Date();

  const templates = await db.transaction(async (tx) => {
    const existing = await tx
      .select({ definition: scoreIntents.definition })
      .from(scoreIntents)
      .where(eq(scoreIntents.assignmentId, id));
    const have = new Set(existing.map((r) => r.definition.trim()));
    const toCreate = body.templates.filter((t) => !have.has(t.definition.trim()));
    if (toCreate.length > 0) {
      await tx.insert(scoreIntents).values(
        toCreate.map((t) => ({
          assignmentId: id,
          title: t.title,
          definition: t.definition,
          rule: null,
          archived: false,
          isTemplate: true,
          createdAt: now,
          updatedAt: now,
        }))
      );
    }
    // Return every template intent (existing + just-created) for this assignment.
    return tx
      .select({ id: scoreIntents.id, title: scoreIntents.title, definition: scoreIntents.definition })
      .from(scoreIntents)
      .where(and(eq(scoreIntents.assignmentId, id), eq(scoreIntents.isTemplate, true)));
  });

  return NextResponse.json({ templates });
}
