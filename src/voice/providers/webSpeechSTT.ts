/**
 * Web Speech API Speech-To-Text Provider
 * Supports English (en-US), Hindi (hi-IN), and Marathi (mr-IN).
 */

import { SupportedLanguage } from '../../shared/types/assistant';
import { logger } from '../../shared/utils';
import {
  IVoiceRecognizer,
  VoiceInputOptions,
  VoiceRecognitionResult,
  VoiceState,
  LANGUAGE_CONFIGS,
} from '../types';

// Declare Web Speech API types for browser environments
interface IWindowSpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: ((this: IWindowSpeechRecognition, ev: Event) => void) | null;
  onend: ((this: IWindowSpeechRecognition, ev: Event) => void) | null;
  onerror: ((this: IWindowSpeechRecognition, ev: { error: string; message?: string }) => void) | null;
  onresult: ((this: IWindowSpeechRecognition, ev: {
    resultIndex: number;
    results: {
      length: number;
      [index: number]: {
        isFinal: boolean;
        [index: number]: { transcript: string; confidence: number };
      };
    };
  }) => void) | null;
}

type SpeechRecognitionConstructor = new () => IWindowSpeechRecognition;

export class WebSpeechSTTProvider implements IVoiceRecognizer {
  private recognition: IWindowSpeechRecognition | null = null;
  private state: VoiceState = 'idle';
  private currentLanguage: SupportedLanguage = 'en';
  private active = false;

  private resultListeners: ((result: VoiceRecognitionResult) => void)[] = [];
  private errorListeners: ((error: string) => void)[] = [];
  private stateListeners: ((state: VoiceState) => void)[] = [];

  constructor() {
    this.initRecognition();
  }

  private initRecognition(): void {
    if (typeof window === 'undefined') return;

    const SpeechRecognition =
      (window as unknown as { SpeechRecognition?: SpeechRecognitionConstructor }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionConstructor }).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      logger.warn('WebSpeechSTT', 'SpeechRecognition API is not supported in this browser window.');
      return;
    }

    try {
      this.recognition = new SpeechRecognition();
      this.recognition.continuous = false;
      this.recognition.interimResults = true;

      this.recognition.onstart = () => {
        this.setState('listening');
        logger.info('WebSpeechSTT', `Microphone capture active for language: [${this.currentLanguage}]`);
      };

      this.recognition.onend = () => {
        this.active = false;
        if (this.state === 'listening' || this.state === 'processing') {
          this.setState('idle');
        }
        logger.info('WebSpeechSTT', 'Microphone capture ended.');
      };

      this.recognition.onerror = (event) => {
        this.active = false;
        this.setState('error');
        const errorMsg = event.error || 'Unknown speech recognition error';
        logger.error('WebSpeechSTT', `Speech recognition error: ${errorMsg}`);
        this.emitError(errorMsg);
      };

      this.recognition.onresult = (event) => {
        let finalTranscript = '';
        let interimTranscript = '';
        let confidence = 0.85;

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const item = event.results[i];
          if (item.isFinal) {
            finalTranscript += item[0].transcript;
            if (item[0].confidence > 0) {
              confidence = item[0].confidence;
            }
          } else {
            interimTranscript += item[0].transcript;
          }
        }

        const transcript = finalTranscript || interimTranscript;
        const isFinal = Boolean(finalTranscript);

        if (isFinal) {
          this.setState('processing');
        }

        if (transcript.trim()) {
          const result: VoiceRecognitionResult = {
            transcript: transcript.trim(),
            language: this.currentLanguage,
            confidence: Math.round(confidence * 100) / 100,
            isFinal,
          };
          this.emitResult(result);
        }
      };
    } catch (err) {
      logger.error('WebSpeechSTT', 'Failed to initialize SpeechRecognition instance', err);
    }
  }

  public async startListening(
    language: SupportedLanguage,
    options?: VoiceInputOptions
  ): Promise<void> {
    this.currentLanguage = language;
    const config = LANGUAGE_CONFIGS[language] || LANGUAGE_CONFIGS.en;

    // 1. Verify microphone permission via navigator.mediaDevices if available
    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: options?.echoCancellation ?? true,
            noiseSuppression: options?.noiseSuppression ?? true,
            autoGainControl: true,
          },
        });
        // Immediately stop temporary permission probe tracks so we don't hold raw audio
        stream.getTracks().forEach((track) => track.stop());
      } catch {
        this.setState('error');
        const message = config.strings.micPermissionDenied;
        this.emitError(message);
        throw new Error(message);
      }
    }

    if (!this.recognition) {
      this.setState('error');
      const err = config.strings.speechNotSupported;
      this.emitError(err);
      throw new Error(err);
    }

    try {
      this.recognition.lang = config.speechRecognitionLocale;
      this.recognition.continuous = options?.continuous ?? false;
      this.recognition.interimResults = options?.interimResults ?? true;
      this.recognition.start();
      this.active = true;
    } catch (err) {
      this.setState('error');
      const msg = `Unable to start speech recognition: ${(err as Error).message}`;
      this.emitError(msg);
      throw err;
    }
  }

  public async stopListening(): Promise<void> {
    if (this.recognition && this.active) {
      try {
        this.recognition.stop();
      } catch (err) {
        logger.warn('WebSpeechSTT', 'Recognition already stopped or inactive', err);
      }
    }
    this.active = false;
    this.setState('idle');
  }

  public isListening(): boolean {
    return this.active && this.state === 'listening';
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

  private setState(newState: VoiceState): void {
    this.state = newState;
    for (const listener of this.stateListeners) {
      try {
        listener(newState);
      } catch (err) {
        logger.error('WebSpeechSTT', 'Error in state listener', err);
      }
    }
  }

  private emitResult(result: VoiceRecognitionResult): void {
    for (const listener of this.resultListeners) {
      try {
        listener(result);
      } catch (err) {
        logger.error('WebSpeechSTT', 'Error in result listener', err);
      }
    }
  }

  private emitError(error: string): void {
    for (const listener of this.errorListeners) {
      try {
        listener(error);
      } catch (err) {
        logger.error('WebSpeechSTT', 'Error in error listener', err);
      }
    }
  }
}
