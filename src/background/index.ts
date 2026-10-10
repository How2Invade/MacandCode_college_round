/**
 * Handsfree Background Service Worker (Manifest V3)
 * Coordinates extension lifecycle, messaging between sidepanel and active tabs, and state.
 */

import { logger } from '../shared/utils';
import { HandsfreeMessage } from '../shared/messaging/messages';
import { defaultActionPolicy } from '../shared/safety/action-policy';
import { ApprovalMode } from '../shared/types/actions';

logger.info('Background', 'Service worker initialized');

const RESTRICTED_URL_PREFIXES = [
  'chrome://', 'chrome-extension://', 'edge://', 'about:', 'devtools://',
  'view-source:', 'chrome-search://', 'https://chrome.google.com/webstore', 'https://chromewebstore.google.com',
];

export function isEligibleWebTab(tab: chrome.tabs.Tab | undefined | null): boolean {
  if (!tab || typeof tab.id !== 'number' || tab.id < 0) return false;
  const url = tab.url || tab.pendingUrl || '';
  if (!url) return false;
  return !RESTRICTED_URL_PREFIXES.some((p) => url.startsWith(p));
}

export type TargetTabResult = { tab: chrome.tabs.Tab; error?: undefined } | { tab: null; error: string };

/**
 * Robustly sends a message to a content script. If the content script is missing
 * (e.g. after an extension reload), it dynamically injects the content script and retries.
 */
async function sendToContentScript(tabId: number, message: any): Promise<any> {
  const handleMessageResult = (response: any, lastErrorMsg: string | undefined) => {
    if (lastErrorMsg) {
      if (lastErrorMsg.includes('port closed')) {
        const action = message?.payload?.action;
        if (action && (action.type === 'click_element' || action.type === 'type_text')) {
          return { success: false, message: `Target not found or ambiguous: ${action.targetId}` };
        }
        return { success: false, message: `No frame responded (Target may not exist or port closed)` };
      }
      return { success: false, message: lastErrorMsg };
    }
    return response || { success: false, message: 'No response from webpage' };
  };

  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, async (response) => {
      if (chrome.runtime.lastError) {
        const errorMsg = chrome.runtime.lastError.message || 'Unknown error';
        if (errorMsg.includes('Receiving end does not exist')) {
          logger.warn('Background', `Content script missing on tab ${tabId}. Attempting dynamic injection...`);
          try {
            await chrome.scripting.executeScript({
              target: { tabId, allFrames: true },
              files: ['content.js']
            });
            // Retry message after successful injection
            chrome.tabs.sendMessage(tabId, message, (retryResp) => {
              resolve(handleMessageResult(retryResp, chrome.runtime.lastError?.message));
            });
            return;
          } catch (injectErr: any) {
            resolve({ success: false, message: `Failed to inject content script: ${injectErr.message}. Check permissions.` });
            return;
          }
        }
        resolve(handleMessageResult(response, errorMsg));
      } else {
        resolve(handleMessageResult(response, undefined));
      }
    });
  });
}

/**
 * Resolve which webpage tab a browser action should target.
 *
 * NOTE: `tabs.query({ active: true, lastFocusedWindow: true })` is NOT reliable here: when the request
 * comes from an undocked Side Panel DevTools window, that DevTools window is the last focused window
 * and it contains no tabs, so the query returns []. Strategy, in order:
 *   1. An explicit `tabId` in the payload (validated: must exist and be an eligible web page).
 *   2. `sender.tab` when the message came from a content script.
 *   3. The active tab of the last focused *normal* browser window.
 *   4. Any active tab in any normal window.
 */
export async function resolveTargetTab(
  explicitTabId: unknown,
  sender?: chrome.runtime.MessageSender,
): Promise<TargetTabResult> {
  if (explicitTabId !== undefined && explicitTabId !== null) {
    if (typeof explicitTabId !== 'number' || !Number.isInteger(explicitTabId) || explicitTabId < 0) {
      return { tab: null, error: `Invalid tabId: ${String(explicitTabId)}` };
    }
    let tab: chrome.tabs.Tab | undefined;
    try {
      tab = await chrome.tabs.get(explicitTabId);
    } catch {
      return { tab: null, error: `Tab ${explicitTabId} does not exist` };
    }
    if (!isEligibleWebTab(tab)) {
      return { tab: null, error: `Tab ${explicitTabId} is a restricted or non-web page` };
    }
    return { tab: tab! };
  }

  // If message comes from a content script, use its tab
  if (sender?.tab && isEligibleWebTab(sender.tab)) {
    logger.debug('Background', `Target tab resolved from sender: ${sender.tab.id} (${sender.tab.url})`);
    return { tab: sender.tab };
  }

  // We no longer fall back to `getLastFocused` here to prevent executing actions on unexpected tabs.
  // The side panel (ChromeActionExecutor) must calculate and explicitly provide the target tabId.
  return { tab: null, error: 'Target tab could not be resolved. Please provide a valid explicit tabId in the payload.' };
}

// Enable persistent side panel opening on extension action click
if (typeof chrome !== 'undefined' && chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => logger.error('Background', 'Failed to configure sidePanel behavior', error));
}

// State for authorization
let currentApprovalMode: ApprovalMode = 'ask';
const approvedActions = new Set<string>();

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

        case 'SET_APPROVAL_MODE': {
          if (sender.id === chrome.runtime.id && !sender.tab) {
            currentApprovalMode = (message.payload as any).mode;
            logger.info('Background', `Approval mode updated to ${currentApprovalMode}`);
          }
          sendResponse({ success: true });
          break;
        }

        case 'APPROVE_ACTION': {
          if (sender.id === chrome.runtime.id && !sender.tab) {
            const actionKey = JSON.stringify(message.payload.action);
            approvedActions.add(actionKey);
            logger.info('Background', `User approved action ${message.payload.action.type}`);
          }
          sendResponse({ success: true, action: message.payload.action });
          break;
        }

        case 'REJECT_ACTION': {
          if (sender.id === chrome.runtime.id && !sender.tab) {
            const actionKey = JSON.stringify(message.payload.action);
            approvedActions.delete(actionKey);
            logger.info('Background', `User rejected action ${message.payload.action.type}`);
          }
          sendResponse({ success: true, action: message.payload.action });
          break;
        }

        case 'EXECUTE_BROWSER_ACTION': {
          logger.info('Background', `Executing browser action ${message.payload?.action?.type}`);
          const action = message.payload?.action;
          
          if (!action || typeof action !== 'object' || !action.type) {
            sendResponse({ success: false, message: 'Invalid or malformed action payload' });
            break;
          }

          // 1. Independent safety policy evaluation
          const decision = defaultActionPolicy.evaluate(action, currentApprovalMode);
          
          // 2. Verify explicit approval if required
          if (decision.requiresApproval) {
            const actionKey = JSON.stringify(action);
            // Verify if the action was approved by a trusted UI (Sidepanel)
            if (!approvedActions.has(actionKey)) {
              logger.warn('Background', `Action ${action.type} blocked: missing required approval in mode ${currentApprovalMode}. Reasons: ${decision.reasons.join(', ')}`);
              sendResponse({ success: false, message: 'Action blocked by safety policy: requires user approval.' });
              break;
            }
            // Consume the approval so it cannot be reused
            approvedActions.delete(actionKey);
          }
          
          if (action.type === 'open_url') {
            const url = action.url;
            if (!url) {
              sendResponse({ success: false, message: 'URL is required' });
              break;
            }
            try {
              const validUrl = new URL(url);
              if (validUrl.protocol !== 'http:' && validUrl.protocol !== 'https:') {
                sendResponse({ success: false, message: 'Only HTTP and HTTPS protocols are allowed' });
                break;
              }
              chrome.tabs.create({ url: validUrl.href })
                .then(() => sendResponse({ success: true, message: `Opened URL: ${url}` }))
                .catch((err: any) => sendResponse({ success: false, message: err.message || 'Failed to open tab' }));
              return true; // asynchronous sendResponse
            } catch (e: any) {
              sendResponse({ success: false, message: `Invalid URL: ${url}` });
              break;
            }
          } else if (action.type === 'navigate_back' || action.type === 'navigate_forward') {
            resolveTargetTab((message.payload as any).tabId, sender)
              .then(async (res) => {
                if (!res.tab) return sendResponse({ success: false, message: res.error });
                
                const direction = action.type === 'navigate_back' ? 'back' : 'forward';
                
                const navPromise = direction === 'back' 
                  ? chrome.tabs.goBack(res.tab.id!) 
                  : chrome.tabs.goForward(res.tab.id!);
                  
                navPromise
                  .then(async () => {
                    logger.info('Background', `[Navigate] ${direction} successful on tab ${res.tab.id}`);
                    // Omit the URL because chrome.tabs.goBack resolving does not guarantee the new URL has settled
                    sendResponse({ success: true, message: `Navigated ${direction}`, tabId: res.tab.id });
                  })
                  .catch((e: any) => {
                    logger.error('Background', `[Navigate] ${direction} failed on tab ${res.tab.id}: ${e?.message}`);
                    sendResponse({ success: false, message: e?.message || `Cannot find a ${direction === 'back' ? 'previous' : 'next'} page in history.`, tabId: res.tab.id, url: res.tab.url });
                  });
                return; // sendResponse is called asynchronously
              })
              .catch((e: any) => sendResponse({ success: false, message: e?.message || 'Navigation failed' }));
            return true;
                    } else if (action.type === 'zoom_page') {
            resolveTargetTab((message.payload as any).tabId, sender)
              .then((res) => {
                if (!res.tab?.id) return sendResponse({ success: false, message: res.error });
                chrome.tabs.getZoom(res.tab.id, (currentZoom) => {
                  const step = action.direction === 'in' ? 0.1 : -0.1;
                  chrome.tabs.setZoom(res.tab.id!, Math.min(5, Math.max(0.25, currentZoom + step)), () => {
                    sendResponse({ success: true, message: `Zoomed ${action.direction}`, tabId: res.tab.id });
                  });
                });
              });
            return true;
          } else if (action.type === 'history_action') {
            resolveTargetTab((message.payload as any).tabId, sender)
              .then((res) => {
                if (!res.tab?.id) return sendResponse({ success: false, message: res.error });
                chrome.scripting.executeScript({
                  target: { tabId: res.tab.id },
                  func: (cmd: string) => document.execCommand(cmd),
                  args: [action.command],
                })
                .then(() => sendResponse({ success: true, message: `Executed ${action.command}`, tabId: res.tab.id }))
                .catch((e: any) => sendResponse({ success: false, message: e?.message || 'History action failed' }));
              });
            return true;
          } else if (action.type === 'switch_tab') {
            resolveTargetTab((message.payload as any).tabId, sender)
              .then(async (res) => {
                if (!res.tab) return sendResponse({ success: false, message: res.error });
                const tabs = await chrome.tabs.query({ windowId: res.tab.windowId });
                const currentIndex = tabs.findIndex((t) => t.id === res.tab!.id);
                if (tabs.length < 2 || currentIndex === -1) {
                  return sendResponse({ success: false, message: 'No other tab to switch to' });
                }
                const step = action.direction === 'previous' ? -1 : 1;
                const target = tabs[(currentIndex + step + tabs.length) % tabs.length];
                if (target?.id === undefined) {
                  return sendResponse({ success: false, message: 'Invalid target tab' });
                }
                await chrome.tabs.update(target.id, { active: true });
                const updatedTab = await chrome.tabs.get(target.id);
                if (updatedTab.active) {
                  sendResponse({ success: true, message: `Switched to ${action.direction} tab`, tabId: target.id });
                } else {
                  sendResponse({ success: false, message: 'Failed to verify tab activation' });
                }
              })
              .catch((e: any) => sendResponse({ success: false, message: e?.message || 'Tab switch failed' }));
            return true;
          } else {
            // Forward DOM-specific actions to the target webpage tab's content script
            resolveTargetTab((message.payload as any).tabId, sender)
              .then((res) => {
                if (!res.tab) return sendResponse({ success: false, message: res.error });
                sendToContentScript(res.tab.id!, message).then((response) => {
                  sendResponse(response);
                });
              })
              .catch((e: any) => sendResponse({ success: false, message: e?.message || 'Failed to resolve target tab' }));
            return true; // asynchronous sendResponse
          }
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
