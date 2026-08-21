/**
 * Writing a configuration — either kind.
 *
 * APPLY takes effect and stops there. SAVE takes effect and marks the point:
 * it is what the history lists and what the study measures. Both append a
 * snapshot, so the newest row is the current configuration either way and the
 * trail keeps every attempt.
 *
 * Neither judges, generates, or waits for a name — all of that is started
 * afterwards and none of it can make a write slow or fail (§6.1). The response
 * carries the new version so the board can relabel immediately, and the
 * follow-up work lands on the next poll.
 *
 * New intents arrive with a temporary negative id; the server replaces it with
 * one that is stable for the life of the assignment, so a judgment, an answer
 * and a logged event can all name the same intent across every later version.
 * Their POSITION is whatever position they arrive in: the array the board
 * sends is the order questions are tried in, so inserting above the intent
 * that currently owns a question is a client-side splice and nothing here
 * needs to know it happened.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { armOf } from '@/lib/study/config';
import { logStudyEvent } from '@/lib/study/events';
import { runAfterSave } from '@/lib/study/simple/after-save';
import { emptySnapshot, type SimpleIntent, type SimpleSnapshot } from '@/lib/study/simple/chain';
import { simpleContext } from '@/lib/study/simple/route-context';
import { getSimpleTip, nextSid, saveSimpleVersion } from '@/lib/study/simple/store';
import { recordIntentVersions } from '@/lib/study/simple/intent-versions';
import { STUDY_PROMPT_CHAR_LIMIT } from '@/lib/study/config';

export const dynamic = 'force-dynamic';

const intentSchema = z.object({
  // Negative (or absent) means "new" — the board mints a temporary id so a
  // child can point at a parent created in the same save, and the server
  // replaces both with real ones below.
  sid: z.number().int().nullable().optional(),
  title: z.string().max(120).default(''),
  definition: z.string().max(4000).default(''),
  rule: z.string().max(STUDY_PROMPT_CHAR_LIMIT).default(''),
});

const bodySchema = z.object({
  prompt: z.string().max(STUDY_PROMPT_CHAR_LIMIT).optional(),
  rootRule: z.string().max(STUDY_PROMPT_CHAR_LIMIT).optional(),
  intents: z.array(intentSchema).max(60).optional(),
  /** Defaulted to a save: a caller that does not know about the split is
   * asking for the thing that counts. */
  kind: z.enum(['apply', 'save']).default('save'),
  /** What the board had open, so the follow-up work starts where they are. */
  focusSid: z.number().int().positive().nullable().optional(),
  recentMessageIds: z.array(z.number().int()).max(40).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await simpleContext(id, new URL(request.url).searchParams.get('view'));
  if ('error' in gate) return gate.error;
  const { condition, seedPrompt } = gate.context;
  const arm = armOf(condition);

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const { snapshot: previous, version: previousVersion } = await getSimpleTip({
    assignmentId: id,
    condition,
    seedPrompt,
  });
  const base = previousVersion ? previous : emptySnapshot(arm, seedPrompt);

  // Stable ids for anything new, in the order they were sent.
  let allocate = await nextSid(id);
  const incoming = body.intents ?? base.intents;
  const intents: SimpleIntent[] = incoming.map((raw) => ({
    sid: raw.sid != null && raw.sid > 0 ? raw.sid : allocate++,
    title: raw.title ?? '',
    definition: raw.definition ?? '',
    rule: raw.rule ?? '',
  }));

  const snapshot: SimpleSnapshot = {
    arm,
    prompt: arm === 'baseline' ? body.prompt ?? base.prompt : base.prompt,
    rootRule: arm === 'score' ? body.rootRule ?? base.rootRule : base.rootRule,
    intents: arm === 'score' ? intents : [],
  };

  const version = await saveSimpleVersion({ assignmentId: id, snapshot, kind: body.kind });

  // The per-intent timeline the board reads. Only the intents whose when/then
  // pair actually moved get a version — editing one intent is not an event in
  // another one's history.
  const intentVersions = await recordIntentVersions({
    assignmentId: id,
    snapshot,
    configVersionNo: version.versionNo,
  });

  // One event either way, with the kind on it: an apply and a save are the
  // same act with a different claim, and the analysis wants to count both and
  // tell them apart.
  await logStudyEvent(id, 'simple_version_save', {
    condition,
    kind: body.kind,
    versionNo: version.versionNo,
    intents: snapshot.intents.length,
    ...describeSave(snapshot, previousVersion ? previous : null),
  });

  // Started, not awaited: naming, judging and prefetching all happen behind
  // the response.
  runAfterSave({
    assignmentId: id,
    condition,
    kind: body.kind,
    versionId: version.id,
    snapshot,
    previous: previousVersion ? previous : null,
    intentVersions,
    focusSid: body.focusSid ?? null,
    pinned: [],
    recentMessageIds: body.recentMessageIds ?? [],
  });

  return NextResponse.json({ versionNo: version.versionNo, id: version.id, kind: body.kind });
}

/**
 * What changed, in fields and characters — the shape RQ1 reads to tell "wrote
 * a new intent" from "tightened one line of one rule".
 */
function describeSave(next: SimpleSnapshot, prev: SimpleSnapshot | null) {
  if (next.arm === 'baseline') {
    const before = prev?.prompt ?? '';
    return {
      target: 'prompt',
      changed: before === next.prompt ? [] : ['prompt'],
      deltaChars: next.prompt.length - before.length,
    };
  }
  const prevById = new Map((prev?.intents ?? []).map((i) => [i.sid, i]));
  const created: number[] = [];
  const updated: { sid: number; fields: string[]; deltaChars: number }[] = [];
  for (const intent of next.intents) {
    const before = prevById.get(intent.sid);
    if (!before) {
      created.push(intent.sid);
      continue;
    }
    const fields: string[] = [];
    if (before.title !== intent.title) fields.push('title');
    if (before.definition !== intent.definition) fields.push('definition');
    if (before.rule !== intent.rule) fields.push('rule');
    if (fields.length > 0) {
      updated.push({
        sid: intent.sid,
        fields,
        deltaChars:
          intent.definition.length +
          intent.rule.length -
          (before.definition.length + before.rule.length),
      });
    }
  }
  const removed = (prev?.intents ?? [])
    .filter((i) => !next.intents.some((n) => n.sid === i.sid))
    .map((i) => i.sid);
  const rootChanged = (prev?.rootRule ?? '') !== next.rootRule;
  const order = next.intents.map((i) => i.sid).join(',');
  const prevOrder = (prev?.intents ?? []).map((i) => i.sid).join(',');
  return {
    target: 'tree',
    created,
    updated,
    removed,
    rootChanged,
    reordered: created.length === 0 && removed.length === 0 && order !== prevOrder,
  };
}
