/**
 * HoverDetector
 *
 * Given viewport coordinates (px), identifies the nearest interactive element
 * beneath the virtual cursor and dispatches synthetic pointer/mouse events to
 * approximate browser hover behaviour.
 *
 * Key design decisions:
 * - Uses document.elementFromPoint; the cursor overlay must keep pointer-events:none.
 * - Walks up the DOM tree from the hit-tested element to find the appropriate
 *   interactive ancestor (link, button, input, etc.).
 * - Does NOT dispatch click, pointerdown, or pointerup events.
 * - Synthetic events cannot activate the browser's native CSS :hover rule, but
 *   they do fire mouseover/mouseenter handlers registered in JavaScript (e.g.
 *   dropdown menus written with addEventListener).
 * - Tracks enter/leave transitions and dispatches events only when the target
 *   changes, preventing event floods.
 */

/** Interactive ARIA roles that indicate a clickable element. */
const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'radio',
  'checkbox',
  'combobox',
  'listbox',
  'switch',
  'tab',
  'textbox',
  'searchbox',
  'spinbutton',
  'slider',
  'treeitem',
]);

/** Tag names that are inherently interactive without any attribute. */
const INTERACTIVE_TAGS = new Set([
  'A',
  'BUTTON',
  'INPUT',
  'SELECT',
  'TEXTAREA',
  'LABEL',
  'SUMMARY', // <details><summary>
  'VIDEO',
  'AUDIO',
]);

/**
 * Determines whether an element is interactive.
 * Returns true for known interactive tags and roles, elements with an
 * explicit tabindex, onclick attributes, or cursor:pointer CSS.
 */
function isInteractive(el: Element): boolean {
  if (INTERACTIVE_TAGS.has(el.tagName)) {
    // Anchors require href to be truly interactive (non-href anchors are not navigable)
    if (el.tagName === 'A') return (el as HTMLAnchorElement).href !== '';
    // Disabled form elements are skipped
    if ((el as HTMLInputElement).disabled) return false;
    return true;
  }

  const role = el.getAttribute('role');
  if (role && INTERACTIVE_ROLES.has(role.toLowerCase())) return true;

  // Explicit positive tabindex — author declared it as focusable/interactive
  const tabIndex = el.getAttribute('tabindex');
  if (tabIndex !== null && parseInt(tabIndex, 10) >= 0) return true;

  // Legacy onclick/onfocus attributes
  if (el.hasAttribute('onclick') || el.hasAttribute('onfocus')) return true;

  // CSS cursor:pointer is a common author signal that an element is clickable.
  // We check the computed style for this as a last resort.
  try {
    const style = window.getComputedStyle(el);
    if (style.cursor === 'pointer') return true;
  } catch {
    // getComputedStyle can throw in some edge cases; ignore.
  }

  return false;
}

/**
 * Walks up the DOM from `el` looking for the nearest interactive ancestor
 * (inclusive). Returns null if nothing interactive is found within `maxDepth`
 * levels.
 */
function resolveInteractiveTarget(el: Element | null, maxDepth = 8): Element | null {
  let node: Element | null = el;
  let depth = 0;
  while (node && node !== document.body && depth < maxDepth) {
    if (isInteractive(node)) return node;
    node = node.parentElement;
    depth++;
  }
  return null;
}

export class HoverDetector {
  /** The currently hovered interactive element, or null. */
  private currentTarget: Element | null = null;

  /** Whether hover detection is running. */
  private active = false;

  /**
   * Call once per frame with the current cursor viewport position in pixels.
   * Returns the resolved interactive element (or null) and handles all event
   * dispatching internally.
   */
  public update(viewportX: number, viewportY: number): Element | null {
    if (!this.active) return null;

    // Hit-test the page. The cursor overlay has pointer-events:none so it is
    // transparent to this call.
    // Guard: elementFromPoint may not exist in all environments (e.g. JSDOM).
    if (typeof document.elementFromPoint !== 'function') return null;
    const hit = document.elementFromPoint(viewportX, viewportY);
    const target = resolveInteractiveTarget(hit);

    if (target !== this.currentTarget) {
      const prev = this.currentTarget;
      this.currentTarget = target;

      // Dispatch leave events on the previous target
      if (prev && prev.isConnected) {
        this.dispatchLeave(prev, viewportX, viewportY);
      }

      // Dispatch enter events on the new target
      if (target && target.isConnected) {
        this.dispatchEnter(target, viewportX, viewportY);
      }
    } else if (target && target.isConnected) {
      // Target unchanged — emit only a move event (throttled by the caller's rAF)
      this.dispatchMove(target, viewportX, viewportY);
    }

    return this.currentTarget;
  }

  /** Call when tracking starts. */
  public start(): void {
    this.active = true;
  }

  /** Call when tracking stops or the cursor is hidden. Clears the hover state. */
  public stop(): void {
    this.active = false;
    if (this.currentTarget && this.currentTarget.isConnected) {
      this.dispatchLeave(this.currentTarget, -1, -1);
    }
    this.currentTarget = null;
  }

  /** Returns the currently hovered target for external inspection. */
  public getTarget(): Element | null {
    return this.currentTarget;
  }

  // ─── Synthetic event helpers ──────────────────────────────────────────────

  private makePointerInit(x: number, y: number): PointerEventInit {
    return {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: x,
      clientY: y,
      screenX: x,
      screenY: y,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      buttons: 0,
    };
  }

  private makeMouseInit(x: number, y: number): MouseEventInit {
    return {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: x,
      clientY: y,
      screenX: x,
      screenY: y,
      buttons: 0,
    };
  }

  private dispatchEnter(el: Element, x: number, y: number): void {
    // pointerover / pointerenter
    el.dispatchEvent(new PointerEvent('pointerover', this.makePointerInit(x, y)));
    el.dispatchEvent(new PointerEvent('pointerenter', { ...this.makePointerInit(x, y), bubbles: false }));
    // mouseover / mouseenter
    el.dispatchEvent(new MouseEvent('mouseover', this.makeMouseInit(x, y)));
    el.dispatchEvent(new MouseEvent('mouseenter', { ...this.makeMouseInit(x, y), bubbles: false }));
    // Initial move
    el.dispatchEvent(new PointerEvent('pointermove', this.makePointerInit(x, y)));
    el.dispatchEvent(new MouseEvent('mousemove', this.makeMouseInit(x, y)));
  }

  private dispatchLeave(el: Element, x: number, y: number): void {
    el.dispatchEvent(new PointerEvent('pointerout', this.makePointerInit(x, y)));
    el.dispatchEvent(new PointerEvent('pointerleave', { ...this.makePointerInit(x, y), bubbles: false }));
    el.dispatchEvent(new MouseEvent('mouseout', this.makeMouseInit(x, y)));
    el.dispatchEvent(new MouseEvent('mouseleave', { ...this.makeMouseInit(x, y), bubbles: false }));
  }

  private dispatchMove(el: Element, x: number, y: number): void {
    el.dispatchEvent(new PointerEvent('pointermove', this.makePointerInit(x, y)));
    el.dispatchEvent(new MouseEvent('mousemove', this.makeMouseInit(x, y)));
  }
}
