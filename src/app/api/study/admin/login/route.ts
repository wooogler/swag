/**
 * Researcher sign-in for the set-curation tool.
 *
 * Mirrors the participant route (/api/study/login): shared passcode, in-memory
 * throttle, same `user_session` cookie. Two differences — the code must be
 * PRE-REGISTERED in STUDY_ADMIN_CODES, and the account minted is
 * administrator-role, which is what curation and the master reads gate on.
 * Nothing is cloned: curation works on the masters in place.
 */
import { NextResponse } from 'next/server';
import { cookies, headers } from 'next/headers';
import { timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/db';
import { instructors } from '@/db/schema';
import {
  STUDY_ADMIN_CODES,
  STUDY_ADMIN_PASSCODE,
  STUDY_SESSION_MAX_AGE_SECONDS,
} from '@/lib/study/config';
import { ensureStudyTables } from '@/lib/study/store';
import { ensureAdminAccount, isRegisteredAdminCode, normalizeAdminCode } from '@/lib/study/admin';

const loginSchema = z.object({
  code: z.string().min(1),
  passcode: z.string().min(1),
});

/** Constant-time compare (length is not secret for a shared passcode). */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

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

    // Unset passcode/roster closes the tool rather than opening it — an empty
    // env must never mean "no passcode required".
    if (!STUDY_ADMIN_PASSCODE || STUDY_ADMIN_CODES.length === 0) {
      return NextResponse.json(
        { error: 'Curation access is not configured on this server.' },
        { status: 503 }
      );
    }

    await ensureStudyTables();
    const body = await request.json();
    const { code, passcode } = loginSchema.parse(body);

    const normalized = normalizeAdminCode(code);
    // One indistinguishable message for a bad passcode and an unregistered
    // code, so the roster cannot be enumerated.
    if (!safeEqual(passcode, STUDY_ADMIN_PASSCODE) || !isRegisteredAdminCode(normalized)) {
      return NextResponse.json({ error: 'Invalid researcher code or passcode' }, { status: 401 });
    }

    const account = await ensureAdminAccount(normalized);
    await db.update(instructors).set({ lastLoginAt: new Date() }).where(eq(instructors.id, account.id));

    const cookieStore = await cookies();
    cookieStore.set('user_session', account.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: STUDY_SESSION_MAX_AGE_SECONDS,
      path: '/',
    });

    return NextResponse.json({ success: true, code: normalized, redirect: '/study/admin/curation' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Enter both a researcher code and the passcode' }, { status: 400 });
    }
    console.error('Curation sign-in error:', error);
    return NextResponse.json({ error: 'Sign-in failed' }, { status: 500 });
  }
}
