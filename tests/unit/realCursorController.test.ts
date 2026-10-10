import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RealCursorController } from '../../src/cursor/realCursorController';

describe('RealCursorController', () => {
  let controller: RealCursorController;

  beforeEach(() => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    
    // JSDOM does not support layout computation, so mock them
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element: any) => {
      return {
        display: element.style.display || 'block',
        visibility: element.style.visibility || 'visible',
        opacity: element.style.opacity || '1',
        zIndex: element.style.zIndex || '2147483647'
      } as CSSStyleDeclaration;
    });
    
    Element.prototype.getBoundingClientRect = vi.fn().mockReturnValue({
      width: 32,
      height: 32,
      top: 0,
      left: 0,
      bottom: 32,
      right: 32,
      x: 0,
      y: 0,
    });

    vi.useFakeTimers();
  });

  afterEach(() => {
    if (controller) {
      controller.cleanup();
    }
    vi.useRealTimers();
  });

  it('should create and cleanup DOM elements', () => {
    controller = new RealCursorController();
    expect(document.getElementById('handsfree-cursor')).not.toBeNull();
    expect(document.getElementById('handsfree-cursor-styles')).not.toBeNull();

    controller.cleanup();
    expect(document.getElementById('handsfree-cursor')).toBeNull();
    expect(document.getElementById('handsfree-cursor-styles')).toBeNull();
  });

  it('should map normalized coordinates to viewport dimensions', () => {
    Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    
    controller = new RealCursorController();
    
    // Valid mapping
    controller.moveTo({ x: 0.25, y: 0.5, confidence: 0.9, timestamp: Date.now() });
    
    const cursor = document.getElementById('handsfree-cursor')!;
    expect(cursor.style.left).toBe('250px');
    expect(cursor.style.top).toBe('400px');
    
    // Bounds clamping (should not map beyond 100% or below 0)
    controller.moveTo({ x: 1.5, y: -0.5, confidence: 0.9, timestamp: Date.now() });
    expect(cursor.style.left).toBe('1000px');
    expect(cursor.style.top).toBe('0px');
  });

  it('should filter low confidence tracking data', () => {
    controller = new RealCursorController();
    
    // Initial valid state
    controller.moveTo({ x: 0.5, y: 0.5, confidence: 0.9, timestamp: Date.now() });
    expect(controller.getVisibility()).toBe(true);
    
    // Low confidence should hide
    controller.moveTo({ x: 0.5, y: 0.5, confidence: 0.4, timestamp: Date.now() });
    expect(controller.getVisibility()).toBe(false);
  });

  it('should filter stale tracking data', () => {
    controller = new RealCursorController();
    
    const now = Date.now();
    
    // Initial valid state
    controller.moveTo({ x: 0.5, y: 0.5, confidence: 0.9, timestamp: now });
    expect(controller.getVisibility()).toBe(true);
    
    // Stale timestamp (>500ms old)
    controller.moveTo({ x: 0.5, y: 0.5, confidence: 0.9, timestamp: now - 600 });
    expect(controller.getVisibility()).toBe(false);
  });
});
