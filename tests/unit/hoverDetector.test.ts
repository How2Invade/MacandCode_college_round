/**
 * Unit tests for HoverDetector and HoverHighlighter.
 *
 * These are automated JSDOM tests. Manual browser verification on real sites
 * is described at the bottom of this file (comments).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HoverDetector } from '../../src/cursor/hoverDetector';
import { HoverHighlighter } from '../../src/cursor/hoverHighlighter';

// ─── HoverDetector ────────────────────────────────────────────────────────────

describe('HoverDetector', () => {
  let detector: HoverDetector;

  beforeEach(() => {
    document.body.innerHTML = '';
    detector = new HoverDetector();
    detector.start();
  });

  afterEach(() => {
    detector.stop();
    document.body.innerHTML = '';
  });

  // ── Target resolution ───────────────────────────────────────────────────────

  it('detects a link under the cursor', () => {
    const a = document.createElement('a');
    a.href = 'https://example.com';
    a.textContent = 'Hello';
    a.style.cssText = 'position:fixed;top:0;left:0;width:100px;height:30px';
    document.body.appendChild(a);

    vi.spyOn(document, 'elementFromPoint').mockReturnValue(a);
    const target = detector.update(50, 15);
    expect(target).toBe(a);
  });

  it('detects a button under the cursor', () => {
    const btn = document.createElement('button');
    btn.textContent = 'Click me';
    document.body.appendChild(btn);

    vi.spyOn(document, 'elementFromPoint').mockReturnValue(btn);
    const target = detector.update(50, 15);
    expect(target).toBe(btn);
  });

  it('detects text inputs', () => {
    const input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input);

    vi.spyOn(document, 'elementFromPoint').mockReturnValue(input);
    expect(detector.update(50, 15)).toBe(input);
  });

  it('detects select elements', () => {
    const sel = document.createElement('select');
    document.body.appendChild(sel);
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(sel);
    expect(detector.update(50, 15)).toBe(sel);
  });

  it('detects elements with role=button', () => {
    const div = document.createElement('div');
    div.setAttribute('role', 'button');
    document.body.appendChild(div);
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(div);
    expect(detector.update(50, 15)).toBe(div);
  });

  it('detects elements with positive tabindex', () => {
    const div = document.createElement('div');
    div.setAttribute('tabindex', '0');
    document.body.appendChild(div);
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(div);
    expect(detector.update(50, 15)).toBe(div);
  });

  it('resolves nested icon inside a link to the link', () => {
    const a = document.createElement('a');
    a.href = 'https://example.com';
    const icon = document.createElement('span');
    icon.textContent = '★';
    a.appendChild(icon);
    document.body.appendChild(a);

    // Hit is the span (the icon), not the anchor
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(icon);
    const target = detector.update(50, 15);
    // Should resolve to the anchor, not the span
    expect(target).toBe(a);
  });

  it('resolves nested span inside a button to the button', () => {
    const btn = document.createElement('button');
    const label = document.createElement('span');
    label.textContent = 'Save';
    btn.appendChild(label);
    document.body.appendChild(btn);

    vi.spyOn(document, 'elementFromPoint').mockReturnValue(label);
    expect(detector.update(50, 15)).toBe(btn);
  });

  it('returns null for non-interactive elements', () => {
    const p = document.createElement('p');
    p.textContent = 'Some text';
    document.body.appendChild(p);

    vi.spyOn(document, 'elementFromPoint').mockReturnValue(p);
    expect(detector.update(50, 15)).toBeNull();
  });

  it('does not treat an anchor without href as interactive', () => {
    const a = document.createElement('a');
    a.textContent = 'No href';
    // No href set
    document.body.appendChild(a);

    vi.spyOn(document, 'elementFromPoint').mockReturnValue(a);
    expect(detector.update(50, 15)).toBeNull();
  });

  it('does not treat a disabled input as interactive', () => {
    const input = document.createElement('input');
    input.type = 'text';
    input.disabled = true;
    document.body.appendChild(input);

    vi.spyOn(document, 'elementFromPoint').mockReturnValue(input);
    expect(detector.update(50, 15)).toBeNull();
  });

  // ── Target transitions ──────────────────────────────────────────────────────

  it('enters a target and changes to another correctly', () => {
    const a = document.createElement('a');
    a.href = 'https://a.com';
    document.body.appendChild(a);

    const btn = document.createElement('button');
    btn.textContent = 'B';
    document.body.appendChild(btn);

    const spy = vi.spyOn(document, 'elementFromPoint');

    spy.mockReturnValue(a);
    expect(detector.update(10, 10)).toBe(a);

    spy.mockReturnValue(btn);
    expect(detector.update(20, 20)).toBe(btn);

    expect(detector.getTarget()).toBe(btn);
  });

  it('clears target when cursor moves to non-interactive area', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    const p = document.createElement('p');
    document.body.appendChild(p);

    const spy = vi.spyOn(document, 'elementFromPoint');
    spy.mockReturnValue(btn);
    detector.update(50, 50);
    expect(detector.getTarget()).toBe(btn);

    spy.mockReturnValue(p);
    detector.update(200, 200);
    expect(detector.getTarget()).toBeNull();
  });

  // ── Synthetic events ────────────────────────────────────────────────────────

  it('dispatches mouseover when entering a target', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);

    const mouseoverSpy = vi.fn();
    btn.addEventListener('mouseover', mouseoverSpy);

    vi.spyOn(document, 'elementFromPoint').mockReturnValue(btn);
    detector.update(50, 50);

    expect(mouseoverSpy).toHaveBeenCalledOnce();
  });

  it('dispatches mouseout when leaving a target', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    const p = document.createElement('p');
    document.body.appendChild(p);

    const mouseoutSpy = vi.fn();
    btn.addEventListener('mouseout', mouseoutSpy);

    const spy = vi.spyOn(document, 'elementFromPoint');
    spy.mockReturnValue(btn);
    detector.update(50, 50);

    spy.mockReturnValue(p);
    detector.update(200, 200);

    expect(mouseoutSpy).toHaveBeenCalledOnce();
  });

  it('does not dispatch click events', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);

    const clickSpy = vi.fn();
    btn.addEventListener('click', clickSpy);

    vi.spyOn(document, 'elementFromPoint').mockReturnValue(btn);
    detector.update(50, 50);
    detector.update(50, 55);
    detector.update(50, 60);

    expect(clickSpy).not.toHaveBeenCalled();
  });

  // ── Stop / cleanup ──────────────────────────────────────────────────────────

  it('clears the target and stops detecting after stop()', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(btn);

    detector.update(50, 50);
    expect(detector.getTarget()).toBe(btn);

    detector.stop();
    expect(detector.getTarget()).toBeNull();

    // After stop, update should always return null
    const result = detector.update(50, 50);
    expect(result).toBeNull();
  });

  it('restarts cleanly after stop() + start()', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(btn);

    detector.update(50, 50);
    detector.stop();
    detector.start();

    const target = detector.update(50, 50);
    expect(target).toBe(btn);
  });
});

// ─── HoverHighlighter ─────────────────────────────────────────────────────────

describe('HoverHighlighter', () => {
  let highlighter: HoverHighlighter;

  beforeEach(() => {
    document.body.innerHTML = '';
    highlighter = new HoverHighlighter();
  });

  afterEach(() => {
    highlighter.destroy();
    document.body.innerHTML = '';
  });

  it('creates a highlight host in the document body', () => {
    const btn = document.createElement('button');
    btn.textContent = 'Test';
    document.body.appendChild(btn);

    highlighter.highlight(btn);
    expect(document.getElementById('handsfree-hover-host')).not.toBeNull();
  });

  it('does not create a duplicate host on multiple highlights', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);

    highlighter.highlight(btn);
    highlighter.highlight(btn);
    highlighter.highlight(btn);

    expect(document.querySelectorAll('#handsfree-hover-host').length).toBe(1);
  });

  it('highlight host has pointer-events:none', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    highlighter.highlight(btn);

    const host = document.getElementById('handsfree-hover-host') as HTMLDivElement;
    expect(host.style.pointerEvents).toBe('none');
  });

  it('removes the host element on destroy()', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    highlighter.highlight(btn);

    highlighter.destroy();
    expect(document.getElementById('handsfree-hover-host')).toBeNull();
  });

  it('clearHighlight does not throw when called before any highlight', () => {
    expect(() => highlighter.clearHighlight()).not.toThrow();
  });

  it('can highlight a different element after the first is removed from DOM', () => {
    const a = document.createElement('a');
    a.href = 'https://x.com';
    document.body.appendChild(a);

    highlighter.highlight(a);
    document.body.removeChild(a); // simulate DOM mutation

    const btn = document.createElement('button');
    document.body.appendChild(btn);

    // Should not throw
    expect(() => highlighter.highlight(btn)).not.toThrow();
  });

  it('overlay z-index is below the cursor host', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    highlighter.highlight(btn);

    const host = document.getElementById('handsfree-hover-host') as HTMLDivElement;
    const zIndex = parseInt(host.style.zIndex, 10);
    // Cursor host is 2147483647; highlight must be lower
    expect(zIndex).toBeLessThan(2147483647);
  });
});

/*
 * ─── Manual Browser Verification Notes ──────────────────────────────────────
 *
 * The following cannot be automated with JSDOM and must be verified in the
 * browser with the extension loaded.
 *
 * Site                  | Expected result
 * ─────────────────────────────────────────────────────────────────────────
 * Wikipedia article     | Links and headings with anchors highlight on hover.
 * Google Search results | Result links and "Tools" buttons highlight.
 * YouTube home          | Video thumbnails (role=link) and nav items highlight.
 * GitHub repo page      | File links, buttons (Fork, Star) highlight correctly.
 * MDN Web Docs          | Sidebar nav links and on-page links highlight.
 * Google.com (known)    | Cursor moves, but native :hover CSS may not fire.
 *                       | Extension highlight ring should still appear over the
 *                       | search box and buttons (input, button tags detected).
 *
 * In all cases:
 * - Moving off interactive elements clears the highlight ring.
 * - Scrolling the page updates the ring's position on the next rAF.
 * - Resizing the browser window updates the ring.
 * - No click events fire during cursor hover.
 * - The highlight ring never changes page layout (no scrollbars appear).
 */
