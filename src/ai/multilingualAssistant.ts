/**
 * Multilingual Assistant Service
 * The primary orchestrator for handsfree conversational AI:
 * - Coordinates Multilingual Voice Input/Output (en, hi, mr)
 * - Multi-Step Task Planning & Zod Tool Validation
 * - Human Approval / Auto-Allow Policy Enforcement
 * - Checkpointing & Resumable Task Memory
 * - Execution through shared IBrowserActionExecutor
 */

import { BrowserAction, ActionResult, IBrowserActionExecutor, AssistantState, ApprovalMode } from '../shared/types/actions';
import { SupportedLanguage, ConversationMessage, ConversationRole } from '../shared/types/assistant';
import { generateId, logger } from '../shared/utils';
import { VoicePipeline } from '../voice/voicePipeline';
import { MultiStepPlanner, defaultMultiStepPlanner } from './multiStepPlanner';
import { ApprovalPolicyEnforcer, defaultApprovalPolicyEnforcer } from './policyEnforcer';
import { CostTracker, defaultCostTracker } from './costTracker';
import { IExtendedTaskMemoryStore } from '../memory/types';
import { defaultChromeStorageTaskMemoryStore } from '../memory/chromeStorageMemoryStore';
import { PlannedStep, PageContext } from './types';

export interface AssistantServiceOptions {
  planner?: MultiStepPlanner;
  policyEnforcer?: ApprovalPolicyEnforcer;
  memoryStore?: IExtendedTaskMemoryStore;
  voicePipeline?: VoicePipeline;
  costTracker?: CostTracker;
  executor?: IBrowserActionExecutor;
  initialLanguage?: SupportedLanguage;
  initialApprovalMode?: ApprovalMode;
}

export class MultilingualAssistantService {
  private planner: MultiStepPlanner;
  private policyEnforcer: ApprovalPolicyEnforcer;
  private memoryStore: IExtendedTaskMemoryStore;
  private voicePipeline: VoicePipeline;
  private costTracker: CostTracker;
  private executor?: IBrowserActionExecutor;

  private state: AssistantState = 'idle';
  private currentLanguage: SupportedLanguage;
  private messages: ConversationMessage[] = [];
  private activeTaskId: string | null = null;
  private pendingApprovalStep: PlannedStep | null = null;
  private pendingApprovalResolver: ((approved: boolean) => void) | null = null;

  // Listeners for UI state binding (e.g. Sanika's Sidepanel)
  private stateListeners: ((state: AssistantState) => void)[] = [];
  private messageListeners: ((msg: ConversationMessage) => void)[] = [];
  private pendingApprovalListeners: ((step: PlannedStep | null) => void)[] = [];

  constructor(options: AssistantServiceOptions = {}) {
    this.currentLanguage = options.initialLanguage || 'en';
    this.planner = options.planner || defaultMultiStepPlanner;
    this.policyEnforcer = options.policyEnforcer || defaultApprovalPolicyEnforcer;
    this.memoryStore = options.memoryStore || defaultChromeStorageTaskMemoryStore;
    this.voicePipeline = options.voicePipeline || new VoicePipeline({ initialLanguage: this.currentLanguage });
    this.costTracker = options.costTracker || defaultCostTracker;
    this.executor = options.executor;

    if (options.initialApprovalMode) {
      this.policyEnforcer.setApprovalMode(options.initialApprovalMode);
    }

    this.wireVoiceEvents();
  }

  private wireVoiceEvents(): void {
    // When a final voice transcript arrives from microphone capture, process as user message
    this.voicePipeline.onTranscript((result) => {
      if (result.isFinal && result.transcript.trim()) {
        this.handleUserPrompt(result.transcript.trim());
      }
    });

    this.voicePipeline.onError((err) => {
      if (this.state === 'listening') {
        this.setState('error');
      }
      logger.warn('MultilingualAssistantService', `Voice pipeline error: ${err}`);
    });
  }

  public setBrowserExecutor(executor: IBrowserActionExecutor): void {
    this.executor = executor;
  }

  public setLanguage(language: SupportedLanguage): void {
    this.currentLanguage = language;
    this.voicePipeline.setLanguage(language);
    logger.info('MultilingualAssistantService', `Language changed to: [${language}]`);
  }

  public getLanguage(): SupportedLanguage {
    return this.currentLanguage;
  }

  public setApprovalMode(mode: ApprovalMode): void {
    this.policyEnforcer.setApprovalMode(mode);
  }

  public getApprovalMode(): ApprovalMode {
    return this.policyEnforcer.getApprovalMode();
  }

  public getState(): AssistantState {
    return this.state;
  }

  public getActiveTaskId(): string | null {
    return this.activeTaskId;
  }

  public getMessages(): ConversationMessage[] {
    return [...this.messages];
  }

  public getPendingApprovalStep(): PlannedStep | null {
    return this.pendingApprovalStep;
  }

  public getCostTracker(): CostTracker {
    return this.costTracker;
  }

  /**
   * Main entrypoint: Processes user prompt (from voice or text input)
   */
  public async handleUserPrompt(
    promptText: string,
    pageContext?: PageContext
  ): Promise<ConversationMessage> {
    if (!promptText.trim()) {
      throw new Error('Prompt cannot be empty');
    }

    // 1. Add user message
    this.appendMessage('user', promptText);

    // 2. Transition state to 'thinking'
    this.setState('thinking');

    try {
      // 3. Formulate multi-step action plan using MultiStepPlanner
      const planBatch = await this.planner.planGoal(
        promptText,
        this.currentLanguage,
        pageContext,
        this.messages
      );

      // 4. Record task in persistent memory
      const initialActions = planBatch.steps.map((s) => s.action);
      const taskRecord = await this.memoryStore.createTask(
        promptText,
        this.currentLanguage,
        initialActions
      );
      this.activeTaskId = taskRecord.id;

      // 5. Add assistant reply acknowledging plan
      const replyMessage = this.appendMessage('assistant', planBatch.explanation, initialActions);

      // 6. Speak assistant reply asynchronously
      this.voicePipeline.speak(planBatch.explanation, this.currentLanguage);

      // 7. Execute planned actions if an executor is wired up
      if (this.executor && planBatch.steps.length > 0) {
        await this.executePlanBatch(planBatch.steps, taskRecord.id, pageContext);
      } else {
        this.setState('success');
      }

      return replyMessage;
    } catch (err) {
      this.setState('error');
      const errorMsg = `Error: ${(err as Error).message}`;
      const errReply = this.appendMessage('assistant', errorMsg);
      this.voicePipeline.speak(errorMsg, this.currentLanguage);
      return errReply;
    }
  }

  /**
   * Sequentially executes planned steps with policy checks and approval gates
   */
  private async executePlanBatch(
    steps: PlannedStep[],
    taskId: string,
    pageContext?: PageContext
  ): Promise<void> {
    if (!this.executor) return;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      // Re-evaluate approval policy dynamically before each step
      const policyDecision = this.policyEnforcer.evaluateAction(step.action);

      if (policyDecision.requiresApproval) {
        this.setState('awaiting_approval');
        this.pendingApprovalStep = step;
        this.emitPendingApproval(step);

        // Prompt the user in chosen language
        const promptSpeech = this.voicePipeline.getLocalizedText('approvalRequired');
        this.voicePipeline.speak(promptSpeech, this.currentLanguage);

        // Await user approval or rejection
        const isApproved = await new Promise<boolean>((resolve) => {
          this.pendingApprovalResolver = resolve;
        });

        this.pendingApprovalStep = null;
        this.pendingApprovalResolver = null;
        this.emitPendingApproval(null);

        if (!isApproved) {
          this.setState('idle');
          const cancelMsg = this.voicePipeline.getLocalizedText('cancelled');
          this.appendMessage('system', cancelMsg);
          this.voicePipeline.speak(cancelMsg, this.currentLanguage);
          await this.memoryStore.updateTaskStatus(taskId, 'cancelled');
          return;
        }
      }

      // Precondition verification
      if (!this.policyEnforcer.verifyPagePrecondition(step.action, pageContext?.url)) {
        this.setState('error');
        await this.memoryStore.recordStepResult(taskId, step.stepNumber, {
          success: false,
          message: 'Page precondition check failed before action execution.',
        });
        return;
      }

      // Execute through Sanika's shared browser executor
      this.setState('executing');
      try {
        const result: ActionResult = await this.executor.execute(step.action);
        await this.memoryStore.recordStepResult(taskId, step.stepNumber, result);

        if (!result.success) {
          this.setState('error');
          const failMsg = `Action failed: ${result.message}`;
          this.appendMessage('assistant', failMsg);
          return;
        }
      } catch (execErr) {
        this.setState('error');
        const failMsg = `Action error: ${(execErr as Error).message}`;
        await this.memoryStore.recordStepResult(taskId, step.stepNumber, {
          success: false,
          message: failMsg,
        });
        return;
      }
    }

    this.setState('success');
    const successMsg = this.voicePipeline.getLocalizedText('success');
    this.voicePipeline.speak(successMsg, this.currentLanguage);
  }

  /**
   * User approval resolution from UI button
   */
  public approvePendingAction(): void {
    if (this.pendingApprovalResolver) {
      this.pendingApprovalResolver(true);
    }
  }

  /**
   * User rejection resolution from UI button
   */
  public rejectPendingAction(): void {
    if (this.pendingApprovalResolver) {
      this.pendingApprovalResolver(false);
    }
  }

  /**
   * Start voice capture
   */
  public async startListening(): Promise<void> {
    await this.voicePipeline.startListening();
    this.setState('listening');
  }

  /**
   * Stop voice capture
   */
  public async stopListening(): Promise<void> {
    await this.voicePipeline.stopListening();
    if (this.state === 'listening') {
      this.setState('idle');
    }
  }

  // Event emitters
  public onStateChange(listener: (state: AssistantState) => void): () => void {
    this.stateListeners.push(listener);
    return () => {
      this.stateListeners = this.stateListeners.filter((l) => l !== listener);
    };
  }

  public onMessage(listener: (msg: ConversationMessage) => void): () => void {
    this.messageListeners.push(listener);
    return () => {
      this.messageListeners = this.messageListeners.filter((l) => l !== listener);
    };
  }

  public onPendingApproval(listener: (step: PlannedStep | null) => void): () => void {
    this.pendingApprovalListeners.push(listener);
    return () => {
      this.pendingApprovalListeners = this.pendingApprovalListeners.filter((l) => l !== listener);
    };
  }

  private appendMessage(
    role: ConversationRole,
    content: string,
    suggestedActions?: BrowserAction[]
  ): ConversationMessage {
    const msg: ConversationMessage = {
      id: generateId('msg'),
      role,
      content,
      timestamp: Date.now(),
      language: this.currentLanguage,
      suggestedActions,
    };
    this.messages.push(msg);
    for (const listener of this.messageListeners) {
      try {
        listener(msg);
      } catch (err) {
        logger.error('MultilingualAssistantService', 'Error in message listener', err);
      }
    }
    return msg;
  }

  private setState(newState: AssistantState): void {
    this.state = newState;
    for (const listener of this.stateListeners) {
      try {
        listener(newState);
      } catch (err) {
        logger.error('MultilingualAssistantService', 'Error in state listener', err);
      }
    }
  }

  private emitPendingApproval(step: PlannedStep | null): void {
    for (const listener of this.pendingApprovalListeners) {
      try {
        listener(step);
      } catch (err) {
        logger.error('MultilingualAssistantService', 'Error in pending approval listener', err);
      }
    }
  }
}

export const defaultMultilingualAssistantService = new MultilingualAssistantService();
