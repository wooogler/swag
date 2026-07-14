'use client';

/**
 * Instructor test-chat modal (both conditions): converse with the chatbot under
 * the CURRENT DRAFT configuration to test edits before deploying. Nothing is
 * saved to the student log. The `send` prop wires it to the baseline or SCORE
 * test-chat endpoint. Spec §B-5 / §4.5.
 */
import { useRef, useState } from 'react';
import { X, Send, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export type TurnMessage = { role: 'user' | 'assistant'; content: string };

interface TestChatProps {
  onClose: () => void;
  send: (messages: TurnMessage[]) => Promise<string>;
  subtitle?: string;
}

export default function TestChat({ onClose, send, subtitle }: TestChatProps) {
  const [messages, setMessages] = useState<TurnMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function submit() {
    const text = input.trim();
    if (!text || busy) return;
    const next: TurnMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setBusy(true);
    setError(null);
    try {
      const reply = await send(next);
      setMessages([...next, { role: 'assistant', content: reply }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'chat_failed');
    } finally {
      setBusy(false);
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }));
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl h-[80vh] flex flex-col rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-[hsl(var(--border))]">
          <div>
            <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">Test chat</h3>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">{subtitle ?? 'Draft — not saved to the student log'}</p>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setMessages([]); setError(null); }} title="초기화">
              <RotateCcw className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-3">
          {messages.length === 0 && (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">학생처럼 메시지를 보내 현재 draft 설정을 테스트하세요.</p>
          )}
          {messages.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
              <div
                className={
                  m.role === 'user'
                    ? 'max-w-[80%] rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] px-3 py-2 text-sm whitespace-pre-wrap'
                    : 'max-w-[80%] rounded-lg bg-[hsl(var(--muted))] text-[hsl(var(--foreground))] px-3 py-2 text-sm whitespace-pre-wrap'
                }
              >
                {m.content}
              </div>
            </div>
          ))}
          {busy && <div className="text-sm text-[hsl(var(--muted-foreground))]">…</div>}
          {error && <div className="text-sm text-[hsl(var(--destructive))]">오류: {error}</div>}
        </div>

        <div className="px-4 py-3 border-t border-[hsl(var(--border))] flex items-end gap-2">
          <textarea
            className="flex-1 h-11 max-h-32 resize-none rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm text-[hsl(var(--foreground))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--ring))]"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); } }}
            placeholder="메시지 입력… (Enter 전송)"
          />
          <Button onClick={submit} disabled={busy || !input.trim()} size="icon" className="h-11 w-11 shrink-0">
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
