'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { getGlobalValidator } from '@/lib/copy-validator';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/ui/button';
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, Copy, Check, Globe, Loader2, Pencil } from 'lucide-react';
import { renderHighlightedChildren, type ReplayPasteHighlight } from './replayPasteHighlight';

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
  /** Scroll the highlighted message to center on mount/select instead of
   * auto-following the bottom — for read-only thread views (SCORE) where the
   * point of interest is mid-conversation, not the latest message. */
  autoScrollToHighlight?: boolean;
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
  renderUserContent,
  onEditAssistant,
  showQueryNav = false,
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
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
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

  useEffect(() => {
    if (!autoScrollToHighlight || highlightedMessageId == null) return;
    scrollContainerRef.current
      ?.querySelector(`[data-message-id="${highlightedMessageId}"]`)
      ?.scrollIntoView({ block: 'center' });
  }, [autoScrollToHighlight, highlightedMessageId, messages]);

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
    <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-4 space-y-6">
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

        return (
          <div
            key={message.id}
            data-message-id={message.id}
            className={`group/msg flex ${isUser ? 'justify-end' : 'justify-start'}`}
          >
            <div className={`${isUser ? 'max-w-[85%]' : 'w-full'} ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
              {showConversationBadge && message.conversationTitle && (
                <div className="mb-1 px-2 py-0.5 bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 rounded text-xs font-medium self-start">
                  {message.conversationTitle}
                </div>
              )}

              <div
                className={`rounded-2xl px-4 py-3 transition-all duration-300 ${isUser
                  ? 'bg-[hsl(var(--muted))] text-[hsl(var(--foreground))] rounded-tr-sm'
                  : 'bg-transparent text-[hsl(var(--foreground))] px-0 py-0'
                  } ${isHighlighted ? 'ring-2 ring-purple-500 ring-offset-2 shadow-lg shadow-purple-200' : ''}`}
              >
                {isUser ? (
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

      <div ref={messagesEndRef} />
    </div>
  );
}
