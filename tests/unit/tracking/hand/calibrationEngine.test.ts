import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CalibrationEngine } from '../../../../src/tracking/hand/calibration/calibrationEngine';
import { LANDMARK, NormalizedLandmark } from '../../../../src/tracking/hand/types';

function landmarks(x: number, y: number): NormalizedLandmark[] {
  return Array.from({ length: 21 }, (_, index) =>
    index === LANDMARK.INDEX_TIP ? { x, y, z: 0 } : { x: 0.5, y: 0.5, z: 0 },
  );
}

describe('CalibrationEngine', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reports sweep progress and produces calibrated bounds after a stable hand', () => {
    const engine = new CalibrationEngine();
    engine.start();
    for (let i = 0; i < 6; i++) engine.processFrame('Right', landmarks(0.5, 0.5));
    expect(engine.getState().phase).toBe('sweeping');

    for (const [x, y] of [
      [0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9], [0.5, 0.5],
      [0.1, 0.5], [0.9, 0.5], [0.5, 0.1], [0.5, 0.9], [0.4, 0.6],
    ] as const) {
      engine.processFrame('Right', landmarks(x, y));
    }
    vi.advanceTimersByTime(15_100);
    engine.processFrame('Right', landmarks(0.5, 0.5));

    expect(engine.getState().phase).toBe('complete');
    const bounds = engine.getResult()?.bounds;
    expect(bounds?.minX).toBeCloseTo(0.05);
    expect(bounds?.maxX).toBeCloseTo(0.95);
    expect(bounds?.minY).toBeCloseTo(0.05);
    expect(bounds?.maxY).toBeCloseTo(0.95);
  });

  it('returns usable default bounds when stopped before completion', () => {
    const engine = new CalibrationEngine();
    engine.start();
    const fallback = engine.cancel();
    expect(fallback.bounds.minX).toBeLessThan(fallback.bounds.maxX);
    expect(fallback.bounds.minY).toBeLessThan(fallback.bounds.maxY);
  });
});
