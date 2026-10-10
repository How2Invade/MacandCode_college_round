/**
 * Chrome Storage Task Memory Store
 * Persists structured task plans, step results, and checkpoints to chrome.storage.local
 * with fallback to memory/localStorage when run in test/standalone environments.
 */

import { BrowserAction, ActionResult } from '../shared/types/actions';
import { SupportedLanguage } from '../shared/types/assistant';
import { TaskRecord, TaskStatus, TaskStepRecord } from '../shared/types/memory';
import { generateId, logger } from '../shared/utils';
import { IExtendedTaskMemoryStore, EnrichedTaskRecord } from './types';
import { sanitizeBrowserAction, sanitizeGoalString } from './privacySanitizer';

const STORAGE_KEY = 'handsfree_task_history_v1';

export class ChromeStorageTaskMemoryStore implements IExtendedTaskMemoryStore {
  private inMemoryCache: Map<string, EnrichedTaskRecord> = new Map();
  private isLoaded = false;

  constructor() {
    this.loadFromStorage();
  }

  private async loadFromStorage(): Promise<void> {
    if (this.isLoaded) return;

    try {
      if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
        const result = await chrome.storage.local.get(STORAGE_KEY);
        const stored: EnrichedTaskRecord[] = result[STORAGE_KEY] || [];
        for (const item of stored) {
          this.inMemoryCache.set(item.id, item);
        }
      } else if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const stored: EnrichedTaskRecord[] = JSON.parse(raw);
          for (const item of stored) {
            this.inMemoryCache.set(item.id, item);
          }
        }
      }
    } catch (err) {
      logger.warn('ChromeStorageTaskMemoryStore', 'Failed to load from storage, using memory cache', err);
    } finally {
      this.isLoaded = true;
    }
  }

  private async syncToStorage(): Promise<void> {
    const list = Array.from(this.inMemoryCache.values());
    try {
      if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
        await chrome.storage.local.set({ [STORAGE_KEY]: list });
      } else if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
      }
    } catch (err) {
      logger.error('ChromeStorageTaskMemoryStore', 'Failed to sync tasks to storage', err);
    }
  }

  public async createTask(
    goal: string,
    language: SupportedLanguage,
    initialSteps?: BrowserAction[]
  ): Promise<TaskRecord> {
    await this.loadFromStorage();

    const cleanGoal = sanitizeGoalString(goal);
    const id = generateId('task');
    const now = Date.now();

    const steps: TaskStepRecord[] = (initialSteps || []).map((action, idx) => ({
      stepNumber: idx + 1,
      action: sanitizeBrowserAction(action),
      result: null,
      status: 'pending',
      timestamp: now,
    }));

    const task: EnrichedTaskRecord = {
      id,
      title: cleanGoal.slice(0, 48) || 'Untitled Task',
      goal: cleanGoal,
      language,
      status: 'pending',
      steps,
      currentStepIndex: 0,
      lastSuccessfulStepIndex: -1,
      createdAt: now,
      updatedAt: now,
    };

    this.inMemoryCache.set(id, task);
    await this.syncToStorage();
    logger.info('ChromeStorageTaskMemoryStore', `Created task: ${id} ("${task.title}")`);
    return { ...task };
  }

  public async setTaskSteps(taskId: string, actions: BrowserAction[]): Promise<void> {
    await this.loadFromStorage();
    const task = this.inMemoryCache.get(taskId);
    if (!task) return;

    task.steps = actions.map((action, idx) => ({
      stepNumber: idx + 1,
      action: sanitizeBrowserAction(action),
      result: null,
      status: 'pending',
      timestamp: Date.now(),
    }));
    task.updatedAt = Date.now();
    await this.syncToStorage();
  }

  public async getTask(taskId: string): Promise<TaskRecord | null> {
    await this.loadFromStorage();
    const task = this.inMemoryCache.get(taskId);
    return task ? { ...task } : null;
  }

  public async listTasks(limit = 20): Promise<TaskRecord[]> {
    await this.loadFromStorage();
    const all = Array.from(this.inMemoryCache.values()).sort((a, b) => b.createdAt - a.createdAt);
    return all.slice(0, limit).map((t) => ({ ...t }));
  }

  public async updateTaskStatus(taskId: string, status: TaskStatus): Promise<void> {
    await this.loadFromStorage();
    const task = this.inMemoryCache.get(taskId);
    if (task) {
      task.status = status;
      task.updatedAt = Date.now();
      await this.syncToStorage();
      logger.info('ChromeStorageTaskMemoryStore', `Updated task ${taskId} status: ${status}`);
    }
  }

  public async recordStepResult(
    taskId: string,
    stepNumber: number,
    result: ActionResult,
    recoveryAdvice?: string
  ): Promise<void> {
    await this.loadFromStorage();
    const task = this.inMemoryCache.get(taskId);
    if (!task) return;

    const stepIndex = task.steps.findIndex((s) => s.stepNumber === stepNumber);
    if (stepIndex >= 0) {
      const step = task.steps[stepIndex];
      step.result = result;
      step.status = result.success ? 'succeeded' : 'failed';
      step.timestamp = Date.now();

      if (result.success) {
        task.currentStepIndex = stepIndex + 1;
        task.lastSuccessfulStepIndex = stepIndex;
      } else {
        task.lastError = {
          stepNumber,
          message: result.message,
          suggestedRecovery: recoveryAdvice || 'Inspect previous action or refresh target webpage',
          timestamp: Date.now(),
        };
      }
    }

    // Check if all steps completed
    const allComplete = task.steps.length > 0 && task.steps.every((s) => s.status === 'succeeded');
    if (allComplete) {
      task.status = 'completed';
    } else if (result.success === false) {
      task.status = 'failed';
    }

    task.updatedAt = Date.now();
    await this.syncToStorage();
  }

  public async deleteTask(taskId: string): Promise<void> {
    await this.loadFromStorage();
    if (this.inMemoryCache.has(taskId)) {
      this.inMemoryCache.delete(taskId);
      await this.syncToStorage();
      logger.info('ChromeStorageTaskMemoryStore', `Deleted task: ${taskId}`);
    }
  }

  public async clearHistory(): Promise<void> {
    this.inMemoryCache.clear();
    await this.syncToStorage();
    logger.info('ChromeStorageTaskMemoryStore', 'Cleared all task history.');
  }
}

export const defaultChromeStorageTaskMemoryStore = new ChromeStorageTaskMemoryStore();
