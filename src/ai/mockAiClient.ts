/**
 * MOCK IMPLEMENTATION: MockAiClient
 *
 * NOTE: Placeholder for conversational AI and multi-step action planning.
 * Generates plans matching agreed BrowserAction shared contract.
 */

import {
  ConversationMessage,
  IAssistantClient,
  SupportedLanguage,
} from '../shared/types/assistant';
import { BrowserAction } from '../shared/types/actions';
import { generateId, logger } from '../shared/utils';

export class MockAiClient implements IAssistantClient {
  public readonly isMock = true;

  public async sendMessage(
    content: string,
    language: SupportedLanguage,
    _context?: Record<string, unknown>
  ): Promise<ConversationMessage> {
    logger.info('MockAiClient', `Received user prompt in [${language}]: "${content}"`);

    await new Promise((res) => setTimeout(res, 100));

    let replyText = `I heard: "${content}". Formulating browser plan...`;
    if (language === 'hi') {
      replyText = `मैंने सुना: "${content}". ब्राउज़र प्लान तैयार कर रहा हूँ...`;
    } else if (language === 'mr') {
      replyText = `मला ऐकू आले: "${content}". ब्राउझर कृती योजना तयार करत आहे...`;
    }

    const responseMessage: ConversationMessage = {
      id: generateId('msg'),
      role: 'assistant',
      content: replyText,
      timestamp: Date.now(),
      language,
    };

    return responseMessage;
  }

  public async generatePlan(
    goal: string,
    language: SupportedLanguage,
    _context?: Record<string, unknown>
  ): Promise<BrowserAction[]> {
    logger.info('MockAiClient', `Generating mock action plan for goal: "${goal}" in [${language}]`);

    // Return agreed BrowserAction variants
    const plan: BrowserAction[] = [
      {
        type: 'scroll_page',
        direction: 'down',
        amount: 300,
      },
      {
        type: 'click_element',
        targetId: 'search-input',
      },
      {
        type: 'type_text',
        text: goal,
        targetId: 'search-input',
      },
    ];

    return plan;
  }
}

export const defaultMockAiClient = new MockAiClient();
