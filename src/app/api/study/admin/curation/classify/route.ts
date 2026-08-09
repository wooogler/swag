/** Top up missing 4-type verdicts on a master (idempotent; zero calls if none). */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { classifyMissingTypes } from '@/lib/study/curation';
import { requireAdmin } from '@/lib/study/admin-guard';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const bodySchema = z.object({
  datasetKey: z.string().min(1),
  limit: z.number().int().positive().max(500).optional(),
});

export async function POST(req: Request) {
  const gate = await requireAdmin();
  if (gate.response) return gate.response;

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  try {
    const result = await classifyMissingTypes(parsed.datasetKey, parsed.limit);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    if (err instanceof Error && err.message === 'openai_not_configured') {
      return NextResponse.json({ error: 'openai_not_configured' }, { status: 503 });
    }
    console.error('curation classify error:', err);
    return NextResponse.json({ error: 'classify_failed' }, { status: 500 });
  }
}
