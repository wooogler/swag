'use client';

/**
 * The participant's own screen recorder.
 *
 * The Zoom host used to record the session over a shared screen. With
 * participants alone in breakout rooms nobody is in the room to record, so the
 * browser captures instead and posts the bytes as it goes.
 *
 * THE SHAPE, AND WHY IT IS FORCED.
 *
 * A `MediaStream` cannot survive a page load, and every navigation in this
 * study is a full one (`PhaseAdvance` does `window.location.assign`, the
 * session screens are plain links). So a recorder run is exactly one load of
 * one board: armed by the briefing dialog's Start, closed by the click that
 * ends the block. Two runs per participant, plus the equipment check. A reload
 * mid-block starts a new run, which the server files as the next segment.
 *
 * State lives in MODULE scope rather than React's. `router.refresh()` after a
 * deploy re-renders the tree the header sits in, and a recorder held in a
 * component's state would be at the mercy of that; a module variable is at the
 * mercy of nothing but the document.
 *
 * UPLOADS ARE DRIVEN BY `ondataavailable`, NEVER BY A TIMER. Chrome throttles
 * timers in a tab hidden for more than five minutes to roughly one wake a
 * minute, and `requestIdleCallback` does not fire in a hidden tab at all — and
 * a participant with Zoom in front of the board is exactly that tab. Screen
 * capture and its `dataavailable` events keep running regardless, because they
 * come off the media pipeline rather than the event loop. So every send and
 * every retry rides on the next chunk. A retry backoff built on `setTimeout`
 * would quietly become a one-minute backoff for the people most likely to need
 * it.
 *
 * NOTHING IS EVER DROPPED. A failed chunk stays queued and is retried ahead of
 * the next one. Losing seq 0 costs the entire recording — only that chunk
 * carries the WebM header — and a hole anywhere else is not something anyone
 * can repair afterwards. Memory is the cheaper thing to spend.
 *
 * WHAT IT WILL NOT DO. It records ONE WINDOW — the browser's — and not the
 * screen: a participant's other applications are not the study's to keep. No
 * audio either: a microphone in a breakout room records the researcher and
 * anyone else who unmutes. And it never blocks the board or the hand-off — a
 * recording problem must not cost a participant minutes of the clock that IS
 * the measurement, or cost the design a cell.
 */

export type RecorderStatus = 'idle' | 'starting' | 'recording' | 'ended' | 'error';

export interface RecorderSnapshot {
  status: RecorderStatus;
  /** 0 = equipment check, 1 | 2 = a configure block. */
  block: number;
  /** Chunks handed over by MediaRecorder so far. */
  produced: number;
  /** Chunks the server has acknowledged. */
  sent: number;
  bytes: number;
  /** Set when the last attempt failed in a way the participant may care about. */
  error: RecorderError | null;
}

export type RecorderError =
  | 'unsupported'
  | 'denied'
  | 'wrong_surface'
  | 'no_bytes'
  | 'upload_failed'
  | 'failed';

/** How often MediaRecorder hands us a blob. This is also the most that can be
 * lost to a crash or a hard reload, so it is short on purpose. */
const TIMESLICE_MS = 5_000;

/**
 * What we ask the picker for: THE BROWSER WINDOW.
 *
 * This landed on the whole screen first, then on the tab, then here, and both
 * earlier answers were wrong for reasons worth keeping written down.
 *
 * THE WHOLE SCREEN was chosen on the belief that a captured tab stops producing
 * frames once the participant looks at something else. It does not — Chrome
 * keeps a captured tab rendering precisely so that tab sharing works while you
 * are looking elsewhere. With that gone, the screen was buying nothing the
 * study measures and costing everything else open on a participant's machine,
 * in a file we then keep for five years.
 *
 * THE TAB cost the one thing the board cannot spare. Chrome puts a "Sharing
 * this tab" bar INSIDE the browser window, above the page, for the entire
 * capture — it is a security indicator, it cannot be suppressed, and it takes
 * about seventy-five pixels off the viewport for the whole twenty-five
 * minutes. The board is three columns of lists; that is real reading room, and
 * every participant would lose it. Window and screen captures get a separate
 * floating widget instead, which sits outside the page and does not resize it.
 *
 * THE WINDOW keeps almost all of the tab's privacy — no desktop, no other
 * applications — while giving the page back its full height. What it adds is
 * the browser's own chrome (address bar, tabs) and whatever else the
 * participant opens in that window. The address bar is already the neutral
 * `/studio/:id` alias for exactly this kind of reason, so there is nothing
 * there that a recording should not have.
 *
 * The cost is that the picker is a list of windows again rather than one
 * choice, so picking the wrong thing is possible again. That is what the
 * equipment check's playback question is for.
 *
 * Frame rate is low and the ceiling is generous: the analysis needs to read
 * which conversation is open and what was typed, not smooth motion.
 *
 * Cast because `DisplayMediaStreamOptions` in TS's lib.dom carries only
 * `audio` and `video`; the surface options are real Chrome options with no
 * types yet.
 */
const CAPTURE = {
  video: {
    // A hint, not a constraint — the picker still decides.
    displaySurface: 'window',
    frameRate: { ideal: 6, max: 8 },
    width: { max: 1920 },
    height: { max: 1200 },
  },
  audio: false,
  // Keep whole monitors out of the list: the one legitimate answer is the
  // window this page is in, and a screen is a way to record far too much.
  monitorTypeSurfaces: 'exclude',
  surfaceSwitching: 'exclude',
  systemAudio: 'exclude',
} as unknown as DisplayMediaStreamOptions;

/**
 * The surface we accept, checked after the fact because everything above is a
 * hint the browser may ignore. 'window' is an application window; 'browser'
 * would be a single tab, which is refused for the viewport reason above.
 */
export const WANTED_SURFACE = 'window';

/** Whether what the picker returned is the surface we asked for. Null means
 * the browser did not say, which is not evidence of the wrong one. */
export function surfaceOk(surface: string | null): boolean {
  return surface === null || surface === WANTED_SURFACE;
}

/** Chrome first, then whatever WebM it will give us. No MP4 fallback: Safari
 * would produce one and nothing else here is tested against it. */
const MIME_CANDIDATES = ['video/webm;codecs=vp8', 'video/webm'];

interface Active {
  id: string;
  block: number;
  stream: MediaStream;
  recorder: MediaRecorder;
  mimeType: string;
  /** Produced but not yet acknowledged, in order. Never truncated. */
  pending: { seq: number; blob: Blob }[];
  nextSeq: number;
  sent: number;
  bytes: number;
  draining: boolean;
  stopped: boolean;
  onStop: (() => void) | null;
}

let active: Active | null = null;
let snapshot: RecorderSnapshot = {
  status: 'idle',
  block: 0,
  produced: 0,
  sent: 0,
  bytes: 0,
  error: null,
};
const listeners = new Set<() => void>();
let unloadBound = false;

function emit(next: Partial<RecorderSnapshot>) {
  snapshot = { ...snapshot, ...next };
  listeners.forEach((l) => l());
}

export function subscribeRecorder(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function recorderSnapshot(): RecorderSnapshot {
  return snapshot;
}

export function recorderActive(): boolean {
  return active !== null && !active.stopped;
}

/** Whether this browser can do the job at all — checked before any prompt, so
 * an unsupported browser is told so rather than shown a picker that fails. */
export function recordingSupported(): boolean {
  if (typeof window === 'undefined') return false;
  if (!navigator.mediaDevices?.getDisplayMedia) return false;
  if (typeof MediaRecorder === 'undefined') return false;
  return MIME_CANDIDATES.some((m) => MediaRecorder.isTypeSupported(m));
}

function pickMime(): string {
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
}

export async function reportRecordingEvent(kind: string, payload?: unknown): Promise<void> {
  try {
    await fetch('/api/study/recording/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, payload }),
    });
  } catch {
    /* instrumentation must never surface to a participant */
  }
}

/**
 * Ask for the screen.
 *
 * Called straight from a click with no network await in front of it: Chrome's
 * transient activation lasts about five seconds and `getDisplayMedia` consumes
 * it, so a request to our own server first would spend the gesture on a slow
 * day and fail as `InvalidStateError` rather than as anything meaningful.
 */
export async function requestScreen(): Promise<MediaStream> {
  if (!recordingSupported()) {
    const err = new Error('unsupported');
    err.name = 'RecorderUnsupported';
    throw err;
  }
  return navigator.mediaDevices.getDisplayMedia(CAPTURE);
}

/** What the picker actually gave us — 'monitor' | 'window' | 'browser'. */
export function surfaceOf(stream: MediaStream): string | null {
  const track = stream.getVideoTracks()[0];
  if (!track) return null;
  const settings = track.getSettings() as MediaTrackSettings & { displaySurface?: string };
  return settings.displaySurface ?? null;
}

function bindUnload() {
  if (unloadBound || typeof window === 'undefined') return;
  unloadBound = true;
  // Best effort only. A beacon is capped at 64 KiB so it cannot carry video,
  // and MediaRecorder's own buffer dies with the document either way — this
  // exists so the row is closed with a reason rather than left open forever.
  window.addEventListener('pagehide', () => {
    if (!active || active.stopped) return;
    try {
      navigator.sendBeacon(
        '/api/study/recording/stop',
        new Blob([JSON.stringify({ id: active.id, chunks: active.nextSeq, reason: 'unload' })], {
          type: 'application/json',
        })
      );
    } catch {
      /* nothing to do at unload */
    }
  });
}

/**
 * Send everything queued, oldest first, and stop at the first failure.
 *
 * Serial rather than parallel: the queue is an ordered file, and a participant
 * on a home uplink does not benefit from four concurrent uploads competing for
 * it. Re-entrant calls return immediately — the next `ondataavailable` will
 * pick the queue up again, which is the whole retry mechanism.
 */
async function drain(): Promise<void> {
  if (!active || active.draining) return;
  active.draining = true;
  try {
    while (active.pending.length > 0) {
      const next = active.pending[0];
      const id = active.id;
      let ok = false;
      try {
        const res = await fetch(
          `/api/study/recording/chunk?id=${encodeURIComponent(id)}&seq=${next.seq}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: next.blob,
          }
        );
        ok = res.ok;
      } catch {
        ok = false;
      }
      // `active` can be replaced while a request is in flight (a stop and a
      // fresh start), so re-check rather than writing into a dead run.
      if (!active || active.id !== id) return;
      if (!ok) {
        emit({ error: 'upload_failed' });
        return;
      }
      active.pending.shift();
      active.sent += 1;
      active.bytes += next.blob.size;
      emit({ sent: active.sent, bytes: active.bytes, error: null });
    }
  } finally {
    if (active) active.draining = false;
  }
}

/**
 * Start recording a stream that has already been granted.
 *
 * The stream is passed in rather than requested here so the caller can inspect
 * the surface, and play it back, before committing to a run.
 */
export async function startRecording(args: {
  stream: MediaStream;
  /** True only for the equipment check. Which block a real run belongs to is
   * the server's to decide — it reads the participant's phase — so it is not a
   * parameter here; the answer comes back from `/start` and is only ever used
   * for what this component displays. */
  probe?: boolean;
}): Promise<string> {
  await stopRecording('error');

  const id = crypto.randomUUID();
  const mimeType = pickMime();
  const recorder = new MediaRecorder(args.stream, {
    mimeType,
    videoBitsPerSecond: 1_200_000,
  });

  const run: Active = {
    id,
    block: args.probe ? 0 : -1,
    stream: args.stream,
    recorder,
    mimeType,
    pending: [],
    nextSeq: 0,
    sent: 0,
    bytes: 0,
    draining: false,
    stopped: false,
    onStop: null,
  };
  active = run;
  emit({ status: 'starting', block: run.block, produced: 0, sent: 0, bytes: 0, error: null });

  const started = await fetch('/api/study/recording/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id,
      mimeType,
      probe: args.probe === true,
      client: {
        ua: navigator.userAgent,
        screen: { w: window.screen?.width ?? null, h: window.screen?.height ?? null },
        surface: surfaceOf(args.stream),
      },
    }),
  }).catch(() => null);

  if (!started?.ok) {
    active = null;
    args.stream.getTracks().forEach((t) => t.stop());
    emit({ status: 'error', error: 'upload_failed' });
    throw new Error('recording_start_refused');
  }

  // The block this run belongs to, as the server worked it out from the phase.
  const assigned = await started.json().catch(() => null);
  if (typeof assigned?.block === 'number') run.block = assigned.block;

  recorder.ondataavailable = (event) => {
    if (!active || active.id !== id) return;
    if (event.data && event.data.size > 0) {
      active.pending.push({ seq: active.nextSeq, blob: event.data });
      active.nextSeq += 1;
      emit({ produced: active.nextSeq });
    }
    // Every send and every retry hangs off this event — see the header.
    void drain();
  };

  recorder.onstop = () => {
    if (active?.id === id) run.onStop?.();
  };

  // The participant can stop sharing from Chrome's own bar or the macOS menu
  // bar, and neither of those is a click we ever see.
  args.stream.getVideoTracks().forEach((track) => {
    track.addEventListener('ended', () => {
      if (!active || active.id !== id || active.stopped) return;
      void reportRecordingEvent('track_ended', { block: active.block });
      void stopRecording('track_ended');
    });
  });

  bindUnload();
  recorder.start(TIMESLICE_MS);
  emit({ status: 'recording' });
  return id;
}

/**
 * Close the run and get the last bytes out before the page goes.
 *
 * Awaited by the caller, so the navigation waits on it — the only moment we can
 * flush at, because nothing after the page load can. Capped, because a
 * participant must not be held on a dead screen by a network that is not coming
 * back; what is still queued at that point is lost, and the row records that it
 * was by declaring more chunks than were stored.
 */
export async function stopRecording(
  reason: 'finished' | 'track_ended' | 'probe' | 'error',
  opts: { timeoutMs?: number } = {}
): Promise<void> {
  const run = active;
  if (!run || run.stopped) return;
  run.stopped = true;

  const finalBlob = new Promise<void>((resolve) => {
    run.onStop = resolve;
    if (run.recorder.state === 'inactive') resolve();
  });

  try {
    if (run.recorder.state !== 'inactive') {
      // requestData before stop: relying on stop() alone to flush the tail is
      // not reliable in Chrome.
      run.recorder.requestData();
      run.recorder.stop();
    }
  } catch {
    /* already gone */
  }

  await Promise.race([finalBlob, sleep(2_000)]);
  run.stream.getTracks().forEach((t) => t.stop());

  await Promise.race([drain(), sleep(opts.timeoutMs ?? 20_000)]);

  await fetch('/api/study/recording/stop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: run.id, chunks: run.nextSeq, reason }),
  }).catch(() => null);

  if (active?.id === run.id) active = null;
  emit({ status: 'ended', error: run.pending.length > 0 ? 'upload_failed' : snapshot.error });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
