'use client';

/**
 * The equipment check, before anything else in the session.
 *
 * WHY IT IS FIRST. On macOS, granting Chrome the screen-recording permission
 * requires quitting and reopening the browser — and it is still required for a
 * tab capture, because the grant is to the browser and not to a surface. A participant who discovers that
 * four minutes into a twenty-five minute block has lost the block; a
 * participant who discovers it here has lost two minutes, before the session
 * has started, while everyone is still on the main call.
 *
 * WHAT IT ACTUALLY TESTS. Not the permission — the whole pipeline. It records
 * three seconds for real, uploads the chunks, and closes the run. OS
 * permission, codec, chunk encoding, cookie auth, the proxy and the database
 * write are all proven on the participant's own machine, and the run it leaves
 * behind is what the console reads to say who is ready.
 *
 * AND THEN IT PLAYS IT BACK. This is the part that cannot be automated away.
 * The picker is a list of windows, and a participant who picks the wrong one
 * passes every check a machine can make — the surface really is a window, the
 * bytes really are there, the upload really did return 200 — and then records
 * twenty-five minutes of something else. Nothing in the file says what is in
 * it. So the clip is played back and the participant is asked whether they can
 * see this page moving in it. They are the detector, and they cost three
 * seconds.
 *
 * IT NEVER TRAPS ANYONE. After a failed attempt there is a way past. A
 * recording problem must not end someone's participation: the design
 * counterbalances four cells, and a participant lost to a screen-share picker
 * costs the study more than a missing video does.
 */
import { useEffect, useRef, useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import SharePickerHint from './SharePickerHint';
import {
  recordingSupported,
  reportRecordingEvent,
  requestScreen,
  startRecording,
  stopRecording,
  surfaceOf,
  surfaceOk,
} from '@/lib/study/recorder';

const PROBE_MS = 3_000;

type Stage =
  | 'intro'
  | 'arming'
  | 'recording'
  | 'playback'
  | 'passed'
  | 'denied'
  | 'wrong_surface'
  | 'unsupported'
  | 'upload_failed'
  | 'no_bytes';

/**
 * What the probe puts ON SCREEN while it records, and why it is loud.
 *
 * This is not decoration. The clip is three seconds of whatever the window is
 * showing, and the window is a mostly white page that does not move — so
 * played back it is indistinguishable from a photograph, and "can you see this
 * page MOVING in the video?" becomes a question nobody can answer honestly.
 * The check's whole value is that a participant can tell a real capture from a
 * black rectangle or from the wrong window, and that judgement needs something
 * in frame that visibly changes.
 *
 * So the three seconds are given something unmistakable: a counter that
 * changes every second, a bar that sweeps the full width continuously, rings
 * that pulse out of the centre, and a background that shifts hue. Any one
 * frame of the result is obviously this screen; any two frames are obviously
 * different from each other. Between them they also survive the capture
 * settings — six frames a second and a low bitrate flatten subtle motion, and
 * none of these are subtle.
 *
 * Under `prefers-reduced-motion` the sweep, the rings and the pulse stop. The
 * counter and the colour still change once a second, which is enough to answer
 * the question without anything sliding across the screen.
 */
function ProbeBeacon({ seconds }: { seconds: number }) {
  return (
    <div
      className="probe-beacon mx-auto mb-6 flex w-full max-w-xl flex-col items-center justify-center gap-3 overflow-hidden rounded-lg py-12"
      aria-label={`Recording, ${seconds} seconds left`}
    >
      <style>{`
        .probe-beacon {
          position: relative;
          background: #0b1020;
          animation: probe-hue 1s steps(1, end) infinite;
        }
        @keyframes probe-hue {
          0%   { background: #12224a; }
          33%  { background: #4a1230; }
          66%  { background: #123a2a; }
          100% { background: #12224a; }
        }
        .probe-sweep {
          position: absolute; inset: 0;
          background: linear-gradient(
            100deg, transparent 35%, rgba(255,255,255,0.55) 50%, transparent 65%
          );
          animation: probe-sweep 1.1s linear infinite;
        }
        @keyframes probe-sweep {
          from { transform: translateX(-100%); }
          to   { transform: translateX(100%); }
        }
        .probe-ring {
          position: absolute; top: 50%; left: 50%;
          width: 120px; height: 120px; margin: -60px 0 0 -60px;
          border: 3px solid rgba(255,255,255,0.6); border-radius: 9999px;
          animation: probe-ring 1.5s ease-out infinite;
        }
        .probe-ring:nth-child(2) { animation-delay: 0.5s; }
        .probe-ring:nth-child(3) { animation-delay: 1s; }
        @keyframes probe-ring {
          from { transform: scale(0.4); opacity: 0.9; }
          to   { transform: scale(2.4); opacity: 0; }
        }
        .probe-count { animation: probe-pop 1s ease-out infinite; }
        @keyframes probe-pop {
          0%   { transform: scale(1.35); }
          40%  { transform: scale(1); }
          100% { transform: scale(1); }
        }
        .probe-dot { animation: probe-blink 1s steps(1, end) infinite; }
        @keyframes probe-blink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0.15; } }

        @media (prefers-reduced-motion: reduce) {
          .probe-sweep, .probe-ring { display: none; }
          .probe-count, .probe-dot { animation: none; }
        }
      `}</style>

      <span className="probe-ring" />
      <span className="probe-ring" />
      <span className="probe-ring" />
      <span className="probe-sweep" />

      <span className="relative flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-white">
        <span className="probe-dot h-3 w-3 rounded-full bg-rose-500" />
        Recording
      </span>
      <span className="probe-count relative text-7xl font-bold tabular-nums leading-none text-white">
        {seconds}
      </span>
      <span className="relative text-sm text-white/80">
        Watch this — you will see it again in a moment.
      </span>
    </div>
  );
}

export default function RecordingCheck({
  passed,
  accessUrl,
  children,
}: {
  /** Whether a previous attempt already stored bytes. Read from the server,
   * not from this browser: the macOS fix is to quit Chrome, so anything held
   * client-side is gone for exactly the person who needed it. */
  passed: boolean;
  /** This participant's own link, shown on the failure that asks them to quit
   * Chrome — otherwise that instruction is "close the thing holding your only
   * way back in". */
  accessUrl: string | null;
  /** The walkthrough card, revealed once the check is settled. */
  children: React.ReactNode;
}) {
  const [stage, setStage] = useState<Stage>(passed ? 'passed' : 'intro');
  const [cleared, setCleared] = useState(passed);
  const [attempts, setAttempts] = useState(0);
  const [clipUrl, setClipUrl] = useState<string | null>(null);
  /** Seconds left in the probe, so the wait is a visible thing happening. */
  const [countdown, setCountdown] = useState(0);
  const [playFailed, setPlayFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    return () => {
      if (clipUrl) URL.revokeObjectURL(clipUrl);
    };
  }, [clipUrl]);

  const fail = (next: Stage, kind: string) => {
    setStage(next);
    setAttempts((n) => n + 1);
    void reportRecordingEvent(kind);
  };

  const run = async () => {
    if (!recordingSupported()) {
      fail('unsupported', 'unsupported_browser');
      return;
    }
    setStage('arming');
    void reportRecordingEvent('check_started');

    let stream: MediaStream;
    try {
      // Straight off the click — no await in front of it, or the gesture that
      // authorises the picker is already spent.
      stream = await requestScreen();
    } catch {
      fail('denied', 'permission_denied');
      return;
    }

    const surface = surfaceOf(stream);
    if (!surfaceOk(surface)) {
      stream.getTracks().forEach((t) => t.stop());
      fail('wrong_surface', 'wrong_surface');
      return;
    }

    // Keep a local copy purely to play back. The uploaded chunks are the
    // record; this is the participant's own eyes on what was captured.
    const parts: Blob[] = [];
    const sniff = new MediaRecorder(stream, { mimeType: 'video/webm' });
    sniff.ondataavailable = (e) => {
      if (e.data?.size) parts.push(e.data);
    };

    try {
      setStage('recording');
      sniff.start(1_000);
      await startRecording({ stream, probe: true });
      // Counted down on screen rather than spun: three seconds of a spinner is
      // indistinguishable from three seconds of something being stuck.
      setCountdown(Math.round(PROBE_MS / 1000));
      const ticking = setInterval(() => setCountdown((n) => Math.max(0, n - 1)), 1_000);
      await new Promise((r) => setTimeout(r, PROBE_MS));
      clearInterval(ticking);
      setCountdown(0);
      sniff.stop();
      await stopRecording('probe', { timeoutMs: 8_000 });
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      fail('upload_failed', 'upload_failed');
      return;
    }

    stream.getTracks().forEach((t) => t.stop());

    const blob = new Blob(parts, { type: 'video/webm' });
    if (blob.size === 0) {
      fail('no_bytes', 'check_failed');
      return;
    }
    setClipUrl(URL.createObjectURL(blob));
    setPlayFailed(false);
    setStage('playback');
  };

  const confirmPlayback = (visible: boolean) => {
    if (visible) {
      void reportRecordingEvent('playback_confirmed');
      void reportRecordingEvent('check_passed');
      setStage('passed');
      setCleared(true);
      return;
    }
    void reportRecordingEvent('playback_rejected');
    fail('wrong_surface', 'check_failed');
  };

  const skip = () => {
    void reportRecordingEvent('check_skipped');
    setCleared(true);
    setStage('passed');
  };

  const busy = stage === 'arming' || stage === 'recording';

  return (
    <div className="space-y-5">
      {!cleared || stage !== 'passed' ? (
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-8">
          <h1 className="text-xl font-semibold mb-2 text-center">Check your recording</h1>

          {stage === 'playback' ? (
            <>
              <p className="text-base text-[hsl(var(--muted-foreground))] mb-4 leading-relaxed text-center">
                Here are the three seconds we just recorded — the countdown you were watching.
                It plays once; press{' '}
                <strong className="text-[hsl(var(--foreground))]">Play again</strong> to see it as
                many times as you like.
              </p>
              {/* No `loop`. A MediaRecorder file has no duration and no seek
                  index, so looping it means seeking to zero, which fails — the
                  clip played once and then sat on a black frame that read as a
                  stuck loader. Replay reloads the source instead, which decodes
                  from the start and needs no seeking. `controls` is on so the
                  thing at least looks like a video while it is not playing. */}
              <video
                ref={videoRef}
                src={clipUrl ?? undefined}
                autoPlay
                muted
                playsInline
                controls
                onError={() => setPlayFailed(true)}
                className="mx-auto mb-3 w-full max-w-xl min-h-[220px] rounded-lg border-2 border-[hsl(var(--primary))] bg-black"
              />
              <div className="mb-5 flex justify-center">
                <button
                  onClick={() => {
                    const v = videoRef.current;
                    if (!v) return;
                    v.load();
                    void v.play().catch(() => setPlayFailed(true));
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[hsl(var(--border))] px-4 py-2 text-sm font-semibold hover:bg-[hsl(var(--muted))]"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Play again
                </button>
              </div>
              {playFailed && (
                <p className="mb-4 text-center text-sm font-semibold text-amber-800">
                  The clip would not play here. Answer &ldquo;No&rdquo; below and press Check
                  again.
                </p>
              )}
              <p className="text-base font-semibold mb-4 text-center">
                Can you see the countdown in the video?
              </p>
              <div className="flex justify-center gap-3">
                <button
                  onClick={() => confirmPlayback(true)}
                  className="rounded-lg bg-[hsl(var(--primary))] px-6 py-3 text-base font-semibold text-white"
                >
                  Yes, I can see it
                </button>
                <button
                  onClick={() => confirmPlayback(false)}
                  className="rounded-lg border border-[hsl(var(--border))] px-6 py-3 text-base font-semibold hover:bg-[hsl(var(--muted))]"
                >
                  No, it shows something else
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="text-base text-[hsl(var(--muted-foreground))] mb-6 leading-relaxed mx-auto max-w-lg space-y-3">
                {stage === 'intro' && (
                  <>
                    <p>
                      We record{' '}
                      <strong className="text-[hsl(var(--foreground))]">this browser window</strong>{' '}
                      while you work, so we can see what you did. Nothing else on your computer
                      is recorded — not your other applications, not your desktop.
                    </p>
                    <p>
                      When you press the button below, your browser asks what to share. It looks
                      like this:
                    </p>
                  </>
                )}
                {stage === 'intro' && <SharePickerHint />}
                {stage === 'intro' && (
                  <>
                    <p>
                      We then record for three seconds and play it back, so you can check it
                      works before we start.
                    </p>
                  </>
                )}

                {stage === 'denied' && (
                  <>
                    <p>
                      The window was not shared. If the chooser closed without you picking
                      anything, just press Check again.
                    </p>
                    <p>
                      <strong className="text-[hsl(var(--foreground))]">On a Mac</strong>, if your
                      browser said it needs permission: open System Settings → Privacy &amp;
                      Security → Screen &amp; System Audio Recording, turn your browser on, then{' '}
                      <strong className="text-[hsl(var(--foreground))]">
                        quit the browser completely (⌘Q)
                      </strong>{' '}
                      and open your link again. This is the only step that needs a restart,
                      which is why we do it now.
                    </p>
                    {accessUrl && (
                      <p className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-3 py-2">
                        Your link, to come back to:{' '}
                        <span className="font-mono text-sm break-all text-[hsl(var(--foreground))]">
                          {accessUrl}
                        </span>
                      </p>
                    )}
                  </>
                )}

                {stage === 'wrong_surface' && (
                  <>
                    <p>
                      That shared a single tab rather than the whole window. A tab share puts a
                      bar across the top of the page and leaves you less room to work. Press
                      Check again and pick it like this:
                    </p>
                  </>
                )}
                {stage === 'wrong_surface' && <SharePickerHint />}

                {stage === 'unsupported' && (
                  <p>
                    This browser cannot record a window. Please join from Google Chrome on a
                    desktop or laptop, then open your link again.
                  </p>
                )}

                {stage === 'no_bytes' && (
                  <p>
                    The recording came out empty. Press Check again — and if it happens twice,
                    say so on the Zoom call and carry on.
                  </p>
                )}

                {stage === 'upload_failed' && (
                  <p>
                    Your screen recorded, but we could not send it to us. Press Check again. If
                    it fails again, say so on the Zoom call — you can carry on either way.
                  </p>
                )}

                {stage === 'arming' && <p>Waiting for you to choose a window…</p>}
              </div>

              {/* The probe, while it runs, in the same place and at the same
                  size the clip will appear — so the card does not jump, and so
                  three seconds of waiting looks like three seconds of
                  recording rather than like something having hung. */}
              {stage === 'recording' && <ProbeBeacon seconds={countdown} />}

              <div className="flex flex-col items-center gap-3">
                <button
                  onClick={() => void run()}
                  disabled={busy}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-[hsl(var(--primary))] px-7 py-3 text-base font-semibold text-white disabled:opacity-60"
                >
                  {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                  {stage === 'intro' ? 'Check my recording' : 'Check again'}
                </button>

                {/* Only after something has actually gone wrong: offered up
                    front it becomes the path of least resistance, and the
                    check stops happening. */}
                {attempts > 0 && !busy && (
                  <button
                    onClick={skip}
                    className="text-sm font-medium text-[hsl(var(--muted-foreground))] underline underline-offset-2"
                  >
                    Continue without checking
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      ) : null}

      {cleared && (
        <>
          {stage === 'passed' && (
            <p className="text-center text-sm text-[hsl(var(--muted-foreground))]">
              Recording is ready. Your browser will ask for the window once more at the start of
              each round.
            </p>
          )}
          {children}
        </>
      )}
    </div>
  );
}
