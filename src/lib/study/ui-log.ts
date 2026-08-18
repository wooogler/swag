'use client';

/**
 * Client-side instrumentation for the acts that never reach the server.
 *
 * Everything else in the trail is a write — a pin, a rule save, a fold, a
 * deploy — and writes log themselves in the route that performs them. But the
 * board browses entirely in React state: choosing a type, opening a question,
 * opening and closing a workbench never touch the network, so from the trail
 * alone a type the participant read carefully and one they never looked at are
 * the same thing. That distinction is the difference between "they did not
 * cover Reviewing" and "they read Reviewing and were content with it", which
 * are different answers to RQ1.
 *
 * SHARED SURFACES ONLY. Both conditions run the same board, so logging the
 * type scope, the opened question and the workbench/modal dwell keeps the two
 * arms instrumented alike — the parity rule that STUDY_TRAIL_SPEC §1.3 was
 * protecting when it excluded reads wholesale. Scroll, hover and keystrokes
 * stay unlogged; the screen recording keeps those.
 *
 * Batched and fire-and-forget: instrumentation must never add a round trip to
 * a click, and a failed beacon must never surface to a participant mid-session.
 */
import { useEffect, useRef } from 'react';

interface Queued {
  type: string;
  /** Client clock at the moment it happened — only ever used as a DELTA. */
  at: number;
  payload?: Record<string, unknown>;
}

const FLUSH_AFTER_MS = 4000;
const MAX_QUEUE = 25;

let queue: Queued[] = [];
let assignment: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let listening = false;

/** Record one UI act. Cheap and synchronous — the flush happens later. */
export function logUi(
  assignmentId: string,
  type: string,
  payload?: Record<string, unknown>
): void {
  if (typeof window === 'undefined') return;
  // Two boards in one session would interleave; flush the old one first so a
  // batch never carries events from an assignment it is not addressed to.
  if (assignment && assignment !== assignmentId) flush();
  assignment = assignmentId;
  queue.push({ type, at: Date.now(), payload });
  listen();
  if (queue.length >= MAX_QUEUE) flush();
  else if (!timer) timer = setTimeout(() => flush(), FLUSH_AFTER_MS);
}

/**
 * Send what is queued.
 *
 * Each event carries how long ago it happened rather than when: the server
 * subtracts that from its own clock, so a participant's machine being minutes
 * off — or correcting itself mid-session — cannot move an event in the trail.
 */
function flush(beacon = false): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (queue.length === 0 || !assignment) return;
  const batch = queue;
  const target = assignment;
  queue = [];
  const now = Date.now();
  const body = JSON.stringify({
    events: batch.map((e) => ({
      type: e.type,
      agoMs: Math.max(0, now - e.at),
      payload: e.payload ?? null,
    })),
  });
  const url = `/api/instructor/assignments/${target}/score/ui-events`;
  try {
    if (beacon && typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
      return;
    }
    void fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      // Survives the tab being closed mid-request.
      keepalive: true,
    }).catch(() => {
      /* instrumentation never surfaces */
    });
  } catch {
    /* instrumentation never surfaces */
  }
}

/** Flush now — used when a surface closes, so its dwell lands promptly. */
export function flushUi(): void {
  flush();
}

/** A page being hidden or closed is the one moment the queue would be lost. */
function listen(): void {
  if (listening || typeof document === 'undefined') return;
  listening = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush(true);
  });
  window.addEventListener('pagehide', () => flush(true));
}

/**
 * Log open/close of a surface, with how long it stayed open.
 *
 * `key` identifies WHAT is open (an intent id, a question id, a scope label)
 * and null means closed. A change from one key to another is a close followed
 * by an open, which is what switching directly between two intents is.
 *
 * The dwell is the measure: a fold proposal accepted two seconds after it
 * arrived and one accepted after ninety are the same event in every other
 * record we keep, and they are not the same act.
 */
export function useSurfaceLog(
  assignmentId: string,
  openType: string,
  closeType: string,
  key: string | number | null,
  payload?: Record<string, unknown>
): void {
  // Read through a ref: the payload is rebuilt every render, and depending on
  // it would log an open per render.
  const payloadRef = useRef(payload);
  payloadRef.current = payload;
  const openRef = useRef<{
    key: string | number;
    at: number;
    payload?: Record<string, unknown>;
  } | null>(null);

  useEffect(() => {
    const prev = openRef.current;
    if (prev && prev.key !== key) {
      logUi(assignmentId, closeType, {
        ...prev.payload,
        dwellMs: Math.round(performance.now() - prev.at),
      });
      openRef.current = null;
    }
    if (key !== null && openRef.current === null) {
      openRef.current = { key, at: performance.now(), payload: payloadRef.current };
      logUi(assignmentId, openType, payloadRef.current);
    }
  }, [assignmentId, openType, closeType, key]);

  // Leaving the page closes whatever is open — otherwise the last surface of a
  // block, which is often the one they were still working in, has no dwell.
  useEffect(
    () => () => {
      const prev = openRef.current;
      if (prev) {
        logUi(assignmentId, closeType, {
          ...prev.payload,
          dwellMs: Math.round(performance.now() - prev.at),
        });
        openRef.current = null;
      }
      flush();
    },
    [assignmentId, closeType]
  );
}
