import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebpageCursorController } from '../../src/cursor/webpageCursorController';

describe('WebpageCursorController', () => {
  let cursor: WebpageCursorController;

  beforeEach(() => {
    // Clean up DOM before each test
    document.body.innerHTML = '';
    vi.useFakeTimers();
    // Mock window innerWidth/Height
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1000 });
    Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: 800 });
    cursor = new WebpageCursorController();
  });

  afterEach(() => {
    cursor.destroy();
    vi.useRealTimers();
  });

  it('creates exactly one visible cursor container in the body', () => {
    const containers = document.querySelectorAll('#handsfree-cursor-host');
    expect(containers.length).toBe(1);
    
    // Attempting to show again should not create duplicates
    cursor.show();
    cursor.show();
    const containersAfter = document.querySelectorAll('#handsfree-cursor-host');
    expect(containersAfter.length).toBe(1);
  });

  it('hides and shows the cursor correctly', () => {
    const container = document.getElementById('handsfree-cursor-host');
    expect(container).not.toBeNull();
    
    // Initially hidden
    expect(container!.style.display).toBe('none');
    
    cursor.show();
    expect(container!.style.display).toBe('block');
    
    cursor.hide();
    expect(container!.style.display).toBe('none');
  });

  it('maps normalized coordinates to the window viewport', () => {
    cursor.show();
    
    // Valid coordinates
    cursor.moveTo({ x: 0.25, y: 0.75, confidence: 1, timestamp: Date.now() });
    
    // Advance by 1 frame
    vi.advanceTimersByTime(16);
    
    const shadowRoot = document.getElementById('handsfree-cursor-host')!.shadowRoot;
    const cursorEl = shadowRoot!.querySelector('div');
    expect(cursorEl).not.toBeNull();
    
    // 1000 * 0.25 = 250, 800 * 0.75 = 600
    expect(cursorEl!.style.left).toBe('250px');
    expect(cursorEl!.style.top).toBe('600px');
  });

  it('clamps invalid or out-of-bounds coordinates', () => {
    cursor.show();
    
    // Out of bounds coordinates (e.g. x=1.5, y=-0.5)
    cursor.moveTo({ x: 1.5, y: -0.5, confidence: 1, timestamp: Date.now() });
    vi.advanceTimersByTime(16);
    
    const shadowRoot = document.getElementById('handsfree-cursor-host')!.shadowRoot;
    const cursorEl = shadowRoot!.querySelector('div');
    
    // Clamped to 1.0 (1000px) and 0.0 (0px)
    expect(cursorEl!.style.left).toBe('1000px');
    expect(cursorEl!.style.top).toBe('0px');
  });

  it('ignores NaN or non-finite coordinates', () => {
    cursor.show();
    
    cursor.moveTo({ x: 0.5, y: 0.5, confidence: 1, timestamp: Date.now() });
    vi.advanceTimersByTime(16);
    
    const shadowRoot = document.getElementById('handsfree-cursor-host')!.shadowRoot;
    const cursorEl = shadowRoot!.querySelector('div');
    expect(cursorEl!.style.left).toBe('500px');
    
    // Send NaN
    cursor.moveTo({ x: NaN, y: 0.5, confidence: 1, timestamp: Date.now() });
    vi.advanceTimersByTime(16);
    
    // Should remain unchanged
    expect(cursorEl!.style.left).toBe('500px');
  });

  it('destroys and cleans up resources completely', () => {
    cursor.show();
    cursor.destroy();
    
    const container = document.getElementById('handsfree-cursor-host');
    expect(container).toBeNull();
  });
});
