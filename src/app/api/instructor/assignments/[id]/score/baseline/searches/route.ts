/**
 * Baseline saved custom searches.
 *   GET                 → { searches }
 *   POST { description } → { id, defHash }
 *   DELETE ?id=X         → { ok: true }
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeAssignment, authErrorResponse } from '@/lib/score/authz';
import { ensureStudyTables } from '@/lib/study/store';
import {
  createBaselineSearch,
  deleteBaselineSearch,
  listBaselineSearches,
  logStudyEvent,
} from '@/lib/study/baseline-store';

const createSchema = z.object({ description: z.string().min(1).max(2000) });

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorizeAssignment(id);
  if ('error' in auth) {
    const { body, status } = authErrorResponse(auth.error);
    return NextResponse.json(body, { status });
  }
  await ensureStudyTables();
  const searches = await listBaselineSearches(id);
  return NextResponse.json({
    searches: searches.map((s) => ({ id: s.id, description: s.description, defHash: s.defHash, lastRunAt: s.lastRunAt })),
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorizeAssignment(id);
  if ('error' in auth) {
    const { body, status } = authErrorResponse(auth.error);
    return NextResponse.json(body, { status });
  }
  await ensureStudyTables();
  try {
    const { description } = createSchema.parse(await request.json());
    const { id: searchId, defHash } = await createBaselineSearch(id, description.trim());
    await logStudyEvent(id, 'search_save', { searchId, defHash });
    return NextResponse.json({ id: searchId, defHash });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
    console.error('Search save error:', error);
    return NextResponse.json({ error: 'save_failed' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorizeAssignment(id);
  if ('error' in auth) {
    const { body, status } = authErrorResponse(auth.error);
    return NextResponse.json(body, { status });
  }
  await ensureStudyTables();
  const searchId = new URL(request.url).searchParams.get('id');
  if (!searchId) return NextResponse.json({ error: 'missing_id' }, { status: 400 });
  await deleteBaselineSearch(id, searchId);
  return NextResponse.json({ ok: true });
}
