'use client';

/**
 * Test-chat entry for the SCORE board (parity with the baseline studio, S-3).
 * Answers under the CURRENT DRAFT intent→rule set (score/test-chat), never
 * persisted. Additive — does not touch IntentBoard.
 */
import { useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import TestChat, { type TurnMessage } from './TestChat';

export default function ScoreTestChatButton({ assignmentId }: { assignmentId: string }) {
  const [open, setOpen] = useState(false);

  async function send(messages: TurnMessage[]): Promise<string> {
    const res = await fetch(`/api/instructor/assignments/${assignmentId}/score/test-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    });
    if (!res.ok) throw new Error((await res.json()).error || 'chat_failed');
    return (await res.json()).response;
  }

  return (
    <>
      <Button variant="ghost" className="gap-1.5" onClick={() => setOpen(true)}>
        <MessageSquare className="w-4 h-4" /> Test chat
      </Button>
      {open && <TestChat onClose={() => setOpen(false)} send={send} subtitle="Draft intents — not saved to the student log" />}
    </>
  );
}
