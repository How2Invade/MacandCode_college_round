/**
 * Voice Pipeline Types and Multilingual Configuration
 * Part A: Voice Capture, Speech Synthesis, and Multilingual Support (en, hi, mr)
 */

import { SupportedLanguage } from '../shared/types/assistant';

export type VoiceState =
  | 'idle'
  | 'listening'
  | 'processing'
  | 'speaking'
  | 'muted'
  | 'error';

export interface VoiceRecognitionResult {
  transcript: string;
  language: SupportedLanguage;
  confidence: number;
  isFinal: boolean;
}

export interface VoiceInputOptions {
  continuous?: boolean;
  interimResults?: boolean;
  noiseSuppression?: boolean;
  echoCancellation?: boolean;
}

export interface VoiceOutputOptions {
  rate?: number; // 0.1 to 10, default 1.0
  pitch?: number; // 0 to 2, default 1.0
  volume?: number; // 0 to 1, default 1.0
  voiceName?: string;
}

export interface IVoiceRecognizer {
  startListening(language: SupportedLanguage, options?: VoiceInputOptions): Promise<void>;
  stopListening(): Promise<void>;
  isListening(): boolean;
  getState(): VoiceState;
  onStateChange(listener: (state: VoiceState) => void): () => void;
  onResult(listener: (result: VoiceRecognitionResult) => void): () => void;
  onError(listener: (error: string) => void): () => void;
}

export interface IVoiceSynthesizer {
  speak(text: string, language: SupportedLanguage, options?: VoiceOutputOptions): Promise<void>;
  stop(): Promise<void>;
  isSpeaking(): boolean;
  getState(): VoiceState;
  onStateChange(listener: (state: VoiceState) => void): () => void;
}

/**
 * Multilingual language settings and BCP-47 speech tags
 */
export interface LanguageConfig {
  code: SupportedLanguage;
  name: string;
  nativeName: string;
  speechRecognitionLocale: string;
  speechSynthesisLocales: string[];
  strings: {
    welcome: string;
    listening: string;
    processing: string;
    approvalRequired: string;
    executing: string;
    success: string;
    error: string;
    cancelled: string;
    interrupted: string;
    micPermissionDenied: string;
    speechNotSupported: string;
  };
}

export const LANGUAGE_CONFIGS: Record<SupportedLanguage, LanguageConfig> = {
  en: {
    code: 'en',
    name: 'English',
    nativeName: 'English',
    speechRecognitionLocale: 'en-US',
    speechSynthesisLocales: ['en-US', 'en-GB', 'en-IN'],
    strings: {
      welcome: 'Welcome to Handsfree. How can I assist you today?',
      listening: 'Listening for your command...',
      processing: 'Processing your request and preparing actions...',
      approvalRequired: 'This action requires your confirmation before proceeding.',
      executing: 'Executing browser action...',
      success: 'Task completed successfully.',
      error: 'An error occurred while executing the task.',
      cancelled: 'Action cancelled by user.',
      interrupted: 'Operation interrupted.',
      micPermissionDenied: 'Microphone permission was denied. Please grant microphone access in browser settings.',
      speechNotSupported: 'Speech recognition is not supported in this browser environment.',
    },
  },
  hi: {
    code: 'hi',
    name: 'Hindi',
    nativeName: 'हिन्दी',
    speechRecognitionLocale: 'hi-IN',
    speechSynthesisLocales: ['hi-IN'],
    strings: {
      welcome: 'हैंड्सफ्री में आपका स्वागत है। मैं आपकी क्या मदद कर सकता हूँ?',
      listening: 'आपकी आवाज़ सुन रहा हूँ...',
      processing: 'आपके अनुरोध पर विचार कर रहा हूँ और कार्रवाई तैयार कर रहा हूँ...',
      approvalRequired: 'इस कार्रवाई के लिए आगे बढ़ने से पहले आपकी अनुमति आवश्यक है।',
      executing: 'ब्राउज़र कार्रवाई की जा रही है...',
      success: 'कार्य सफलतापूर्वक पूरा हुआ।',
      error: 'कार्य निष्पादित करते समय त्रुटि हुई।',
      cancelled: 'उपयोगकर्ता द्वारा कार्रवाई रद्द की गई।',
      interrupted: 'प्रक्रिया बीच में रोकी गई।',
      micPermissionDenied: 'माइक्रोफ़ोन अनुमति अस्वीकृत। कृपया ब्राउज़र सेटिंग्स में माइक्रोफ़ोन की अनुमति दें।',
      speechNotSupported: 'इस ब्राउज़र वातावरण में वाक् पहचान समर्थित नहीं है।',
    },
  },
  mr: {
    code: 'mr',
    name: 'Marathi',
    nativeName: 'मराठी',
    speechRecognitionLocale: 'mr-IN',
    speechSynthesisLocales: ['mr-IN', 'hi-IN'],
    strings: {
      welcome: 'हँड्सफ्रीमध्ये आपले स्वागत आहे. मी आपली काय मदत करू शकतो?',
      listening: 'आपला आवाज ऐकत आहे...',
      processing: 'आपल्या विनंतीवर विचार करत आहे आणि कृती योजना तयार करत आहे...',
      approvalRequired: 'या कृतीसाठी पुढे जाण्यापूर्वी आपल्या मंजुरीची आवश्यकता आहे.',
      executing: 'ब्राउझर कृती कार्यान्वित केली जात आहे...',
      success: 'काम यशस्वीरित्या पूर्ण झाले.',
      error: 'कृती करताना त्रुटी आली.',
      cancelled: 'वापरकर्त्याने कृती रद्द केली.',
      interrupted: 'प्रक्रिया थांबवण्यात आली.',
      micPermissionDenied: 'मायक्रोफोन परवानगी नाकारली गेली. कृपया ब्राउझर सेटिंग्जमध्ये मायक्रोफोन परवानगी द्या.',
      speechNotSupported: 'या ब्राउझरमध्ये व्हॉइस ओळख उपलब्ध नाही.',
    },
  },
};
