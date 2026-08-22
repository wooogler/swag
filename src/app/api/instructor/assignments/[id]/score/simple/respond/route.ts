/**
 * What the chatbot would say to one question, under the configuration
 * currently being viewed.
 *
 * A hit comes back as JSON and lands instantly. A miss streams, because the
 * question this screen answers — "what does my configuration do here" — is
 * one people stop asking if it costs eight silent seconds every time.
 *
 * Which rule applies is resolved HERE, from the same chain compiler the board
 * draws with, so what is shown is what would be sent. The client does not get
 * to name a rule: it names a question and a version.
 *
 * A rule still identical to the assignment's own prompt is answered by the
 * conversation that is already on the screen. That prompt is what produced the
 * logged reply, so generating a second one under it would put a different
 * answer in front of the reader and make an untouched configuration look like
 * it had done something. It is also the state every participant starts in and
 * spends the first minutes of a block in, so it is the difference between the
 * board opening instantly and the board opening sixty generations deep.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isOpenAIConfigured } from '@/lib/score/classifier';
import { logStudyEvent } from '@/lib/study/events';
import {
  compileSimpleChain,
  definitionsOf,
  resolveSimpleOwnership,
  ruleForOwner,
} from '@/lib/study/simple/chain';
import { definitionTasks, readMatches } from '@/lib/study/simple/judge';
import { readCachedResponses, simpleRuleHash, streamResponse } from '@/lib/study/simple/respond';
import { simpleContext } from '@/lib/study/simple/route-context';
import { getSimpleTip, getSimpleVersion } from '@/lib/study/simple/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * WHAT would answer this question, without answering it.
 *
 * The same resolution the POST does, stopping at the rule. The reply screen
 * shows the rule that produced what it is showing, and a rule runs to
 * thousands of characters — too much for a response header, and the streaming
 * path has nowhere else to put it. So it is asked for separately, which also
 * means the client has ONE place it learns the rule from rather than one for
 * cache hits and another for misses.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const gate = await simpleContext(id, url.searchParams.get('view'));
  if ('error' in gate) return gate.error;
  const { condition, seedPrompt } = gate.context;

  const messageId = Number(url.searchParams.get('messageId'));
  if (!Number.isFinite(messageId)) {
    return NextResponse.json({ error: 'invalid_query' }, { status: 400 });
  }
  const versionParam = url.searchParams.get('versionNo');
  const snapshot =
    versionParam != null
      ? await getSimpleVersion({
          assignmentId: id,
          condition,
          seedPrompt,
          versionNo: Number(versionParam),
        })
      : (await getSimpleTip({ assignmentId: id, condition, seedPrompt })).snapshot;
  if (!snapshot) return NextResponse.json({ error: 'no_such_version' }, { status: 404 });

  let sid: number | null = null;
  if (snapshot.arm === 'score') {
    const tasks = definitionTasks(definitionsOf(snapshot));
    const matches = await readMatches({ assignmentId: id, tasks });
    const ownership = resolveSimpleOwnership(
      snapshot,
      compileSimpleChain(snapshot),
      matches.get(messageId) ?? new Map()
    );
    if (ownership.outcome === 'pending') return NextResponse.json({ status: 'pending' });
    sid = ownership.sid;
  }
  return NextResponse.json({ sid, rule: ruleForOwner(snapshot, sid) });
}

const bodySchema = z.object({
  messageId: z.number().int(),
  /** Look at this question under an older version, without leaving the tip. */
  versionNo: z.number().int().positive().nullable().optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await simpleContext(id, new URL(request.url).searchParams.get('view'));
  if ('error' in gate) return gate.error;
  const { condition, seedPrompt } = gate.context;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const tip = await getSimpleTip({ assignmentId: id, condition, seedPrompt });
  const snapshot =
    body.versionNo != null
      ? await getSimpleVersion({ assignmentId: id, condition, seedPrompt, versionNo: body.versionNo })
      : tip.snapshot;
  if (!snapshot) return NextResponse.json({ error: 'no_such_version' }, { status: 404 });

  // Who answers this question under that snapshot.
  let sid: number | null = null;
  let outcome: string = 'root';
  if (snapshot.arm === 'score') {
    const tasks = definitionTasks(definitionsOf(snapshot));
    const matches = await readMatches({ assignmentId: id, tasks });
    const ownership = resolveSimpleOwnership(
      snapshot,
      compileSimpleChain(snapshot),
      matches.get(body.messageId) ?? new Map()
    );
    // Still being judged: an answer now would be under a rule that may not be
    // the one that ends up applying, and showing it would be a guess presented
    // as a fact.
    if (ownership.outcome === 'pending') {
      return NextResponse.json({ status: 'pending' });
    }
    sid = ownership.sid;
    outcome = ownership.outcome;
  }

  const rule = ruleForOwner(snapshot, sid);
  if (rule === seedPrompt) {
    await logStudyEvent(id, 'simple_response_view', {
      condition,
      messageId: body.messageId,
      versionNo: body.versionNo ?? tip.version?.versionNo ?? null,
      sid,
      outcome,
      cacheHit: true,
      original: true,
    });
    return NextResponse.json({ status: 'original', sid, outcome });
  }

  const ruleHash = simpleRuleHash(rule);
  const cached = await readCachedResponses([{ messageId: body.messageId, ruleHash }]);
  const hit = cached.get(`${body.messageId}:${ruleHash}`);

  await logStudyEvent(id, 'simple_response_view', {
    condition,
    messageId: body.messageId,
    versionNo: body.versionNo ?? tip.version?.versionNo ?? null,
    sid,
    outcome,
    cacheHit: !!hit,
  });

  if (hit) {
    return NextResponse.json({ status: 'ready', response: hit, sid, outcome });
  }
  if (!isOpenAIConfigured()) {
    return NextResponse.json({ error: 'openai_not_configured' }, { status: 503 });
  }

  const streamed = await streamResponse({ assignmentId: id, messageId: body.messageId, rule });
  if (!streamed) return NextResponse.json({ error: 'no_such_question' }, { status: 404 });
  return new Response(streamed.stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      // The chain's answer, for the chip beside the reply — the body is the
      // reply itself and has nowhere to put it.
      'X-Simple-Owner': sid == null ? 'root' : String(sid),
      'X-Simple-Outcome': outcome,
    },
  });
}
