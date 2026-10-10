/**
 * Assistant State and Language Types
 * Shared contract for multimodal AI assistance.
 */

import { BrowserAction, AssistantState } from './actions';

export type SupportedLanguage = 'en' | 'hi' | 'mr';

export interface LanguageOption {
  code: SupportedLanguage;
  name: string;
  nativeName: string;
}

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी' },
  { code: 'mr', name: 'Marathi', nativeName: 'मराठी' },
];

export type ConversationRole = 'user' | 'assistant' | 'system';

export interface ConversationMessage {
  id: string;
  role: ConversationRole;
  content: string;
  timestamp: number;
  language: SupportedLanguage;
  suggestedActions?: BrowserAction[];
}

export interface AssistantStatus {
  state: AssistantState;
  selectedLanguage: SupportedLanguage;
  activeTaskId: string | null;
  pendingApprovalAction: BrowserAction | null;
  currentStepDescription: string | null;
  lastError?: string;
}

export interface IAssistantClient {
  sendMessage(
    content: string,
    language: SupportedLanguage,
    context?: Record<string, unknown>
  ): Promise<ConversationMessage>;
  generatePlan(
    goal: string,
    language: SupportedLanguage,
    context?: Record<string, unknown>
  ): Promise<BrowserAction[]>;
}
