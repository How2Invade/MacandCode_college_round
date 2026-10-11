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
  onEnd(listener: () => void): () => void;
}

export class WebSpeechRecognizer implements IVoiceRecognizer {
  public readonly isMock = false;
  private recognition: any = null;
  private active = false;
  private currentLanguage: SupportedLanguage = 'en';
  private silenceTimer: any = null;
  private lastPartialTranscript = '';
  
  private resultListeners: ((result: VoiceRecognitionResult) => void)[] = [];
  private errorListeners: ((error: string) => void)[] = [];
  private endListeners: (() => void)[] = [];

  constructor() {
    // Initialized on startListening for cleanest state and browser compatibility
  }

  private createRecognitionInstance(): any {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return null;

    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (event: any) => {
      let finalTranscript = '';
      let interimTranscript = '';
      let maxConfidence = 0;

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const res = event.results[i];
        const transcript = res[0].transcript;
        if (res.isFinal) {
          finalTranscript += transcript;
          maxConfidence = Math.max(maxConfidence, res[0].confidence || 0.85);
        } else {
          interimTranscript += transcript;
        }
      }

      const currentText = (finalTranscript || interimTranscript).trim();
      if (currentText) {
        this.lastPartialTranscript = currentText;
      }

      const isFinal = Boolean(finalTranscript.trim());
      const result: VoiceRecognitionResult = {
        transcript: currentText,
        language: this.currentLanguage,
        confidence: isFinal ? (maxConfidence || 0.9) : 0.5,
        isFinal
      };

      for (const listener of this.resultListeners) {
        listener(result);
      }

      if (isFinal) {
        if (this.silenceTimer) clearTimeout(this.silenceTimer);
        this.lastPartialTranscript = '';
      } else if (currentText) {
        // Fallback: If user stops speaking for 1.3s, automatically commit as final so AI responds
        if (this.silenceTimer) clearTimeout(this.silenceTimer);
        this.silenceTimer = setTimeout(() => {
          if (this.active && this.lastPartialTranscript) {
            const committedText = this.lastPartialTranscript;
            this.lastPartialTranscript = '';
            for (const listener of this.resultListeners) {
              listener({
                transcript: committedText,
                language: this.currentLanguage,
                confidence: 0.85,
                isFinal: true
              });
            }
          }
        }, 1300);
      }
    };

    rec.onerror = (event: any) => {
      if (event.error === 'no-speech') return; // Don't treat brief pauses as fatal errors
      logger.error('WebSpeechRecognizer', 'Speech recognition error', event.error);
      for (const listener of this.errorListeners) {
        listener(event.error);
      }
      this.active = false;
    };

    rec.onend = () => {
      if (this.silenceTimer) {
        clearTimeout(this.silenceTimer);
        this.silenceTimer = null;
      }
      this.active = false;
      for (const listener of this.endListeners) {
        listener();
      }
    };

    return rec;
  }

  public async startListening(language: SupportedLanguage): Promise<void> {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      throw new Error('Speech recognition not supported in this browser environment.');
    }

    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch {
        // Ignore abort error
      }
      this.recognition = null;
    }

    this.recognition = this.createRecognitionInstance();
    if (!this.recognition) {
      throw new Error('Failed to create speech recognition instance.');
    }
    
    // Map internal codes to BCP-47
    const langMap: Record<SupportedLanguage, string> = {
      en: 'en-US',
      hi: 'hi-IN',
      mr: 'mr-IN'
    };
    
    this.currentLanguage = language;
    this.recognition.lang = langMap[language] || 'en-US';
    this.lastPartialTranscript = '';
    
    try {
      this.active = true;
      this.recognition.start();
      logger.info('WebSpeechRecognizer', `Listening started for language: [${language}] (${this.recognition.lang})`);
    } catch (err: any) {
      this.active = false;
      throw new Error(err.message || 'Failed to start speech recognition');
    }
  }

  public async stopListening(): Promise<void> {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        // Ignore stop error
      }
      this.active = false;
      logger.info('WebSpeechRecognizer', 'Listening stopped');
    }
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

  public onEnd(listener: () => void): () => void {
    this.endListeners.push(listener);
    return () => {
      this.endListeners = this.endListeners.filter((l) => l !== listener);
    };
  }
}
