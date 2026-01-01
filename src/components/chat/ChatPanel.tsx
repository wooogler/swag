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
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export default function ChatPanel({ sessionId, assignmentId }: ChatPanelProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [isCreatingConversation, setIsCreatingConversation] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
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
    <div className="flex flex-col h-full">
      <Toaster
        toastOptions={{
          className: '',
          style: {
            cursor: 'pointer',
          },
        }}
      />
      {/* Header with New Conversation button */}
      <div className="border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <h3 className="font-semibold text-gray-900">AI Assistant</h3>
        <button
          onClick={createNewConversation}
          disabled={isCreatingConversation}
          className="bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700 disabled:bg-gray-400 text-xs font-medium"
        >
          {isCreatingConversation ? '...' : '+ New'}
        </button>
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
      <div className="border-t border-gray-200 p-4">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask for help with your essay..."
            disabled={!activeConversationId || isLoading}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 text-sm"
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading || !activeConversationId}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 text-sm font-medium"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
