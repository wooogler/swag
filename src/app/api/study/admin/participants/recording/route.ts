/**
 * One recording, as a file, for the researcher.
 *
 * The bytes live in Postgres because the container has no persistent volume, so
 * "download it" is a query rather than a file read — but a block is hundreds of
 * megabytes, which is where this parts company with the trail export beside it.
 * That one builds a zip in memory and says so; doing the same here would hold a
 * whole video in the server's heap per click. So the chunks are paged out of the
 * database and piped straight into ffmpeg.
 *
 * WHY FFMPEG IS IN THE PATH AT ALL. Concatenating the chunks in `seq` order
 * already produces the exact file the browser recorded — a MediaRecorder
 * timeslice is not independently playable, only seq 0 carries the header, so
 * concatenation is both necessary and sufficient. What it does NOT produce is a
 * file anyone can watch comfortably: a MediaRecorder writes a LIVE WebM, with
 * the Segment marked unknown-size and no Duration, because when recording began
 * nothing knew how long it would run. Players cannot seek it and show a running
 * time that climbs as they read. One `-c copy` pass rewrites the header and
 * touches no video data — measured at 0.06s for a nine-minute capture.
 *
 * WHY IT DOES NOT PRODUCE MP4. VP8 has no tag in the MP4 container ("Could not
 * find tag for codec vp8"), so MP4 would mean re-encoding, and re-encoding that
 * same nine-minute clip to H.264 did not finish in six and a half minutes here.
 * A block is twenty-five minutes, and these downloads happen while sessions are
 * running. If MP4 is wanted, the cheap place to get it is upstream — recording
 * H.264 in the first place makes it a container swap — not here.
 *
 * If ffmpeg is missing (the host dev server, rather than the built image) the
 * raw concatenation is streamed instead, which is exactly what this route
 * returned before. A player will not seek it; nothing is lost.
 *
 * Administrator-gated, like the trail route, and deliberately NOT the
 * participant check the upload routes use: those authorise the owner of the
 * recording, and this is the one place somebody who is not its owner is
 * supposed to read it.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { NextResponse } from 'next/server';
import { getInstructor, isAdministrator } from '@/lib/auth';
import { db } from '@/db/db';
import { eq } from 'drizzle-orm';
import { studyClones, studyParticipants } from '@/db/schema';
import {
  recordingById,
  recordingChunks,
  recordingFileName,
} from '@/lib/study/recording-store';

export const dynamic = 'force-dynamic';

/** Asked once per process — spawning a probe per download would cost more than
 * the remux does. */
let ffmpegAvailable: boolean | null = null;
function hasFfmpeg(): boolean {
  if (ffmpegAvailable === null) {
    ffmpegAvailable = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
  }
  return ffmpegAvailable;
}

export async function GET(req: Request) {
  const instructor = await getInstructor();
  if (!instructor || !isAdministrator(instructor)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  /** Skip the remux and hand back exactly what the browser produced. */
  const raw = url.searchParams.get('raw') === '1';
  if (!id) return NextResponse.json({ error: 'missing_params' }, { status: 400 });

  const recording = await recordingById(id);
  if (!recording) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (recording.chunksStored === 0) {
    return NextResponse.json({ error: 'empty' }, { status: 409 });
  }

  // Named by the shared rule, so a file grabbed here mid-session and the same
  // file pulled in bulk afterwards are one file under one name.
  const [participant] = await db
    .select({ number: studyParticipants.participantNumber })
    .from(studyParticipants)
    .where(eq(studyParticipants.id, recording.participantId));
  let datasetKey: string | null = null;
  let condition: string | null = null;
  if (recording.assignmentId) {
    const [clone] = await db
      .select({ datasetKey: studyClones.datasetKey, condition: studyClones.condition })
      .from(studyClones)
      .where(eq(studyClones.assignmentId, recording.assignmentId));
    datasetKey = clone?.datasetKey ?? null;
    condition = clone?.condition ?? null;
  }
  const name = recordingFileName({
    participantNumber: participant?.number ?? 'unknown',
    block: recording.block,
    segment: recording.segment,
    datasetKey,
    condition,
    startedAt: recording.startedAt,
    id: recording.id,
  });

  const headers = (extra: Record<string, string>) => ({
    'Content-Type': recording.mimeType.split(';')[0] || 'video/webm',
    'Content-Disposition': `attachment; filename="${name}.webm"`,
    'Cache-Control': 'no-store',
    ...extra,
  });

  if (raw || !hasFfmpeg()) {
    return new Response(rawStream(recording.id), {
      // Known exactly — it is the sum of what was stored — so the browser can
      // show real progress on a download that takes a while.
      headers: headers({ 'Content-Length': String(recording.bytes) }),
    });
  }

  // ffmpeg needs to SEEK its output to write a real header, so the output is a
  // file rather than a pipe. The input stays a pipe: holding one copy in a temp
  // file is enough, and holding two would double the disk a download costs.
  const dir = await mkdtemp(path.join(tmpdir(), 'swag-rec-'));
  const outPath = path.join(dir, `${name}.webm`);
  try {
    await remux(recording.id, outPath);
    const { size } = await stat(outPath);
    const handle = createReadStream(outPath);
    // Unlink NOW, with the file already open. The bytes stay readable through
    // the open descriptor until the response has been sent, and the temp file
    // cannot outlive this request — not if the download is abandoned, not if
    // the stream errors, not if the process is killed mid-send. Tying the
    // cleanup to the end of the stream instead leaves a copy of every download
    // behind whenever that end never arrives, which on a 200 MB file is how a
    // disk fills up during a session.
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    const file = Readable.toWeb(handle) as unknown as ReadableStream<Uint8Array>;
    return new Response(file, { headers: headers({ 'Content-Length': String(size) }) });
  } catch (err) {
    console.error('recording remux failed, sending raw:', err);
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    // A remux that fails must not cost the researcher the recording.
    return new Response(rawStream(recording.id), {
      headers: headers({ 'Content-Length': String(recording.bytes) }),
    });
  }
}

/** The chunks exactly as stored, in order — the file the browser wrote. */
function rawStream(recordingId: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        let expected = 0;
        for await (const chunk of recordingChunks(recordingId)) {
          // A hole means a chunk never arrived. Keep going — what is here still
          // plays up to that point, and refusing the whole download would be
          // the worse answer — but leave it in the log, because the console's
          // "short" chip is the only other place it shows.
          if (chunk.seq !== expected) {
            console.warn(`recording ${recordingId}: gap at seq ${expected} (found ${chunk.seq})`);
            expected = chunk.seq;
          }
          controller.enqueue(new Uint8Array(chunk.data));
          expected += 1;
        }
        controller.close();
      } catch (err) {
        console.error('recording download error:', err);
        controller.error(err);
      }
    },
  });
}

/** Feed the stored chunks through ffmpeg into a seekable file. */
function remux(recordingId: string, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-y',
      '-loglevel', 'error',
      '-i', 'pipe:0',
      '-c', 'copy',
      outPath,
    ]);
    let stderr = '';
    ff.stderr.on('data', (d) => {
      stderr += String(d);
    });
    ff.on('error', reject);
    ff.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(0, 400)}`))
    );

    void (async () => {
      try {
        for await (const chunk of recordingChunks(recordingId)) {
          if (ff.stdin.destroyed) return;
          // Respect backpressure: a 200 MB recording written without waiting
          // buffers the whole thing in this process, which is the exact cost
          // streaming was for.
          if (!ff.stdin.write(chunk.data)) {
            await new Promise((r) => ff.stdin.once('drain', r));
          }
        }
        ff.stdin.end();
      } catch (err) {
        ff.stdin.destroy();
        reject(err);
      }
    })();
  });
}
