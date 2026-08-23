'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { getGlobalValidator } from '@/lib/copy-validator';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/ui/button';
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, Copy, Check, Globe, Loader2, Pencil } from 'lucide-react';
import { renderHighlightedChildren, type ReplayPasteHighlight } from './replayPasteHighlight';

/**
 * Where a message scrolled to (on open, or via the query nav) lands: its own top
 * edge, never the middle of the window.
 *
 * Centering was the earlier choice, on the reasoning that the turns around a
 * question are the context you came for. In practice it spends the screen on the
 * wrong thing: the reply to the PREVIOUS question takes the top half, and the
 * pair actually being judged — this question and what the chatbot answered — is
 * pushed below the fold. Worse for a long question, which centered opens halfway
 * down itself with the student's first line already scrolled off.
 *
 * Top-aligned, the first screen is exactly the unit of work. The turns before it
 * are one scroll up, and the floating "back to the question" button brings the
 * reader back.
 */
const HIGHLIGHT_ALIGN: ScrollLogicalPosition = 'start';

/** What "the top" leaves above it — this list's own p-4, matched by the
 * scroll-mt-4 on every message. */
const HIGHLIGHT_INSET = 16;
/** The same, when the "earlier turns" strip is pinned above the thread
 * (scroll-mt-14): the room the question needs to clear it. */
const HIGHLIGHT_INSET_WITH_STRIP = 56;

export interface Message {
  id: string | number;
  role: 'user' | 'assistant';
  content: string;
  conversationTitle?: string;
  timestamp?: number;
  metadata?: {
    webSearchEnabled?: boolean;
    webSearchUsed?: boolean;
    [key: string]: unknown;
  };
}

interface ChatMessagesProps {
  messages: Message[];
  isLoading?: boolean;
  showConversationBadge?: boolean;
  showTimestamp?: boolean;
  enableCopy?: boolean;
  showWebSearchIndicator?: boolean;
  highlightedMessageId?: number | null;
  replayPasteHighlights?: ReplayPasteHighlight[];
  onReplayPasteClick?: (timestamp: number) => void;
  /** Render assistant messages as verbatim text instead of markdown — for
   * imported logs (e.g. NIRVANA) whose raw single-newline breaks CommonMark
   * would collapse. */
  rawAssistantText?: boolean;
  /** Scroll to the highlighted message on mount/select instead of
   * auto-following the bottom — for read-only thread views (SCORE) where the
   * point of interest is mid-conversation, not the latest message. It lands at
   * the top of the window; see HIGHLIGHT_ALIGN. */
  autoScrollToHighlight?: boolean;
  /**
   * What to do when the highlight MOVES to a message that is already on
   * screen: 'align' puts it at the top regardless, 'if-needed' leaves the
   * scroll where it is and only moves when the message would otherwise be cut
   * off — smoothly, so the page does not jump.
   *
   * 'if-needed' is for a reveal. The block test appends the chatbot's answer
   * under the question being predicted about, and yanking the question off the
   * top of the pane to align the answer costs the reader the thing the answer
   * is an answer TO. When the answer is longer than the window there is no
   * choice, and then the scroll is animated rather than instant so it is
   * legible as movement rather than as a repaint.
   */
  highlightScroll?: 'align' | 'if-needed';
  /** Keep the scrollbar on screen even before the reader touches it.
   *
   * Goes with `autoScrollToHighlight`: a thread that opens part-way down has
   * turns above the fold. Off by default — a live chat starts at the top of
   * its own history and has nothing to announce.
   *
   * NOT SUFFICIENT ON ITS OWN, which is why `showEarlierTurns` exists: macOS
   * hides scrollbars until you scroll unless the reader has changed a system
   * setting, and a styled `::-webkit-scrollbar` does not override that. The
   * gutter is still reserved and it still draws everywhere else, so it stays
   * — but nothing may depend on it being seen. */
  persistentScrollbar?: boolean;
  /**
   * Say, in the pane itself, that the thread continues above the fold.
   *
   * A count and an arrow, pinned to the top of the scrollport while anything
   * is scrolled past it. This is the affordance that actually carries the
   * message: it is drawn by the page, so no OS setting can decide not to show
   * it, and it says HOW MUCH is up there rather than leaving a thumb's
   * position to be interpreted. Companion to `autoScrollToHighlight` — a pane
   * that opens at the top has nothing to point at.
   */
  showEarlierTurns?: boolean;
  /** The ring on the highlighted message. Defaults to the selection purple;
   * the simple board passes the colour of the intent that answers it, so the
   * question, its reply and the row in the list are one colour. */
  highlightColor?: string | null;
  /** Override the body of a USER bubble (e.g. SCORE's Material tags — pasted
   * content collapsed into clickable per-kind chips). Return null to fall back
   * to the default plain-text rendering for that message. */
  renderUserContent?: (message: Message) => React.ReactNode | null;
  /** Replace the assistant Copy action with an Edit action (rule workbench:
   * editing the reply IS the rewrite affordance). */
  onEditAssistant?: (message: Message) => void;
  /** Put prev/next controls on every question, so a reader can hop question to
   * question without scrolling through the replies in between. For read-only
   * thread views; a live chat has no earlier question worth jumping back to. */
  showQueryNav?: boolean;
  /** Mark ONE message out from the thread around it: `above` is rendered
   * directly on top of its bubble and `className` frames the message as a whole
   * (bubble + its controls). Return null for every other message. The board's
   * viewer uses it to hang the rule-version picker on the reply that version
   * rewrites, and to tint that one reply while it is being viewed. */
  decorateMessage?: (
    message: Message
  ) => {
    above?: React.ReactNode;
    className?: string;
    /** For colours that come from data rather than from the palette — the
     * intent that answers this turn has one, and Tailwind cannot name it. */
    style?: React.CSSProperties;
    /** Stand in for the bubble's contents — a reply being worked out, where
     * `content` would otherwise have to be some placeholder string pretending
     * to be a message. */
    body?: React.ReactNode;
  } | null;
}

export default function ChatMessages({
  messages,
  isLoading = false,
  showConversationBadge = false,
  showTimestamp = false,
  enableCopy = true,
  showWebSearchIndicator = false,
  highlightedMessageId = null,
  replayPasteHighlights = [],
  onReplayPasteClick,
  rawAssistantText = false,
  autoScrollToHighlight = false,
  highlightScroll = 'align',
  persistentScrollbar = false,
  showEarlierTurns = false,
  highlightColor,
  renderUserContent,
  onEditAssistant,
  showQueryNav = false,
  decorateMessage,
}: ChatMessagesProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const lastAutoScrolledHighlightIdRef = useRef<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | number | null>(null);
  const validator = getGlobalValidator();

  const messagePasteHighlightMap = useMemo(() => {
    const map = new Map<string, ReplayPasteHighlight[]>();

    replayPasteHighlights.forEach((highlight) => {
      const key = String(highlight.messageId);
      const existing = map.get(key);
      if (existing) {
        existing.push(highlight);
      } else {
        map.set(key, [highlight]);
      }
    });

    return map;
  }, [replayPasteHighlights]);

  // The questions, in thread order — the stops the prev/next controls move
  // between. Replies are not stops: skipping past them is the whole point.
  const queryOrder = useMemo(
    () => messages.filter((m) => m.role === 'user').map((m) => m.id),
    [messages]
  );
  const queryIndex = useMemo(
    () => new Map(queryOrder.map((id, i) => [id, i])),
    [queryOrder]
  );

  // scrollIntoView rather than scrolling this container, because in several
  // mounts the real scroller is an ANCESTOR (see the highlight-visibility note
  // below); the browser walks up and moves whichever one actually scrolls.
  const scrollToMessage = (id: string | number) => {
    scrollContainerRef.current
      ?.querySelector(`[data-message-id="${id}"]`)
      ?.scrollIntoView({ block: HIGHLIGHT_ALIGN, behavior: 'smooth' });
  };

  // Register all messages with validator (both user and assistant)
  useEffect(() => {
    messages.forEach((message) => {
      validator.registerChatMessage(message.content);
    });
  }, [messages, validator]);

  // Auto-scroll to bottom on new messages (live chat) — read-only thread views
  // center the highlighted message instead.
  useEffect(() => {
    if (autoScrollToHighlight) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, autoScrollToHighlight]);

  // Bring the highlighted message into view when it CHANGES, and not while it
  // grows. `messages` has to stay in the deps — on the first render the target
  // is not in the DOM yet — but a streaming reply rewrites that array on every
  // token, and re-running the scroll each time drags the view back under
  // anyone reading further down. The ref makes it once per message: click A,
  // scroll away, click B, click A again and it still scrolls, because the id
  // it last obeyed is B.
  const scrolledToHighlightRef = useRef<string | number | null>(null);
  /**
   * Empty room after the last turn, so a question CAN be put at the top.
   *
   * Without it the last turns of a thread land wherever the scrollbar runs
   * out: asking to scroll further than there is content to scroll does
   * nothing, so the same click that puts one question at the top leaves
   * another halfway down, and the difference is invisible — it is whether the
   * reply below happens to be a screenful long. Measured on one board: six
   * questions at 16px from the top and one at 200px, the one with 227px of
   * thread left under it in an 844px window.
   *
   * Exactly the shortfall, not a blanket screenful: most questions need none,
   * and it is re-fitted as a streamed reply grows under them, so the space
   * disappears as the content arrives to replace it.
   */
  const [tailSpace, setTailSpace] = useState(0);
  useEffect(() => {
    if (!autoScrollToHighlight || highlightedMessageId == null) return;
    const target = scrollContainerRef.current?.querySelector<HTMLElement>(
      `[data-message-id="${highlightedMessageId}"]`
    );
    if (!target) return;

    // Whichever box actually scrolls — in several mounts it is an ancestor of
    // this list, not this list.
    let scroller: HTMLElement | null = target.parentElement;
    while (scroller && scroller.scrollHeight <= scroller.clientHeight + 2) {
      scroller = scroller.parentElement;
    }
    if (scroller) {
      const top =
        target.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop;
      // What is below it now, against what putting it at the top would need.
      if (highlightScroll === 'if-needed') {
        // LEAVE IT EXACTLY AS IT IS. The space was put there to hold the
        // question at the top, and the scroll position that holds it depends
        // on it: taking it away shortens the scrollable range, the browser
        // clamps the offset, and the whole thread slides down — a jump of
        // ninety pixels at the one moment this mode exists to keep still.
        // It is recomputed from scratch on the next question, which remounts.
        return;
      }
      const inset = showEarlierTurns ? HIGHLIGHT_INSET_WITH_STRIP : HIGHLIGHT_INSET;
      const need = scroller.clientHeight - inset - (scroller.scrollHeight - top);
      // The current space is already inside scrollHeight, so this converges in
      // one step rather than chasing itself.
      setTailSpace((space) => Math.max(0, Math.round(space + need)));
    }

    if (scrolledToHighlightRef.current === highlightedMessageId) return;
    scrolledToHighlightRef.current = highlightedMessageId;
    // After the space above has been laid out, or the scroll asks for a
    // position that does not exist yet and stops short.
    const frame = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (highlightScroll === 'align') {
          target.scrollIntoView({ block: HIGHLIGHT_ALIGN });
          return;
        }
        // Already readable where it is: leave the page alone. `nearest` is not
        // enough on its own — it still scrolls a message whose top is visible
        // but whose body runs off the bottom, which is the common case for a
        // long reply and exactly when moving is right.
        const box = target.getBoundingClientRect();
        const view = scrollContainerRef.current?.getBoundingClientRect();
        if (!view) return;
        const top = Math.max(view.top, 0);
        const bottom = Math.min(view.bottom, window.innerHeight);
        if (box.top >= top - 1 && box.bottom <= bottom + 1) return;
        target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      })
    );
    return () => cancelAnimationFrame(frame);
  }, [autoScrollToHighlight, highlightScroll, highlightedMessageId, messages, showEarlierTurns]);

  // Highlighted-message visibility: when the reader scrolls it off-screen, a
  // floating "back to the question" button appears (thread views only). The
  // visible window is the intersection of this container and the viewport, so
  // it also works when an ANCESTOR is the actual scroller; the capturing
  // scroll listener catches scrolls at any level.
  const [highlightOffscreen, setHighlightOffscreen] = useState<'up' | 'down' | null>(null);
  useEffect(() => {
    if (!autoScrollToHighlight || highlightedMessageId == null) {
      setHighlightOffscreen(null);
      return;
    }
    const container = scrollContainerRef.current;
    if (!container) return;
    const update = () => {
      const el = container.querySelector<HTMLElement>(`[data-message-id="${highlightedMessageId}"]`);
      if (!el) {
        setHighlightOffscreen(null);
        return;
      }
      const c = container.getBoundingClientRect();
      const top = Math.max(c.top, 0);
      const bottom = Math.min(c.bottom, window.innerHeight);
      const r = el.getBoundingClientRect();
      setHighlightOffscreen(r.bottom < top + 8 ? 'up' : r.top > bottom - 8 ? 'down' : null);
    };
    update();
    document.addEventListener('scroll', update, { capture: true, passive: true });
    window.addEventListener('resize', update);
    return () => {
      document.removeEventListener('scroll', update, { capture: true });
      window.removeEventListener('resize', update);
    };
  }, [autoScrollToHighlight, highlightedMessageId, messages]);

  /**
   * How many turns are scrolled off the top right now.
   *
   * Measured against the intersection of this container with the viewport —
   * the same window the back-to-the-question button uses — so it is right
   * whether this element scrolls or an ancestor does. Counted rather than
   * merely detected: "3 earlier turns" tells a reader what is up there, where
   * a bare arrow only tells them that something is.
   */
  const [turnsAbove, setTurnsAbove] = useState(0);
  useEffect(() => {
    if (!showEarlierTurns) {
      setTurnsAbove(0);
      return;
    }
    const container = scrollContainerRef.current;
    if (!container) return;
    const update = () => {
      const c = container.getBoundingClientRect();
      const top = Math.max(c.top, 0);
      let above = 0;
      container.querySelectorAll<HTMLElement>('[data-message-id]').forEach((el) => {
        if (el.getBoundingClientRect().bottom < top + 8) above += 1;
      });
      setTurnsAbove(above);
    };
    update();
    // Again after the opening scroll lands: on mount nothing is above yet, and
    // it is that scroll — not a reader's — that puts the context out of sight.
    const frame = requestAnimationFrame(() => requestAnimationFrame(update));
    document.addEventListener('scroll', update, { capture: true, passive: true });
    window.addEventListener('resize', update);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('scroll', update, { capture: true });
      window.removeEventListener('resize', update);
    };
  }, [showEarlierTurns, messages]);

  // When a new replay paste highlight appears, bring that highlight near top for easier scanning.
  useEffect(() => {
    const latestHighlight = replayPasteHighlights[replayPasteHighlights.length - 1];
    if (!latestHighlight) {
      lastAutoScrolledHighlightIdRef.current = null;
      return;
    }

    if (lastAutoScrolledHighlightIdRef.current === latestHighlight.id) {
      return;
    }

    lastAutoScrolledHighlightIdRef.current = latestHighlight.id;
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer || !latestHighlight) {
      return;
    }

    requestAnimationFrame(() => {
      const target = scrollContainer.querySelector<HTMLElement>(
        `[data-replay-highlight-id="${latestHighlight.id}"]`
      );
      if (!target) {
        return;
      }

      const topOffset = Math.max(0, target.offsetTop - scrollContainer.offsetTop - 12);
      scrollContainer.scrollTo({
        top: topOffset,
        behavior: 'smooth',
      });
    });
  }, [replayPasteHighlights]);

  // Handle copy events in chat messages area
  useEffect(() => {
    const handleCopy = () => {
      const selection = window.getSelection();
      const copiedContent = selection?.toString();
      const scrollContainer = scrollContainerRef.current;

      if (!selection || !copiedContent || !scrollContainer || selection.rangeCount === 0) {
        return;
      }

      const commonAncestor = selection.getRangeAt(0).commonAncestorContainer;
      const selectedNode = commonAncestor.nodeType === Node.TEXT_NODE
        ? commonAncestor.parentNode
        : commonAncestor;

      if (!selectedNode || !scrollContainer.contains(selectedNode)) {
        return;
      }

      validator.markInternalCopy(copiedContent, 'chat');
    };

    document.addEventListener('copy', handleCopy);

    return () => {
      document.removeEventListener('copy', handleCopy);
    };
  }, [validator]);

  const copyToClipboard = async (content: string, messageId: string | number) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(messageId);

      // Mark as internal copy in validator
      validator.markInternalCopy(content, 'chat');

      setTimeout(() => setCopiedId(null), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <p className="text-[hsl(var(--muted-foreground))] text-sm text-center">
          Start a conversation with the AI assistant to get help with your essay.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={scrollContainerRef}
      className={`flex-1 p-4 space-y-6 ${
        persistentScrollbar ? 'scrollbar-always' : 'overflow-y-auto'
      }`}
    >
      {/* "There is more above", FIRST in the scroll content — which is what
          lets `sticky top-2` pin it to the top edge while anything is scrolled
          past it. Placed at the end (where the back-to-the-question button
          lives) it would sit under the last message instead, pointing up from
          the bottom of a pane whose top is where the missing turns are.

          Hidden while the back-to-the-question button is showing at that same
          edge: two controls pointing the same way at the same corner is one of
          them getting in the other's way, and the question is the more
          important of the two things to get back to. */}
      {showEarlierTurns && turnsAbove > 0 && highlightOffscreen !== 'up' && (
        // -top-4 and -mt-4, not top-0: sticky offsets are measured from the
        // scrollport's PADDING box, so a strip pinned at 0 leaves this list's
        // own p-4 uncovered — and content scrolling up through that 16px is
        // visible above the very thing that is masking it. The negative bottom
        // margin gives the strip back the height it takes in flow, so
        // appearing does not shove the thread down by its own size.
        <div className="sticky -top-4 z-10 -mx-4 -mt-4 -mb-10 px-4 pt-4 pb-2 flex justify-center pointer-events-none bg-gradient-to-b from-[hsl(var(--card))] via-[hsl(var(--card))] via-70% to-transparent">
          <button
            onClick={() => {
              const el = scrollContainerRef.current?.querySelector<HTMLElement>('[data-message-id]');
              el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
            className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-1.5 text-xs font-medium text-[hsl(var(--muted-foreground))] shadow-md hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
            title="Scroll up to the start of this conversation"
          >
            <ArrowUp className="w-3.5 h-3.5" />
            {turnsAbove === 1 ? '1 earlier turn above' : `${turnsAbove} earlier turns above`}
          </button>
        </div>
      )}

      {messages.map((message, index) => {
        const isUser = message.role === 'user';
        const isCopied = copiedId === message.id;
        const isLastMessage = index === messages.length - 1;
        const isStreaming = isLastMessage && isLoading && !isUser;
        const isHighlighted = highlightedMessageId === message.id;
        const messageHighlights = messagePasteHighlightMap.get(String(message.id)) ?? [];
        // Per-message raw override (metadata.rawText) beats the global flag —
        // a regenerated (markdown) reply can sit inside a raw-text thread.
        const rawMessage = (message.metadata?.rawText as boolean | undefined) ?? rawAssistantText;
        const decoration = decorateMessage?.(message) ?? null;

        return (
          <div
            key={message.id}
            data-message-id={message.id}
            // With the "earlier turns" strip pinned to the top, the question has
            // to land BELOW it — a highlighted message aligned to the pane's
            // own inset would open with its first line under the very control
            // that is there to say what it is missing.
            // scroll-mt matches this list's own p-4 top inset: aligning a message
            // to the top of the scrollport otherwise scrolls that padding away and
            // clips the highlight ring, which paints 4px OUTSIDE the bubble
            // (ring-2 + ring-offset-2) and so reads as a cut-off border. With it,
            // a message scrolled to lands exactly where the first message sits.
            className={`group/msg flex ${showEarlierTurns ? 'scroll-mt-14' : 'scroll-mt-4'} ${
              isUser ? 'justify-end' : 'justify-start'
            }`}
          >
            <div
              /* A decorated reply sets its own width: the marking it carries
                 bleeds into the list's gutters so the text inside lands where
                 an undecorated reply's does, and `w-full` would pin the box at
                 the column width and take the bleed out of the text instead. */
              className={`${
                isUser ? 'max-w-[85%]' : decoration?.className ? '' : 'w-full'
              } ${isUser ? 'items-end' : 'items-start'} flex flex-col ${
                decoration?.className ?? ''
              }`}
              style={decoration?.style}
            >
              {decoration?.above}
              {showConversationBadge && message.conversationTitle && (
                <div className="mb-1 px-2 py-0.5 bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 rounded text-xs font-medium self-start">
                  {message.conversationTitle}
                </div>
              )}

              <div
                className={`rounded-2xl px-4 py-3 transition-all duration-300 ${isUser
                  ? 'bg-[hsl(var(--muted))] text-[hsl(var(--foreground))] rounded-tr-sm'
                  : 'bg-transparent text-[hsl(var(--foreground))] px-0 py-0'
                  } ${
                    isHighlighted
                      ? highlightColor
                        ? 'ring-2 ring-offset-2 shadow-lg'
                        : 'ring-2 ring-purple-500 ring-offset-2 shadow-lg shadow-purple-200'
                      : ''
                  }`}
                style={
                  isHighlighted && highlightColor
                    ? {
                        // color-mix rather than an opacity utility: the value
                        // is a data colour, so the shade has to be worked out
                        // where it is used.
                        ['--tw-ring-color' as string]: highlightColor,
                        boxShadow: `0 10px 15px -3px color-mix(in srgb, ${highlightColor} 25%, transparent)`,
                      }
                    : undefined
                }
              >
                {decoration?.body ? (
                  decoration.body
                ) : isUser ? (
                  <p className="text-base whitespace-pre-wrap wrap-break-word">
                    {renderUserContent?.(message) ??
                      renderHighlightedChildren(message.content, messageHighlights, onReplayPasteClick)}
                  </p>
                ) : rawMessage ? (
                  <p className="text-base whitespace-pre-wrap wrap-break-word">{message.content}</p>
                ) : (
                  <div className="prose prose-base max-w-none dark:prose-invert prose-headings:font-outfit prose-p:leading-relaxed prose-pre:bg-[hsl(var(--muted))] prose-pre:text-[hsl(var(--foreground))] prose-pre:border prose-pre:border-[hsl(var(--border))]">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        p: ({ children, ...props }) => (
                          <p {...props}>
                            {renderHighlightedChildren(children, messageHighlights, onReplayPasteClick)}
                          </p>
                        ),
                        li: ({ children, ...props }) => (
                          <li {...props}>
                            {renderHighlightedChildren(children, messageHighlights, onReplayPasteClick)}
                          </li>
                        ),
                        blockquote: ({ children, ...props }) => (
                          <blockquote {...props}>
                            {renderHighlightedChildren(children, messageHighlights, onReplayPasteClick)}
                          </blockquote>
                        ),
                        h1: ({ children, ...props }) => (
                          <h1 {...props}>
                            {renderHighlightedChildren(children, messageHighlights, onReplayPasteClick)}
                          </h1>
                        ),
                        h2: ({ children, ...props }) => (
                          <h2 {...props}>
                            {renderHighlightedChildren(children, messageHighlights, onReplayPasteClick)}
                          </h2>
                        ),
                        h3: ({ children, ...props }) => (
                          <h3 {...props}>
                            {renderHighlightedChildren(children, messageHighlights, onReplayPasteClick)}
                          </h3>
                        ),
                        h4: ({ children, ...props }) => (
                          <h4 {...props}>
                            {renderHighlightedChildren(children, messageHighlights, onReplayPasteClick)}
                          </h4>
                        ),
                        h5: ({ children, ...props }) => (
                          <h5 {...props}>
                            {renderHighlightedChildren(children, messageHighlights, onReplayPasteClick)}
                          </h5>
                        ),
                        h6: ({ children, ...props }) => (
                          <h6 {...props}>
                            {renderHighlightedChildren(children, messageHighlights, onReplayPasteClick)}
                          </h6>
                        ),
                        td: ({ children, ...props }) => (
                          <td {...props}>
                            {renderHighlightedChildren(children, messageHighlights, onReplayPasteClick)}
                          </td>
                        ),
                        th: ({ children, ...props }) => (
                          <th {...props}>
                            {renderHighlightedChildren(children, messageHighlights, onReplayPasteClick)}
                          </th>
                        ),
                        a: ({ children, ...props }) => (
                          <a {...props} target="_blank" rel="noopener noreferrer" className="text-[hsl(var(--primary))] hover:underline">
                            {renderHighlightedChildren(children, messageHighlights, onReplayPasteClick)}
                          </a>
                        ),
                      }}
                    >
                      {message.content}
                    </ReactMarkdown>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-3 mt-1 px-1">
                {/* Question-to-question navigation, on the question itself.
                    Questions sit right-aligned, so the controls go LEFT of the
                    timestamp and stay out of the way until the pointer is on
                    the message — except on the question under review, where
                    they show unprompted so the affordance is findable without
                    hunting. Named group written inline: an unnamed one would
                    also fire from any ancestor that happens to be a `group`,
                    and a class name passed in as a prop is never emitted. */}
                {isUser && showQueryNav && queryOrder.length > 1 && (() => {
                  const i = queryIndex.get(message.id) ?? -1;
                  const prevId = i > 0 ? queryOrder[i - 1] : null;
                  const nextId = i >= 0 && i < queryOrder.length - 1 ? queryOrder[i + 1] : null;
                  return (
                    <div
                      className={`flex items-center gap-0.5 text-xs text-[hsl(var(--muted-foreground))] transition-opacity focus-within:opacity-100 ${
                        isHighlighted ? 'opacity-100' : 'opacity-0 group-hover/msg:opacity-100'
                      }`}
                    >
                      <button
                        onClick={() => prevId != null && scrollToMessage(prevId)}
                        disabled={prevId == null}
                        title="Previous question"
                        aria-label="Previous question"
                        className="p-0.5 rounded hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] disabled:opacity-30 disabled:hover:bg-transparent"
                      >
                        <ChevronUp className="w-3.5 h-3.5" />
                      </button>
                      <span className="tabular-nums" title={`Question ${i + 1} of ${queryOrder.length}`}>
                        {i + 1}/{queryOrder.length}
                      </span>
                      <button
                        onClick={() => nextId != null && scrollToMessage(nextId)}
                        disabled={nextId == null}
                        title="Next question"
                        aria-label="Next question"
                        className="p-0.5 rounded hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] disabled:opacity-30 disabled:hover:bg-transparent"
                      >
                        <ChevronDown className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })()}

                {(showTimestamp || (showWebSearchIndicator && message.metadata?.webSearchEnabled)) && (
                  <div className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
                    {showWebSearchIndicator && message.metadata?.webSearchEnabled && (
                      <span className="flex items-center gap-1 text-sky-500">
                        <Globe className="w-3 h-3" />
                        Web search
                      </span>
                    )}
                    {showTimestamp && message.timestamp && (
                      <span>{new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    )}
                  </div>
                )}

                {!isUser && !isStreaming && onEditAssistant ? (
                  <Button
                    onClick={() => onEditAssistant(message)}
                    variant="ghost"
                    size="sm"
                    className="h-auto p-0 text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-transparent"
                    title="Edit this response the way you want it — the agent infers the rule change"
                  >
                    <span className="flex items-center gap-1">
                      <Pencil className="w-3 h-3" />
                      Edit
                    </span>
                  </Button>
                ) : !isUser && enableCopy && !isStreaming ? (
                  <Button
                    onClick={() => copyToClipboard(message.content, message.id)}
                    variant="ghost"
                    size="sm"
                    className="h-auto p-0 text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-transparent"
                    title="Copy message"
                  >
                    {isCopied ? (
                      <span className="flex items-center gap-1 text-green-600">
                        <Check className="w-3 h-3" />
                        Copied
                      </span>
                    ) : (
                      <span className="flex items-center gap-1">
                        <Copy className="w-3 h-3" />
                        Copy
                      </span>
                    )}
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        );
      })}

      {isLoading && (
        <div className="flex justify-start">
          <div className="bg-transparent px-0 py-2">
            <div className="flex items-center gap-2 text-[hsl(var(--muted-foreground))]">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Thinking...</span>
            </div>
          </div>
        </div>
      )}

      {/* Floating return-to-question button — sticks to the edge of the nearest
          scrollport on the side the highlighted message went off: the TOP when
          it is scrolled above, the BOTTOM when below, so it always points the
          shortest way back. */}
      {autoScrollToHighlight && highlightOffscreen && (
        <div
          className={`sticky z-10 flex justify-center pointer-events-none ${
            highlightOffscreen === 'up' ? 'top-2' : 'bottom-2'
          }`}
        >
          <button
            onClick={() => highlightedMessageId != null && scrollToMessage(highlightedMessageId)}
            className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-1.5 text-xs font-medium text-[hsl(var(--foreground))] shadow-md hover:bg-[hsl(var(--muted))]"
            title="Scroll back to the question being reviewed"
          >
            {highlightOffscreen === 'up' ? (
              <ArrowUp className="w-3.5 h-3.5" />
            ) : (
              <ArrowDown className="w-3.5 h-3.5" />
            )}
            Back to the question
          </button>
        </div>
      )}

      {tailSpace > 0 && <div aria-hidden style={{ height: tailSpace }} />}
      <div ref={messagesEndRef} />
    </div>
  );
}
