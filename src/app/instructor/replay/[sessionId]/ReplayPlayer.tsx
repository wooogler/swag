'use client';

import { useState, useEffect, useRef, useCallback, useMemo, useId } from 'react';
import { BlockNoteView } from '@blocknote/mantine';
import { useCreateBlockNote } from '@blocknote/react';
import { Plugin, PluginKey, Selection, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Step, StepMap } from '@tiptap/pm/transform';
import {
  Area,
  AreaChart,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts';
import ChatPanel from '@/components/chat/ChatPanel';
import type { ReplayPasteHighlight } from '@/components/chat/replayPasteHighlight';
import { useUIStore } from '@/stores/uiStore';
import {
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
  Menu,
  MenuButton,
  MenuItem,
  MenuItems,
} from '@headlessui/react';
import { Button } from '@/components/ui/button';
import { Tooltip as TimelineTooltip } from '@/components/ui/tooltip';
import { Play, Pause, ChevronDown, Check, Keyboard, MessageSquare, ClipboardCopy, AlertTriangle, Send, BarChart3, Info } from 'lucide-react';
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
  allowWebSearch: boolean;
}

const SPEED_OPTIONS = [0.5, 1, 2, 5, 10, 20];

const REPLAY_SHORTCUTS = [
  {
    keys: ['Space'],
    title: 'Play or pause',
    description: 'Toggle playback. If the replay is already at the end, it restarts from the beginning.',
  },
  {
    keys: ['←', '→'],
    title: 'Jump between events',
    description: 'Use left arrow for the previous major event and right arrow for the next one.',
  },
  {
    keys: ['W'],
    title: 'Toggle word count',
    description: 'Show or hide the word count graph when replay word count data is available.',
  },
  {
    keys: ['-', '= / +'],
    title: 'Adjust speed',
    description: 'Use - to slow down one step, and = or + to speed up one step through the preset replay speeds.',
  },
] as const;

interface WordCountTimelineEntry {
  timestamp: number;
  wordCount: number;
  userWordCount: number;
  gptWordCount: number;
}

interface WordCountGraphPoint {
  percentage: number;
  wordCount: number;
  userWordCount: number;
  gptWordCount: number;
  gptSharePct: number;
  time: number;
  timeFormatted: string;
}

interface HoveredWordCountPoint extends WordCountGraphPoint {
  viewportX: number;
  graphTop: number;
}

interface TypingOpEventData {
  stepJson?: Record<string, unknown>;
  stepType?: string;
  stepIndex?: number;
  stepCount?: number;
  transactionTimestamp?: number;
  wordCount?: number;
  docContentSize?: number;
  source?: 'user' | 'gpt';
}

interface EditorSelectionEventData {
  from?: number;
  to?: number;
}

interface ChatInputEventData {
  text?: string;
  selectionStart?: number;
  selectionEnd?: number;
  conversationId?: string | null;
  webSearchEnabled?: boolean;
}

interface ChatWebSearchToggleEventData {
  enabled?: boolean;
  conversationId?: string | null;
}

interface ReplayChatInputState {
  text: string;
  selectionStart: number;
  selectionEnd: number;
  webSearchEnabled: boolean;
  conversationId: string | null;
}

interface ReplayTypingOpEvent extends EditorEvent {
  replayTimestamp: number;
}

interface ReplaySelectionOverlayState {
  from: number;
  to: number;
}

type AuthorshipOrigin = 'user' | 'gpt';

interface AuthorshipRange {
  from: number;
  to: number;
  origin: AuthorshipOrigin;
}

interface ReplayAuthorshipOverlayState {
  enabled: boolean;
  ranges: AuthorshipRange[];
}

const findLastEventIndexAtOrBefore = (items: Array<{ timestamp: number }>, timestamp: number): number => {
  let left = 0;
  let right = items.length;

  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (items[mid].timestamp <= timestamp) {
      left = mid + 1;
    } else {
      right = mid;
    }
  }

  return left - 1;
};

const findLastReplayTypingIndexAtOrBefore = (
  items: ReplayTypingOpEvent[],
  replayTimestamp: number
): number => {
  let left = 0;
  let right = items.length;

  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (items[mid].replayTimestamp <= replayTimestamp) {
      left = mid + 1;
    } else {
      right = mid;
    }
  }

  return left - 1;
};

const clampPmPosition = (position: number, maxPosition: number): number => {
  if (!Number.isFinite(position)) return 0;
  return Math.min(Math.max(0, Math.floor(position)), maxPosition);
};

const replaySelectionPluginKey = new PluginKey<ReplaySelectionOverlayState | null>('replaySelectionOverlay');
const replayAuthorshipPluginKey = new PluginKey<ReplayAuthorshipOverlayState>('replayAuthorshipOverlay');

const mergeAuthorshipRanges = (ranges: AuthorshipRange[]): AuthorshipRange[] => {
  if (ranges.length === 0) return [];

  const normalized = ranges
    .filter((range) => Number.isFinite(range.from) && Number.isFinite(range.to) && range.to > range.from)
    .map((range) => ({
      ...range,
      from: Math.floor(range.from),
      to: Math.floor(range.to),
    }))
    .sort((a, b) => a.from - b.from || a.to - b.to);

  if (normalized.length === 0) return [];

  const merged: AuthorshipRange[] = [normalized[0]];
  for (let i = 1; i < normalized.length; i += 1) {
    const current = normalized[i];
    const last = merged[merged.length - 1];

    if (current.from <= last.to && current.origin === last.origin) {
      last.to = Math.max(last.to, current.to);
      continue;
    }

    merged.push(current);
  }

  return merged;
};

const cloneAuthorshipRanges = (ranges: AuthorshipRange[]): AuthorshipRange[] => {
  return ranges.map((range) => ({
    from: range.from,
    to: range.to,
    origin: range.origin,
  }));
};

const areAuthorshipRangesEqual = (a: AuthorshipRange[], b: AuthorshipRange[]): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].from !== b[i].from || a[i].to !== b[i].to || a[i].origin !== b[i].origin) {
      return false;
    }
  }
  return true;
};

const normalizeAuthorshipRangesForDoc = (
  ranges: AuthorshipRange[],
  maxPosition: number
): AuthorshipRange[] => {
  if (maxPosition <= 0) return [];

  return mergeAuthorshipRanges(
    ranges
      .map((range) => ({
        from: clampPmPosition(range.from, maxPosition),
        to: clampPmPosition(range.to, maxPosition),
        origin: range.origin,
      }))
      .filter((range) => range.to > range.from)
  );
};

const computeGptShareFromAuthorshipRanges = (
  ranges: AuthorshipRange[],
  docContentSize: number
): number => {
  if (docContentSize <= 0) return 0;

  const normalized = normalizeAuthorshipRangesForDoc(ranges, docContentSize);
  const gptSpan = normalized.reduce((sum, range) => (
    range.origin === 'gpt' ? sum + (range.to - range.from) : sum
  ), 0);

  return Math.max(0, Math.min(1, gptSpan / docContentSize));
};

const removeAuthorshipRange = (
  ranges: AuthorshipRange[],
  removeFrom: number,
  removeTo: number
): AuthorshipRange[] => {
  if (removeTo <= removeFrom || ranges.length === 0) return ranges;

  const next: AuthorshipRange[] = [];
  ranges.forEach((range) => {
    if (removeTo <= range.from || removeFrom >= range.to) {
      next.push(range);
      return;
    }

    if (range.from < removeFrom) {
      next.push({
        from: range.from,
        to: removeFrom,
        origin: range.origin,
      });
    }

    if (removeTo < range.to) {
      next.push({
        from: removeTo,
        to: range.to,
        origin: range.origin,
      });
    }
  });

  return mergeAuthorshipRanges(next);
};

const mapAuthorshipRangesThroughStepMap = (
  ranges: AuthorshipRange[],
  stepMap: StepMap,
  maxPosition: number
): AuthorshipRange[] => {
  const mapped: AuthorshipRange[] = [];

  ranges.forEach((range) => {
    const from = clampPmPosition(stepMap.map(range.from, 1), maxPosition);
    const to = clampPmPosition(stepMap.map(range.to, -1), maxPosition);
    const start = Math.min(from, to);
    const end = Math.max(from, to);
    if (end > start) {
      mapped.push({
        from: start,
        to: end,
        origin: range.origin,
      });
    }
  });

  return mergeAuthorshipRanges(mapped);
};

const applyStepToAuthorshipRanges = (
  ranges: AuthorshipRange[],
  stepMap: StepMap,
  origin: AuthorshipOrigin,
  maxPosition: number
): AuthorshipRange[] => {
  let next = mapAuthorshipRangesThroughStepMap(ranges, stepMap, maxPosition);

  stepMap.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
    const from = clampPmPosition(newStart, maxPosition);
    const to = clampPmPosition(newEnd, maxPosition);
    if (to <= from) return;
    next = removeAuthorshipRange(next, from, to);
    next.push({
      from,
      to,
      origin,
    });
  });

  return mergeAuthorshipRanges(next);
};

const createReplaySelectionPlugin = () => {
  return new Plugin<ReplaySelectionOverlayState | null>({
    key: replaySelectionPluginKey,
    state: {
      init: () => null,
      apply: (tr, value) => {
        const meta = tr.getMeta(replaySelectionPluginKey) as
          | ReplaySelectionOverlayState
          | null
          | undefined;
        if (meta === undefined) {
          return value;
        }
        return meta;
      },
    },
    props: {
      decorations(state) {
        const selection = replaySelectionPluginKey.getState(state);
        if (!selection) {
          return null;
        }

        const maxPosition = state.doc.content.size;
        let from = clampPmPosition(selection.from, maxPosition);
        let to = clampPmPosition(selection.to, maxPosition);
        if (from > to) {
          [from, to] = [to, from];
        }

        if (from === to) {
          const caret = Decoration.widget(
            from,
            () => {
              const element = document.createElement('span');
              element.style.display = 'inline-block';
              element.style.width = '0';
              element.style.height = '1.12em';
              element.style.marginLeft = '-1px';
              element.style.borderLeft = '2px solid #2563eb';
              element.style.verticalAlign = 'text-bottom';
              element.style.pointerEvents = 'none';
              return element;
            },
            {
              side: 1,
              key: `replay-caret-${from}`,
            }
          );

          return DecorationSet.create(state.doc, [caret]);
        }

        const rangeDecoration = Decoration.inline(from, to, {
          style: 'background-color: rgba(37, 99, 235, 0.22); border-radius: 2px;',
        });

        return DecorationSet.create(state.doc, [rangeDecoration]);
      },
    },
  });
};

const createReplayAuthorshipPlugin = () => {
  return new Plugin<ReplayAuthorshipOverlayState>({
    key: replayAuthorshipPluginKey,
    state: {
      init: () => ({ enabled: false, ranges: [] }),
      apply: (tr, value) => {
        const meta = tr.getMeta(replayAuthorshipPluginKey) as ReplayAuthorshipOverlayState | undefined;
        return meta ?? value;
      },
    },
    props: {
      decorations(state) {
        const overlay = replayAuthorshipPluginKey.getState(state);
        if (!overlay?.enabled) {
          return null;
        }

        const maxPosition = state.doc.content.size;
        if (maxPosition <= 0) {
          return null;
        }

        const normalized = mergeAuthorshipRanges(
          overlay.ranges
            .map((range) => ({
              from: clampPmPosition(range.from, maxPosition),
              to: clampPmPosition(range.to, maxPosition),
              origin: range.origin,
            }))
            .filter((range) => range.to > range.from)
        );

        const completed: AuthorshipRange[] = [];
        let cursor = 0;

        normalized.forEach((range) => {
          const start = Math.max(cursor, range.from);

          if (start > cursor) {
            completed.push({
              from: cursor,
              to: start,
              origin: 'user',
            });
          }

          if (range.to > start) {
            completed.push({
              from: start,
              to: range.to,
              origin: range.origin,
            });
            cursor = range.to;
          }
        });

        if (cursor < maxPosition) {
          completed.push({
            from: cursor,
            to: maxPosition,
            origin: 'user',
          });
        }

        const decorations = completed.map((range) => Decoration.inline(range.from, range.to, {
          style: range.origin === 'gpt'
            ? 'background-color: rgba(251, 191, 36, 0.30); border-radius: 2px;'
            : 'background-color: rgba(34, 197, 94, 0.22); border-radius: 2px;',
        }));

        if (decorations.length === 0) {
          return null;
        }

        return DecorationSet.create(state.doc, decorations);
      },
    },
  });
};

const extractBlockNoteText = (value: unknown): string => {
  const parts: string[] = [];

  const walk = (node: unknown, parentKey?: string) => {
    if (typeof node === 'string') {
      if (parentKey === 'text' || parentKey === 'content') {
        parts.push(node);
      }
      return;
    }

    if (Array.isArray(node)) {
      node.forEach((child) => walk(child, parentKey));
      return;
    }

    if (node && typeof node === 'object') {
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        walk(child, key);
      }
    }
  };

  walk(value);
  return parts.join(' ');
};

const countWordsFromDocument = (document: unknown): number => {
  const plainText = extractBlockNoteText(document)
    .replace(/\s+/g, ' ')
    .trim();

  if (!plainText) {
    return 0;
  }

  return plainText.split(' ').length;
};

const normalizeForMatching = (value: string): string => {
  return value
    .toLowerCase()
    .replace(/[`*_#>|[\]()-]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?%])/g, '$1')
    .trim();
};

type PasteSourceArea = 'chat' | 'editor' | 'instruction' | 'external' | 'unknown';
type PasteTargetArea = 'editor' | 'chat';
type ReplayPasteVariant = 'chat_to_editor' | 'internal_other' | 'external';

const normalizePasteSourceArea = (sourceArea: unknown, eventType: string): PasteSourceArea => {
  if (
    sourceArea === 'chat' ||
    sourceArea === 'editor' ||
    sourceArea === 'instruction' ||
    sourceArea === 'external' ||
    sourceArea === 'unknown'
  ) {
    return sourceArea;
  }
  return eventType === 'paste_external' ? 'external' : 'unknown';
};

const normalizePasteTargetArea = (targetArea: unknown): PasteTargetArea => {
  return targetArea === 'chat' ? 'chat' : 'editor';
};

const pasteAreaLabel = (area: PasteSourceArea | PasteTargetArea): string => {
  if (area === 'instruction') return 'Instruction';
  if (area === 'chat') return 'Chat';
  if (area === 'editor') return 'Editor';
  if (area === 'external') return 'External';
  return 'Unknown';
};

const getPasteRouteLabel = (event: EditorEvent): string => {
  const eventData = (event.eventData || {}) as { sourceArea?: unknown; targetArea?: unknown };
  const sourceArea = normalizePasteSourceArea(eventData.sourceArea, event.eventType);
  const targetArea = normalizePasteTargetArea(eventData.targetArea);
  return `${pasteAreaLabel(sourceArea)} -> ${pasteAreaLabel(targetArea)}`;
};

const getReplayPasteVariant = (event: EditorEvent): ReplayPasteVariant => {
  if (event.eventType === 'paste_external') {
    return 'external';
  }

  const eventData = (event.eventData || {}) as { sourceArea?: unknown; targetArea?: unknown };
  const sourceArea = normalizePasteSourceArea(eventData.sourceArea, event.eventType);
  const targetArea = normalizePasteTargetArea(eventData.targetArea);

  if (sourceArea === 'chat' && targetArea === 'editor') {
    return 'chat_to_editor';
  }

  return 'internal_other';
};

const getReplayPasteLabel = (event: EditorEvent): string => {
  const variant = getReplayPasteVariant(event);

  if (variant === 'external') {
    return 'External Paste';
  }

  if (variant === 'chat_to_editor') {
    return 'Chat -> Editor Paste';
  }

  return 'Other Internal Paste';
};

const formatClockDuration = (totalSeconds: number): string => {
  const safeSeconds = Math.max(0, totalSeconds);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const paddedMinutes = minutes.toString().padStart(2, '0');
  const seconds = safeSeconds % 60;
  const paddedSeconds = seconds.toString().padStart(2, '0');

  if (hours > 0) {
    return `${hours}:${paddedMinutes}:${paddedSeconds}`;
  }

  return `${minutes}:${paddedSeconds}`;
};

const formatBreakDuration = (totalSeconds: number): string => {
  const safeSeconds = Math.max(0, totalSeconds);
  const days = Math.floor(safeSeconds / 86400);
  const hours = Math.floor((safeSeconds % 86400) / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  return `${minutes}m ${seconds}s`;
};

const isSameCalendarDay = (leftTimestamp: number, rightTimestamp: number): boolean => (
  new Date(leftTimestamp).toDateString() === new Date(rightTimestamp).toDateString()
);

const formatSessionRange = (startTimestamp: number, endTimestamp: number): string => {
  const startDate = new Date(startTimestamp);
  const endDate = new Date(endTimestamp);
  const sharedOptions: Intl.DateTimeFormatOptions = {
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  };

  const startLabel = startDate.toLocaleString([], sharedOptions);
  const endLabel = isSameCalendarDay(startTimestamp, endTimestamp)
    ? endDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : endDate.toLocaleString([], sharedOptions);

  return `${startLabel} - ${endLabel}`;
};

const REPLAY_AUTHORSHIP_HIGHLIGHT_STORAGE_KEY = 'swag:replay:authorship-highlight';

export default function ReplayPlayer({
  events,
  chatMessages,
  conversations,
  startTime,
  endTime,
  allowWebSearch,
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
  const [speed, setSpeed] = useState<number>(() => {
    if (typeof window === 'undefined') return 5;
    const saved = window.localStorage.getItem('replay_speed');
    const parsed = saved ? Number(saved) : NaN;
    return SPEED_OPTIONS.includes(parsed) ? parsed : 5;
  });
  const IDLE_PRESETS = [15, 30, 60, 120, 180, 300, 600, 900, 1800];
  const [idleThresholdSeconds, setIdleThresholdSeconds] = useState(180);
  const idlePresetIndex = IDLE_PRESETS.indexOf(idleThresholdSeconds);
  const [editorDocument, setEditorDocument] = useState<Record<string, unknown>[]>([
    { type: 'paragraph', content: [] }
  ]);
  const [replayBaseSnapshotId, setReplayBaseSnapshotId] = useState<number | null>(null);
  const [replayTypingOps, setReplayTypingOps] = useState<ReplayTypingOpEvent[]>([]);
  const [visibleMessages, setVisibleMessages] = useState<ChatMessage[]>([]);
  const [highlightedMessageId, setHighlightedMessageId] = useState<number | null>(null);
  const [visibleReplayPasteHighlights, setVisibleReplayPasteHighlights] = useState<ReplayPasteHighlight[]>([]);
  const [isEditorReady, setIsEditorReady] = useState(false);
  const [isWordCountGraphExpanded, setIsWordCountGraphExpanded] = useState(true);
  const [showAuthorshipHighlight, setShowAuthorshipHighlight] = useState(false);
  const [stepReplayFailureCount, setStepReplayFailureCount] = useState(0);
  const [lastStepReplayFailure, setLastStepReplayFailure] = useState<string | null>(null);
  const [hoveredWordCountPoint, setHoveredWordCountPoint] = useState<HoveredWordCountPoint | null>(null);
  const [mainTimelineWidth, setMainTimelineWidth] = useState(0);
  const prevVisibleMessagesCountRef = useRef<number>(0);
  const prevVisibleReplayPasteHighlightCountRef = useRef<number>(0);
  const lastAppliedTypingSnapshotKeyRef = useRef<string>('init');
  const lastAppliedTypingSeqRef = useRef<number>(-1);
  const lastAppliedEditorSelectionKeyRef = useRef<string>('none');
  const replaySelectionPluginRegisteredRef = useRef<boolean>(false);
  const replayAuthorshipPluginRegisteredRef = useRef<boolean>(false);
  const authorshipRangesRef = useRef<AuthorshipRange[]>([]);
  const authorshipVersionRef = useRef<number>(0);
  const lastAppliedAuthorshipOverlayKeyRef = useRef<string>('init');
  const loggedStepFailureSeqsRef = useRef<Set<number>>(new Set());
  const shortcutsDialogRef = useRef<HTMLDialogElement>(null);
  const mainTimelineRef = useRef<HTMLDivElement>(null);
  const totalWordCountGradientId = useId();
  const gptWordCountGradientId = useId();
  const replayShortcutsDialogTitleId = useId();
  const replayShortcutsDialogDescriptionId = useId();

  const animationRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number>(0);
  const idlePeriodsRef = useRef<typeof idlePeriods>([]);
  const lastReplayFrameKeyRef = useRef<string>('');
  const lastProcessedReplayTimeRef = useRef<number>(startTime);

  const openShortcutsDialog = useCallback(() => {
    const dialog = shortcutsDialogRef.current;
    if (!dialog || dialog.open) {
      return;
    }

    dialog.showModal();
  }, []);

  const closeShortcutsDialog = useCallback(() => {
    shortcutsDialogRef.current?.close();
  }, []);

  useEffect(() => {
    const element = mainTimelineRef.current;
    if (!element) {
      return;
    }

    const updateWidth = () => {
      setMainTimelineWidth(element.getBoundingClientRect().width);
    };

    updateWidth();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateWidth);
      return () => window.removeEventListener('resize', updateWidth);
    }

    const observer = new ResizeObserver(() => updateWidth());
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, []);

  // Create BlockNote editor for replay
  const editor = useCreateBlockNote({
    initialContent: [{ type: 'paragraph', content: [] }],
  });

  // Mark editor as ready after mount
  useEffect(() => {
    if (editor) {
      const timer = setTimeout(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tiptapEditor = (editor as any)._tiptapEditor;
        if (tiptapEditor && tiptapEditor.view) {
          setIsEditorReady(true);
        }
      }, 100); // Small delay to ensure Tiptap is fully mounted

      return () => clearTimeout(timer);
    }
  }, [editor]);

  // Register replay-only visual plugins once.
  useEffect(() => {
    if (!editor || !isEditorReady) {
      return;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tiptapEditor = (editor as any)._tiptapEditor;
      if (!tiptapEditor || typeof tiptapEditor.registerPlugin !== 'function') {
        return;
      }

      if (!replaySelectionPluginRegisteredRef.current) {
        tiptapEditor.registerPlugin(createReplaySelectionPlugin());
        replaySelectionPluginRegisteredRef.current = true;
      }

      if (!replayAuthorshipPluginRegisteredRef.current) {
        tiptapEditor.registerPlugin(createReplayAuthorshipPlugin());
        replayAuthorshipPluginRegisteredRef.current = true;
      }
    } catch (error) {
      console.debug('Replay plugin registration skipped:', error);
    }
  }, [editor, isEditorReady]);

  let tiptapSchema: Parameters<typeof Step.fromJSON>[0] | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tiptapEditor = (editor as any)?._tiptapEditor;
    tiptapSchema = tiptapEditor?.state?.schema ?? null;
  } catch {
    tiptapSchema = null;
  }

  const duration = endTime - startTime;
  const replaySessionId = useMemo(
    () => events[0]?.sessionId ?? conversations[0]?.sessionId ?? 'global',
    [events, conversations]
  );
  const authorshipHighlightStorageKey = useMemo(
    () => `${REPLAY_AUTHORSHIP_HIGHLIGHT_STORAGE_KEY}:${replaySessionId}`,
    [replaySessionId]
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('replay_speed', String(speed));
  }, [speed]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const sessionValue = window.localStorage.getItem(authorshipHighlightStorageKey);
    const legacyValue = window.localStorage.getItem(REPLAY_AUTHORSHIP_HIGHLIGHT_STORAGE_KEY);
    const rawValue = sessionValue ?? legacyValue;
    if (rawValue === null) return;

    const normalized = rawValue.toLowerCase();
    setShowAuthorshipHighlight(normalized === '1' || normalized === 'true');
  }, [authorshipHighlightStorageKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(
      authorshipHighlightStorageKey,
      showAuthorshipHighlight ? '1' : '0'
    );
  }, [authorshipHighlightStorageKey, showAuthorshipHighlight]);

  const snapshotEvents = useMemo(
    () => events.filter((event) => event.eventType === 'snapshot'),
    [events]
  );

  const typingOpEventsForReplay = useMemo<ReplayTypingOpEvent[]>(() => {
    const typingEvents = events.filter((event) => event.eventType === 'typing_op');
    if (typingEvents.length === 0) {
      return [];
    }

    const MIN_TYPING_GAP_MS = 75;
    const MAX_TYPING_DRIFT_MS = 1200;
    let previousReplayTimestamp = Number.NEGATIVE_INFINITY;

    return typingEvents.map((event) => {
      let replayTimestamp = event.timestamp;
      if (previousReplayTimestamp > Number.NEGATIVE_INFINITY) {
        replayTimestamp = Math.max(replayTimestamp, previousReplayTimestamp + MIN_TYPING_GAP_MS);
      }

      const maxAllowedTimestamp = event.timestamp + MAX_TYPING_DRIFT_MS;
      if (replayTimestamp > maxAllowedTimestamp) {
        replayTimestamp = maxAllowedTimestamp;
      }

      if (replayTimestamp <= previousReplayTimestamp) {
        replayTimestamp = previousReplayTimestamp + 1;
      }

      previousReplayTimestamp = replayTimestamp;
      return {
        ...event,
        replayTimestamp,
      };
    });
  }, [events]);

  const typingOriginBySequence = useMemo(() => {
    const origins = new Map<number, AuthorshipOrigin>();

    const gptPasteEvents = events
      .filter((event) => event.eventType === 'paste_internal')
      .filter((event) => {
        const eventData = (event.eventData || {}) as { sourceArea?: unknown; targetArea?: unknown };
        return (
          normalizePasteSourceArea(eventData.sourceArea, event.eventType) === 'chat' &&
          normalizePasteTargetArea(eventData.targetArea) === 'editor'
        );
      })
      .sort((a, b) => a.sequenceNumber - b.sequenceNumber);

    const typingEvents = events
      .filter((event) => event.eventType === 'typing_op')
      .sort((a, b) => a.sequenceNumber - b.sequenceNumber);

    typingEvents.forEach((event) => {
      const eventData = (event.eventData || {}) as TypingOpEventData;
      if (eventData.source === 'gpt' || eventData.source === 'user') {
        origins.set(event.sequenceNumber, eventData.source);
        return;
      }

      let matchedGptPaste = false;
      for (let i = gptPasteEvents.length - 1; i >= 0; i -= 1) {
        const pasteEvent = gptPasteEvents[i];
        if (pasteEvent.sequenceNumber > event.sequenceNumber) {
          continue;
        }

        const sequenceDelta = event.sequenceNumber - pasteEvent.sequenceNumber;
        if (sequenceDelta > 40) {
          break;
        }

        const timeDelta = event.timestamp - pasteEvent.timestamp;
        if (timeDelta >= 0 && timeDelta <= 1500) {
          matchedGptPaste = true;
          break;
        }
      }

      origins.set(event.sequenceNumber, matchedGptPaste ? 'gpt' : 'user');
    });

    return origins;
  }, [events]);

  const snapshotAuthorshipSeedById = useMemo(() => {
    const seeds = new Map<number, AuthorshipRange[]>();
    if (!tiptapSchema) {
      return seeds;
    }

    let ranges: AuthorshipRange[] = [];
    let currentDocContentSize = 0;

    const sortedEvents = [...events].sort((a, b) => {
      if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
      if (a.sequenceNumber !== b.sequenceNumber) return a.sequenceNumber - b.sequenceNumber;
      return a.id - b.id;
    });

    sortedEvents.forEach((event) => {
      if (event.eventType === 'typing_op') {
        const typingData = (event.eventData || {}) as TypingOpEventData;
        if (!typingData.stepJson || typeof typingData.stepJson !== 'object') {
          return;
        }

        try {
          const step = Step.fromJSON(tiptapSchema, typingData.stepJson);
          const stepMap = step.getMap();
          const loggedDocContentSize = Number(typingData.docContentSize);
          const hasLoggedDocContentSize = Number.isFinite(loggedDocContentSize) && loggedDocContentSize >= 0;
          let nextDocContentSize = hasLoggedDocContentSize
            ? Math.floor(loggedDocContentSize)
            : null;

          if (nextDocContentSize === null) {
            let inferredDelta = 0;
            stepMap.forEach((oldStart, oldEnd, newStart, newEnd) => {
              inferredDelta += (newEnd - newStart) - (oldEnd - oldStart);
            });

            const inferredBase = currentDocContentSize > 0 ? currentDocContentSize : 1;
            nextDocContentSize = Math.max(0, inferredBase + inferredDelta);
          }

          const origin = typingOriginBySequence.get(event.sequenceNumber) ?? 'user';
          ranges = applyStepToAuthorshipRanges(
            ranges,
            stepMap,
            origin,
            Math.max(0, nextDocContentSize)
          );
          currentDocContentSize = Math.max(0, nextDocContentSize);
        } catch {
          // Ignore malformed historical step logs when building snapshot seeds.
        }
        return;
      }

      if (event.eventType === 'snapshot') {
        seeds.set(event.id, cloneAuthorshipRanges(ranges));
        if (currentDocContentSize <= 0) {
          const snapshotWordCount = Math.max(0, countWordsFromDocument(event.eventData));
          if (snapshotWordCount > 0) {
            currentDocContentSize = snapshotWordCount;
          }
        }
      }
    });

    return seeds;
  }, [events, tiptapSchema, typingOriginBySequence]);

  const findNearestSnapshot = useCallback((time: number) => {
    const snapshotIndex = findLastEventIndexAtOrBefore(snapshotEvents, time);
    if (snapshotIndex < 0) {
      return undefined;
    }
    return snapshotEvents[snapshotIndex];
  }, [snapshotEvents]);

  const getTypingOpsInWindow = useCallback((
    startExclusive: number,
    endInclusive: number,
    snapshotId: number | null
  ) => {
    if (typingOpEventsForReplay.length === 0 || endInclusive < startExclusive) {
      return [];
    }

    const endIndex = findLastReplayTypingIndexAtOrBefore(typingOpEventsForReplay, endInclusive);
    if (endIndex < 0) {
      return [];
    }

    let startIndex = findLastReplayTypingIndexAtOrBefore(typingOpEventsForReplay, startExclusive);
    startIndex = Math.max(startIndex + 1, 0);

    if (startIndex > endIndex) {
      return [];
    }

    const candidateEvents = typingOpEventsForReplay.slice(startIndex, endIndex + 1);
    return snapshotId !== null
      ? candidateEvents.filter((event) => event.id > snapshotId)
      : candidateEvents;
  }, [typingOpEventsForReplay]);

  // Detect idle periods FIRST (gaps > 3 minutes with no activity)
  const idlePeriods = useMemo(() => {
    const IDLE_THRESHOLD = idleThresholdSeconds * 1000;
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
      compressedMs: number; // 압축되는 시간 (밀리초)
      edgeSeconds: number; // 앞뒤 표시할 시간 (초)
    }> = [];

    for (let i = 0; i < allEventTimes.length - 1; i++) {
      const gap = allEventTimes[i + 1] - allEventTimes[i];
      if (gap > IDLE_THRESHOLD) {
        // Break는 replay 시간축에서 0초로 취급한다.
        const EDGE_SECONDS = 0;
        const compressedMs = Math.max(0, gap - (EDGE_SECONDS * 2 * 1000));

        periods.push({
          start: allEventTimes[i],
          end: allEventTimes[i + 1],
          duration: gap,
          compressedMs, // 압축되는 시간 (밀리초)
          edgeSeconds: EDGE_SECONDS,
        });
      }
    }

    return periods;
  }, [events, chatMessages, idleThresholdSeconds]);
  idlePeriodsRef.current = idlePeriods;

  // Calculate compressed timeline (remove idle periods, collapsing breaks)
  const getCompressedTime = useCallback((realTime: number) => {
    let compressed = realTime - startTime;

    // Subtract compressed idle periods before this time
    idlePeriods.forEach(idle => {
      const idleMiddleStart = idle.start + (idle.edgeSeconds * 1000);
      const idleMiddleEnd = idle.end - (idle.edgeSeconds * 1000);
      const compressedDuration = idle.compressedMs;

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
      const compressedDuration = idle.compressedMs;

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
      sum + (idle.compressedMs), 0
    );
    return duration - totalCompression;
  }, [duration, idlePeriods]);

  const progress = compressedDuration > 0
    ? ((getCompressedTime(currentTime) - startTime) / compressedDuration) * 100
    : 0;
  const clampedProgress = Math.max(0, Math.min(100, progress));

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

  // Rebuild editor content up to current time
  const rebuildContent = useCallback((time: number) => {
    // Find nearest snapshot before current time
    const snapshot = findNearestSnapshot(time);

    if (snapshot && snapshot.eventData) {
      // Return BlockNote document structure directly
      const doc = snapshot.eventData as unknown as Record<string, unknown>[];
      if (Array.isArray(doc)) {
        return doc;
      }
    }

    // No snapshot yet - show initial state (empty paragraph)
    return [{ type: 'paragraph', content: [] }];
  }, [findNearestSnapshot]);

  const getVisibleMessageCount = useCallback((time: number) => {
    let left = 0;
    let right = chatMessages.length;

    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (chatMessages[mid].timestamp <= time) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }

    return left;
  }, [chatMessages]);

  // Update visible messages based on current time
  const updateVisibleMessages = useCallback((time: number) => {
    const visibleCount = getVisibleMessageCount(time);
    const previousVisibleCount = prevVisibleMessagesCountRef.current;

    if (visibleCount === previousVisibleCount) {
      return;
    }

    const visible = chatMessages.slice(0, visibleCount);
    setVisibleMessages(visible);

    // Highlight newly added message
    if (visibleCount > previousVisibleCount && visible.length > 0) {
      const newMessage = visible[visible.length - 1];
      setHighlightedMessageId(newMessage.id);
      // Clear highlight after 2 seconds
      setTimeout(() => setHighlightedMessageId(null), 2000);
    }
    prevVisibleMessagesCountRef.current = visibleCount;
  }, [chatMessages, getVisibleMessageCount]);

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

      const rawDeltaMs = frameTime - lastFrameTimeRef.current;
      const deltaMs = Math.min(rawDeltaMs, 100); // cap at 100ms to prevent huge jumps
      lastFrameTimeRef.current = frameTime;

      setCurrentTime((prev) => {
        let newTime = prev + deltaMs * speed;

        // Check if we're entering an idle period and skip it
        for (const idle of idlePeriodsRef.current) {
          const idleMiddleStart = idle.start + (idle.edgeSeconds * 1000);
          const idleMiddleEnd = idle.end - (idle.edgeSeconds * 1000);

          // If we just entered the compressed middle part, jump to the end
          if (prev < idleMiddleStart && newTime >= idleMiddleStart) {
            newTime = idleMiddleEnd;
            break;
          }
        }

        if (newTime >= endTime) {
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

  useEffect(() => {
    if (isPlaying && currentTime >= endTime) {
      setIsPlaying(false);
    }
  }, [isPlaying, currentTime, endTime]);

  // Update content when current time changes
  useEffect(() => {
    const content = rebuildContent(currentTime);
    setEditorDocument(content);
    const snapshot = findNearestSnapshot(currentTime);
    const snapshotTimestamp = snapshot?.timestamp ?? startTime;
    const snapshotId = snapshot?.id ?? null;
    const typingOpsUntilNow = getTypingOpsInWindow(
      snapshotTimestamp,
      currentTime,
      snapshotId
    );
    const latestTypingSeq = typingOpsUntilNow.length > 0
      ? typingOpsUntilNow[typingOpsUntilNow.length - 1].sequenceNumber
      : -1;
    const frameKey = `${snapshot?.id ?? 'none'}:${latestTypingSeq}`;
    if (frameKey !== lastReplayFrameKeyRef.current) {
      lastReplayFrameKeyRef.current = frameKey;
      setReplayBaseSnapshotId(snapshot?.id ?? null);
      setReplayTypingOps(typingOpsUntilNow);
    }
    updateVisibleMessages(currentTime);
  }, [currentTime, rebuildContent, updateVisibleMessages, findNearestSnapshot, getTypingOpsInWindow, startTime]);

  const replayEditorSelection = useMemo<EditorSelectionEventData | null>(() => {
    let latestSelection: EditorSelectionEventData | null = null;

    for (let i = 0; i < events.length; i += 1) {
      const event = events[i];
      if (event.timestamp > currentTime) break;
      if (event.eventType !== 'editor_selection') continue;

      const eventData = (event.eventData || {}) as EditorSelectionEventData;
      const from = Number(eventData.from);
      const to = Number(eventData.to);
      if (!Number.isFinite(from) || !Number.isFinite(to)) continue;

      latestSelection = {
        from: Math.floor(from),
        to: Math.floor(to),
      };
    }

    return latestSelection;
  }, [events, currentTime]);

  const replayChatInputState = useMemo<ReplayChatInputState>(() => {
    const state: ReplayChatInputState = {
      text: '',
      selectionStart: 0,
      selectionEnd: 0,
      webSearchEnabled: false,
      conversationId: null,
    };

    for (let i = 0; i < events.length; i += 1) {
      const event = events[i];
      if (event.timestamp > currentTime) break;

      if (event.eventType === 'chat_input') {
        const eventData = (event.eventData || {}) as ChatInputEventData;
        const text = typeof eventData.text === 'string' ? eventData.text : '';
        const maxIndex = text.length;
        const selectionStart = Math.min(
          Math.max(0, Math.floor(Number(eventData.selectionStart ?? text.length))),
          maxIndex
        );
        const selectionEnd = Math.min(
          Math.max(selectionStart, Math.floor(Number(eventData.selectionEnd ?? selectionStart))),
          maxIndex
        );

        state.text = text;
        state.selectionStart = selectionStart;
        state.selectionEnd = selectionEnd;
        state.conversationId =
          typeof eventData.conversationId === 'string' ? eventData.conversationId : null;
        if (typeof eventData.webSearchEnabled === 'boolean') {
          state.webSearchEnabled = eventData.webSearchEnabled;
        }
        continue;
      }

      if (event.eventType === 'chat_web_search_toggle') {
        const eventData = (event.eventData || {}) as ChatWebSearchToggleEventData;
        if (typeof eventData.enabled === 'boolean') {
          state.webSearchEnabled = eventData.enabled;
        }
      }
    }

    return state;
  }, [events, currentTime]);

  // Update editor when document changes
  useEffect(() => {
    if (!editor || !isEditorReady || editorDocument.length === 0) return;

    // Safely check if editor is ready
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tiptapEditor = (editor as any)._tiptapEditor;
      if (!tiptapEditor || !tiptapEditor.view) {
        return; // Editor not fully mounted yet
      }

      const snapshotKey = replayBaseSnapshotId === null ? 'none' : `snapshot-${replayBaseSnapshotId}`;
      const latestTypingSeq = replayTypingOps.length > 0
        ? replayTypingOps[replayTypingOps.length - 1].sequenceNumber
        : -1;
      const isRewind = currentTime < lastProcessedReplayTimeRef.current;
      const shouldResetBase =
        snapshotKey !== lastAppliedTypingSnapshotKeyRef.current ||
        isRewind;

      if (shouldResetBase) {
        editor.replaceBlocks(editor.document, editorDocument);
        lastAppliedTypingSeqRef.current = -1;
        const seededRanges = replayBaseSnapshotId !== null
          ? (snapshotAuthorshipSeedById.get(replayBaseSnapshotId) ?? [])
          : [];
        if (!areAuthorshipRangesEqual(authorshipRangesRef.current, seededRanges)) {
          authorshipRangesRef.current = cloneAuthorshipRanges(seededRanges);
          authorshipVersionRef.current += 1;
        }
      }

      const typingOpsToApply = shouldResetBase
        ? replayTypingOps
        : replayTypingOps.filter((typingEvent) => typingEvent.sequenceNumber > lastAppliedTypingSeqRef.current);

      const newFailureLogs: Array<{
        sequenceNumber: number;
        stepType: string;
        timestamp: number;
        errorMessage: string;
      }> = [];

      if (typingOpsToApply.length > 0) {
        typingOpsToApply.forEach((typingEvent) => {
          const data = (typingEvent.eventData || {}) as TypingOpEventData;

          const registerFailure = (error: unknown) => {
            if (loggedStepFailureSeqsRef.current.has(typingEvent.sequenceNumber)) {
              return;
            }
            loggedStepFailureSeqsRef.current.add(typingEvent.sequenceNumber);
            const stepType = typeof data.stepType === 'string'
              ? data.stepType
              : 'unknown';
            const errorMessage = error instanceof Error
              ? error.message
              : (typeof error === 'string' ? error : 'Unknown step apply error');
            newFailureLogs.push({
              sequenceNumber: typingEvent.sequenceNumber,
              stepType,
              timestamp: typingEvent.timestamp,
              errorMessage,
            });
          };

          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const state = (tiptapEditor as any).state;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const view = (tiptapEditor as any).view;
            if (!state || !view) {
              return;
            }

            if (!data.stepJson || typeof data.stepJson !== 'object') {
              registerFailure('Missing stepJson in typing_op event');
              return;
            }

            try {
              const step = Step.fromJSON(state.schema, data.stepJson);
              const tr = state.tr.step(step);
              if (tr.docChanged) {
                const typingOrigin = typingOriginBySequence.get(typingEvent.sequenceNumber) ?? 'user';
                authorshipRangesRef.current = applyStepToAuthorshipRanges(
                  authorshipRangesRef.current,
                  step.getMap(),
                  typingOrigin,
                  tr.doc.content.size
                );
                authorshipVersionRef.current += 1;
                view.dispatch(tr);
              }
            } catch (error) {
              registerFailure(error);
            }
          } catch (error) {
            registerFailure(error);
            // If an op fails, continue with the rest and rely on the next snapshot to self-heal.
          }
        });
      }

      if (newFailureLogs.length > 0) {
        setStepReplayFailureCount(loggedStepFailureSeqsRef.current.size);
        const latestFailure = newFailureLogs[newFailureLogs.length - 1];
        setLastStepReplayFailure(`${latestFailure.stepType} (seq ${latestFailure.sequenceNumber})`);

        newFailureLogs.forEach((failure) => {
          console.warn('[replay] typing_op apply failed', {
            sequenceNumber: failure.sequenceNumber,
            timestamp: failure.timestamp,
            stepType: failure.stepType,
            error: failure.errorMessage,
          });
        });
      }

      const selectionKey = replayEditorSelection
        ? `${replayEditorSelection.from ?? 0}:${replayEditorSelection.to ?? 0}`
        : 'none';
      if (selectionKey !== lastAppliedEditorSelectionKeyRef.current) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const state = (tiptapEditor as any).state;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const view = (tiptapEditor as any).view;
        if (state && view) {
          const maxPosition = state.doc.content.size;
          const tr = state.tr;

          if (replayEditorSelection) {
            let from = clampPmPosition(Number(replayEditorSelection.from), maxPosition);
            let to = clampPmPosition(Number(replayEditorSelection.to), maxPosition);
            if (from > to) {
              [from, to] = [to, from];
            }

            tr.setMeta(replaySelectionPluginKey, { from, to });

            try {
              const $from = state.doc.resolve(from);
              const $to = state.doc.resolve(to);
              const nextSelection = from === to
                ? Selection.near($from, 1)
                : TextSelection.between($from, $to, 1);
              tr.setSelection(nextSelection);
            } catch {
              // Ignore native selection failures and keep decoration-based rendering.
            }
          } else {
            tr.setMeta(replaySelectionPluginKey, null);
          }

          const hasReplaySelectionMeta = tr.getMeta(replaySelectionPluginKey) !== undefined;
          if (tr.selectionSet || hasReplaySelectionMeta) {
            view.dispatch(tr);
          }
        }
        lastAppliedEditorSelectionKeyRef.current = selectionKey;
      }

      // Keep authorship overlay synced with replay frame/toggle state.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const authorshipState = (tiptapEditor as any).state;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const authorshipView = (tiptapEditor as any).view;
      const authorshipOverlayKey = `${showAuthorshipHighlight ? 1 : 0}:${authorshipVersionRef.current}`;
      if (
        authorshipState &&
        authorshipView &&
        authorshipOverlayKey !== lastAppliedAuthorshipOverlayKeyRef.current
      ) {
        const authorshipTr = authorshipState.tr.setMeta(replayAuthorshipPluginKey, {
          enabled: showAuthorshipHighlight,
          ranges: authorshipRangesRef.current,
        });
        authorshipView.dispatch(authorshipTr);
        lastAppliedAuthorshipOverlayKeyRef.current = authorshipOverlayKey;
      }

      lastAppliedTypingSnapshotKeyRef.current = snapshotKey;
      lastAppliedTypingSeqRef.current = latestTypingSeq;
      lastProcessedReplayTimeRef.current = currentTime;
    } catch (error) {
      // Silently ignore editor update errors during replay
      console.debug('Editor update skipped:', error);
    }
  }, [
    editor,
    isEditorReady,
    editorDocument,
    currentTime,
    replayTypingOps,
    replayBaseSnapshotId,
    replayEditorSelection,
    showAuthorshipHighlight,
    snapshotAuthorshipSeedById,
    typingOriginBySequence,
  ]);

  const seekToPercentage = useCallback((percentage: number) => {
    if (compressedDuration <= 0) return;

    const clampedPercentage = Math.max(0, Math.min(100, percentage));
    const newCompressedTime = startTime + (clampedPercentage / 100) * compressedDuration;
    const newRealTime = getRealTime(newCompressedTime);
    setCurrentTime(Math.max(startTime, Math.min(endTime, newRealTime)));
  }, [compressedDuration, startTime, getRealTime, endTime]);

  // Handle timeline click (accounting for compressed time)
  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = (x / rect.width) * 100;
    seekToPercentage(percentage);
  };

  const handleWordCountGraphClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = (x / rect.width) * 100;
    seekToPercentage(percentage);
  };

  const handleReplayPasteClick = useCallback((timestamp: number) => {
    setIsPlaying(false);
    setCurrentTime(timestamp);
  }, []);

  // Format replay clock time (breaks are compressed to 0s)
  const formatReplayTime = useCallback((ms: number) => {
    const compressedMs = getCompressedTime(ms);
    const totalSeconds = Math.max(0, Math.floor((compressedMs - startTime) / 1000));
    return formatClockDuration(totalSeconds);
  }, [getCompressedTime, startTime]);

  const wordCountTimeline = useMemo<WordCountTimelineEntry[]>(() => {
    const timeline: WordCountTimelineEntry[] = [{
      timestamp: startTime,
      wordCount: 0,
      userWordCount: 0,
      gptWordCount: 0,
    }];
    let userWordCount = 0;
    let gptWordCount = 0;
    let currentWordCount = 0;
    let currentDocContentSize = 0;
    let authorshipRanges: AuthorshipRange[] = [];

    const rebalanceToTotal = (targetTotal: number, preferredOrigin: AuthorshipOrigin) => {
      const diff = targetTotal - (userWordCount + gptWordCount);
      if (diff === 0) return;

      if (diff > 0) {
        if (preferredOrigin === 'gpt') {
          gptWordCount += diff;
        } else {
          userWordCount += diff;
        }
        return;
      }

      let toRemove = -diff;
      if (preferredOrigin === 'gpt') {
        const removedFromUser = Math.min(userWordCount, toRemove);
        userWordCount -= removedFromUser;
        toRemove -= removedFromUser;
        if (toRemove > 0) {
          gptWordCount = Math.max(0, gptWordCount - toRemove);
        }
        return;
      }

      const removedFromGpt = Math.min(gptWordCount, toRemove);
      gptWordCount -= removedFromGpt;
      toRemove -= removedFromGpt;
      if (toRemove > 0) {
        userWordCount = Math.max(0, userWordCount - toRemove);
      }
    };

    const updateCountsFromAuthorshipRanges = (targetTotal: number) => {
      if (targetTotal <= 0) {
        userWordCount = 0;
        gptWordCount = 0;
        return;
      }

      if (currentDocContentSize <= 0) {
        userWordCount = targetTotal;
        gptWordCount = 0;
        return;
      }

      const gptShare = computeGptShareFromAuthorshipRanges(authorshipRanges, currentDocContentSize);
      gptWordCount = Math.min(targetTotal, Math.max(0, Math.round(targetTotal * gptShare)));
      userWordCount = Math.max(0, targetTotal - gptWordCount);
    };

    const sortedEvents = [...events].sort((a, b) => {
      if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
      if (a.sequenceNumber !== b.sequenceNumber) return a.sequenceNumber - b.sequenceNumber;
      return a.id - b.id;
    });

    sortedEvents.forEach((event) => {
      if (event.eventType === 'snapshot') {
        const nextWordCount = Math.max(0, countWordsFromDocument(event.eventData));
        if (currentWordCount <= 0) {
          userWordCount = nextWordCount;
          gptWordCount = 0;
          if (currentDocContentSize <= 0) {
            currentDocContentSize = nextWordCount;
          }
        } else {
          updateCountsFromAuthorshipRanges(nextWordCount);
        }
        currentWordCount = nextWordCount;
        timeline.push({
          timestamp: event.timestamp,
          wordCount: currentWordCount,
          userWordCount,
          gptWordCount,
        });
        return;
      }

      if (event.eventType === 'typing_op') {
        const typingData = (event.eventData || {}) as TypingOpEventData;
        const nextWordCount = Number(typingData.wordCount);
        if (Number.isFinite(nextWordCount) && nextWordCount >= 0) {
          const nextTotal = Math.floor(nextWordCount);
          const origin = typingOriginBySequence.get(event.sequenceNumber) ?? 'user';
          const loggedDocContentSize = Number(typingData.docContentSize);
          const hasLoggedDocContentSize = Number.isFinite(loggedDocContentSize) && loggedDocContentSize >= 0;
          let nextDocContentSize = hasLoggedDocContentSize
            ? Math.floor(loggedDocContentSize)
            : null;
          let appliedStepMap = false;

          if (tiptapSchema && typingData.stepJson && typeof typingData.stepJson === 'object') {
            try {
              const step = Step.fromJSON(tiptapSchema, typingData.stepJson);
              const stepMap = step.getMap();

              if (nextDocContentSize === null) {
                let inferredDelta = 0;
                stepMap.forEach((oldStart, oldEnd, newStart, newEnd) => {
                  inferredDelta += (newEnd - newStart) - (oldEnd - oldStart);
                });

                const inferredBase = currentDocContentSize > 0
                  ? currentDocContentSize
                  : Math.max(1, currentWordCount);
                nextDocContentSize = Math.max(0, inferredBase + inferredDelta);
              }

              authorshipRanges = applyStepToAuthorshipRanges(
                authorshipRanges,
                stepMap,
                origin,
                Math.max(0, nextDocContentSize)
              );
              currentDocContentSize = Math.max(0, nextDocContentSize);
              appliedStepMap = true;
            } catch {
              appliedStepMap = false;
            }
          }

          if (appliedStepMap) {
            updateCountsFromAuthorshipRanges(nextTotal);
          } else {
            const delta = nextTotal - currentWordCount;
            if (delta >= 0) {
              if (origin === 'gpt') {
                gptWordCount += delta;
              } else {
                userWordCount += delta;
              }
            } else {
              let toRemove = -delta;
              if (origin === 'gpt') {
                const removedFromGpt = Math.min(gptWordCount, toRemove);
                gptWordCount -= removedFromGpt;
                toRemove -= removedFromGpt;
                if (toRemove > 0) {
                  const removedFromUser = Math.min(userWordCount, toRemove);
                  userWordCount -= removedFromUser;
                }
              } else {
                const removedFromUser = Math.min(userWordCount, toRemove);
                userWordCount -= removedFromUser;
                toRemove -= removedFromUser;
                if (toRemove > 0) {
                  const removedFromGpt = Math.min(gptWordCount, toRemove);
                  gptWordCount -= removedFromGpt;
                }
              }
            }

            if (nextDocContentSize !== null) {
              currentDocContentSize = Math.max(0, nextDocContentSize);
            } else if (currentDocContentSize <= 0 && nextTotal > 0) {
              currentDocContentSize = nextTotal;
            }

            rebalanceToTotal(nextTotal, origin);
          }

          currentWordCount = nextTotal;
          timeline.push({
            timestamp: event.timestamp,
            wordCount: currentWordCount,
            userWordCount,
            gptWordCount,
          });
        }
      }
    });

    timeline.push({
      timestamp: endTime,
      wordCount: currentWordCount,
      userWordCount,
      gptWordCount,
    });

    const dedupedByTimestamp: WordCountTimelineEntry[] = [];
    timeline.forEach((entry) => {
      const last = dedupedByTimestamp[dedupedByTimestamp.length - 1];
      if (!last || last.timestamp !== entry.timestamp) {
        dedupedByTimestamp.push(entry);
      } else {
      dedupedByTimestamp[dedupedByTimestamp.length - 1] = entry;
      }
    });

    return dedupedByTimestamp;
  }, [events, startTime, endTime, typingOriginBySequence, tiptapSchema]);

  const wordCountGraphData = useMemo<WordCountGraphPoint[]>(() => {
    if (compressedDuration <= 0) {
      const fallbackEntry = wordCountTimeline[wordCountTimeline.length - 1];
      const fallbackWordCount = fallbackEntry?.wordCount ?? 0;
      const fallbackUserWordCount = fallbackEntry?.userWordCount ?? fallbackWordCount;
      const fallbackGptWordCount = fallbackEntry?.gptWordCount ?? 0;
      const fallbackGptSharePct = fallbackWordCount > 0
        ? (fallbackGptWordCount / fallbackWordCount) * 100
        : 0;
      return [{
        percentage: 0,
        wordCount: fallbackWordCount,
        userWordCount: fallbackUserWordCount,
        gptWordCount: fallbackGptWordCount,
        gptSharePct: fallbackGptSharePct,
        time: startTime,
        timeFormatted: formatReplayTime(startTime),
      }];
    }

    const points = wordCountTimeline.map((entry) => {
      const compressedTime = getCompressedTime(entry.timestamp);
      const percentage = ((compressedTime - startTime) / compressedDuration) * 100;
      return {
        percentage: Math.max(0, Math.min(100, percentage)),
        wordCount: entry.wordCount,
        userWordCount: entry.userWordCount,
        gptWordCount: entry.gptWordCount,
        gptSharePct: entry.wordCount > 0 ? (entry.gptWordCount / entry.wordCount) * 100 : 0,
        time: entry.timestamp,
        timeFormatted: formatReplayTime(entry.timestamp),
      };
    });

    const dedupedByPercentage: WordCountGraphPoint[] = [];
    points.forEach((point) => {
      const last = dedupedByPercentage[dedupedByPercentage.length - 1];
      if (!last || Math.abs(last.percentage - point.percentage) > 0.001) {
        dedupedByPercentage.push(point);
      } else {
        dedupedByPercentage[dedupedByPercentage.length - 1] = point;
      }
    });

    return dedupedByPercentage;
  }, [compressedDuration, formatReplayTime, getCompressedTime, startTime, wordCountTimeline]);

  const handleWordCountGraphMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (compressedDuration <= 0 || wordCountTimeline.length === 0) {
      setHoveredWordCountPoint(null);
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
    const hoveredCompressedTime = startTime + (percentage / 100) * compressedDuration;
    const hoveredRealTime = Math.max(startTime, Math.min(endTime, getRealTime(hoveredCompressedTime)));
    const entryIndex = findLastEventIndexAtOrBefore(wordCountTimeline, hoveredRealTime);
    const entry = wordCountTimeline[Math.max(0, entryIndex)] ?? wordCountTimeline[0];

    if (!entry) {
      setHoveredWordCountPoint(null);
      return;
    }

    setHoveredWordCountPoint({
      percentage,
      wordCount: entry.wordCount,
      userWordCount: entry.userWordCount,
      gptWordCount: entry.gptWordCount,
      gptSharePct: entry.wordCount > 0 ? (entry.gptWordCount / entry.wordCount) * 100 : 0,
      time: hoveredRealTime,
      timeFormatted: formatReplayTime(hoveredRealTime),
      viewportX: e.clientX,
      graphTop: rect.top,
    });
  }, [compressedDuration, endTime, formatReplayTime, getRealTime, startTime, wordCountTimeline]);

  const handleWordCountGraphMouseLeave = useCallback(() => {
    setHoveredWordCountPoint(null);
  }, []);

  const maxWordCount = useMemo(() => {
    if (wordCountGraphData.length === 0) return 1;
    return Math.max(...wordCountGraphData.map((point) => point.wordCount), 1);
  }, [wordCountGraphData]);

  const hasWordCountData = useMemo(() => (
    wordCountGraphData.length > 1 || wordCountGraphData.some((point) => point.wordCount > 0)
  ), [wordCountGraphData]);

  const toggleWordCountGraph = useCallback(() => {
    if (!hasWordCountData) {
      return;
    }

    setIsWordCountGraphExpanded((prev) => !prev);
  }, [hasWordCountData]);

  const stepReplaySpeed = useCallback((direction: -1 | 1) => {
    setSpeed((currentSpeed) => {
      const currentIndex = SPEED_OPTIONS.indexOf(currentSpeed);
      if (currentIndex === -1) {
        return currentSpeed;
      }

      const nextIndex = Math.min(
        SPEED_OPTIONS.length - 1,
        Math.max(0, currentIndex + direction)
      );

      return SPEED_OPTIONS[nextIndex] ?? currentSpeed;
    });
  }, []);

  const sessionBreakGraphMarkerPositions = useMemo(() => {
    if (compressedDuration <= 0) {
      return [];
    }

    return idlePeriods
      .filter((idle) => !isSameCalendarDay(idle.start, idle.end))
      .map((idle) => {
        const markerTime = idle.start + (idle.edgeSeconds * 1000);
        const compressedMarkerTime = getCompressedTime(markerTime);
        const position = ((compressedMarkerTime - startTime) / compressedDuration) * 100;
        return Math.max(0, Math.min(100, position));
      })
      .filter((position) => Number.isFinite(position));
  }, [compressedDuration, getCompressedTime, idlePeriods, startTime]);

  const replaySessions = useMemo(() => {
    if (startTime > endTime) {
      return [];
    }

    const sessions: Array<{ startTime: number; endTime: number }> = [];
    let currentStart = startTime;

    idlePeriods.forEach((idle) => {
      if (isSameCalendarDay(idle.start, idle.end)) {
        return;
      }

      sessions.push({
        startTime: currentStart,
        endTime: idle.start,
      });
      currentStart = idle.end;
    });

    sessions.push({
      startTime: currentStart,
      endTime,
    });

    return sessions.filter((session) => session.endTime >= session.startTime);
  }, [endTime, idlePeriods, startTime]);

  const replaySessionGraphLabels = useMemo(() => {
    if (compressedDuration <= 0) {
      return [];
    }

    return replaySessions.map((session, index) => {
      const compressedStart = getCompressedTime(session.startTime);
      const compressedEnd = getCompressedTime(session.endTime);
      const startPosition = ((compressedStart - startTime) / compressedDuration) * 100;
      const endPosition = ((compressedEnd - startTime) / compressedDuration) * 100;
      const clampedStart = Math.max(0, Math.min(100, startPosition));
      const clampedEnd = Math.max(clampedStart, Math.min(100, endPosition));
      const width = Math.max(clampedEnd - clampedStart, 1);
      const title = `Session ${index + 1}`;
      const rangeLabel = formatSessionRange(session.startTime, session.endTime);

      return {
        id: `replay-session-${index}`,
        title,
        rangeLabel,
        startTime: session.startTime,
        endTime: session.endTime,
        position: clampedStart,
        width,
        compactLabel: title,
        fullLabel: `${title} (${rangeLabel})`,
      };
    });
  }, [compressedDuration, getCompressedTime, replaySessions, startTime]);

  const replayPasteHighlights = useMemo<ReplayPasteHighlight[]>(() => {
    const searchableMessages = chatMessages.map((message) => ({
      id: message.id,
      timestamp: message.timestamp,
      normalizedContent: normalizeForMatching(message.content),
    }));

    const highlights: ReplayPasteHighlight[] = [];

    events
      .filter((event) => event.eventType === 'paste_internal')
      .forEach((event, index) => {
        const pastedContent = ((event.eventData as { content?: string })?.content || '').trim();
        if (pastedContent.length < 3) {
          return;
        }

        const normalizedPasteContent = normalizeForMatching(pastedContent);
        if (!normalizedPasteContent) {
          return;
        }

        let matchedMessage: (typeof searchableMessages)[number] | undefined;
        for (let i = searchableMessages.length - 1; i >= 0; i -= 1) {
          const message = searchableMessages[i];
          if (message.timestamp > event.timestamp) {
            continue;
          }
          if (message.normalizedContent.includes(normalizedPasteContent)) {
            matchedMessage = message;
            break;
          }
        }

        if (!matchedMessage) {
          return;
        }

        highlights.push({
          id: `paste-highlight-${index}`,
          messageId: matchedMessage.id,
          snippet: pastedContent,
          timestamp: event.timestamp,
          timeLabel: formatReplayTime(event.timestamp),
        });
      });

    return highlights;
  }, [chatMessages, events, formatReplayTime]);

  useEffect(() => {
    let left = 0;
    let right = replayPasteHighlights.length;

    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (replayPasteHighlights[mid].timestamp <= currentTime) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }

    const visibleCount = left;
    if (visibleCount === prevVisibleReplayPasteHighlightCountRef.current) {
      return;
    }

    prevVisibleReplayPasteHighlightCountRef.current = visibleCount;
    setVisibleReplayPasteHighlights(replayPasteHighlights.slice(0, visibleCount));
  }, [replayPasteHighlights, currentTime]);

  const majorReplayEvents = useMemo(() => {
    const items: Array<{
      type: 'chat' | 'paste_internal' | 'paste_external' | 'submission';
      variant?: ReplayPasteVariant;
      label: string;
      detail: string | null;
      timestamp: number;
    }> = [];

    chatMessages.forEach((msg) => {
      if (msg.role !== 'user') return;
      items.push({
        type: 'chat',
        label: 'Chat Message',
        detail: msg.content.length > 80 ? `${msg.content.slice(0, 80)}...` : msg.content,
        timestamp: msg.timestamp,
      });
    });

    events.forEach((event) => {
      if (event.eventType === 'paste_internal' || event.eventType === 'paste_external') {
        items.push({
          type: event.eventType,
          variant: getReplayPasteVariant(event),
          label: getReplayPasteLabel(event),
          detail: getPasteRouteLabel(event),
          timestamp: event.timestamp,
        });
        return;
      }

      if (event.eventType === 'submission') {
        items.push({
          type: 'submission',
          label: 'Submitted',
          detail: null,
          timestamp: event.timestamp,
        });
      }
    });

    return items.sort((a, b) => a.timestamp - b.timestamp);
  }, [chatMessages, events]);

  const currentEvent = useMemo(() => {
    const EVENT_DISPLAY_DURATION = 3000; // Show event for 3 seconds
    const lowerBound = currentTime - EVENT_DISPLAY_DURATION;

    for (let i = majorReplayEvents.length - 1; i >= 0; i -= 1) {
      const event = majorReplayEvents[i];
      if (event.timestamp > currentTime) continue;
      if (event.timestamp <= lowerBound) break;
      return event;
    }

    return null;
  }, [majorReplayEvents, currentTime]);

  // Get timeline markers for events (using compressed time)
  const markers = useMemo(() => {
    const timelineMarkers: Array<{
      id: string;
      position: number;
      type: string;
      variant?: ReplayPasteVariant;
      label: string;
      content: string;
      time: string;
      route?: string;
    }> = [];

    if (compressedDuration <= 0) {
      return timelineMarkers;
    }

    // Chat message markers
    chatMessages.forEach((msg, i) => {
      if (msg.role === 'user') {
        const compressedTime = getCompressedTime(msg.timestamp);
        const position = ((compressedTime - startTime) / compressedDuration) * 100;
        timelineMarkers.push({
          id: `chat-${i}`,
          position,
          type: 'chat',
          label: 'Chat Message',
          content: msg.content.length > 100 ? msg.content.slice(0, 100) + '...' : msg.content,
          time: formatReplayTime(msg.timestamp),
        });
      }
    });

    // Paste event markers
    events
      .filter(e => e.eventType === 'paste_internal' || e.eventType === 'paste_external')
      .forEach((event, i) => {
        const compressedTime = getCompressedTime(event.timestamp);
        const position = ((compressedTime - startTime) / compressedDuration) * 100;
        const pasteContent = (event.eventData as { content?: string })?.content || '';
        const route = getPasteRouteLabel(event);
        timelineMarkers.push({
          id: `paste-${i}`,
          position,
          type: event.eventType,
          variant: getReplayPasteVariant(event),
          label: getReplayPasteLabel(event),
          content: pasteContent.length > 100 ? pasteContent.slice(0, 100) + '...' : pasteContent,
          time: formatReplayTime(event.timestamp),
          route,
        });
      });

    // Submission markers
    events
      .filter(e => e.eventType === 'submission')
      .forEach((event, i) => {
        const compressedTime = getCompressedTime(event.timestamp);
        const position = ((compressedTime - startTime) / compressedDuration) * 100;
        timelineMarkers.push({
          id: `submission-${i}`,
          position,
          type: 'submission',
          label: `Submission ${i + 1}`,
          content: '',
          time: formatReplayTime(event.timestamp),
        });
      });

    return timelineMarkers;
  }, [chatMessages, compressedDuration, events, formatReplayTime, getCompressedTime, startTime]);

  const markerClusters = useMemo(() => {
    const nonSubmissionMarkers = markers
      .filter((marker) => marker.type !== 'submission')
      .slice()
      .sort((a, b) => a.position - b.position);

    if (nonSubmissionMarkers.length === 0) {
      return [];
    }

    const getPriority = (marker: typeof nonSubmissionMarkers[number]) => {
      if (marker.type === 'paste_external') return 0;
      if (marker.variant === 'chat_to_editor') return 1;
      if (marker.type === 'paste_internal') return 2;
      return 3;
    };

    const getTooltipTone = (marker: typeof nonSubmissionMarkers[number]) => {
      if (marker.type === 'paste_external') {
        return {
          textClass: 'text-rose-300',
          dotClass: 'bg-rose-500',
        };
      }

      if (marker.variant === 'chat_to_editor') {
        return {
          textClass: 'text-amber-300',
          dotClass: 'bg-amber-500',
        };
      }

      if (marker.type === 'paste_internal') {
        return {
          textClass: 'text-emerald-300',
          dotClass: 'bg-emerald-400',
        };
      }

      return {
        textClass: 'text-violet-300',
        dotClass: 'bg-violet-500',
      };
    };

    const buildSingleTooltipHtml = (marker: typeof nonSubmissionMarkers[number]) => {
      const tone = getTooltipTone(marker);
      return `<div style="max-width: 250px;"><div class="font-semibold ${tone.textClass}">${marker.label}</div><div class="text-xs text-gray-300 mt-1">at ${marker.time}</div>${marker.route ? `<div class="text-xs text-gray-300 mt-1">${marker.route}</div>` : ''}${marker.content ? `<div class="text-xs text-gray-200 mt-2 whitespace-pre-wrap">${marker.content}</div>` : ''}</div>`;
    };

    const buildClusterTooltipHtml = (clusterMarkers: typeof nonSubmissionMarkers) => {
      if (clusterMarkers.length === 1) {
        return buildSingleTooltipHtml(clusterMarkers[0]);
      }

      const itemsHtml = clusterMarkers
        .slice()
        .sort((left, right) => {
          const priorityDiff = getPriority(left) - getPriority(right);
          if (priorityDiff !== 0) return priorityDiff;
          return left.position - right.position;
        })
        .map((marker, index) => {
          const tone = getTooltipTone(marker);
          return `<div class="${index > 0 ? 'mt-2 border-t border-white/10 pt-2' : 'mt-1'}"><div class="flex items-center gap-2"><span class="inline-block h-2 w-2 rounded-full ${tone.dotClass}"></span><span class="font-semibold ${tone.textClass}">${marker.label}</span><span class="ml-auto text-[11px] text-gray-400">${marker.time}</span></div>${marker.route ? `<div class="ml-4 mt-1 text-[11px] text-gray-300">${marker.route}</div>` : ''}</div>`;
        })
        .join('');

      return `<div style="max-width: 280px;"><div class="font-semibold text-gray-100">${clusterMarkers.length} overlapping events</div>${itemsHtml}</div>`;
    };

    const clusters: Array<{
      id: string;
      position: number;
      width: string;
      tooltipHtml: string;
    }> = [];
    const clusterThresholdPx = 8;
    const hoverPaddingPx = 8;
    let currentCluster: typeof nonSubmissionMarkers = [];
    let currentMaxPx = -Infinity;

    const flushCluster = () => {
      if (currentCluster.length === 0) {
        return;
      }

      const positionsPx = currentCluster.map((marker) =>
        mainTimelineWidth > 0 ? (marker.position / 100) * mainTimelineWidth : marker.position * 10
      );
      const minPx = Math.min(...positionsPx);
      const maxPx = Math.max(...positionsPx);
      const centerPx = (minPx + maxPx) / 2;
      const centerPosition = mainTimelineWidth > 0
        ? (centerPx / mainTimelineWidth) * 100
        : currentCluster.reduce((sum, marker) => sum + marker.position, 0) / currentCluster.length;
      const widthPx = Math.max(10, maxPx - minPx + hoverPaddingPx);

      clusters.push({
        id: `marker-cluster-${clusters.length}`,
        position: centerPosition,
        width: `${widthPx}px`,
        tooltipHtml: buildClusterTooltipHtml(currentCluster),
      });

      currentCluster = [];
      currentMaxPx = -Infinity;
    };

    nonSubmissionMarkers.forEach((marker) => {
      const markerPx = mainTimelineWidth > 0 ? (marker.position / 100) * mainTimelineWidth : marker.position * 10;

      if (currentCluster.length === 0) {
        currentCluster = [marker];
        currentMaxPx = markerPx;
        return;
      }

      if (markerPx - currentMaxPx <= clusterThresholdPx) {
        currentCluster.push(marker);
        currentMaxPx = markerPx;
        return;
      }

      flushCluster();
      currentCluster = [marker];
      currentMaxPx = markerPx;
    });

    flushCluster();
    return clusters;
  }, [mainTimelineWidth, markers]);

  // Get typing segments from editor writing events only (exclude chat-only activity)
  const typingSessions = useMemo(() => {
    const writingEventTimes: number[] = [];

    events.forEach((event) => {
      if (event.eventType === 'typing_op') {
        writingEventTimes.push(event.timestamp);
        return;
      }

      if (event.eventType === 'paste_internal' || event.eventType === 'paste_external') {
        const targetArea = (event.eventData as { targetArea?: unknown } | undefined)?.targetArea;
        if (targetArea !== 'chat') {
          writingEventTimes.push(event.timestamp);
        }
      }
    });
    writingEventTimes.sort((a, b) => a - b);

    const sessions: Array<{ startTime: number; endTime: number }> = [];
    const GAP_THRESHOLD = 10 * 1000; // keep same typing segment only within 10 seconds

    if (writingEventTimes.length === 0) return sessions;

    let currentSession = {
      startTime: writingEventTimes[0],
      endTime: writingEventTimes[0],
    };

    for (let i = 1; i < writingEventTimes.length; i++) {
      const timeSinceLastEvent = writingEventTimes[i] - currentSession.endTime;

      if (timeSinceLastEvent <= GAP_THRESHOLD) {
        currentSession.endTime = writingEventTimes[i];
      } else {
        sessions.push(currentSession);
        currentSession = {
          startTime: writingEventTimes[i],
          endTime: writingEventTimes[i],
        };
      }
    }

    sessions.push(currentSession);
    return sessions;
  }, [events]);

  // Get all navigable events
  const navigableEvents = useMemo(() => {
    const navEvents: Array<{
      time: number;
      type: 'typing_start' | 'chat' | 'paste_internal' | 'paste_external' | 'submission';
      variant?: ReplayPasteVariant;
      label: string;
      description: string;
    }> = [];

    // Typing segment starts
    typingSessions.forEach((session, i) => {
      navEvents.push({
        time: session.startTime,
        type: 'typing_start',
        label: `Typing Segment ${i + 1}`,
        description: `${formatReplayTime(session.startTime)} - ${formatReplayTime(session.endTime)}`,
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
        const routeLabel = getPasteRouteLabel(event);
        const pasteLabel = getReplayPasteLabel(event);
        navEvents.push({
          time: event.timestamp,
          type: event.eventType as 'paste_internal' | 'paste_external',
          variant: getReplayPasteVariant(event),
          label: `${pasteLabel} ${i + 1}`,
          description: `${routeLabel} at ${formatReplayTime(event.timestamp)}`,
        });
      });

    // Submissions
    events
      .filter(e => e.eventType === 'submission')
      .forEach((event, i) => {
        navEvents.push({
          time: event.timestamp,
          type: 'submission',
          label: `Submission ${i + 1}`,
          description: `At ${formatReplayTime(event.timestamp)}`,
        });
      });

    // Sort by time
    return navEvents.sort((a, b) => a.time - b.time);
  }, [typingSessions, chatMessages, events, formatReplayTime]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || shortcutsDialogRef.current?.open) {
        return;
      }

      // Ignore if user is typing in an editable field.
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable)
      ) {
        return;
      }

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          // If at the end, restart from beginning
          if (currentTime >= endTime) {
            setCurrentTime(startTime);
          }
          setIsPlaying(prev => !prev);
          break;
        case 'ArrowRight':
          e.preventDefault();
          // Jump to next event
          const nextEvent = navigableEvents.find(ev => ev.time > currentTime);
          if (nextEvent) {
            setCurrentTime(nextEvent.time);
          }
          break;
        case 'ArrowLeft':
          e.preventDefault();
          // Jump to previous event with speed-adjusted buffer
          const buffer = 1000 * speed; // Buffer scales with playback speed
          const prevEvent = [...navigableEvents]
            .reverse()
            .find(ev => ev.time < currentTime - buffer);
          if (prevEvent) {
            setCurrentTime(prevEvent.time);
          } else if (navigableEvents.length > 0) {
            // Go to first event if no previous
            setCurrentTime(navigableEvents[0].time);
          }
          break;
        case 'KeyW':
          e.preventDefault();
          toggleWordCountGraph();
          break;
        case 'Minus':
        case 'NumpadSubtract':
          e.preventDefault();
          stepReplaySpeed(-1);
          break;
        case 'Equal':
        case 'NumpadAdd':
          e.preventDefault();
          stepReplaySpeed(1);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentTime, navigableEvents, speed, startTime, endTime, stepReplaySpeed, toggleWordCountGraph]);

  const replayConversationsForPanel = useMemo(
    () => conversations.map((conversation) => ({
      id: conversation.id,
      title: conversation.title,
      createdAt: new Date(conversation.createdAt),
    })),
    [conversations]
  );

  const replayMessagesForPanel = useMemo(
    () => visibleMessages.map((message) => ({
      id: message.id,
      role: message.role as 'user' | 'assistant',
      content: message.content,
      conversationTitle: message.conversationTitle,
      timestamp: message.timestamp,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      metadata: message.metadata as { webSearchEnabled?: boolean; webSearchUsed?: boolean; [key: string]: unknown } | undefined,
    })),
    [visibleMessages]
  );

  const hoveredWordCountTooltipLeft = hoveredWordCountPoint
    ? Math.max(
        120,
        Math.min(
          (typeof window !== 'undefined' ? window.innerWidth : hoveredWordCountPoint.viewportX) - 120,
          hoveredWordCountPoint.viewportX
        )
      )
    : 0;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {hoveredWordCountPoint && (
        <div
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--popover))] px-2 py-1.5 shadow-md"
          style={{
            left: hoveredWordCountTooltipLeft,
            top: hoveredWordCountPoint.graphTop + 24,
          }}
        >
          <div className="text-xs font-semibold text-[hsl(var(--popover-foreground))]">
            {hoveredWordCountPoint.wordCount} words (total)
          </div>
          <div className="text-[11px] text-emerald-700">User: {hoveredWordCountPoint.userWordCount}</div>
          <div className="text-[11px] text-amber-700">GPT: {hoveredWordCountPoint.gptWordCount}</div>
          <div className="text-[11px] text-amber-700/90">
            GPT share: {hoveredWordCountPoint.gptSharePct.toFixed(1)}%
          </div>
          <div className="text-xs text-[hsl(var(--muted-foreground))]">
            at {hoveredWordCountPoint.timeFormatted}
          </div>
        </div>
      )}

      {/* Timeline Controls */}
      <div className="bg-[hsl(var(--card))] border-b border-[hsl(var(--border))] px-6 py-4">
        <div className={`flex gap-4 ${isWordCountGraphExpanded ? 'items-end' : 'items-center'}`}>
          <div className="flex items-center gap-4">
            {/* Play/Pause Button */}
            <Button
              onClick={() => {
                // If at the end, restart from beginning
                if (currentTime >= endTime) {
                  setCurrentTime(startTime);
                }
                setIsPlaying(!isPlaying);
              }}
              size="icon"
              className="rounded-full h-10 w-10"
            >
              {isPlaying ? (
                <Pause className="w-5 h-5" fill="currentColor" />
              ) : (
                <Play className="w-5 h-5 ml-0.5" fill="currentColor" />
              )}
            </Button>

            {/* Time Display */}
            <div className="text-sm text-[hsl(var(--foreground))] font-mono w-44 tabular-nums">
              <span className="whitespace-nowrap">
                {formatReplayTime(currentTime)} / {formatReplayTime(endTime)}
              </span>
              {idlePeriods.length > 0 && (
                <div className="text-xs text-[hsl(var(--muted-foreground))]">
                  ({idlePeriods.length} breaks)
                </div>
              )}
            </div>
          </div>

          {/* Timeline Container */}
          <div className="flex-1 flex flex-col gap-1">
            {/* Word Count Graph */}
            {hasWordCountData && (
              <div
                className={`transition-all duration-300 ${
                  isWordCountGraphExpanded ? 'h-36 overflow-visible' : 'h-0 overflow-hidden'
                }`}
              >
                <div
                  className="h-36 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] cursor-pointer outline-none focus:outline-none flex flex-col"
                  onClick={handleWordCountGraphClick}
                  onMouseMove={handleWordCountGraphMouseMove}
                  onMouseLeave={handleWordCountGraphMouseLeave}
                  tabIndex={-1}
                >
                  <div className="px-2 pt-1 text-[10px] text-[hsl(var(--muted-foreground))] flex items-center gap-3">
                    <span className="inline-flex items-center gap-1">
                      <span className="inline-block w-2.5 h-2.5 rounded bg-blue-500/80" />
                      Total
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="inline-block w-2.5 h-2.5 rounded bg-amber-500/80" />
                      GPT
                    </span>
                  </div>
                  <div className="relative h-[calc(100%-18px)] pl-0.5 py-0.5">
                    {hoveredWordCountPoint && (
                      <div
                        className="pointer-events-none absolute inset-y-1 z-10 w-px bg-slate-400/70"
                        style={{ left: `${hoveredWordCountPoint.percentage}%` }}
                      />
                    )}
                    <div className="pointer-events-none absolute inset-x-1 top-1 z-10 h-5">
                      {replaySessionGraphLabels.map((sessionLabel) => {
                        const isActiveSession =
                          currentTime >= sessionLabel.startTime &&
                          currentTime <= sessionLabel.endTime;

                        return (
                          <div
                            key={sessionLabel.id}
                            className={`pointer-events-auto absolute top-0 flex h-5 items-center overflow-hidden rounded-sm border px-1.5 text-[9px] font-semibold shadow-sm transition-colors ${
                              isActiveSession
                                ? 'border-blue-200/90 bg-blue-50/90 text-blue-700'
                                : 'border-slate-300/80 bg-white/85 text-slate-700'
                            }`}
                            style={{
                              left: `${sessionLabel.position}%`,
                              width: `${sessionLabel.width}%`,
                            }}
                            data-tooltip-id="timeline-tooltip"
                            data-tooltip-html={`<div class="text-center"><div class="font-semibold">${sessionLabel.title}</div><div class="text-xs text-gray-300 mt-1">${sessionLabel.rangeLabel}</div></div>`}
                          >
                            <span className="truncate">
                              {sessionLabel.width < 18 ? sessionLabel.compactLabel : sessionLabel.fullLabel}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart
                        data={wordCountGraphData}
                        margin={{ top: 24, right: 4, left: 0, bottom: 0 }}
                        style={{ outline: 'none' }}
                      >
                        <defs>
                          <linearGradient id={totalWordCountGradientId} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#2563eb" stopOpacity={0.35} />
                            <stop offset="95%" stopColor="#2563eb" stopOpacity={0.06} />
                          </linearGradient>
                          <linearGradient id={gptWordCountGradientId} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.30} />
                            <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.05} />
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="percentage" type="number" domain={[0, 100]} hide />
                        <YAxis domain={[0, maxWordCount]} hide />
                        {sessionBreakGraphMarkerPositions.map((position, i) => (
                          <ReferenceLine
                            key={`session-break-word-marker-${i}`}
                            x={position}
                            stroke="#3b82f6"
                            strokeWidth={1.1}
                            strokeOpacity={0.75}
                            strokeDasharray="2 2"
                          />
                        ))}
                        <ReferenceLine
                          x={clampedProgress}
                          stroke="#ef4444"
                          strokeWidth={1.2}
                          strokeDasharray="4 4"
                        />
                        <Area
                          type="stepAfter"
                          dataKey="wordCount"
                          stroke="#2563eb"
                          strokeWidth={1.7}
                          fill={`url(#${totalWordCountGradientId})`}
                          activeDot={false}
                          isAnimationActive={false}
                        />
                        <Area
                          type="stepAfter"
                          dataKey="gptWordCount"
                          stroke="#f59e0b"
                          strokeWidth={1.7}
                          fill={`url(#${gptWordCountGradientId})`}
                          activeDot={false}
                          isAnimationActive={false}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}

            {/* Typing Activity Bar (Top) */}
            <div className="h-2 bg-[hsl(var(--secondary))] rounded relative overflow-hidden">
              {typingSessions.map((session, i) => {
                const compressedStart = getCompressedTime(session.startTime);
                const compressedEnd = getCompressedTime(session.endTime);
                const startPos = ((compressedStart - startTime) / compressedDuration) * 100;
                const endPos = ((compressedEnd - startTime) / compressedDuration) * 100;
                const width = endPos - startPos;
                const replayDurationSeconds = Math.max(
                  0,
                  Math.floor((compressedEnd - compressedStart) / 1000)
                );
                const replayDurationLabel = formatClockDuration(replayDurationSeconds);

                return (
                  <div
                    key={`typing-segment-${i}`}
                    className="absolute top-0 h-full bg-blue-500/80 rounded cursor-pointer hover:bg-blue-500 transition-colors"
                    style={{
                      left: `${startPos}%`,
                      width: `${Math.max(width, 0.5)}%`,
                    }}
                    data-tooltip-id="timeline-tooltip"
                    data-tooltip-html={`<div class="text-center"><div class="font-semibold">Typing Segment ${i + 1}</div><div class="text-xs text-gray-300 mt-1">${formatReplayTime(session.startTime)} - ${formatReplayTime(session.endTime)}</div><div class="text-xs text-gray-400">Duration: ${replayDurationLabel}</div></div>`}
                  />
                );
              })}

              {/* Idle period indicators */}
              {idlePeriods.map((idle, i) => {
                const middleStart = idle.start + (idle.edgeSeconds * 1000);
                const compressedMiddleStart = getCompressedTime(middleStart);
                const middlePos = ((compressedMiddleStart - startTime) / compressedDuration) * 100;
                const markerWidth = 1; // narrower break marker
                const centeredPos = middlePos - (markerWidth / 2);
                const realBreakDurationSeconds = Math.floor(idle.duration / 1000);
                const realBreakDurationLabel = formatBreakDuration(realBreakDurationSeconds);

                return (
                  <div key={`idle-${i}`}>
                    <div
                      className="absolute top-0 h-full bg-black/90 cursor-pointer hover:bg-black shadow-[0_0_6px_rgba(0,0,0,0.5)]"
                      style={{
                        left: `${centeredPos}%`,
                        width: `${markerWidth}%`,
                      }}
                      data-tooltip-id="timeline-tooltip"
                      data-tooltip-html={`<div class="text-center"><div class="font-semibold">Break</div><div class="text-xs text-gray-300 mt-1">${realBreakDurationLabel}</div><div class="text-xs text-gray-400">Student was inactive</div></div>`}
                    />
                  </div>
                );
              })}
            </div>

            {/* Main Timeline (Bottom) */}
            <div
              ref={mainTimelineRef}
              className="h-4 mb-2 rounded border border-slate-200/80 bg-slate-100 cursor-pointer relative group"
              onClick={handleTimelineClick}
            >
              {/* Progress bar */}
              <div
                className="absolute top-0 left-0 h-full bg-slate-300 rounded-l"
                style={{ width: `${clampedProgress}%` }}
              />

              {/* Event markers */}
              {markers.map((marker) => {
                const markerColorClass = marker.type === 'paste_external'
                  ? 'bg-rose-500'
                  : marker.variant === 'chat_to_editor'
                    ? 'bg-amber-500'
                    : marker.type === 'paste_internal'
                      ? 'bg-emerald-400/80'
                      : 'bg-violet-500';
                const tooltipColorClass = marker.type === 'paste_external'
                  ? 'text-rose-300'
                  : marker.variant === 'chat_to_editor'
                    ? 'text-amber-300'
                    : marker.type === 'paste_internal'
                      ? 'text-emerald-300'
                      : marker.type === 'submission'
                        ? 'text-blue-300'
                        : 'text-violet-300';
                const tooltipHtml = `<div style="max-width: 250px;"><div class="font-semibold ${tooltipColorClass}">${marker.label}</div><div class="text-xs text-gray-300 mt-1">at ${marker.time}</div>${marker.route ? `<div class="text-xs text-gray-300 mt-1">${marker.route}</div>` : ''}${marker.content ? `<div class="text-xs text-gray-200 mt-2 whitespace-pre-wrap">${marker.content}</div>` : ''
                  }</div>`;

                if (marker.type === 'submission') {
                  return (
                    <div
                      key={marker.id}
                      className="absolute top-full mt-0.5 -translate-x-1/2 cursor-pointer z-10"
                      style={{ left: `${marker.position}%` }}
                      data-tooltip-id="timeline-tooltip"
                      data-tooltip-html={tooltipHtml}
                    >
                      <div className="h-0 w-0 border-x-[6px] border-x-transparent border-b-[9px] border-b-blue-600 drop-shadow-[0_1px_1px_rgba(37,99,235,0.35)] transition-transform hover:scale-110" />
                    </div>
                  );
                }

                return (
                  <div
                    key={marker.id}
                    className={`absolute top-0 w-1.5 h-full cursor-pointer hover:w-2 transition-all z-10 ${markerColorClass}`}
                    style={{ left: `${marker.position}%` }}
                    {...(marker.type === 'submission'
                      ? {
                          'data-tooltip-id': 'timeline-tooltip',
                          'data-tooltip-html': tooltipHtml,
                        }
                      : {})}
                  />
                );
              })}

              {markerClusters.map((cluster) => (
                <div
                  key={cluster.id}
                  className="absolute top-0 h-full -translate-x-1/2 z-20"
                  style={{
                    left: `${cluster.position}%`,
                    width: cluster.width,
                  }}
                  data-tooltip-id="timeline-tooltip"
                  data-tooltip-html={cluster.tooltipHtml}
                />
              ))}

              {/* Playhead */}
              <div
                className="absolute top-0 w-0.5 h-full bg-[hsl(var(--foreground))] scale-y-125 transition-transform"
                style={{ left: `${clampedProgress}%` }}
              />
              <div
                className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-[hsl(var(--foreground))] rounded-full shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ left: `calc(${clampedProgress}% - 6px)` }}
              />
            </div>
          </div>

          {/* Speed Control */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-[hsl(var(--muted-foreground))]">Speed:</span>
            <Listbox value={speed} onChange={(value) => setSpeed(value)}>
              <div className="relative">
                <ListboxButton className="h-9 px-3 border border-[hsl(var(--input))] rounded-md text-sm bg-[hsl(var(--background))] text-[hsl(var(--foreground))] min-w-[80px] text-left flex items-center justify-between gap-2 hover:bg-[hsl(var(--accent))] transition-colors">
                  <span>{speed}x</span>
                  <ChevronDown className="w-4 h-4 text-[hsl(var(--muted-foreground))]" />
                </ListboxButton>
                <ListboxOptions className="absolute right-0 top-full mt-1 w-24 overflow-auto rounded-md bg-[hsl(var(--popover))] py-1 text-sm shadow-md ring-1 ring-[hsl(var(--border))] z-50 focus:outline-none">
                  {SPEED_OPTIONS.map((s) => (
                    <ListboxOption
                      key={s}
                      value={s}
                      className="cursor-pointer select-none px-3 py-2 hover:bg-[hsl(var(--accent))] text-[hsl(var(--popover-foreground))]"
                    >
                      {({ selected }) => (
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{s}x</span>
                          {selected && (
                            <Check className="w-4 h-4 text-[hsl(var(--primary))]" />
                          )}
                        </div>
                      )}
                    </ListboxOption>
                  ))}
                </ListboxOptions>
              </div>
            </Listbox>
          </div>
        </div>

        {/* Legend, Current Event, and Event Navigation - Same Row */}
        <div className="flex items-center justify-between mt-2">
          {/* Legend */}
          <div className="flex items-center gap-4 text-xs text-[hsl(var(--muted-foreground))]">
            <div className="flex items-center gap-1">
              <div className="w-4 h-2 bg-blue-500/80 rounded" />
              <span>Typing Activity</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 bg-violet-500 rounded" />
              <span>Chat</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 bg-amber-500 rounded" />
              <span>Chat {'->'} Editor Paste</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 bg-emerald-400/80 rounded" />
              <span>Other Internal Paste</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 bg-rose-500 rounded" />
              <span>External Paste</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="h-0 w-0 border-x-[5px] border-x-transparent border-b-[8px] border-b-blue-600" />
              <span>Submission</span>
            </div>
            {idlePeriods.length > 0 && (
              <div className="flex items-center gap-1">
                <div className="w-3 h-2 bg-black rounded" />
                <span>Break (compressed)</span>
              </div>
            )}
            {stepReplayFailureCount > 0 && (
              <div className="flex items-center gap-1 text-red-600">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>
                  Step apply failures: {stepReplayFailureCount}
                  {lastStepReplayFailure ? ` (${lastStepReplayFailure})` : ''}
                </span>
              </div>
            )}
          </div>

          {/* Event Navigation Dropdown */}
          <div className="flex items-center gap-2">
            {/* Break Threshold Control */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="inline-flex h-4 w-4 items-center justify-center rounded-sm text-[hsl(var(--muted-foreground))] transition-colors hover:text-[hsl(var(--foreground))]"
                aria-label="Break threshold explanation"
                data-tooltip-id="timeline-tooltip"
                data-tooltip-html="Gaps longer than this threshold are treated as breaks and compressed out of the timeline."
              >
                <Info className="h-3.5 w-3.5" />
              </button>
              <span className="text-sm text-[hsl(var(--muted-foreground))]">Break:</span>
              <input
                type="range"
                min={0}
                max={IDLE_PRESETS.length - 1}
                step={1}
                value={idlePresetIndex}
                onChange={(e) => setIdleThresholdSeconds(IDLE_PRESETS[Number(e.target.value)])}
                className="w-24 accent-[hsl(var(--primary))] cursor-pointer"
              />
              <span className="text-sm text-[hsl(var(--foreground))] w-8 tabular-nums">
                {idleThresholdSeconds < 60 ? `${idleThresholdSeconds}s` : `${idleThresholdSeconds / 60}m`}
              </span>
            </div>

            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={openShortcutsDialog}
              aria-haspopup="dialog"
            >
              <Keyboard className="w-4 h-4" />
              Shortcuts
            </Button>

            <Button
              variant={isWordCountGraphExpanded ? 'primary' : 'outline'}
              size="sm"
              className="gap-2"
              onClick={toggleWordCountGraph}
              disabled={!hasWordCountData}
            >
              <BarChart3 className="w-4 h-4" />
              Word Count
            </Button>

            <Menu as="div" className="relative">
              <MenuButton as={Button} variant="outline" size="sm" className="gap-2">
                <div className="flex items-center gap-2">
                  <span>Events</span>
                  <ChevronDown className="w-4 h-4 text-[hsl(var(--muted-foreground))]" />
                </div>
              </MenuButton>

              <MenuItems className="absolute right-0 mt-2 w-80 bg-[hsl(var(--popover))] rounded-lg shadow-xl border border-[hsl(var(--border))] z-20 max-h-96 overflow-y-auto focus:outline-none text-[hsl(var(--popover-foreground))]">
                <div className="sticky top-0 bg-[hsl(var(--muted))] px-4 py-2 border-b border-[hsl(var(--border))]">
                  <p className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase">
                    Jump to Event ({navigableEvents.length})
                  </p>
                </div>

                {navigableEvents.length === 0 ? (
                  <div className="px-4 py-8 text-center text-[hsl(var(--muted-foreground))] text-sm">
                    No events recorded
                  </div>
                ) : (
                  <div className="py-1">
                    {navigableEvents.map((event, i) => {
                      const isPast = event.time <= currentTime;

                      const getEventIcon = (type: string, variant?: ReplayPasteVariant) => {
                        switch (type) {
                          case 'typing_start': return <Keyboard className="w-4 h-4 text-blue-500" />;
                          case 'chat': return <MessageSquare className="w-4 h-4 text-violet-500" />;
                          case 'paste_internal':
                            return (
                              <ClipboardCopy
                                className={`w-4 h-4 ${variant === 'chat_to_editor' ? 'text-amber-500' : 'text-emerald-500'}`}
                              />
                            );
                          case 'paste_external': return <AlertTriangle className="w-4 h-4 text-rose-500" />;
                          case 'submission': return <Send className="w-4 h-4 text-blue-600" />;
                          default: return null;
                        }
                      };

                      return (
                        <MenuItem key={i}>
                          {({ active }) => (
                            <button
                              onClick={() => setCurrentTime(event.time)}
                              className={`w-full px-4 py-3 text-left transition-colors border-b border-[hsl(var(--border))] last:border-0 ${active ? 'bg-[hsl(var(--accent))]' :
                                isPast ? 'bg-[hsl(var(--muted))]/50' : 'bg-[hsl(var(--card))] hover:bg-[hsl(var(--accent))]'
                                }`}
                            >
                              <div className="flex items-start gap-3">
                                <span className="mt-0.5 p-1 bg-[hsl(var(--muted))] rounded-md">
                                  {getEventIcon(event.type, event.variant)}
                                </span>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between gap-2">
                                    <p className={`text-sm font-medium truncate ${isPast ? 'text-[hsl(var(--primary))]' : 'text-[hsl(var(--foreground))]'
                                      }`}>
                                      {event.label}
                                    </p>
                                    <span className={`text-xs font-mono whitespace-nowrap ${isPast ? 'text-[hsl(var(--primary))]' : 'text-[hsl(var(--muted-foreground))]'
                                      }`}>
                                      {formatReplayTime(event.time)}
                                    </span>
                                  </div>
                                  <p className="text-xs text-[hsl(var(--muted-foreground))] truncate mt-0.5">
                                    {event.description}
                                  </p>
                                </div>
                              </div>
                            </button>
                          )}
                        </MenuItem>
                      );
                    })}
                  </div>
                )}
              </MenuItems>
            </Menu>
          </div>
        </div>
      </div>

      {/* Split View */}
      <div className="flex-1 flex overflow-hidden">
        {/* Editor View (Left) */}
        <div className="flex-1 flex flex-col border-r border-gray-200">
          <div className="h-10 px-4 bg-gray-100 border-b border-gray-200 flex items-center justify-between gap-3">
            <h2 className="font-semibold text-gray-900">Editor</h2>
            <label className="flex items-center gap-2 text-xs text-gray-700 select-none cursor-pointer">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                checked={showAuthorshipHighlight}
                onChange={(e) => setShowAuthorshipHighlight(e.target.checked)}
              />
              <span>GPT/User Highlight</span>
            </label>
          </div>
          {showAuthorshipHighlight && (
            <div className="px-4 py-1.5 bg-gray-50 border-b border-gray-200 flex items-center gap-4 text-[11px] text-gray-700">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-300 border border-amber-400" />
                GPT generated
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block w-2.5 h-2.5 rounded-sm bg-green-300 border border-green-400" />
                User written
              </span>
            </div>
          )}
          <div className="flex-1 overflow-auto p-6 bg-white relative">
            {/* Editor Event Indicator */}
            {currentEvent && (
              <div
                className={`absolute top-4 right-4 z-10 flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium shadow-md ${
                  currentEvent.type === 'paste_external'
                    ? 'bg-rose-100 text-rose-700 border border-rose-200'
                    : currentEvent.variant === 'chat_to_editor'
                      ? 'bg-amber-100 text-amber-800 border border-amber-200'
                    : currentEvent.type === 'chat'
                      ? 'bg-violet-100 text-violet-700 border border-violet-200'
                    : currentEvent.type === 'paste_internal'
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : 'bg-blue-100 text-blue-700 border border-blue-200'
                }`}
              >
                {currentEvent.type === 'chat' && <MessageSquare className="w-4 h-4" />}
                {currentEvent.type === 'paste_external' && <AlertTriangle className="w-4 h-4" />}
                {currentEvent.type === 'paste_internal' && <ClipboardCopy className="w-4 h-4" />}
                {currentEvent.type === 'submission' && <Send className="w-4 h-4" />}
                <div className="flex flex-col leading-tight">
                  <span>{currentEvent.label}</span>
                  {currentEvent.detail && (
                    <span className="text-[11px] opacity-80">{currentEvent.detail}</span>
                  )}
                </div>
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
            className="w-2 shrink-0 cursor-col-resize flex items-center justify-center hover:bg-[hsl(var(--primary))]/10 transition-colors group"
            onMouseDown={startResize}
          >
            <div className="h-10 w-1 rounded-full bg-[hsl(var(--border))] group-hover:bg-[hsl(var(--primary))]/50 transition-colors" />
          </div>
        )}

        {/* Chat View (Right) - Resizable with ChatPanel */}
        {isChatOpen && (
          <div className="bg-gray-50" style={{ width: `${chatWidth}px` }}>
            <ChatPanel
              mode="replay"
              isOpen={isChatOpen}
              onToggle={setChatOpen}
              allowWebSearch={allowWebSearch}
              replayConversations={replayConversationsForPanel}
              replayMessages={replayMessagesForPanel}
              replayInputState={replayChatInputState}
              highlightedMessageId={highlightedMessageId}
              replayPasteHighlights={visibleReplayPasteHighlights}
              onReplayPasteClick={handleReplayPasteClick}
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
              <span className="text-xs font-medium">Chat</span>
            </button>
          </div>
        )}
      </div>

      <dialog
        ref={shortcutsDialogRef}
        aria-labelledby={replayShortcutsDialogTitleId}
        aria-describedby={replayShortcutsDialogDescriptionId}
        className="m-auto w-[min(56rem,calc(100vw-2rem))] overflow-hidden rounded-[28px] border border-slate-200/80 bg-[hsl(var(--card))] p-0 text-[hsl(var(--card-foreground))] shadow-[0_32px_80px_rgba(15,23,42,0.28)] backdrop:bg-slate-950/60"
        onClick={(event) => {
          const dialog = shortcutsDialogRef.current;
          if (!dialog) {
            return;
          }

          const rect = dialog.getBoundingClientRect();
          const isInsideBounds = (
            event.clientX >= rect.left &&
            event.clientX <= rect.right &&
            event.clientY >= rect.top &&
            event.clientY <= rect.bottom
          );

          if (!isInsideBounds) {
            dialog.close();
          }
        }}
      >
        <div className="grid md:grid-cols-[18rem_minmax(0,1fr)]">
          <div className="border-b border-slate-200/80 bg-[linear-gradient(180deg,rgba(219,234,254,0.8),rgba(255,255,255,0.92))] p-6 md:border-b-0 md:border-r md:p-7">
            <div className="inline-flex items-center rounded-full border border-sky-200 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700 shadow-sm">
              Replay controls
            </div>
            <h2 id={replayShortcutsDialogTitleId} className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">
              Keyboard shortcuts
            </h2>
            <p
              id={replayShortcutsDialogDescriptionId}
              className="mt-3 text-sm leading-6 text-slate-600"
            >
              Key commands for scrubbing, playback control, speed changes, and the word count panel.
            </p>

            <div className="mt-6 space-y-3">
              <div className="rounded-2xl border border-white/80 bg-white/75 p-4 shadow-sm">
                <p className="text-2xl font-semibold text-slate-900">{REPLAY_SHORTCUTS.length}</p>
                <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-500">
                  Available shortcuts
                </p>
              </div>
              <div className="rounded-2xl border border-white/80 bg-white/75 p-4 shadow-sm">
                <p className="text-sm font-medium text-slate-900">When they work</p>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  Shortcuts are active only when focus is outside inputs and this modal is closed.
                </p>
              </div>
              <div className="rounded-2xl border border-white/80 bg-slate-900 px-4 py-3 text-slate-100 shadow-sm">
                <p className="text-xs uppercase tracking-[0.16em] text-slate-300">Quick close</p>
                <p className="mt-1 text-sm">
                  Press <span className="font-semibold text-white">Esc</span> or click outside the dialog.
                </p>
              </div>
            </div>
          </div>

          <div className="bg-[hsl(var(--card))] p-6 md:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">
                  Shortcut map
                </p>
                <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
                  Playback commands are arranged by what you most often do while reviewing a session.
                </p>
              </div>

              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--background))]"
                onClick={closeShortcutsDialog}
                aria-label="Close keyboard shortcuts dialog"
              >
                <span aria-hidden="true" className="text-lg leading-none">×</span>
              </Button>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {REPLAY_SHORTCUTS.map((shortcut) => (
                <div
                  key={`${shortcut.title}-${shortcut.keys.join('-')}`}
                  className="flex min-h-32 flex-col justify-between rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(180deg,hsl(var(--background)),rgba(248,250,252,0.95))] p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-[hsl(var(--foreground))]">
                        {shortcut.title}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-[hsl(var(--muted-foreground))]">
                        {shortcut.description}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {shortcut.keys.map((key) => (
                      <kbd
                        key={key}
                        className="min-w-12 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-center text-xs font-semibold text-slate-700 shadow-[inset_0_-1px_0_rgba(148,163,184,0.35)]"
                      >
                        {key}
                      </kbd>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 flex items-center justify-end border-t border-[hsl(var(--border))] pt-4">
              <Button type="button" size="sm" onClick={closeShortcutsDialog}>
                Close
              </Button>
            </div>
          </div>
        </div>
      </dialog>

      {/* Timeline Tooltip */}
      <TimelineTooltip
        id="timeline-tooltip"
        place="top"
        className="!bg-gray-900 !text-gray-100 !border-gray-700 !rounded-lg !px-3 !py-2 !text-sm !max-w-xs z-50"
        opacity={1}
      />
    </div>
  );
}
