import {
  ITracker,
  PointerPosition,
  TrackingEvent,
  TrackingMode,
  TrackingStatus,
} from '../shared/types/tracking';
import { logger } from '../shared/utils';
import { ICursorController } from './mockCursorController';

export interface SharedControllerStatus {
  mode: TrackingMode | 'none';
  state: TrackingStatus['state'];
  confidence: number;
  position: PointerPosition;
  lastError: Error | null;
  isPaused: boolean;
}

export class SharedCursorController {
  private headTracker: ITracker;
  private handTracker: ITracker;
  private cursorUI: ICursorController;

  private activeMode: TrackingMode | 'none' = 'none';
  private isPaused = false;
  private lastError: Error | null = null;
  private currentPosition: PointerPosition = { x: 0.5, y: 0.5, confidence: 1, timestamp: Date.now() };
  private confidence = 0;
  
  // Diagnostics
  public diagnostics = {
    receivedUpdates: 0,
    contentDeliverySuccess: 0,
    contentDeliveryFail: 0
  };
  
  private unsubPointer: (() => void) | null = null;
  private unsubEvent: (() => void) | null = null;

  // Concurrency lock for mode switching
  private isSwitching = false;

  constructor(headTracker: ITracker, handTracker: ITracker, cursorUI: ICursorController) {
    this.headTracker = headTracker;
    this.handTracker = handTracker;
    this.cursorUI = cursorUI;
  }

  public async start(mode: TrackingMode): Promise<void> {
    if (this.isSwitching) {
      logger.warn('SharedCursorController', 'Start requested while already switching modes');
      return;
    }

    if (this.activeMode === mode && !this.isPaused) {
      return; // Already running in this mode
    }

    this.isSwitching = true;
    this.lastError = null;

    try {
      // If a different mode is running, stop it first
      if (this.activeMode !== 'none' && this.activeMode !== mode) {
        await this.stopActiveTracker();
      }

      this.activeMode = mode;
      this.isPaused = false;

      const tracker = this.getActiveTracker();
      if (!tracker) throw new Error('Tracker not found for mode');

      // Subscribe to events
      this.subscribeToTracker(tracker);

      await tracker.start(mode);
      this.cursorUI.show();
      this.sendVisibilityToTab(true);
    } catch (error) {
      this.lastError = error instanceof Error ? error : new Error(String(error));
      logger.error('SharedCursorController', `Failed to start ${mode} tracking`, error);
      // If the active provider fails, pause rather than automatically switching
      this.isPaused = true;
    } finally {
      this.isSwitching = false;
    }
  }

  public async pause(): Promise<void> {
    this.isPaused = true;
    const tracker = this.getActiveTracker();
    if (tracker) {
      await tracker.pause();
    }
    this.sendVisibilityToTab(false);
  }

  public async resume(): Promise<void> {
    if (!this.isPaused || this.activeMode === 'none') return;
    this.isPaused = false;
    const tracker = this.getActiveTracker();
    if (tracker) {
      await tracker.resume();
    }
    this.sendVisibilityToTab(true);
  }

  public async stop(): Promise<void> {
    await this.stopActiveTracker();
    this.activeMode = 'none';
    this.isPaused = false;
    this.cursorUI.hide();
    this.sendVisibilityToTab(false);
  }

  private sendVisibilityToTab(visible: boolean) {
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, { type: 'POINTER_VISIBILITY', payload: { visible } }).catch(() => {});
        }
      });
    }
  }

  private async stopActiveTracker() {
    const tracker = this.getActiveTracker();
    if (tracker) {
      await tracker.stop();
    }
    if (this.unsubPointer) {
      this.unsubPointer();
      this.unsubPointer = null;
    }
    if (this.unsubEvent) {
      this.unsubEvent();
      this.unsubEvent = null;
    }
  }

  private getActiveTracker(): ITracker | null {
    if (this.activeMode === 'head') return this.headTracker;
    if (this.activeMode === 'hand') return this.handTracker;
    return null;
  }

  private subscribeToTracker(tracker: ITracker) {
    this.unsubPointer = tracker.onPointerMove((pos: PointerPosition) => {
      this.handlePointerMove(pos);
    });

    this.unsubEvent = tracker.onTrackingEvent((event: TrackingEvent) => {
      this.handleTrackingEvent(event);
    });
  }

  private lastRawPos: PointerPosition | null = null;

  private handlePointerMove(pos: PointerPosition) {
    if (this.isPaused) return;

    this.confidence = pos.confidence;
    
    let smoothedPos = { ...pos };
    if (this.activeMode === 'hand' && this.lastRawPos) {
       const alpha = 0.5;
       smoothedPos.x = this.lastRawPos.x * (1 - alpha) + pos.x * alpha;
       smoothedPos.y = this.lastRawPos.y * (1 - alpha) + pos.y * alpha;
    }

    this.lastRawPos = smoothedPos;
    this.currentPosition = smoothedPos;

    this.diagnostics.receivedUpdates++;

    if (this.cursorUI) {
      this.cursorUI.moveTo(smoothedPos);
    }

    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, { type: 'POINTER_POSITION_UPDATE', payload: smoothedPos }, (response) => {
             if (chrome.runtime.lastError) {
                this.diagnostics.contentDeliveryFail++;
             } else if (response?.ok) {
                this.diagnostics.contentDeliverySuccess++;
             } else {
                this.diagnostics.contentDeliveryFail++;
             }
          });
        }
      });
    }
  }

  private handleTrackingEvent(event: TrackingEvent) {
    if (this.isPaused) return;

    if (event.gesture === 'dwell' || event.gesture === 'pinch' || event.gesture === 'nod') {
      if (this.cursorUI) {
         this.cursorUI.triggerClickVisual('left');
      }
      
      if (typeof chrome !== 'undefined' && chrome.tabs) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]?.id) {
            chrome.tabs.sendMessage(tabs[0].id, { 
              type: 'EXECUTE_BROWSER_ACTION', 
              payload: { action: { type: 'click', coordinates: { x: event.position.x, y: event.position.y } } }
            }).catch(() => {});
          }
        });
      }
    }
  }

  public getStatus(): SharedControllerStatus {
    const tracker = this.getActiveTracker();
    const trackerStatus = tracker ? tracker.getStatus() : { state: 'idle' as TrackingStatus['state'], confidence: 0 };
    
    return {
      mode: this.activeMode,
      state: trackerStatus.state,
      confidence: this.confidence,
      position: this.currentPosition,
      lastError: this.lastError,
      isPaused: this.isPaused
    };
  }
}
