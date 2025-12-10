'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface EditorEvent {
  id: number;
  sessionId: string;
  eventType: string;
  eventData: Record<string, unknown>;
  timestamp: number;
  sequenceNumber: number;
}

interface ChatMessage {
  id: number;
  conversationId: string;
  conversationTitle: string;
  role: string;
  content: string;
  metadata: Record<string, unknown> | null;
  timestamp: number;
  sequenceNumber: number;
}

interface Conversation {
  id: string;
  sessionId: string;
  title: string;
  createdAt: number;
}

interface ReplayPlayerProps {
  events: EditorEvent[];
  chatMessages: ChatMessage[];
  conversations: Conversation[];
  startTime: number;
  endTime: number;
}

const SPEED_OPTIONS = [0.5, 1, 2, 5, 10];

export default function ReplayPlayer({
  events,
  chatMessages,
  conversations,
  startTime,
  endTime,
}: ReplayPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(startTime);
  const [speed, setSpeed] = useState(5); // Default 5x speed
  const [editorContent, setEditorContent] = useState('');
  const [visibleMessages, setVisibleMessages] = useState<ChatMessage[]>([]);
  const [lastPasteEvent, setLastPasteEvent] = useState<{ type: string; timestamp: number } | null>(null);

  const animationRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number>(0);

  const duration = endTime - startTime;
  const progress = duration > 0 ? ((currentTime - startTime) / duration) * 100 : 0;

  // Find the nearest snapshot before current time
  const findNearestSnapshot = useCallback((time: number) => {
    const snapshots = events.filter(
      e => e.eventType === 'snapshot' && e.timestamp <= time
    );
    return snapshots[snapshots.length - 1];
  }, [events]);

  // Rebuild editor content up to current time
  const rebuildContent = useCallback((time: number) => {
    // Find nearest snapshot before current time
    const snapshot = findNearestSnapshot(time);

    if (snapshot && snapshot.eventData) {
      // Extract text from BlockNote document structure
      const doc = snapshot.eventData as unknown as Array<{
        type?: string;
        content?: Array<{ type?: string; text?: string; styles?: any }>;
      }>;

      if (Array.isArray(doc)) {
        let text = '';
        doc.forEach((block) => {
          if (block.type === 'paragraph' && block.content && Array.isArray(block.content)) {
            block.content.forEach((item) => {
              if (item.type === 'text' && item.text) {
                text += item.text;
              }
            });
            text += '\n';
          }
        });
        return text.trim();
      }
    }

    // No snapshot yet - show initial state (empty)
    return '';
  }, [events, findNearestSnapshot]);

  // Update visible messages based on current time
  const updateVisibleMessages = useCallback((time: number) => {
    const visible = chatMessages.filter(m => m.timestamp <= time);
    setVisibleMessages(visible);
  }, [chatMessages]);

  // Check for paste events at current time
  const checkPasteEvents = useCallback((time: number) => {
    const recentPastes = events.filter(
      e => (e.eventType === 'paste_internal' || e.eventType === 'paste_external') &&
           e.timestamp <= time &&
           e.timestamp > time - 2000 // Show for 2 seconds
    );

    if (recentPastes.length > 0) {
      const latest = recentPastes[recentPastes.length - 1];
      setLastPasteEvent({ type: latest.eventType, timestamp: latest.timestamp });
    } else {
      setLastPasteEvent(null);
    }
  }, [events]);

  // Animation loop
  useEffect(() => {
    if (!isPlaying) {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      return;
    }

    const animate = (frameTime: number) => {
      if (lastFrameTimeRef.current === 0) {
        lastFrameTimeRef.current = frameTime;
      }

      const deltaMs = frameTime - lastFrameTimeRef.current;
      lastFrameTimeRef.current = frameTime;

      setCurrentTime((prev) => {
        const newTime = prev + deltaMs * speed;
        if (newTime >= endTime) {
          setIsPlaying(false);
          return endTime;
        }
        return newTime;
      });

      animationRef.current = requestAnimationFrame(animate);
    };

    lastFrameTimeRef.current = 0;
    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isPlaying, speed, endTime]);

  // Update content when current time changes
  useEffect(() => {
    const content = rebuildContent(currentTime);
    setEditorContent(content);
    updateVisibleMessages(currentTime);
    checkPasteEvents(currentTime);
  }, [currentTime, rebuildContent, updateVisibleMessages, checkPasteEvents]);

  // Handle timeline click
  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = x / rect.width;
    const newTime = startTime + percentage * duration;
    setCurrentTime(Math.max(startTime, Math.min(endTime, newTime)));
  };

  // Format time for display
  const formatTime = (ms: number) => {
    const seconds = Math.floor((ms - startTime) / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  // Get timeline markers for events
  const getEventMarkers = () => {
    const markers: Array<{ position: number; type: string; tooltip: string }> = [];

    // Chat message markers
    chatMessages.forEach((msg) => {
      if (msg.role === 'user') {
        const position = ((msg.timestamp - startTime) / duration) * 100;
        markers.push({
          position,
          type: 'chat',
          tooltip: `Chat: "${msg.content.slice(0, 50)}..."`,
        });
      }
    });

    // Paste event markers
    events
      .filter(e => e.eventType === 'paste_internal' || e.eventType === 'paste_external')
      .forEach((event) => {
        const position = ((event.timestamp - startTime) / duration) * 100;
        markers.push({
          position,
          type: event.eventType,
          tooltip: event.eventType === 'paste_external' ? 'External paste attempt' : 'Internal paste',
        });
      });

    return markers;
  };

  const markers = getEventMarkers();

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Timeline Controls */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center gap-4">
          {/* Play/Pause Button */}
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className="w-10 h-10 flex items-center justify-center bg-blue-600 text-white rounded-full hover:bg-blue-700"
          >
            {isPlaying ? (
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <rect x="6" y="5" width="3" height="10" />
                <rect x="11" y="5" width="3" height="10" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <polygon points="6,4 16,10 6,16" />
              </svg>
            )}
          </button>

          {/* Time Display */}
          <div className="text-sm text-gray-600 w-24">
            {formatTime(currentTime)} / {formatTime(endTime)}
          </div>

          {/* Timeline */}
          <div
            className="flex-1 h-6 bg-gray-200 rounded cursor-pointer relative"
            onClick={handleTimelineClick}
          >
            {/* Progress bar */}
            <div
              className="absolute top-0 left-0 h-full bg-blue-500 rounded-l"
              style={{ width: `${progress}%` }}
            />

            {/* Event markers */}
            {markers.map((marker, i) => (
              <div
                key={i}
                className={`absolute top-0 w-1 h-full ${
                  marker.type === 'paste_external'
                    ? 'bg-red-500'
                    : marker.type === 'paste_internal'
                    ? 'bg-green-500'
                    : 'bg-purple-500'
                }`}
                style={{ left: `${marker.position}%` }}
                title={marker.tooltip}
              />
            ))}

            {/* Playhead */}
            <div
              className="absolute top-0 w-3 h-full bg-blue-700 rounded"
              style={{ left: `calc(${progress}% - 6px)` }}
            />
          </div>

          {/* Speed Control */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">Speed:</span>
            <select
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              className="px-2 py-1 border border-gray-300 rounded text-sm"
            >
              {SPEED_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}x
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-purple-500 rounded" />
            <span>Chat</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-green-500 rounded" />
            <span>Internal Paste</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-red-500 rounded" />
            <span>External Paste</span>
          </div>
        </div>
      </div>

      {/* Split View */}
      <div className="flex-1 flex overflow-hidden">
        {/* Editor View (Left) */}
        <div className="flex-1 flex flex-col border-r border-gray-200">
          <div className="px-4 py-2 bg-gray-100 border-b border-gray-200">
            <h2 className="font-semibold text-gray-900">Editor</h2>
          </div>
          <div className="flex-1 overflow-auto p-6 bg-white relative">
            {/* Paste indicator */}
            {lastPasteEvent && (
              <div
                className={`absolute top-4 right-4 px-3 py-1 rounded text-sm font-medium ${
                  lastPasteEvent.type === 'paste_external'
                    ? 'bg-red-100 text-red-700'
                    : 'bg-green-100 text-green-700'
                }`}
              >
                {lastPasteEvent.type === 'paste_external'
                  ? 'External Paste Blocked'
                  : 'Content Pasted'}
              </div>
            )}

            <div className="max-w-3xl mx-auto">
              <div className="prose">
                <pre className="whitespace-pre-wrap font-sans text-base text-gray-900 bg-transparent border-0 p-0">
                  {editorContent || (
                    <span className="text-gray-400 italic">No content yet...</span>
                  )}
                </pre>
              </div>
            </div>
          </div>
        </div>

        {/* Chat View (Right) */}
        <div className="w-96 flex flex-col bg-gray-50">
          <div className="px-4 py-2 bg-gray-100 border-b border-gray-200">
            <h2 className="font-semibold text-gray-900">
              AI Assistant
              {conversations.length > 0 && (
                <span className="ml-2 text-sm font-normal text-gray-500">
                  ({conversations.length} conversation{conversations.length !== 1 ? 's' : ''})
                </span>
              )}
            </h2>
          </div>
          <div className="flex-1 overflow-auto p-4">
            {visibleMessages.length === 0 ? (
              <div className="text-center text-gray-500 mt-8">
                No chat messages yet at this point
              </div>
            ) : (
              <div className="space-y-4">
                {visibleMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`p-3 rounded-lg ${
                      msg.role === 'user'
                        ? 'bg-blue-100 ml-8'
                        : 'bg-white border border-gray-200 mr-8'
                    }`}
                  >
                    <div className="text-xs text-gray-500 mb-1">
                      {msg.role === 'user' ? 'Student' : 'AI Assistant'}
                      <span className="ml-2">
                        {new Date(msg.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="text-sm text-gray-900 whitespace-pre-wrap">
                      {msg.content}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
