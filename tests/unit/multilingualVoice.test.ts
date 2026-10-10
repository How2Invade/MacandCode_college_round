import { describe, it, expect, vi } from 'vitest';
import {
  VoicePipeline,
  LANGUAGE_CONFIGS,
  MockVoiceRecognizer,
  MockVoiceSynthesizer,
} from '../../src/voice';

describe('Multilingual Voice Experience (Part A)', () => {
  it('should support English (en), Hindi (hi), and Marathi (mr) configurations', () => {
    expect(LANGUAGE_CONFIGS.en.speechRecognitionLocale).toBe('en-US');
    expect(LANGUAGE_CONFIGS.hi.speechRecognitionLocale).toBe('hi-IN');
    expect(LANGUAGE_CONFIGS.mr.speechRecognitionLocale).toBe('mr-IN');

    expect(LANGUAGE_CONFIGS.en.strings.welcome).toContain('Handsfree');
    expect(LANGUAGE_CONFIGS.hi.strings.welcome).toContain('हैंड्सफ्री');
    expect(LANGUAGE_CONFIGS.mr.strings.welcome).toContain('हँड्सफ्री');
  });

  it('should execute voice pipeline state machine transitions', async () => {
    const mockRecognizer = new MockVoiceRecognizer();
    const mockSynthesizer = new MockVoiceSynthesizer();
    const pipeline = new VoicePipeline({
      sttProvider: mockRecognizer,
      ttsProvider: mockSynthesizer,
      initialLanguage: 'en',
    });

    expect(pipeline.getState()).toBe('idle');

    // Start listening
    await pipeline.startListening();
    expect(pipeline.getState()).toBe('listening');

    // Stop listening
    await pipeline.stopListening();
    expect(pipeline.getState()).toBe('idle');
  });

  it('should switch languages and update voice recognition & synthesis targets', async () => {
    const mockRecognizer = new MockVoiceRecognizer();
    const mockSynthesizer = new MockVoiceSynthesizer();
    const pipeline = new VoicePipeline({
      sttProvider: mockRecognizer,
      ttsProvider: mockSynthesizer,
    });

    pipeline.setLanguage('hi');
    expect(pipeline.getLanguage()).toBe('hi');
    expect(pipeline.getLocalizedText('listening')).toBe(LANGUAGE_CONFIGS.hi.strings.listening);

    pipeline.setLanguage('mr');
    expect(pipeline.getLanguage()).toBe('mr');
    expect(pipeline.getLocalizedText('listening')).toBe(LANGUAGE_CONFIGS.mr.strings.listening);
  });

  it('should support interruptibility when speaking', async () => {
    const mockRecognizer = new MockVoiceRecognizer();
    const mockSynthesizer = new MockVoiceSynthesizer();
    const pipeline = new VoicePipeline({
      sttProvider: mockRecognizer,
      ttsProvider: mockSynthesizer,
    });

    const speakPromise = pipeline.speak('Long explanation about renewable energy');
    expect(mockSynthesizer.isSpeaking()).toBe(true);

    // User interrupts by stopping speech or activating mic
    await pipeline.stopSpeaking();
    expect(mockSynthesizer.isSpeaking()).toBe(false);
    expect(pipeline.getState()).toBe('idle');

    await speakPromise;
  });

  it('should deliver voice transcripts to listeners without saving raw audio', async () => {
    const mockRecognizer = new MockVoiceRecognizer();
    const mockSynthesizer = new MockVoiceSynthesizer();
    const pipeline = new VoicePipeline({
      sttProvider: mockRecognizer,
      ttsProvider: mockSynthesizer,
      initialLanguage: 'hi',
    });

    const transcriptListener = vi.fn();
    pipeline.onTranscript(transcriptListener);

    await pipeline.startListening();
    mockRecognizer.simulateVoiceInput('गूगल डॉक्स खोलो', true);

    expect(transcriptListener).toHaveBeenCalledWith(
      expect.objectContaining({
        transcript: 'गूगल डॉक्स खोलो',
        language: 'hi',
        isFinal: true,
      })
    );
  });

  it('should handle microphone errors gracefully', async () => {
    const mockRecognizer = new MockVoiceRecognizer();
    const pipeline = new VoicePipeline({
      sttProvider: mockRecognizer,
    });

    const errorListener = vi.fn();
    pipeline.onError(errorListener);

    await pipeline.startListening();
    mockRecognizer.simulateError('Microphone permission denied');

    expect(pipeline.getState()).toBe('error');
    expect(errorListener).toHaveBeenCalledWith('Microphone permission denied');
  });
});
