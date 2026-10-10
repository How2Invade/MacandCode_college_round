/**
 * Handsfree Content Script
 * Injected into webpages to provide visual cursor overlays and execute DOM actions.
 */

import { MockCursorController } from '../cursor/mockCursorController';
import { PointerPosition } from '../shared/types/tracking';
import { BrowserAction, ActionResult } from '../shared/types/actions';
import { logger } from '../shared/utils';

logger.info('ContentScript', 'Handsfree content script loaded into page: ' + window.location.href);

const cursorController = new MockCursorController();

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
      sendResponse({ ok: true });
      return true;
    }

    if (message.type === 'EXECUTE_BROWSER_ACTION') {
      const action = message.payload?.action as BrowserAction;
      logger.info('ContentScript', `Simulating content action: ${action?.type}`);

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
