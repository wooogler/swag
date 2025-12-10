'use client';

import { useEffect, useRef, useState } from 'react';
import { Message } from 'ai/react';
import { getGlobalValidator } from '@/lib/copy-validator';

interface ChatMessagesProps {
  messages: Message[];
  isLoading: boolean;
}

export default function ChatMessages({ messages, isLoading }: ChatMessagesProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const validator = getGlobalValidator();

  // Register all assistant messages with validator
  useEffect(() => {
    messages.forEach((message) => {
      if (message.role === 'assistant') {
        validator.registerChatMessage(message.content);
      }
    });
  }, [messages, validator]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const copyToClipboard = async (content: string, messageId: string) => {
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
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {messages.map((message) => {
        const isUser = message.role === 'user';
        const isCopied = copiedId === message.id;

        return (
          <div
            key={message.id}
            className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-lg px-4 py-2 ${
                isUser
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-900'
              }`}
            >
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <p className="text-sm whitespace-pre-wrap break-words">
                    {message.content}
                  </p>
                </div>

                {/* Copy button for assistant messages */}
                {!isUser && (
                  <button
                    onClick={() => copyToClipboard(message.content, message.id)}
                    className="flex-shrink-0 text-gray-500 hover:text-blue-600 transition-colors"
                    title="Copy message"
                  >
                    {isCopied ? (
                      <span className="text-green-600 text-xs">✓</span>
                    ) : (
                      <span className="text-xs">📋</span>
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {/* Loading indicator */}
      {isLoading && (
        <div className="flex justify-start">
          <div className="bg-gray-100 rounded-lg px-4 py-2">
            <div className="flex items-center gap-1">
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
