/**
 * Baseline judge-search: rate one call-bounded batch of the log against a
 * definition and return current clearly_in + progress. Client loops until
 * remaining === 0 (or ratedThisBatch === 0, a stall). See spec §5.1.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeAssignment, authErrorResponse } from '@/lib/score/authz';
import { refuseSimpleClone } from '@/lib/study/simple/route-context';
import { isOpenAIConfigured } from '@/lib/score/classifier';
import { ensureScoreTable } from '@/lib/score/queries';
import { ensureIntentTables } from '@/lib/score/intent-store';
import { ensureStudyTables } from '@/lib/study/store';
import { probeBatch } from '@/lib/study/probe';
import { logStudyEvent, touchBaselineSearch } from '@/lib/study/baseline-store';

const schema = z.object({ description: z.string().min(1).max(2000), limit: z.number().int().positive().max(400).optional() });

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
  if (!isOpenAIConfigured()) {
    return NextResponse.json({ error: 'openai_not_configured' }, { status: 503 });
  }
  await Promise.all([ensureScoreTable(), ensureIntentTables(), ensureStudyTables()]);
  try {
    const { description, limit } = schema.parse(await request.json());
    const result = await probeBatch(id, description.trim(), limit);
    await Promise.all([
      touchBaselineSearch(id, result.defHash),
      logStudyEvent(id, 'search_run', {
        defHash: result.defHash,
        resultCount: result.clearlyIn.length,
        remaining: result.remaining,
        // The search text itself. In the baseline arm this is not browsing —
        // it is the instructor stating, in natural language, a category of
        // student request they consider a thing; the same act SCORE records as
        // an intent definition. A hash cannot be read back, and RQ1 compares
        // exactly these two ways of saying what the material contains.
        description: description.trim(),
      }),
    ]);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
    console.error('Probe error:', error);
    return NextResponse.json({ error: 'probe_failed' }, { status: 500 });
  }
}
