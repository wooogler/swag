'use client';

import { useState, useEffect } from 'react';
import { useChat } from 'ai/react';
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

export default function ChatPanel({ sessionId, assignmentId }: ChatPanelProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [isCreatingConversation, setIsCreatingConversation] = useState(false);

  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
    api: '/api/chat',
    body: {
      conversationId: activeConversationId,
      sessionId,
      assignmentId,
    },
  });

  // Create initial conversation on mount
  useEffect(() => {
    createNewConversation();
  }, []);

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
  }, [messages]);

  return (
    <div className="flex flex-col h-full">
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
            type="text"
            value={input}
            onChange={handleInputChange}
            placeholder="Ask for help with your essay..."
            disabled={!activeConversationId}
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
