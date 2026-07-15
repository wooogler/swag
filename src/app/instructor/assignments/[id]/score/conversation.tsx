'use client';

/**
 * SCORE v6 — shared conversation viewer pieces.
 *
 * ConversationThread renders one question's FULL chat thread inline inside a
 * column, using the SAME ChatMessages component that powers the student chat
 * and the instructor replay — so what the instructor reviews here looks
 * exactly like what the student saw. The current question is highlighted
 * (ring) and centered on open. Used by the board's conversation viewer
 * ("Full conversation") and by the intent workbench when a question row is
 * opened while editing an intent.
 */
import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ChatMessages, { type Message } from '@/components/chat/ChatMessages';
import { MaterialSegments } from './materials';
import type { ScoreQueryRow } from './IntentBoard';

/** A chatbot reply: markdown normally; verbatim text for NIRVANA imports
 * (raw GPT output whose single-newline breaks CommonMark would collapse). */
export function ResponseBody({ text, raw }: { text: string; raw: boolean }) {
  if (raw) {
    return <p className="whitespace-pre-wrap break-words text-sm text-[hsl(var(--foreground))]">{text}</p>;
  }
  return (
    <div className="prose prose-sm max-w-none dark:prose-invert prose-pre:bg-[hsl(var(--muted))] prose-pre:text-[hsl(var(--foreground))] prose-pre:border prose-pre:border-[hsl(var(--border))]">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}

/** The selected message's full chat thread, in send order, rendered with the
 * student-facing chat component (user bubbles right, bot markdown full-width).
 * The current question carries the highlight ring and is centered on open. */
export function ConversationThread({
  rows,
  current,
  isNirvana,
  overrideResponse = null,
  singleTurn = false,
}: {
  rows: ScoreQueryRow[];
  current: ScoreQueryRow;
  isNirvana: boolean;
  /** Replace ONE turn's reply with a regenerated response (rule workbench:
   * "this step's response, in the context of the prior conversation"). `raw`
   * overrides the thread-wide NIRVANA raw rendering for just that message. */
  overrideResponse?: { messageId: number; text: string; raw?: boolean } | null;
  /** Render ONLY the current question's Q→response instead of the whole thread —
   * the "Add example" preview defaults to this, with the full thread one toggle
   * away. Same bubbles either way, so toggling reads as a zoom, not a new view. */
  singleTurn?: boolean;
}) {
  const thread = useMemo(() => {
    const full = rows
      .filter((r) => r.conversationId === current.conversationId)
      .sort((a, b) => a.turnIndex - b.turnIndex || a.messageId - b.messageId);
    return singleTurn ? full.filter((r) => r.messageId === current.messageId) : full;
  }, [rows, current.conversationId, current.messageId, singleTurn]);
  const messages = useMemo(
    () =>
      thread.flatMap((r) => {
        const override =
          overrideResponse && overrideResponse.messageId === r.messageId ? overrideResponse : null;
        const responseText = override ? override.text : r.responseText;
        return [
          {
            id: r.messageId,
            role: 'user' as const,
            content: r.queryText,
            timestamp: Date.parse(r.queryTimestamp),
          },
          ...(responseText && responseText.trim()
            ? [
                {
                  // Distinct id space from the (numeric) user message ids.
                  id: `assistant-${r.messageId}`,
                  role: 'assistant' as const,
                  content: responseText,
                  ...(override ? { metadata: { rawText: override.raw ?? false } } : {}),
                },
              ]
            : []),
        ];
      }),
    [thread, overrideResponse]
  );
  const rowById = useMemo(() => new Map(thread.map((r) => [r.messageId as string | number, r])), [thread]);

  // Pasted Material collapses into the same clickable per-kind tags as the
  // question lists (click to reveal verbatim, click again to collapse).
  const renderUserContent = (m: Message) => {
    const row = rowById.get(m.id);
    if (!row?.dissection || row.dissection.materialKinds.length === 0) return null;
    return <MaterialSegments text={row.queryText} dissection={row.dissection} />;
  };

  return (
    <ChatMessages
      messages={messages}
      showTimestamp
      highlightedMessageId={current.messageId}
      autoScrollToHighlight
      rawAssistantText={isNirvana}
      renderUserContent={renderUserContent}
    />
  );
}
