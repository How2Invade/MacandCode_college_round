/**
 * MOCK IMPLEMENTATION: MockVoiceRecognizer & MockVoiceSynthesizer
 *
 * NOTE: Placeholder for Web Speech API / Whisper voice input in English, Hindi, and Marathi.
 * Used for testing and headless automation environments.
 */

import { SupportedLanguage } from '../shared/types/assistant';
import { logger } from '../shared/utils';
import {
  IVoiceRecognizer,
  IVoiceSynthesizer,
  VoiceInputOptions,
  VoiceOutputOptions,
  VoiceRecognitionResult,
  VoiceState,
} from './types';

export class MockVoiceRecognizer implements IVoiceRecognizer {
  public readonly isMock = true;
  private active = false;
  private state: VoiceState = 'idle';
  private currentLanguage: SupportedLanguage = 'en';
  private resultListeners: ((result: VoiceRecognitionResult) => void)[] = [];
  private errorListeners: ((error: string) => void)[] = [];
  private stateListeners: ((state: VoiceState) => void)[] = [];

  public async startListening(
    language: SupportedLanguage,
    _options?: VoiceInputOptions
  ): Promise<void> {
    this.currentLanguage = language;
    this.active = true;
    this.setState('listening');
    logger.info('MockVoiceRecognizer', `Mock voice listening started for language: [${language}]`);
  }

  public async stopListening(): Promise<void> {
    this.active = false;
    this.setState('idle');
    logger.info('MockVoiceRecognizer', 'Mock voice listening stopped');
  }

  public isListening(): boolean {
    return this.active;
  }

  public getState(): VoiceState {
    return this.state;
  }

  public onStateChange(listener: (state: VoiceState) => void): () => void {
    this.stateListeners.push(listener);
    return () => {
      this.stateListeners = this.stateListeners.filter((l) => l !== listener);
    };
  }

  public onResult(listener: (result: VoiceRecognitionResult) => void): () => void {
    this.resultListeners.push(listener);
    return () => {
      this.resultListeners = this.resultListeners.filter((l) => l !== listener);
    };
  }

  public onError(listener: (error: string) => void): () => void {
    this.errorListeners.push(listener);
    return () => {
      this.errorListeners = this.errorListeners.filter((l) => l !== listener);
    };
  }

  /**
   * Helper to simulate voice reception in dev/tests
   */
  public simulateVoiceInput(transcript: string, isFinal = true): void {
    if (!this.active) return;
    if (isFinal) {
      this.setState('processing');
    }
    const result: VoiceRecognitionResult = {
      transcript,
      language: this.currentLanguage,
      confidence: 0.94,
      isFinal,
    };
    for (const listener of this.resultListeners) {
      listener(result);
    }
    if (isFinal) {
      this.setState('idle');
    }
  }

  /**
   * Helper to simulate permission error or device failure
   */
  public simulateError(error: string): void {
    this.active = false;
    this.setState('error');
    for (const listener of this.errorListeners) {
      listener(error);
    }
  }

  private setState(state: VoiceState): void {
    this.state = state;
    for (const listener of this.stateListeners) {
      listener(state);
    }
  }
}

export class MockVoiceSynthesizer implements IVoiceSynthesizer {
  public readonly isMock = true;
  private state: VoiceState = 'idle';
  private speaking = false;
  private stateListeners: ((state: VoiceState) => void)[] = [];
  public lastSpokenText: string | null = null;
  public lastSpokenLanguage: SupportedLanguage | null = null;

  public async speak(
    text: string,
    language: SupportedLanguage,
    _options?: VoiceOutputOptions
  ): Promise<void> {
    this.speaking = true;
    this.setState('speaking');
    this.lastSpokenText = text;
    this.lastSpokenLanguage = language;
    logger.info('MockVoiceSynthesizer', `Spoke in [${language}]: "${text}"`);
    // Minimal delay to simulate speech playback
    await new Promise((res) => setTimeout(res, 20));
    this.speaking = false;
    this.setState('idle');
  }

  public async stop(): Promise<void> {
    this.speaking = false;
    this.setState('idle');
    logger.info('MockVoiceSynthesizer', 'Mock speech stopped');
  }

  public isSpeaking(): boolean {
    return this.speaking;
  }

  public getState(): VoiceState {
    return this.state;
  }

  public onStateChange(listener: (state: VoiceState) => void): () => void {
    this.stateListeners.push(listener);
    return () => {
      this.stateListeners = this.stateListeners.filter((l) => l !== listener);
    };
  }

  private setState(state: VoiceState): void {
    this.state = state;
    for (const listener of this.stateListeners) {
      listener(state);
    }
  }
}

export const defaultMockVoiceRecognizer = new MockVoiceRecognizer();
export const defaultMockVoiceSynthesizer = new MockVoiceSynthesizer();
