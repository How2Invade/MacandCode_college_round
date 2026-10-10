import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

const chromeMock = {
  runtime: {
    id: 'mock-extension-id',
    getManifest: vi.fn().mockReturnValue({}),
    onMessage: {
      addListener: vi.fn(),
    },
    sendMessage: vi.fn(),
  },
  sidePanel: { setPanelBehavior: vi.fn().mockResolvedValue(undefined) },
  tabs: {
    get: vi.fn(),
    query: vi.fn(),
    sendMessage: vi.fn(),
  },
  windows: {
    getLastFocused: vi.fn(),
  },
};

(global as any).chrome = chromeMock;

describe('Background Action Authorization', () => {
  let onMessageListener: Function;

  beforeAll(async () => {
    // Import the background script dynamically after mocking chrome
    await import('../../src/background/index' as any);
    // Capture the listener registered by the background script
    onMessageListener = chromeMock.runtime.onMessage.addListener.mock.calls[0][0];
  });

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Reset approval mode to 'ask' before each test
    onMessageListener({
      type: 'SET_APPROVAL_MODE',
      payload: { mode: 'ask' }
    }, { id: 'mock-extension-id' }, vi.fn());
  });

  const sendActionMessage = async (action: any, senderOverrides: any = {}) => {
    const sendResponse = vi.fn();
    const sender = { id: 'mock-extension-id', ...senderOverrides };
    onMessageListener({
      type: 'EXECUTE_BROWSER_ACTION',
      payload: { action }
    }, sender, sendResponse);
    
    // flush microtasks
    await new Promise(process.nextTick);
    return sendResponse;
  };

  const approveAction = async (action: any, senderOverrides: any = {}) => {
    const sendResponse = vi.fn();
    const sender = { id: 'mock-extension-id', ...senderOverrides };
    onMessageListener({
      type: 'APPROVE_ACTION',
      payload: { action }
    }, sender, sendResponse);
    await new Promise(process.nextTick);
  };

  it('blocks unapproved sensitive actions (Direct message bypass attempt)', async () => {
    const action = { type: 'click_element', targetId: '#checkout' };
    const sendResponse = await sendActionMessage(action);
    
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      message: 'Action blocked by safety policy: requires user approval.',
    });
  });

  it('allows sensitive actions if explicitly approved', async () => {
    const action = { type: 'click_element', targetId: '#checkout' };
    
    // 1. Approve it
    await approveAction(action);
    
    // 2. Execute it
    const sendResponse = await sendActionMessage(action);
    
    expect(sendResponse).not.toHaveBeenCalledWith(expect.objectContaining({
      message: 'Action blocked by safety policy: requires user approval.'
    }));
    expect(sendResponse).toHaveBeenCalledWith({ success: false, message: 'Target tab could not be resolved. Please provide a valid explicit tabId in the payload.' });
  });

  it('consumes approvals so they cannot be replayed', async () => {
    const action = { type: 'click_element', targetId: '#checkout' };
    await approveAction(action);
    
    await sendActionMessage(action); // First time allowed
    const sendResponse = await sendActionMessage(action); // Second time blocked
    
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      message: 'Action blocked by safety policy: requires user approval.',
    });
  });

  it('ignores forged approval flags in the payload', async () => {
    const action = { type: 'click_element', targetId: '#checkout', approved: true };
    const sendResponse = await sendActionMessage(action);
    
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      message: 'Action blocked by safety policy: requires user approval.',
    });
  });

  it('ignores approvals from untrusted senders (e.g. content scripts)', async () => {
    const action = { type: 'click_element', targetId: '#checkout' };
    
    await approveAction(action, { tab: { id: 1 } });
    
    const sendResponse = await sendActionMessage(action);
    
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      message: 'Action blocked by safety policy: requires user approval.',
    });
  });

  it('blocks high-risk actions even in auto mode if not approved', async () => {
    onMessageListener({
      type: 'SET_APPROVAL_MODE',
      payload: { mode: 'auto' }
    }, { id: 'mock-extension-id' }, vi.fn());

    const action = { type: 'click_element', targetId: '#pay-now' };
    const sendResponse = await sendActionMessage(action);
    
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      message: 'Action blocked by safety policy: requires user approval.',
    });
  });

  it('allows safe actions without approval in both modes', async () => {
    const action = { type: 'navigate_back' };
    
    onMessageListener({
      type: 'SET_APPROVAL_MODE',
      payload: { mode: 'ask' }
    }, { id: 'mock-extension-id' }, vi.fn());
    let sendResponse = await sendActionMessage(action);
    expect(sendResponse).not.toHaveBeenCalledWith(expect.objectContaining({
      message: 'Action blocked by safety policy: requires user approval.'
    }));

    onMessageListener({
      type: 'SET_APPROVAL_MODE',
      payload: { mode: 'auto' }
    }, { id: 'mock-extension-id' }, vi.fn());
    sendResponse = await sendActionMessage(action);
    expect(sendResponse).not.toHaveBeenCalledWith(expect.objectContaining({
      message: 'Action blocked by safety policy: requires user approval.'
    }));
  });

  it('blocks malformed or invalid action payloads', async () => {
    let sendResponse = await sendActionMessage(null);
    expect(sendResponse).toHaveBeenCalledWith({ success: false, message: 'Invalid or malformed action payload' });

    sendResponse = await sendActionMessage({});
    expect(sendResponse).toHaveBeenCalledWith({ success: false, message: 'Invalid or malformed action payload' });

    sendResponse = await sendActionMessage("not an object");
    expect(sendResponse).toHaveBeenCalledWith({ success: false, message: 'Invalid or malformed action payload' });
  });
});
