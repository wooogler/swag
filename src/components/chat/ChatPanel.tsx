'use client';

import { useState, useEffect, useRef } from 'react';
import { getGlobalValidator } from '@/lib/copy-validator';
import toast, { Toaster } from 'react-hot-toast';
import ConversationList from './ConversationList';
import ChatMessages from './ChatMessages';

interface Conversation {
  id: string;
  title: string;
  createdAt: Date;
}

interface ChatPanelProps {
  sessionId: string;
  assignmentId: string;
  isOpen: boolean;
  onToggle: (isOpen: boolean) => void;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export default function ChatPanel({ sessionId, assignmentId, isOpen, onToggle }: ChatPanelProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [isCreatingConversation, setIsCreatingConversation] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const validator = getGlobalValidator();

  // Load existing conversations on mount
  useEffect(() => {
    const loadConversations = async () => {
      try {
        const response = await fetch('/api/conversations/list', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            sessionId,
          }),
        });

        if (!response.ok) {
          throw new Error('Failed to load conversations');
        }

        const { conversations: existingConversations } = await response.json();

        if (existingConversations.length > 0) {
          // Load existing conversations
          setConversations(existingConversations.map((conv: any) => ({
            id: conv.id,
            title: conv.title,
            createdAt: new Date(conv.createdAt),
          })));
          // Set the most recent conversation as active
          setActiveConversationId(existingConversations[existingConversations.length - 1].id);
        } else {
          // No existing conversations, create a new one
          createNewConversation();
        }
      } catch (error) {
        console.error('Failed to load conversations:', error);
        // Fallback: create new conversation
        createNewConversation();
      }
    };

    loadConversations();
  }, [sessionId]);

  // Load messages when active conversation changes
  useEffect(() => {
    if (!activeConversationId) return;

    const loadMessages = async () => {
      try {
        const response = await fetch('/api/conversations/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            conversationId: activeConversationId,
          }),
        });

        if (!response.ok) {
          throw new Error('Failed to load messages');
        }

        const { messages: loadedMessages } = await response.json();
        setMessages(loadedMessages);
      } catch (error) {
        console.error('Failed to load messages:', error);
      }
    };

    loadMessages();
  }, [activeConversationId]);

  // Paste validation for chat input
  useEffect(() => {
    const inputElement = inputRef.current;
    if (!inputElement) return;

    const handlePaste = (e: ClipboardEvent) => {
      const pastedContent = e.clipboardData?.getData('text/plain');
      if (!pastedContent) return;

      const isInternal = validator.validatePaste(pastedContent);

      if (!isInternal) {
        // Block external paste
        e.preventDefault();
        toast.error('External paste is blocked. You can only paste content from within this system.', {
          duration: 4000,
          position: 'top-center',
          style: {
            background: '#EF4444',
            color: '#fff',
          },
        });
      } else {
        // Clear the copy buffer after successful paste
        validator.clearCopyBuffer();
      }
    };

    inputElement.addEventListener('paste', handlePaste as EventListener);

    return () => {
      inputElement.removeEventListener('paste', handlePaste as EventListener);
    };
  }, [validator]);

  const createNewConversation = async () => {
    if (isCreatingConversation) return;
    setIsCreatingConversation(true);

    try {
      const response = await fetch('/api/conversations/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId,
        }),
      });

      const { conversationId, title } = await response.json();

      const newConversation: Conversation = {
        id: conversationId,
        title,
        createdAt: new Date(),
      };

      setConversations((prev) => [...prev, newConversation]);
      setActiveConversationId(conversationId);
      // Messages will be loaded by the useEffect when activeConversationId changes
    } catch (error) {
      console.error('Failed to create conversation:', error);
    } finally {
      setIsCreatingConversation(false);
    }
  };

  const updateConversationTitle = async (conversationId: string, title: string) => {
    try {
      await fetch('/api/conversations/update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          conversationId,
          title,
        }),
      });

      setConversations((prev) =>
        prev.map((conv) =>
          conv.id === conversationId ? { ...conv, title } : conv
        )
      );
    } catch (error) {
      console.error('Failed to update conversation title:', error);
    }
  };

  const deleteConversation = async (conversationId: string) => {
    if (!confirm('Delete this conversation?')) return;

    try {
      await fetch('/api/conversations/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ conversationId }),
      });

      setConversations((prev) => prev.filter((conv) => conv.id !== conversationId));

      // If deleted conversation was active, switch to another or create new
      if (activeConversationId === conversationId) {
        const remaining = conversations.filter((conv) => conv.id !== conversationId);
        if (remaining.length > 0) {
          setActiveConversationId(remaining[0].id);
        } else {
          createNewConversation();
        }
      }
    } catch (error) {
      console.error('Failed to delete conversation:', error);
    }
  };

  // Auto-generate title from first message
  useEffect(() => {
    if (messages.length === 1 && activeConversationId) {
      const firstMessage = messages[0];
      if (firstMessage.role === 'user') {
        const title = firstMessage.content.slice(0, 50) + (firstMessage.content.length > 50 ? '...' : '');
        updateConversationTitle(activeConversationId, title);
      }
    }
  }, [messages.length, activeConversationId]);

  // Handle form submit with streaming
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading || !activeConversationId) return;

    const userMessage: Message = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content: input.trim(),
    };

    // Add user message immediately
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [...messages, userMessage],
          conversationId: activeConversationId,
          sessionId,
          assignmentId,
          webSearchEnabled,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // Read streaming response
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('No reader available');
      }

      // Create assistant message placeholder
      const assistantMessageId = `msg_${Date.now() + 1}`;
      let assistantContent = '';

      setMessages((prev) => [
        ...prev,
        {
          id: assistantMessageId,
          role: 'assistant',
          content: '',
        },
      ]);

      // Read stream
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        assistantContent += chunk;

        // Update assistant message with accumulated content
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? { ...msg, content: assistantContent }
              : msg
          )
        );
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      // Optionally show error message to user
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <Toaster
        toastOptions={{
          className: '',
          style: {
            cursor: 'pointer',
          },
        }}
      />

      {/* Chat panel - always rendered for smooth animation */}
      <div className="flex flex-col h-full bg-white">
        {/* Header with New Conversation and Close buttons */}
        <div className="border-b border-gray-200 px-4 py-3 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">AI Assistant</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={createNewConversation}
              disabled={isCreatingConversation}
              className="text-gray-600 hover:text-gray-900 disabled:text-gray-400"
              title="New conversation"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            <button
              onClick={() => onToggle(false)}
              className="text-gray-600 hover:text-gray-900"
              title="Close chat"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Conversation List (collapsible) */}
        {conversations.length > 1 && (
          <ConversationList
            conversations={conversations}
            activeConversationId={activeConversationId}
            onSelectConversation={setActiveConversationId}
            onUpdateTitle={updateConversationTitle}
            onDeleteConversation={deleteConversation}
          />
        )}

        {/* Chat Messages */}
        <ChatMessages
          messages={messages}
          isLoading={isLoading}
        />

        {/* Input */}
        <div className="p-4 bg-gray-50">
          <form onSubmit={handleSubmit}>
            {/* ChatGPT-style input container */}
            <div className="bg-gray-200 border border-gray-300 rounded-2xl p-3 flex flex-col gap-2">
              {/* Textarea */}
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (input.trim() && activeConversationId && !isLoading) {
                      handleSubmit(e as any);
                    }
                  }
                }}
                placeholder="Ask for help with your essay..."
                disabled={!activeConversationId || isLoading}
                rows={1}
                className="w-full bg-transparent resize-none outline-none text-base placeholder-gray-500 disabled:text-gray-400"
                style={{
                  minHeight: '28px',
                  maxHeight: '200px',
                  height: 'auto',
                }}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = 'auto';
                  target.style.height = target.scrollHeight + 'px';
                }}
              />

              {/* Web Search Toggle and Send Button Row */}
              <div className="flex items-center justify-between">
                {/* Web Search Toggle - Ghost style */}
                <button
                  type="button"
                  onClick={() => setWebSearchEnabled(!webSearchEnabled)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-semibold transition-colors ${
                    webSearchEnabled
                      ? 'text-sky-500 bg-gray-300 hover:bg-gray-400'
                      : 'text-gray-500 hover:bg-gray-300'
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 919-9" />
                  </svg>
                  <span>Web search</span>
                </button>

                {/* Send Button - Circular */}
                <button
                  type="submit"
                  disabled={!input.trim() || isLoading || !activeConversationId}
                  className={`p-2 rounded-full transition-colors ${
                    input.trim() && activeConversationId && !isLoading
                      ? 'bg-gray-700 hover:bg-gray-800 text-white'
                      : 'bg-gray-300 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
                  </svg>
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
