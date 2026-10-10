import { describe, it, expect } from 'vitest';
import { validateBrowserAction } from '../../src/shared/safety/action-policy';
import { BrowserAction } from '../../src/shared/types/actions';

describe('Browser Action Argument Validation (Shared Contract)', () => {
  describe('Invalid Arguments Rejection', () => {
    it('should reject open_url with malicious or non-HTTP protocols', () => {
      const maliciousAction = {
        type: 'open_url',
        url: 'javascript:alert(document.cookie)',
      };

      const result = validateBrowserAction(maliciousAction);
      expect(result.isValid).toBe(false);
      if (!result.isValid) {
        expect(result.errors.some((e) => e.includes('HTTP and HTTPS protocols') || e.includes('Invalid URL format'))).toBe(true);
      }
    });

    it('should reject open_url with invalid URL format', () => {
      const badUrlAction = {
        type: 'open_url',
        url: 'not-a-valid-url',
      };

      const result = validateBrowserAction(badUrlAction);
      expect(result.isValid).toBe(false);
      if (!result.isValid) {
        expect(result.errors.some((e) => e.includes('Invalid URL'))).toBe(true);
      }
    });

    it('should reject click_element with empty targetId', () => {
      const emptyClick = {
        type: 'click_element',
        targetId: '',
      };

      const result = validateBrowserAction(emptyClick);
      expect(result.isValid).toBe(false);
      if (!result.isValid) {
        expect(result.errors.some((e) => e.includes('targetId must not be empty'))).toBe(true);
      }
    });

    it('should reject scroll_page with negative amount or amount exceeding 10,000px', () => {
      const negativeScroll = {
        type: 'scroll_page',
        direction: 'down',
        amount: -300,
      };
      const resultNeg = validateBrowserAction(negativeScroll);
      expect(resultNeg.isValid).toBe(false);

      const hugeScroll = {
        type: 'scroll_page',
        direction: 'down',
        amount: 25000,
      };
      const resultHuge = validateBrowserAction(hugeScroll);
      expect(resultHuge.isValid).toBe(false);
      if (!resultHuge.isValid) {
        expect(resultHuge.errors.some((e) => e.includes('10,000px'))).toBe(true);
      }
    });

    it('should reject scroll_page with invalid direction', () => {
      const invalidDir = {
        type: 'scroll_page',
        direction: 'left',
        amount: 300,
      };

      const result = validateBrowserAction(invalidDir);
      expect(result.isValid).toBe(false);
    });

    it('should reject navigate with invalid direction', () => {
      const badNav = {
        type: 'navigate',
        direction: 'sideways',
      };

      const result = validateBrowserAction(badNav);
      expect(result.isValid).toBe(false);
    });

    it('should reject switch_tab with invalid direction', () => {
      const badTab = {
        type: 'switch_tab',
        direction: 'first',
      };

      const result = validateBrowserAction(badTab);
      expect(result.isValid).toBe(false);
    });

    it('should reject unknown action types', () => {
      const unknownAction = {
        type: 'execute_arbitrary_shell_command',
        command: 'rm -rf /',
      };

      const result = validateBrowserAction(unknownAction);
      expect(result.isValid).toBe(false);
    });
  });

  describe('Valid Arguments Acceptance', () => {
    it('should validate and accept open_url with HTTPS URL', () => {
      const validOpen: BrowserAction = {
        type: 'open_url',
        url: 'https://news.ycombinator.com',
      };

      const result = validateBrowserAction(validOpen);
      expect(result.isValid).toBe(true);
      if (result.isValid) {
        expect(result.action.type).toBe('open_url');
      }
    });

    it('should validate and accept click_element', () => {
      const validClick: BrowserAction = {
        type: 'click_element',
        targetId: 'submit-button',
      };

      const result = validateBrowserAction(validClick);
      expect(result.isValid).toBe(true);
    });

    it('should validate and accept type_text', () => {
      const validType: BrowserAction = {
        type: 'type_text',
        text: 'Handsfree search query',
        targetId: 'search-box',
      };

      const result = validateBrowserAction(validType);
      expect(result.isValid).toBe(true);
    });

    it('should validate and accept scroll_page, navigate, switch_tab, and read_page', () => {
      expect(validateBrowserAction({ type: 'scroll_page', direction: 'down', amount: 400 }).isValid).toBe(true);
      expect(validateBrowserAction({ type: 'navigate', direction: 'back' }).isValid).toBe(true);
      expect(validateBrowserAction({ type: 'switch_tab', direction: 'next' }).isValid).toBe(true);
      expect(validateBrowserAction({ type: 'read_page' }).isValid).toBe(true);
    });
  });
});
