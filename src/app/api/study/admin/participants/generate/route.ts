/**
 * Freeze a participant's answers for a measurement phase.
 *
 * Timing follows the session, not convenience (design §5): block-test answers
 * right after that block's deploy, and the A/B answers split — block 1's clone
 * can be generated during the break (its deploy is final by then), block 2's
 * only after block 2 deploys. Generating both A/B halves at the end would put
 * 32 calls in front of the study's primary measure.
 */
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/db';
import { studyClones, studyParticipants } from '@/db/schema';
import { generateForClone } from '@/lib/study/generate';
import { STUDY_DATASETS } from '@/lib/study/config';
import { blockPlan } from '@/lib/study/phases';
import { requireAdmin } from '@/lib/study/admin-guard';

export const dynamic = 'force-dynamic';
export const maxDuration = 800;

const bodySchema = z.object({
  participantId: z.string().min(1),
  kind: z.enum(['test', 'ab']),
  /** Restrict to one block's clone (A/B is generated per block). */
  block: z.union([z.literal(1), z.literal(2)]).optional(),
  force: z.boolean().optional(),
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

  const [participant] = await db
    .select()
    .from(studyParticipants)
    .where(eq(studyParticipants.id, parsed.participantId));
  if (!participant) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const clones = await db
    .select()
    .from(studyClones)
    .where(eq(studyClones.participantId, participant.id));
  const plan = blockPlan(participant.participantNumber);
  const blockOf = (datasetKey: string) =>
    plan.find((p) => p.datasetKey === datasetKey)?.block ?? null;

  const targets = clones.filter((c) => !parsed.block || blockOf(c.datasetKey) === parsed.block);
  if (targets.length === 0) return NextResponse.json({ error: 'no_clones' }, { status: 404 });

  const reports = [];
  for (const clone of targets) {
    // Block test = this clone's own dataset. A/B = both datasets, which is how
    // a configuration comes to answer the other dataset's questions.
    const datasetKeys =
      parsed.kind === 'test' ? [clone.datasetKey] : STUDY_DATASETS.map((d) => d.key);
    for (const datasetKey of datasetKeys) {
      try {
        const report = await generateForClone({
          cloneAssignmentId: clone.assignmentId,
          datasetKey,
          kind: parsed.kind,
          force: parsed.force,
        });
        reports.push({ datasetKey, cloneDataset: clone.datasetKey, ...report });
      } catch (err) {
        reports.push({
          datasetKey,
          cloneDataset: clone.datasetKey,
          error: (err as Error).message,
        });
      }
    }
  }

  return NextResponse.json({ success: true, reports });
}
