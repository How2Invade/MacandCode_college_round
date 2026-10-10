/**
 * Shared Utilities
 */

export function generateId(prefix = 'id'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const logger = {
  info: (tag: string, message: string, data?: unknown) => {
    console.log(`[Handsfree][${tag}] ${message}`, data !== undefined ? data : '');
  },
  warn: (tag: string, message: string, data?: unknown) => {
    console.warn(`[Handsfree][${tag}] ⚠️ ${message}`, data !== undefined ? data : '');
  },
  error: (tag: string, message: string, data?: unknown) => {
    console.error(`[Handsfree][${tag}] ❌ ${message}`, data !== undefined ? data : '');
  },
  debug: (tag: string, message: string, data?: unknown) => {
    if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development') {
      console.debug(`[Handsfree][${tag}] 🔍 ${message}`, data !== undefined ? data : '');
    }
  },
};
