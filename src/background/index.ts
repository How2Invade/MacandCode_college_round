/**
 * Handsfree Background Service Worker (Manifest V3)
 * Coordinates extension lifecycle, messaging between sidepanel and active tabs, and state.
 */

import { logger } from '../shared/utils';
import { HandsfreeMessage } from '../shared/messaging/messages';

logger.info('Background', 'Service worker initialized');

// Enable persistent side panel opening on extension action click
if (typeof chrome !== 'undefined' && chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => logger.error('Background', 'Failed to configure sidePanel behavior', error));
}

// Runtime message listener
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener(
    (message: HandsfreeMessage, sender, sendResponse) => {
      logger.info('Background', `Received message [${message?.type}] from [${message?.source || sender?.id}]`);

      switch (message.type) {
        case 'GET_INITIAL_STATE': {
          sendResponse({
            status: 'ok',
            info: 'Handsfree MV3 service worker active',
          });
          break;
        }

        case 'TRACKING_START':
        case 'TRACKING_STOP':
        case 'TRACKING_PAUSE': {
          logger.info('Background', `Tracking command received: ${message.type}`);
          sendResponse({ success: true, command: message.type });
          break;
        }

        case 'APPROVE_ACTION': {
          logger.info('Background', `User approved action ${message.payload.action.type}`);
          sendResponse({ success: true, action: message.payload.action });
          break;
        }

        case 'REJECT_ACTION': {
          logger.info('Background', `User rejected action ${message.payload.action.type}`);
          sendResponse({ success: true, action: message.payload.action });
          break;
        }

        default:
          sendResponse({ received: true, timestamp: Date.now() });
          break;
      }

      return true;
    }
  );
}

// Tab update listener to track navigation events
if (typeof chrome !== 'undefined' && chrome.tabs?.onUpdated) {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url) {
      logger.debug('Background', `Tab ${tabId} loaded: ${tab.url}`);
    }
  });
}
