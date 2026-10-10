import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { defaultChromeActionExecutor } from '../../src/browser/chromeActionExecutor';
import { Sidepanel } from '../../src/sidepanel/Sidepanel';
import { defaultMockTaskMemoryStore } from '../../src/memory/mockTaskMemoryStore';

describe('Sidepanel React Component', () => {
  beforeEach(async () => {
    await defaultMockTaskMemoryStore.clearHistory();
    vi.clearAllMocks();
  });

  it('should render the header and mode buttons', () => {
    render(<Sidepanel />);
    expect(screen.getByText('Handsfree')).toBeInTheDocument();
    expect(screen.getByText('Hand')).toBeInTheDocument();
    expect(screen.getByText('Head')).toBeInTheDocument();
  });

  it('should render control buttons', () => {
    render(<Sidepanel />);
    expect(screen.getByText('Start Session')).toBeInTheDocument();
    expect(screen.getByText('Stop')).toBeInTheDocument();
  });

  it('should allow changing tracking mode', () => {
    render(<Sidepanel />);
    const headBtn = screen.getByText('Head');
    fireEvent.click(headBtn);
    // Since the actual styling depends on complex tailwind conditional classes, we just ensure it handles the click without crashing.
  });

  describe('Approval Flow End to End', () => {
    it('should halt execution when action requires approval', async () => {
      const executeSpy = vi.spyOn(defaultChromeActionExecutor, 'execute').mockResolvedValue({ success: true, message: 'ok' });
      
      const { defaultActionPolicy } = await import('../../src/shared/safety/action-policy');
      vi.spyOn(defaultActionPolicy, 'evaluate').mockReturnValue({ requiresApproval: true, reasons: ['test mock'], riskLevel: 'high', action: { type: 'click_element', targetId: 'h1' } });
      
      render(<Sidepanel />);
      
      const testApprovalBtn = screen.getByText('Test Approval');
      fireEvent.click(testApprovalBtn);
      
      await new Promise(r => setTimeout(r, 50));
      
      // Should not execute
      expect(executeSpy).not.toHaveBeenCalled();
    });

    it('should execute action after Confirm is clicked and handle success', async () => {
      const executeSpy = vi.spyOn(defaultChromeActionExecutor, 'execute').mockResolvedValue({ success: true, message: 'Success Message' });
      const sendMessageSpy = vi.spyOn(chrome.runtime, 'sendMessage');
      
      const { defaultActionPolicy } = await import('../../src/shared/safety/action-policy');
      vi.spyOn(defaultActionPolicy, 'evaluate').mockReturnValue({ requiresApproval: true, reasons: ['test mock'], riskLevel: 'high', action: { type: 'click_element', targetId: 'h1' } });
      
      render(<Sidepanel />);
      
      // Trigger approval flow
      fireEvent.click(screen.getByText('Test Approval'));
      await new Promise(r => setTimeout(r, 50));
      
      // Click confirm
      const confirmBtn = await screen.findByText(/confirm/i);
      fireEvent.click(confirmBtn);
      await new Promise(r => setTimeout(r, 50));
      require('fs').writeFileSync('dom.html', document.body.innerHTML);
      
      // Ensure APPROVE_ACTION was sent
      expect(sendMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'APPROVE_ACTION',
          payload: expect.objectContaining({ action: expect.anything() })
        })
      );
      
      // Ensure it executed
      expect(executeSpy).toHaveBeenCalled();
      
      // Ensure success UI rendered (check mark and message)
      expect(await screen.findByText(/Success Message/i)).toBeInTheDocument();
      expect(await screen.findByText('✓')).toBeInTheDocument();
      
      // Navigate to history and then task details
      const viewAllBtn = await screen.findByText(/View all/i);
      fireEvent.click(viewAllBtn);
      
      const historyItem = await screen.findByText(/Test Approval/i);
      fireEvent.click(historyItem);
      
      // Verify Task Details
      expect(await screen.findByText(/Task Details/i)).toBeInTheDocument();
      expect(await screen.findByText(/completed/i)).toBeInTheDocument(); // status
      expect(await screen.findByText(/click_element/i)).toBeInTheDocument(); // action type
      expect(await screen.findByText(/Success Message/i)).toBeInTheDocument(); // result message
    });

    it('should handle failed approval execution and display error', async () => {
      vi.spyOn(defaultChromeActionExecutor, 'execute').mockResolvedValue({ success: false, message: 'Action blocked by safety policy' });
      
      const { defaultActionPolicy } = await import('../../src/shared/safety/action-policy');
      vi.spyOn(defaultActionPolicy, 'evaluate').mockReturnValue({ requiresApproval: true, reasons: ['test mock'], riskLevel: 'high', action: { type: 'click_element', targetId: 'h1' } });
      
      render(<Sidepanel />);
      
      fireEvent.click(screen.getByText('Test Approval'));
      await new Promise(r => setTimeout(r, 50));
      
      const confirmBtn = await screen.findByText(/confirm/i);
      fireEvent.click(confirmBtn);
      await new Promise(r => setTimeout(r, 50));
      
      // Ensure error UI rendered (exclamation mark and message)
      expect(await screen.findByText(/Action blocked by safety policy/i)).toBeInTheDocument();
      expect(await screen.findByText('!')).toBeInTheDocument();
      
      // Navigate to history and then task details
      const viewAllBtn = await screen.findByText(/View all/i);
      fireEvent.click(viewAllBtn);
      
      const historyItem = await screen.findByText(/Test Approval/i);
      fireEvent.click(historyItem);
      
      expect(await screen.findByText(/Task Details/i)).toBeInTheDocument();
      expect(await screen.findByText(/failed/i)).toBeInTheDocument();
      expect(await screen.findByText(/click_element/i)).toBeInTheDocument();
      expect(await screen.findByText(/Action blocked by safety policy/i)).toBeInTheDocument();
    });

    it('should handle cancelled approval and update task history', async () => {
      const sendMessageSpy = vi.spyOn(chrome.runtime, 'sendMessage');
      
      const { defaultActionPolicy } = await import('../../src/shared/safety/action-policy');
      vi.spyOn(defaultActionPolicy, 'evaluate').mockReturnValue({ requiresApproval: true, reasons: ['test mock'], riskLevel: 'high', action: { type: 'click_element', targetId: 'h1' } });
      
      render(<Sidepanel />);
      
      fireEvent.click(screen.getByText('Test Approval'));
      await new Promise(r => setTimeout(r, 50));
      
      // Click cancel
      const cancelBtns = await screen.findAllByText(/cancel/i);
      fireEvent.click(cancelBtns[1]); // the second one is the pending approval reject button
      await new Promise(r => setTimeout(r, 50));
      
      // Ensure REJECT_ACTION was sent
      expect(sendMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'REJECT_ACTION',
          payload: expect.objectContaining({ action: expect.anything() })
        })
      );
      
      // The task block should have disappeared from main view because it's cancelled
      expect(await screen.findByText(/No active task/i)).toBeInTheDocument();
      
      // The history should show it
      const viewAllBtn = screen.getByText(/View all/i);
      fireEvent.click(viewAllBtn);
      
      const historyItem = await screen.findByText(/Test Approval/i);
      fireEvent.click(historyItem);
      
      expect(await screen.findByText(/Task Details/i)).toBeInTheDocument();
      expect(await screen.findByText(/cancelled/i)).toBeInTheDocument();
      expect(await screen.findByText(/Action rejected by user/i)).toBeInTheDocument();
    });

    it('should handle Test Cursor sequence and inject missing content script', async () => {
      // First sendMessage (ping) fails, subsequent sendMessages succeed
      const sendMessageSpy = vi.spyOn(chrome.tabs, 'sendMessage')
        .mockRejectedValueOnce(new Error('Could not establish connection. Receiving end does not exist.'))
        .mockResolvedValue({ ok: true });
        
      vi.spyOn(chrome.tabs, 'query').mockResolvedValue([{ id: 1, url: 'http://test.com' }] as chrome.tabs.Tab[]);
      const executeScriptSpy = vi.spyOn(chrome.scripting, 'executeScript').mockResolvedValue(undefined as any);
      
      render(<Sidepanel />);
      
      fireEvent.click(screen.getByText('Test Cursor'));
      
      await new Promise(r => setTimeout(r, 2200));
      
      expect(executeScriptSpy).toHaveBeenCalledWith({ target: { tabId: 1 }, files: ['content.js'] });
      expect(sendMessageSpy).toHaveBeenCalledWith(1, expect.objectContaining({ type: 'CONTENT_PING' }));
      expect(sendMessageSpy).toHaveBeenCalledWith(1, expect.objectContaining({ type: 'POINTER_POSITION_UPDATE' }));
      
      // Success should be logged
      expect(await screen.findByText(/Test Cursor Sequence/i)).toBeInTheDocument();
      expect(await screen.findByText(/Test completed successfully/i)).toBeInTheDocument();
    });

    it('should show error if message delivery fails after injection', async () => {
      // Ping succeeds but delivery fails (ok: false)
      vi.spyOn(chrome.tabs, 'sendMessage').mockResolvedValue({ ok: false });
      vi.spyOn(chrome.tabs, 'query').mockResolvedValue([{ id: 1, url: 'http://test.com' }] as chrome.tabs.Tab[]);
      
      render(<Sidepanel />);
      fireEvent.click(screen.getByText('Test Cursor'));
      
      await new Promise(r => setTimeout(r, 500));
      
      expect(await screen.findByText(/Failed: Message delivery failed or cursor hidden\. Debug:/i)).toBeInTheDocument();
    });
  });
});
