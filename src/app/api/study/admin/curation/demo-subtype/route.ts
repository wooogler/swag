/**
 * Set the isolated demo subtypes for a dataset.
 *
 * Design §4 step 1: whatever the tutorial video shows is withheld from every
 * set in BOTH datasets, whole-student, so nothing a participant is shown during
 * training can reappear in their study material. A demo may cover several
 * subtypes, so this takes the whole list and isolates their union.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { setDemoSubtypes } from '@/lib/study/curation';
import { requireAdmin } from '@/lib/study/admin-guard';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  datasetKey: z.string().min(1),
  /** The full list, not a delta — the client owns the selection. */
  demoSubtypes: z.array(z.string().min(1)),
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
    await setDemoSubtypes(parsed.datasetKey, parsed.demoSubtypes);
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('isolation_conflict')) {
      const n = err.message.split(':')[1] ?? '?';
      return NextResponse.json(
        {
          error: 'isolation_conflict',
          message: `${n} question(s) already in a set belong to those students — unlock and clear them first, or pick different subtypes.`,
        },
        { status: 409 }
      );
    }
    if (err instanceof Error && err.message === 'curation_locked') {
      return NextResponse.json(
        { error: 'locked', message: 'These sets are confirmed — unlock before editing.' },
        { status: 409 }
      );
    }
    console.error('demo subtype error:', err);
    return NextResponse.json({ error: 'update_failed' }, { status: 500 });
  }
}
