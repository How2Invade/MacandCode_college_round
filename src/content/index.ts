/**
 * Handsfree Content Script
 * Injected into webpages to provide visual cursor overlays and execute DOM actions.
 */

import { RealCursorController } from '../cursor/realCursorController';
import { PointerPosition } from '../shared/types/tracking';
import { BrowserAction } from '../shared/types/actions';
import { logger } from '../shared/utils';

let lastPointerDiagnosticAt = 0;

if (!(window as any).__handsfreeInitialized) {
  (window as any).__handsfreeInitialized = true;
  logger.info('ContentScript', 'Handsfree content script loaded into page: ' + window.location.href);

  const cursorController = new RealCursorController();

  // Listen for messages from extension background / sidepanel
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    logger.debug('ContentScript', `Received message: ${message?.type}`);

    if (message.type === 'CONTENT_PING') {
      sendResponse({ status: 'pong', url: window.location.href });
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
      const action = message.payload?.action as BrowserAction;
      logger.info('ContentScript', `Executing action: ${action?.type}`);

      try {
        let resultMessage = `Executed ${action.type} successfully`;
        let data: any = { url: window.location.href };

        // Helper to securely identify elements
        const resolveTarget = (targetId: string): HTMLElement | null => {
          let el: HTMLElement | null = null;
          try {
            el = document.querySelector(targetId) as HTMLElement;
          } catch {
            // Invalid CSS selector, fallback will handle it
          }
          if (el) return el;
          
          // Fallback to searching by text content if it's not a CSS selector
          const elements = Array.from(document.querySelectorAll('button, a, input, [role="button"]')) as HTMLElement[];
          el = elements.find(e => e.innerText?.toLowerCase().includes(targetId.toLowerCase()) || (e as HTMLInputElement).placeholder?.toLowerCase().includes(targetId.toLowerCase())) as HTMLElement;
          
          return el || null;
        };

        switch (action.type) {
          case 'click_element': {
            if (action.targetId === 'cursor') {
              const pos = cursorController.getPosition();
              if (pos) {
                const x = Math.max(0, Math.min(pos.x, 1)) * window.innerWidth;
                const y = Math.max(0, Math.min(pos.y, 1)) * window.innerHeight;
                
                cursorController.hide(); // Hide cursor to prevent it from intercepting the click
                const el = document.elementFromPoint(x, y) as HTMLElement;
                if (el) {
                  cursorController.triggerClickVisual('left');
                  el.click();
                  resultMessage = `Clicked element at cursor position`;
                } else {
                  throw new Error("No clickable element found under cursor");
                }
                cursorController.show();
              } else {
                throw new Error("Cursor position unavailable");
              }
              break;
            }

            const el = resolveTarget(action.targetId);
            if (!el) return false; // Let another frame handle it
            el.click();
            break;
          }
          case 'type_text': {
            if (!action.targetId) throw new Error('No targetId provided for typing');
            const el = resolveTarget(action.targetId) as HTMLInputElement | HTMLTextAreaElement;
            if (!el) return false; // Let another frame handle it
            el.focus();
            el.value = action.text;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            break;
          }
          case 'scroll_page': {
            const yOffset = action.direction === 'down' ? action.amount : -action.amount;
            window.scrollBy({ top: yOffset, behavior: 'smooth' });
            break;
          }
          case 'read_page': {
            // Provide a sensible extract
            data.content = document.body.innerText.substring(0, 5000); 
            break;
          }
          case 'navigate_back': {
            window.history.back();
            break;
          }
          case 'navigate_forward': {
            window.history.forward();
            break;
          }
          default:
            throw new Error(`Unsupported action in content script: ${(action as any).type}`);
        }

        sendResponse({ success: true, message: resultMessage, data });
      } catch (err: any) {
        logger.error('ContentScript', `Action execution failed: ${err.message}`);
        sendResponse({ success: false, message: err.message, data: { url: window.location.href } });
      }
      return true; // Keep channel open to allow async sendResponse from this frame or others
    }

    // Default return true for other message types handled above
    return true;
  });
}
}
