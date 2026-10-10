import { PointerPosition } from '../shared/types/tracking';
import { ICursorController } from './mockCursorController';
import { HoverDetector } from './hoverDetector';
import { HoverHighlighter } from './hoverHighlighter';

export class WebpageCursorController implements ICursorController {
  private isVisible = false;
  private container: HTMLDivElement | null = null;
  private cursorElement: HTMLDivElement | null = null;
  private shadowRoot: ShadowRoot | null = null;
  private animationFrameId: number | null = null;
  
  // Pending position to coalesce updates
  private pendingX: number | null = null;
  private pendingY: number | null = null;

  // Hover detection and highlighting
  private readonly hoverDetector = new HoverDetector();
  private readonly hoverHighlighter = new HoverHighlighter();

  constructor() {
    // Lazily initialize DOM when needed to prevent issues on early script injection
  }

  private initDOM() {
    if (this.container) return; // already initialized
    if (!document.body) return; // Wait until body is available
    
    // Create shadow host to protect styling
    this.container = document.createElement('div');
    this.container.id = 'handsfree-cursor-host';
    this.container.style.position = 'fixed';
    this.container.style.top = '0';
    this.container.style.left = '0';
    this.container.style.width = '100vw';
    this.container.style.height = '100vh';
    this.container.style.pointerEvents = 'none'; // pass-through clicks
    this.container.style.zIndex = '2147483647'; // max z-index
    this.container.style.display = 'none';

    this.shadowRoot = this.container.attachShadow({ mode: 'open' });

    // Create the actual cursor element
    this.cursorElement = document.createElement('div');
    this.cursorElement.style.position = 'absolute';
    this.cursorElement.style.width = '24px';
    this.cursorElement.style.height = '24px';
    this.cursorElement.style.borderRadius = '50%';
    this.cursorElement.style.backgroundColor = 'rgba(79, 70, 229, 0.8)'; // Indigo-600 with opacity
    this.cursorElement.style.border = '2px solid white';
    this.cursorElement.style.boxShadow = '0 2px 10px rgba(0,0,0,0.3)';
    // Center it on the coordinates
    this.cursorElement.style.transform = 'translate(-50%, -50%)';
    this.cursorElement.style.transition = 'transform 0.05s linear'; // slight smoothing
    
    this.shadowRoot.appendChild(this.cursorElement);
    document.body.appendChild(this.container);
    // DOM elements are automatically destroyed when the window unloads
  }

  private renderLoop = () => {
    if (this.pendingX !== null && this.pendingY !== null && this.cursorElement && this.isVisible) {
      const px = this.pendingX * window.innerWidth;
      const py = this.pendingY * window.innerHeight;
      this.cursorElement.style.left = `${px}px`;
      this.cursorElement.style.top = `${py}px`;

      // Update hover detection at the committed pixel coordinates
      const target = this.hoverDetector.update(px, py);
      if (target) {
        this.hoverHighlighter.highlight(target);
      } else {
        this.hoverHighlighter.clearHighlight();
      }

      this.pendingX = null;
      this.pendingY = null;
    }
    this.animationFrameId = requestAnimationFrame(this.renderLoop);
  };

  public moveTo(pos: PointerPosition): void {
    // Validate inputs
    if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return;
    
    if (!this.isVisible) {
      this.show();
    }
    
    this.pendingX = Math.max(0, Math.min(1, pos.x));
    this.pendingY = Math.max(0, Math.min(1, pos.y));
  }

  public triggerClickVisual(_type: 'left' | 'right' = 'left'): void {
    if (!this.cursorElement) return;
    // Simple pulse effect
    this.cursorElement.style.transform = 'translate(-50%, -50%) scale(0.7)';
    setTimeout(() => {
      if (this.cursorElement) {
        this.cursorElement.style.transform = 'translate(-50%, -50%) scale(1)';
      }
    }, 150);
  }

  public showDwellProgress(_progressPercent: number): void {
    // Stage 6 placeholder
  }

  public hide(): void {
    this.isVisible = false;
    if (this.container) {
      this.container.style.display = 'none';
    }
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    // Stop hover detection and clear the highlight ring
    this.hoverDetector.stop();
    this.hoverHighlighter.clearHighlight();
  }

  public show(): void {
    if (!this.container) this.initDOM();
    this.isVisible = true;
    if (this.container) {
      this.container.style.display = 'block';
    }
    if (this.animationFrameId === null) {
      this.animationFrameId = requestAnimationFrame(this.renderLoop);
    }
    this.hoverDetector.start();
  }

  public destroy(): void {
    this.hide();
    this.hoverHighlighter.destroy();
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    this.container = null;
    this.cursorElement = null;
    this.shadowRoot = null;
  }
}
