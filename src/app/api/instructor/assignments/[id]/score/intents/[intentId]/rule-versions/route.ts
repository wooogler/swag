/**
 * SCORE v6 — per-intent RULE version history (Revise modal).
 *
 * DELIBERATELY SEPARATE from the intent config-version timeline
 * (scoreConfigVersions / the Intent modal history): rule edits are their own
 * axis, so a rule Save never shows up as an intent version and vice-versa.
 *
 * GET  → this intent's rule versions, newest first (each with the rule text and
 *        the anchor's Updated Response captured with it, so a version retrieves
 *        with its preview and needs no regeneration). Numbered like the intent
 *        history: majors v1, v2, …; minors v{major}.{k}.
 * POST → record a version. MAJOR (Save) also reflects the rule onto the live
 *        intent in one step; MINOR (a simulated preview — feedback / direct
 *        edit / rewrite) only records, so simulations are checkout-able and
 *        revertible without touching what students get. No config version is
 *        recorded either way (rules are their own axis).
 */
import { NextResponse } from 'next/server';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/db';
import { scoreIntents, scoreRuleVersionResponses, scoreRuleVersions } from '@/db/schema';
import { authorizeAssignment, authErrorResponse } from '@/lib/score/authz';
import { isOpenAIConfigured } from '@/lib/score/classifier';
import { generateIntentTitle } from '@/lib/score/intent-agent';
import { ensureIntentTables } from '@/lib/score/intent-store';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Numbering needs every row (a slice would misnumber the majors) and the
// workbench accordion keeps long lists compact.
const LIMIT = 200;

const bodySchema = z.object({
  // null = "no rule" (base prompt only), same convention as the intent PATCH.
  rule: z.string().trim().max(8000).nullable(),
  updatedResponse: z.string().max(20000).nullable().optional(),
  // 'seed' = the auto-created v1 baseline (current rule / base-prompt
  // fallback) — a real major for numbering and revert, but NOT a deployable
  // artifact: it must not touch the live rule or feed the board's viewer.
  source: z.enum(['direct', 'feedback', 'rewrite', 'manual', 'seed']),
  // Short label naming the rule. The agent supplies it for feedback/rewrite; a
  // direct edit has none → we auto-title from the rule below.
  name: z.string().trim().max(120).optional(),
  note: z.string().trim().max(2000).optional(),
  anchorMessageId: z.number().int().positive().optional(),
  // MINOR = a simulated preview, not a Save: recorded for checkout/revert but
  // does NOT touch the live intent rule or the per-version response store.
  minor: z.boolean().optional(),
});

/** A never-fail short label: the agent/instructor name, else an auto-title, else
 * a head-of-rule fallback (mirrors the intent auto-title's fallback behavior). */
async function resolveName(name: string | undefined, rule: string | null): Promise<string> {
  if (name && name.trim()) return name.trim();
  if (rule && isOpenAIConfigured()) {
    const generated = await generateIntentTitle(rule);
    if (generated) return generated;
  }
  if (!rule) return 'No rule';
  const head = rule.replace(/\s+/g, ' ').trim().split(' ').slice(0, 5).join(' ');
  return head || 'Rule';
}

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
  // ?messageId= → also attach each version's stored response FOR THAT MESSAGE
  // (from "apply to intent" runs; the anchor's Save-time preview is the
  // fallback). Powers the viewer's version dropdown.
  const messageId = Number.parseInt(new URL(_req.url).searchParams.get('messageId') ?? '', 10);
  const [rows, responseRows] = await Promise.all([
    db
      .select()
      .from(scoreRuleVersions)
      .where(and(eq(scoreRuleVersions.assignmentId, id), eq(scoreRuleVersions.intentId, intentId)))
      .orderBy(desc(scoreRuleVersions.versionNo))
      .limit(LIMIT),
    Number.isFinite(messageId)
      ? db
          .select()
          .from(scoreRuleVersionResponses)
          .where(
            and(
              eq(scoreRuleVersionResponses.intentId, intentId),
              eq(scoreRuleVersionResponses.messageId, messageId)
            )
          )
      : Promise.resolve([]),
  ]);
  const responseByVersionId = new Map(responseRows.map((r) => [r.ruleVersionId, r.response]));

  // Display numbering (ascending walk, like the intent history): majors count
  // this intent's rule v1, v2, …; each minor gets {preceding major}.{k}.
  let majorNo = 0;
  let minorNo = 0;
  const numbered = new Map<number, { major: number; minorNo: number | null }>();
  for (const r of [...rows].reverse()) {
    if (r.minor) {
      minorNo += 1;
      numbered.set(r.id, { major: majorNo, minorNo });
    } else {
      majorNo += 1;
      minorNo = 0;
      numbered.set(r.id, { major: majorNo, minorNo: null });
    }
  }

  return NextResponse.json({
    versions: rows.map((r) => ({
      id: r.id,
      versionNo: r.versionNo,
      name: r.name,
      rule: r.rule,
      updatedResponse: r.updatedResponse,
      anchorMessageId: r.anchorMessageId,
      source: r.source,
      note: r.note,
      minor: r.minor,
      major: numbered.get(r.id)?.major ?? 0,
      minorNo: numbered.get(r.id)?.minorNo ?? null,
      createdAt: r.createdAt.toISOString(),
      ...(Number.isFinite(messageId)
        ? {
            response:
              responseByVersionId.get(r.id) ??
              (r.anchorMessageId === messageId ? r.updatedResponse : null),
          }
        : {}),
    })),
  });
}

export async function POST(req: Request, { params }: RouteParams) {
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
  const existing = await db
    .select()
    .from(scoreIntents)
    .where(and(eq(scoreIntents.id, intentId), eq(scoreIntents.assignmentId, id)));
  const intent = existing[0];
  if (!intent || intent.archived) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const rule = body.rule && body.rule.length > 0 ? body.rule : null;
  const name = await resolveName(body.name, rule);

  const insertOnce = () =>
    db.transaction(async (tx) => {
      const [{ max }] = await tx
        .select({ max: sql<number | null>`max(${scoreRuleVersions.versionNo})` })
        .from(scoreRuleVersions)
        .where(eq(scoreRuleVersions.intentId, intentId));
      const versionNo = (max ?? 0) + 1;
      const now = new Date();
      const [row] = await tx
        .insert(scoreRuleVersions)
        .values({
          assignmentId: id,
          intentId,
          versionNo,
          name,
          rule,
          updatedResponse: body.updatedResponse ?? null,
          anchorMessageId: body.anchorMessageId ?? null,
          source: body.source,
          note: body.note ?? null,
          minor: body.minor ?? false,
          createdBy: auth.instructor.id,
          createdAt: now,
        })
        .returning();
      // MAJORS only: Save reflects to the LIVE intent rule (no config version),
      // and the anchor's preview doubles as its per-version response so the
      // board chip/dropdown pick it up without an "apply" run. Minors are
      // simulations, and the v1 seed is just the baseline snapshot — neither
      // may touch what students get or what the viewer lists.
      if (!body.minor && body.source !== 'seed') {
        await tx
          .update(scoreIntents)
          .set({ rule, updatedAt: now })
          .where(and(eq(scoreIntents.id, intentId), eq(scoreIntents.assignmentId, id)));
        if (body.updatedResponse && body.anchorMessageId) {
          await tx.insert(scoreRuleVersionResponses).values({
            assignmentId: id,
            intentId,
            ruleVersionId: row.id,
            versionNo: row.versionNo,
            messageId: body.anchorMessageId,
            response: body.updatedResponse,
            createdAt: now,
          });
        }
      }
      return row;
    });

  let row;
  try {
    row = await insertOnce();
  } catch (error) {
    // max+1 can collide under concurrent Saves — the unique (intent, version)
    // index rejects the loser; one recompute-and-retry resolves it.
    if (typeof error === 'object' && error && (error as { code?: string }).code === '23505') {
      row = await insertOnce();
    } else {
      console.error(`SCORE rule-version save failed for intent ${intentId}:`, error);
      return NextResponse.json(
        { error: 'save_failed', message: 'Failed to save the rule version.' },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({
    version: {
      id: row.id,
      versionNo: row.versionNo,
      name: row.name,
      rule: row.rule,
      updatedResponse: row.updatedResponse,
      anchorMessageId: row.anchorMessageId,
      source: row.source,
      note: row.note,
      minor: row.minor,
      createdAt: row.createdAt.toISOString(),
    },
  });
}
