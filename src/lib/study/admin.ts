/**
 * Researcher (admin) accounts for the set-curation tool.
 *
 * Same shape as the participant accounts in provision.ts — a real
 * administrator-role instructors row with NO password, signed in through a
 * passcode route rather than email/password (getInstructor gates on role only).
 * The difference is the role and that nothing is cloned: curation reads the
 * masters directly, which administrators may already do via authorizeAssignment.
 *
 * "Pre-registered" = the code must be listed in STUDY_ADMIN_CODES; the row
 * itself is created on first sign-in.
 */
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/db/db';
import { instructors, type Instructor } from '@/db/schema';
import { ADMIN_EMAIL_DOMAIN, PARTICIPANT_NUMBER_RE, STUDY_ADMIN_CODES } from './config';

/** Canonical researcher code: trimmed, inner whitespace removed, uppercased. */
export function normalizeAdminCode(input: string): string {
  return input.trim().replace(/\s+/g, '').toUpperCase();
}

/** Whether a (normalized) code is both well-formed and pre-registered. */
export function isRegisteredAdminCode(normalized: string): boolean {
  return PARTICIPANT_NUMBER_RE.test(normalized) && STUDY_ADMIN_CODES.includes(normalized);
}

function adminEmail(code: string): string {
  return `${code.toLowerCase()}@${ADMIN_EMAIL_DOMAIN}`;
}

/**
 * Find-or-create the researcher's administrator account. Race-safe on the
 * instructors.email unique index (concurrent first sign-ins re-resolve).
 */
export async function ensureAdminAccount(code: string): Promise<Instructor> {
  const normalized = normalizeAdminCode(code);
  const email = adminEmail(normalized);

  const existing = await db.query.instructors.findFirst({ where: eq(instructors.email, email) });
  if (existing) return existing;

  try {
    const [row] = await db
      .insert(instructors)
      .values({
        id: randomUUID(),
        email,
        password: null,
        firstName: 'Researcher',
        lastName: normalized,
        role: 'administrator',
        isVerified: true,
        createdAt: new Date(),
      })
      .returning();
    return row;
  } catch (err) {
    const after = await db.query.instructors.findFirst({ where: eq(instructors.email, email) });
    if (after) return after;
    throw err;
  }
}

/** The researcher code behind an admin account row (for authorship stamps). */
export function adminCodeOf(user: { email: string; lastName?: string | null }): string {
  if (user.email.endsWith(`@${ADMIN_EMAIL_DOMAIN}`)) {
    return user.email.slice(0, -1 - ADMIN_EMAIL_DOMAIN.length).toUpperCase();
  }
  return user.lastName ?? user.email;
}
