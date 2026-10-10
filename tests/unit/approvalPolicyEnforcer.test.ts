import { describe, it, expect } from 'vitest';
import { ApprovalPolicyEnforcer } from '../../src/ai/policyEnforcer';

describe('Approval Policy and Human-In-The-Loop Safety (Part B.5)', () => {
  it('should require approval for state-changing actions in "ask" mode', () => {
    const enforcer = new ApprovalPolicyEnforcer('ask');

    const clickEval = enforcer.evaluateAction({
      type: 'click_element',
      targetId: 'submit-btn',
    });
    expect(clickEval.requiresApproval).toBe(true);
    expect(clickEval.autoAllowed).toBe(false);

    const typeEval = enforcer.evaluateAction({
      type: 'type_text',
      text: 'hello world',
      targetId: 'chat-input',
    });
    expect(typeEval.requiresApproval).toBe(true);
  });

  it('should automatically allow low-risk actions in "auto" mode', () => {
    const enforcer = new ApprovalPolicyEnforcer('auto');

    const scrollEval = enforcer.evaluateAction({
      type: 'scroll_page',
      direction: 'down',
      amount: 300,
    });
    expect(scrollEval.requiresApproval).toBe(false);
    expect(scrollEval.autoAllowed).toBe(true);

    const readEval = enforcer.evaluateAction({
      type: 'read_page',
    });
    expect(readEval.requiresApproval).toBe(false);
    expect(readEval.autoAllowed).toBe(true);
  });

  it('should NEVER bypass approval for high or critical risk actions even in "auto" mode', () => {
    const enforcer = new ApprovalPolicyEnforcer('auto');

    // 1. Password input
    const passwordEval = enforcer.evaluateAction({
      type: 'type_text',
      text: 'Secret123',
      targetId: 'account-password-input',
    });
    expect(passwordEval.requiresApproval).toBe(true);
    expect(passwordEval.riskLevel).toBe('critical');

    // 2. Payment checkout click
    const checkoutEval = enforcer.evaluateAction({
      type: 'click_element',
      targetId: 'checkout-pay-now-button',
    });
    expect(checkoutEval.requiresApproval).toBe(true);
    expect(checkoutEval.riskLevel).toBe('critical');

    // 3. Account deletion click
    const deleteEval = enforcer.evaluateAction({
      type: 'click_element',
      targetId: 'delete-account-button',
    });
    expect(deleteEval.requiresApproval).toBe(true);
    expect(deleteEval.riskLevel).toBe('critical');
  });

  it('should prevent execution on restricted browser domains', () => {
    const enforcer = new ApprovalPolicyEnforcer('auto');

    const chromeUrlValid = enforcer.verifyPagePrecondition(
      { type: 'click_element', targetId: 'setting-btn' },
      'chrome://settings'
    );
    expect(chromeUrlValid).toBe(false);

    const normalWebUrlValid = enforcer.verifyPagePrecondition(
      { type: 'click_element', targetId: 'setting-btn' },
      'https://example.com'
    );
    expect(normalWebUrlValid).toBe(true);
  });
});
