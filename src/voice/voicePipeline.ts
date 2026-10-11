/**
 * Voice Pipeline Coordinator
 * Manages explicit microphone activation, speech-to-text, text-to-speech,
 * state machine transitions, interruption handling, and multilingual switching.
 */

import { SupportedLanguage } from '../shared/types/assistant';
import { logger } from '../shared/utils';
import {
  IVoiceRecognizer,
  IVoiceSynthesizer,
  VoiceRecognitionResult,
  VoiceState,
  LANGUAGE_CONFIGS,
} from './types';
import { WebSpeechSTTProvider } from './providers/webSpeechSTT';
import { WebSpeechTTSProvider } from './providers/webSpeechTTS';
import { MockVoiceRecognizer, MockVoiceSynthesizer } from './mockVoiceRecognizer';

export interface VoicePipelineOptions {
  sttProvider?: IVoiceRecognizer;
  ttsProvider?: IVoiceSynthesizer;
  initialLanguage?: SupportedLanguage;
}

export class VoicePipeline {
  private stt: IVoiceRecognizer;
  private tts: IVoiceSynthesizer;
  private currentLanguage: SupportedLanguage;
  private currentState: VoiceState = 'idle';
  private isMuted = false;

  private stateListeners: ((state: VoiceState) => void)[] = [];
  private transcriptListeners: ((result: VoiceRecognitionResult) => void)[] = [];
  private errorListeners: ((error: string) => void)[] = [];

  constructor(options: VoicePipelineOptions = {}) {
    this.currentLanguage = options.initialLanguage || 'en';

    // Auto-select Web Speech if available, otherwise mock provider
    const isBrowser = typeof window !== 'undefined' && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window);
    this.stt = options.sttProvider || (isBrowser ? new WebSpeechSTTProvider() : new MockVoiceRecognizer());
    this.tts = options.ttsProvider || (typeof window !== 'undefined' ? new WebSpeechTTSProvider() : new MockVoiceSynthesizer());

    this.wireListeners();
  }

  private wireListeners(): void {
    this.stt.onStateChange((state) => {
      if (this.isMuted) return;
      this.updateState(state);
    });

    this.stt.onResult((result) => {
      for (const listener of this.transcriptListeners) {
        try {
          listener(result);
        } catch (err) {
          logger.error('VoicePipeline', 'Error in transcript listener', err);
        }
      }
    });

    this.stt.onError((error) => {
      this.updateState('error');
      for (const listener of this.errorListeners) {
        try {
          listener(error);
        } catch (err) {
          logger.error('VoicePipeline', 'Error in error listener', err);
        }
      }
    });

    this.tts.onStateChange((state) => {
      if (state === 'speaking') {
        this.updateState('speaking');
      } else if (state === 'idle' && this.currentState === 'speaking') {
        this.updateState('idle');
      }
    });
  }

  /**
   * Set user preferred language (en, hi, mr)
   */
  public setLanguage(language: SupportedLanguage): void {
    this.currentLanguage = language;
    logger.info('VoicePipeline', `Voice pipeline language set to: [${language}]`);
  }

  public getLanguage(): SupportedLanguage {
    return this.currentLanguage;
  }

  /**
   * Start microphone capture on explicit user action
   */
  public async startListening(): Promise<void> {
    if (this.isMuted) {
      logger.warn('VoicePipeline', 'Microphone is currently muted.');
      return;
    }

    // Interrupt any ongoing speech output when user starts speaking
    if (this.tts.isSpeaking()) {
      await this.tts.stop();
    }

    try {
      this.updateState('listening');
      await this.stt.startListening(this.currentLanguage, {
        noiseSuppression: true,
        echoCancellation: true,
      });
    } catch (err) {
      this.updateState('error');
      throw err;
    }
  }

  /**
   * Stop microphone capture
   */
  public async stopListening(): Promise<void> {
    await this.stt.stopListening();
    if (this.currentState === 'listening') {
      this.updateState('idle');
    }
  }

  /**
   * Speak response in selected language with interruptibility support
   */
  public async speak(text: string, customLanguage?: SupportedLanguage): Promise<void> {
    const lang = customLanguage || this.currentLanguage;

    // If currently listening, stop capture before speaking to prevent feedback loops
    if (this.stt.isListening()) {
      await this.stt.stopListening();
    }

    try {
      await this.tts.speak(text, lang);
    } catch (err) {
      logger.error('VoicePipeline', 'Failed to speak text', err);
      const message = err instanceof Error ? err.message : 'Voice synthesis failed.';
      this.updateState('error');
      for (const listener of this.errorListeners) {
        try {
          listener(message);
        } catch (listenerError) {
          logger.error('VoicePipeline', 'Error in voice output error listener', listenerError);
        }
      }
    }
  }

  /**
   * Interrupt current speech immediately
   */
  public async stopSpeaking(): Promise<void> {
    await this.tts.stop();
    if (this.currentState === 'speaking') {
      this.updateState('idle');
    }
  }

  /**
   * Mute or unmute the voice pipeline
   */
  public setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (muted) {
      this.stt.stopListening();
      this.tts.stop();
      this.updateState('muted');
    } else {
      this.updateState('idle');
    }
  }

  public getState(): VoiceState {
    return this.currentState;
  }

  public getLocalizedText(key: keyof typeof LANGUAGE_CONFIGS.en.strings): string {
    const config = LANGUAGE_CONFIGS[this.currentLanguage] || LANGUAGE_CONFIGS.en;
    return config.strings[key];
  }

  public onStateChange(listener: (state: VoiceState) => void): () => void {
    this.stateListeners.push(listener);
    return () => {
      this.stateListeners = this.stateListeners.filter((l) => l !== listener);
    };
  }

  public onTranscript(listener: (result: VoiceRecognitionResult) => void): () => void {
    this.transcriptListeners.push(listener);
    return () => {
      this.transcriptListeners = this.transcriptListeners.filter((l) => l !== listener);
    };
  }

  public onError(listener: (error: string) => void): () => void {
    this.errorListeners.push(listener);
    return () => {
      this.errorListeners = this.errorListeners.filter((l) => l !== listener);
    };
  }

  private updateState(state: VoiceState): void {
    this.currentState = state;
    for (const listener of this.stateListeners) {
      try {
        listener(state);
      } catch (err) {
        logger.error('VoicePipeline', 'Error in state listener', err);
      }
    }
  }
}
