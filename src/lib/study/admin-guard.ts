/**
 * Shared admin gate for the curation API routes.
 *
 * There is no middleware in this app — every page and route guards itself
 * (see /api/instructor/score/config for the canonical 401/403 sequence). This
 * wraps that sequence so the curation routes cannot drift apart.
 */
import { NextResponse } from 'next/server';
import { getInstructor, isAdministrator } from '@/lib/auth';
import { adminCodeOf } from './admin';

export interface AdminActor {
  id: string;
  code: string;
}

/** Resolve the researcher, or the response to return instead. */
export async function requireAdmin(): Promise<
  { actor: AdminActor; response?: never } | { actor?: never; response: NextResponse }
> {
  const instructor = await getInstructor();
  if (!instructor) {
    return { response: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  }
  if (!isAdministrator(instructor)) {
    return {
      response: NextResponse.json(
        { error: 'forbidden', message: 'Set curation is administrator-only.' },
        { status: 403 }
      ),
    };
  }
  return { actor: { id: instructor.id, code: adminCodeOf(instructor) } };
}
