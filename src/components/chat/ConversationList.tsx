'use client';

import { useState } from 'react';

interface Conversation {
  id: string;
  title: string;
  createdAt: Date;
}

interface ConversationListProps {
  conversations: Conversation[];
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onUpdateTitle: (id: string, title: string) => void;
  onDeleteConversation: (id: string) => void;
}

export default function ConversationList({
  conversations,
  activeConversationId,
  onSelectConversation,
  onUpdateTitle,
  onDeleteConversation,
}: ConversationListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);

  const startEditing = (conv: Conversation) => {
    setEditingId(conv.id);
    setEditTitle(conv.title);
  };

  const saveTitle = (id: string) => {
    if (editTitle.trim()) {
      onUpdateTitle(id, editTitle.trim());
    }
    setEditingId(null);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditTitle('');
  };

  return (
    <div className="border-b border-gray-200">
      {/* Toggle button */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-2 flex items-center justify-between hover:bg-gray-50 text-sm"
      >
        <span className="text-gray-600">
          {conversations.length} conversation{conversations.length !== 1 ? 's' : ''}
        </span>
        <span className="text-gray-400">{isExpanded ? '▼' : '▶'}</span>
      </button>

      {/* Conversation list (collapsible) */}
      {isExpanded && (
        <div className="px-2 pb-2 space-y-1 max-h-48 overflow-y-auto">
          {conversations.map((conv) => {
            const isActive = conv.id === activeConversationId;
            const isEditing = editingId === conv.id;

            return (
              <div
                key={conv.id}
                className={`p-2 rounded cursor-pointer transition-colors ${
                  isActive
                    ? 'bg-blue-100 border border-blue-300'
                    : 'bg-white hover:bg-gray-50 border border-gray-200'
                }`}
                onClick={() => !isEditing && onSelectConversation(conv.id)}
              >
                {isEditing ? (
                  <div className="flex flex-col gap-1" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveTitle(conv.id);
                        if (e.key === 'Escape') cancelEditing();
                      }}
                      className="text-sm border border-gray-300 rounded px-2 py-1 w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
                      autoFocus
                    />
                    <div className="flex gap-1">
                      <button
                        onClick={() => saveTitle(conv.id)}
                        className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700"
                      >
                        Save
                      </button>
                      <button
                        onClick={cancelEditing}
                        className="text-xs bg-gray-300 text-gray-700 px-2 py-1 rounded hover:bg-gray-400"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {conv.title}
                      </p>
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          startEditing(conv);
                        }}
                        className="text-xs text-gray-500 hover:text-blue-600"
                        title="Edit title"
                      >
                        ✎
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteConversation(conv.id);
                        }}
                        className="text-xs text-gray-500 hover:text-red-600"
                        title="Delete conversation"
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
