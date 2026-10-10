/**
 * Task Memory & Execution History Interfaces
 * Shared contract for task planning and step auditing.
 */

import { BrowserAction, ActionResult } from './actions';
import { SupportedLanguage } from './assistant';

export type TaskStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'paused';

export interface TaskStepRecord {
  stepNumber: number;
  action: BrowserAction;
  result: ActionResult | null;
  status: 'pending' | 'executing' | 'succeeded' | 'failed' | 'skipped';
  timestamp: number;
}

export interface TaskRecord {
  id: string;
  title: string;
  goal: string;
  language: SupportedLanguage;
  status: TaskStatus;
  steps: TaskStepRecord[];
  currentStepIndex: number;
  createdAt: number;
  updatedAt: number;
}

export interface ITaskMemoryStore {
  createTask(goal: string, language: SupportedLanguage): Promise<TaskRecord>;
  getTask(taskId: string): Promise<TaskRecord | null>;
  listTasks(limit?: number): Promise<TaskRecord[]>;
  updateTaskStatus(taskId: string, status: TaskStatus): Promise<void>;
  addStep(taskId: string, action: BrowserAction): Promise<number>;
  recordStepResult(taskId: string, stepNumber: number, result: ActionResult): Promise<void>;
  clearHistory(): Promise<void>;
}
