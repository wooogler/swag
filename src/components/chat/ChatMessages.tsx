'use client';

import { useEffect, useRef, useState } from 'react';
import { getGlobalValidator } from '@/lib/copy-validator';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Message {
  id: string | number;
  role: 'user' | 'assistant';
  content: string;
  conversationTitle?: string;
  timestamp?: number;
  metadata?: {
    webSearchEnabled?: boolean;
    webSearchUsed?: boolean;
    [key: string]: any;
  };
}

interface ChatMessagesProps {
  messages: Message[];
  isLoading?: boolean;
  showConversationBadge?: boolean;
  showTimestamp?: boolean;
  enableCopy?: boolean;
  showWebSearchIndicator?: boolean;
}

export default function ChatMessages({
  messages,
  isLoading = false,
  showConversationBadge = false,
  showTimestamp = false,
  enableCopy = true,
  showWebSearchIndicator = false
}: ChatMessagesProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [copiedId, setCopiedId] = useState<string | number | null>(null);
  const validator = getGlobalValidator();

  // Register all messages with validator (both user and assistant)
  useEffect(() => {
    messages.forEach((message) => {
      validator.registerChatMessage(message.content);
    });
  }, [messages, validator]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const copyToClipboard = async (content: string, messageId: string | number) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(messageId);

      // Mark as internal copy in validator
      validator.markInternalCopy(content);

      setTimeout(() => setCopiedId(null), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <p className="text-gray-400 text-sm text-center">
          Start a conversation with the AI assistant to get help with your essay.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {messages.map((message, index) => {
        const isUser = message.role === 'user';
        const isCopied = copiedId === message.id;
        const isLastMessage = index === messages.length - 1;
        const isStreaming = isLastMessage && isLoading && !isUser;

        return (
          <div
            key={message.id}
            className="py-6 px-4 bg-gray-50"
          >
            <div className="max-w-3xl mx-auto">
              {isUser ? (
                // User message - ChatGPT style gray bubble
                <div className="flex justify-end">
                  <div className="bg-gray-200 text-gray-900 rounded-2xl px-4 py-2.5 max-w-[80%]">
                    {/* Conversation badge and timestamp for user messages */}
                    {(showConversationBadge || showTimestamp || (showWebSearchIndicator && message.metadata?.webSearchEnabled)) && (
                      <div className="flex items-center gap-2 mb-1 text-xs text-gray-600">
                        {showConversationBadge && message.conversationTitle && (
                          <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded font-medium">
                            {message.conversationTitle}
                          </span>
                        )}
                        {showTimestamp && message.timestamp && (
                          <span>{new Date(message.timestamp).toLocaleTimeString()}</span>
                        )}
                        {showWebSearchIndicator && message.metadata?.webSearchEnabled && (
                          <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded font-medium flex items-center gap-1">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                            </svg>
                            Web Search
                          </span>
                        )}
                      </div>
                    )}
                    <p className="text-base whitespace-pre-wrap wrap-break-word">
                      {message.content}
                    </p>
                  </div>
                </div>
              ) : (
                // Assistant message - full width, markdown, no bubble
                <div>
                  {/* Conversation badge and timestamp for AI messages */}
                  {(showConversationBadge || showTimestamp || (showWebSearchIndicator && message.metadata?.webSearchEnabled)) && (
                    <div className="flex items-center gap-2 mb-2 text-xs text-gray-600">
                      {showConversationBadge && message.conversationTitle && (
                        <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded font-medium">
                          {message.conversationTitle}
                        </span>
                      )}
                      {showTimestamp && message.timestamp && (
                        <span>{new Date(message.timestamp).toLocaleTimeString()}</span>
                      )}
                      {showWebSearchIndicator && message.metadata?.webSearchEnabled && (
                        <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded font-medium flex items-center gap-1">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                          </svg>
                          Web Search
                        </span>
                      )}
                    </div>
                  )}

                  <div className="prose prose-base max-w-none prose-pre:bg-gray-800 prose-pre:text-gray-100 prose-code:text-pink-600 prose-code:bg-pink-50 prose-code:px-1 prose-code:py-0.5 prose-code:rounded">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        a: ({ node, ...props }) => (
                          <a {...props} target="_blank" rel="noopener noreferrer" />
                        ),
                      }}
                    >
                      {message.content}
                    </ReactMarkdown>
                  </div>

                  {/* Copy button - only show when enabled and not streaming */}
                  {enableCopy && !isStreaming && (
                    <div className="mt-2">
                      <button
                        onClick={() => copyToClipboard(message.content, message.id)}
                        className="text-gray-400 hover:text-gray-600 transition-colors text-xs flex items-center gap-1"
                        title="Copy message"
                      >
                        {isCopied ? (
                          <>
                            <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            <span className="text-green-600">Copied!</span>
                          </>
                        ) : (
                          <>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                            <span>Copy</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* Loading indicator */}
      {isLoading && (
        <div className="py-6 px-4 bg-gray-50">
          <div className="max-w-3xl mx-auto">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
            </div>
          </div>
        </div>
      )}

      <div ref={messagesEndRef} />
    </div>
  );
}
