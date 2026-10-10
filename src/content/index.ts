/**
 * Handsfree Content Script
 * Injected into webpages to provide visual cursor overlays and execute DOM actions.
 */

import { WebpageCursorController } from '../cursor/webpageCursorController';
import { PointerPosition } from '../shared/types/tracking';
import { BrowserAction, ActionResult } from '../shared/types/actions';
import { logger } from '../shared/utils';

logger.info('ContentScript', 'Handsfree content script loaded into page: ' + window.location.href);

const cursorController = new WebpageCursorController();

// Listen for messages from extension background / sidepanel
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'CONTENT_PING') {
      sendResponse({ status: 'pong', url: window.location.href });
      return true;
    }

    if (message.type === 'POINTER_VISIBILITY') {
      if (message.payload.visible) {
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
      sendResponse({ ok: true });
      return true;
    }

    if (message.type === 'EXECUTE_BROWSER_ACTION') {
      const action = message.payload?.action as BrowserAction;
      logger.info('ContentScript', `Handling content action: ${action?.type}`);
      let clicked = false;

      if (action?.type === 'click' && action.coordinates) {
        const px = action.coordinates.x * window.innerWidth;
        const py = action.coordinates.y * window.innerHeight;
        
        const targetElement = document.elementFromPoint(px, py);
        if (targetElement && targetElement instanceof HTMLElement) {
           targetElement.click();
           clicked = true;
           logger.info('ContentScript', `Clicked element:`, targetElement);
        }
      }

      const result: ActionResult = {
        success: clicked,
        message: clicked ? `Successfully clicked element` : `Action ${action?.type} failed or no target found`,
        data: { url: window.location.href },
      };

      sendResponse(result);
      return true;
    }

    return true;
  });
}
