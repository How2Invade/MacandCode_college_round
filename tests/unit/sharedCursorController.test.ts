import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SharedCursorController } from '../../src/cursor/sharedCursorController';
import { MockHeadTracker } from '../../src/tracking/head/mockHeadTracker';
import { MockCursorController } from '../../src/cursor/mockCursorController';
import { ITracker, PointerPosition, TrackingEvent, TrackingMode, TrackingStatus } from '../../src/shared/types/tracking';

// Mock Hand Tracker mimicking ITracker for tests
class MockHandTracker implements ITracker {
  public status: TrackingStatus = { mode: 'hand', state: 'idle', confidence: 0 };
  private pointerListeners: any[] = [];
  private eventListeners: any[] = [];
  
  async initialize() {}
  async start(_mode?: TrackingMode) { this.status.state = 'active'; }
  async pause() { this.status.state = 'paused'; }
  async resume() { this.status.state = 'active'; }
  async stop() { this.status.state = 'idle'; }
  async calibrate() {}
  getStatus() { return this.status; }
  
  onPointerMove(cb: any) { this.pointerListeners.push(cb); return () => {}; }
  onTrackingEvent(cb: any) { this.eventListeners.push(cb); return () => {}; }
  async destroy() {}

  emitPointer(pos: PointerPosition) { this.pointerListeners.forEach(cb => cb(pos)); }
  emitEvent(event: TrackingEvent) { this.eventListeners.forEach(cb => cb(event)); }
}

describe('SharedCursorController', () => {
  let headTracker: MockHeadTracker;
  let handTracker: MockHandTracker;
  let cursorUI: MockCursorController;
  let controller: SharedCursorController;

  beforeEach(() => {
    headTracker = new MockHeadTracker();
    handTracker = new MockHandTracker();
    cursorUI = new MockCursorController();
    controller = new SharedCursorController(headTracker, handTracker, cursorUI);
  });

  it('enforces exactly one active tracking mode', async () => {
    const headStart = vi.spyOn(headTracker, 'start');
    const handStart = vi.spyOn(handTracker, 'start');
    const headStop = vi.spyOn(headTracker, 'stop');
    
    await controller.start('head');
    expect(headStart).toHaveBeenCalled();
    expect(controller.getStatus().mode).toBe('head');
    
    await controller.start('hand');
    expect(headStop).toHaveBeenCalled();
    expect(handStart).toHaveBeenCalled();
    expect(controller.getStatus().mode).toBe('hand');
  });

  it('handles concurrent start requests safely', async () => {
    const startPromise1 = controller.start('head');
    const startPromise2 = controller.start('hand');
    
    await Promise.all([startPromise1, startPromise2]);
    // The second request should have been ignored because isSwitching was true
    expect(controller.getStatus().mode).toBe('head');
  });

  it('pauses tracking on error instead of automatically switching', async () => {
    vi.spyOn(headTracker, 'start').mockRejectedValueOnce(new Error('Camera failed'));
    
    await controller.start('head');
    
    expect(controller.getStatus().isPaused).toBe(true);
    expect(controller.getStatus().lastError).toBeDefined();
    expect(controller.getStatus().mode).toBe('head'); // Mode was set, but paused
  });

  it('forwards pointer coordinates and smooths only if hand', async () => {
    await controller.start('hand');
    const uiSpy = vi.spyOn(cursorUI, 'moveTo');
    
    handTracker.emitPointer({ x: 0.5, y: 0.5, confidence: 1, timestamp: Date.now() });
    expect(uiSpy).toHaveBeenCalledWith(expect.objectContaining({ x: 0.5, y: 0.5 }));
    
    // Smoothing test: next value should be blended
    handTracker.emitPointer({ x: 1.0, y: 1.0, confidence: 1, timestamp: Date.now() });
    const lastCall = uiSpy.mock.calls[1][0];
    // 0.5 * 0.5 + 1.0 * 0.5 = 0.75
    expect(lastCall.x).toBeCloseTo(0.75);
  });

  it('forwards click signals for dwell gestures', async () => {
    await controller.start('head');
    const clickSpy = vi.spyOn(cursorUI, 'triggerClickVisual');
    
    // @ts-ignore
    headTracker.emitEvent({ mode: 'head', gesture: 'dwell', position: {x:0.5, y:0.5} });
    expect(clickSpy).toHaveBeenCalledWith('left');
  });

});
