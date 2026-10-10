import { describe, it, expect, beforeEach } from 'vitest';
import { OneEuroFilter } from '../../src/shared/utils/oneEuroFilter';

describe('OneEuroFilter', () => {
  let filter: OneEuroFilter;

  beforeEach(() => {
    // defaults matching Tracky Mouse usage: freq=60, mincutoff=1 (or 0.01), beta=0 (or 5.0), dcutoff=1 (or 0.7)
    // we'll test standard values
    filter = new OneEuroFilter(60, 1.0, 0.0, 1.0);
  });

  it('should initialize and return the first value unaltered', () => {
    const val = filter.filter(10);
    expect(val).toBe(10);
  });

  it('should handle stationary noisy signals by smoothing them', () => {
    filter = new OneEuroFilter(60, 0.01, 0.0, 1.0); // low mincutoff to smooth heavily
    filter.filter(10, 0);
    // apply noise around 10
    let lastFiltered = 10;
    for (let i = 1; i <= 10; i++) {
      const noisyVal = 10 + (Math.random() - 0.5); // +/- 0.5 noise
      lastFiltered = filter.filter(noisyVal, i * 16.6); // roughly 60fps
    }
    // Filtered value should be very close to 10 despite the +/- 0.5 noise
    expect(Math.abs(lastFiltered - 10)).toBeLessThan(0.4);
  });

  it('should respond to rapid movement by increasing cutoff (reducing lag)', () => {
    filter = new OneEuroFilter(60, 0.01, 5.0, 1.0); // high beta allows responsiveness
    filter.filter(10, 0);
    
    // Rapid jump to 100
    const val = filter.filter(100, 16.6);
    // Should adapt quickly and jump closer to 100 than a simple low-pass would
    expect(val).toBeGreaterThan(50);
  });

  it('should handle variable timestamps correctly', () => {
    filter = new OneEuroFilter(60, 1.0, 0.0, 1.0);
    filter.filter(0, 0);
    
    // Test that the internal frequency updates based on delta time
    filter.filter(10, 100); // 100ms delta (10Hz)
    // We can't directly read internal freq without spying, but we can verify it doesn't crash
    // and produces a smoothed output.
    expect(filter.filter(20, 150)).toBeGreaterThan(0);
  });

  it('should reset behavior correctly', () => {
    filter.filter(10, 0);
    filter.filter(20, 16);
    expect(filter['x']['initialized']).toBe(true);
    
    filter.reset();
    
    expect(filter['x']['initialized']).toBe(false);
    expect(filter.filter(50, 0)).toBe(50); // First value after reset is unaltered
  });

  it('should handle missing or undefined timestamps gracefully', () => {
    filter.filter(10); // no timestamp
    const val2 = filter.filter(20);
    expect(val2).not.toBeNaN();
    expect(val2).toBeGreaterThan(10);
    expect(val2).toBeLessThanOrEqual(20);
  });
});
