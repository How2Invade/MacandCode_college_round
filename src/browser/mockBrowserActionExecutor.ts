/**
 * MOCK IMPLEMENTATION: MockBrowserActionExecutor
 *
 * NOTE: Placeholder for executing BrowserAction union types.
 * Returns shared ActionResult contract.
 */

import {
  BrowserAction,
  ActionResult,
  IBrowserActionExecutor,
} from '../shared/types/actions';
import { validateBrowserAction, defaultActionPolicy } from '../shared/safety/action-policy';
import { logger } from '../shared/utils';

export class MockBrowserActionExecutor implements IBrowserActionExecutor {
  public readonly isMock = true;

  public async canExecute(action: BrowserAction): Promise<boolean> {
    const validation = validateBrowserAction(action);
    return validation.isValid;
  }

  public async execute(action: BrowserAction): Promise<ActionResult> {
    logger.info('MockBrowserActionExecutor', `Executing mock action: [${action.type}]`);

    // 1. Zod schema validation
    const validation = validateBrowserAction(action);
    if (!validation.isValid) {
      logger.warn('MockBrowserActionExecutor', `Validation rejected action: ${validation.errors.join(', ')}`);
      return {
        success: false,
        message: `Validation Error: ${validation.errors.join('; ')}`,
      };
    }

    // 2. Policy check
    const policyDecision = defaultActionPolicy.evaluate(action);
    if (policyDecision.riskLevel === 'critical') {
      logger.warn('MockBrowserActionExecutor', `Critical action flagged: ${policyDecision.reasons.join(', ')}`);
    }

    // 3. Mock execution simulation
    await new Promise((res) => setTimeout(res, 60));

    switch (action.type) {
      case 'open_url':
        return {
          success: true,
          message: `Opened URL: ${action.url}`,
          data: { url: action.url },
        };
      case 'click_element':
        return {
          success: true,
          message: `Clicked element: #${action.targetId}`,
          data: { targetId: action.targetId },
        };
      case 'type_text':
        return {
          success: true,
          message: `Typed text into ${action.targetId || 'active element'}`,
          data: { textLength: action.text.length },
        };
      case 'scroll_page':
        return {
          success: true,
          message: `Scrolled ${action.direction} by ${action.amount}px`,
          data: { direction: action.direction, amount: action.amount },
        };
      case 'navigate':
        return {
          success: true,
          message: `Navigated ${action.direction}`,
          data: { direction: action.direction },
        };
      case 'switch_tab':
        return {
          success: true,
          message: `Switched tab ${action.direction}`,
          data: { direction: action.direction },
        };
      case 'read_page':
        return {
          success: true,
          message: 'Page content read successfully',
          data: { pageTitle: 'Example Handsfree Webpage', wordCount: 450 },
        };
      default:
        return {
          success: false,
          message: 'Unknown action type',
        };
    }
  }
}

export const defaultMockBrowserActionExecutor = new MockBrowserActionExecutor();
