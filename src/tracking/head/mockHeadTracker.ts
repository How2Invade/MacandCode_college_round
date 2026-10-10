/**
 * MOCK IMPLEMENTATION: MockHeadTracker
 *
 * NOTE: This is a placeholder mock for head tracking (pose/nod/shake).
 * Uses shared PointerPosition and TrackingStatus contracts.
 */

import {
  ITracker,
  PointerPosition,
  TrackingEvent,
  TrackingMode,
  TrackingStatus,
} from '../../shared/types/tracking';
import { logger } from '../../shared/utils';

export class MockHeadTracker implements ITracker {
  public readonly isMock = true;
  private status: TrackingStatus = {
    mode: 'head',
    state: 'idle',
    confidence: 0,
    message: 'Ready to start head tracking',
  };

  private pointerListeners: ((pos: PointerPosition) => void)[] = [];
  private eventListeners: ((event: TrackingEvent) => void)[] = [];
  private intervalId: ReturnType<typeof setInterval> | null = null;

  public async initialize(): Promise<void> {
    logger.info('MockHeadTracker', 'Initializing mock head tracker (placeholder for FaceLandmarker)');
    this.status = {
      ...this.status,
      state: 'idle',
      message: 'Initialized',
    };
  }

  public async start(mode: TrackingMode = 'head'): Promise<void> {
    logger.info('MockHeadTracker', `Starting mock tracking in mode: ${mode}`);
    this.status = {
      mode,
      state: 'active',
      confidence: 0.92,
      message: 'Head tracking active at 30 FPS',
    };

    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = setInterval(() => {
      if (this.status.state === 'active') {
        const t = Date.now() / 1200;
        // Normalised coordinates between 0 and 1
        const pos: PointerPosition = {
          x: Math.max(0, Math.min(1, 0.5 + Math.sin(t) * 0.15)),
          y: Math.max(0, Math.min(1, 0.5 + Math.cos(t) * 0.12)),
          confidence: 0.92,
          timestamp: Date.now(),
        };

        const event: TrackingEvent = {
          timestamp: Date.now(),
          mode: 'head',
          position: pos,
          gesture: 'dwell',
          confidence: 0.92,
        };

        this.emitPointer(pos);
        this.emitEvent(event);
      }
    }, 150);
  }

  public async pause(): Promise<void> {
    logger.info('MockHeadTracker', 'Pausing mock head tracker');
    this.status.state = 'paused';
    this.status.message = 'Tracking paused';
  }

  public async resume(): Promise<void> {
    logger.info('MockHeadTracker', 'Resuming mock head tracker');
    this.status.state = 'active';
    this.status.message = 'Tracking active';
  }

  public async stop(): Promise<void> {
    logger.info('MockHeadTracker', 'Stopping mock head tracker');
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.status = {
      ...this.status,
      state: 'idle',
      confidence: 0,
      message: 'Tracking stopped',
    };
  }

  public async calibrate(): Promise<void> {
    logger.info('MockHeadTracker', 'Simulating head tracker calibration');
    this.status.state = 'calibrating';
    await new Promise((res) => setTimeout(res, 250));
    this.status.state = 'active';
  }

  public getStatus(): TrackingStatus {
    return { ...this.status };
  }

  public onPointerMove(listener: (pos: PointerPosition) => void): () => void {
    this.pointerListeners.push(listener);
    return () => {
      this.pointerListeners = this.pointerListeners.filter((l) => l !== listener);
    };
  }

  public onTrackingEvent(listener: (event: TrackingEvent) => void): () => void {
    this.eventListeners.push(listener);
    return () => {
      this.eventListeners = this.eventListeners.filter((l) => l !== listener);
    };
  }

  public async destroy(): Promise<void> {
    await this.stop();
    this.pointerListeners = [];
    this.eventListeners = [];
  }

  private emitPointer(pos: PointerPosition): void {
    for (const listener of this.pointerListeners) {
      listener(pos);
    }
  }

  private emitEvent(event: TrackingEvent): void {
    for (const listener of this.eventListeners) {
      listener(event);
    }
  }
}
