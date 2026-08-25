/**
 * Where a participant's screen recording lands.
 *
 * The bytes go in Postgres rather than on disk, and that is a deployment fact
 * rather than a preference: the app runs as `podman run --rm` with no volume
 * mounted, so the container filesystem is destroyed on every restart and every
 * redeploy. Adding a mount means editing both `deploy.sh` and the live systemd
 * unit — which that script rewrites from a heredoc each time — so one deploy
 * from a stale checkout would silently drop the mount and take a session's
 * recordings with it, with nothing to notice it by. Postgres cannot be lost
 * that way.
 *
 * The cost is that recordings sit in the study database until someone pulls
 * them out (`scripts/study/pull-recordings.ts`), and the box has no database
 * backup at all. Pulling after each session is therefore part of running one,
 * not tidying up afterwards.
 *
 * Nothing here trusts the client with anything but the bytes. The block, the
 * phase and the clone are read from the participant's own row; the id is the
 * client's only because a chunk has to be addressable before the first round
 * trip has come back.
 */
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db/db';
import { studyRecordingChunks, studyRecordings } from '@/db/schema';
import { conditionName, isStudioView } from './config';
import { ensureStudyTables } from './store';

/**
 * What a recording is called, in one place.
 *
 * Two things build this name — the console's download and the bulk pull script
 * — and a file grabbed mid-session has to be the same file, under the same
 * name, as the one pulled afterwards. Keeping the rule in each of them is how
 * that stops being true.
 *
 * Everything an analyst needs to sort by is in the name, because the name is
 * what survives being moved into a folder somewhere: who, which block, which
 * version they were using, which dataset, and when. The id suffix is what makes
 * it unique when two of those coincide.
 */
export function recordingFileName(args: {
  participantNumber: string;
  block: number;
  segment: number;
  datasetKey: string | null;
  /** The clone's StudioView, if it is known — block 0 has no clone. */
  condition: string | null;
  startedAt: Date;
  id: string;
}): string {
  // Block 0 is the equipment check, not a session block. Naming it `b0` left
  // the one file nobody wants to analyse looking exactly like the ones they do.
  const parts: string[] = [
    args.participantNumber,
    args.block === 0 ? 'test' : `b${args.block}`,
    `s${args.segment}`,
  ];
  // Slate / Clay: the names the study uses for the two versions everywhere
  // else, so a filename and a survey column say the same word. Dropped rather
  // than written as "unknown" when there is no clone behind the run.
  if (isStudioView(args.condition)) parts.push(conditionName(args.condition));
  if (args.datasetKey) parts.push(args.datasetKey);
  parts.push(localStamp(args.startedAt));
  parts.push(args.id.slice(0, 8));
  // Nothing in here can contain a separator or a path character — participant
  // numbers are bounded by PARTICIPANT_NUMBER_RE and the rest are ours — but
  // this is a filename, so it is made safe rather than assumed safe.
  return parts.join('_').replace(/[^A-Za-z0-9._-]/g, '-');
}

/**
 * `2026-08-24_1322EDT` — sortable within a day, and honest about the offset.
 *
 * LOCAL time, deliberately: the researcher reading these filenames is in the
 * same place the sessions are run from, and a timestamp they have to convert
 * before it means anything is a timestamp they will misread once.
 *
 * "Local" has to be the same place on both sides, though. This runs in the
 * container for the console's download and on the host for the bulk pull, and
 * an Alpine container is UTC unless told otherwise — which would have the two
 * paths stamping the same recording four hours apart. The Dockerfile installs
 * tzdata and sets TZ for exactly this reason.
 *
 * The zone is not written into the name; the ABBREVIATION is, and it comes from
 * the date rather than from a constant — the same zone is EDT in August and EST
 * in December, and a hard-coded label would be wrong for half the year.
 */
function localStamp(at: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  // `hour12: false` yields 24 for midnight in some ICU versions.
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}-${get('month')}-${get('day')}_${hour}${get('minute')}${get(
    'timeZoneName'
  )}`;
}

/** Bounds the client cannot argue with. */
export const RECORDING_MAX_CHUNK_BYTES = 8 * 1024 * 1024;

export type RecordingEndReason = 'finished' | 'track_ended' | 'unload' | 'probe' | 'error';

export interface RecordingRow {
  id: string;
  participantId: string;
  block: number;
  segment: number;
  assignmentId: string | null;
  phase: string | null;
  mimeType: string;
  startedAt: Date;
  endedAt: Date | null;
  endReason: string | null;
  chunksDeclared: number | null;
  chunksStored: number;
  bytes: number;
  lastChunkAt: Date | null;
}

const COLUMNS = {
  id: studyRecordings.id,
  participantId: studyRecordings.participantId,
  block: studyRecordings.block,
  segment: studyRecordings.segment,
  assignmentId: studyRecordings.assignmentId,
  phase: studyRecordings.phase,
  mimeType: studyRecordings.mimeType,
  startedAt: studyRecordings.startedAt,
  endedAt: studyRecordings.endedAt,
  endReason: studyRecordings.endReason,
  chunksDeclared: studyRecordings.chunksDeclared,
  chunksStored: studyRecordings.chunksStored,
  bytes: studyRecordings.bytes,
  lastChunkAt: studyRecordings.lastChunkAt,
};

/**
 * Open a run.
 *
 * The segment is counted here rather than passed in: a reload starts a second
 * run of the same block, and which number that is is a fact about the rows
 * already stored, not about the tab that is asking.
 *
 * Idempotent on the id, because the client posts this before its first chunk
 * and a retried start must not open a second row.
 */
export async function startRecording(args: {
  id: string;
  participantId: string;
  block: number;
  assignmentId: string | null;
  phase: string | null;
  mimeType: string;
  client: unknown;
}): Promise<{ segment: number }> {
  await ensureStudyTables();
  const [existing] = await db
    .select({ segment: studyRecordings.segment })
    .from(studyRecordings)
    .where(eq(studyRecordings.id, args.id));
  if (existing) return { segment: existing.segment };

  const prior = await db
    .select({ segment: studyRecordings.segment })
    .from(studyRecordings)
    .where(
      and(
        eq(studyRecordings.participantId, args.participantId),
        eq(studyRecordings.block, args.block)
      )
    )
    .orderBy(desc(studyRecordings.segment))
    .limit(1);
  const segment = (prior[0]?.segment ?? 0) + 1;

  await db.insert(studyRecordings).values({
    id: args.id,
    participantId: args.participantId,
    block: args.block,
    segment,
    assignmentId: args.assignmentId,
    phase: args.phase,
    mimeType: args.mimeType,
    startedAt: new Date(),
    client: args.client ?? null,
  });
  return { segment };
}

/** The run, if it belongs to this participant. Ownership is the whole point. */
export async function recordingFor(
  id: string,
  participantId: string
): Promise<RecordingRow | null> {
  await ensureStudyTables();
  const [row] = await db
    .select(COLUMNS)
    .from(studyRecordings)
    .where(and(eq(studyRecordings.id, id), eq(studyRecordings.participantId, participantId)));
  return row ?? null;
}

/**
 * Store one chunk.
 *
 * `DO NOTHING` on conflict, and the counters move only when a row was actually
 * written — the client retries a chunk whose response it never saw, and a
 * retry that double-counted the bytes would make every completeness check lie.
 */
export async function putChunk(args: {
  recordingId: string;
  seq: number;
  data: Buffer;
}): Promise<{ stored: boolean }> {
  const inserted = await db
    .insert(studyRecordingChunks)
    .values({
      recordingId: args.recordingId,
      seq: args.seq,
      data: args.data,
      createdAt: new Date(),
    })
    .onConflictDoNothing()
    .returning({ seq: studyRecordingChunks.seq });

  if (inserted.length === 0) return { stored: false };

  await db
    .update(studyRecordings)
    .set({
      chunksStored: sql`${studyRecordings.chunksStored} + 1`,
      bytes: sql`${studyRecordings.bytes} + ${args.data.length}`,
      lastChunkAt: new Date(),
    })
    .where(eq(studyRecordings.id, args.recordingId));
  return { stored: true };
}

/**
 * Close a run.
 *
 * `chunksDeclared` is what the client says it produced; `chunksStored` is what
 * arrived. Keeping both is what lets the console say "short by two" instead of
 * showing a green tick over a truncated file.
 */
export async function finishRecording(args: {
  id: string;
  chunksDeclared: number | null;
  reason: RecordingEndReason;
}): Promise<void> {
  await db
    .update(studyRecordings)
    .set({
      endedAt: new Date(),
      endReason: args.reason,
      ...(args.chunksDeclared !== null ? { chunksDeclared: args.chunksDeclared } : {}),
    })
    .where(eq(studyRecordings.id, args.id));
}

/** Every run this participant has, newest block first. */
export async function recordingsFor(participantId: string): Promise<RecordingRow[]> {
  await ensureStudyTables();
  return db
    .select(COLUMNS)
    .from(studyRecordings)
    .where(eq(studyRecordings.participantId, participantId))
    .orderBy(asc(studyRecordings.block), asc(studyRecordings.segment));
}

/**
 * Whether this participant has ever proved the pipeline end to end.
 *
 * Read from the rows rather than from the phase, because the macOS fix for a
 * denied capture is to quit Chrome and come back — anything held in the browser
 * is gone for exactly the participant who needed the check most. A pass is a
 * `block = 0` run that actually stored bytes; a run that opened and stored
 * nothing is a failed check, not a passed one.
 */
export async function equipmentCheckPassed(participantId: string): Promise<boolean> {
  await ensureStudyTables();
  const [row] = await db
    .select({ bytes: studyRecordings.bytes })
    .from(studyRecordings)
    .where(and(eq(studyRecordings.participantId, participantId), eq(studyRecordings.block, 0)))
    .orderBy(desc(studyRecordings.bytes))
    .limit(1);
  return (row?.bytes ?? 0) > 0;
}

/**
 * The chunks of one recording, a page at a time, in order.
 *
 * Paged rather than returned whole because a block is hundreds of megabytes:
 * the trail export can sit in memory ("one participant is a few MB at most")
 * and this cannot. The caller streams these straight out.
 *
 * A gap in `seq` means a chunk never arrived; the reader is told, and decides.
 * Concatenating what IS here still produces a playable file up to the gap.
 */
export async function* recordingChunks(
  recordingId: string,
  pageSize = 40
): AsyncGenerator<{ seq: number; data: Buffer }> {
  for (let offset = 0; ; offset += pageSize) {
    const page = await db
      .select({ seq: studyRecordingChunks.seq, data: studyRecordingChunks.data })
      .from(studyRecordingChunks)
      .where(eq(studyRecordingChunks.recordingId, recordingId))
      .orderBy(asc(studyRecordingChunks.seq))
      .limit(pageSize)
      .offset(offset);
    if (page.length === 0) return;
    for (const row of page) yield row;
    if (page.length < pageSize) return;
  }
}

/** One recording by id, whoever it belongs to — for the researcher-side
 * download, which is authorised as an administrator rather than as its owner. */
export async function recordingById(id: string): Promise<RecordingRow | null> {
  await ensureStudyTables();
  const [row] = await db.select(COLUMNS).from(studyRecordings).where(eq(studyRecordings.id, id));
  return row ?? null;
}

/** Drop a participant's recordings — called from teardown, which has no FK to
 * do it for us. Chunks first: an orphaned blob is the expensive kind. */
export async function deleteRecordingsFor(participantId: string): Promise<void> {
  await ensureStudyTables();
  const rows = await db
    .select({ id: studyRecordings.id })
    .from(studyRecordings)
    .where(eq(studyRecordings.participantId, participantId));
  for (const row of rows) {
    await db.delete(studyRecordingChunks).where(eq(studyRecordingChunks.recordingId, row.id));
  }
  await db.delete(studyRecordings).where(eq(studyRecordings.participantId, participantId));
}
