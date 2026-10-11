import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSpeechSTTProvider } from '../../src/voice/providers/webSpeechSTT';
import { LANGUAGE_CONFIGS } from '../../src/voice/types';

describe('WebSpeechSTTProvider', () => {
  let mockTrack: { stop: any; enabled: boolean };
  let mockStream: { getAudioTracks: any; getTracks: any };
  let mockRecognitionInstance: any;

  beforeEach(() => {
    mockTrack = {
      stop: vi.fn(),
      enabled: true,
    };
    mockStream = {
      getAudioTracks: vi.fn(() => [mockTrack]),
      getTracks: vi.fn(() => [mockTrack]),
    };

    // Mock navigator.mediaDevices.getUserMedia
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        mediaDevices: {
          getUserMedia: vi.fn().mockResolvedValue(mockStream),
        },
      },
      writable: true,
      configurable: true,
    });

    // Mock Web Speech Recognition
    mockRecognitionInstance = {
      continuous: false,
      interimResults: false,
      lang: '',
      start: vi.fn(function (this: any) {
        if (this.onstart) this.onstart();
      }),
      stop: vi.fn(function (this: any) {
        if (this.onend) this.onend();
      }),
      abort: vi.fn(),
      onstart: null,
      onend: null,
      onerror: null,
      onresult: null,
    };

    const MockRecognition = vi.fn(() => mockRecognitionInstance);
    (globalThis as any).webkitSpeechRecognition = MockRecognition;
    (globalThis as any).SpeechRecognition = MockRecognition;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the audio stream alive during active listening and does not terminate tracks prematurely', async () => {
    const provider = new WebSpeechSTTProvider();

    await provider.startListening('en');

    expect(provider.getState()).toBe('listening');
    // Ensure getUserMedia was called to verify microphone hardware
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    // Critical: mic track must NOT be stopped while listening is active!
    expect(mockTrack.stop).not.toHaveBeenCalled();

    // Now stop listening explicitly
    await provider.stopListening();
    expect(provider.getState()).toBe('idle');
    expect(mockTrack.stop).toHaveBeenCalled();
  });

  it('correctly configures speech recognition locale for English, Hindi, and Marathi', async () => {
    const provider = new WebSpeechSTTProvider();

    await provider.startListening('hi');
    expect(mockRecognitionInstance.lang).toBe(LANGUAGE_CONFIGS.hi.speechRecognitionLocale);
    await provider.stopListening();

    await provider.startListening('mr');
    expect(mockRecognitionInstance.lang).toBe(LANGUAGE_CONFIGS.mr.speechRecognitionLocale);
    await provider.stopListening();
  });

  it('emits interim and final transcripts and delivers final result to listener', async () => {
    const provider = new WebSpeechSTTProvider();
    const resultListener = vi.fn();
    provider.onResult(resultListener);

    await provider.startListening('en');

    // Simulate speech recognition results
    const mockEvent = {
      resultIndex: 0,
      results: [
        {
          isFinal: true,
          0: { transcript: 'open google docs', confidence: 0.95 },
          length: 1,
        },
      ],
    };

    mockRecognitionInstance.onresult(mockEvent);

    expect(resultListener).toHaveBeenCalledWith({
      transcript: 'open google docs',
      language: 'en',
      confidence: 0.95,
      isFinal: true,
    });
  });

  it('handles microphone permission denial gracefully and sets error state', async () => {
    const permError = new Error('Permission denied');
    permError.name = 'NotAllowedError';
    (navigator.mediaDevices.getUserMedia as any).mockRejectedValueOnce(permError);

    const provider = new WebSpeechSTTProvider();
    const errorListener = vi.fn();
    provider.onError(errorListener);

    await expect(provider.startListening('en')).rejects.toThrow();

    expect(provider.getState()).toBe('error');
    expect(errorListener).toHaveBeenCalledWith(LANGUAGE_CONFIGS.en.strings.micPermissionDenied);
  });

  it('auto-commits pending partial transcripts upon silence debounce', async () => {
    vi.useFakeTimers();
    try {
      const provider = new WebSpeechSTTProvider();
      const resultListener = vi.fn();
      provider.onResult(resultListener);

      await provider.startListening('en');

      // Emit interim result without isFinal
      const interimEvent = {
        resultIndex: 0,
        results: [
          {
            isFinal: false,
            0: { transcript: 'book a flight to Mumbai', confidence: 0.8 },
            length: 1,
          },
        ],
      };
      mockRecognitionInstance.onresult(interimEvent);

      expect(resultListener).toHaveBeenCalledWith({
        transcript: 'book a flight to Mumbai',
        language: 'en',
        confidence: 0.5,
        isFinal: false,
      });

      // Fast-forward 1200ms silence timeout
      vi.advanceTimersByTime(1200);

      // Verify final committed result was dispatched
      expect(resultListener).toHaveBeenCalledWith({
        transcript: 'book a flight to Mumbai',
        language: 'en',
        confidence: 0.85,
        isFinal: true,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
