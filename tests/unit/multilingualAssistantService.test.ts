import { describe, it, expect, vi } from 'vitest';
import { MultilingualAssistantService } from '../../src/ai/multilingualAssistant';
import { MockBrowserActionExecutor } from '../../src/browser/mockBrowserActionExecutor';
import { ChromeStorageTaskMemoryStore } from '../../src/memory/chromeStorageMemoryStore';

describe('Multilingual Assistant End-to-End Orchestrator', () => {
  it('should process a prompt, formulate plan, and execute mock multi-step actions', async () => {
    const memory = new ChromeStorageTaskMemoryStore();
    await memory.clearHistory();

    const executor = new MockBrowserActionExecutor();
    const service = new MultilingualAssistantService({
      memoryStore: memory,
      executor,
      initialApprovalMode: 'auto',
      initialLanguage: 'en',
    });

    const reply = await service.handleUserPrompt('Search for flight tickets');
    expect(reply.role).toBe('assistant');
    expect(service.getState()).toBe('success');

    const tasks = await memory.listTasks();
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks[0].steps.length).toBeGreaterThan(0);
    expect(tasks[0].steps.every((s) => s.status === 'succeeded')).toBe(true);
  });

  it('should pause in "awaiting_approval" state during "ask" mode and resume upon user approval', async () => {
    const memory = new ChromeStorageTaskMemoryStore();
    await memory.clearHistory();

    const executor = new MockBrowserActionExecutor();
    const service = new MultilingualAssistantService({
      memoryStore: memory,
      executor,
      initialApprovalMode: 'ask',
      initialLanguage: 'en',
    });

    const approvalSpy = vi.fn();
    service.onPendingApproval(approvalSpy);

    // Auto-approve pending steps asynchronously when approval is needed
    service.onPendingApproval((step) => {
      if (step) {
        setTimeout(() => service.approvePendingAction(), 5);
      }
    });

    // Launch task
    await service.handleUserPrompt('Open Google Docs and write document');

    expect(approvalSpy).toHaveBeenCalled();
    expect(service.getState()).toBe('success');
  });

  it('should cancel task when user rejects pending action', async () => {
    const memory = new ChromeStorageTaskMemoryStore();
    await memory.clearHistory();

    const executor = new MockBrowserActionExecutor();
    const service = new MultilingualAssistantService({
      memoryStore: memory,
      executor,
      initialApprovalMode: 'ask',
      initialLanguage: 'en',
    });

    const taskPromise = service.handleUserPrompt('Click search button');
    await new Promise((r) => setTimeout(r, 50));

    expect(service.getState()).toBe('awaiting_approval');

    // User rejects action
    service.rejectPendingAction();

    await taskPromise;
    expect(service.getState()).toBe('idle');
  });
});
