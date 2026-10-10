import { describe, it, expect } from 'vitest';
import { MockHandTracker } from '../../src/tracking/hand/mockHandTracker';
import { MockHeadTracker } from '../../src/tracking/head/mockHeadTracker';
import { defaultMockAiClient } from '../../src/ai/mockAiClient';
import { MockTaskMemoryStore } from '../../src/memory/mockTaskMemoryStore';
import { MockBrowserActionExecutor } from '../../src/browser/mockBrowserActionExecutor';

describe('Mock Placeholder Providers (Shared Contracts)', () => {
  it('should initialize and run MockHandTracker lifecycle with TrackingStatus', async () => {
    const tracker = new MockHandTracker();
    expect(tracker.isMock).toBe(true);

    await tracker.initialize();
    expect(tracker.getStatus().state).toBe('idle');

    await tracker.start('hand');
    expect(tracker.getStatus().state).toBe('active');
    expect(tracker.getStatus().mode).toBe('hand');
    expect(tracker.getStatus().confidence).toBeGreaterThan(0.9);

    await tracker.pause();
    expect(tracker.getStatus().state).toBe('paused');

    await tracker.stop();
    expect(tracker.getStatus().state).toBe('idle');
  });

  it('should initialize and run MockHeadTracker lifecycle with TrackingStatus', async () => {
    const tracker = new MockHeadTracker();
    expect(tracker.isMock).toBe(true);

    await tracker.initialize();
    await tracker.start('head');
    expect(tracker.getStatus().mode).toBe('head');
    expect(tracker.getStatus().state).toBe('active');

    await tracker.stop();
    expect(tracker.getStatus().state).toBe('idle');
  });

  it('should generate multilingual replies and plans from MockAiClient', async () => {
    const ai = defaultMockAiClient;
    expect(ai.isMock).toBe(true);

    const enReply = await ai.sendMessage('Search flight tickets', 'en');
    expect(enReply.language).toBe('en');

    const hiReply = await ai.sendMessage('सर्च करो', 'hi');
    expect(hiReply.language).toBe('hi');

    const mrReply = await ai.sendMessage('शोध करा', 'mr');
    expect(mrReply.language).toBe('mr');

    const plan = await ai.generatePlan('find docs', 'en');
    expect(plan.length).toBeGreaterThan(0);
    expect(plan[0].type).toBe('scroll_page');
  });

  it('should store and retrieve tasks in MockTaskMemoryStore', async () => {
    const store = new MockTaskMemoryStore();
    expect(store.isMock).toBe(true);

    const task = await store.createTask('Fill out registration form', 'en');
    expect(task.id).toBeDefined();
    expect(task.status).toBe('pending');

    await store.updateTaskStatus(task.id, 'in_progress');
    const updated = await store.getTask(task.id);
    expect(updated?.status).toBe('in_progress');
  });

  it('should execute valid actions and block invalid actions in MockBrowserActionExecutor', async () => {
    const executor = new MockBrowserActionExecutor();
    expect(executor.isMock).toBe(true);

    // Valid action
    const validResult = await executor.execute({
      type: 'scroll_page',
      direction: 'down',
      amount: 150,
    });
    expect(validResult.success).toBe(true);
    expect(validResult.message).toContain('Scrolled down by 150px');

    // Invalid action
    const invalidResult = await executor.execute({
      type: 'scroll_page',
      direction: 'down',
      amount: -200, // negative amount rejected
    });
    expect(invalidResult.success).toBe(false);
    expect(invalidResult.message).toContain('Validation Error');
  });
});
