'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { BlockNoteView } from '@blocknote/mantine';
import { useCreateBlockNote } from '@blocknote/react';
import ChatPanel from '@/components/chat/ChatPanel';
import { useUIStore } from '@/stores/uiStore';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';

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
  // UI Store for chat panel
  const {
    isChatOpen,
    chatWidth,
    isResizing,
    setChatOpen,
    startResize,
    handleResize,
    stopResize,
  } = useUIStore();

  // Replay-specific state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(startTime);
  const [speed, setSpeed] = useState(5); // Default 5x speed
  const [editorDocument, setEditorDocument] = useState<any[]>([
    { type: 'paragraph', content: [] }
  ]);
  const [visibleMessages, setVisibleMessages] = useState<ChatMessage[]>([]);
  const [lastPasteEvent, setLastPasteEvent] = useState<{ type: string; timestamp: number } | null>(null);
  const [isEditorReady, setIsEditorReady] = useState(false);

  const animationRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number>(0);

  // Create BlockNote editor for replay
  const editor = useCreateBlockNote({
    initialContent: [{ type: 'paragraph', content: [] }],
  });

  // Mark editor as ready after mount
  useEffect(() => {
    if (editor) {
      const timer = setTimeout(() => {
        const tiptapEditor = (editor as any)._tiptapEditor;
        if (tiptapEditor && tiptapEditor.view) {
          setIsEditorReady(true);
        }
      }, 100); // Small delay to ensure Tiptap is fully mounted

      return () => clearTimeout(timer);
    }
  }, [editor]);

  const duration = endTime - startTime;

  // Detect idle periods FIRST (gaps > 2 minutes with no activity)
  const idlePeriods = useMemo(() => {
    const IDLE_THRESHOLD = 2 * 60 * 1000; // 2 minutes
    const allEventTimes: number[] = [];

    // Collect all event timestamps
    events.forEach(e => allEventTimes.push(e.timestamp));
    chatMessages.forEach(m => allEventTimes.push(m.timestamp));
    
    // Sort by time
    allEventTimes.sort((a, b) => a - b);

    const periods: Array<{ 
      start: number; 
      end: number; 
      duration: number;
      compressedMinutes: number; // 압축된 분 단위
      edgeSeconds: number; // 앞뒤 표시할 시간 (초)
    }> = [];

    for (let i = 0; i < allEventTimes.length - 1; i++) {
      const gap = allEventTimes[i + 1] - allEventTimes[i];
      if (gap > IDLE_THRESHOLD) {
        const totalSeconds = Math.floor(gap / 1000);
        const compressedMinutes = Math.floor(totalSeconds / 60); // 분 단위로 압축
        const remainingSeconds = totalSeconds - (compressedMinutes * 60);
        const edgeSeconds = Math.floor(remainingSeconds / 2); // 앞뒤 균등 분할
        
        periods.push({
          start: allEventTimes[i],
          end: allEventTimes[i + 1],
          duration: gap,
          compressedMinutes,
          edgeSeconds,
        });
      }
    }

    return periods;
  }, [events, chatMessages]);

  // Calculate compressed timeline (remove idle periods, keeping only edges)
  const getCompressedTime = useCallback((realTime: number) => {
    let compressed = realTime - startTime;
    
    // Subtract compressed idle periods before this time
    idlePeriods.forEach(idle => {
      const idleMiddleStart = idle.start + (idle.edgeSeconds * 1000);
      const idleMiddleEnd = idle.end - (idle.edgeSeconds * 1000);
      const compressedDuration = idle.compressedMinutes * 60 * 1000;
      
      if (realTime >= idleMiddleEnd) {
        // We're past the entire idle period - subtract the compressed part
        compressed -= compressedDuration;
      } else if (realTime >= idleMiddleStart) {
        // We're in the middle (compressed) part - this shouldn't happen with jump,
        // but handle it just in case
        compressed -= (realTime - idleMiddleStart);
      }
    });

    return compressed + startTime;
  }, [startTime, idlePeriods]);

  const getRealTime = useCallback((compressedTime: number) => {
    let real = compressedTime - startTime;
    let accumulatedCompression = 0;

    for (const idle of idlePeriods) {
      const idleStartCompressed = idle.start - startTime - accumulatedCompression;
      const compressedDuration = idle.compressedMinutes * 60 * 1000;
      
      if (compressedTime - startTime > idleStartCompressed + (idle.edgeSeconds * 1000)) {
        // We've passed this idle period's first edge
        real += compressedDuration;
        accumulatedCompression += compressedDuration;
      } else {
        break;
      }
    }

    return real + startTime;
  }, [startTime, idlePeriods]);

  // Compressed timeline duration
  const compressedDuration = useMemo(() => {
    const totalCompression = idlePeriods.reduce((sum, idle) => 
      sum + (idle.compressedMinutes * 60 * 1000), 0
    );
    return duration - totalCompression;
  }, [duration, idlePeriods]);

  const progress = compressedDuration > 0 
    ? ((getCompressedTime(currentTime) - startTime) / compressedDuration) * 100 
    : 0;

  // Handle resize with mouse events
  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => handleResize(e.clientX);
    const handleMouseUp = () => stopResize();

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, handleResize, stopResize]);

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
      // Return BlockNote document structure directly
      const doc = snapshot.eventData as unknown as any[];
      if (Array.isArray(doc)) {
        return doc;
      }
    }

    // No snapshot yet - show initial state (empty paragraph)
    return [{ type: 'paragraph', content: [] }];
  }, [findNearestSnapshot]);

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
        let newTime = prev + deltaMs * speed;
        
        // Check if we're entering an idle period and skip it
        for (const idle of idlePeriods) {
          const idleMiddleStart = idle.start + (idle.edgeSeconds * 1000);
          const idleMiddleEnd = idle.end - (idle.edgeSeconds * 1000);
          
          // If we just entered the compressed middle part, jump to the end
          if (prev < idleMiddleStart && newTime >= idleMiddleStart) {
            newTime = idleMiddleEnd;
            break;
          }
        }
        
        if (newTime >= endTime) {
          // Stop playing when reaching the end
          // Use setTimeout to avoid state update during render
          setTimeout(() => setIsPlaying(false), 0);
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
  }, [isPlaying, speed, endTime, idlePeriods]);

  // Update content when current time changes
  useEffect(() => {
    const content = rebuildContent(currentTime);
    setEditorDocument(content);
    updateVisibleMessages(currentTime);
    checkPasteEvents(currentTime);
  }, [currentTime, rebuildContent, updateVisibleMessages, checkPasteEvents]);

  // Update editor when document changes
  useEffect(() => {
    if (!editor || !isEditorReady || editorDocument.length === 0) return;

    // Safely check if editor is ready
    try {
      const tiptapEditor = (editor as any)._tiptapEditor;
      if (!tiptapEditor || !tiptapEditor.view) {
        return; // Editor not fully mounted yet
      }

      // Prevent updates if content is the same
      const currentDoc = editor.document;
      if (JSON.stringify(currentDoc) === JSON.stringify(editorDocument)) {
        return;
      }

      editor.replaceBlocks(editor.document, editorDocument);
    } catch (error) {
      // Silently ignore editor update errors during replay
      console.debug('Editor update skipped:', error);
    }
  }, [editor, isEditorReady, editorDocument]);

  // Handle timeline click (accounting for compressed time)
  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = x / rect.width;
    const newCompressedTime = startTime + percentage * compressedDuration;
    const newRealTime = getRealTime(newCompressedTime);
    setCurrentTime(Math.max(startTime, Math.min(endTime, newRealTime)));
  };

  // Format time for display
  const formatTime = (ms: number) => {
    const seconds = Math.floor((ms - startTime) / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  // Get timeline markers for events (using compressed time)
  const getEventMarkers = () => {
    const markers: Array<{ position: number; type: string; tooltip: string }> = [];

    // Chat message markers
    chatMessages.forEach((msg) => {
      if (msg.role === 'user') {
        const compressedTime = getCompressedTime(msg.timestamp);
        const position = ((compressedTime - startTime) / compressedDuration) * 100;
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
        const compressedTime = getCompressedTime(event.timestamp);
        const position = ((compressedTime - startTime) / compressedDuration) * 100;
        markers.push({
          position,
          type: event.eventType,
          tooltip: event.eventType === 'paste_external' ? 'External paste attempt' : 'Internal paste',
        });
      });

    return markers;
  };

  // Get typing sessions from snapshots
  const getTypingSessions = useCallback(() => {
    const snapshots = events
      .filter(e => e.eventType === 'snapshot')
      .sort((a, b) => a.timestamp - b.timestamp);

    const sessions: Array<{ startTime: number; endTime: number }> = [];
    const GAP_THRESHOLD = 10000; // 10초 gap (snapshot이 없으면 활동 없음)
    
    if (snapshots.length === 0) return sessions;

    let currentSession = {
      startTime: snapshots[0].timestamp,
      endTime: snapshots[0].timestamp,
    };

    for (let i = 1; i < snapshots.length; i++) {
      const timeSinceLastSnapshot = snapshots[i].timestamp - currentSession.endTime;

      if (timeSinceLastSnapshot <= GAP_THRESHOLD) {
        // 같은 세션 - 종료 시간 연장
        currentSession.endTime = snapshots[i].timestamp;
      } else {
        // 새로운 세션 시작
        sessions.push(currentSession);
        currentSession = {
          startTime: snapshots[i].timestamp,
          endTime: snapshots[i].timestamp,
        };
      }
    }

    // 마지막 세션 추가
    sessions.push(currentSession);

    return sessions;
  }, [events]);

  const markers = getEventMarkers();
  const typingSessions = getTypingSessions();

  // Get all navigable events
  const getNavigableEvents = useCallback(() => {
    const navEvents: Array<{ 
      time: number; 
      type: 'typing_start' | 'chat' | 'paste_internal' | 'paste_external';
      label: string;
      description: string;
    }> = [];

    // Typing session starts
    typingSessions.forEach((session, i) => {
      navEvents.push({
        time: session.startTime,
        type: 'typing_start',
        label: `Typing Session ${i + 1}`,
        description: `Started at ${formatTime(session.startTime)}`,
      });
    });

    // Chat messages
    chatMessages.forEach((msg, i) => {
      if (msg.role === 'user') {
        navEvents.push({
          time: msg.timestamp,
          type: 'chat',
          label: `Chat Message ${i + 1}`,
          description: msg.content.slice(0, 50) + (msg.content.length > 50 ? '...' : ''),
        });
      }
    });

    // Paste events
    events
      .filter(e => e.eventType === 'paste_internal' || e.eventType === 'paste_external')
      .forEach((event, i) => {
        navEvents.push({
          time: event.timestamp,
          type: event.eventType as 'paste_internal' | 'paste_external',
          label: event.eventType === 'paste_external' ? `External Paste ${i + 1}` : `Internal Paste ${i + 1}`,
          description: `At ${formatTime(event.timestamp)}`,
        });
      });

    // Sort by time
    return navEvents.sort((a, b) => a.time - b.time);
  }, [typingSessions, chatMessages, events, formatTime]);

  const navigableEvents = getNavigableEvents();
  const [showEventMenu, setShowEventMenu] = useState(false);

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
          <div className="text-sm text-gray-600 w-32">
            {formatTime(currentTime)} / {formatTime(endTime)}
            {idlePeriods.length > 0 && (
              <div className="text-xs text-orange-600">
                ({idlePeriods.length} breaks)
              </div>
            )}
          </div>

          {/* Timeline Container */}
          <div className="flex-1 flex flex-col gap-1">
            {/* Typing Activity Bar (위쪽) */}
            <div className="h-2 bg-gray-100 rounded relative">
              {typingSessions.map((session, i) => {
                const compressedStart = getCompressedTime(session.startTime);
                const compressedEnd = getCompressedTime(session.endTime);
                const startPos = ((compressedStart - startTime) / compressedDuration) * 100;
                const endPos = ((compressedEnd - startTime) / compressedDuration) * 100;
                const width = endPos - startPos;
                
                return (
                  <div
                    key={`session-${i}`}
                    className="absolute top-0 h-full bg-blue-400 rounded"
                    style={{ 
                      left: `${startPos}%`,
                      width: `${width}%`,
                    }}
                    title={`Typing: ${formatTime(session.startTime)} - ${formatTime(session.endTime)}`}
                  />
                );
              })}
              
              {/* Idle period indicators - compressed middle part only */}
              {idlePeriods.map((idle, i) => {
                const middleStart = idle.start + (idle.edgeSeconds * 1000);
                const compressedMiddleStart = getCompressedTime(middleStart);
                const middlePos = ((compressedMiddleStart - startTime) / compressedDuration) * 100;
                
                // Fixed width for visibility
                const markerWidth = 2; // 2% width
                // Center the marker by offsetting half its width
                const centeredPos = middlePos - (markerWidth / 2);
                
                return (
                  <div key={`idle-${i}`}>
                    {/* Only show the compressed middle part (dark gray) */}
                    <div
                      className="absolute top-0 h-full bg-gray-700"
                      style={{ 
                        left: `${centeredPos}%`,
                        width: `${markerWidth}%`,
                      }}
                      title={`Break: ${idle.compressedMinutes} min compressed`}
                    >
                      <div 
                        className="absolute -top-5 left-1/2 transform -translate-x-1/2 text-xs font-bold text-gray-800 whitespace-nowrap"
                      >
                        {idle.compressedMinutes} min
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Main Timeline (아래쪽) */}
            <div
              className="h-4 bg-gray-200 rounded cursor-pointer relative"
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

        {/* Legend and Event Navigation - Same Row */}
        <div className="flex items-center justify-between mt-2">
          {/* Legend */}
          <div className="flex items-center gap-4 text-xs text-gray-500">
            <div className="flex items-center gap-1">
              <div className="w-4 h-2 bg-blue-400 rounded" />
              <span>Typing Activity</span>
            </div>
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
            {idlePeriods.length > 0 && (
              <div className="flex items-center gap-1">
                <div className="w-3 h-2 bg-gray-700 rounded" />
                <span>Break (compressed)</span>
              </div>
            )}
          </div>

          {/* Event Navigation Dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowEventMenu(!showEventMenu)}
              className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded text-sm font-medium flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
              Events
              <svg className={`w-4 h-4 transition-transform ${showEventMenu ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {showEventMenu && (
              <>
                {/* Backdrop */}
                <div 
                  className="fixed inset-0 z-10" 
                  onClick={() => setShowEventMenu(false)}
                />
                
                {/* Dropdown Menu */}
                <div className="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-xl border border-gray-200 z-20 max-h-96 overflow-y-auto">
                  <div className="sticky top-0 bg-gray-50 px-4 py-2 border-b border-gray-200">
                    <p className="text-xs font-semibold text-gray-600 uppercase">
                      Jump to Event ({navigableEvents.length})
                    </p>
                  </div>
                  
                  {navigableEvents.length === 0 ? (
                    <div className="px-4 py-8 text-center text-gray-500 text-sm">
                      No events recorded
                    </div>
                  ) : (
                    <div className="py-1">
                      {navigableEvents.map((event, i) => {
                        const isPast = event.time <= currentTime;
                        const eventIcon = event.type === 'typing_start' ? '⌨️' :
                                        event.type === 'chat' ? '💬' :
                                        event.type === 'paste_internal' ? '📋' : '🚫';
                        
                        return (
                          <button
                            key={i}
                            onClick={() => {
                              setCurrentTime(event.time);
                              setShowEventMenu(false);
                            }}
                            className={`w-full px-4 py-3 text-left transition-colors border-b border-gray-100 last:border-0 ${
                              isPast 
                                ? 'bg-blue-50 hover:bg-blue-100' 
                                : 'bg-white hover:bg-gray-50'
                            }`}
                          >
                            <div className="flex items-start gap-3">
                              <span className="text-lg mt-0.5">{eventIcon}</span>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-2">
                                  <p className={`text-sm font-medium truncate ${
                                    isPast ? 'text-blue-700' : 'text-gray-900'
                                  }`}>
                                    {event.label}
                                  </p>
                                  <span className={`text-xs font-mono whitespace-nowrap ${
                                    isPast ? 'text-blue-600' : 'text-gray-500'
                                  }`}>
                                    {formatTime(event.time)}
                                  </span>
                                </div>
                                <p className={`text-xs mt-1 truncate ${
                                  isPast ? 'text-blue-600' : 'text-gray-500'
                                }`}>
                                  {event.description}
                                </p>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
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
              <BlockNoteView
                editor={editor}
                editable={false}
                theme="light"
              />
            </div>
          </div>
        </div>

        {/* Resize Handle - only show when chat is open */}
        {isChatOpen && (
          <div
            className="w-1 bg-gray-200 hover:bg-blue-500 cursor-col-resize transition-colors"
            onMouseDown={startResize}
          />
        )}

        {/* Chat View (Right) - Resizable with ChatPanel */}
        {isChatOpen && (
          <div className="bg-gray-50" style={{ width: `${chatWidth}px` }}>
            <ChatPanel
              mode="replay"
              isOpen={isChatOpen}
              onToggle={setChatOpen}
              replayConversations={conversations.map(c => ({
                id: c.id,
                title: c.title,
                createdAt: new Date(c.createdAt),
              }))}
              replayMessages={visibleMessages.map(msg => ({
                id: msg.id,
                role: msg.role as 'user' | 'assistant',
                content: msg.content,
                conversationTitle: msg.conversationTitle,
                timestamp: msg.timestamp,
                metadata: msg.metadata as { webSearchEnabled?: boolean; webSearchUsed?: boolean; [key: string]: any } | undefined,
              }))}
            />
          </div>
        )}

        {/* Floating chat button when closed */}
        {!isChatOpen && (
          <div className="fixed top-1/2 right-0 -translate-y-1/2 z-50">
            <button
              onClick={() => setChatOpen(true)}
              className="bg-blue-600 text-white px-3 py-6 rounded-l-lg shadow-lg hover:px-4 transition-all duration-300 flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
              <span className="text-xs font-medium">AI</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
