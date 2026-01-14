export interface EditorEventData {
  type: 'paste_internal' | 'paste_external' | 'snapshot' | 'submission';
  timestamp: number;
  sequenceNumber: number;
  data?: any;
}

export class EventTracker {
  private queue: EditorEventData[] = [];
  private sequenceNumber = 0;
  private sessionId: string;
  private saveTimer: NodeJS.Timeout | null = null;
  private lastSnapshotTime = Date.now();
  private lastActivityTime = 0;
  private activityCount = 0;
  private activityThrottle = 1000; // 1초마다 최대 1번 활동 카운트
  private snapshotCallback: (() => void) | null = null;
  private inactivityTimer: NodeJS.Timeout | null = null;
  private keystrokeCount = 0; // 키 입력 카운터
  private KEYSTROKES_PER_SNAPSHOT = 10; // 10번 입력마다 snapshot

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  // 사용자 활동 추적 (throttled)
  trackActivity() {
    const now = Date.now();
    
    // 1초 이내 중복 활동 무시
    if (now - this.lastActivityTime < this.activityThrottle) {
      return;
    }
    
    this.lastActivityTime = now;
    this.activityCount++;
    this.keystrokeCount++; // 키 입력 카운트 증가

    // 타이핑 멈춤 감지: 1초간 입력 없으면 snapshot (유지)
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
    }
    
    this.inactivityTimer = setTimeout(() => {
      if (this.activityCount > 0 && this.snapshotCallback) {
        this.snapshotCallback();
      }
    }, 1000); // 1초간 입력 없으면 저장

    // 키 입력 횟수 기반 저장 (새로 추가)
    if (this.keystrokeCount >= this.KEYSTROKES_PER_SNAPSHOT && this.snapshotCallback) {
      this.snapshotCallback();
    }
  }

  trackSnapshot(documentState: any) {
    this.queue.push({
      type: 'snapshot',
      timestamp: Date.now(),
      sequenceNumber: this.sequenceNumber++,
      data: documentState,
    });

    this.activityCount = 0;
    this.keystrokeCount = 0; // 키 입력 카운터 리셋
    this.lastSnapshotTime = Date.now();
    this.scheduleSave();
  }

  trackSubmission(documentState: any) {
    this.queue.push({
      type: 'submission',
      timestamp: Date.now(),
      sequenceNumber: this.sequenceNumber++,
      data: documentState,
    });

    this.scheduleSave();
  }

  trackPaste(content: string, isInternal: boolean) {
    this.queue.push({
      type: isInternal ? 'paste_internal' : 'paste_external',
      timestamp: Date.now(),
      sequenceNumber: this.sequenceNumber++,
      data: { content },
    });

    this.scheduleSave();
  }

  shouldTakeSnapshot(): boolean {
    // 키 입력 횟수 기반 또는 활동이 있고 3초 이상 지났으면 snapshot
    const timeSinceSnapshot = Date.now() - this.lastSnapshotTime;
    return (
      this.activityCount > 0 && 
      (this.keystrokeCount >= this.KEYSTROKES_PER_SNAPSHOT || timeSinceSnapshot >= 3000)
    );
  }

  // Snapshot 콜백 등록 (타이핑 멈춤 감지용)
  setSnapshotCallback(callback: () => void) {
    this.snapshotCallback = callback;
  }

  private scheduleSave() {
    // Snapshot은 즉시 저장 (다른 이벤트는 배치 처리)
    if (
      this.queue.length > 0 &&
      (this.queue[this.queue.length - 1].type === 'snapshot' ||
        this.queue[this.queue.length - 1].type === 'submission')
    ) {
      // 즉시 저장
      this.flush();
    } else if (this.queue.length >= 10) {
      // 10개 이벤트 모이면 저장
      this.flush();
    } else if (!this.saveTimer) {
      // 그 외에는 5초 후 저장 (30초 → 5초로 단축)
      this.saveTimer = setTimeout(() => {
        this.flush();
      }, 5000);
    }
  }

  async flush() {
    if (this.queue.length === 0) return;

    const eventsToSave = [...this.queue];
    this.queue = [];

    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    // Dispatch saving event
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('prelude:events-saving'));
    }

    try {
      const response = await fetch('/api/events/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId: this.sessionId,
          events: eventsToSave,
        }),
      });

      if (!response.ok) {
        // Re-add events to queue if save failed
        this.queue.unshift(...eventsToSave);
        throw new Error('Failed to save events');
      }

      console.log(`✓ Saved ${eventsToSave.length} events`);

      // Dispatch saved event for UI update
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('prelude:events-saved'));
      }
    } catch (error) {
      console.error('Failed to save events:', error);
      // Re-add events to queue
      this.queue.unshift(...eventsToSave);
    }
  }

  // Force save (for beforeunload)
  forceSave() {
    return this.flush();
  }
}
