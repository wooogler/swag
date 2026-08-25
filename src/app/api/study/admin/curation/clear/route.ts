/**
 * Empty one curated set, or one type's slot inside it.
 *
 * Two-step by design. GET counts what would go; DELETE actually removes it and
 * reports what it took. Hand-assigned members are the one thing on the curation
 * screen that cannot be recomputed, so a single stray click must not be able to
 * discard an afternoon of reading.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { clearSet } from '@/lib/study/curation';
import { CURATION_SET_KINDS } from '@/lib/study/config';
import { SCORE_QUERY_TYPES } from '@/lib/score/intents';
import { requireAdmin } from '@/lib/study/admin-guard';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  datasetKey: z.string().min(1),
  setKind: z.enum(CURATION_SET_KINDS as unknown as [string, ...string[]]),
  queryType: z.enum(SCORE_QUERY_TYPES as unknown as [string, ...string[]]).nullable().optional(),
});

export async function DELETE(req: Request) {
  const gate = await requireAdmin();
  if (gate.response) return gate.response;

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  try {
    const result = await clearSet(
      parsed.datasetKey,
      parsed.setKind as never,
      (parsed.queryType ?? null) as never
    );
    return NextResponse.json({ success: true, removed: result.removed.length, items: result.removed });
  } catch (err) {
    if (err instanceof Error && err.message === 'curation_locked') {
      return NextResponse.json(
        { error: 'locked', message: 'These sets are confirmed — unlock before editing.' },
        { status: 409 }
      );
    }
    console.error('curation clear error:', err);
    return NextResponse.json({ error: 'clear_failed' }, { status: 500 });
  }
}
