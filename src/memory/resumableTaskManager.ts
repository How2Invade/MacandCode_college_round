/**
 * Resumable Task Manager
 * Evaluates checkpoints, verifies page continuity, avoids blind repetitions,
 * and resumes unfinished tasks safely through the shared browser executor.
 */

import { IBrowserActionExecutor } from '../shared/types/actions';
import { TaskRecord } from '../shared/types/memory';
import { logger } from '../shared/utils';
import { IExtendedTaskMemoryStore, ResumeDecision, TaskResumeResult } from './types';

export class ResumableTaskManager {
  constructor(private memoryStore: IExtendedTaskMemoryStore) {}

  /**
   * Determine if an unfinished task can be safely resumed
   */
  public assessResumption(task: TaskRecord, currentPageUrl?: string): ResumeDecision {
    if (task.status === 'completed') {
      return {
        canResume: false,
        nextStepIndex: task.steps.length,
        requiresUserConfirmation: false,
        reason: 'Task is already completed.',
      };
    }

    if (task.steps.length === 0) {
      return {
        canResume: false,
        nextStepIndex: 0,
        requiresUserConfirmation: false,
        reason: 'Task has no planned steps to execute.',
      };
    }

    // Find first unfinished step
    const nextStepIndex = task.steps.findIndex((s) => s.status !== 'succeeded');
    if (nextStepIndex === -1) {
      return {
        canResume: false,
        nextStepIndex: task.steps.length,
        requiresUserConfirmation: false,
        reason: 'All steps in task have succeeded.',
      };
    }

    const nextStep = task.steps[nextStepIndex];
    const prevStep = nextStepIndex > 0 ? task.steps[nextStepIndex - 1] : null;

    // Check if the previous action was an open_url navigation and if current page matches
    let requiresUserConfirmation = false;
    let reason = `Ready to resume from step ${nextStep.stepNumber} of ${task.steps.length}.`;

    if (prevStep && prevStep.action.type === 'open_url' && currentPageUrl) {
      try {
        const expectedHost = new URL(prevStep.action.url).hostname;
        const currentHost = new URL(currentPageUrl).hostname;
        if (expectedHost !== currentHost) {
          requiresUserConfirmation = true;
          reason = `Active page (${currentHost}) does not match expected page (${expectedHost}) from previous step. Please verify before resuming.`;
        }
      } catch {
        // Ignored
      }
    }

    // If step was executing or failed without clear checkpoint, require user confirmation
    if (nextStep.status === 'executing' || nextStep.status === 'failed') {
      requiresUserConfirmation = true;
      reason = `Step ${nextStep.stepNumber} previously status was "${nextStep.status}". Confirming before re-executing action to prevent duplicate side-effects.`;
    }

    return {
      canResume: true,
      nextStepIndex,
      nextAction: nextStep.action,
      requiresUserConfirmation,
      reason,
    };
  }

  /**
   * List all tasks that are paused, pending, or failed and eligible for resumption
   */
  public async listUnfinishedTasks(): Promise<TaskRecord[]> {
    const all = await this.memoryStore.listTasks();
    return all.filter((t) => t.status !== 'completed' && t.status !== 'cancelled');
  }

  /**
   * Safely resume an unfinished task step by step through the browser executor
   */
  public async resumeTask(
    taskId: string,
    executor: IBrowserActionExecutor,
    userConfirmed = false,
    currentPageUrl?: string
  ): Promise<TaskResumeResult> {
    const task = await this.memoryStore.getTask(taskId);
    if (!task) {
      return {
        resumed: false,
        taskId,
        message: `Task ${taskId} not found.`,
        completedSteps: 0,
        remainingSteps: 0,
      };
    }

    const assessment = this.assessResumption(task, currentPageUrl);
    if (!assessment.canResume) {
      return {
        resumed: false,
        taskId,
        message: assessment.reason,
        completedSteps: task.currentStepIndex,
        remainingSteps: 0,
      };
    }

    if (assessment.requiresUserConfirmation && !userConfirmed) {
      return {
        resumed: false,
        taskId,
        message: `Confirmation required: ${assessment.reason}`,
        completedSteps: assessment.nextStepIndex,
        remainingSteps: task.steps.length - assessment.nextStepIndex,
      };
    }

    await this.memoryStore.updateTaskStatus(taskId, 'in_progress');
    logger.info('ResumableTaskManager', `Resuming task ${taskId} from step index ${assessment.nextStepIndex}`);

    let executedCount = 0;
    for (let i = assessment.nextStepIndex; i < task.steps.length; i++) {
      const step = task.steps[i];
      try {
        const result = await executor.execute(step.action);
        await this.memoryStore.recordStepResult(taskId, step.stepNumber, result);
        if (!result.success) {
          await this.memoryStore.updateTaskStatus(taskId, 'failed');
          return {
            resumed: true,
            taskId,
            message: `Task paused at step ${step.stepNumber}: ${result.message}`,
            completedSteps: assessment.nextStepIndex + executedCount,
            remainingSteps: task.steps.length - (assessment.nextStepIndex + executedCount),
          };
        }
        executedCount++;
      } catch (err) {
        const errorResult = {
          success: false,
          message: `Execution exception: ${(err as Error).message}`,
        };
        await this.memoryStore.recordStepResult(taskId, step.stepNumber, errorResult);
        await this.memoryStore.updateTaskStatus(taskId, 'failed');
        return {
          resumed: true,
          taskId,
          message: errorResult.message,
          completedSteps: assessment.nextStepIndex + executedCount,
          remainingSteps: task.steps.length - (assessment.nextStepIndex + executedCount),
        };
      }
    }

    await this.memoryStore.updateTaskStatus(taskId, 'completed');
    return {
      resumed: true,
      taskId,
      message: 'All remaining steps completed successfully.',
      completedSteps: task.steps.length,
      remainingSteps: 0,
    };
  }

  public async deleteTask(taskId: string): Promise<void> {
    await this.memoryStore.deleteTask(taskId);
  }

  public async clearAll(): Promise<void> {
    await this.memoryStore.clearHistory();
  }
}
