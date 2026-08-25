/**
 * One non-streaming chatbot turn for the instructor TEST-CHAT and query PREVIEW.
 * Same OpenAI Responses API + model (OPENAI_MODEL) the student /api/chat uses, so
 * what the instructor tests matches what students get. Never persisted.
 */
import OpenAI from 'openai';
import type { CallOptions } from '@/lib/score/classifier';

export type TurnMessage = { role: 'user' | 'assistant'; content: string };

let cachedClient: OpenAI | null = null;
const getClient = (): OpenAI | null => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  // Cached and capped, like the classifier's (classifier.ts getClient). It was
  // neither: a fresh client per turn, on the SDK's defaults — a 600s timeout
  // and two retries, so a single hung request could sit for half an hour.
  // That is survivable when one participant is being watched and nothing else
  // is running. It is not survivable now: the batch that freezes a block's
  // answers awaits every turn inside the participant's own hand-off click,
  // parallel sessions make a stall likelier at exactly the moment they all
  // reach it together, and there is nobody in the room to notice.
  if (!cachedClient) cachedClient = new OpenAI({ apiKey, maxRetries: 2, timeout: 120_000 });
  return cachedClient;
};

export function isChatConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

export async function runChatTurn(
  systemPrompt: string,
  messages: TurnMessage[],
  opts?: CallOptions
): Promise<string> {
  const client = getClient();
  if (!client) throw new Error('openai_not_configured');
  const input: { role: 'system' | 'user' | 'assistant'; content: string }[] = [];
  // Empty system prompt → send none at all (NIRVANA parity), as /api/chat does.
  if (systemPrompt.trim()) input.push({ role: 'system', content: systemPrompt });
  for (const m of messages) input.push({ role: m.role, content: m.content });
  const response = await client.responses.create(
    {
      model: process.env.OPENAI_MODEL ?? 'gpt-4o',
      input,
    },
    {
      ...(opts?.timeoutMs !== undefined ? { timeout: opts.timeoutMs } : {}),
      ...(opts?.maxRetries !== undefined ? { maxRetries: opts.maxRetries } : {}),
    }
  );
  return (response.output_text ?? '').trim();
}
