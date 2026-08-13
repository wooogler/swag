/**
 * Isolate students by name, beside the ones a demo subtype sweeps in.
 *
 * Same rule as demo-subtype and the same reason (design §4 step 1): whatever the
 * tutorial shows is withheld from every set, whole-student, so nothing a
 * participant meets during training can reappear in their study material.
 * Choosing the students directly is the precise way to say it — a subtype takes
 * whoever happens to have asked it, which on SWAG was 50 of 507 questions.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { setDemoParticipants } from '@/lib/study/curation';
import { requireAdmin } from '@/lib/study/admin-guard';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  datasetKey: z.string().min(1),
  /** The full list, not a delta — the client owns the selection. */
  demoParticipants: z.array(z.string().min(1)),
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
    await setDemoParticipants(parsed.datasetKey, parsed.demoParticipants);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('curation demo-participants error:', err);
    return NextResponse.json({ error: 'save_failed' }, { status: 500 });
  }
}
