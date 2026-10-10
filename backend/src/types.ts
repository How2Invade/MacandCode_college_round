import { z } from 'zod';

export const SupportedLanguageSchema = z.enum(['en', 'hi', 'mr']);
export type SupportedLanguage = z.infer<typeof SupportedLanguageSchema>;

export const PageContextSchema = z.object({
  url: z.string().optional(),
  title: z.string().optional(),
  domSummary: z.string().max(8000).optional(),
}).optional();

export const ConversationMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
});

export const AiCompletionRequestSchema = z.object({
  prompt: z.string().min(1).max(4000),
  language: SupportedLanguageSchema.default('en'),
  pageContext: PageContextSchema,
  history: z.array(ConversationMessageSchema).optional(),
});

export type AiCompletionRequest = z.infer<typeof AiCompletionRequestSchema>;

export interface BackendPlannedAction {
  type: string;
  url?: string;
  targetId?: string;
  text?: string;
  direction?: 'up' | 'down' | 'back' | 'forward' | 'next' | 'previous';
  amount?: number;
  [key: string]: unknown;
}

export interface AiCompletionResponse {
  reply: string;
  actions: BackendPlannedAction[];
  costEstimate?: {
    estimatedCostUsd: number;
    tokensUsed: number;
    model: string;
  };
}

export interface BackendErrorResponse {
  error: string;
  code: string;
  status: number;
}
