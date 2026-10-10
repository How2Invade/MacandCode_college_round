import { z } from 'zod';
import { SupportedLanguageSchema, ConversationMessageSchema, BackendPlannedAction } from '../types';

export const LivekitTokenRequestSchema = z.object({
  identity: z.string().optional(),
  name: z.string().optional(),
  roomName: z.string().optional(),
  language: SupportedLanguageSchema.default('en'),
});

export type LivekitTokenRequest = z.infer<typeof LivekitTokenRequestSchema>;

export interface LivekitTokenResponse {
  token: string;
  serverUrl: string;
  roomName: string;
  identity: string;
}

export const LivekitAgentChatRequestSchema = z.object({
  prompt: z.string().min(1).max(4000),
  language: SupportedLanguageSchema.default('en'),
  roomName: z.string().optional(),
  identity: z.string().optional(),
  history: z.array(ConversationMessageSchema).optional(),
  pageContext: z.object({
    url: z.string().optional(),
    title: z.string().optional(),
    domSummary: z.string().optional(),
  }).optional(),
});

export type LivekitAgentChatRequest = z.infer<typeof LivekitAgentChatRequestSchema>;

export interface LivekitAgentChatResponse {
  reply: string;
  actions: BackendPlannedAction[];
  language: 'en' | 'hi' | 'mr';
  costEstimate?: {
    estimatedCostUsd: number;
    tokensUsed: number;
    model: string;
  };
}
