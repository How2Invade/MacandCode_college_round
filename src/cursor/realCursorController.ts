import { ICursorController } from './mockCursorController';
import { PointerPosition } from '../shared/types/tracking';

export class RealCursorController implements ICursorController {
  public readonly isMock = false;
  private isVisible = false;
  private currentPos: PointerPosition = { x: 0.5, y: 0.5, confidence: 1, timestamp: Date.now() };
  private cursorElement: HTMLDivElement | null = null;
  private styleElement: HTMLStyleElement | null = null;

  constructor() {
    this.injectStyles();
    this.createCursor();
  }

  private injectStyles() {
    if (document.getElementById('handsfree-cursor-styles')) return;
    this.styleElement = document.createElement('style');
    this.styleElement.id = 'handsfree-cursor-styles';
    this.styleElement.textContent = `
      #handsfree-cursor {
        position: fixed !important;
        width: 32px !important;
        height: 32px !important;
        background-color: rgba(16, 185, 129, 0.8) !important;
        border: 2px solid white !important;
        border-radius: 50% !important;
        pointer-events: none !important;
        z-index: 2147483647 !important;
        transform: translate(-50%, -50%) !important;
        transition: transform 0.05s linear !important;
        box-shadow: 0 4px 6px rgba(0,0,0,0.2) !important;
      }
      #handsfree-cursor.clicking {
        transform: translate(-50%, -50%) scale(0.8) !important;
        background-color: rgba(239, 68, 68, 0.9) !important;
      }
      #handsfree-cursor.right-clicking {
        background-color: rgba(59, 130, 246, 0.9) !important;
      }
    `;
    if (document.head) document.head.appendChild(this.styleElement);
    else document.documentElement.appendChild(this.styleElement);
  }

  private createCursor() {
    const existing = document.getElementById('handsfree-cursor') as HTMLDivElement;
    if (existing) {
      this.cursorElement = existing;
      return;
    }
    this.cursorElement = document.createElement('div');
    this.cursorElement.id = 'handsfree-cursor';
    
    // Apply robust inline styles directly to avoid CSP or conflicting CSS issues
    this.cursorElement.style.setProperty('position', 'fixed', 'important');
    this.cursorElement.style.setProperty('top', '0px', 'important');
    this.cursorElement.style.setProperty('left', '0px', 'important');
    this.cursorElement.style.setProperty('width', '32px', 'important');
    this.cursorElement.style.setProperty('height', '32px', 'important');
    this.cursorElement.style.setProperty('background-color', 'rgba(16, 185, 129, 0.8)', 'important');
    this.cursorElement.style.setProperty('border', '2px solid white', 'important');
    this.cursorElement.style.setProperty('border-radius', '50%', 'important');
    this.cursorElement.style.setProperty('pointer-events', 'none', 'important');
    this.cursorElement.style.setProperty('z-index', '2147483647', 'important');
    this.cursorElement.style.setProperty('transform', 'translate(-50%, -50%)', 'important');
    this.cursorElement.style.setProperty('display', 'none', 'important');
    
    const targetNode = document.body || document.documentElement;
    if (targetNode) targetNode.appendChild(this.cursorElement);
  }

  public moveTo(pos: PointerPosition): void {
    if (!this.cursorElement && (document.body || document.documentElement)) {
      this.createCursor();
    }
    
    const isStale = Math.min(Math.abs(Date.now() - pos.timestamp), Math.abs(performance.now() - pos.timestamp)) > 500;
    const isLowConfidence = pos.confidence < 0.5;

    if (isStale || isLowConfidence) {
      this.hide();
      return;
    }

    this.currentPos = { ...pos };
    if (!this.isVisible) this.show();
    
    if (this.cursorElement) {
      // Map normalized coordinates (0-1) to viewport dimensions
      const x = Math.max(0, Math.min(pos.x, 1)) * window.innerWidth;
      const y = Math.max(0, Math.min(pos.y, 1)) * window.innerHeight;
      this.cursorElement.style.setProperty('left', `${x}px`, 'important');
      this.cursorElement.style.setProperty('top', `${y}px`, 'important');
    }
  }

  public triggerClickVisual(button: 'left' | 'right' = 'left'): void {
    if (this.cursorElement) {
      const isRight = button === 'right';
      this.cursorElement.style.setProperty('transform', 'translate(-50%, -50%) scale(0.8)', 'important');
      this.cursorElement.style.setProperty('background-color', isRight ? 'rgba(59, 130, 246, 0.9)' : 'rgba(239, 68, 68, 0.9)', 'important');
      
      setTimeout(() => {
        if (this.cursorElement) {
          this.cursorElement.style.setProperty('transform', 'translate(-50%, -50%)', 'important');
          this.cursorElement.style.setProperty('background-color', 'rgba(16, 185, 129, 0.8)', 'important');
        }
      }, 150);
    }
  }

  public showDwellProgress(progressPercent: number): void {
    if (this.cursorElement) {
      this.cursorElement.style.opacity = `${0.5 + (progressPercent / 200)}`;
    }
  }

  public hide(): void {
    this.isVisible = false;
    if (this.cursorElement) {
      this.cursorElement.style.setProperty('display', 'none', 'important');
      this.cursorElement.classList.remove('active');
    }
  }

  public show(): void {
    this.isVisible = true;
    if (this.cursorElement) {
      this.cursorElement.style.setProperty('display', 'block', 'important');
      this.cursorElement.classList.add('active');
    }
  }

  public getPosition(): PointerPosition {
    return { ...this.currentPos };
  }

  public getVisibility(): boolean {
    if (!this.cursorElement) return false;
    
    // Ensure it's in the DOM
    const targetNode = document.body || document.documentElement;
    if (!targetNode || !targetNode.contains(this.cursorElement)) return false;
    
    // Ensure computed styles show it as visible
    const style = window.getComputedStyle(this.cursorElement);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    
    // Ensure it has dimensions
    const rect = this.cursorElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;

    return this.isVisible;
  }

  public getDiagnostics(): Record<string, any> {
    if (!this.cursorElement) return { exists: false };
    
    const targetNode = document.body || document.documentElement;
    const inDOM = targetNode ? targetNode.contains(this.cursorElement) : false;
    const style = window.getComputedStyle(this.cursorElement);
    const rect = this.cursorElement.getBoundingClientRect();
    
    return {
      exists: true,
      inDOM,
      targetNode: targetNode?.tagName,
      computedDisplay: style.display,
      computedVisibility: style.visibility,
      computedZIndex: style.zIndex,
      opacity: style.opacity,
      width: rect.width,
      height: rect.height,
      left: rect.left,
      top: rect.top,
      isVisibleFlag: this.isVisible
    };
  }

  public cleanup(): void {
    if (this.cursorElement) {
      this.cursorElement.remove();
    }
    if (this.styleElement) {
      this.styleElement.remove();
    }
  }
}
