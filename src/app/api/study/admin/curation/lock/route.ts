/**
 * Confirm (lock) or reopen a dataset's curated sets.
 *
 * Locking is the gate the M6 build scripts read: only a locked dataset can be
 * built into a study master, so a half-assembled set cannot silently become the
 * study material. Locking re-runs validation server-side — the client's green
 * chips are a convenience, not the authority.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurationState, setLock, validateCuration } from '@/lib/study/curation';
import { requireAdmin } from '@/lib/study/admin-guard';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  datasetKey: z.string().min(1),
  locked: z.boolean(),
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
    if (parsed.locked) {
      const state = await getCurationState(parsed.datasetKey);
      const blocking = validateCuration(state).filter((v) => v.severity === 'error');
      if (blocking.length > 0) {
        return NextResponse.json(
          { error: 'validation_failed', violations: blocking },
          { status: 409 }
        );
      }
    }
    await setLock(parsed.datasetKey, parsed.locked ? gate.actor.code : null, parsed.locked);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('curation lock error:', err);
    return NextResponse.json({ error: 'lock_failed' }, { status: 500 });
  }
}
