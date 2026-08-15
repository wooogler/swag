/**
 * User-study sign-in by ID + shared passcode — the recovery door.
 *
 * The way in is normally the participant's own link (/study/s/<token>), issued
 * by the researcher along with the cell they assigned. This door stays open
 * because a link can be lost mid-session and a facilitator needs a way back to
 * a workspace that already exists — but it no longer CREATES anything. An
 * unknown ID is refused, because a participant who could sign themselves up
 * would be provisioned into a cell nobody chose, which is the thing assignment
 * exists to prevent.
 */
import { NextResponse } from 'next/server';
import { cookies, headers } from 'next/headers';
import { timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/db';
import { instructors, studyParticipants } from '@/db/schema';
import {
  STUDY_ADMIN_CODES,
  STUDY_PASSCODE,
  STUDY_SESSION_MAX_AGE_SECONDS,
} from '@/lib/study/config';
import {
  ensureStudyTables,
  getParticipantByNumber,
  isValidParticipantNumber,
  normalizeParticipantNumber,
} from '@/lib/study/store';
import { ensureParticipantSetup } from '@/lib/study/provision';

const loginSchema = z.object({
  participantNumber: z.string().min(1),
  passcode: z.string().min(1),
});

/** Constant-time string compare (length is not secret for a shared passcode). */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/* Lightweight in-memory throttle — single-process, ample for an in-person lab
 * study. Caps passcode-spray attempts per client. */
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 12;
const attempts = new Map<string, { count: number; resetAt: number }>();
function rateLimited(key: string): boolean {
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || now > rec.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  rec.count += 1;
  return rec.count > MAX_ATTEMPTS;
}

export async function POST(request: Request) {
  try {
    const hdrs = await headers();
    const ip = (hdrs.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'local';
    if (rateLimited(ip)) {
      return NextResponse.json(
        { error: 'Too many attempts. Wait a minute and try again.' },
        { status: 429 }
      );
    }

    await ensureStudyTables();
    const body = await request.json();
    const { participantNumber, passcode } = loginSchema.parse(body);

    if (!safeEqual(passcode, STUDY_PASSCODE)) {
      return NextResponse.json({ error: 'Invalid participant ID or passcode' }, { status: 401 });
    }

    const number = normalizeParticipantNumber(participantNumber);
    if (!isValidParticipantNumber(number)) {
      return NextResponse.json(
        { error: 'Participant ID may use only letters, digits, "-" and "_" (max 32).' },
        { status: 400 }
      );
    }
    // A researcher code is not a participant number. Without this, a researcher
    // who lands on the participant door and types their own code gets a
    // participant account — clones and all — sitting in the roster as if it
    // were a session. Point them at their own door instead.
    if (STUDY_ADMIN_CODES.includes(number)) {
      return NextResponse.json(
        { error: 'That is a researcher code — sign in at /study/admin instead.' },
        { status: 400 }
      );
    }

    // Must already exist — creating participants is the researcher's job, in
    // the console, where the cell is chosen. Same message as a wrong passcode:
    // this door should not report which IDs are real.
    const known = await getParticipantByNumber(number);
    if (!known) {
      return NextResponse.json({ error: 'Invalid participant ID or passcode' }, { status: 401 });
    }
    // Finished means finished, on this door too — otherwise the recovery path
    // would quietly be a way around the expiry the link enforces.
    if (known.phase === 'done') {
      return NextResponse.json(
        { error: 'This study session is finished — thank you.' },
        { status: 403 }
      );
    }
    const { participant, clones } = await ensureParticipantSetup(number);

    const now = new Date();
    await Promise.all([
      db.update(studyParticipants).set({ lastLoginAt: now }).where(eq(studyParticipants.id, participant.id)),
      db.update(instructors).set({ lastLoginAt: now }).where(eq(instructors.id, participant.instructorId)),
    ]);

    const cookieStore = await cookies();
    cookieStore.set('user_session', participant.instructorId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: STUDY_SESSION_MAX_AGE_SECONDS,
      path: '/',
    });

    // Land on the session page, which shows only what the current phase allows.
    // (The instructor dashboard lists BOTH clones at once, which would hand a
    // participant the second block's material before its tutorial.)
    return NextResponse.json({
      success: true,
      participantNumber: participant.participantNumber,
      datasets: clones.map((c) => c.datasetKey),
      redirect: '/study/session',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Enter both a participant ID and the study passcode' },
        { status: 400 }
      );
    }
    console.error('Study login error:', error);
    return NextResponse.json({ error: 'Sign-in failed' }, { status: 500 });
  }
}
