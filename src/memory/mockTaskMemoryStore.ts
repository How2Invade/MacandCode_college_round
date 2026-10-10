/**
 * MOCK IMPLEMENTATION: MockTaskMemoryStore
 *
 * NOTE: Placeholder for task memory and step execution history.
 * Uses shared BrowserAction and ActionResult contracts.
 */

import {
  ITaskMemoryStore,
  TaskRecord,
  TaskStatus,
} from '../shared/types/memory';
import { ActionResult, BrowserAction } from '../shared/types/actions';
import { SupportedLanguage } from '../shared/types/assistant';
import { generateId, logger } from '../shared/utils';

export class MockTaskMemoryStore implements ITaskMemoryStore {
  public readonly isMock = true;
  private tasks: Map<string, TaskRecord> = new Map();

  constructor() {
    // Seed with a sample mock task for immediate UI preview
    const sampleTask: TaskRecord = {
      id: 'task_sample_01',
      title: 'Navigate to search results',
      goal: 'Find top developer news',
      language: 'en',
      status: 'completed',
      steps: [
        {
          stepNumber: 1,
          action: {
            type: 'scroll_page',
            direction: 'down',
            amount: 250,
          },
          result: {
            success: true,
            message: 'Scrolled down 250px',
          },
          status: 'succeeded',
          timestamp: Date.now() - 60000,
        },
      ],
      currentStepIndex: 1,
      createdAt: Date.now() - 60000,
      updatedAt: Date.now() - 55000,
    };
    this.tasks.set(sampleTask.id, sampleTask);
  }

  public async createTask(goal: string, language: SupportedLanguage): Promise<TaskRecord> {
    const task: TaskRecord = {
      id: generateId('task'),
      title: goal.slice(0, 40) || 'Untitled Task',
      goal,
      language,
      status: 'pending',
      steps: [],
      currentStepIndex: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.tasks.set(task.id, task);
    logger.info('MockTaskMemoryStore', `Created task: ${task.id} (${task.goal})`);
    return { ...task };
  }

  public async getTask(taskId: string): Promise<TaskRecord | null> {
    const task = this.tasks.get(taskId);
    return task ? { ...task } : null;
  }

  public async listTasks(limit = 10): Promise<TaskRecord[]> {
    const all = Array.from(this.tasks.values()).sort((a, b) => b.createdAt - a.createdAt);
    return all.slice(0, limit);
  }

  public async updateTaskStatus(taskId: string, status: TaskStatus): Promise<void> {
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = status;
      task.updatedAt = Date.now();
      logger.info('MockTaskMemoryStore', `Updated task ${taskId} status to ${status}`);
    }
  }

  public async addStep(taskId: string, action: BrowserAction): Promise<number> {
    const task = this.tasks.get(taskId);
    if (!task) return -1;
    
    const stepNumber = task.steps.length + 1;
    task.steps.push({
      stepNumber,
      action,
      result: null,
      status: 'pending',
      timestamp: Date.now(),
    });
    task.updatedAt = Date.now();
    logger.info('MockTaskMemoryStore', `Added step ${stepNumber} to task ${taskId}`);
    return stepNumber;
  }

  public async recordStepResult(
    taskId: string,
    stepNumber: number,
    result: ActionResult
  ): Promise<void> {
    const task = this.tasks.get(taskId);
    if (task) {
      const step = task.steps.find((s) => s.stepNumber === stepNumber);
      if (step) {
        step.result = result;
        step.status = result.success ? 'succeeded' : 'failed';
      }
      task.updatedAt = Date.now();
    }
  }

  public async clearHistory(): Promise<void> {
    this.tasks.clear();
    logger.info('MockTaskMemoryStore', 'Cleared all task history');
  }
}

export const defaultMockTaskMemoryStore = new MockTaskMemoryStore();
