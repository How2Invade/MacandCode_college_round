import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HeadTracker } from '../../src/tracking/head/headTracker';


describe('HeadTracker', () => {
  let tracker: HeadTracker;

  beforeEach(() => {
    tracker = new HeadTracker();
    
    // Mock navigator.mediaDevices
    Object.defineProperty(global.navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: vi.fn() }]
        })
      },
      configurable: true
    });
    
    // Mock chrome.runtime.getURL
    global.chrome = {
      runtime: { getURL: vi.fn((path) => path) }
    } as any;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('handles missing or malformed matrix gracefully', () => {
    // We can call extractPose via any(). Let's simulate it by exposing it or just invoking it.
    // Since it's private, we test via the public pose state if we mock results, but actually
    // we can just cast to any to test the math without standing up full MediaPipe.
    const t = tracker as any;
    
    // Missing matrix
    t.extractPose(undefined);
    expect(t.pose.hasMatrix).toBe(false);
    
    // Malformed matrix (less than 16 elements)
    t.extractPose({ data: new Float32Array(10) });
    expect(t.pose.hasMatrix).toBe(false);
  });

  it('extracts correct yaw, pitch, roll from valid transformation matrix', () => {
    const t = tracker as any;
    
    // Create an identity matrix (no rotation)
    const identityMatrix = new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1
    ]);
    
    t.extractPose({ data: identityMatrix });
    expect(t.pose.hasMatrix).toBe(true);
    expect(t.pose.pitch).toBeCloseTo(0);
    expect(t.pose.yaw).toBeCloseTo(0);
    expect(t.pose.roll).toBeCloseTo(0);
  });

  it('fails gracefully on camera permission denied', async () => {
    global.navigator.mediaDevices.getUserMedia = vi.fn().mockRejectedValue({
      name: 'NotAllowedError', message: 'Permission denied'
    });
    
    await expect(tracker.start()).rejects.toThrow();
    const status = tracker.getStatus();
    expect(status.state).toBe('error');
    expect(status.message).toContain('permission denied');
  });

  it('releases camera tracks after stopping', async () => {
    const stopMock = vi.fn();
    global.navigator.mediaDevices.getUserMedia = vi.fn().mockResolvedValue({
      getTracks: () => [{ stop: stopMock }]
    });
    
    // Mock play
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    
    // Start then stop immediately
    const startPromise = tracker.start();
    // Simulate start resolving early or we can just stop
    await tracker.stop();
    
    // Wait for everything
    try { await startPromise; } catch {}
    await tracker.stop();
    
    expect(stopMock).toHaveBeenCalled();
    expect(tracker.getStatus().state).toBe('idle');
  });

  it('clears preview overlay when face is lost', () => {
    const t = tracker as any;
    
    // Mock canvas context
    const clearRectSpy = vi.fn();
    t.previewCanvas = {
      getContext: () => ({ clearRect: clearRectSpy }),
      width: 100, height: 100
    };
    
    t.clearOverlay();
    expect(clearRectSpy).toHaveBeenCalledWith(0, 0, 100, 100);
  });
});
