/**
 * HoverHighlighter
 *
 * Renders a visible highlight ring around the currently hovered interactive
 * element using a separate, extension-owned DOM overlay.
 *
 * Design constraints met:
 * - Hosted in its own shadow DOM to avoid style conflicts.
 * - The overlay and highlight are both pointer-events:none — they never
 *   intercept page clicks.
 * - position:fixed + translate3d — no layout shift, no scrollbars.
 * - Uses ResizeObserver + IntersectionObserver to update geometry when the
 *   page changes without any polling.
 * - Cleans up all observers and DOM nodes on destroy().
 */

export class HoverHighlighter {
  private container: HTMLDivElement | null = null;
  private highlightEl: HTMLDivElement | null = null;
  private shadowRoot: ShadowRoot | null = null;

  private currentTarget: Element | null = null;

  private resizeObserver: ResizeObserver | null = null;
  private mutationObserver: MutationObserver | null = null;

  /** Whether the highlighter has been initialised. */
  private initialized = false;

  private initDOM(): void {
    if (this.initialized) return;
    if (!document.body) return;
    this.initialized = true;

    this.container = document.createElement('div');
    this.container.id = 'handsfree-hover-host';
    this.container.style.cssText = [
      'position:fixed',
      'top:0',
      'left:0',
      'width:0',
      'height:0',
      'pointer-events:none',
      `z-index:2147483646`, // one below the cursor (2147483647)
      'overflow:visible',
    ].join(';');

    this.shadowRoot = this.container.attachShadow({ mode: 'open' });

    // The highlight ring itself
    this.highlightEl = document.createElement('div');
    this.highlightEl.style.cssText = [
      'position:fixed',
      'box-sizing:border-box',
      'pointer-events:none',
      'border:2px solid rgba(139, 92, 246, 0.85)', // violet-500
      'border-radius:4px',
      'background:rgba(139, 92, 246, 0.12)',
      'box-shadow:0 0 0 3px rgba(139, 92, 246, 0.25), inset 0 0 0 1px rgba(255,255,255,0.1)',
      'transition:opacity 0.12s ease, top 0.05s linear, left 0.05s linear, width 0.05s linear, height 0.05s linear, border-radius 0.08s ease',
      'opacity:0',
      'top:0',
      'left:0',
      'width:0',
      'height:0',
    ].join(';');

    this.shadowRoot.appendChild(this.highlightEl);
    document.body.appendChild(this.container);

    // Watch for target geometry changes (resize, re-layout)
    this.resizeObserver = new ResizeObserver(() => {
      if (this.currentTarget) this.updateGeometry(this.currentTarget);
    });

    // Watch for target removal from DOM
    this.mutationObserver = new MutationObserver(() => {
      if (this.currentTarget && !this.currentTarget.isConnected) {
        this.clearHighlight();
      }
    });
    this.mutationObserver.observe(document.body, { childList: true, subtree: true });
  }

  /** Highlight the given element. */
  public highlight(target: Element): void {
    this.initDOM();
    if (!this.highlightEl) return;

    if (this.currentTarget !== target) {
      // Stop observing the previous target
      if (this.currentTarget && this.resizeObserver) {
        this.resizeObserver.unobserve(this.currentTarget);
      }
      this.currentTarget = target;
      if (this.resizeObserver) {
        this.resizeObserver.observe(target);
      }
    }

    this.updateGeometry(target);
    this.highlightEl.style.opacity = '1';
  }

  /** Remove the highlight. */
  public clearHighlight(): void {
    if (this.currentTarget && this.resizeObserver) {
      this.resizeObserver.unobserve(this.currentTarget);
    }
    this.currentTarget = null;
    if (this.highlightEl) {
      this.highlightEl.style.opacity = '0';
    }
  }

  /** Destroy the highlighter completely and release all resources. */
  public destroy(): void {
    this.clearHighlight();
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    this.container = null;
    this.highlightEl = null;
    this.shadowRoot = null;
    this.initialized = false;
  }

  private updateGeometry(target: Element): void {
    if (!this.highlightEl) return;
    const rect = target.getBoundingClientRect();

    // Nothing visible — skip
    if (rect.width === 0 && rect.height === 0) return;

    // Read element border-radius to mirror it on the highlight
    let radius = '4px';
    try {
      const cs = window.getComputedStyle(target);
      const br = cs.borderRadius;
      // Only apply if a non-trivial radius is present
      if (br && br !== '0px') radius = br;
    } catch {
      // ignore
    }

    const PAD = 3; // extra padding around the element in px
    this.highlightEl.style.top = `${rect.top - PAD}px`;
    this.highlightEl.style.left = `${rect.left - PAD}px`;
    this.highlightEl.style.width = `${rect.width + PAD * 2}px`;
    this.highlightEl.style.height = `${rect.height + PAD * 2}px`;
    this.highlightEl.style.borderRadius = radius;
  }
}
