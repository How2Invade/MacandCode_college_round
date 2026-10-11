/**
 * AI Cost and Token Usage Tracker
 * Part B: Cost control, budget enforcement, retry limits, and usage estimation.
 */

import { CostEstimate } from './types';
import { logger } from '../shared/utils';

export interface ModelPricing {
  promptCostPerMillion: number;
  completionCostPerMillion: number;
}

export const MODEL_PRICING_TABLE: Record<string, ModelPricing> = {
  'gemini-1.5-flash': {
    promptCostPerMillion: 0.075,
    completionCostPerMillion: 0.30,
  },
  'gemini-1.5-pro': {
    promptCostPerMillion: 3.50,
    completionCostPerMillion: 10.50,
  },
  'gpt-4o-mini': {
    promptCostPerMillion: 0.15,
    completionCostPerMillion: 0.60,
  },
  mock: {
    promptCostPerMillion: 0.0,
    completionCostPerMillion: 0.0,
  },
};

export class CostTracker {
  private totalPromptTokens = 0;
  private totalCompletionTokens = 0;
  private totalEstimatedCostUsd = 0;
  private requestCount = 0;
  private budgetCapUsd: number;
  private maxRetries: number;

  constructor(options: { budgetCapUsd?: number; maxRetries?: number } = {}) {
    this.budgetCapUsd = options.budgetCapUsd ?? 1.0; // Default $1.00 budget cap
    this.maxRetries = options.maxRetries ?? 3;
  }

  /**
   * Approximates token count based on character length (~4 chars per token for English,
   * ~1.5 to 2 chars per token for Indic scripts like Hindi and Marathi).
   */
  public estimateTokens(text: string, isIndic = false): number {
    if (!text) return 0;
    const charsPerToken = isIndic ? 2 : 4;
    return Math.max(1, Math.ceil(text.length / charsPerToken));
  }

  /**
   * Calculates dollar cost for token usage against a given model pricing tier
   */
  public calculateCost(
    promptTokens: number,
    completionTokens: number,
    modelName = 'gemini-1.5-flash'
  ): CostEstimate {
    const pricing = MODEL_PRICING_TABLE[modelName] || MODEL_PRICING_TABLE['gemini-1.5-flash'];
    const promptCost = (promptTokens / 1_000_000) * pricing.promptCostPerMillion;
    const completionCost = (completionTokens / 1_000_000) * pricing.completionCostPerMillion;
    const estimatedCostUsd = Math.round((promptCost + completionCost) * 1_000_000) / 1_000_000;

    return {
      estimatedCostUsd,
      modelName,
      tokenUsage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
    };
  }

  /**
   * Records completed request and enforces budget limits
   */
  public recordUsage(estimate: CostEstimate): void {
    this.totalPromptTokens += estimate.tokenUsage.promptTokens;
    this.totalCompletionTokens += estimate.tokenUsage.completionTokens;
    this.totalEstimatedCostUsd += estimate.estimatedCostUsd;
    this.requestCount += 1;

    logger.info(
      'CostTracker',
      `Request #${this.requestCount} (${estimate.modelName}): ` +
        `${estimate.tokenUsage.totalTokens} tokens ($${estimate.estimatedCostUsd.toFixed(6)}). ` +
        `Cumulative: $${this.totalEstimatedCostUsd.toFixed(5)}`
    );

    if (this.totalEstimatedCostUsd > this.budgetCapUsd) {
      logger.warn(
        'CostTracker',
        `⚠️ Total estimated cost ($${this.totalEstimatedCostUsd.toFixed(4)}) exceeded budget cap ($${this.budgetCapUsd})`
      );
    }
  }

  public isBudgetExceeded(): boolean {
    return this.totalEstimatedCostUsd >= this.budgetCapUsd;
  }

  public getMaxRetries(): number {
    return this.maxRetries;
  }

  public getSummary(): {
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalTokens: number;
    totalEstimatedCostUsd: number;
    requestCount: number;
    budgetCapUsd: number;
  } {
    return {
      totalPromptTokens: this.totalPromptTokens,
      totalCompletionTokens: this.totalCompletionTokens,
      totalTokens: this.totalPromptTokens + this.totalCompletionTokens,
      totalEstimatedCostUsd: Math.round(this.totalEstimatedCostUsd * 100_000) / 100_000,
      requestCount: this.requestCount,
      budgetCapUsd: this.budgetCapUsd,
    };
  }

  public reset(): void {
    this.totalPromptTokens = 0;
    this.totalCompletionTokens = 0;
    this.totalEstimatedCostUsd = 0;
    this.requestCount = 0;
  }
}

export const defaultCostTracker = new CostTracker();
