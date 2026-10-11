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

    const g = goal.toLowerCase();
    if (g.includes('youtube')) {
      return [{ type: 'open_url', url: 'https://www.youtube.com' }];
    }
    if (g.includes('google')) {
      return [{ type: 'open_url', url: 'https://www.google.com' }];
    }
    if (g.includes('github')) {
      return [{ type: 'open_url', url: 'https://github.com' }];
    }
    if (g.includes('wikipedia')) {
      return [{ type: 'open_url', url: 'https://www.wikipedia.org' }];
    }
    if (g.includes('up') || g.includes('ऊपर') || g.includes('वर')) {
      return [{ type: 'scroll_page', direction: 'up', amount: 400 }];
    }
    if (g.includes('down') || g.includes('नीचे') || g.includes('खाली')) {
      return [{ type: 'scroll_page', direction: 'down', amount: 400 }];
    }
    if (g.includes('click') || g.includes('क्लिक') || g.includes('select')) {
      return [{ type: 'click_element', targetId: 'cursor' }];
    }
    if (g.includes('back') || g.includes('पीछे') || g.includes('मागे')) {
      return [{ type: 'navigate_back' }];
    }
    if (g.includes('forward') || g.includes('आगे') || g.includes('पुढे')) {
      return [{ type: 'navigate_forward' }];
    }
    if (g.includes('zoom in') || g.includes('बड़ा करो')) {
      return [{ type: 'zoom_page', direction: 'in' }];
    }
    if (g.includes('zoom out') || g.includes('छोटा करो')) {
      return [{ type: 'zoom_page', direction: 'out' }];
    }
    if (g.includes('next tab') || g.includes('अगला टैब')) {
      return [{ type: 'switch_tab', direction: 'next' }];
    }
    if (g.includes('prev') || g.includes('पिछला टैब')) {
      return [{ type: 'switch_tab', direction: 'previous' }];
    }

    return [
      {
        type: 'scroll_page',
        direction: 'down',
        amount: 300,
      }
    ];
  }
}

export const defaultMockAiClient = new MockAiClient();
