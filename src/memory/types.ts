/**
 * Task Memory Types and Extended Contracts
 * Part C: Task Memory, Resumable Tasks, and Checkpoint Auditing
 */

import { BrowserAction, ActionResult } from '../shared/types/actions';
import { SupportedLanguage } from '../shared/types/assistant';
import { TaskRecord, TaskStatus } from '../shared/types/memory';

export interface EnrichedTaskRecord extends TaskRecord {
  summary?: string;
  lastSuccessfulStepIndex?: number;
  lastError?: {
    stepNumber: number;
    message: string;
    suggestedRecovery: string;
    timestamp: number;
  };
  pageContextCheckpoint?: {
    url?: string;
    title?: string;
  };
  totalEstimatedTokens?: number;
}

export interface IExtendedTaskMemoryStore {
  createTask(goal: string, language: SupportedLanguage, initialSteps?: BrowserAction[]): Promise<TaskRecord>;
  getTask(taskId: string): Promise<TaskRecord | null>;
  listTasks(limit?: number): Promise<TaskRecord[]>;
  updateTaskStatus(taskId: string, status: TaskStatus): Promise<void>;
  recordStepResult(taskId: string, stepNumber: number, result: ActionResult, recoveryAdvice?: string): Promise<void>;
  setTaskSteps(taskId: string, actions: BrowserAction[]): Promise<void>;
  deleteTask(taskId: string): Promise<void>;
  clearHistory(): Promise<void>;
}

export interface ResumeDecision {
  canResume: boolean;
  nextStepIndex: number;
  nextAction?: BrowserAction;
  requiresUserConfirmation: boolean;
  reason: string;
}

export interface TaskResumeResult {
  resumed: boolean;
  taskId: string;
  message: string;
  completedSteps: number;
  remainingSteps: number;
}
