import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveTargetTab, isEligibleWebTab } from '../../src/background/index';
import { ChromeActionExecutor } from '../../src/browser/chromeActionExecutor';

const chromeMock = (globalThis as any).chrome;
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('Background Service Worker (EXECUTE_BROWSER_ACTION)', () => {
  let onMessageListener: Function;
  const addListenerMock = chromeMock.runtime.onMessage.addListener;
  if (addListenerMock.mock.calls.length > 0) {
    onMessageListener = addListenerMock.mock.calls[0][0];
  }

  beforeEach(() => {
    vi.clearAllMocks();
    chromeMock.tabs.query.mockReset().mockResolvedValue([{ id: 1, url: 'https://example.com', active: true, windowId: 1 }]);
    chromeMock.tabs.get.mockReset().mockResolvedValue({ id: 1, url: 'https://example.com', windowId: 1 });
    chromeMock.tabs.goBack.mockReset().mockResolvedValue(undefined);
    chromeMock.tabs.goForward.mockReset().mockResolvedValue(undefined);
    chromeMock.tabs.update.mockReset().mockResolvedValue(undefined);
    chromeMock.windows.getLastFocused.mockReset().mockResolvedValue({ id: 1, type: 'normal' });
  });

  it('opens valid URLs using chrome.tabs.create', async () => {
    const sendResponse = vi.fn();
    onMessageListener({ type: 'EXECUTE_BROWSER_ACTION', payload: { action: { type: 'open_url', url: 'https://example.com' } } }, {}, sendResponse);
    await flush();
    expect(chromeMock.tabs.create).toHaveBeenCalledWith({ url: 'https://example.com/' });
    expect(sendResponse).toHaveBeenCalledWith({ success: true, message: 'Opened URL: https://example.com' });
  });

  it('rejects invalid URLs even if approved', () => {
    const sendResponse = vi.fn();
    const action = { type: 'open_url', url: 'javascript:alert(1)' };
    onMessageListener({ type: 'APPROVE_ACTION', payload: { action } }, { id: chromeMock.runtime.id }, vi.fn());
    onMessageListener({ type: 'EXECUTE_BROWSER_ACTION', payload: { action } }, {}, sendResponse);
    expect(chromeMock.tabs.create).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ success: false, message: 'Only HTTP and HTTPS protocols are allowed' });
  });

  it('forwards DOM actions to the explicitly supplied tab', async () => {
    const sendResponse = vi.fn();
    chromeMock.tabs.get.mockResolvedValue({ id: 42, url: 'https://example.com' });
    chromeMock.tabs.sendMessage.mockImplementation((_id: number, _m: any, cb: Function) => cb({ success: true, message: 'ok' }));
    const action = { type: 'click_element', targetId: 'x' };
    const message = { type: 'EXECUTE_BROWSER_ACTION', payload: { action, tabId: 42 } };
    onMessageListener({ type: 'APPROVE_ACTION', payload: { action } }, { id: chromeMock.runtime.id }, vi.fn());
    onMessageListener(message, {}, sendResponse);
    await flush();
    expect(chromeMock.tabs.sendMessage).toHaveBeenCalledWith(42, message, expect.any(Function));
    expect(sendResponse).toHaveBeenCalledWith({ success: true, message: 'ok' });
  });

  it('navigates back using explicit tabId (side panel / DevTools scenario) and omits stale URL', async () => {
    const sendResponse = vi.fn();
    chromeMock.tabs.get.mockResolvedValue({ id: 99, url: 'https://example.com/page2', windowId: 3 });
      
    onMessageListener({ type: 'EXECUTE_BROWSER_ACTION', payload: { action: { type: 'navigate_back' }, tabId: 99 } }, {}, sendResponse);
    await flush();
    expect(chromeMock.tabs.goBack).toHaveBeenCalledWith(99);
    // Explicitly verify the URL is omitted from the success response to avoid stale URL timing issues
    expect(sendResponse).toHaveBeenCalledWith({ success: true, message: 'Navigated back', tabId: 99 });
  });

  it('fails without explicit tabId from non-content-script sender', async () => {
    const sendResponse = vi.fn();
    onMessageListener({ type: 'EXECUTE_BROWSER_ACTION', payload: { action: { type: 'navigate_forward' } } }, {}, sendResponse);
    await flush();
    expect(sendResponse).toHaveBeenCalledWith({ success: false, message: 'Target tab could not be resolved. Please provide a valid explicit tabId in the payload.' });
  });

  it('reports no eligible tab when only restricted pages are active', async () => {
    const sendResponse = vi.fn();
    chromeMock.tabs.query.mockResolvedValue([{ id: 5, url: 'chrome://extensions', active: true, windowId: 1 }]);
    onMessageListener({ type: 'EXECUTE_BROWSER_ACTION', payload: { action: { type: 'navigate_back' } } }, {}, sendResponse);
    await flush();
    expect(chromeMock.tabs.goBack).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ success: false, message: 'Target tab could not be resolved. Please provide a valid explicit tabId in the payload.' });
  });

  it('rejects an explicit tabId pointing at a restricted page', async () => {
    const sendResponse = vi.fn();
    chromeMock.tabs.get.mockResolvedValue({ id: 8, url: 'chrome://settings' });
    onMessageListener({ type: 'EXECUTE_BROWSER_ACTION', payload: { action: { type: 'navigate_back' }, tabId: 8 } }, {}, sendResponse);
    await flush();
    expect(chromeMock.tabs.goBack).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ success: false, message: 'Tab 8 is a restricted or non-web page' });
  });

  it('surfaces navigation errors directly without falling back to content script', async () => {
    const sendResponse = vi.fn();
    chromeMock.tabs.goBack.mockRejectedValue(new Error('Cannot find a previous page in history.'));
    
    onMessageListener({ type: 'EXECUTE_BROWSER_ACTION', payload: { action: { type: 'navigate_back' }, tabId: 1 } }, {}, sendResponse);
    await flush();
    
    expect(chromeMock.tabs.sendMessage).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ success: false, message: 'Cannot find a previous page in history.', tabId: 1, url: 'https://example.com' });
  });

  it('reports a default error message if goForward fails without an explicit message', async () => {
    const sendResponse = vi.fn();
    chromeMock.tabs.goForward.mockRejectedValue(new Error(''));
    
    onMessageListener({ type: 'EXECUTE_BROWSER_ACTION', payload: { action: { type: 'navigate_forward' }, tabId: 1 } }, {}, sendResponse);
    await flush();
    
    expect(chromeMock.tabs.sendMessage).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ success: false, message: 'Cannot find a next page in history.', tabId: 1, url: 'https://example.com' });
  });

  it('reports target not found if click_element fails in all frames (port closed)', async () => {
    const sendResponse = vi.fn();
    chromeMock.tabs.get.mockResolvedValue({ id: 1, url: 'https://example.com' });
    chromeMock.tabs.sendMessage.mockImplementation((_id: number, _m: any, cb: Function) => {
      chromeMock.runtime.lastError = { message: 'The message port closed before a response was received.' };
      cb();
      delete chromeMock.runtime.lastError;
    });
    
    const action = { type: 'click_element', targetId: '#missing' };
    onMessageListener({ type: 'APPROVE_ACTION', payload: { action } }, { id: chromeMock.runtime.id }, vi.fn());
    onMessageListener({ type: 'EXECUTE_BROWSER_ACTION', payload: { action, tabId: 1 } }, {}, sendResponse);
    await flush();
    
    expect(sendResponse).toHaveBeenCalledWith({ success: false, message: 'Target not found or ambiguous: #missing' });
  });

  it('switches to the next tab in the target tab\'s window', async () => {
    const sendResponse = vi.fn();
    chromeMock.tabs.get.mockImplementation((id: number) => {
      if (id === 10) return Promise.resolve({ id: 10, url: 'https://a.com', windowId: 2 });
      if (id === 11) return Promise.resolve({ id: 11, active: true });
      return Promise.resolve(null);
    });
    chromeMock.tabs.query.mockResolvedValue([
      { id: 10, active: true, windowId: 2 },
      { id: 11, active: false, windowId: 2 },
    ]);
    onMessageListener({ type: 'EXECUTE_BROWSER_ACTION', payload: { action: { type: 'switch_tab', direction: 'next' }, tabId: 10 } }, {}, sendResponse);
    await flush();
    expect(chromeMock.tabs.query).toHaveBeenCalledWith({ windowId: 2 });
    expect(chromeMock.tabs.update).toHaveBeenCalledWith(11, { active: true });
    expect(sendResponse).toHaveBeenCalledWith({ success: true, message: 'Switched to next tab', tabId: 11 });
  });

  it('switches to the previous tab with wraparound', async () => {
    const sendResponse = vi.fn();
    chromeMock.tabs.get.mockImplementation((id: number) => {
      if (id === 10) return Promise.resolve({ id: 10, url: 'https://a.com', windowId: 2 });
      if (id === 12) return Promise.resolve({ id: 12, active: true });
      return Promise.resolve(null);
    });
    chromeMock.tabs.query.mockResolvedValue([
      { id: 10, active: true, windowId: 2 },
      { id: 11, active: false, windowId: 2 },
      { id: 12, active: false, windowId: 2 },
    ]);
    onMessageListener({ type: 'EXECUTE_BROWSER_ACTION', payload: { action: { type: 'switch_tab', direction: 'previous' }, tabId: 10 } }, {}, sendResponse);
    await flush();
    expect(chromeMock.tabs.update).toHaveBeenCalledWith(12, { active: true });
  });

  it('reports failure if the target tab does not become active', async () => {
    const sendResponse = vi.fn();
    chromeMock.tabs.get.mockImplementation((id: number) => {
      if (id === 10) return Promise.resolve({ id: 10, url: 'https://a.com', windowId: 2 });
      if (id === 11) return Promise.resolve({ id: 11, active: false });
      return Promise.resolve(null);
    });
    chromeMock.tabs.query.mockResolvedValue([
      { id: 10, active: true, windowId: 2 },
      { id: 11, active: false, windowId: 2 },
    ]);
    onMessageListener({ type: 'EXECUTE_BROWSER_ACTION', payload: { action: { type: 'switch_tab', direction: 'next' }, tabId: 10 } }, {}, sendResponse);
    await flush();
    expect(chromeMock.tabs.update).toHaveBeenCalledWith(11, { active: true });
    expect(sendResponse).toHaveBeenCalledWith({ success: false, message: 'Failed to verify tab activation' });
  });
});

describe('resolveTargetTab', () => {
  beforeEach(() => {
    chromeMock.tabs.get.mockReset();
    chromeMock.tabs.query.mockReset().mockResolvedValue([]);
    chromeMock.windows.getLastFocused.mockReset().mockResolvedValue({ id: 1 });
  });

  it('rejects non-integer tabIds', async () => {
    expect(await resolveTargetTab('abc')).toEqual({ tab: null, error: 'Invalid tabId: abc' });
    expect(await resolveTargetTab(-1)).toEqual({ tab: null, error: 'Invalid tabId: -1' });
  });

  it('reports missing tabs', async () => {
    chromeMock.tabs.get.mockRejectedValue(new Error('No tab with id'));
    expect(await resolveTargetTab(123)).toEqual({ tab: null, error: 'Tab 123 does not exist' });
  });

  it('prefers sender.tab for content-script requests', async () => {
    const tab = { id: 4, url: 'https://x.com' };
    expect(await resolveTargetTab(undefined, { tab } as any)).toEqual({ tab });
  });

  it('classifies eligible tabs', () => {
    expect(isEligibleWebTab({ id: 1, url: 'https://x.com' } as any)).toBe(true);
    expect(isEligibleWebTab({ id: 1, url: 'chrome-extension://abc/sidepanel.html' } as any)).toBe(false);
    expect(isEligibleWebTab({ id: 1, url: 'devtools://devtools/x' } as any)).toBe(false);
    expect(isEligibleWebTab(undefined)).toBe(false);
  });
});

describe('ChromeActionExecutor tabId forwarding', () => {
  it('attaches the host window active tab id to the message', async () => {
    chromeMock.tabs.query.mockReset().mockResolvedValue([{ id: 77 }]);
    chromeMock.runtime.sendMessage.mockImplementation((_m: any, cb: Function) => cb({ success: true, message: 'ok' }));
    const res = await new ChromeActionExecutor().execute({ type: 'navigate_back' });
    expect(chromeMock.tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith(
      { type: 'EXECUTE_BROWSER_ACTION', payload: { action: { type: 'navigate_back' }, tabId: 77 } },
      expect.any(Function),
    );
    expect(res.success).toBe(true);
  });
});
