'use client';

import { useEffect, useRef, useMemo } from 'react';
import { getGlobalValidator } from '@/lib/copy-validator';
import toast, { Toaster } from 'react-hot-toast';
import ConversationList from './ConversationList';
import ChatMessages from './ChatMessages';
import { useChatStore, type Conversation, type Message } from '@/stores/chatStore';

interface ChatPanelProps {
  sessionId?: string;
  assignmentId?: string;
  isOpen: boolean;
  onToggle: (isOpen: boolean) => void;
  // Replay mode props
  mode?: 'live' | 'replay';
  replayConversations?: Conversation[];
  replayMessages?: Message[];
}

export default function ChatPanel({
  sessionId,
  assignmentId,
  isOpen,
  onToggle,
  mode = 'live',
  replayConversations = [],
  replayMessages = []
}: ChatPanelProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const validator = getGlobalValidator();

  // Zustand store
  const {
    conversations,
    activeConversationId,
    messages,
    input,
    isLoading,
    isCreatingConversation,
    webSearchEnabled,
    setMode,
    setConversations,
    setActiveConversationId,
    setMessages,
    setInput,
    toggleWebSearch,
    loadConversations,
    loadMessages,
    createConversation,
    updateConversationTitle,
    deleteConversation,
    sendMessage,
  } = useChatStore();

  const isReplayMode = mode === 'replay';

  // Memoize replay props to prevent infinite loops
  const memoizedReplayMessages = useMemo(() => replayMessages, [JSON.stringify(replayMessages)]);
  const memoizedReplayConversations = useMemo(() => replayConversations, [JSON.stringify(replayConversations)]);

  // Set mode on mount
  useEffect(() => {
    setMode(mode);
  }, [mode, setMode]);

  // Load conversations on mount
  useEffect(() => {
    if (isReplayMode) {
      // Use replay conversations
      setConversations(memoizedReplayConversations.map(c => ({
        ...c,
        createdAt: new Date(c.createdAt)
      })));
      // Start with 'all' view for replay mode
      setActiveConversationId('all');
      return;
    }

    if (sessionId) {
      loadConversations(sessionId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, isReplayMode, memoizedReplayConversations]);

  // Load messages when active conversation changes
  useEffect(() => {
    if (!activeConversationId) return;

    if (isReplayMode) {
      // Filter replay messages by active conversation
      if (activeConversationId === 'all') {
        setMessages(memoizedReplayMessages);
      } else {
        const filtered = memoizedReplayMessages.filter(m =>
          m.conversationTitle === conversations.find(c => c.id === activeConversationId)?.title
        );
        setMessages(filtered);
      }
      return;
    }

    if (activeConversationId !== 'all') {
      loadMessages(activeConversationId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConversationId, isReplayMode, memoizedReplayMessages]);

  // Copy/Paste validation for chat input
  useEffect(() => {
    const inputElement = inputRef.current;
    if (!inputElement) return;

    const handleCopy = () => {
      const copiedContent = window.getSelection()?.toString();
      if (copiedContent) {
        validator.markInternalCopy(copiedContent);
      }
    };

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

    inputElement.addEventListener('copy', handleCopy);
    inputElement.addEventListener('paste', handlePaste as EventListener);

    return () => {
      inputElement.removeEventListener('copy', handleCopy);
      inputElement.removeEventListener('paste', handlePaste as EventListener);
    };
  }, [validator]);

  // Auto-generate title from first message (only in live mode)
  useEffect(() => {
    if (isReplayMode) return;

    if (messages.length === 1 && activeConversationId && activeConversationId !== 'all') {
      const firstMessage = messages[0];
      if (firstMessage.role === 'user') {
        const title = firstMessage.content.slice(0, 50) + (firstMessage.content.length > 50 ? '...' : '');
        updateConversationTitle(activeConversationId, title);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, activeConversationId, isReplayMode]);

  // Handle form submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading || !activeConversationId || activeConversationId === 'all') return;

    await sendMessage({
      conversationId: activeConversationId,
      sessionId,
      assignmentId,
    });
  };

  const handleCreateConversation = () => {
    if (sessionId) {
      createConversation(sessionId);
    }
  };

  const handleDeleteConversation = async (conversationId: string) => {
    await deleteConversation(conversationId);

    // If we need to create a new conversation after deleting the last one
    if (conversations.length === 1 && sessionId) {
      createConversation(sessionId);
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
            {/* New conversation button - only show in live mode */}
            {!isReplayMode && (
              <button
                onClick={handleCreateConversation}
                disabled={isCreatingConversation}
                className="text-gray-600 hover:text-gray-900 disabled:text-gray-400"
                title="New conversation"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
            )}
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

        {/* Conversation filter - show in replay mode when there are conversations */}
        {isReplayMode && conversations.length > 0 && (
          <div className="border-b border-gray-200 px-4 py-2 bg-gray-50">
            <select
              value={activeConversationId || ''}
              onChange={(e) => setActiveConversationId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All conversations ({conversations.length})</option>
              {conversations.map((conv) => (
                <option key={conv.id} value={conv.id}>
                  {conv.title}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Conversation List (collapsible) - only show in live mode */}
        {!isReplayMode && conversations.length > 1 && (
          <ConversationList
            conversations={conversations}
            activeConversationId={activeConversationId}
            onSelectConversation={setActiveConversationId}
            onUpdateTitle={updateConversationTitle}
            onDeleteConversation={handleDeleteConversation}
          />
        )}

        {/* Chat Messages */}
        <ChatMessages
          messages={messages}
          isLoading={isLoading}
          showConversationBadge={isReplayMode && activeConversationId === 'all'}
          showTimestamp={isReplayMode}
          enableCopy={!isReplayMode}
          showWebSearchIndicator={isReplayMode}
        />

        {/* Input - only show in live mode */}
        {!isReplayMode && (
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
                    onClick={toggleWebSearch}
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
        )}
      </div>
    </>
  );
}
