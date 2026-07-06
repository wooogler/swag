/**
 * Shared authorization for SCORE instructor APIs: administrators may operate
 * on any assignment, instructors only on their own. (Deliberately the
 * admin-or-owner rule from the classify route, NOT the stricter owner-only
 * rule of PUT /api/assignments/[id] — admins must be able to run SCORE on
 * dataset assignments they don't own.)
 */
import { and, eq } from 'drizzle-orm';
import { db } from '@/db/db';
import { assignments, type Assignment, type Instructor } from '@/db/schema';
import { getInstructor, isAdministrator } from '@/lib/auth';

export type AssignmentAuth =
  | { error: 'unauthorized' | 'not_found' }
  | { assignment: Assignment; instructor: Instructor };

/** Verify the caller may access this assignment; returns it (plus the caller)
 * or an error tag the route maps to 401/404. */
export async function authorizeAssignment(id: string): Promise<AssignmentAuth> {
  const instructor = await getInstructor();
  if (!instructor) return { error: 'unauthorized' };

  const assignment = await db.query.assignments.findFirst({
    where: isAdministrator(instructor)
      ? eq(assignments.id, id)
      : and(eq(assignments.id, id), eq(assignments.instructorId, instructor.id)),
  });
  if (!assignment) return { error: 'not_found' };
  return { assignment, instructor };
}

export function authErrorResponse(error: 'unauthorized' | 'not_found') {
  return { body: { error }, status: error === 'unauthorized' ? 401 : 404 } as const;
}
