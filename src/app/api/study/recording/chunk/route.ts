/**
 * One chunk of a recording, as raw bytes.
 *
 * Raw body rather than multipart: nothing in this app parses multipart today,
 * and the only two fields a chunk needs are integers that fit in the query
 * string. `req.arrayBuffer()` is native and needs nothing added.
 *
 * The size cap is checked on Content-Length BEFORE the body is materialised,
 * and it is checked here rather than left to nginx. nginx caps bodies at 10 MB,
 * but the app also listens on 0.0.0.0:3000 directly, so nginx is a limit on one
 * path in and not a boundary. A route that only discovers the size after
 * buffering it has already spent the memory it was trying to protect.
 */
import { NextResponse } from 'next/server';
import { getCurrentStudyParticipant } from '@/lib/study/session';
import { putChunk, recordingFor, RECORDING_MAX_CHUNK_BYTES } from '@/lib/study/recording-store';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const participant = await getCurrentStudyParticipant();
  if (!participant) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const id = url.searchParams.get('id') ?? '';
  const seq = Number.parseInt(url.searchParams.get('seq') ?? '', 10);
  if (!id || !Number.isInteger(seq) || seq < 0) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const declared = Number.parseInt(request.headers.get('content-length') ?? '', 10);
  if (Number.isFinite(declared) && declared > RECORDING_MAX_CHUNK_BYTES) {
    return NextResponse.json({ error: 'too_large' }, { status: 413 });
  }

  // Ownership before bytes: this is what stops one participant writing into
  // another's recording, and it is one indexed lookup.
  const recording = await recordingFor(id, participant.id);
  if (!recording) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const buffer = Buffer.from(await request.arrayBuffer());
  if (buffer.length === 0) return new NextResponse(null, { status: 204 });
  if (buffer.length > RECORDING_MAX_CHUNK_BYTES) {
    return NextResponse.json({ error: 'too_large' }, { status: 413 });
  }

  await putChunk({ recordingId: id, seq, data: buffer });
  // 204 whether it was written or was a duplicate. The client's question is
  // "is this chunk safely stored", and for a retry the answer is yes.
  return new NextResponse(null, { status: 204 });
}
