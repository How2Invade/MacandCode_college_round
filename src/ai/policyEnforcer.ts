/**
 * Approval and Safety Policy Enforcer
 * Part B (5): Enforces Ask mode vs Auto-Allow mode, with hard protection for sensitive actions.
 */

import { BrowserAction, ApprovalMode } from '../shared/types/actions';
import { defaultActionPolicy, RiskLevel } from '../shared/safety/action-policy';
import { logger } from '../shared/utils';

export interface PolicyEvaluation {
  action: BrowserAction;
  requiresApproval: boolean;
  riskLevel: RiskLevel;
  reasons: string[];
  autoAllowed: boolean;
}

export class ApprovalPolicyEnforcer {
  private userApprovalMode: ApprovalMode;

  constructor(initialMode: ApprovalMode = 'ask') {
    this.userApprovalMode = initialMode;
  }

  /**
   * Only the user can change approval setting through UI/settings.
   * Model outputs or backend responses cannot invoke this method.
   */
  public setApprovalMode(mode: ApprovalMode): void {
    this.userApprovalMode = mode;
    logger.info('ApprovalPolicyEnforcer', `User updated approval mode to: "${mode}"`);
  }

  public getApprovalMode(): ApprovalMode {
    return this.userApprovalMode;
  }

  /**
   * Evaluates an individual browser action against current approval mode
   */
  public evaluateAction(action: BrowserAction): PolicyEvaluation {
    const decision = defaultActionPolicy.evaluate(action, this.userApprovalMode);

    // In 'ask' mode:
    // All actions that interact with the page or browser require explicit approval.
    if (this.userApprovalMode === 'ask') {
      const requiresApproval = action.type !== 'read_page';
      return {
        action,
        requiresApproval,
        riskLevel: decision.riskLevel,
        reasons: decision.reasons.length > 0 ? decision.reasons : ['Ask mode requires user review before executing browser actions.'],
        autoAllowed: !requiresApproval,
      };
    }

    // In 'auto' mode:
    // Low risk actions are auto-allowed.
    // Critical and high-risk operations (e.g. payments, passwords, checkout, deletes) ALWAYS require explicit approval!
    const isSensitive = decision.riskLevel === 'high' || decision.riskLevel === 'critical';
    const requiresApproval = isSensitive;

    const reasons = [...decision.reasons];
    if (isSensitive) {
      reasons.push(`Sensitive operation (${decision.riskLevel} risk) mandates explicit approval regardless of auto-allow setting.`);
    }

    return {
      action,
      requiresApproval,
      riskLevel: decision.riskLevel,
      reasons,
      autoAllowed: !requiresApproval,
    };
  }

  /**
   * Verify if state has diverged unexpectedly before executing an approved action
   */
  public verifyPagePrecondition(action: BrowserAction, currentPageUrl?: string): boolean {
    if (action.type === 'click_element' || action.type === 'type_text') {
      // If action targets an element on a specific domain, verify page URL is intact
      if (currentPageUrl && (currentPageUrl.startsWith('chrome://') || currentPageUrl.startsWith('about:'))) {
        logger.warn('ApprovalPolicyEnforcer', `Execution blocked: restricted browser page (${currentPageUrl})`);
        return false;
      }
    }
    return true;
  }
}

export const defaultApprovalPolicyEnforcer = new ApprovalPolicyEnforcer('ask');
