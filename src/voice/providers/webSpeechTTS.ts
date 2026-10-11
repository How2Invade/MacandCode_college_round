/** Backend-backed speech output using Sarvam for English, Hindi, and Marathi. */

import { SupportedLanguage } from '../../shared/types/assistant';
import { logger } from '../../shared/utils';
import { IVoiceSynthesizer, VoiceOutputOptions, VoiceState } from '../types';
import { BackendTTSPlayer } from './backendTTSPlayer';

export class WebSpeechTTSProvider implements IVoiceSynthesizer {
  private state: VoiceState = 'idle';
  private speaking = false;
  private stateListeners: ((state: VoiceState) => void)[] = [];
  private player = new BackendTTSPlayer();

  public async speak(
    text: string,
    language: SupportedLanguage,
    _options?: VoiceOutputOptions
  ): Promise<void> {
    if (!text.trim()) return;

    await this.stop();
    this.speaking = true;
    this.setState('speaking');
    try {
      await this.player.speak(text, language);
    } catch (error) {
      logger.warn('TTSProvider', 'Backend speech synthesis failed, falling back to browser SpeechSynthesis', error);
      if (typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined') {
        await new Promise<void>((resolve) => {
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(text);
          const langMap: Record<SupportedLanguage, string> = { en: 'en-US', hi: 'hi-IN', mr: 'mr-IN' };
          utterance.lang = langMap[language] || 'en-US';
          utterance.onend = () => resolve();
          utterance.onerror = () => resolve();
          window.speechSynthesis.speak(utterance);
        });
      } else {
        throw error;
      }
    } finally {
      this.speaking = false;
      this.setState('idle');
    }
  }

  public async stop(): Promise<void> {
    await this.player.stop();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    this.speaking = false;
    this.setState('idle');
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
      this.stateListeners = this.stateListeners.filter((candidate) => candidate !== listener);
    };
  }

  private setState(state: VoiceState): void {
    this.state = state;
    for (const listener of this.stateListeners) {
      try {
        listener(state);
      } catch (error) {
        logger.error('TTSProvider', 'Error in state listener', error);
      }
    }
  }
}
