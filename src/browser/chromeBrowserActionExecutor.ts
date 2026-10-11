import { ActionResult, BrowserAction, IBrowserActionExecutor } from '../shared/types/actions';
import { validateBrowserAction } from '../shared/safety/action-policy';

type PageActionResult = ActionResult & { data?: { expectedUrl?: unknown; pageChanged?: unknown; [key: string]: unknown } };

/** Routes validated actions to Chrome tabs or the content-script action handler. */
export class ChromeBrowserActionExecutor implements IBrowserActionExecutor {
  private async sendPageAction(tabId: number, action: BrowserAction): Promise<PageActionResult> {
    const message = { type: 'EXECUTE_BROWSER_ACTION', payload: { action } };
    try {
      return await chrome.tabs.sendMessage(tabId, message) as PageActionResult;
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      if (!/receiving end does not exist|could not establish connection/i.test(messageText)) throw error;

      // Tabs that were already open when the extension was installed or reloaded
      // may not have received its content script yet. Inject the bundled script and retry.
      if (!chrome.scripting?.executeScript) throw error;
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      await new Promise((resolve) => setTimeout(resolve, 50));
      return await chrome.tabs.sendMessage(tabId, message) as PageActionResult;
    }
  }

  private async waitForTabComplete(tabId: number, expectedUrl?: string, timeoutMs = 15000): Promise<chrome.tabs.Tab | undefined> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const tab = await chrome.tabs.get(tabId).catch(() => undefined);
      if (tab?.status === 'complete' && (!expectedUrl || tab.url === expectedUrl)) return tab;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return chrome.tabs.get(tabId).catch(() => undefined);
  }

  private async waitForUrlChange(tabId: number, previousUrl?: string, timeoutMs = 5000): Promise<chrome.tabs.Tab | undefined> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const tab = await chrome.tabs.get(tabId).catch(() => undefined);
      if (tab?.url && tab.url !== previousUrl) return this.waitForTabComplete(tabId, undefined, timeoutMs);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return chrome.tabs.get(tabId).catch(() => undefined);
  }

  public async canExecute(action: BrowserAction): Promise<boolean> {
    return validateBrowserAction(action).isValid && typeof chrome !== 'undefined' && Boolean(chrome.tabs);
  }

  public async execute(action: BrowserAction): Promise<ActionResult> {
    const validated = validateBrowserAction(action);
    if (!validated.isValid) return { success: false, message: `Invalid browser action: ${validated.errors.join('; ')}` };
    if (typeof chrome === 'undefined' || !chrome.tabs) {
      return { success: false, message: 'Chrome browser actions are unavailable in this context.' };
    }

    try {
      if (action.type === 'open_url') {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const opened = tab?.id !== undefined
          ? await chrome.tabs.update(tab.id, { url: action.url })
          : await chrome.tabs.create({ url: action.url, active: true });
        if (opened.id === undefined) return { success: false, message: 'Chrome did not return the opened tab.' };
        const loaded = await this.waitForTabComplete(opened.id, action.url);
        if (loaded?.status !== 'complete' || loaded.url !== action.url) return { success: false, message: `Navigation to ${action.url} did not finish before timeout.` };
        return { success: true, message: `Opened ${action.url} and confirmed the page loaded.`, data: { url: loaded.url, title: loaded.title } };
      }

      if (action.type === 'navigate_back' || action.type === 'navigate_forward') {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id === undefined) return { success: false, message: 'No active tab is available.' };
        const previousUrl = tab.url;
        const direction = action.type === 'navigate_back' ? 'back' : 'forward';
        if (direction === 'back') await chrome.tabs.goBack(tab.id);
        else await chrome.tabs.goForward(tab.id);
        const changed = await this.waitForUrlChange(tab.id, previousUrl);
        if (!changed?.url || changed.url === previousUrl || changed.status !== 'complete') return { success: false, message: `Could not verify navigation ${direction}.` };
        return { success: true, message: `Navigated ${direction} and confirmed the destination loaded.`, data: { url: changed.url, title: changed.title } };
      }

      if (action.type === 'switch_tab') {
        const tabs = await chrome.tabs.query({ currentWindow: true });
        const [active] = tabs.filter((tab) => tab.active);
        if (!tabs.length || active?.id === undefined) return { success: false, message: 'No browser tab is available to switch.' };
        const index = tabs.findIndex((tab) => tab.id === active.id);
        const offset = action.direction === 'next' ? 1 : -1;
        const next = tabs[(index + offset + tabs.length) % tabs.length];
        if (next.id === undefined) return { success: false, message: 'Could not identify the adjacent tab.' };
        await chrome.tabs.update(next.id, { active: true });
        return { success: true, message: `Switched to the ${action.direction} tab.` };
      }

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id === undefined) return { success: false, message: 'No active tab is available.' };
      try {
        const result = await this.sendPageAction(tab.id, action);
        if (!result || typeof result.success !== 'boolean') return { success: false, message: 'The page did not return an action result.' };
        if (result.success && action.type === 'click_element' && result.data?.expectedUrl && !result.data?.pageChanged) {
          const beforeUrl = tab.url;
          const expectedUrl = result.data.expectedUrl as string;
          const navigated = await this.waitForUrlChange(tab.id, beforeUrl, 5000);
          const expectedHost = (() => { try { return new URL(expectedUrl).hostname; } catch { return ''; } })();
          const actualHost = (() => { try { return new URL(navigated?.url || '').hostname; } catch { return ''; } })();
          if (actualHost !== expectedHost) return { success: false, message: `Clicked “${action.targetId}”, but navigation to the selected result could not be verified.` };
          return { success: true, message: `Clicked “${action.targetId}” and verified navigation to ${navigated?.url}.`, data: { url: navigated?.url, title: navigated?.title } };
        }
        return result as ActionResult;
      } catch (error) {
        const isSearch = action.type === 'type_text' && /search/i.test(action.targetId || '');
        const navigationResult = await this.waitForUrlChange(tab.id, tab.url, isSearch ? 8000 : 2500);
        if (navigationResult?.url && navigationResult.url !== tab.url && navigationResult.status === 'complete') {
          return { success: true, message: `${isSearch ? 'Search submitted' : 'Clicked link'} and confirmed the destination loaded.`, data: { url: navigationResult.url, title: navigationResult.title } };
        }
        throw error;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Chrome could not execute the browser action.';
      return { success: false, message: `Browser action failed: ${message}` };
    }
  }
}

export const defaultChromeBrowserActionExecutor = new ChromeBrowserActionExecutor();
