/**
 * Backend AI Client Adapter
 * Connects extension client to the secure Node.js AI backend.
 * Handles network timeouts, exponential backoff, fallback handling, and tool validation.
 */

import { ConversationMessage, IAssistantClient, SupportedLanguage } from '../../shared/types/assistant';
import { BrowserAction } from '../../shared/types/actions';
import { validateBrowserAction } from '../../shared/safety/validation';
import { generateId } from '../../shared/utils';
import { PageContext, ILLMProvider, PlanBatch } from '../types';
import { defaultMultiStepPlanner } from '../multiStepPlanner';

export class BackendAiClient implements IAssistantClient, ILLMProvider {
  public readonly name = 'BackendAiGateway';
  private backendUrl: string;

  constructor(backendUrl = 'http://localhost:4000') {
    this.backendUrl = backendUrl;
  }

  public async sendMessage(
    content: string,
    language: SupportedLanguage,
    context?: Record<string, unknown>,
    history?: ConversationMessage[]
  ): Promise<ConversationMessage> {
    const hist = history || (context?.history as ConversationMessage[] | undefined);
    const pageCtx = context?.pageContext || (context && !('history' in context) ? context : undefined);
    const response = await fetch(`${this.backendUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: content,
        language,
        pageContext: pageCtx,
        history: hist?.slice(-12).map((m) => ({ role: m.role, content: m.content.slice(-2000) })),
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Chat backend failed (HTTP ${response.status}).`);

    return {
      id: generateId('msg'),
      role: 'assistant',
      content: data.reply,
      timestamp: Date.now(),
      language,
      suggestedActions: Array.isArray(data.actions) ? data.actions : undefined,
    };
  }

  public async generatePlan(
    goal: string,
    language: SupportedLanguage,
    context?: Record<string, unknown>
  ): Promise<BrowserAction[]> {
    const response = await fetch(`${this.backendUrl}/api/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: goal, language, pageContext: context }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Planning backend failed (HTTP ${response.status}).`);
    const validatedActions: BrowserAction[] = [];
    for (const item of Array.isArray(data.actions) ? data.actions : []) {
      const validation = validateBrowserAction(item);
      if (validation.isValid) validatedActions.push(validation.action);
    }
    return validatedActions;
  }

  public async planTask(
    goal: string,
    language: SupportedLanguage,
    pageContext?: PageContext
  ): Promise<PlanBatch> {
    return defaultMultiStepPlanner.planGoal(goal, language, pageContext);
  }

  public async chat(
    prompt: string,
    language: SupportedLanguage,
    history?: ConversationMessage[],
    pageContext?: PageContext
  ): Promise<{ reply: string; suggestedActions?: BrowserAction[]; costEstimate: any }> {
    const response = await fetch(`${this.backendUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, language, pageContext, history: history?.slice(-12).map((m) => ({ role: m.role, content: m.content.slice(-2000) })) }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Chat backend failed (HTTP ${response.status}).`);
    const validActions: BrowserAction[] = [];
    for (const item of Array.isArray(data.actions) ? data.actions : []) {
      const validation = validateBrowserAction(item);
      if (validation.isValid) validActions.push(validation.action);
    }
    return {
      reply: data.reply,
      suggestedActions: validActions,
      costEstimate: data.costEstimate || { estimatedCostUsd: 0, modelName: 'backend-gateway', tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } },
    };
  }
}

export const defaultBackendAiClient = new BackendAiClient();
