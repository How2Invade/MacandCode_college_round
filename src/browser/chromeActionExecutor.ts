import { BrowserAction, ActionResult, IBrowserActionExecutor } from '../shared/types/actions';
import { logger } from '../shared/utils';

export class ChromeActionExecutor implements IBrowserActionExecutor {
  public async execute(action: BrowserAction): Promise<ActionResult> {
    logger.info('ChromeActionExecutor', `Routing action to background script: ${action.type}`);
    try {
      const tabId = await this.getHostTabId();
      return await new Promise((resolve) => {
        const payload = tabId !== undefined ? { action, tabId } : { action };
        chrome.runtime.sendMessage({ type: 'EXECUTE_BROWSER_ACTION', payload }, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, message: chrome.runtime.lastError.message || 'Failed to reach background script' });
          } else if (response) {
            resolve(response as ActionResult);
          } else {
            resolve({ success: false, message: 'No response from background' });
          }
        });
      });
    } catch (error: any) {
      logger.error('ChromeActionExecutor', `Execution failed for ${action.type}`, error);
      return { success: false, message: error.message || 'Execution failed' };
    }
  }

  /**
   * From the side panel, `currentWindow` is the browser window that hosts the panel (even when the
   * panel's DevTools window has focus), so its active tab is the webpage the user sees next to the panel.
   * Content scripts have no chrome.tabs; they return undefined and the background uses sender.tab.
   */
  private async getHostTabId(): Promise<number | undefined> {
    try {
      if (!chrome.tabs?.query) return undefined;
      
      // First, try the current window (works when side panel is docked)
      let tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      let url = tabs?.[0]?.url || tabs?.[0]?.pendingUrl;
      
      // If the current window's active tab is an extension page or DevTools,
      // it means we are in a detached context. Fall back to the last focused normal window.
      if (!tabs?.length || (url && !url.startsWith('http://') && !url.startsWith('https://'))) {
        if (chrome.windows?.getLastFocused) {
          const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
          if (win?.id !== undefined) {
            tabs = await chrome.tabs.query({ active: true, windowId: win.id });
          }
        }
      }
      
      const id = tabs?.[0]?.id;
      return typeof id === 'number' && id >= 0 ? id : undefined;
    } catch {
      return undefined;
    }
  }

  public async canExecute(action: BrowserAction): Promise<boolean> {
    // Basic validation
    if (action.type === 'open_url') return !!action.url;
    if (action.type === 'type_text') return typeof action.text === 'string' && action.text.length > 0;
    if (action.type === 'click_element') return !!action.targetId;
    return true;
  }
}

export const defaultChromeActionExecutor = new ChromeActionExecutor();
