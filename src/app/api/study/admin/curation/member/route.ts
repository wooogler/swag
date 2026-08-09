/**
 * Assign a master question to a curated set, or clear it.
 *
 * The classification snapshot stored with the row is derived server-side, and
 * demo-isolated questions are refused here rather than only being greyed out in
 * the UI — isolation is a property of the sets, not of one screen.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isDemoIsolated, setSetMember } from '@/lib/study/curation';
import { CURATION_SET_KINDS } from '@/lib/study/config';
import { requireAdmin } from '@/lib/study/admin-guard';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  datasetKey: z.string().min(1),
  messageId: z.number().int().positive(),
  setKind: z.enum(CURATION_SET_KINDS as [string, ...string[]]).nullable(),
});

export async function PUT(req: Request) {
  const gate = await requireAdmin();
  if (gate.response) return gate.response;

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  try {
    if (parsed.setKind !== null && (await isDemoIsolated(parsed.datasetKey, parsed.messageId))) {
      return NextResponse.json(
        { error: 'demo_isolated', message: '데모 subtype으로 격리된 학생의 질문입니다.' },
        { status: 409 }
      );
    }

    await setSetMember({
      datasetKey: parsed.datasetKey,
      messageId: parsed.messageId,
      setKind: parsed.setKind as never,
      addedBy: gate.actor.code,
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'curation_locked') {
      return NextResponse.json(
        { error: 'locked', message: '확정된 세트입니다 — 잠금을 해제한 뒤 수정하세요.' },
        { status: 409 }
      );
    }
    console.error('curation member error:', err);
    return NextResponse.json({ error: 'assign_failed' }, { status: 500 });
  }
}
