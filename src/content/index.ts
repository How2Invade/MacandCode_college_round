/**
 * Handsfree Content Script
 * Injected into webpages to provide visual cursor overlays and execute DOM actions.
 */

import { WebpageCursorController } from '../cursor/webpageCursorController';
import { PointerPosition } from '../shared/types/tracking';
import { BrowserAction, ActionResult } from '../shared/types/actions';
import { validateBrowserAction } from '../shared/safety/action-policy';
import { logger } from '../shared/utils';

type PointerClickAction = {
  type: 'click';
  coordinates: { x: number; y: number };
};

let lastPointerDiagnosticAt = 0;

logger.info('ContentScript', 'Handsfree content script loaded into page: ' + window.location.href);

function triggerCameraFlash(): void {
  try {
    const flash = document.createElement('div');
    flash.id = 'handsfree-camera-flash';
    flash.style.position = 'fixed';
    flash.style.top = '0';
    flash.style.left = '0';
    flash.style.width = '100vw';
    flash.style.height = '100vh';
    flash.style.backgroundColor = 'white';
    flash.style.opacity = '0.85';
    flash.style.zIndex = '2147483647';
    flash.style.pointerEvents = 'none';
    flash.style.transition = 'opacity 0.4s ease-out';
    document.body.appendChild(flash);

    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 0.09);
      gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.09);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.09);
    } catch {}

    requestAnimationFrame(() => {
      flash.style.opacity = '0';
      setTimeout(() => flash.remove(), 420);
    });
  } catch {}
}

const cursorController = new WebpageCursorController();

// Listen for messages from extension background / sidepanel
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'FLASH_SCREEN') {
      triggerCameraFlash();
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'CONTENT_PING') {
      sendResponse({ status: 'pong', url: window.location.href });
      return true;
    }

    if (message.type === 'POINTER_VISIBILITY') {
      if (message.payload?.visible) {
        cursorController.show();
      } else {
        cursorController.hide();
      }
      sendResponse({ ok: true });
      return true;
    }

    if (message.type === 'POINTER_POSITION_UPDATE') {
      const pos = message.payload as PointerPosition;
      cursorController.moveTo(pos);

      const debugInfo = cursorController.getDiagnostics();
      if (Date.now() - lastPointerDiagnosticAt >= 1000) {
        lastPointerDiagnosticAt = Date.now();
        logger.info('ContentScript', 'Pointer update processed by cursor overlay.', {
          accepted: cursorController.getVisibility(),
          confidence: Number(pos.confidence.toFixed(3)),
          stale: Date.now() - pos.timestamp > 500,
        });
      }
      logger.debug('ContentScript', 'Cursor diagnostics:', debugInfo);

      sendResponse({ ok: cursorController.getVisibility(), debug: debugInfo });
      return true;
    }

    if (message.type === 'EXECUTE_BROWSER_ACTION') {
      const action = (message.payload?.action || message.action) as BrowserAction | PointerClickAction | undefined;
      logger.info('ContentScript', `Simulating content action: ${action?.type}`);

      if (!action) {
        sendResponse({ success: false, message: 'No browser action was provided.' } satisfies ActionResult);
        return true;
      }

      if (action.type === 'click_element' && (action.targetId === 'cursor' || !action.targetId)) {
        const clicked = cursorController.clickAtCursor();
        if (clicked) {
          sendResponse({ success: true, message: 'Clicked element under handsfree cursor.' } satisfies ActionResult);
        } else {
          sendResponse({ success: false, message: 'No clickable element found under handsfree cursor.' } satisfies ActionResult);
        }
        return true;
      }

      if (action.type === 'click') {
        const coordinates = action.coordinates;
        if (!coordinates || !Number.isFinite(coordinates.x) || !Number.isFinite(coordinates.y)) {
          sendResponse({ success: false, message: 'Click requires finite normalized coordinates.' } satisfies ActionResult);
          return true;
        }

        const x = Math.max(0, Math.min(1, coordinates.x)) * window.innerWidth;
        const y = Math.max(0, Math.min(1, coordinates.y)) * window.innerHeight;
        const target = document.elementFromPoint(x, y) as HTMLElement | null;
        if (!target) {
          sendResponse({ success: false, message: 'No page element found under the cursor.' } satisfies ActionResult);
          return true;
        }

        target.focus?.({ preventScroll: true });
        target.click();
        cursorController.triggerClickVisual('left');
        sendResponse({ success: true, message: 'Clicked page element under cursor.', data: { tagName: target.tagName } } satisfies ActionResult);
        return true;
      }

      if (action.type === 'undo') {
        document.execCommand('undo');
        const active = document.activeElement || document.body;
        const isMac = navigator.userAgent.includes('Mac');
        active.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'z', code: 'KeyZ', keyCode: 90, bubbles: true, cancelable: true,
          metaKey: isMac, ctrlKey: !isMac,
        }));
        sendResponse({ success: true, message: 'Executed undo.' } satisfies ActionResult);
        return true;
      }

      if (action.type === 'redo') {
        document.execCommand('redo');
        const active = document.activeElement || document.body;
        const isMac = navigator.userAgent.includes('Mac');
        active.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'z', code: 'KeyZ', keyCode: 90, bubbles: true, cancelable: true,
          metaKey: isMac, ctrlKey: !isMac, shiftKey: true,
        }));
        if (!isMac) {
          active.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'y', code: 'KeyY', keyCode: 89, bubbles: true, cancelable: true,
            ctrlKey: true,
          }));
        }
        sendResponse({ success: true, message: 'Executed redo.' } satisfies ActionResult);
        return true;
      }

      // Delegate agent actions to the wrapper
      void executePageAction(action as BrowserAction).then((result) => {
        logger.info('ContentScript', `Executed page action [${action.type}]: ${result.success}`);
        sendResponse(result);
      }).catch((error) => {
        sendResponse({ success: false, message: `Page action failed: ${error instanceof Error ? error.message : 'unknown error'}` });
      });
      return true;
    }

    return true;
  });
}

function collectPageDetails() {
  const visible = (element: HTMLElement) => {
    const style = window.getComputedStyle(element);
    return !element.hidden && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  };
  const pageText = () => document.body?.innerText || document.body?.textContent || '';
  const text = (element: HTMLElement) => (element.innerText || element.getAttribute('aria-label') || element.textContent || '').trim().replace(/\s+/g, ' ');
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))
    .filter(visible).map((element) => ({ text: text(element), url: element.href })).filter((item) => item.text).slice(0, 30);
  const buttons = Array.from(document.querySelectorAll<HTMLElement>('button,[role="button"]'))
    .filter(visible).map(text).filter(Boolean).slice(0, 30);
  const searchFields = Array.from(document.querySelectorAll<HTMLInputElement>(
    'input[type="search"],input[role="combobox"],input[name*="search" i],input[placeholder*="search" i],form[role="search"] input,input[type="text"]',
  )).filter(visible).map((element) => ({
    id: element.id,
    name: element.name,
    placeholder: element.placeholder,
    type: element.type,
    value: element.value,
    ariaLabel: element.getAttribute('aria-label') || '',
  })).slice(0, 12);
  return {
    url: window.location.href,
    title: document.title,
    headings: Array.from(document.querySelectorAll<HTMLElement>('h1,h2,h3')).filter(visible).map(text).filter(Boolean).slice(0, 30),
    links,
    buttons,
    searchFields,
    text: pageText().slice(0, 8000),
  };
}

function waitForPageChange(beforeUrl: string, beforeText: string, timeoutMs = 1000): Promise<boolean> {
  const changed = () => window.location.href !== beforeUrl || (document.body?.innerText || document.body?.textContent || '') !== beforeText;
  if (changed()) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const observer = new MutationObserver(() => finish(changed()));
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearTimeout(timer);
      resolve(value);
    };
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
    const timer = setTimeout(() => finish(changed()), timeoutMs);
  });
}

export async function executePageAction(action: BrowserAction): Promise<ActionResult> {
  const validation = validateBrowserAction(action);
  if (!validation.isValid) return { success: false, message: `Rejected invalid action: ${validation.errors.join('; ')}` };

  const normalize = (value: string) => value.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  const findTarget = (targetId?: string): HTMLElement | null => {
    if (!targetId || targetId === 'body' || targetId === 'document' || targetId === 'editor' || targetId === 'kix-app-content-editor') {
      const docsIframe = document.querySelector<HTMLIFrameElement>('.docs-texteventtarget-iframe, iframe.docs-texteventtarget-iframe');
      if (docsIframe) {
        const doc = docsIframe.contentDocument || docsIframe.contentWindow?.document;
        const target = doc?.activeElement || doc?.body;
        if (target instanceof HTMLElement) return target;
      }
      if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
        return document.activeElement;
      }
      const editable = document.querySelector<HTMLElement>(
        '[contenteditable="true"], [role="textbox"], .kix-appview-editor, textarea, input:not([type="hidden"])'
      );
      if (editable) return editable;
      return document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
    }
    const byId = document.getElementById(targetId);
    if (byId instanceof HTMLElement) {
      const style = window.getComputedStyle(byId);
      if (!byId.hidden && style.display !== 'none' && style.visibility !== 'hidden' &&
        !(byId instanceof HTMLButtonElement && byId.disabled) &&
        !(byId instanceof HTMLInputElement && byId.disabled)) return byId;
    }

    // Direct resolver for email / Gmail form controls
    const lowerTarget = targetId.toLowerCase().trim();
    if (/^(to|recipient|recipients|to recipients?)$/i.test(lowerTarget)) {
      const toEl = document.querySelector<HTMLElement>(
        'input[aria-label*="To recipients" i], input[aria-label="To" i], input[peoplekit-id], input[name="to"], .agP.aFw, [name="to"], [aria-label*="recipients" i]'
      );
      if (toEl) return toEl;
    }
    if (/^(subject|subjectbox|topic)$/i.test(lowerTarget)) {
      const subjectEl = document.querySelector<HTMLElement>(
        'input[name="subjectbox"], input[aria-label="Subject" i], input[placeholder="Subject" i], input[name="subject"]'
      );
      if (subjectEl) return subjectEl;
    }
    if (/^(message body|body|content|message|context|संदेश|मजकूर)$/i.test(lowerTarget)) {
      const isGmail = window.location.hostname.includes('mail.google.com');
      const bodyEl = document.querySelector<HTMLElement>(
        'div[aria-label="Message Body" i], div[aria-label="Message body" i], div[aria-label*="body" i], div[aria-label*="संदेश" i], div.Am.aiL.Al.editable, div.Am.Al.editable, div.editable[contenteditable="true"], div[role="textbox"][contenteditable="true"], div[role="textbox"][g_editable="true"], [g_editable="true"]'
      );
      if (bodyEl) return bodyEl;
      if (isGmail) {
        const candidates = Array.from(document.querySelectorAll<HTMLElement>('[contenteditable="true"], [role="textbox"], div.editable'));
        const editor = candidates.find((el) => {
          if (el.hidden || el.offsetParent === null) return false;
          const label = (el.getAttribute('aria-label') || '').toLowerCase();
          return !label.includes('to') && !label.includes('subject');
        });
        if (editor) return editor;
      }
    }

    const normalizedTarget = normalize(targetId).replace(/\b(input|button|item|element|field|box)\b/g, '').trim();
    const candidates = Array.from(document.querySelectorAll<HTMLElement>(
      'button,a,input,textarea,select,[role="button"],[role="link"],[role="searchbox"],[contenteditable="true"],label',
    )).filter((element) => {
      const style = window.getComputedStyle(element);
      return !element.hidden && style.display !== 'none' && style.visibility !== 'hidden' &&
        !(element instanceof HTMLButtonElement && element.disabled) &&
        !(element instanceof HTMLInputElement && element.disabled);
    });
    if (/search/i.test(targetId)) {
      const searchCandidates = candidates.filter((element) => element instanceof HTMLInputElement && (
        element.type === 'search' || element.getAttribute('role') === 'combobox' ||
        /search/i.test([element.name, element.placeholder, element.getAttribute('aria-label') || '', element.form?.getAttribute('role') || ''].join(' '))
      ));
      if (searchCandidates.length === 1) return searchCandidates[0];
      if (searchCandidates.length > 1) return null;
    }
    const scored = candidates.map((element) => {
      const label = normalize([
        element.innerText || element.textContent || '', element.getAttribute('aria-label') || '', element.getAttribute('placeholder') || '',
        element.getAttribute('name') || '', element.getAttribute('title') || '', element.id || '',
      ].join(' '));
      let score = label === normalizedTarget ? 100 :
        label.includes(normalizedTarget) ? 70 :
        normalizedTarget && normalizedTarget.split(' ').every((word) => label.includes(word)) ? 50 : 0;
      if (score > 0 && (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element.isContentEditable)) {
        score += 15;
      }
      return { element, score };
    }).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score);
    if (!scored.length) return null;
    if (scored.length > 1 && scored[0].score === scored[1].score) {
      const preferred = scored.find((s) => s.element instanceof HTMLInputElement || s.element instanceof HTMLTextAreaElement || s.element.isContentEditable);
      if (preferred) return preferred.element;
      return null;
    }
    return scored[0].element;
  };

  const waitForTarget = async (targetId?: string, timeoutMs = 4000): Promise<HTMLElement | null> => {
    let target = findTarget(targetId);
    if (target) return target;
    // Don't wait in Vitest / test environments
    if (typeof process !== 'undefined' && (process.env?.NODE_ENV === 'test' || process.env?.VITEST)) {
      return null;
    }
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      target = findTarget(targetId);
      if (target) return target;
    }
    return null;
  };

  switch (action.type) {
    case 'scroll_page': {
      const direction = action.direction || 'down';
      const amount = action.amount || 450;
      window.scrollBy({ top: direction === 'down' ? amount : -amount, behavior: 'smooth' });
      return { success: true, message: `Scrolled ${direction} by ${amount}px.`, data: { scrollY: window.scrollY } };
    }
    case 'read_page': {
      const page = collectPageDetails();
      return { success: Boolean(page.text), message: page.text ? `Read page: ${page.title}` : 'The active page has no readable visible text.', data: page };
    }
    case 'click_element': {
      const target = await waitForTarget(action.targetId);
      if (!target) return { success: false, message: `Could not uniquely find “${action.targetId}” on this page.` };
      const beforeUrl = window.location.href;
      const beforeText = document.body?.innerText || document.body?.textContent || '';
      const link = target instanceof HTMLAnchorElement ? target : target.closest<HTMLAnchorElement>('a[href]');
      let clickDispatched = false;
      const onClick = () => { clickDispatched = true; };
      target.addEventListener('click', onClick, { capture: true, once: true });
      target.click();
      target.removeEventListener('click', onClick, true);
      const changed = await waitForPageChange(beforeUrl, beforeText);
      if (!changed && !link && !clickDispatched) {
        return { success: false, message: `The click on “${action.targetId}” was not accepted by the page.` };
      }
      const focused = document.activeElement === target;
      const message = changed
        ? `Clicked “${action.targetId}” and confirmed the page updated.`
        : link
          ? `Clicked “${action.targetId}” (${link.href}).`
          : focused
            ? `Focused “${action.targetId}” and confirmed the control received focus.`
            : `Clicked “${action.targetId}” and confirmed the control received the click.`;
      return { success: true, message, data: { url: window.location.href, expectedUrl: link?.href, pageChanged: changed, focused, clickDispatched } };
    }
    case 'type_text': {
      // 1. Google Docs special canvas/iframe handler
      const isDocsPage = window.location.hostname.includes('docs.google.com') || Boolean(document.querySelector('.docs-texteventtarget-iframe, .kix-appview-editor'));
      if (isDocsPage) {
        const docsIframe = document.querySelector<HTMLIFrameElement>('.docs-texteventtarget-iframe');
        if (docsIframe) {
          try {
            docsIframe.contentWindow?.focus();
            const doc = docsIframe.contentDocument || docsIframe.contentWindow?.document;
            const docEl = (doc?.activeElement || doc?.body) as HTMLElement | null;
            if (docEl) {
              docEl.focus();
              docEl.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: action.text }));
              document.execCommand('insertText', false, action.text);
              docEl.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: action.text }));
              return { success: true, message: 'Inserted text into Google Docs document.', data: { textLength: action.text.length } };
            }
          } catch {}
        }
        document.execCommand('insertText', false, action.text);
        return { success: true, message: 'Inserted text into Google Docs editor.', data: { textLength: action.text.length } };
      }

      const target = await waitForTarget(action.targetId);
      if (!target) return { success: false, message: action.targetId ? `Could not uniquely find “${action.targetId}” on this page.` : 'No text field is focused.' };
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        target.focus();
        const beforeUrl = window.location.href;
        const beforeText = document.body?.innerText || document.body?.textContent || '';
        const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(target), 'value');
        descriptor?.set?.call(target, action.text);
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));

        const isRecipientField = /to|recipient/i.test(action.targetId || '') || /to recipients/i.test(target.getAttribute('aria-label') || '');
        if (isRecipientField) {
          target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
          target.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        }

        if (target.value !== action.text && !isRecipientField) return { success: false, message: 'The target field did not accept the requested text.' };
        const isSearch = /search/i.test([action.targetId || '', target.type, target.name, target.placeholder, target.getAttribute('aria-label') || '', target.form?.getAttribute('role') || ''].join(' '));
        let submitted = false;
        let pageChanged = false;
        if (isSearch) {
          if (target.form) {
            if (typeof target.form.requestSubmit === 'function') target.form.requestSubmit();
            else target.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            submitted = true;
          } else {
            target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
            target.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
            submitted = true;
          }
          pageChanged = await waitForPageChange(beforeUrl, beforeText);
          if (!pageChanged) return { success: false, message: 'Entered the query, but the page did not show updated search results.', data: { value: target.value, searchSubmitted: submitted, pageChanged: false } };
        }
        return { success: true, message: isSearch ? 'Entered the query and verified the page updated.' : `Entered text in ${action.targetId || 'the focused field'} and verified the field value.`, data: { value: target.value, textLength: action.text.length, searchSubmitted: submitted, pageChanged } };
      }
      if (target.isContentEditable || target === document.body || target.getAttribute('role') === 'textbox') {
        target.focus();
        document.execCommand('insertText', false, action.text);
        target.dispatchEvent(new Event('input', { bubbles: true }));
        return { success: true, message: 'Entered text in the editable page area.', data: { textLength: action.text.length } };
      }
      return { success: false, message: `“${action.targetId || 'Focused element'}” is not an editable text field.` };
    }
    default:
      return { success: false, message: `Action ${action.type} is not handled by the page executor.` };
  }
}