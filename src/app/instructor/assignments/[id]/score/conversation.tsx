'use client';

/**
 * SCORE v6 — shared conversation viewer pieces.
 *
 * ConversationThread renders one question's FULL chat thread inline inside a
 * column, using the SAME ChatMessages component that powers the student chat
 * and the instructor replay — so what the instructor reviews here looks
 * exactly like what the student saw. The current question is highlighted
 * (ring) and opens at the top of the pane, so it and its reply are the first
 * screen. Used by the board's conversation viewer ("Full conversation") and by
 * the intent workbench when a question row is opened while editing an intent.
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
 * The current question carries the highlight ring and opens at the top. */
export function ConversationThread({
  rows,
  current,
  isNirvana,
  overrideResponse = null,
  singleTurn = false,
  expandMaterials = false,
  responseSlot,
  accent = null,
}: {
  rows: ScoreQueryRow[];
  current: ScoreQueryRow;
  isNirvana: boolean;
  /** Show pasted Material as its verbatim text instead of a collapsed tag.
   * Reading views want this — the tags earn their density in the question
   * lists, but in a thread you are here to read what the student wrote. Every
   * bubble keeps a show/hide-all control either way. */
  expandMaterials?: boolean;
  /** Replace ONE turn's reply with a regenerated response (rule workbench:
   * "this step's response, in the context of the prior conversation"). `raw`
   * overrides the thread-wide NIRVANA raw rendering for just that message. */
  overrideResponse?: {
    messageId: number;
    text: string;
    raw?: boolean;
    /** The text is on its way. Until the first of it lands the reply reads as
     * working rather than as the delivered one, which is a different answer
     * and would otherwise stand there long enough to look like the verdict. */
    loading?: boolean;
  } | null;
  /** Render ONLY the current question's Q→response instead of the whole thread —
   * the "Add example" preview defaults to this, with the full thread one toggle
   * away. Same bubbles either way, so toggling reads as a zoom, not a new view. */
  singleTurn?: boolean;
  /** A control that belongs to the CURRENT question's reply — the board's
   * rule-version picker. It is rendered directly on top of that reply, and
   * while `overrideResponse` is swapping the reply out the pair is framed
   * together, so a regenerated response reads as this one reply changing and
   * not as a setting on the whole conversation. */
  responseSlot?: React.ReactNode;
  /**
   * The colour of whatever answers this question — the intent's own, as the
   * list and the tree draw it. Null falls back to the rule-version blue, which
   * is what the uncategorized rule gets: it has no colour of its own anywhere
   * else either.
   */
  accent?: string | null;
}) {
  const thread = useMemo(() => {
    const full = rows
      .filter((r) => r.conversationId === current.conversationId)
      .sort((a, b) => a.turnIndex - b.turnIndex || a.messageId - b.messageId);
    return singleTurn ? full.filter((r) => r.messageId === current.messageId) : full;
  }, [rows, current.conversationId, current.messageId, singleTurn]);
  const hasSlot = Boolean(responseSlot);
  const messages = useMemo(
    () =>
      thread.flatMap((r) => {
        const override =
          overrideResponse && overrideResponse.messageId === r.messageId ? overrideResponse : null;
        const responseText = override ? override.text : r.responseText;
        // Keep the reply's place while it is being worked out, so the slot
        // above it and the thread below it do not jump.
        const working = Boolean(override?.loading) && !override?.text.trim();
        return [
          {
            id: r.messageId,
            role: 'user' as const,
            content: r.queryText,
            timestamp: Date.parse(r.queryTimestamp),
          },
          ...(working || (responseText && responseText.trim())
            ? [
                {
                  // Distinct id space from the (numeric) user message ids.
                  id: `assistant-${r.messageId}`,
                  role: 'assistant' as const,
                  content: responseText ?? '',
                  ...(override ? { metadata: { rawText: override.raw ?? false } } : {}),
                },
              ]
            : // The current question keeps its reply slot even when nothing was
              // delivered: `responseSlot` hangs off it, and the control that
              // switches back to a version's response must not disappear at the
              // one setting where it is the only way out. Markdown, not the
              // thread's raw mode — this line is ours, not the log's.
              hasSlot && r.messageId === current.messageId
              ? [
                  {
                    id: `assistant-${r.messageId}`,
                    role: 'assistant' as const,
                    content: '_No reply was delivered for this question._',
                    metadata: { rawText: false },
                  },
                ]
              : []),
        ];
      }),
    [thread, overrideResponse, hasSlot, current.messageId]
  );
  const rowById = useMemo(() => new Map(thread.map((r) => [r.messageId as string | number, r])), [thread]);

  // Pasted Material keeps the same clickable per-kind tags/highlights as the
  // question lists (click to reveal verbatim, click again to collapse); which
  // way it starts is the caller's call.
  const renderUserContent = (m: Message) => {
    const row = rowById.get(m.id);
    if (!row?.dissection || row.dissection.materialKinds.length === 0) return null;
    return (
      <MaterialSegments
        text={row.queryText}
        dissection={row.dissection}
        defaultOpen={expandMaterials}
        toggleAll
        labelWhenOpen
      />
    );
  };

  // The slot rides on the current reply, and while a version's response is
  // standing in for it that reply is boxed and tinted — the one turn that is
  // not what the student saw, marked as such, with the rest of the thread left
  // plainly as delivered.
  const currentResponseId = `assistant-${current.messageId}`;
  const responseSwapped = overrideResponse?.messageId === current.messageId;
  const replyWorking = responseSwapped && Boolean(overrideResponse?.loading) && !overrideResponse?.text.trim();
  const decorateMessage = responseSlot
    ? (m: Message) =>
        m.id === currentResponseId
          ? {
              above: responseSlot,
              body: replyWorking ? <ReplyPlaceholder /> : undefined,
              // The colour of the intent that answers it, so the dot in the
              // list, the row in the tree and the reply here are one colour.
              // Blue when nothing owns it: the uncategorized rule has no
              // colour of its own anywhere else either.
              //
              // A bar and a wash, not a box. A framed box has to inset its
              // contents, and the reply is the longest thing on the screen —
              // every pixel off its width comes back as lines, so the one turn
              // worth reading closely was the one made narrowest and tallest.
              //
              // The marking is paid for out of the list's own gutters: pulled
              // out by exactly the padding it adds, on both sides, so the text
              // inside starts and ends where every other reply's does — the
              // rule box lines up with the question above it. It sets its own
              // width for that; see the note by `w-full` in ChatMessages. Same
              // shape as the row the version history marks as current.
              className: responseSwapped
                ? `-mx-3 w-[calc(100%+1.5rem)] rounded-r-lg border-l-2 pl-[calc(0.75rem-2px)] pr-3 py-1.5 ${
                    accent
                      ? ''
                      : 'border-blue-400 bg-blue-50/60 dark:border-blue-700 dark:bg-blue-950/30'
                  }`
                : undefined,
              style:
                responseSwapped && accent
                  ? {
                      borderLeftColor: accent,
                      backgroundColor: `color-mix(in srgb, ${accent} 8%, transparent)`,
                    }
                  : undefined,
            }
          : null
    : undefined;

  return (
    <ChatMessages
      messages={messages}
      showTimestamp
      decorateMessage={decorateMessage}
      // No Copy under the replies: this is a reading view for the instructor,
      // and the action is a student-chat affordance that here only sits between
      // a reply and the next turn.
      enableCopy={false}
      highlightedMessageId={current.messageId}
      autoScrollToHighlight
      // Threads here run long and the replies are the long part, so every
      // question carries prev/next controls. Hidden when the thread is one
      // turn (singleTurn, or a one-question conversation) — nowhere to go.
      showQueryNav
      rawAssistantText={isNirvana}
      highlightColor={accent}
      renderUserContent={renderUserContent}
    />
  );
}

/** The shape of a reply, before there is one. Three lines of it: enough to
 * hold the space a paragraph will take, not so much that it promises a length
 * nobody knows yet. */
function ReplyPlaceholder() {
  return (
    <div className="space-y-2 py-1" aria-label="Working out this reply">
      <div className="h-3.5 w-[92%] animate-pulse rounded bg-[hsl(var(--muted))]" />
      <div className="h-3.5 w-[78%] animate-pulse rounded bg-[hsl(var(--muted))]" />
      <div className="h-3.5 w-[45%] animate-pulse rounded bg-[hsl(var(--muted))]" />
    </div>
  );
}
