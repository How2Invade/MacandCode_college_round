import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseWakeWord,
  WakeWordListener,
} from '../../src/voice/wakeWordListener';

describe('WakeWordListener and parseWakeWord', () => {
  describe('parseWakeWord', () => {
    it('matches "hey mac" accurately', () => {
      const res = parseWakeWord('hey mac');
      expect(res.matched).toBe(true);
      expect(res.wakePhrase.toLowerCase()).toBe('hey mac');
      expect(res.command).toBe('');
    });

    it('matches "Hey Mac, scroll down" and extracts trailing command', () => {
      const res = parseWakeWord('Hey Mac, scroll down');
      expect(res.matched).toBe(true);
      expect(res.command).toBe('scroll down');
    });

    it('matches phonetic variations like "hey mark" or "hi mac"', () => {
      expect(parseWakeWord('hi mac').matched).toBe(true);
      expect(parseWakeWord('hey mark what is AI').matched).toBe(true);
      expect(parseWakeWord('hey mark what is AI').command).toBe('what is AI');
      expect(parseWakeWord('mac click search').matched).toBe(true);
      expect(parseWakeWord('mac click search').command).toBe('click search');
    });

    it('does not match unrelated words', () => {
      expect(parseWakeWord('hello world').matched).toBe(false);
      expect(parseWakeWord('machine learning').matched).toBe(false);
      expect(parseWakeWord('macroeconomics').matched).toBe(false);
    });
  });

  describe('WakeWordListener class', () => {
    let mockRecognitionInstance: any;

    beforeEach(() => {
      mockRecognitionInstance = {
        continuous: false,
        interimResults: false,
        lang: '',
        start: vi.fn(),
        stop: vi.fn(),
        abort: vi.fn(),
        onstart: null,
        onend: null,
        onerror: null,
        onresult: null,
      };

      const MockSpeechRecognition = vi.fn(() => mockRecognitionInstance);
      (globalThis as any).SpeechRecognition = MockSpeechRecognition;
      (globalThis as any).webkitSpeechRecognition = MockSpeechRecognition;
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('starts listening and triggers callback when "hey mac" is heard', () => {
      const listener = new WakeWordListener(100);
      const wakeCallback = vi.fn();
      listener.onWake(wakeCallback);

      const started = listener.start();
      expect(started).toBe(true);
      expect(listener.isActive()).toBe(true);

      // Simulate recognition result
      mockRecognitionInstance.onresult({
        resultIndex: 0,
        results: [
          [{ transcript: 'hey mac scroll down' }],
        ],
      });

      expect(wakeCallback).toHaveBeenCalledTimes(1);
      const callArg = wakeCallback.mock.calls[0][0];
      expect(callArg.wakePhrase.toLowerCase()).toBe('hey mac');
      expect(callArg.command).toBe('scroll down');

      listener.stop();
      expect(listener.isActive()).toBe(false);
    });

    it('respects pause and does not emit while paused', () => {
      const listener = new WakeWordListener(100);
      const wakeCallback = vi.fn();
      listener.onWake(wakeCallback);
      listener.start();

      listener.pause();
      expect(listener.isActive()).toBe(false);

      mockRecognitionInstance.onresult({
        resultIndex: 0,
        results: [
          [{ transcript: 'hey mac' }],
        ],
      });

      expect(wakeCallback).not.toHaveBeenCalled();

      listener.resume();
      expect(listener.isActive()).toBe(true);

      listener.stop();
    });
  });
});
