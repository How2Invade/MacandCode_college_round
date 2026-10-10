/**
 * Handsfree Content Script
 * Injected into webpages to provide visual cursor overlays and execute DOM actions.
 */

import { WebpageCursorController } from '../cursor/webpageCursorController';
import { PointerPosition } from '../shared/types/tracking';
import { BrowserAction, ActionResult } from '../shared/types/actions';
import { logger } from '../shared/utils';

type PointerClickAction = {
  type: 'click';
  coordinates: { x: number; y: number };
};

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
      const action = message.payload?.action as BrowserAction | PointerClickAction;
      logger.info('ContentScript', `Simulating content action: ${action?.type}`);

      if (action?.type === 'click') {
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

      if (action?.type === 'undo') {
        document.execCommand('undo');
        sendResponse({ success: true, message: 'Executed undo.' } satisfies ActionResult);
        return true;
      }

      if (action?.type === 'redo') {
        document.execCommand('redo');
        sendResponse({ success: true, message: 'Executed redo.' } satisfies ActionResult);
        return true;
      }

      const result: ActionResult = {
        success: true,
        message: `Content script handled ${action?.type}`,
        data: { url: window.location.href },
      };

      sendResponse(result);
      return true;
    }

    return true;
  });
}
