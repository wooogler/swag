/**
 * User-study sign-in — self-service, no pre-provisioning.
 *
 * Participant enters their number + the shared study passcode. If the number is
 * new, their own clone of the master dataset is created ON THE SPOT, then the
 * standard `user_session` cookie is set (the participant is a real
 * instructor-role account owning only their clone) and they are sent to their
 * SCORE board. Returning participants just sign back into the same clone.
 */
import { NextResponse } from 'next/server';
import { cookies, headers } from 'next/headers';
import { timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/db';
import { instructors, studyParticipants } from '@/db/schema';
import {
  STUDY_PASSCODE,
  STUDY_SESSION_MAX_AGE_SECONDS,
} from '@/lib/study/config';
import {
  ensureStudyTables,
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

    // Find-or-create: a brand-new number provisions a clone of every dataset
    // here (a few seconds on first sign-in); a returning one resolves instantly.
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

    // Land on the dashboard, which lists all of this participant's dataset boards.
    return NextResponse.json({
      success: true,
      participantNumber: participant.participantNumber,
      datasets: clones.map((c) => c.datasetKey),
      redirect: '/instructor/dashboard',
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
