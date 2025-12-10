export interface EditorEventData {
  type: 'transaction_step' | 'paste_internal' | 'paste_external' | 'snapshot';
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
  private stepsSinceSnapshot = 0;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  trackTransactionStep(stepData: any) {
    this.queue.push({
      type: 'transaction_step',
      timestamp: Date.now(),
      sequenceNumber: this.sequenceNumber++,
      data: stepData,
    });

    this.stepsSinceSnapshot++;
    this.scheduleSave();
  }

  trackSnapshot(documentState: any) {
    this.queue.push({
      type: 'snapshot',
      timestamp: Date.now(),
      sequenceNumber: this.sequenceNumber++,
      data: documentState,
    });

    this.stepsSinceSnapshot = 0;
    this.lastSnapshotTime = Date.now();
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
    const timeSinceSnapshot = Date.now() - this.lastSnapshotTime;
    return this.stepsSinceSnapshot >= 5 || timeSinceSnapshot >= 10 * 1000; // 5 steps or 10 seconds
  }

  private scheduleSave() {
    // Save every 30 seconds or 10 events
    if (this.queue.length >= 10) {
      this.flush();
    } else if (!this.saveTimer) {
      this.saveTimer = setTimeout(() => {
        this.flush();
      }, 30000); // 30 seconds
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

      // Dispatch custom event for UI update
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
