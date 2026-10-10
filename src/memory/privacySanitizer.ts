/**
 * Privacy Sanitizer for Task Memory
 * Ensures passwords, authentication tokens, credentials, and sensitive tokens
 * are never persisted to storage.
 */

import { BrowserAction } from '../shared/types/actions';

const SENSITIVE_KEYWORD_PATTERNS = [
  /password/i,
  /passwd/i,
  /secret/i,
  /auth_token/i,
  /bearer/i,
  /api[_-]?key/i,
  /cvv/i,
  /card[_-]?num/i,
  /access[_-]?token/i,
];

export function sanitizeGoalString(goal: string): string {
  let sanitized = goal;
  // Redact potential bearer tokens or API key strings
  sanitized = sanitized.replace(/bearer\s+[A-Za-z0-9_\-\.]{20,}/gi, 'bearer [REDACTED]');
  sanitized = sanitized.replace(/(key|token|password|secret)\s*[:=]\s*[^\s,]+/gi, '$1=[REDACTED]');
  return sanitized;
}

export function sanitizeBrowserAction(action: BrowserAction): BrowserAction {
  switch (action.type) {
    case 'type_text': {
      const isSensitiveTarget = action.targetId
        ? SENSITIVE_KEYWORD_PATTERNS.some((p) => p.test(action.targetId!))
        : false;

      if (isSensitiveTarget) {
        return {
          ...action,
          text: '[REDACTED_SENSITIVE_INPUT]',
        };
      }
      return { ...action };
    }

    case 'open_url': {
      try {
        const parsed = new URL(action.url);
        let modified = false;
        parsed.searchParams.forEach((_val, key) => {
          if (SENSITIVE_KEYWORD_PATTERNS.some((p) => p.test(key))) {
            parsed.searchParams.set(key, '[REDACTED]');
            modified = true;
          }
        });
        return {
          ...action,
          url: modified ? parsed.toString() : action.url,
        };
      } catch {
        return { ...action };
      }
    }

    default:
      return { ...action };
  }
}
