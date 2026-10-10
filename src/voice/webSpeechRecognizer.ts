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
  
  private resultListeners: ((result: VoiceRecognitionResult) => void)[] = [];
  private errorListeners: ((error: string) => void)[] = [];
  private endListeners: (() => void)[] = [];

  constructor() {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      this.recognition = new SpeechRecognition();
      this.recognition.continuous = false;
      this.recognition.interimResults = true;
      
      this.recognition.onresult = (event: any) => {
        let finalTranscript = '';
        let interimTranscript = '';
        let maxConfidence = 0;

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const res = event.results[i];
          const transcript = res[0].transcript;
          if (res.isFinal) {
            finalTranscript += transcript;
            maxConfidence = Math.max(maxConfidence, res[0].confidence);
          } else {
            interimTranscript += transcript;
          }
        }

        const isFinal = finalTranscript.length > 0;
        const result: VoiceRecognitionResult = {
          transcript: isFinal ? finalTranscript : interimTranscript,
          language: this.currentLanguage,
          confidence: isFinal ? maxConfidence : 0.5,
          isFinal
        };

        for (const listener of this.resultListeners) {
          listener(result);
        }
      };

      this.recognition.onerror = (event: any) => {
        logger.error('WebSpeechRecognizer', 'Speech recognition error', event.error);
        for (const listener of this.errorListeners) {
          listener(event.error);
        }
        this.active = false;
      };

      this.recognition.onend = () => {
        this.active = false;
        for (const listener of this.endListeners) {
          listener();
        }
      };
    }
  }

  public async startListening(language: SupportedLanguage): Promise<void> {
    if (!this.recognition) {
      throw new Error('Speech recognition not supported in this browser environment.');
    }
    
    // Map internal codes to BCP-47
    const langMap: Record<SupportedLanguage, string> = {
      en: 'en-US',
      hi: 'hi-IN',
      mr: 'mr-IN'
    };
    
    this.currentLanguage = language;
    this.recognition.lang = langMap[language] || 'en-US';
    
    try {
      this.active = true;
      this.recognition.start();
      logger.info('WebSpeechRecognizer', `Listening started for language: [${language}]`);
    } catch (err: any) {
      this.active = false;
      throw new Error(err.message || 'Failed to start speech recognition');
    }
  }

  public async stopListening(): Promise<void> {
    if (this.recognition && this.active) {
      this.recognition.stop();
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
