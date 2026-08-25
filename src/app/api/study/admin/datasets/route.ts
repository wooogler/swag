/**
 * The dataset registry, from the researcher tools.
 *
 * One route for the whole small thing: list, make, point the study at a pair,
 * remove. Both admin screens use it — the curation board makes and lists them,
 * the session console decides which two the study is currently made of — so
 * splitting it per verb would only spread four queries over four files.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  activeStudyPair,
  createStudyDataset,
  deleteBlockers,
  deleteStudyDataset,
  listStudyDatasets,
  setStudyPair,
  sourceLogOptions,
} from '@/lib/study/datasets';
import { requireAdmin } from '@/lib/study/admin-guard';

export const dynamic = 'force-dynamic';

async function payload() {
  const [datasets, pair] = await Promise.all([listStudyDatasets(), activeStudyPair()]);
  return { datasets, pair: pair.map((d) => d.key), sources: sourceLogOptions() };
}

export async function GET() {
  const gate = await requireAdmin();
  if (gate.response) return gate.response;
  return NextResponse.json(await payload());
}

const createSchema = z.object({
  label: z.string().min(1).max(80),
  sourceKey: z.string().min(1),
  cloneTitle: z.string().max(120).default(''),
});

export async function POST(req: Request) {
  const gate = await requireAdmin();
  if (gate.response) return gate.response;

  let parsed: z.infer<typeof createSchema>;
  try {
    parsed = createSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  try {
    const dataset = await createStudyDataset(parsed, gate.actor.code);
    return NextResponse.json({ dataset, ...(await payload()) });
  } catch (err) {
    const message = (err as Error).message;
    // A name that slugifies to nothing, or a source that no longer exists —
    // both are the researcher's to fix, so they come back as 400 with the
    // reason rather than as a 500 they can only retry.
    const known = ['label_required', 'label_unusable', 'unknown_source', 'no_free_key'];
    if (known.includes(message)) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    console.error('dataset create error:', err);
    return NextResponse.json({ error: 'create_failed' }, { status: 500 });
  }
}

const pairSchema = z.object({
  block1: z.string().min(1),
  block2: z.string().min(1),
});

/** Point the study at a pair of datasets (block 1, block 2). */
export async function PATCH(req: Request) {
  const gate = await requireAdmin();
  if (gate.response) return gate.response;

  let parsed: z.infer<typeof pairSchema>;
  try {
    parsed = pairSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  try {
    await setStudyPair(parsed.block1, parsed.block2);
    return NextResponse.json(await payload());
  } catch (err) {
    const message = (err as Error).message;
    if (message === 'same_dataset') {
      return NextResponse.json(
        { error: 'same_dataset', message: 'The two blocks have to be different datasets.' },
        { status: 400 }
      );
    }
    if (message.startsWith('unknown curation dataset')) {
      return NextResponse.json({ error: 'unknown_dataset' }, { status: 404 });
    }
    console.error('dataset pair error:', err);
    return NextResponse.json({ error: 'pair_failed' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const gate = await requireAdmin();
  if (gate.response) return gate.response;

  const key = new URL(req.url).searchParams.get('key');
  if (!key) return NextResponse.json({ error: 'no_key' }, { status: 400 });

  // Checked before the attempt so the refusal can NAME what stands in the way
  // — "participants hold clones of it" is a thing to go and undo; a failed
  // delete is not.
  const blockers = await deleteBlockers(key);
  if (blockers.length > 0) {
    return NextResponse.json({ error: 'blocked', blockers }, { status: 409 });
  }
  try {
    await deleteStudyDataset(key);
    return NextResponse.json(await payload());
  } catch (err) {
    return NextResponse.json({ error: 'delete_failed', message: (err as Error).message }, { status: 409 });
  }
}
