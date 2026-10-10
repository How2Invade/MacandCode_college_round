/**
 * Action Safety, Validation & Approval Policy
 * Enforces Zod schema validation and human-in-the-loop policies for all BrowserActions.
 */

import { z } from 'zod';
import { BrowserAction, ApprovalMode } from '../types/actions';

// Zod Schemas for each BrowserAction variant
export const OpenUrlSchema = z.object({
  type: z.literal('open_url'),
  url: z
    .string()
    .url({ message: 'Invalid URL format' })
    .refine((val) => {
      try {
        const parsed = new URL(val);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
      } catch {
        return false;
      }
    }, { message: 'Only HTTP and HTTPS protocols are permitted' }),
});

export const ClickElementSchema = z.object({
  type: z.literal('click_element'),
  targetId: z.string().min(1, { message: 'targetId must not be empty' }),
});

export const TypeTextSchema = z.object({
  type: z.literal('type_text'),
  text: z.string({ required_error: 'text string is required' }),
  targetId: z.string().optional(),
});

export const ScrollPageSchema = z.object({
  type: z.literal('scroll_page'),
  direction: z.enum(['up', 'down'], {
    errorMap: () => ({ message: 'direction must be either "up" or "down"' }),
  }),
  amount: z
    .number()
    .positive({ message: 'scroll amount must be positive' })
    .max(10000, { message: 'scroll amount exceeds safety maximum of 10,000px' }),
});

export const NavigateSchema = z.object({
  type: z.literal('navigate'),
  direction: z.enum(['back', 'forward']),
});

export const SwitchTabSchema = z.object({
  type: z.literal('switch_tab'),
  direction: z.enum(['next', 'previous']),
});

export const ReadPageSchema = z.object({
  type: z.literal('read_page'),
});

export const BrowserActionSchema = z.discriminatedUnion('type', [
  OpenUrlSchema,
  ClickElementSchema,
  TypeTextSchema,
  ScrollPageSchema,
  NavigateSchema,
  SwitchTabSchema,
  ReadPageSchema,
]);

export interface ValidationSuccess {
  isValid: true;
  action: BrowserAction;
}

export interface ValidationFailure {
  isValid: false;
  errors: string[];
}

export type ActionValidationResult = ValidationSuccess | ValidationFailure;

export function validateBrowserAction(action: unknown): ActionValidationResult {
  const result = BrowserActionSchema.safeParse(action);
  if (result.success) {
    return { isValid: true, action: result.data };
  }
  return {
    isValid: false,
    errors: result.error.errors.map((e) => `${e.path.join('.') || 'root'}: ${e.message}`),
  };
}

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface ActionPolicyDecision {
  requiresApproval: boolean;
  riskLevel: RiskLevel;
  reasons: string[];
  action: BrowserAction;
}

const HIGH_RISK_KEYWORDS = [
  'delete',
  'remove',
  'destroy',
  'pay',
  'checkout',
  'purchase',
  'transfer',
  'password',
  'confirm',
  'submit',
];

export class ActionPolicyEngine {
  constructor(private defaultApprovalMode: ApprovalMode = 'ask') {}

  public evaluate(
    action: BrowserAction,
    mode: ApprovalMode = this.defaultApprovalMode
  ): ActionPolicyDecision {
    const reasons: string[] = [];
    let riskLevel: RiskLevel = 'low';

    // 1. Inspect open_url actions
    if (action.type === 'open_url') {
      try {
        const parsed = new URL(action.url);
        if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
          reasons.push('Insecure HTTP protocol');
          riskLevel = 'medium';
        }
      } catch {
        reasons.push('Malformed URL');
        riskLevel = 'high';
      }
    }

    // 2. Inspect click_element targets
    if (action.type === 'click_element') {
      const lowerTarget = action.targetId.toLowerCase();
      for (const keyword of HIGH_RISK_KEYWORDS) {
        if (lowerTarget.includes(keyword)) {
          reasons.push(`Target ID matches high-risk pattern: "${keyword}"`);
          riskLevel = keyword === 'pay' || keyword === 'checkout' || keyword === 'delete' ? 'critical' : 'high';
          break;
        }
      }
    }

    // 3. Inspect type_text
    if (action.type === 'type_text') {
      riskLevel = 'medium';
      reasons.push('Entering text can modify or submit user data');
      if (action.targetId) {
        const lower = action.targetId.toLowerCase();
        if (lower.includes('password') || lower.includes('cvv') || lower.includes('card')) {
          reasons.push('Text input targets sensitive credential or financial field');
          riskLevel = 'critical';
        }
      }
    }

    // In 'ask' mode, all modifications require approval. Auto mode only permits low-risk actions.
    const requiresApproval =
      mode === 'ask'
        ? riskLevel !== 'low' || action.type === 'click_element' || action.type === 'type_text'
        : riskLevel !== 'low';

    return {
      requiresApproval,
      riskLevel,
      reasons,
      action,
    };
  }

  public isExecutionPermitted(
    action: BrowserAction,
    approvalMode: ApprovalMode,
    userApproved: boolean
  ): boolean {
    const decision = this.evaluate(action, approvalMode);
    if (!decision.requiresApproval) {
      return true;
    }
    return userApproved;
  }
}

export const defaultActionPolicy = new ActionPolicyEngine('ask');
