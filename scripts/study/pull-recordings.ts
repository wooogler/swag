/**
 * Pull participants' screen recordings out of the database and onto disk.
 *
 *   npx tsx --env-file=.env scripts/study/pull-recordings.ts --out ./export
 *   npx tsx --env-file=.env scripts/study/pull-recordings.ts --participant P07
 *   npx tsx --env-file=.env scripts/study/pull-recordings.ts --purge
 *   npx tsx --env-file=.env scripts/study/pull-recordings.ts --mp4     (SLOW, see below)
 *
 * RUN THIS AFTER EVERY SESSION. The recordings live in Postgres because the
 * container has no persistent volume — nothing else about that choice makes
 * them safe. The box has no database backup of any kind, so until a session's
 * files are off it and somewhere backed up, they exist once.
 *
 * `--purge` deletes the chunk rows it has just written, and only those. The
 * metadata row stays, so the console keeps showing that the recording happened
 * and how big it was.
 *
 * Reassembly is a concatenation: MediaRecorder timeslices are not independently
 * playable — only seq 0 carries the WebM header — so the bytes in seq order ARE
 * the file, and nothing needs decoding here.
 *
 * AND THEN THE FILE NEEDS REMUXING, which is not a defect in the bytes. A
 * MediaRecorder writes a LIVE WebM: the Segment has unknown size and the header
 * carries no Duration, because when recording began nobody knew how long it
 * would run. Players therefore cannot seek it, and Chrome shows a total time
 * that keeps climbing as it discovers more of the file. One lossless pass
 * (`-c copy`) writes a real header and fixes both; nothing is re-encoded and
 * nothing is lost.
 *
 * It happens here when ffmpeg is on PATH, which it is NOT on the study server —
 * so this is normally the analyst's machine doing it after the pull. When
 * ffmpeg is missing the raw files are still written and the exact command is
 * printed rather than the step being skipped silently.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '../../src/db/db';
import {
  studyClones,
  studyParticipants,
  studyRecordingChunks,
  studyRecordings,
} from '../../src/db/schema';

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] ?? null : null;
}

const OUT = argValue('--out') ?? './export';
const ONLY = argValue('--participant')?.toUpperCase() ?? null;
const PURGE = process.argv.includes('--purge');
/** Skip the remux even where ffmpeg exists — for a pull that only needs bytes. */
const NO_FIX = process.argv.includes('--no-fix');
/**
 * Write .mp4 instead of .webm — and know what it costs.
 *
 * VP8 has no tag in the MP4 container, so the lossless copy is REFUSED and this
 * falls through to re-encoding. Measured on this hardware: a nine-minute
 * capture did not finish in six and a half minutes, and a study block is
 * twenty-five. Only worth it for a clip somebody has to open in a player that
 * will not take WebM at all; the default WebM output already seeks and shows a
 * real duration, which is what people actually want.
 */
const WANT_MP4 = process.argv.includes('--mp4');

/** Whether ffmpeg is callable, asked once. */
function hasFfmpeg(): boolean {
  const probe = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  return probe.status === 0;
}

/**
 * Rewrite the container so the file has a duration and can be seeked.
 *
 * `-c copy` first, always: it is a container rewrite, not a re-encode, and it
 * takes about a second on a 200 MB file. MP4 output falls back to re-encoding
 * the video only if the copy is refused, because VP8/VP9 in MP4 is legal but
 * not universally accepted by the muxer.
 *
 * Returns the path that is now the file, or null if ffmpeg refused — in which
 * case the original is left exactly where it was.
 */
function remux(src: string): string | null {
  // A temp name while ffmpeg writes, because the output cannot be the input.
  // A successful WebM remux is then moved back OVER the original, so the file
  // that survives carries the name the console's download also gives it —
  // `recordingFileName` is the one rule, and a `.fixed` suffix here would make
  // it two.
  const out = src.replace(/\.webm$/, WANT_MP4 ? '.mp4' : '.remuxed.webm');
  const attempts: string[][] = [['-i', src, '-c', 'copy', out]];
  if (WANT_MP4) attempts.push(['-i', src, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', out]);
  for (const args of attempts) {
    const res = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'ignore' });
    if (res.status === 0) {
      try {
        if (statSync(out).size > 0) {
          if (WANT_MP4) return out;
          renameSync(out, src);
          return src;
        }
      } catch {
        /* fall through to the next attempt */
      }
    }
  }
  return null;
}

/** Read chunks in pages so one 200 MB recording is not one 200 MB query. */
const PAGE = 40;

function mb(n: number): string {
  return `${(n / 1_048_576).toFixed(1)} MB`;
}

async function main() {
  const { ensureStudyTables } = await import('../../src/lib/study/store');
  const { recordingFileName } = await import('../../src/lib/study/recording-store');
  await ensureStudyTables();

  const participants = await db
    .select({
      id: studyParticipants.id,
      number: studyParticipants.participantNumber,
    })
    .from(studyParticipants);
  const wanted = participants.filter((p) => !ONLY || p.number.toUpperCase() === ONLY);
  if (wanted.length === 0) {
    console.error(ONLY ? `No participant ${ONLY}.` : 'No participants.');
    process.exit(1);
  }

  const dir = path.resolve(OUT, 'recordings');
  mkdirSync(dir, { recursive: true });

  let files = 0;
  let bytes = 0;
  let incomplete = 0;
  let fixed = 0;
  // Asked once: probing per file would spawn a process per recording to learn
  // the same thing.
  const canFix = !NO_FIX && hasFfmpeg();
  if (WANT_MP4 && canFix) {
    console.log(
      'NOTE: --mp4 re-encodes (VP8 cannot be copied into MP4). Expect this to take\n' +
        '      longer than the recordings themselves. Plain WebM output already seeks.\n'
    );
  }

  for (const participant of wanted) {
    const runs = await db
      .select()
      .from(studyRecordings)
      .where(eq(studyRecordings.participantId, participant.id))
      .orderBy(asc(studyRecordings.block), asc(studyRecordings.segment));
    if (runs.length === 0) continue;

    const clones = await db
      .select({
        datasetKey: studyClones.datasetKey,
        assignmentId: studyClones.assignmentId,
        condition: studyClones.condition,
      })
      .from(studyClones)
      .where(eq(studyClones.participantId, participant.id));

    for (const run of runs) {
      // The equipment check is three seconds of proof, not data. Keep the row,
      // skip the file, unless someone explicitly asks for everything.
      if (run.block === 0 && !process.argv.includes('--include-checks')) continue;

      const clone = clones.find((c) => c.assignmentId === run.assignmentId);
      const parts: Buffer[] = [];
      let seen = 0;
      for (let offset = 0; ; offset += PAGE) {
        const page = await db
          .select({ seq: studyRecordingChunks.seq, data: studyRecordingChunks.data })
          .from(studyRecordingChunks)
          .where(eq(studyRecordingChunks.recordingId, run.id))
          .orderBy(asc(studyRecordingChunks.seq))
          .limit(PAGE)
          .offset(offset);
        if (page.length === 0) break;
        for (const row of page) {
          // A gap means a chunk never arrived. Say so rather than writing a
          // file that plays for a while and then stops: only the person
          // running this can tell whether it is worth re-checking.
          if (row.seq !== seen) {
            console.warn(
              `  ! ${participant.number} b${run.block}: expected seq ${seen}, found ${row.seq} — gap`
            );
            seen = row.seq;
          }
          parts.push(row.data);
          seen += 1;
        }
      }

      if (parts.length === 0) {
        console.warn(`  ! ${participant.number} b${run.block}.${run.segment}: no chunks stored`);
        continue;
      }

      const whole = Buffer.concat(parts);
      // The same rule the console's download uses — one name for one file,
      // whichever way it came off the server.
      const name = recordingFileName({
        participantNumber: participant.number,
        block: run.block,
        segment: run.segment,
        datasetKey: clone?.datasetKey ?? null,
        condition: clone?.condition ?? null,
        startedAt: run.startedAt,
        id: run.id,
      });
      const file = path.join(dir, `${name}.webm`);
      writeFileSync(file, whole);

      // Rewrite the container so the file has a duration and seeks. The raw
      // one is removed only once the rewrite has produced something: a failed
      // remux must never be the reason a recording is gone.
      let final = file;
      let note = canFix ? ' · NOT FIXED' : '';
      if (canFix) {
        const remuxed = remux(file);
        if (remuxed) {
          // WebM was moved back over the original; MP4 sits beside it, so the
          // now-redundant source goes. Either way the raw file is only removed
          // once something has replaced it — a failed remux must never be the
          // reason a recording is gone.
          if (remuxed !== file) rmSync(file, { force: true });
          final = remuxed;
          note = '';
          fixed += 1;
        }
      }

      const declared = run.chunksDeclared;
      const short = declared !== null && parts.length < declared;
      if (short) incomplete += 1;
      console.log(
        `  ${participant.number} b${run.block}.${run.segment} · ${parts.length}/${
          declared ?? '?'
        } chunks · ${mb(whole.length)} · ${short ? 'SHORT' : 'clean'} · ${
          run.endReason ?? 'open'
        }${note} → ${path.basename(final)}`
      );
      files += 1;
      bytes += whole.length;

      if (PURGE) {
        await db
          .delete(studyRecordingChunks)
          .where(eq(studyRecordingChunks.recordingId, run.id));
      }
    }
  }

  console.log(`\n${files} file(s), ${mb(bytes)} → ${dir}`);
  if (incomplete > 0) {
    console.log(`${incomplete} recording(s) stored fewer chunks than the browser reported.`);
  }
  if (PURGE) console.log('Chunk rows deleted; metadata kept.');
  else console.log('Chunk rows kept. Re-run with --purge once the files are backed up.');

  // A MediaRecorder file has no Duration in its header, so a player cannot seek
  // it and shows a total time that grows as it reads. Nothing is wrong with the
  // bytes; the container just has to be rewritten once.
  if (fixed > 0) {
    console.log(`${fixed} file(s) remuxed — they now seek and show a real duration.`);
  } else if (NO_FIX) {
    console.log('Remux skipped (--no-fix). These files will not seek until remuxed.');
  } else {
    console.log(
      '\nffmpeg was not found, so the files are as the browser wrote them: a player\n' +
        'cannot seek them and the total time climbs while it reads. Fix them where\n' +
        'ffmpeg is installed — it is a container rewrite, nothing is re-encoded:\n' +
        `\n  cd ${dir} && for f in *.webm; do ffmpeg -y -i "$f" -c copy "\${f%.webm}.fixed.webm"; done\n` +
        '\n  (macOS: brew install ffmpeg)'
    );
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
