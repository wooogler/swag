/**
 * Pick (or clear) the isolated demo subtype for a dataset.
 *
 * Design §4 step 1: the subtype used in the tutorial video is withheld from
 * every set in BOTH datasets, whole-student, so nothing a participant is shown
 * during training can reappear in their study material.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { setDemoSubtype } from '@/lib/study/curation';
import { requireAdmin } from '@/lib/study/admin-guard';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  datasetKey: z.string().min(1),
  demoSubtype: z.string().min(1).nullable(),
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
    await setDemoSubtype(parsed.datasetKey, parsed.demoSubtype);
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'curation_locked') {
      return NextResponse.json(
        { error: 'locked', message: '확정된 세트입니다 — 잠금을 해제한 뒤 수정하세요.' },
        { status: 409 }
      );
    }
    console.error('demo subtype error:', err);
    return NextResponse.json({ error: 'update_failed' }, { status: 500 });
  }
}
