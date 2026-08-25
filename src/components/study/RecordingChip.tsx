'use client';

/**
 * Whether the screen is being recorded, in the board header, for the
 * participant's eyes.
 *
 * IT IS NOT A GATE. When recording stops mid-block — they pressed the browser's
 * own "Stop sharing", the laptop slept, the upload broke — the board keeps
 * working and the hand-off keeps working. Covering the board with a modal while
 * the twenty-five minutes ran would turn an infrastructure failure into
 * contamination of the primary measure, which is how much of the log they got
 * through in that time. Losing part of a recording is cheaper than that, and
 * far cheaper than losing the participant.
 *
 * SO THE ONLY THING IT DOES IS SAY SO, AND OFFER THE FIX. Resume needs a click
 * because a fresh capture needs a fresh user gesture; no API can restart one on
 * its own.
 *
 * It reads like its neighbour, the elapsed minutes: same size, same border,
 * same muted text, no icon, no animation, no fill. Recording is the ordinary
 * state and the ordinary state should not be shouting. Only the stopped state
 * takes a colour, and it takes the same rose the clock uses past the budget —
 * one vocabulary in the header, not two.
 *
 * Identical component, identical position, in all four condition views: it
 * hangs off StudioHeader, which the simple and full boards both render. A
 * recording affordance that existed in one arm would be a difference between
 * the conditions that has nothing to do with what the study manipulates.
 */
import { useSyncExternalStore, useState } from 'react';
import {
  recorderSnapshot,
  recordingSupported,
  reportRecordingEvent,
  requestScreen,
  startRecording,
  subscribeRecorder,
  surfaceOf,
  surfaceOk,
  type RecorderSnapshot,
} from '@/lib/study/recorder';

const SERVER_SNAPSHOT: RecorderSnapshot = {
  status: 'idle',
  block: 0,
  produced: 0,
  sent: 0,
  bytes: 0,
  error: null,
};

export default function RecordingChip() {
  const snap = useSyncExternalStore(subscribeRecorder, recorderSnapshot, () => SERVER_SNAPSHOT);
  const [busy, setBusy] = useState(false);

  const resume = async () => {
    if (!recordingSupported()) return;
    setBusy(true);
    try {
      const stream = await requestScreen();
      const surface = surfaceOf(stream);
      if (!surfaceOk(surface)) {
        stream.getTracks().forEach((t) => t.stop());
        void reportRecordingEvent('wrong_surface', { where: 'resume' });
        return;
      }
      await startRecording({ stream });
      void reportRecordingEvent('resumed');
    } catch {
      void reportRecordingEvent('permission_denied', { where: 'resume' });
    } finally {
      setBusy(false);
    }
  };

  if (snap.status === 'recording' || snap.status === 'starting') {
    return (
      <span
        title="This browser window is being recorded for this round."
        className="shrink-0 select-none rounded border border-[hsl(var(--border))] px-2.5 py-1.5 text-xs text-[hsl(var(--muted-foreground))]"
      >
        Recording
      </span>
    );
  }

  // 'idle' before the briefing has been through, which is a beat, not a state
  // worth a chip. Anything after that is stopped, and stopped is worth saying.
  if (snap.status === 'idle') return null;

  return (
    <button
      onClick={() => void resume()}
      disabled={busy}
      title="Recording stopped. Press to share this window again."
      className="shrink-0 rounded border border-[hsl(var(--border))] px-2.5 py-1.5 text-xs font-medium text-rose-700 hover:bg-[hsl(var(--muted))] disabled:opacity-60"
    >
      Not recording · Resume
    </button>
  );
}
