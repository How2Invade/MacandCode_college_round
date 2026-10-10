import { describe, it, expect } from 'vitest';
import {
  ChromeStorageTaskMemoryStore,
  ResumableTaskManager,
  sanitizeBrowserAction,
  sanitizeGoalString,
} from '../../src/memory';
import { MockBrowserActionExecutor } from '../../src/browser/mockBrowserActionExecutor';

describe('Task Memory and Safe Resumption (Part C)', () => {
  it('should redact sensitive credentials from goal strings and actions', () => {
    const rawGoal = 'Login with bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 and token=secret_12345';
    const sanitized = sanitizeGoalString(rawGoal);
    expect(sanitized).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    expect(sanitized).not.toContain('secret_12345');
    expect(sanitized).toContain('[REDACTED]');

    const passwordAction = sanitizeBrowserAction({
      type: 'type_text',
      targetId: 'user-password-input',
      text: 'MySecretPassword123!',
    });
    if (passwordAction.type === 'type_text') {
      expect(passwordAction.text).toBe('[REDACTED_SENSITIVE_INPUT]');
    }

    const tokenUrlAction = sanitizeBrowserAction({
      type: 'open_url',
      url: 'https://example.com/callback?access_token=secret_abc123&code=123',
    });
    if (tokenUrlAction.type === 'open_url') {
      expect(tokenUrlAction.url).not.toContain('secret_abc123');
      expect(tokenUrlAction.url).toContain('access_token=%5BREDACTED%5D');
    }
  });

  it('should manage task lifecycle, checkpoints, and history deletion', async () => {
    const store = new ChromeStorageTaskMemoryStore();
    await store.clearHistory();

    const task = await store.createTask('Fill feedback form', 'en', [
      { type: 'open_url', url: 'https://example.com/form' },
      { type: 'type_text', text: 'Great service!', targetId: 'feedback-area' },
      { type: 'click_element', targetId: 'submit-feedback' },
    ]);

    expect(task.id).toBeDefined();
    expect(task.steps.length).toBe(3);
    expect(task.status).toBe('pending');

    // Record step 1 success
    await store.recordStepResult(task.id, 1, { success: true, message: 'Loaded form' });
    const afterStep1 = await store.getTask(task.id);
    expect(afterStep1?.steps[0].status).toBe('succeeded');
    expect(afterStep1?.currentStepIndex).toBe(1);

    // Delete task
    await store.deleteTask(task.id);
    const afterDelete = await store.getTask(task.id);
    expect(afterDelete).toBeNull();
  });

  it('should assess resumption conditions and prevent blind repetitions', async () => {
    const store = new ChromeStorageTaskMemoryStore();
    await store.clearHistory();

    const task = await store.createTask('Write essay on Google Docs', 'en', [
      { type: 'open_url', url: 'https://docs.new' },
      { type: 'click_element', targetId: 'editor-box' },
      { type: 'type_text', text: 'Introduction text', targetId: 'editor-box' },
    ]);

    const manager = new ResumableTaskManager(store);

    // Step 1 not executed yet
    const assessInitial = manager.assessResumption(task, 'https://docs.new');
    expect(assessInitial.canResume).toBe(true);
    expect(assessInitial.nextStepIndex).toBe(0);

    // Record step 1 success
    await store.recordStepResult(task.id, 1, { success: true, message: 'Opened Docs' });
    const updatedTask = (await store.getTask(task.id))!;

    // Page mismatch detection: active page is unrelated domain
    const assessMismatchedPage = manager.assessResumption(updatedTask, 'https://unrelated-domain.com');
    expect(assessMismatchedPage.requiresUserConfirmation).toBe(true);
    expect(assessMismatchedPage.reason).toContain('does not match expected page');
  });

  it('never marks a task complete when a step fails or later steps are pending', async () => {
    const store = new ChromeStorageTaskMemoryStore();
    await store.clearHistory();
    const task = await store.createTask('Search and open a result', 'en', [
      { type: 'open_url', url: 'https://www.google.com' },
      { type: 'type_text', text: 'test query', targetId: 'search' },
    ]);

    await store.recordStepResult(task.id, 1, { success: false, message: 'Page did not load.' });
    const saved = await store.getTask(task.id);
    expect(saved?.status).toBe('failed');
    expect(saved?.steps[0].status).toBe('failed');
    expect(saved?.steps[1].status).toBe('pending');
  });

  it('should resume unfinished task step by step through browser executor', async () => {
    const store = new ChromeStorageTaskMemoryStore();
    await store.clearHistory();

    const task = await store.createTask('Two-step automation', 'en', [
      { type: 'scroll_page', direction: 'down', amount: 200 },
      { type: 'scroll_page', direction: 'up', amount: 100 },
    ]);

    const executor = new MockBrowserActionExecutor();
    const manager = new ResumableTaskManager(store);

    const result = await manager.resumeTask(task.id, executor, true);
    expect(result.resumed).toBe(true);
    expect(result.completedSteps).toBe(2);
    expect(result.remainingSteps).toBe(0);

    const finished = await store.getTask(task.id);
    expect(finished?.status).toBe('completed');
  });
});
