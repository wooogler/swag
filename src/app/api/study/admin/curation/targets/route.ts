/**
 * Set sizes, as a setting rather than a constant.
 *
 * The design leaves review-set size and A/B item count to the pilot, and a
 * pilot that needs a redeploy to try 12 instead of 16 will simply not try it.
 * Refused while a dataset is confirmed — see saveSetTargets.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSetTargets, saveSetTargets } from '@/lib/study/curation';
import { SET_TARGET_LIMITS } from '@/lib/study/config';
import { requireAdmin } from '@/lib/study/admin-guard';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  review: z.number().int().optional(),
  test: z.number().int().optional(),
  ab: z.number().int().optional(),
});

export async function GET() {
  const gate = await requireAdmin();
  if (gate.response) return gate.response;
  return NextResponse.json({ targets: await getSetTargets(), limits: SET_TARGET_LIMITS });
}

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
    const targets = await saveSetTargets(parsed, gate.actor.code);
    return NextResponse.json({ success: true, targets });
  } catch (err) {
    if (err instanceof Error && err.message === 'curation_locked') {
      return NextResponse.json(
        {
          error: 'locked',
          message: 'A dataset is confirmed — unlock it before changing the sizes.',
        },
        { status: 409 }
      );
    }
    console.error('set targets error:', err);
    return NextResponse.json({ error: 'save_failed' }, { status: 500 });
  }
}
