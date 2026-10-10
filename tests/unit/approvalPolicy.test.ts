import { describe, it, expect } from 'vitest';
import { defaultActionPolicy } from '../../src/shared/safety/action-policy';
import { BrowserAction } from '../../src/shared/types/actions';

describe('Action Policy & Approval Mode Enforcement', () => {
  const policy = defaultActionPolicy;

  it('should flag destructive click targets as critical/high risk requiring approval', () => {
    const deleteAction: BrowserAction = {
      type: 'click_element',
      targetId: 'btn-delete-account',
    };

    const decision = policy.evaluate(deleteAction, 'ask');
    expect(decision.requiresApproval).toBe(true);
    expect(decision.riskLevel).toBe('critical');
    expect(decision.reasons.some((r) => r.includes('delete'))).toBe(true);
  });

  it('should flag financial or checkout actions as critical risk requiring approval', () => {
    const payAction: BrowserAction = {
      type: 'click_element',
      targetId: 'checkout-pay-now',
    };

    const decision = policy.evaluate(payAction, 'auto');
    expect(decision.requiresApproval).toBe(true);
    expect(decision.riskLevel).toBe('critical');
  });

  it('should flag password or credential text input as critical risk', () => {
    const passwordAction: BrowserAction = {
      type: 'type_text',
      text: 'supersecret',
      targetId: 'user-password-input',
    };

    const decision = policy.evaluate(passwordAction, 'auto');
    expect(decision.requiresApproval).toBe(true);
    expect(decision.riskLevel).toBe('critical');
  });

  it('should permit safe scrolling in auto mode without requiring user approval', () => {
    const scrollAction: BrowserAction = {
      type: 'scroll_page',
      direction: 'down',
      amount: 300,
    };

    const decision = policy.evaluate(scrollAction, 'auto');
    expect(decision.requiresApproval).toBe(false);
    expect(decision.riskLevel).toBe('low');
  });

  it('should enforce user approval flag in isExecutionPermitted', () => {
    const sensitiveAction: BrowserAction = {
      type: 'click_element',
      targetId: 'confirm-order-pay',
    };

    expect(policy.isExecutionPermitted(sensitiveAction, 'ask', false)).toBe(false);
    expect(policy.isExecutionPermitted(sensitiveAction, 'ask', true)).toBe(true);
  });
});
