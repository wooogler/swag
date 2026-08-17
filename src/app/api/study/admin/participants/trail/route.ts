/**
 * One participant's whole session, as a file.
 *
 * RQ1 is answered by reading a session in order, which means the analyst needs
 * the record on their own machine next to the screen recording — not a query.
 * `?format=json` returns the same trail unzipped, for a script.
 *
 * Built on demand rather than stored: everything in it is derived from tables
 * that are already the truth, so a download after more work simply contains
 * more. Nothing here writes.
 */
import { NextResponse } from 'next/server';
import { zipSync, strToU8 } from 'fflate';
import { getInstructor, isAdministrator } from '@/lib/auth';
import { ensureStudyTables } from '@/lib/study/store';
import { buildParticipantTrail } from '@/lib/study/trail';
import { buildTrailFiles } from '@/lib/study/trail-files';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(req: Request) {
  const instructor = await getInstructor();
  if (!instructor || !isAdministrator(instructor)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  await ensureStudyTables();

  const { searchParams } = new URL(req.url);
  const participantId = searchParams.get('participantId');
  if (!participantId) return NextResponse.json({ error: 'missing_params' }, { status: 400 });

  try {
    if (searchParams.get('format') === 'json') {
      const trail = await buildParticipantTrail(participantId);
      if (!trail) return NextResponse.json({ error: 'not_found' }, { status: 404 });
      return NextResponse.json(trail);
    }

    const built = await buildTrailFiles(participantId);
    if (!built) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    // In memory on purpose: one participant is a few MB at most (a session
    // makes tens of snapshots), and streaming would buy nothing but a harder
    // handler to read.
    const entries: Record<string, Uint8Array> = {};
    for (const [name, text] of Object.entries(built.files)) {
      entries[`${built.number}/${name}`] = strToU8(text);
    }
    const zipped = zipSync(entries, { level: 6 });

    return new Response(new Uint8Array(zipped), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${built.number}-trail.zip"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('trail export error:', err);
    return NextResponse.json({ error: 'build_failed' }, { status: 500 });
  }
}
