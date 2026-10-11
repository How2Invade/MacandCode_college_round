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
  private activeStream: MediaStream | null = null;
  private silenceTimer: any = null;
  private lastPartialTranscript = '';

  private resultListeners: ((result: VoiceRecognitionResult) => void)[] = [];
  private errorListeners: ((error: string) => void)[] = [];
  private stateListeners: ((state: VoiceState) => void)[] = [];

  constructor() {
    // Recognition instance is initialized per listening session in startListening()
  }

  public async startListening(
    language: SupportedLanguage,
    options?: VoiceInputOptions
  ): Promise<void> {
    this.currentLanguage = language;
    const config = LANGUAGE_CONFIGS[language] || LANGUAGE_CONFIGS.en;

    // 1. Acquire and verify microphone audio stream, keeping track alive for browser capture
    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: options?.echoCancellation ?? true,
            noiseSuppression: options?.noiseSuppression ?? true,
            autoGainControl: true,
          },
        });
        const audioTracks = stream.getAudioTracks();
        if (!audioTracks || audioTracks.length === 0 || !audioTracks[0].enabled) {
          throw new Error('No live audio tracks received from microphone.');
        }

        // Clean up prior stream if any
        if (this.activeStream) {
          this.activeStream.getTracks().forEach((track) => track.stop());
        }
        // Retain live audio track for the entire listening session
        this.activeStream = stream;
      } catch (err: any) {
        this.setState('error');
        const isDenied =
          err?.name === 'NotAllowedError' ||
          err?.name === 'PermissionDeniedError' ||
          err?.message?.includes('denied') ||
          err?.message?.includes('not-allowed');
        const message = isDenied ? config.strings.micPermissionDenied : (err?.message || 'Microphone error.');
        this.emitError(message);
        throw err;
      }
    }

    const SpeechRecognition =
      (window as unknown as { SpeechRecognition?: SpeechRecognitionConstructor }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionConstructor }).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      this.setState('error');
      const err = config.strings.speechNotSupported;
      this.emitError(err);
      throw new Error(err);
    }

    // Clean up prior recognition instance
    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch {
        // Ignore
      }
      this.recognition = null;
    }

    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    this.lastPartialTranscript = '';

    try {
      this.recognition = new SpeechRecognition();
      this.recognition.continuous = options?.continuous ?? true;
      this.recognition.interimResults = options?.interimResults ?? true;
      this.recognition.lang = config.speechRecognitionLocale;

      this.recognition.onstart = () => {
        this.active = true;
        this.setState('listening');
        logger.info('WebSpeechSTT', `Microphone capture active for language: [${this.currentLanguage}] (${config.speechRecognitionLocale})`);
      };

      this.recognition.onresult = (event) => {
        let finalTranscript = '';
        let interimTranscript = '';
        let confidence = 0.9;

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

        const currentText = (finalTranscript || interimTranscript).trim();
        const isFinal = Boolean(finalTranscript.trim());

        if (currentText) {
          this.lastPartialTranscript = currentText;
          const result: VoiceRecognitionResult = {
            transcript: currentText,
            language: this.currentLanguage,
            confidence: isFinal ? Math.round(confidence * 100) / 100 : 0.5,
            isFinal,
          };
          this.emitResult(result);
        }

        if (isFinal) {
          if (this.silenceTimer) clearTimeout(this.silenceTimer);
          this.lastPartialTranscript = '';
        } else if (currentText) {
          // Auto-commit on 1.2s silence pause so conversational assistant responds naturally
          if (this.silenceTimer) clearTimeout(this.silenceTimer);
          this.silenceTimer = setTimeout(() => {
            if (this.active && this.lastPartialTranscript) {
              const textToSend = this.lastPartialTranscript;
              this.lastPartialTranscript = '';
              this.emitResult({
                transcript: textToSend,
                language: this.currentLanguage,
                confidence: 0.85,
                isFinal: true,
              });
            }
          }, 1200);
        }
      };

      this.recognition.onerror = (event) => {
        if (event.error === 'no-speech') {
          // Pause in speech, do not tear down the session
          return;
        }
        logger.error('WebSpeechSTT', `Speech recognition error: ${event.error}`);
        this.active = false;
        this.setState('error');
        this.emitError(event.error || 'Speech recognition error');
      };

      this.recognition.onend = () => {
        if (this.silenceTimer) {
          clearTimeout(this.silenceTimer);
          this.silenceTimer = null;
        }
        // If the user is still actively listening, Chrome SpeechRecognition auto-ends after silence. Restart if active.
        if (this.active) {
          try {
            this.recognition?.start();
            return;
          } catch {
            // Drop to idle if restart is rejected
          }
        }
        this.active = false;
        if (this.activeStream) {
          this.activeStream.getTracks().forEach((track) => track.stop());
          this.activeStream = null;
        }
        if (this.state === 'listening' || this.state === 'processing') {
          this.setState('idle');
        }
        logger.info('WebSpeechSTT', 'Microphone capture ended.');
      };

      this.active = true;
      this.setState('listening');
      this.recognition.start();
    } catch (err) {
      this.active = false;
      if (this.activeStream) {
        this.activeStream.getTracks().forEach((track) => track.stop());
        this.activeStream = null;
      }
      this.setState('error');
      const msg = `Unable to start speech recognition: ${(err as Error).message}`;
      this.emitError(msg);
      throw err;
    }
  }

  public async stopListening(): Promise<void> {
    this.active = false;
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    this.lastPartialTranscript = '';

    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (err) {
        logger.warn('WebSpeechSTT', 'Recognition already stopped or inactive', err);
      }
    }

    if (this.activeStream) {
      this.activeStream.getTracks().forEach((track) => track.stop());
      this.activeStream = null;
    }

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
