/**
 * Conversational AI and Multi-Step Planner Types
 * Parts B, C, & D: Planning, Tool Validation, Approval Policies, and Cost Tracking
 */

import { BrowserAction, ApprovalMode } from '../shared/types/actions';
import { SupportedLanguage, ConversationMessage } from '../shared/types/assistant';
import { RiskLevel } from '../shared/safety/action-policy';

export interface PageContext {
  url?: string;
  title?: string;
  domSummary?: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface CostEstimate {
  estimatedCostUsd: number;
  modelName: string;
  tokenUsage: TokenUsage;
}

export interface PlannedStep {
  stepNumber: number;
  action: BrowserAction;
  description: string;
  riskLevel: RiskLevel;
  requiresExplicitApproval: boolean;
}

export interface PlanBatch {
  goal: string;
  language: SupportedLanguage;
  steps: PlannedStep[];
  explanation: string;
  costEstimate: CostEstimate;
}

export interface ChatCompletionResponse {
  reply: string;
  suggestedActions?: BrowserAction[];
  costEstimate: CostEstimate;
}

export interface ILLMProvider {
  readonly name: string;
  planTask(
    goal: string,
    language: SupportedLanguage,
    pageContext?: PageContext,
    conversationHistory?: ConversationMessage[]
  ): Promise<PlanBatch>;

  chat(
    prompt: string,
    language: SupportedLanguage,
    history: ConversationMessage[],
    pageContext?: PageContext
  ): Promise<ChatCompletionResponse>;
}

export interface AssistantExecutionCallbacks {
  onStateChange?: (state: string) => void;
  onMessage?: (message: ConversationMessage) => void;
  onStepProgress?: (stepNumber: number, totalSteps: number, action: BrowserAction) => void;
  onApprovalNeeded?: (step: PlannedStep, approve: () => Promise<void>, reject: (reason?: string) => void) => void;
  onError?: (error: string) => void;
}

export interface AssistantConfig {
  defaultLanguage: SupportedLanguage;
  approvalMode: ApprovalMode;
  maxBudgetUsd?: number;
  maxRetries?: number;
}
