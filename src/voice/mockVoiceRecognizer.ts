/**
 * MOCK IMPLEMENTATION: MockVoiceRecognizer
 *
 * NOTE: Placeholder for Web Speech API / Whisper voice input in English, Hindi, and Marathi.
 * Real voice recognition will be wired up in later voice control feature phase.
 */

import { SupportedLanguage } from '../shared/types/assistant';
import { logger } from '../shared/utils';

export interface VoiceRecognitionResult {
  transcript: string;
  language: SupportedLanguage;
  confidence: number;
  isFinal: boolean;
}

export interface IVoiceRecognizer {
  startListening(language: SupportedLanguage): Promise<void>;
  stopListening(): Promise<void>;
  isListening(): boolean;
  onResult(listener: (result: VoiceRecognitionResult) => void): () => void;
  onError(listener: (error: string) => void): () => void;
}

export class MockVoiceRecognizer implements IVoiceRecognizer {
  public readonly isMock = true;
  private active = false;
  private currentLanguage: SupportedLanguage = 'en';
  private resultListeners: ((result: VoiceRecognitionResult) => void)[] = [];
  private errorListeners: ((error: string) => void)[] = [];

  public async startListening(language: SupportedLanguage): Promise<void> {
    this.currentLanguage = language;
    this.active = true;
    logger.info('MockVoiceRecognizer', `Mock voice listening started for language: [${language}]`);
  }

  public async stopListening(): Promise<void> {
    this.active = false;
    logger.info('MockVoiceRecognizer', 'Mock voice listening stopped');
  }

  public isListening(): boolean {
    return this.active;
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
    const result: VoiceRecognitionResult = {
      transcript,
      language: this.currentLanguage,
      confidence: 0.94,
      isFinal,
    };
    for (const listener of this.resultListeners) {
      listener(result);
    }
  }
}
