/**
 * Baseline saved filters ("searches" in tables/events, "Filters" in the UI).
 *   GET                                    → { searches } incl. cached clearly-in ids
 *   POST { description, name?, type?, id? } → { id, defHash } — `id` edits in place
 *   DELETE ?id=X                            → { ok: true }
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeAssignment, authErrorResponse } from '@/lib/score/authz';
import { refuseSimpleClone } from '@/lib/study/simple/route-context';
import { SCORE_QUERY_TYPES } from '@/lib/score/intents';
import { ensureStudyTables } from '@/lib/study/store';
import {
  deleteBaselineSearch,
  listBaselineSearches,
  logStudyEvent,
  saveBaselineSearch,
} from '@/lib/study/baseline-store';

const createSchema = z.object({
  description: z.string().min(1).max(2000),
  /** Optional label from the create chooser's Name box — falls back to the
   * description prefix in the list when absent. */
  name: z.string().max(200).optional(),
  /** The query type the filter lives under (groups it in the left column and
   * scopes its displayed results). Absent only on legacy rows. */
  type: z.enum(SCORE_QUERY_TYPES).optional(),
  /** Present when an already-saved filter is being re-saved: edit that row
   * instead of adding a near-duplicate next to it. */
  id: z.string().min(1).max(64).optional(),
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorizeAssignment(id);
  if ('error' in auth) {
    const { body, status } = authErrorResponse(auth.error);
    return NextResponse.json(body, { status });
  }
  // Not on a simple clone: that version has none of this, and letting it
  // through would write a second, disagreeing answer to "what is this
  // participant's configuration" (lib/study/simple/route-context).
  const wrongVersion = await refuseSimpleClone(id);
  if (wrongVersion) return wrongVersion;
  await ensureStudyTables();
  const searches = await listBaselineSearches(id);
  return NextResponse.json({
    searches: searches.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type,
      description: s.description,
      defHash: s.defHash,
      lastRunAt: s.lastRunAt,
      clearlyInIds: s.clearlyInIds,
    })),
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorizeAssignment(id);
  if ('error' in auth) {
    const { body, status } = authErrorResponse(auth.error);
    return NextResponse.json(body, { status });
  }
  // Not on a simple clone: that version has none of this, and letting it
  // through would write a second, disagreeing answer to "what is this
  // participant's configuration" (lib/study/simple/route-context).
  const wrongVersion = await refuseSimpleClone(id);
  if (wrongVersion) return wrongVersion;
  await ensureStudyTables();
  try {
    const parsed = createSchema.parse(await request.json());
    const { id: searchId, defHash } = await saveBaselineSearch(id, {
      id: parsed.id,
      description: parsed.description.trim(),
      name: parsed.name,
      type: parsed.type,
    });
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
  // Not on a simple clone: that version has none of this, and letting it
  // through would write a second, disagreeing answer to "what is this
  // participant's configuration" (lib/study/simple/route-context).
  const wrongVersion = await refuseSimpleClone(id);
  if (wrongVersion) return wrongVersion;
  await ensureStudyTables();
  const searchId = new URL(request.url).searchParams.get('id');
  if (!searchId) return NextResponse.json({ error: 'missing_id' }, { status: 400 });
  await deleteBaselineSearch(id, searchId);
  return NextResponse.json({ ok: true });
}
