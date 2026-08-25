/**
 * Turn the confirmed sets into the study material, from the curation tool.
 *
 * Deliberately NOT folded into the lock route. Locking is a reversible
 * editorial decision that must always succeed; building replaces a master and
 * can refuse (clones still hold the old one, answers already exist against the
 * bank). Tying the two together would mean a lock that fails because a build
 * did.
 *
 * Long-running: the master build copies a dataset's whole message log.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { buildQuestionBank, buildStudyMasters } from '@/lib/study/build';
import { requireAdmin } from '@/lib/study/admin-guard';

export const dynamic = 'force-dynamic';
export const maxDuration = 800;

const bodySchema = z.object({
  /** false → report what WOULD happen and write nothing. */
  apply: z.boolean().default(false),
  /**
   * Which dataset to build. Both halves take it: the bank used to be built from
   * every dataset at once, which with a registry means one dataset's rebuild
   * blocked on another's unfinished curation — and deleted its frozen
   * questions. Omitted = the pair the study is currently made of.
   */
  datasetKey: z.string().min(1).optional(),
});

export async function POST(req: Request) {
  const gate = await requireAdmin();
  if (gate.response) return gate.response;

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await req.json().catch(() => ({})));
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  try {
    const masters = await buildStudyMasters({
      apply: parsed.apply,
      datasetKey: parsed.datasetKey,
    });
    // The bank is built even when a master was blocked: they fail for separate
    // reasons, and a researcher fixing one wants to see the state of the other
    // rather than discovering it on the next click.
    const bank = await buildQuestionBank({
      apply: parsed.apply,
      datasetKey: parsed.datasetKey,
    });

    return NextResponse.json({
      success: true,
      applied: parsed.apply,
      masters,
      bank,
    });
  } catch (err) {
    console.error('curation build error:', err);
    return NextResponse.json(
      { error: 'build_failed', message: (err as Error).message },
      { status: 500 }
    );
  }
}
