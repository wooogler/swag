/**
 * One non-streaming chatbot turn for the instructor TEST-CHAT and query PREVIEW.
 * Same OpenAI Responses API + model (OPENAI_MODEL) the student /api/chat uses, so
 * what the instructor tests matches what students get. Never persisted.
 */
import OpenAI from 'openai';

export type TurnMessage = { role: 'user' | 'assistant'; content: string };

const getClient = (): OpenAI | null => {
  const apiKey = process.env.OPENAI_API_KEY;
  return apiKey ? new OpenAI({ apiKey }) : null;
};

export function isChatConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

export async function runChatTurn(systemPrompt: string, messages: TurnMessage[]): Promise<string> {
  const client = getClient();
  if (!client) throw new Error('openai_not_configured');
  const input: { role: 'system' | 'user' | 'assistant'; content: string }[] = [];
  // Empty system prompt → send none at all (NIRVANA parity), as /api/chat does.
  if (systemPrompt.trim()) input.push({ role: 'system', content: systemPrompt });
  for (const m of messages) input.push({ role: m.role, content: m.content });
  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL ?? 'gpt-4o',
    input,
  });
  return (response.output_text ?? '').trim();
}
